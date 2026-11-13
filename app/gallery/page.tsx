// The hang. Every edition is on the wall at once — nothing scrolls.
// Each song's name is set in that film's voice. The tint is said once.

import type { Metadata } from "next";
import Link from "next/link";
import {
  Cinzel,
  Fraunces,
  Fredoka,
  IBM_Plex_Mono,
  Italiana,
  Josefin_Sans,
  Lora,
  Oswald,
  Outfit,
} from "next/font/google";
import { readFileSync } from "node:fs";
import path from "node:path";
import editionsFile from "@/public/editions.json";
import { editionBase, tintPercents, type Edition, type MosaicReport } from "@/lib/mosaic";

const display = Fraunces({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });
const aeroFace = Josefin_Sans({ subsets: ["latin"], weight: ["300"] });
const cakeFace = Fredoka({ subsets: ["latin"], weight: ["500"] });
const whitepillFace = Italiana({ subsets: ["latin"], weight: "400" });
const scrollFace = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"] });
const downforceFace = Oswald({ subsets: ["latin"], weight: ["500"] });
const airplaneFace = Outfit({ subsets: ["latin"], weight: ["300"] });
const blissFace = Lora({ subsets: ["latin"], weight: ["500"], style: ["italic"] });
const clodysseyFace = Cinzel({ subsets: ["latin"], weight: ["500"] });

type Voice = {
  fontClass: string;
  label: string;
  name: string;
  edge: string;
  glow: string;
  soft: string;
  flaps?: string[];
  words?: { text: string; color: string }[];
};

function tone(edge: string, glow: string, soft: string): Pick<Voice, "edge" | "glow" | "soft"> {
  return { edge, glow, soft };
}

const voices: Record<string, Voice> = {
  fable: {
    fontClass: display.className,
    label: "Fable",
    name: "text-[17px] italic text-[#E8A090] sm:text-[22px]",
    ...tone("#a86850", "#E8A090", "rgba(217,119,87,0.55)"),
  },
  aero: {
    fontClass: aeroFace.className,
    label: "AERO",
    name: "text-[13px] font-light tracking-[0.34em] text-[#d7e6ee] sm:text-[15px]",
    ...tone("#6a8490", "#d7e6ee", "rgba(186,214,224,0.5)"),
  },
  "the-cake-is-not-a-lie": {
    fontClass: cakeFace.className,
    label: "the cake is not a lie",
    name: "text-[12px] tracking-tight text-[#f3b4c6] sm:text-[15px]",
    ...tone("#a86a7c", "#f3b4c6", "rgba(243,180,198,0.5)"),
  },
  whitepill: {
    fontClass: whitepillFace.className,
    label: "Whitepill",
    name: "text-[15px] tracking-[0.14em] text-[#f7f4ef] sm:text-[20px]",
    ...tone("#cfc8be", "#f7f4ef", "rgba(247,244,239,0.4)"),
  },
  "dont-let-me-scroll": {
    fontClass: scrollFace.className,
    label: "don't let me scroll",
    name: "text-[10px] tracking-tight sm:text-[12px]",
    words: [
      { text: "don't", color: "#f7f5f2" },
      { text: "let", color: "#ffe14a" },
      { text: "me", color: "#3dce7a" },
      { text: "scroll", color: "#ff4f9a" },
    ],
    ...tone("#8a4060", "#ff4f9a", "rgba(255,79,154,0.4)"),
  },
  downforce: {
    fontClass: downforceFace.className,
    label: "DOWNFORCE",
    name: "text-[15px] tracking-[0.08em] text-[#f4f6f8] sm:text-[20px]",
    ...tone("#9aa3ab", "#f4f6f8", "rgba(244,246,248,0.4)"),
  },
  "airplane-mode": {
    fontClass: airplaneFace.className,
    label: "Airplane mode",
    name: "text-[12px] font-light tracking-[0.08em] sm:text-[15px]",
    words: [
      { text: "Airplane", color: "#f7f5f2" },
      { text: "mode", color: "#ff9a45" },
    ],
    ...tone("#e08a4a", "#ff9a45", "rgba(255,154,69,0.45)"),
  },
  bliss: {
    fontClass: blissFace.className,
    label: "bliss",
    name: "text-[16px] italic text-[#a9d4f2] sm:text-[22px]",
    ...tone("#6a90aa", "#a9d4f2", "rgba(169,212,242,0.5)"),
  },
  clodyssey: {
    fontClass: clodysseyFace.className,
    label: "CLODYSSEY",
    name: "text-[11px] tracking-[0.18em] text-[#d5deea] sm:text-[13px]",
    ...tone("#7e8ea0", "#d5deea", "rgba(190,210,230,0.5)"),
  },
  "escape-velocity": {
    fontClass: display.className,
    label: "Escape velocity",
    name: "",
    flaps: ["ESCAPE", "VELOCITY"],
    ...tone("#5c6a78", "#9aabba", "rgba(154,171,186,0.4)"),
  },
};

