"""
Claudia — Every Frame: real photomosaic builder.

Every tile is a real Claudia.gallery photograph (cached by fetch.py).

Algorithm
  1. Target portrait (a real gallery photo) is cropped to the canvas aspect
     and sampled on a (cols*gx) x (rows*gy) grid in CIELAB, so each mosaic
     cell has an 8x5 "structure" descriptor, not just one average colour.
  2. Every source photo is cover-cropped to the tile aspect and described
     the same way.
  3. Cost = weighted Lab distance between descriptors, multiplied by a
     per-cell importance map (face/eyes/edges matter more).
  4. One global assignment (Hungarian / linear_sum_assignment) places all
     photos at once. Each source gets one "mandatory" copy with a large
     bonus, so every eligible photo is used at least once; extra copies
     are only used to fill the remaining cells.
  5. A swap pass pushes repeated copies of the same photo apart.
  6. Tiles are rendered at full tile resolution with a mild per-tile Lab
     colour shift toward the target (content stays recognisable) and a
     light overlay of the target for facial continuity.

Outputs (in --out):
  claudia-mosaic-full.jpg   master
  claudia-mosaic-x.jpg      2048x1152 preview downscaled from the master
  mosaic.json               grid + per-cell source ids + source metadata
  report.json               counts, resolution, file sizes, failures
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.optimize import linear_sum_assignment

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TARGET = "ev-14-dist.dist-cu.3"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- imaging

def cover_crop(im: Image.Image, aspect: float, v_anchor: float = 0.5) -> Image.Image:
    """Crop to aspect (w/h). Tall images keep the upper part (faces)."""
    w, h = im.size
    if w / h > aspect:
        nw = round(h * aspect)
        x0 = (w - nw) // 2
        return im.crop((x0, 0, x0 + nw, h))
    nh = round(w / aspect)
    y0 = round((h - nh) * v_anchor)
    return im.crop((0, y0, w, y0 + nh))


def trim_black_borders(im: Image.Image, thresh: float = 10.0) -> Image.Image:
    """Remove letterbox/pillarbox bars (rows/columns that are almost black)."""
    g = np.asarray(im.convert("L"), np.float32)
    cols = np.where(g.mean(0) > thresh)[0]
    rows = np.where(g.mean(1) > thresh)[0]
    if len(cols) < 10 or len(rows) < 10:
        return im
    pad = 4
    return im.crop((cols[0] + pad, rows[0] + pad, cols[-1] + 1 - pad, rows[-1] + 1 - pad))


def to_lab(rgb_u8: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb_u8.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)


def from_lab(lab: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB)
    return np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)


def load_source(item: dict, size: str, tw: int, th: int, gx: int, gy: int):
    path = fetch.local_path(item, size)
    try:
        im = trim_black_borders(Image.open(path).convert("RGB"))
    except Exception as e:  # noqa: BLE001
        return item["id"], None, None, f"{type(e).__name__}: {e}"
    v_anchor = 0.3 if im.height > im.width else 0.5
    im = cover_crop(im, tw / th, v_anchor)
    tile = np.asarray(im.resize((tw, th), Image.LANCZOS))
    small = cv2.resize(tile, (gx, gy), interpolation=cv2.INTER_AREA)
    return item["id"], tile, to_lab(small), None


# ---------------------------------------------------------------- importance

def importance_map(target_rgb: np.ndarray, cols: int, rows: int, face_boost: float, edge_boost: float) -> np.ndarray:
    """Per-cell weight: 1 + edge energy + detected face/eye regions."""
    h, w = target_rgb.shape[:2]
    gray = cv2.cvtColor(target_rgb, cv2.COLOR_RGB2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.resize(np.hypot(gx, gy), (cols, rows), interpolation=cv2.INTER_AREA)
    mag = mag / (np.percentile(mag, 98) + 1e-6)
    weight = 1.0 + edge_boost * np.clip(mag, 0, 1)

    face_mask = np.zeros((h, w), np.float32)
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = casc.detectMultiScale(gray, 1.1, 5, minSize=(w // 10, w // 10))
    if len(faces):
        x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        log(f"face detected at x={x} y={y} w={fw} h={fh}")
        cv2.ellipse(face_mask, (int(x + fw / 2), int(y + fh / 2)), (int(fw * 0.55), int(fh * 0.7)), 0, 0, 360, 1.0, -1)
        eyes_c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
        eyes = eyes_c.detectMultiScale(gray[y:y + fh, x:x + fw], 1.1, 6)
        for ex, ey, ew, eh in eyes[:2]:
            cv2.ellipse(face_mask, (int(x + ex + ew / 2), int(y + ey + eh / 2)), (int(ew * 0.8), int(eh * 0.6)), 0, 0, 360, 2.0, -1)
    else:
        log("no face detected; using centre ellipse")
        cv2.ellipse(face_mask, (w // 2, h // 2), (w // 7, h // 3), 0, 0, 360, 1.0, -1)
    face_mask = cv2.GaussianBlur(face_mask, (0, 0), w / 80)
    fm = cv2.resize(face_mask, (cols, rows), interpolation=cv2.INTER_AREA)
    return (weight + face_boost * fm).astype(np.float32)


# ---------------------------------------------------------------- assignment

def cost_matrix(tfeat: np.ndarray, sfeat: np.ndarray, chan_w: tuple[float, float, float]) -> np.ndarray:
    """Squared weighted Lab distance between every cell and every source."""
    cw = np.sqrt(np.array(chan_w, np.float32))
    t = (tfeat * cw).reshape(len(tfeat), -1).astype(np.float64)
    s = (sfeat * cw).reshape(len(sfeat), -1).astype(np.float64)
    d = (t * t).sum(1)[:, None] + (s * s).sum(1)[None, :] - 2.0 * t @ s.T
    return np.maximum(d, 0) / t.shape[1]


def assign(cost: np.ndarray, extra_copies: int) -> np.ndarray:
    """Global assignment; every source at least once, then extra copies."""
    m, n = cost.shape
    copies = max(1, math.ceil(m / n)) + extra_copies if m > n else 1
    big = cost.max() * 10 + 1.0
    blocks = [cost - big] + [cost] * (copies - 1)
    full = np.concatenate(blocks, axis=1)
    log(f"assignment: {m} cells x {full.shape[1]} source-copies ({n} sources, up to {copies} uses each)")
    rows, cols = linear_sum_assignment(full)
    out = np.empty(m, np.int64)
    out[rows] = cols % n
    return out


def spread_repeats(a: np.ndarray, cost: np.ndarray, cols: int, rows: int, radius: int, rng: random.Random) -> int:
    """Swap cells so the same photo is not repeated within `radius` cells."""
    pos = {}
    for idx, s in enumerate(a):
        pos.setdefault(int(s), []).append(idx)

    def conflicts_at(idx: int, s: int, ignore: tuple[int, ...] = ()) -> bool:
        r, c = divmod(idx, cols)
        for j in pos.get(s, ()):
            if j == idx or j in ignore:
                continue
            rj, cj = divmod(j, cols)
            if abs(rj - r) <= radius and abs(cj - c) <= radius:
                return True
        return False

    swaps = 0
    for _ in range(6):
        bad = [i for i in range(len(a)) if conflicts_at(i, int(a[i]))]
        if not bad:
            break
        rng.shuffle(bad)
        for i in bad:
            s = int(a[i])
            if not conflicts_at(i, s):
                continue
            delta = cost[i, a] + cost[np.arange(len(a)), s] - cost[i, s] - cost[np.arange(len(a)), a]
            for j in np.argsort(delta)[:400]:
                j = int(j)
                t = int(a[j])
                if j == i or t == s:
                    continue
                # tentatively move s->j and t->i
                if conflicts_at(j, s, ignore=(i,)) or conflicts_at(i, t, ignore=(j,)):
                    continue
                pos[s].remove(i); pos[s].append(j)
                pos[t].remove(j); pos[t].append(i)
                a[i], a[j] = t, s
                swaps += 1
                break
    remaining = sum(1 for i in range(len(a)) if conflicts_at(i, int(a[i])))
    log(f"spread repeats: {swaps} swaps, {remaining} cells still near a duplicate")
    return remaining


# ---------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cols", type=int, default=64)
    ap.add_argument("--rows", type=int, default=64)
    ap.add_argument("--tile-w", type=int, default=320)
    ap.add_argument("--tile-h", type=int, default=180)
    ap.add_argument("--gx", type=int, default=8)
    ap.add_argument("--gy", type=int, default=5)
    ap.add_argument("--size", default="s", choices=["s", "m"], help="source file size used for tiles")
    ap.add_argument("--target", default=DEFAULT_TARGET)
    ap.add_argument("--target-anchor", type=float, default=0.25, help="vertical crop anchor for the target (0 = keep top)")
    ap.add_argument("--canon", action="store_true", help="Film Canon: her && plate only")
    ap.add_argument("--limit", type=int, default=0, help="random subset of N sources (phase-1 tests)")
    ap.add_argument("--alpha", type=float, default=0.75, help="per-tile mean lightness shift toward target (0..1)")
    ap.add_argument("--alpha-ab", type=float, default=0.6, help="per-tile mean colour shift toward target (0..1)")
    ap.add_argument("--contrast", type=float, default=0.9, help="contrast kept inside each tile (1 = original)")
    ap.add_argument("--beta", type=float, default=0.2, help="target overlay strength (0..1)")
    ap.add_argument("--face-boost", type=float, default=3.0)
    ap.add_argument("--edge-boost", type=float, default=1.5)
    ap.add_argument("--extra-copies", type=int, default=1)
    ap.add_argument("--radius", type=int, default=4, help="min spacing between repeats of a photo")
    ap.add_argument("--quality", type=int, default=86)
    ap.add_argument("--x-width", type=int, default=2048)
    ap.add_argument("--out", default=str(ROOT / "output"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-refresh", action="store_true")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cols, rows, tw, th, gx, gy = args.cols, args.rows, args.tile_w, args.tile_h, args.gx, args.gy
    W, H = cols * tw, rows * th
    t0 = time.time()

    # ---- sources
    all_items = fetch.fetch_index(refresh=not args.no_refresh)
    by_id = {it["id"]: it for it in all_items}
    items = fetch.select(all_items, canon=args.canon)
    eligible_count = len(items)
    if args.limit and args.limit < len(items):
        items = rng.sample(items, args.limit)
    log(f"{eligible_count} eligible ({'Film Canon' if args.canon else 'all her===true'}); using {len(items)}")
    dl_fail = fetch.download_all(items, args.size)

    log("loading + describing sources")
    tiles, feats, used_items, failures = [], [], [], dict(dl_fail)
    with ThreadPoolExecutor(max_workers=4) as ex:
        for iid, tile, feat, err in ex.map(lambda it: load_source(it, args.size, tw, th, gx, gy), items):
            if err or tile is None:
                failures.setdefault(iid, err or "decode failed")
                continue
            tiles.append(tile)
            feats.append(feat)
            used_items.append(by_id[iid])
    if not tiles:
        raise SystemExit("no usable source images")
    sfeat = np.stack(feats)  # n, gy, gx, 3
    log(f"{len(tiles)} sources ready, {len(failures)} failed")

    # ---- target
    if args.target not in by_id:
        raise SystemExit(f"target {args.target} not in gallery index")
    tgt_item = by_id[args.target]
    fetch.download_all([tgt_item], "full")
    tgt_src = trim_black_borders(Image.open(fetch.local_path(tgt_item, "full")).convert("RGB"))
    tgt = cover_crop(tgt_src, W / H, v_anchor=args.target_anchor)
    log(f"target {tgt_item['id']}: trimmed to {tgt_src.size}, cropped to {tgt.size}")
    tgt_rgb = np.asarray(tgt)
    tfeat_img = cv2.resize(tgt_rgb, (cols * gx, rows * gy), interpolation=cv2.INTER_AREA)
    tlab = to_lab(tfeat_img).reshape(rows, gy, cols, gx, 3).transpose(0, 2, 1, 3, 4).reshape(rows * cols, gy, gx, 3)
    weights = importance_map(tgt_rgb, cols, rows, args.face_boost, args.edge_boost).reshape(-1)

    # ---- assignment
    base = cost_matrix(tlab, sfeat, (1.0, 0.8, 0.8))
    cost = base * weights[:, None]
    a = assign(cost, args.extra_copies)
    spread_repeats(a, cost, cols, rows, args.radius, rng)
    counts = np.bincount(a, minlength=len(tiles))
    log(f"unique sources placed: {(counts > 0).sum()} / {len(tiles)}; max uses {counts.max()}")

    # ---- render
    log(f"rendering {W}x{H} ({cols}x{rows} tiles of {tw}x{th})")
    overlay_w, overlay_h = cols * max(8, tw // 4), rows * max(8, th // 4)
    ov = cv2.resize(tgt_rgb, (overlay_w, overlay_h), interpolation=cv2.INTER_AREA if overlay_w < tgt_rgb.shape[1] else cv2.INTER_CUBIC)
    ovw, ovh = overlay_w // cols, overlay_h // rows
    tmean = tlab.mean(axis=(1, 2))
    strength = np.array([args.alpha, args.alpha_ab, args.alpha_ab], np.float32)
    canvas = np.empty((H, W, 3), np.uint8)
    for idx in range(rows * cols):
        r, c = divmod(idx, cols)
        tile_lab = to_lab(tiles[a[idx]])
        smean = tile_lab.reshape(-1, 3).mean(0)
        new_mean = smean + strength * (tmean[idx] - smean)
        tile_lab = new_mean + (tile_lab - smean) * args.contrast
        if args.beta > 0:
            patch = ov[r * ovh:(r + 1) * ovh, c * ovw:(c + 1) * ovw]
            patch = cv2.resize(patch, (tw, th), interpolation=cv2.INTER_CUBIC)
            tile_lab = (1 - args.beta) * tile_lab + args.beta * to_lab(patch)
        canvas[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = from_lab(tile_lab)
        if idx % 512 == 0:
            log(f"  tile {idx}/{rows * cols}")

    # ---- export
    import pyvips  # noqa: E402

    full_path = out / "claudia-mosaic-full.jpg"
    x_path = out / "claudia-mosaic-x.jpg"
    vimg = pyvips.Image.new_from_memory(canvas.data, W, H, 3, "uchar")
    log("writing master JPEG")
    vimg.jpegsave(str(full_path), Q=args.quality, optimize_coding=True, interlace=False, subsample_mode="off" if args.quality >= 90 else "auto", strip=True)
    xw = args.x_width
    xh = round(xw * H / W)
    log(f"writing X preview {xw}x{xh}")
    small = vimg.resize(xw / W, vscale=xh / H, kernel="lanczos3")
    small = small.sharpen(sigma=0.6, x1=1.5, m1=0.4, m2=1.2)
    small.jpegsave(str(x_path), Q=92, optimize_coding=True, strip=True, subsample_mode="off")
    np.save(out / "assignment.npy", a)

    # ---- records
    sources = []
    for k, it in enumerate(used_items):
        sources.append({
            "id": it["id"], "film": it.get("film"), "film_title": it.get("film_title"),
            "framing": it.get("framing"), "look": it.get("look_name"), "plate": it.get("plate"),
            "s": it["url"]["s"], "m": it["url"]["m"], "full": it["url"]["full"], "page": it.get("page"),
            "uses": int(counts[k]),
        })
    mosaic = {
        "title": "Claudia — Every Frame",
        "credit": "Claudia by anabology · photographs from claudia.gallery",
        "mode": "film-canon" if args.canon else "all-her",
        "target": {"id": tgt_item["id"], "page": tgt_item.get("page"), "m": tgt_item["url"]["m"]},
        "width": W, "height": H, "cols": cols, "rows": rows, "tileW": tw, "tileH": th,
        "cells": [int(x) for x in a],
        "sources": sources,
    }
    (out / "mosaic.json").write_text(json.dumps(mosaic, separators=(",", ":")))
    report = {
        "mode": mosaic["mode"],
        "eligible_in_gallery": eligible_count,
        "sources_loaded": len(tiles),
        "unique_sources_placed": int((counts > 0).sum()),
        "total_tiles": int(rows * cols),
        "max_uses_per_source": int(counts.max()),
        "min_uses_per_source": int(counts.min()),
        "full_resolution": f"{W}x{H}",
        "full_file": full_path.name, "full_bytes": full_path.stat().st_size,
        "x_resolution": f"{xw}x{xh}",
        "x_file": x_path.name, "x_bytes": x_path.stat().st_size,
        "target": tgt_item["id"],
        "failures": failures,
        "params": vars(args),
        "seconds": round(time.time() - t0, 1),
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    log(json.dumps({k: v for k, v in report.items() if k != "params"}, indent=2))


if __name__ == "__main__":
    main()
