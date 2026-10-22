"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Loader2, Sparkles, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { drawCover, loadImage, sampleCellLabs } from "@/lib/color";
import type { ModeKey } from "@/lib/mosaic";
import {
  STUDIO_RULES_LABEL,
  assignOnce,
  decodeShare,
  encodeShare,
  factorGrid,
  galleryAsset,
  heuristicPromptFilter,
  pickTarget,
  type CatalogItem,
  type PromptVerdict,
  type StudioCatalog,
} from "@/lib/studio";

type Phase = "idle" | "filtering" | "building" | "ready" | "error";

const TILE = 48; // preview tile px — fast shareable JPEG

export function StudioApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ModeKey>("all");
  const [seed, setSeed] = useState(7);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Prompt a Claudia homage — we keep it related and appropriate.");
  const [verdict, setVerdict] = useState<PromptVerdict | null>(null);
  const [target, setTarget] = useState<CatalogItem | null>(null);
  const [jpegUrl, setJpegUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);

  // Hydrate from share URL
  useEffect(() => {
    const shared = decodeShare(window.location.search);
    if (shared.prompt) setPrompt(shared.prompt);
    if (shared.mode) setMode(shared.mode);
    if (shared.seed != null) setSeed(shared.seed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/studio-catalog.json")
      .then((r) => {
        if (!r.ok) throw new Error(`catalog HTTP ${r.status}`);
        return r.json();
      })
      .then((raw: StudioCatalog) => {
        if (!cancelled) setCatalog(raw);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) {
          setPhase("error");
          setStatus("Studio catalog failed to load. Try again after a refresh.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useMemo(() => {
    if (!catalog) return [] as CatalogItem[];
    return mode === "canon" ? catalog.items.filter((i) => i.plate) : catalog.items;
  }, [catalog, mode]);

  const build = useCallback(async () => {
    if (!catalog || !sources.length) return;
    setPhase("filtering");
    setStatus("Checking your prompt…");
    setJpegUrl(null);
    setCopied(false);

    let v: PromptVerdict;
    try {
      const res = await fetch("/api/studio/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      v = (await res.json()) as PromptVerdict;
    } catch {
      v = heuristicPromptFilter(prompt);
    }
    setVerdict(v);
    if (!v.ok) {
      setPhase("idle");
      setStatus(v.reason);
      return;
    }

    const cleaned = v.cleanedPrompt || prompt.trim();
    const tags = v.themeTags || [];
    const shared = decodeShare(window.location.search);
    let tgt: CatalogItem;
    if (shared.target && shared.prompt === cleaned) {
      const hit = sources.find((i) => i.id === shared.target);
      tgt = hit ?? pickTarget(sources, mode, cleaned, tags, seed);
    } else {
      tgt = pickTarget(sources, mode, cleaned, tags, seed);
    }
    setTarget(tgt);

    setPhase("building");
    setStatus(`Building 1× mosaic from ${sources.length.toLocaleString()} photographs…`);
    setProgress(0);

    try {
      const { cols, rows } = factorGrid(sources.length);
      const W = cols * TILE;
      const H = rows * TILE;

      const tgtUrl = galleryAsset(tgt.m || tgt.s);
      if (!tgtUrl) throw new Error("target has no image URL");
      const tgtImg = await loadImage(tgtUrl);

      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = cols * 8;
      sampleCanvas.height = rows * 5;
      const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (!sctx) throw new Error("canvas unsupported");
      drawCover(sctx, tgtImg, sampleCanvas.width, sampleCanvas.height, 0.4);
      const cellLabs = sampleCellLabs(sctx, cols, rows);
      const assignment = assignOnce(cellLabs, sources);

      const canvas = canvasRef.current;
      if (!canvas) throw new Error("missing canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unsupported");
      ctx.fillStyle = "#050406";
      ctx.fillRect(0, 0, W, H);

      // Load + paint tiles in batches
      const batch = 24;
      for (let i = 0; i < assignment.length; i += batch) {
        const slice = assignment.slice(i, i + batch);
        await Promise.all(
          slice.map(async (srcIdx, j) => {
            const cell = i + j;
            if (srcIdx < 0) return; // empty gap
            const src = sources[srcIdx];
            const url = galleryAsset(src.s);
            if (!url) return;
            try {
              const img = await loadImage(url);
              const col = cell % cols;
              const row = Math.floor(cell / cols);
              ctx.drawImage(img, col * TILE, row * TILE, TILE, TILE);
            } catch {
              /* skip broken tile */
            }
          }),
        );
        setProgress(Math.round(((i + slice.length) / assignment.length) * 100));
        // Yield to UI
        await new Promise((r) => setTimeout(r, 0));
      }

      const url = canvas.toDataURL("image/jpeg", 0.88);
      setJpegUrl(url);

      const sharePath = encodeShare({ prompt: cleaned, target: tgt.id, mode, seed });
      window.history.replaceState(null, "", sharePath);

      setPhase("ready");
      setStatus(
        `${sources.length.toLocaleString()} photographs · ${cols}×${rows} · ${STUDIO_RULES_LABEL}`,
      );
    } catch (err) {
      console.error(err);
      setPhase("error");
      setStatus(err instanceof Error ? err.message : "Build failed");
    }
  }, [catalog, sources, prompt, mode, seed]);

  // Auto-build when landing on a complete share link
  useEffect(() => {
    if (!catalog) return;
    const shared = decodeShare(window.location.search);
    if (shared.prompt && shared.target && phase === "idle" && !jpegUrl) {
      void build();
    }
    // intentionally once catalog is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const copyLink = async () => {
    const cleaned = verdict?.cleanedPrompt || prompt.trim();
    if (!target || !cleaned) return;
    const path = encodeShare({ prompt: cleaned, target: target.id, mode, seed });
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy — select the URL bar instead.");
    }
  };

  return (
    <div className="min-h-dvh bg-[#050406] text-[#eee8e2]">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% 0%, rgba(217,119,87,0.18), transparent 55%), radial-gradient(ellipse 60% 40% at 90% 20%, rgba(90,120,160,0.12), transparent 50%), linear-gradient(180deg, #0a080c 0%, #050406 45%, #08060a 100%)",
        }}
      />

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-[12px] font-semibold tracking-[0.28em] text-white/90 hover:text-white">
              CLAUDIA <span className="text-[#D97757]">✳</span> EVERY FRAME
            </Link>
            <span className="text-[11px] tracking-wide text-[#D97757]/90">Studio</span>
          </div>
          <Link
            href="/"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3 text-[11px] tracking-wide text-white/75 backdrop-blur hover:border-white/25 hover:text-white"
          >
            <ArrowLeft className="size-3.5" />
            Official editions
          </Link>
        </header>

        <main className="mt-8 grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
          <section className="space-y-5">
            <div>
              <h1 className="font-[family-name:var(--font-sans)] text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Make a Claudia mosaic
              </h1>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-white/55">
                Prompt a portrait or film homage. We filter for Claudia-related, appropriate ideas,
                then build with every still once — same house rule as the official editions. Share the link.
              </p>
            </div>

            <label className="block space-y-2">
              <span className="text-[11px] tracking-[0.18em] text-white/40">PROMPT</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                maxLength={280}
                placeholder='e.g. “Claudia close-up from Don’t Let Me Scroll, soft night light”'
                className="w-full resize-none rounded-xl border border-white/12 bg-black/45 px-3.5 py-3 text-[14px] text-white outline-none ring-[#D97757]/40 placeholder:text-white/30 focus:ring-2"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Source set" className="flex rounded-full border border-white/12 bg-black/45 p-0.5 text-[11px]">
                {(
                  [
                    ["all", "All"],
                    ["canon", "Film Canon"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={mode === k}
                    onClick={() => setMode(k)}
                    className={`rounded-full px-3 py-1.5 tracking-wide transition-colors ${
                      mode === k ? "bg-[#D97757] font-semibold text-[#1b1210]" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-white/45">
                Seed
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value) || 0)}
                  className="w-20 rounded-lg border border-white/12 bg-black/45 px-2 py-1.5 font-mono text-white outline-none"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void build()}
                disabled={!catalog || phase === "filtering" || phase === "building" || prompt.trim().length < 3}
                className="rounded-full bg-[#D97757] px-5 text-[#1b1210] hover:bg-[#e0896c]"
              >
                {phase === "filtering" || phase === "building" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {phase === "building" ? `Building ${progress}%` : "Build mosaic"}
              </Button>
              {phase === "ready" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void copyLink()}
                    className="rounded-full border-white/15 bg-black/30 text-white/85"
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copied ? "Link copied" : "Copy share link"}
                  </Button>
                  {jpegUrl && (
                    <a
                      href={jpegUrl}
                      download="claudia-studio-mosaic.jpg"
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-4 text-[13px] text-white/85 hover:bg-white/10"
                    >
                      <Download className="size-4" />
                      Download JPEG
                    </a>
                  )}
                </>
              )}
            </div>

            <p className={`text-[12px] leading-relaxed ${phase === "error" || (verdict && !verdict.ok) ? "text-[#e8a090]" : "text-white/45"}`}>
              {status}
            </p>

            <p className="text-[11px] tracking-wide text-white/30">
              {STUDIO_RULES_LABEL}
              {catalog ? ` · ${sources.length.toLocaleString()} ${mode === "canon" ? "Film Canon" : "eligible"} photographs` : ""}
              {" · "}Official deep-zoom editions stay on the{" "}
              <Link href="/" className="underline decoration-white/20 hover:text-white/50">
                home page
              </Link>
              .
            </p>
          </section>

          <section className="relative min-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-black/50 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            <canvas ref={canvasRef} className="block h-auto w-full bg-[#050406]" />
            {phase !== "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                {!catalog ? (
                  <>
                    <Loader2 className="size-5 animate-spin text-[#D97757]" />
                    <p className="text-[12px] tracking-wide text-white/50">Loading photograph catalog…</p>
                  </>
                ) : phase === "building" || phase === "filtering" ? (
                  <>
                    <Loader2 className="size-5 animate-spin text-[#D97757]" />
                    <p className="text-[12px] tracking-wide text-white/60">{status}</p>
                  </>
                ) : (
                  <p className="max-w-xs text-[13px] leading-relaxed text-white/40">
                    Your mosaic preview will appear here. Same tiles as the archive — each photograph once.
                  </p>
                )}
              </div>
            )}
            {phase === "ready" && target && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pt-10 pb-3">
                <p className="truncate text-[11px] tracking-wide text-white/70">
                  Homage target{" "}
                  <span className="text-[#D97757]">{target.id}</span>
                  {target.film_title ? <span className="text-white/40"> · {target.film_title}</span> : null}
                </p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
