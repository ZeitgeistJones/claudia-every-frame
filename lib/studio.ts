// Studio: prompt → Claudia-related + appropriate filter → 1× browser mosaic → share link.
// Official editions stay in the deep-zoom explorer; Studio is the participatory layer.

import { GALLERY, type ModeKey } from "@/lib/mosaic";

export const STUDIO_RULES_LABEL = "every photograph once · none reused";

export interface CatalogItem {
  id: string;
  film: string | null;
  film_title: string | null;
  framing: string | null;
  look: string | null;
  plate: boolean;
  s: string;
  m: string;
  page: string | null;
  lab: [number, number, number];
}

export interface StudioCatalog {
  version: number;
  gallery: string;
  rules: { every_photo_at_least_once: boolean; max_uses_per_photo: number; label: string };
  count: number;
  items: CatalogItem[];
}

export interface PromptVerdict {
  ok: boolean;
  reason: string;
  cleanedPrompt?: string;
  themeTags?: string[];
}

export interface ShareParams {
  prompt: string;
  target: string;
  mode: ModeKey;
  seed: number;
}

const BLOCK =
  /\b(nsfw|nude|naked|porn|sex|sexual|explicit|gore|blood|kill|murder|rape|slur|hate|racist|nazi|suicide|self[- ]?harm)\b/i;

