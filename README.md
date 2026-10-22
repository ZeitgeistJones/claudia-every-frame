# Claudia — Every Frame

A real photomosaic of Claudia, built entirely from the actual photographs in
[claudia.gallery](https://claudia.gallery/). From a distance it is one portrait;
zoomed in, every tile is a distinct gallery photograph you can click to open.

Claudia by anabology.

## What's in here

| Path | What it is |
| --- | --- |
| `pipeline/fetch.py` | Reads the official API (`/api/images.json`), selects `her === true` images (or `her && plate` with `--canon`), and caches files in `cache/img/`. Already-downloaded files are reused. |
| `pipeline/build_mosaic.py` | Builds the mosaic: Lab structure matching, hard house rules (every photo ≥1×, max 4× each), global assignment, repeat spreading, rendering, JPEG exports, and a deep-zoom (DZI) pyramid. |
| `public/mosaic/` | Default mosaic (all `her === true` photos): `claudia-mosaic-full.jpg`, `claudia-mosaic-x.jpg`, `mosaic.json` (cell → photo map), `report.json`, `dzi/`. |
| `public/mosaic-canon/` | Same outputs for Film Canon mode (`her && plate`). |
| `app/`, `components/` | Next.js viewer (OpenSeadragon deep zoom, click a tile to see the original). |

## House rules

* Every eligible photograph appears **exactly once** (no reuse)
* Near-square grids; a few empty cells when the count can’t tile cleanly (same idea as the first cut)
* **Official editions** = curated deep-zoom on `/`; **Studio** at `/studio` = prompt a Claudia-related homage, filter for appropriate, build a shareable 1× preview in the browser

## Current build

* Official All / Film Canon: each photograph once · deep-zoom DZI
* Studio: prompt → filter (must be Claudia-related & appropriate) → shareable 1× mosaic

## Run the viewer locally

```bash
npm install
npm run dev        # http://localhost:4317
```

## Rebuild the mosaic (e.g. after the archive grows)

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/build_mosaic.py --max-uses 1                    # all her===true → public/mosaic
.venv/bin/python pipeline/build_mosaic.py --canon --max-uses 1 --out public/mosaic-canon
.venv/bin/python pipeline/build_catalog.py                                # Studio catalog for /studio
```

The builder refreshes the gallery index, downloads only new images, and
regenerates every output. Useful flags: `--cols/--rows` (grid), `--tile-w/--tile-h`
(tile pixels), `--alpha/--alpha-ab/--beta` (how strongly tiles are tinted toward
the portrait), `--target` (gallery id of the portrait), `--limit N` (quick test
with a random subset).

## Editions (new films)

Each new Claudia film can get its own **homage edition**:

- **All** mosaic → portrait picked from that film's `her===true` stills
- **Film Canon** mosaic → portrait picked from that film's `her && plate` stills
- Those two targets can be **different images**
- Previous editions are archived under `public/archives/<film-id>/`
- The live site always serves `public/mosaic` + `public/mosaic-canon`, with an Edition menu to revisit archives

When a new film lands on claudia.gallery:

```bash
.venv/bin/python pipeline/update_mosaic.py --check   # see if an update is needed
.venv/bin/python pipeline/update_mosaic.py           # archive current, rebuild for newest film
```

A weekly Vercel cron hits `/api/mosaic-check` (set `CRON_SECRET` in Vercel). That endpoint only *detects* a new film — rebuilding still runs via the Python pipeline (too big for Hobby serverless).
