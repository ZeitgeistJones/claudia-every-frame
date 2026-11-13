// Museum wall. Every edition hangs in one viewport — nothing scrolls.

import type { Metadata } from "next";
import Link from "next/link";
import editionsFile from "@/public/editions.json";
import { editionBase, type Edition } from "@/lib/mosaic";

export const metadata: Metadata = {
  title: "Gallery — Claudia, Every Frame",
  description: "Every Claudia mosaic, hung together.",
};

type EditionsJson = {
  current: string | null;
  editions: Edition[];
};

const data = editionsFile as EditionsJson;

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

  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-[#14110f] text-[#f3efe6]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 18%, rgba(255,236,206,0.14), transparent 46%), radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.45), transparent 55%)",
        }}
      />
      <header className="relative z-10 flex shrink-0 items-baseline justify-between px-3 pt-2 pb-1 sm:px-5 sm:pt-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[11px] font-medium tracking-[0.32em] sm:text-[12px]">THE GALLERY</h1>
          <p className="hidden text-[10px] tracking-[0.16em] text-[#f3efe6]/45 sm:block">
            Claudia · every frame
          </p>
        </div>
        <Link
          href="/"
          className="text-[10px] tracking-[0.2em] text-[#f3efe6]/60 underline decoration-[#f3efe6]/20 underline-offset-2 hover:text-[#f3efe6]"
        >
          ENTER
        </Link>
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
        {editions.map((edition) => {
          const src = `${editionBase(edition, current)}/claudia-mosaic-x.jpg`;
          const live = edition.id === current;
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
            </Link>
          );
        })}
      </section>
    </main>
  );
}
