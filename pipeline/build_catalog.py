"""
Build public/studio-catalog.json for the browser Studio.

Each her===true image gets a small Lab mean so the client can assign tiles
without decoding every photograph up front. Thumbs still load from
claudia.gallery at render time (CORS is open).
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402
from build_mosaic import to_lab  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "studio-catalog.json"


def describe(item: dict, size: str = "s") -> dict | None:
    path = fetch.local_path(item, size)
    if not path.exists():
        return None
    try:
        im = Image.open(path).convert("RGB")
        # Tiny sample for Lab mean — enough for greedy colour matching.
        sample = np.asarray(im.resize((8, 5), Image.BILINEAR), dtype=np.float32)
        lab = to_lab(sample).mean(axis=(0, 1))
    except Exception:  # noqa: BLE001
        return None
    url = item.get("url") or {}
    return {
        "id": item["id"],
        "film": item.get("film"),
        "film_title": item.get("film_title"),
        "framing": item.get("framing"),
        "look": item.get("look_name"),
        "plate": item.get("plate") is True,
        "s": url.get("s"),
        "m": url.get("m"),
        "page": item.get("page"),
        "lab": [round(float(x), 3) for x in lab],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-refresh", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    items = fetch.select(fetch.fetch_index(refresh=not args.no_refresh), canon=False)
    fetch.download_all(items, "s")
    print(f"[catalog] describing {len(items)} sources", flush=True)

    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for row in ex.map(describe, items):
            if row:
                rows.append(row)

    rows.sort(key=lambda r: r["id"])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "gallery": "https://claudia.gallery",
        "rules": {
            "every_photo_at_least_once": True,
            "max_uses_per_photo": 1,
            "label": "every photograph once · none reused",
        },
        "count": len(rows),
        "items": rows,
    }
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"[catalog] wrote {out} ({len(rows)} items, {out.stat().st_size / 1e6:.2f} MB)", flush=True)


if __name__ == "__main__":
    main()
