// The hang. Every edition is on the wall at once — nothing scrolls.
// Copper edges, the same mark as the mosaic. The tint is said once.

import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import { readFileSync } from "node:fs";
import path from "node:path";
import editionsFile from "@/public/editions.json";
import { editionBase, tintPercents, type Edition, type MosaicReport } from "@/lib/mosaic";

const display = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Mosaic gallery — Claudia, Every Frame",
  description: "Every Claudia mosaic, hung together.",
};

type EditionsJson = {
  current: string | null;
  editions: Edition[];
};

type Tint = { light: number; color: number; overlay: number };

const data = editionsFile as EditionsJson;

function tintFor(edition: Edition, current: string | null): Tint | null {
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

function plaque(label: string): string {
  const small = new Set(["a", "an", "and", "is", "not", "of", "the"]);
  return label
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && small.has(word)) return word;
      return word.replace(/^\S/, (letter) => letter.toUpperCase());
    })
    .join(" ");
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
    <main className={`${display.className} fixed inset-0 flex flex-col overflow-hidden bg-[#070605] text-[#f4efe6]`}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 62% 48% at 50% 44%, rgba(217,119,87,0.13), transparent 70%), radial-gradient(ellipse 90% 70% at 50% 110%, rgba(0,0,0,0.5), transparent 46%), radial-gradient(ellipse 80% 40% at 50% -10%, rgba(0,0,0,0.45), transparent 50%)",
        }}
      />

      <header className="relative z-10 flex shrink-0 items-end justify-between px-5 pt-4 pb-1 sm:px-8 sm:pt-6">
        <div>
          <h1 className="text-[28px] leading-none font-medium italic tracking-tight text-[#f6f0e6] sm:text-[34px]">
            <span className="mr-1.5 font-sans text-[0.62em] not-italic text-[#D97757]">✳</span>
            Mosaic gallery
          </h1>
          <p className="mt-1 font-sans text-[11px] tracking-wide text-[#f4efe6]/48">
            Every photograph of her, once.
          </p>
        </div>
        <Link
          href="/"
          className="mb-1 font-sans text-[11px] tracking-[0.18em] text-[#f4efe6]/45 uppercase transition-colors duration-300 hover:text-[#E8A090]"
        >
          Enter
        </Link>
      </header>

      <style>{`
        .gallery-wall {
          flex: 1;
          height: 100%;
          grid-template-columns: repeat(${narrow.cols}, minmax(0, 1fr));
          grid-template-rows: repeat(${narrow.rows}, minmax(0, 1fr));
        }
        .gallery-card { height: 100%; justify-content: center; }
        .gallery-print { max-height: calc(100% - 1.7rem); width: auto; max-width: 100%; }
        @media (min-width: 900px) {
          .gallery-wall {
            flex: none;
            height: auto;
            grid-template-columns: repeat(${wide.cols}, minmax(0, 1fr));
            grid-template-rows: repeat(${wide.rows}, auto);
            align-items: end;
          }
          .gallery-card { height: auto; justify-content: flex-end; }
          .gallery-print { max-height: none; width: 100%; height: auto; }
        }
      `}</style>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center">
        <section className="gallery-wall grid min-h-0 w-full content-center gap-x-4 gap-y-4 px-5 sm:gap-x-7 sm:px-10">
          {editions.map((edition, index) => {
            const src = `${editionBase(edition, current)}/claudia-mosaic-x.jpg`;
            const live = edition.id === current;
            const tint = shared ? null : tints[index];
            const frame = live
              ? "shadow-[0_0_0_1px_#140c09,0_0_0_2px_#D97757,0_0_28px_-4px_rgba(217,119,87,0.45),0_18px_36px_-14px_rgba(0,0,0,0.9)]"
              : "shadow-[0_0_0_1px_#140c09,0_0_0_2px_#7a5344,0_18px_36px_-14px_rgba(0,0,0,0.85)] group-hover:shadow-[0_0_0_1px_#140c09,0_0_0_2px_#D97757,0_0_22px_-4px_rgba(217,119,87,0.4),0_22px_40px_-12px_rgba(0,0,0,0.9)]";
            return (
              <Link
                key={edition.id}
                href={`/view/${edition.id}`}
                className="gallery-card group flex min-h-0 min-w-0 flex-col items-center"
              >
                <img
                  src={src}
                  alt=""
                  className={`gallery-print object-contain transition-shadow duration-500 ${frame}`}
                />
                <p
                  className={`mt-2 max-w-full shrink-0 truncate text-center text-[clamp(14px,1.35vw,20px)] leading-none font-medium italic transition-colors duration-500 group-hover:text-[#f6f0e6] ${
                    live ? "text-[#E8A090]" : "text-[#f3e6d4]/88"
                  }`}
                >
                  {plaque(edition.label)}
                </p>
                {tint ? (
                  <p className="mt-0.5 max-w-full shrink-0 text-center font-sans text-[8px] text-[#f4efe6]/40">
                    {tint.light}% light · {tint.color}% color · {tint.overlay}% overlay
                  </p>
                ) : null}
              </Link>
            );
          })}
        </section>

        <p className="shrink-0 px-6 pt-5 pb-5 text-center font-sans text-[11px] leading-relaxed text-[#f4efe6]/36 sm:pt-7">
          {shared
            ? `Each photograph leans toward the portrait behind it — ${shared.light}% of its light, ${shared.color}% of its color, ${shared.overlay}% of the portrait laid on top.`
            : "Each photograph leans toward the portrait behind it."}
        </p>
      </div>
    </main>
  );
}
