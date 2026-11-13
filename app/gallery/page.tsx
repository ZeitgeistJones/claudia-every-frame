// Museum wall. Every edition hangs in one viewport — nothing scrolls.

import type { Metadata } from "next";
import Link from "next/link";
import { readFileSync } from "node:fs";
import path from "node:path";
import editionsFile from "@/public/editions.json";
import { editionBase, tintPercents, type Edition, type MosaicReport } from "@/lib/mosaic";

export const metadata: Metadata = {
  title: "Gallery — Claudia, Every Frame",
  description: "Every Claudia mosaic, hung together.",
};

type EditionsJson = {
  current: string | null;
  editions: Edition[];
};

const data = editionsFile as EditionsJson;

function tintFor(edition: Edition, current: string | null) {
  const base = editionBase(edition, current).replace(/^\//, "");
  try {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "public", base, "report.json"), "utf8"),
    ) as MosaicReport;
    return tintPercents(raw.params);
  } catch (err) {
    console.error("[gallery] tint missing", edition.id, err);
    return null;
  }
}

function wallShape(count: number, targetAspect: number): { cols: number; rows: number } {
  if (count < 1) return { cols: 1, rows: 1 };
  let best = { cols: 1, rows: count, score: Number.POSITIVE_INFINITY };
  for (let rows = 1; rows <= count; rows++) {
    const cols = Math.ceil(count / rows);
    const waste = cols * rows - count;
    const aspect = cols / rows;
    const score = Math.abs(Math.log(aspect / targetAspect)) + waste * 0.08;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

export default function GalleryPage() {
  const editions = data.editions;
  const current = data.current;
  const wide = wallShape(editions.length, 2.3);
  const narrow = wallShape(editions.length, 0.5);
  const tints = editions.map((edition) => tintFor(edition, current));
  const first = tints.find((tint) => tint);
  const shared =
    first &&
    tints.every(
      (tint) =>
        tint &&
        tint.light === first.light &&
        tint.color === first.color &&
        tint.overlay === first.overlay,
    )
      ? first
      : null;

  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-[#14110f] text-[#f3efe6]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 18%, rgba(255,236,206,0.14), transparent 46%), radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.45), transparent 55%)",
        }}
      />
      <header className="relative z-10 shrink-0 px-3 pt-2 pb-1 sm:px-5 sm:pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[11px] font-medium tracking-[0.32em] sm:text-[12px]">THE GALLERY</h1>
          <Link
            href="/"
            className="text-[10px] tracking-[0.2em] text-[#f3efe6]/60 underline decoration-[#f3efe6]/20 underline-offset-2 hover:text-[#f3efe6]"
          >
            ENTER
          </Link>
        </div>
        <p className="mt-0.5 text-[9px] leading-tight tracking-[0.08em] text-[#f3efe6]/45 sm:text-[10px]">
          Each photo is tinted toward the portrait behind it
          {shared
            ? ` — ${shared.light}% light, ${shared.color}% color, ${shared.overlay}% overlay`
            : ""}
        </p>
      </header>

      <style>{`
        .gallery-wall {
          grid-template-columns: repeat(${narrow.cols}, minmax(0, 1fr));
          grid-template-rows: repeat(${narrow.rows}, minmax(0, 1fr));
        }
        @media (min-width: 900px) {
          .gallery-wall {
            grid-template-columns: repeat(${wide.cols}, minmax(0, 1fr));
            grid-template-rows: repeat(${wide.rows}, minmax(0, 1fr));
          }
        }
      `}</style>

      <section className="gallery-wall relative z-10 grid min-h-0 flex-1 gap-x-2 gap-y-1 px-2 pb-2 sm:gap-x-3 sm:px-4 sm:pb-3">
        {editions.map((edition, index) => {
          const src = `${editionBase(edition, current)}/claudia-mosaic-x.jpg`;
          const live = edition.id === current;
          const tint = shared ? null : tints[index];
          return (
            <Link
              key={edition.id}
              href={`/view/${edition.id}`}
              className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center px-1"
            >
              <div className="flex min-h-0 w-full flex-1 items-center justify-center p-[clamp(6px,0.8vw,14px)]">
                <img
                  src={src}
                  alt=""
                  className="max-h-full max-w-full object-contain shadow-[0_0_0_clamp(3px,0.35vw,7px)_#f4efe4,0_0_0_clamp(5px,0.55vw,11px)_#e4c98a,0_0_0_clamp(7px,0.75vw,14px)_#6a4a28,0_10px_18px_rgba(0,0,0,0.5)]"
                />
              </div>
              <p className="mb-1 max-w-full shrink-0 text-center text-[clamp(8px,1.05vw,12px)] leading-tight tracking-[0.08em] text-[#f3efe6]/85">
                {live ? <span className="mr-1 text-[#e2b657]">●</span> : null}
                {edition.label}
              </p>
              {tint ? (
                <p className="mb-1 max-w-full shrink-0 text-center text-[clamp(7px,0.85vw,10px)] leading-tight text-[#f3efe6]/45">
                  {tint.light}% light · {tint.color}% color · {tint.overlay}% overlay
                </p>
              ) : null}
            </Link>
          );
        })}
      </section>
    </main>
  );
}
