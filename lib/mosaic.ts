// Shared types + config for the generated mosaic files in /public.
// The Python pipeline (pipeline/build_mosaic.py) writes mosaic.json,
// report.json, the two JPEGs and the DZI pyramid into each mode folder.

export const GALLERY = "https://claudia.gallery";

export type ModeKey = "all" | "canon";

export interface ModeConfig {
  key: ModeKey;
  label: string;
  short: string;
  base: string;
}

export const MODES: Record<ModeKey, ModeConfig> = {
  all: { key: "all", label: "Every Claudia image", short: "All", base: "/mosaic" },
  canon: { key: "canon", label: "Film Canon (in the finished films)", short: "Film Canon", base: "/mosaic-canon" },
};

export interface MosaicSource {
  id: string;
  film: string | null;
  film_title: string | null;
  framing: string | null;
  look: string | null;
  plate: boolean | null;
  s: string;
  m: string;
  full: string;
  page: string | null;
  uses: number;
}

export interface MosaicData {
  title: string;
  credit: string;
  mode: string;
  target: { id: string; page: string | null; m: string };
  width: number;
  height: number;
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  cells: number[];
  sources: MosaicSource[];
}

export interface MosaicReport {
  eligible_in_gallery: number;
  sources_loaded: number;
  unique_sources_placed: number;
  total_tiles: number;
  full_resolution: string;
  full_bytes: number;
  x_resolution: string;
  x_bytes: number;
  failures: Record<string, string>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parseMosaic(raw: unknown): MosaicData {
  if (!isObject(raw)) throw new Error("mosaic.json is not an object");
  const { width, height, cols, rows, tileW, tileH, cells, sources } = raw;
  if (
    typeof width !== "number" || typeof height !== "number" ||
    typeof cols !== "number" || typeof rows !== "number" ||
    typeof tileW !== "number" || typeof tileH !== "number" ||
    !Array.isArray(cells) || !Array.isArray(sources)
  ) {
    throw new Error("mosaic.json is missing grid fields");
  }
  if (cells.length !== cols * rows) throw new Error("mosaic.json cell count does not match the grid");
  return raw as unknown as MosaicData;
}

export function parseReport(raw: unknown): MosaicReport {
  if (!isObject(raw) || typeof raw.unique_sources_placed !== "number" || typeof raw.total_tiles !== "number") {
    throw new Error("report.json is missing counts");
  }
  return raw as unknown as MosaicReport;
}

export function formatBytes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function galleryUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : GALLERY + path;
}