const fallbackVoice: Voice = {
  fontClass: display.className,
  label: "",
  name: "text-[15px] italic text-[#f3e6d4] sm:text-[18px]",
  ...tone("#7a5344", "#E8A090", "rgba(217,119,87,0.45)"),
};

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
        .flaps { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: 6px; }
        .flap-row { display: flex; gap: 2px; }
        .flap {
          position: relative;
          display: grid;
          place-items: center;
          width: clamp(11px, 1.15vw, 16px);
          height: clamp(15px, 1.55vw, 22px);
          border-radius: 1px;
          background: linear-gradient(#f7f4ee 0 50%, #e6e1d6 50% 100%);
          color: #161411;
          font-family: var(--font-sans), "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-weight: 700;
          font-size: clamp(8px, 0.9vw, 11px);
          line-height: 1;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 0 rgba(0,0,0,0.45);
        }
        .flap::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: calc(50% - 0.5px);
          height: 1px;
          background: rgba(22, 20, 17, 0.28);
        }
        .gallery-print {
          max-height: calc(100% - 2.5rem);
          width: auto;
          max-width: 100%;
          box-shadow: 0 0 0 1px #140c09, 0 0 0 2px var(--edge), 0 18px 36px -14px rgba(0,0,0,0.85);
          transition: box-shadow 0.5s ease;
        }
        .group:hover .gallery-print,
        .gallery-print[data-live="true"] {
          box-shadow: 0 0 0 1px #140c09, 0 0 0 2px var(--glow), 0 0 22px -4px var(--soft), 0 18px 36px -14px rgba(0,0,0,0.9);
        }
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
            const voice = voices[edition.id] ?? { ...fallbackVoice, label: edition.label };
            return (
              <Link
                key={edition.id}
                href={`/view/${edition.id}`}
                className="gallery-card group flex min-h-0 min-w-0 flex-col items-center"
              >
                <img
                  src={src}
                  alt=""
                  data-live={live ? "true" : undefined}
                  style={{ ["--edge" as string]: voice.edge, ["--glow" as string]: voice.glow, ["--soft" as string]: voice.soft }}
                  className="gallery-print object-contain"
                />
                {voice.flaps ? (
                  <span className="flaps" aria-label={voice.label}>
                    {voice.flaps.map((word) => (
                      <span className="flap-row" key={word}>
                        {[...word].map((letter, letterIndex) => (
                          <span className="flap" aria-hidden="true" key={`${word}-${letterIndex}`}>
                            {letter}
                          </span>
                        ))}
                      </span>
                    ))}
                  </span>
                ) : voice.words ? (
                  <p className={`${voice.fontClass} mt-2 max-w-full shrink-0 text-center leading-none whitespace-nowrap ${voice.name}`}>
                    {voice.words.map((word, wordIndex) => (
                      <span key={word.text} style={{ color: word.color }}>
                        {wordIndex > 0 ? " " : ""}
                        {word.text}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p
                    style={{ color: voice.glow }}
                    className={`${voice.fontClass} mt-2 max-w-full shrink-0 text-center leading-none whitespace-nowrap ${voice.name}`}
                  >
                    {voice.label}
                  </p>
                )}
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
