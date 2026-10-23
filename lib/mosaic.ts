// Shared types + config for the generated mosaic files in /public.
// The Python pipeline writes mosaic.json, report.json, the two JPEGs and
// the DZI pyramid. Editions (per-film homage generations) live in
// public/editions.json + public/archives/<id>/.

export const GALLERY = "https://claudia.gallery";

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

export interface MosaicRules {
  every_photo_at_least_once: boolean;
  max_uses_per_photo: number;
  label: string;
}

export interface MosaicData {
  title: string;
  credit: string;
  mode: string;
  target: { id: string; page: string | null; m: string };
  rules?: MosaicRules;
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
  max_uses_per_source?: number;
  min_uses_per_source?: number;
  rules?: MosaicRules;
  full_resolution: string;
  full_bytes: number;
  x_resolution: string;
  x_bytes: number;
  failures: Record<string, string>;
  target?: string;
}

/** House rules shown on the site — hard caps the mosaic builder also enforces. */
export const HOUSE_RULES_LABEL = "every photograph once · none reused";

export interface Edition {
  id: string;
  filmId: string;
  filmTitle: string;
  label: string;
  released?: string | null;
  createdAt?: string;
  homage?: string;
  /** Homage still id (All / her===true). Legacy `targets.canon` may still exist in JSON. */
  targets: { all: string; canon?: string };
  paths: { all: string; canon?: string };
  counts?: {
    allUnique?: number;
    allTiles?: number;
    canonUnique?: number;
    canonTiles?: number;
  };
  note?: string;
}

export interface EditionsFile {
  current: string | null;
  knownFilms?: string[];
  editions: Edition[];
}

/** Live folder for the current edition (always rebuilt in place). */
export const LIVE_PATH = "/mosaic";

export function editionBase(edition: Edition, currentId: string | null): string {
  if (edition.id === currentId) return LIVE_PATH;
  return edition.paths.all || LIVE_PATH;
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

export function parseEditions(raw: unknown): EditionsFile {
  if (!isObject(raw) || !Array.isArray(raw.editions)) {
    throw new Error("editions.json is invalid");
  }
  return {
    current: typeof raw.current === "string" ? raw.current : null,
    editions: raw.editions as Edition[],
  };
}

export function formatBytes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function galleryUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : GALLERY + path;
}
