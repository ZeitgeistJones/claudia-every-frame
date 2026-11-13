"""
Cut frames listed on a claudia.gallery film page.

Some films (FABLE) ship with no photographs in /api/images.json. The page
still lists frames from the finished cut, at /films/<id>/stills/NN.m.webp.
Those are the mosaic sources until real gallery photographs exist.
"""
from __future__ import annotations

import math
import re

import requests

import fetch

SITE = "https://claudia.gallery"
UA = {"User-Agent": "claudia-every-frame-mosaic/1.0 (+film cut frames)"}


def items_for(film_id: str) -> list[dict]:
    """Frames in page order. Medium still is also the largest file the page publishes."""
    r = requests.get(f"{SITE}/{film_id}/", headers=UA, timeout=60)
    r.raise_for_status()
    pat = re.compile(
        r'data-src="(/films/'
        + re.escape(film_id)
        + r'/stills/(\d+)\.m\.webp)"\s+data-alt="([^"]*)"'
    )
    found = pat.findall(r.text)
    if not found:
        return []
    # Page HTML mentions each still twice (button + nothing else we match). Keep first hit per number.
    seen: set[str] = set()
    items: list[dict] = []
    for medium, num, alt in found:
        if num in seen:
            continue
        seen.add(num)
        small = medium.replace(".m.webp", ".s.webp")
        stamp = re.search(r"(\d+:\d{2})", alt)
        items.append(
            {
                "id": f"{film_id}-cut-{num}",
                "film": film_id,
                "film_title": film_id.replace("-", " ").upper(),
                "her": True,
                "plate": True,
                "framing": stamp.group(1) if stamp else "",
                "look": "cut",
                "look_name": "cut frame",
                "page": f"/{film_id}/",
                "n": int(num),
                "url": {"s": small, "m": medium, "full": medium},
            }
        )
    items.sort(key=lambda it: int(it["n"]))
    return items


def grid_for(n: int) -> tuple[int, int]:
    """
    Near-square cell grid. Tiles are 16:9, so a square grid keeps the mosaic
    16:9 and the portrait frame is not sliced into a banner. A few empty
    cells are allowed when the count does not divide evenly.
    """
    if n < 1:
        raise ValueError("no frames")
    best: tuple[tuple[float, float, int], int, int] | None = None
    root = max(1, int(math.sqrt(n)))
    for rows in range(max(1, root - 3), root + 8):
        cols = math.ceil(n / rows)
        aspect = cols / rows
        if aspect < 0.8 or aspect > 1.25:
            continue
        waste = cols * rows - n
        score = (float(waste), abs(aspect - 1.0), abs(cols - rows))
        if best is None or score < best[0]:
            best = (score, cols, rows)
    if best is None:
        rows = max(1, math.ceil(math.sqrt(n)))
        cols = math.ceil(n / rows)
        return cols, rows
    return best[1], best[2]


def native_size(item: dict) -> tuple[int, int]:
    from PIL import Image

    fetch.download_all([item], "m")
    with Image.open(fetch.local_path(item, "m")) as im:
        return im.size


def rank_portraits(items: list[dict]) -> list[tuple[float, dict]]:
    """Largest readable face first. Score 0 means no face found."""
    import cv2
    import numpy as np
    from PIL import Image

    fetch.download_all(items, "m")
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    ranked: list[tuple[float, dict]] = []
    for it in items:
        with Image.open(fetch.local_path(it, "m")) as im:
            rgb = np.asarray(im.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape[:2]
        faces = casc.detectMultiScale(gray, 1.08, 4, minSize=(max(24, w // 14), max(24, w // 14)))
        score = 0.0
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: int(f[2]) * int(f[3]))
            cx = (x + fw / 2) / w
            score = (fw * fh) / float(w * h) * (1.0 - 0.2 * abs(cx - 0.5))
        ranked.append((score, it))
    ranked.sort(key=lambda pair: (-pair[0], pair[1]["n"]))
    return ranked


def pick_portrait(items: list[dict]) -> dict:
    """A cut frame that reads as Claudia. Falls back to the middle frame."""
    if not items:
        raise ValueError("no cut frames")
    ranked = rank_portraits(items)
    best_score, best = ranked[0]
    chosen = best if best_score > 0 else items[len(items) // 2]
    pick = dict(chosen)
    pick["_fit_from_film"] = True
    pick["_fit_look"] = pick.get("look")
    pick["_fit_shortlist"] = len(items)
    pick["_face_score"] = best_score if chosen is best else 0.0
    return pick
