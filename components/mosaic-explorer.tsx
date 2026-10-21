"use client";

// Deep-zoom explorer for the generated Claudia photomosaic.
// OpenSeadragon streams the DZI pyramid; mosaic.json maps every grid cell
// back to the real claudia.gallery photograph it was built from.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type OpenSeadragon from "openseadragon";
import { Download, ExternalLink, Expand, Minimize, Minus, Plus, Scan, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  MODES,
  editionBase,
  type Edition,
  type EditionsFile,
  type ModeKey,
  type MosaicData,
  type MosaicReport,
  type MosaicSource,
  formatBytes,
  galleryUrl,
  parseEditions,
  parseMosaic,
  parseReport,
} from "@/lib/mosaic";

type OSDModule = typeof OpenSeadragon;

interface Picked {
  cell: number;
  row: number;
  col: number;
  source: MosaicSource;
}

const MIN_TILE_PX_TO_OPEN = 18;
const ctrlClass = "rounded-full border border-white/12 bg-black/55 text-white/85 backdrop-blur hover:bg-white/10 hover:text-white";

const noopSubscribe = () => () => {};
const fullscreenSupported = () => !!document.fullscreenEnabled;
const serverFalse = () => false;

export function MosaicExplorer() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const osdHostRef = useRef<HTMLDivElement>(null);
  const hoverBoxRef = useRef<HTMLDivElement>(null);
  const selectBoxRef = useRef<HTMLDivElement>(null);
  const osdRef = useRef<OSDModule | null>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const dataRef = useRef<MosaicData | null>(null);
  const hoverCellRef = useRef<number>(-1);
  const selectCellRef = useRef<number>(-1);

  const [mode, setMode] = useState<ModeKey>("all");
  const [data, setData] = useState<MosaicData | null>(null);
  const [report, setReport] = useState<MosaicReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [hovered, setHovered] = useState<Picked | null>(null);
  const [showHint, setShowHint] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen = useSyncExternalStore(noopSubscribe, fullscreenSupported, serverFalse);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [editions, setEditions] = useState<EditionsFile | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);

  const activeEdition: Edition | null =
    editions?.editions.find((e) => e.id === editionId) ?? editions?.editions[0] ?? null;
  const base = activeEdition
    ? editionBase(activeEdition, mode, editions?.current ?? null)
    : mode === "all" ? "/mosaic" : "/mosaic-canon";

  // ---------- geometry helpers (image px <-> screen px)

  const cellAt = useCallback((pos: OpenSeadragon.Point): Picked | null => {
    const viewer = viewerRef.current;
    const d = dataRef.current;
    if (!viewer || !d) return null;
    const p = viewer.viewport.viewerElementToImageCoordinates(pos);
    const col = Math.floor(p.x / d.tileW);
    const row = Math.floor(p.y / d.tileH);
    if (col < 0 || row < 0 || col >= d.cols || row >= d.rows) return null;
    const cell = row * d.cols + col;
    const source = d.sources[d.cells[cell]];
    if (!source) return null;
    return { cell, row, col, source };
  }, []);

  const tileScreenWidth = useCallback((): number => {
    const viewer = viewerRef.current;
    const OSD = osdRef.current;
    const d = dataRef.current;
    if (!viewer || !OSD || !d) return 0;
    const a = viewer.viewport.imageToViewerElementCoordinates(new OSD.Point(0, 0));
    const b = viewer.viewport.imageToViewerElementCoordinates(new OSD.Point(d.tileW, 0));
    return b.x - a.x;
  }, []);

  const placeBox = useCallback((el: HTMLDivElement | null, cell: number) => {
    const viewer = viewerRef.current;
    const OSD = osdRef.current;
    const d = dataRef.current;
    if (!el) return;
    if (!viewer || !OSD || !d || cell < 0 || tileScreenWidth() < MIN_TILE_PX_TO_OPEN) {
      el.style.opacity = "0";
      return;
    }
    const col = cell % d.cols;
    const row = Math.floor(cell / d.cols);
    const tl = viewer.viewport.imageToViewerElementCoordinates(new OSD.Point(col * d.tileW, row * d.tileH));
    const br = viewer.viewport.imageToViewerElementCoordinates(new OSD.Point((col + 1) * d.tileW, (row + 1) * d.tileH));
    el.style.opacity = "1";
    el.style.transform = `translate(${tl.x}px, ${tl.y}px)`;
    el.style.width = `${br.x - tl.x}px`;
    el.style.height = `${br.y - tl.y}px`;
  }, [tileScreenWidth]);

  const refreshBoxes = useCallback(() => {
    placeBox(hoverBoxRef.current, hoverCellRef.current);
    placeBox(selectBoxRef.current, selectCellRef.current);
  }, [placeBox]);

  // ---------- viewer setup (once)

  useEffect(() => {
    let destroyed = false;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    let tracker: OpenSeadragon.MouseTracker | null = null;


    import("openseadragon")
      .then((mod) => {
        if (destroyed || !osdHostRef.current) return;
        const OSD = (mod.default ?? mod) as OSDModule;
        osdRef.current = OSD;
        const options = {
          element: osdHostRef.current,
          showNavigationControl: false,
          showNavigator: true,
          navigatorPosition: "BOTTOM_RIGHT",
          navigatorSizeRatio: 0.16,
          navigatorAutoFade: false,
          navigatorBackground: "#050406",
          navigatorBorderColor: "#2a2428",
          navigatorDisplayRegionColor: "#D97757",
          maxZoomPixelRatio: 1.6,
          minZoomImageRatio: 0.85,
          visibilityRatio: 0.5,
          constrainDuringPan: true,
          animationTime: 0.9,
          springStiffness: 7.5,
          zoomPerScroll: 1.3,
          zoomPerClick: 2.4,
          blendTime: 0.15,
          imageLoaderLimit: 8,
          timeout: 60000,
          preserveImageSizeOnResize: true,
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
          gestureSettingsTouch: { clickToZoom: false, dblClickToZoom: true, pinchRotate: false, flickEnabled: true },
          gestureSettingsPen: { clickToZoom: false, dblClickToZoom: true },
        } as unknown as OpenSeadragon.Options;
        const viewer = OSD(options);
        viewerRef.current = viewer;

        viewer.addHandler("open", () => setStatus("ready"));
        viewer.addHandler("open-failed", (e) => {
          console.error("[mosaic] DZI open failed", e);
          setErrorMsg("The deep-zoom tiles could not be loaded.");
          setStatus("error");
        });
        viewer.addHandler("update-viewport", refreshBoxes);

        const dismissHint = () => setShowHint(false);
        viewer.addHandler("canvas-drag", dismissHint);
        viewer.addHandler("canvas-scroll", dismissHint);
        viewer.addHandler("canvas-pinch", dismissHint);

        viewer.addHandler("canvas-click", (e) => {
          const ev = e as OpenSeadragon.CanvasClickEvent;
          if (!ev.quick) return;
          ev.preventDefaultAction = true;
          const pos = ev.position;
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            clickTimer = null;
            const hit = cellAt(pos);
            if (!hit) return;
            setShowHint(false);
            if (tileScreenWidth() < MIN_TILE_PX_TO_OPEN) {
              viewer.viewport.zoomBy(3.2, viewer.viewport.pointFromPixel(pos));
              viewer.viewport.applyConstraints();
              return;
            }
            selectCellRef.current = hit.cell;
            refreshBoxes();
            setPhotoLoaded(false);
            setPicked(hit);
          }, 240);
        });
        viewer.addHandler("canvas-double-click", () => {
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = null;
          setShowHint(false);
        });

        tracker = new OSD.MouseTracker({
          element: viewer.canvas,
          moveHandler: (e: unknown) => {
            const ev = e as unknown as { position: OpenSeadragon.Point; pointerType?: string };
            if (ev.pointerType && ev.pointerType !== "mouse") return;
            const hit = cellAt(ev.position);
            const cell = hit && tileScreenWidth() >= MIN_TILE_PX_TO_OPEN ? hit.cell : -1;
            if (cell !== hoverCellRef.current) {
              hoverCellRef.current = cell;
              setHovered(cell >= 0 ? hit : null);
            }
            placeBox(hoverBoxRef.current, cell);
          },
          leaveHandler: () => {
            hoverCellRef.current = -1;
            setHovered(null);
            placeBox(hoverBoxRef.current, -1);
          },
        } as unknown as OpenSeadragon.MouseTrackerOptions);
      })
      .catch((err: unknown) => {
        console.error("[mosaic] failed to load OpenSeadragon", err);
        setErrorMsg("The viewer failed to start.");
        setStatus("error");
      });

    return () => {
      destroyed = true;
      if (clickTimer) clearTimeout(clickTimer);
      tracker?.destroy();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [cellAt, placeBox, refreshBoxes, tileScreenWidth]);

  // ---------- load edition registry
  useEffect(() => {
    let cancelled = false;
    fetch("/editions.json")
      .then((r) => {
        if (!r.ok) throw new Error(`editions.json HTTP ${r.status}`);
        return r.json();
      })
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseEditions(raw);
        setEditions(parsed);
        setEditionId(parsed.current ?? parsed.editions[0]?.id ?? null);
        // keep initial loading state until mosaic tiles open
      })
      .catch((err: unknown) => {
        console.error("[mosaic] editions.json missing; using live folders only", err);
        setEditions({ current: "live", editions: [{
          id: "live",
          filmId: "live",
          filmTitle: "Current",
          label: "Current",
          targets: { all: "", canon: "" },
          paths: { all: "/mosaic", canon: "/mosaic-canon" },
        }] });
        setEditionId("live");
      });
    return () => { cancelled = true; };
  }, []);

  // ---------- load mosaic data + tiles for the current mode

  useEffect(() => {
    let cancelled = false;
    if (!editionId) return;

    hoverCellRef.current = -1;
    selectCellRef.current = -1;

    Promise.all([
      fetch(`${base}/mosaic.json`).then((r) => {
        if (!r.ok) throw new Error(`mosaic.json HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`${base}/report.json`).then((r) => {
        if (!r.ok) throw new Error(`report.json HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([m, rep]) => {
        if (cancelled) return;
        const parsed = parseMosaic(m);
        dataRef.current = parsed;
        setData(parsed);
        setReport(parseReport(rep));
        const open = () => {
          const viewer = viewerRef.current;
          if (!viewer) {
            setTimeout(open, 60);
            return;
          }
          viewer.open(`${base}/dzi/mosaic.dzi` as unknown as OpenSeadragon.TileSourceSpecifier);
        };
        open();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[mosaic] failed to load mosaic data", err);
        setErrorMsg("The mosaic data could not be loaded.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [base, editionId]);

  // ---------- fullscreen

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((e: unknown) => console.error("[mosaic] exit fullscreen", e));
    } else {
      wrapperRef.current?.requestFullscreen().catch((e: unknown) => console.error("[mosaic] fullscreen", e));
    }
  };

  const changeMode = (k: ModeKey) => {
    if (k === mode) return;
    setStatus("loading");
    setPicked(null);
    setHovered(null);
    hoverCellRef.current = -1;
    selectCellRef.current = -1;
    refreshBoxes();
    setMode(k);
  };

  const changeEdition = (id: string) => {
    if (id === editionId) return;
    setStatus("loading");
    setPicked(null);
    setHovered(null);
    hoverCellRef.current = -1;
    selectCellRef.current = -1;
    refreshBoxes();
    setEditionId(id);
  };

  const zoomIn = useCallback(() => {
    setShowHint(false);
    viewerRef.current?.viewport.zoomBy(1.8).applyConstraints();
  }, []);
  const zoomOut = useCallback(() => {
    viewerRef.current?.viewport.zoomBy(1 / 1.8).applyConstraints();
  }, []);
  const home = useCallback(() => {
    viewerRef.current?.viewport.goHome();
  }, []);

  const closeDialog = (open: boolean) => {
    if (open) return;
    setPicked(null);
    selectCellRef.current = -1;
    refreshBoxes();
  };

  const placed = report?.unique_sources_placed ?? 0;
  const tiles = report?.total_tiles ?? 0;
  const pickedPhoto = picked ? galleryUrl(picked.source.m) : null;
  const pickedPage = picked ? galleryUrl(picked.source.page) : null;

  return (
    <div ref={wrapperRef} className="relative h-dvh w-full overflow-hidden bg-[#050406] text-[#eee8e2] select-none">
      {/* deep-zoom canvas */}
      <div ref={osdHostRef} className="absolute inset-0" aria-label="Zoomable photomosaic of Claudia made of real claudia.gallery photographs" />

      {/* tile outlines (screen-space, updated imperatively) */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div ref={hoverBoxRef} className="absolute top-0 left-0 opacity-0 ring-1 ring-white/70 shadow-[0_0_0_1px_rgba(0,0,0,.5)] transition-opacity duration-150" />
        <div ref={selectBoxRef} className="absolute top-0 left-0 opacity-0 ring-2 ring-[#D97757] transition-opacity duration-150" />
      </div>

      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/35 to-transparent px-3 pt-2.5 pb-8 sm:px-6 sm:pt-4 sm:pb-10">
        <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[12px] font-semibold tracking-[0.28em] sm:text-[13px]">
              CLAUDIA <span className="text-[#D97757]">✳</span> EVERY FRAME
            </h1>
            <span className="hidden text-[11px] tracking-wide text-white/45 md:inline">a real photomosaic</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editions && editions.editions.length > 0 && (
              <label className="flex items-center gap-1.5 rounded-full border border-white/12 bg-black/50 px-2.5 py-1 text-[11px] tracking-wide text-white/70 backdrop-blur">
                <span className="hidden text-white/40 sm:inline">Edition</span>
                <select
                  aria-label="Mosaic edition"
                  value={editionId ?? ""}
                  onChange={(e) => changeEdition(e.target.value)}
                  className="max-w-[11rem] cursor-pointer appearance-none bg-transparent font-medium text-white/90 outline-none sm:max-w-[14rem]"
                >
                  {editions.editions.map((ed) => (
                    <option key={ed.id} value={ed.id} className="bg-[#121014] text-white">
                      {ed.label}{ed.id === editions.current ? " · live" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div role="radiogroup" aria-label="Source photographs" className="flex rounded-full border border-white/12 bg-black/50 p-0.5 text-[11px] backdrop-blur">
              {(Object.keys(MODES) as ModeKey[]).map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={mode === k}
                  title={MODES[k].label}
                  onClick={() => changeMode(k)}
                  className={`rounded-full px-3 py-1.5 tracking-wide transition-colors ${
                    mode === k ? "bg-[#D97757] font-semibold text-[#1b1210]" : "text-white/70 hover:text-white"
                  }`}
                >
                  {MODES[k].short}
                </button>
              ))}
            </div>

            <a
              href={`${base}/claudia-mosaic-x.jpg`}
              download="claudia-mosaic-x.jpg"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-black/50 px-3 text-[11px] tracking-wide text-white/85 backdrop-blur transition-colors hover:border-white/30 hover:text-white"
              title={report ? `${report.x_resolution} · ${formatBytes(report.x_bytes)}` : "X-ready preview"}
            >
              <Download className="size-3.5" />
              X image
            </a>
            <a
              href={`${base}/claudia-mosaic-full.jpg`}
              download="claudia-mosaic-full.jpg"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-black/50 px-3 text-[11px] tracking-wide text-white/85 backdrop-blur transition-colors hover:border-white/30 hover:text-white"
              title={report ? `${report.full_resolution} px` : "Full-resolution master"}
            >
              <Download className="size-3.5" />
              Full{report ? <span className="hidden text-white/45 sm:inline"> · {formatBytes(report.full_bytes)}</span> : null}
            </a>
            {canFullscreen && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                className="rounded-full border border-white/12 bg-black/50 text-white/85 backdrop-blur hover:bg-white/10 hover:text-white"
              >
                {isFullscreen ? <Minimize /> : <Expand />}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* zoom controls */}
      <div className="absolute top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col gap-1.5 sm:right-5">
        <Button variant="ghost" size="icon" onClick={zoomIn} aria-label="Zoom in" title="Zoom in" className={ctrlClass}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" onClick={zoomOut} aria-label="Zoom out" title="Zoom out" className={ctrlClass}>
          <Minus />
        </Button>
        <Button variant="ghost" size="icon" onClick={home} aria-label="Fit portrait" title="Fit portrait" className={ctrlClass}>
          <Scan />
        </Button>
      </div>

      {/* bottom-left: counter + credit */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-4 pt-12 pb-3 sm:px-6 sm:pb-4">
        <div className="max-w-[calc(100%-10rem)] sm:max-w-none">
          <p className="font-mono text-[11px] tabular-nums tracking-wide text-white/80">
            {report ? (
              <>
                <span className="text-[#D97757]">{placed.toLocaleString()}</span> photographs ·{" "}
                {tiles.toLocaleString()} tiles
                <span className="hidden text-white/45 sm:inline"> · {report.full_resolution.replace("x", " × ")} px</span>
              </>
            ) : (
              <span className="text-white/45">counting photographs…</span>
            )}
          </p>
          {activeEdition?.homage && (
            <p className="mt-1 max-w-xl text-[10.5px] leading-snug tracking-wide text-white/40">
              {activeEdition.homage}
              {activeEdition.targets.all && activeEdition.targets.canon && activeEdition.targets.all !== activeEdition.targets.canon && (
                <span className="text-white/30"> · All & Film Canon use different homage stills</span>
              )}
            </p>
          )}
          <p className="pointer-events-auto mt-1 text-[10.5px] tracking-wide text-white/45">
            Claudia by anabology · photographs from{" "}
            <a href="https://claudia.gallery/" target="_blank" rel="noreferrer" className="underline decoration-white/25 underline-offset-2 hover:text-white/80">
              claudia.gallery
            </a>
          </p>
        </div>
      </footer>

      {/* hover caption */}
      {hovered && !picked && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-[11px] tracking-wide whitespace-nowrap text-white/85 backdrop-blur sm:bottom-6">
          {hovered.source.film_title ?? "Claudia"}
          {hovered.source.framing ? <span className="text-white/45"> · {hovered.source.framing}</span> : null}
          <span className="text-[#D97757]"> · click to open</span>
        </div>
      )}

      {/* first-visit hint */}
      {status === "ready" && showHint && !hovered && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-20 -translate-x-1/2 animate-in rounded-full border border-white/10 bg-black/60 px-4 py-2 text-[11px] tracking-wide whitespace-nowrap text-white/80 backdrop-blur fade-in duration-700 sm:bottom-6">
          Scroll or pinch to zoom · every tile is a real photograph
        </div>
      )}

      {/* loading / error */}
      {status !== "ready" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#050406]/85">
          {status === "loading" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="size-5 animate-spin text-[#D97757]" />
              <p className="text-[12px] tracking-[0.2em] text-white/70">ASSEMBLING {data ? data.cells.length.toLocaleString() : ""} PHOTOGRAPHS</p>
            </div>
          ) : (
            <div className="max-w-sm px-6 text-center">
              <p className="text-sm text-white/85">{errorMsg}</p>
              <p className="mt-2 text-xs text-white/50">Check your connection and reload. The full image can still be downloaded below.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reload</Button>
                <a className="inline-flex h-7 items-center rounded-lg border border-white/15 px-2.5 text-[0.8rem] hover:bg-white/10" href={`${base}/claudia-mosaic-x.jpg`}>Open X image</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* photo dialog */}
      <Dialog open={!!picked} onOpenChange={closeDialog}>
        <DialogContent className="w-[min(100vw-1.5rem,64rem)] max-w-none gap-0 overflow-hidden border-0 bg-[#0d0b0e] p-0 text-[#eee8e2] ring-white/10 sm:max-w-none">
          {picked && (
            <>
              <div className="relative flex min-h-[200px] items-center justify-center bg-black">
                {!photoLoaded && <Loader2 className="absolute size-5 animate-spin text-[#D97757]" />}
                {pickedPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={pickedPhoto}
                    src={pickedPhoto}
                    alt={`Claudia — ${picked.source.film_title ?? "claudia.gallery"} (${picked.source.id})`}
                    onLoad={() => setPhotoLoaded(true)}
                    onError={() => setPhotoLoaded(true)}
                    className={`max-h-[72dvh] w-auto max-w-full object-contain transition-opacity duration-300 ${photoLoaded ? "opacity-100" : "opacity-0"}`}
                  />
                )}
              </div>
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <DialogTitle className="text-[13px] font-semibold tracking-[0.18em]">
                    {picked.source.film_title ?? "CLAUDIA"}
                  </DialogTitle>
                  <DialogDescription className="mt-1.5 text-[12px] leading-relaxed text-white/55">
                    {[picked.source.look, picked.source.framing].filter(Boolean).join(" · ")}
                    {picked.source.plate ? <span className="text-[#D97757]"> · in the finished film</span> : null}
                    <br />
                    <span className="font-mono text-[11px] text-white/40">
                      {picked.source.id} · row {picked.row + 1}, col {picked.col + 1} · used {picked.source.uses}× in this mosaic
                    </span>
                  </DialogDescription>
                </div>
                {pickedPage && (
                  <a
                    href={pickedPage}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full bg-[#D97757] px-3.5 text-[12px] font-semibold text-[#1b1210] transition-opacity hover:opacity-90 sm:self-auto"
                  >
                    Open on claudia.gallery <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
