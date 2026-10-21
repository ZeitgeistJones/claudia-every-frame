# Claudia — Every Frame

A real photomosaic of Claudia, built entirely from the actual photographs in
[claudia.gallery](https://claudia.gallery/). From a distance it is one portrait;
zoomed in, every tile is a distinct gallery photograph you can click to open.

Claudia by anabology.

## What's in here

| Path | What it is |
| --- | --- |
| `pipeline/fetch.py` | Reads the official API (`/api/images.json`), selects `her === true` images (or `her && plate` with `--canon`), and caches files in `cache/img/`. Already-downloaded files are reused. |
| `pipeline/build_mosaic.py` | Builds the mosaic: Lab structure matching, a global assignment that uses every photo at least once, repeat spreading, rendering, JPEG exports, and a deep-zoom (DZI) pyramid. |
| `public/mosaic/` | Default mosaic (all `her === true` photos): `claudia-mosaic-full.jpg`, `claudia-mosaic-x.jpg`, `mosaic.json` (cell → photo map), `report.json`, `dzi/`. |
| `public/mosaic-canon/` | Same outputs for Film Canon mode (`her && plate`). |
| `app/`, `components/` | Next.js viewer (OpenSeadragon deep zoom, click a tile to see the original). |

## Current build

* 1,378 of 1,378 eligible photographs placed (Film Canon: 226 of 226), 0 download failures
* 64 × 64 = 4,096 tiles, each 320 × 180 px
* Master: 20,480 × 11,520 px JPEG (~39 MB); X preview: 2048 × 1152 JPEG
* Target portrait: `ev-14-dist.dist-cu.3` (a real gallery close-up)

## Run the viewer locally

```bash
npm install
npm run dev        # http://localhost:4317
```

## Rebuild the mosaic (e.g. after the archive grows)

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/build_mosaic.py                                 # all her===true → public/mosaic
.venv/bin/python pipeline/build_mosaic.py --canon --out public/mosaic-canon
```

The builder refreshes the gallery index, downloads only new images, and
regenerates every output. Useful flags: `--cols/--rows` (grid), `--tile-w/--tile-h`
(tile pixels), `--alpha/--alpha-ab/--beta` (how strongly tiles are tinted toward
the portrait), `--target` (gallery id of the portrait), `--limit N` (quick test
with a random subset).
