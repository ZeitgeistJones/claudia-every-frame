// Checks whether claudia.gallery has a film that does not yet have a mosaic edition.
// Does NOT rebuild the mosaic (too heavy for Vercel Hobby). Returns JSON that a
// human / CI / cloud agent can use to decide when to run pipeline/update_mosaic.py.
//
// Protect with CRON_SECRET:
//   Authorization: Bearer <CRON_SECRET>
//   or ?key=<CRON_SECRET>

import { NextResponse } from "next/server";

// No `runtime` / `dynamic` segment exports — incompatible with cacheComponents.
// Reading the Request already keeps this route dynamic.

const GALLERY = "https://claudia.gallery";

interface Film {
  id: string;
  title?: string;
  released?: string;
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured yet — allow in development only.
    return process.env.NODE_ENV !== "production";
  }
  const header = req.headers.get("authorization") || "";
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  if (header === `Bearer ${secret}`) return true;
  // Also accept x-vercel-cron (present on cron invocations)
  if (req.headers.get("x-vercel-cron") === "1" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length) === secret;
  }
  const url = new URL(req.url);
  return url.searchParams.get("key") === secret;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const [filmsRes, editionsRes] = await Promise.all([
      fetch(`${GALLERY}/api/films.json`, { cache: "no-store" }),
      fetch(new URL("/editions.json", req.url), { cache: "no-store" }),
    ]);

    if (!filmsRes.ok) {
      return NextResponse.json({ error: `films API HTTP ${filmsRes.status}` }, { status: 502 });
    }

    const filmsJson = (await filmsRes.json()) as { films?: Film[] } | Film[];
    const films = Array.isArray(filmsJson) ? filmsJson : filmsJson.films || [];
    const filmIds = films.map((f) => f.id).filter(Boolean);

    let editions: {
      current?: string | null;
      knownFilms?: string[];
      editions?: { id: string; filmId?: string }[];
    } = {
      current: null,
      editions: [],
    };
    if (editionsRes.ok) {
      editions = await editionsRes.json();
    }

    const seen = new Set<string>([
      ...(editions.knownFilms || []),
      ...((editions.editions || []).map((e) => e.filmId || e.id).filter(Boolean) as string[]),
    ]);
    const unseen = films.filter((f) => f.id && !seen.has(f.id));
    const nextFilm = unseen.length ? unseen[unseen.length - 1] : null;

    return NextResponse.json({
      ok: true,
      needsUpdate: !!nextFilm,
      current: editions.current ?? null,
      filmsInGallery: filmIds,
      editions: (editions.editions || []).map((e) => e.id),
      nextFilm: nextFilm
        ? { id: nextFilm.id, title: nextFilm.title ?? nextFilm.id, released: nextFilm.released }
        : null,
      rebuild: nextFilm
        ? {
            command: `.venv/bin/python pipeline/update_mosaic.py --film ${nextFilm.id}`,
            note: "Run locally or in CI — too large for a Vercel Hobby function. All and Film Canon will pick separate homage stills from the new film when possible.",
          }
        : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[mosaic-check]", err);
    return NextResponse.json({ error: "check failed" }, { status: 500 });
  }
}
