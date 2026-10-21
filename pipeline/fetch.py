"""
Claudia.gallery index + image cache.

Reads the official public API (https://claudia.gallery/api/images.json),
selects images where her === true (or her && plate for --canon), and
downloads their files into cache/img/<size>/ . Files already on disk are
reused, so re-running after the archive grows only fetches new images.

Usage:
  python pipeline/fetch.py                # all her===true images, size "s"
  python pipeline/fetch.py --size m       # medium 1800px webp
  python pipeline/fetch.py --canon        # only her && plate
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

SITE = "https://claudia.gallery"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
UA = {"User-Agent": "claudia-every-frame-mosaic/1.0 (+https://claudia.gallery fan artwork)"}


def fetch_index(refresh: bool = True) -> list[dict]:
    """Download images.json (cached copy is used if the network fails)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / "images.json"
    if refresh or not path.exists():
        try:
            r = requests.get(f"{SITE}/api/images.json", headers=UA, timeout=60)
            r.raise_for_status()
            data = r.json()
            path.write_text(json.dumps(data))
        except Exception as e:  # noqa: BLE001
            if not path.exists():
                raise
            print(f"[fetch] could not refresh index ({e}); using cached copy", file=sys.stderr)
    data = json.loads(path.read_text())
    items = data.get("items")
    if not isinstance(items, list):
        raise ValueError("images.json has no 'items' list; the API schema changed")
    return items


def select(items: list[dict], canon: bool = False) -> list[dict]:
    out = []
    for it in items:
        if it.get("her") is not True:
            continue
        if canon and it.get("plate") is not True:
            continue
        url = (it.get("url") or {})
        if not isinstance(url, dict) or not url.get("s"):
            continue
        out.append(it)
    return out


def local_path(item: dict, size: str) -> Path:
    url = item["url"][size]
    ext = Path(url).suffix
    return CACHE / "img" / size / f"{item['id']}{ext}"


def _download(item: dict, size: str, retries: int = 4) -> tuple[str, str | None]:
    dest = local_path(item, size)
    if dest.exists() and dest.stat().st_size > 0:
        return item["id"], None
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = SITE + item["url"][size]
    err = None
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code == 404:
                return item["id"], f"404 {url}"
            r.raise_for_status()
            if len(r.content) < 200:
                raise ValueError(f"suspiciously small file ({len(r.content)} bytes)")
            tmp = dest.with_suffix(dest.suffix + ".part")
            tmp.write_bytes(r.content)
            tmp.replace(dest)
            return item["id"], None
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            time.sleep(2 ** attempt)
    return item["id"], err or "unknown error"


def download_all(items: list[dict], size: str = "s", workers: int = 12) -> dict[str, str]:
    """Download every item; returns {id: error} for failures."""
    failures: dict[str, str] = {}
    todo = [it for it in items if not local_path(it, size).exists()]
    print(f"[fetch] {len(items)} selected, {len(items) - len(todo)} cached, {len(todo)} to download ({size})")
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_download, it, size) for it in todo]
        for f in as_completed(futs):
            iid, err = f.result()
            done += 1
            if err:
                failures[iid] = err
                print(f"[fetch] FAILED {iid}: {err}", file=sys.stderr)
            if done % 50 == 0 or done == len(todo):
                print(f"[fetch] {done}/{len(todo)}")
    return failures


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="s", choices=["s", "m", "full"])
    ap.add_argument("--canon", action="store_true", help="only her && plate")
    ap.add_argument("--limit", type=int, default=0, help="only the first N (testing)")
    ap.add_argument("--no-refresh", action="store_true")
    args = ap.parse_args()

    items = select(fetch_index(refresh=not args.no_refresh), canon=args.canon)
    if args.limit:
        items = items[: args.limit]
    failures = download_all(items, args.size)
    (CACHE / f"failures-{args.size}.json").write_text(json.dumps(failures, indent=2))
    print(f"[fetch] done: {len(items) - len(failures)} ok, {len(failures)} failed")


if __name__ == "__main__":
    main()