const CLAUDIA_HINT =
  /\b(claudia|\$claudia|anabology|claudia\.gallery|escape velocity|clodyssey|bliss|airplane mode|downforce|don'?t let me scroll|film|portrait|homage|still|lookbook)\b/i;

/** Fast offline filter used when AI Gateway is unavailable. */
export function heuristicPromptFilter(raw: string): PromptVerdict {
  const prompt = raw.trim().replace(/\s+/g, " ").slice(0, 280);
  if (prompt.length < 3) {
    return { ok: false, reason: "Say a little more — what Claudia moment should the mosaic become?" };
  }
  if (BLOCK.test(prompt)) {
    return { ok: false, reason: "That prompt isn’t appropriate for this studio. Keep it Claudia-related and clean." };
  }
  // Must clearly be about Claudia / the films / a portrait homage.
  if (!CLAUDIA_HINT.test(prompt) && !/\b(her face|her look|close[- ]?up|portrait of her)\b/i.test(prompt)) {
    return {
      ok: false,
      reason: "Keep it Claudia-related — name her, a film, or a portrait/homage idea from the archive.",
    };
  }
  return {
    ok: true,
    reason: "Looks good.",
    cleanedPrompt: prompt,
    themeTags: extractTags(prompt),
  };
}

function extractTags(prompt: string): string[] {
  const tags: string[] = [];
  const lower = prompt.toLowerCase();
  for (const [re, tag] of [
    [/\bcu\b|close[- ]?up|face/, "CU"],
    [/\becu\b|eyes?/, "ECU"],
    [/night|neon|city/, "night"],
    [/smile|laugh|joy|bliss/, "warm"],
    [/serious|stoic|cold|distant/, "cool"],
    [/scroll|phone|screen/, "dont-let-me-scroll"],
    [/plane|flight|airplane/, "airplane-mode"],
    [/race|car|downforce|speed/, "downforce"],
    [/space|orbit|escape|velocity/, "escape-velocity"],
    [/odyssey|clodyssey/, "clodyssey"],
  ] as const) {
    if (re.test(lower)) tags.push(tag);
  }
  return tags;
}

export function scoreTarget(item: CatalogItem, tags: string[], prompt: string): number {
  let s = 0;
  const p = prompt.toLowerCase();
  const framing = (item.framing || "").toUpperCase();
  if (framing === "ECU") s += 40;
  else if (framing === "CU") s += 35;
  else if (framing === "MCU") s += 15;
  if (item.plate) s += 8;
  if (item.film && (tags.includes(item.film) || p.includes(item.film.replace(/-/g, " ")))) s += 50;
  if (item.film_title && p.includes(item.film_title.toLowerCase())) s += 45;
  if (tags.includes("CU") && (framing === "CU" || framing === "ECU")) s += 20;
  if (tags.includes("ECU") && framing === "ECU") s += 25;
  if (tags.includes("warm") && (item.lab[0] > 55 || item.lab[1] > 5)) s += 10;
  if (tags.includes("cool") && item.lab[0] < 45) s += 10;
  // Slight preference for front-facing look names when prompt asks for portrait.
  if (/\bportrait|face|looking\b/i.test(prompt) && framing === "CU") s += 12;
  return s;
}

export function pickTarget(items: CatalogItem[], mode: ModeKey, prompt: string, tags: string[], seed: number): CatalogItem {
  const pool = mode === "canon" ? items.filter((i) => i.plate) : items;
  if (!pool.length) throw new Error("No photographs available for this mode");
  const ranked = [...pool].sort((a, b) => {
    const d = scoreTarget(b, tags, prompt) - scoreTarget(a, tags, prompt);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  // Among the top tier, pick deterministically from seed so shares stay stable.
  const topScore = scoreTarget(ranked[0], tags, prompt);
  const top = ranked.filter((i) => scoreTarget(i, tags, prompt) >= topScore - 5);
  return top[Math.abs(seed) % top.length];
}

/**
 * Near-square grid for 1×. Prefers exact factorisation with a sane aspect;
 * otherwise allows a few empty cells (same idea as the official builder).
 */
export function factorGrid(n: number): { cols: number; rows: number } {
  const prefAspect = 1;
  let bestExact: { score: number; cols: number; rows: number } | null = null;
  for (let a = 1; a * a <= n; a++) {
    if (n % a) continue;
    const b = n / a;
    for (const [cols, rows] of [
      [a, b],
      [b, a],
    ] as const) {
      const aspect = cols / rows;
      if (aspect < 0.55 || aspect > 1.85) continue;
      const score = Math.abs(aspect - prefAspect) * 10 + Math.abs(cols - rows);
      if (!bestExact || score < bestExact.score) bestExact = { score, cols, rows };
    }
  }
  if (bestExact) return { cols: bestExact.cols, rows: bestExact.rows };

  const root = Math.max(1, Math.floor(Math.sqrt(n)));
  let best = { waste: Infinity, score: Infinity, cols: n, rows: 1 };
  for (let rows = Math.max(1, root - 40); rows <= root + 80; rows++) {
    const cols = Math.ceil(n / rows);
    const cells = cols * rows;
    if (cells < n) continue;
    const aspect = cols / rows;
    if (aspect < 0.65 || aspect > 1.55) continue;
    const waste = cells - n;
    const score = waste * 100 + Math.abs(aspect - prefAspect) * 10 + Math.abs(cols - rows);
    if (score < best.score) best = { waste, score, cols, rows };
  }
  return { cols: best.cols, rows: best.rows };
}

export function encodeShare(params: ShareParams): string {
  const q = new URLSearchParams({
    p: params.prompt,
    t: params.target,
    m: params.mode,
    s: String(params.seed),
  });
  return `/studio?${q.toString()}`;
}

export function decodeShare(search: string): Partial<ShareParams> {
  const q = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const prompt = q.get("p") || undefined;
  const target = q.get("t") || undefined;
  const mode = q.get("m") === "canon" ? "canon" : q.get("m") === "all" ? "all" : undefined;
  const seedRaw = q.get("s");
  const seed = seedRaw != null && seedRaw !== "" ? Number(seedRaw) : undefined;
  return {
    prompt,
    target,
    mode,
    seed: Number.isFinite(seed) ? seed : undefined,
  };
}

export function galleryAsset(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : GALLERY + path;
}

/**
 * Greedy 1× assignment: each source used exactly once.
 * When cells > sources, leftover cells stay empty (-1).
 */
export function assignOnce(
  cellLabs: Array<[number, number, number]>,
  sources: CatalogItem[],
): number[] {
  const m = cellLabs.length;
  const n = sources.length;
  if (m < n) throw new Error("grid smaller than source count");
  const used = new Uint8Array(n);
  const out = new Array<number>(m).fill(-1);
  // Fill the most distinctive cells first (higher chroma / mid luminance).
  const order = cellLabs
    .map((lab, i) => ({ i, key: Math.abs(lab[1]) + Math.abs(lab[2]) + (50 - Math.abs(lab[0] - 50)) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.i);
  let placed = 0;
  for (const c of order) {
    if (placed >= n) break;
    const [L, a, b] = cellLabs[c];
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const [sL, sa, sb] = sources[i].lab;
      const d = (L - sL) ** 2 + 0.6 * (a - sa) ** 2 + 0.6 * (b - sb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    used[best] = 1;
    out[c] = best;
    placed++;
  }
  return out;
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
