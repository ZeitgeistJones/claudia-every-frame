"""
Update Claudia — Every Frame for a new film (or force a rebuild).

What it does
  1. Reads https://claudia.gallery/api/films.json + images.json
  2. Finds the newest film that does not yet have an edition (or uses --film)
  3. Archives the current live mosaics into public/archives/<old-id>/
  4. Picks a homage target from the new film (best her===true still, usually a CU)
  5. Rebuilds public/mosaic (All photographs, each once), regenerates og.jpg
  6. Updates public/editions.json

This is intentionally a local/CI job — not a Vercel Hobby cron.
Hobby functions time out long before a 20k mosaic finishes.

Usage
  .venv/bin/python pipeline/update_mosaic.py              # newest unseen film
  .venv/bin/python pipeline/update_mosaic.py --check      # print status only
  .venv/bin/python pipeline/update_mosaic.py --film bliss
  .venv/bin/python pipeline/update_mosaic.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import editions  # noqa: E402
import fetch  # noqa: E402

SITE = "https://claudia.gallery"
ROOT = editions.ROOT
UA = {"User-Agent": "claudia-every-frame-mosaic/1.0 (+homage updater)"}


def log(msg: str) -> None:
    print(f"[update] {msg}", flush=True)


def fetch_films() -> list[dict]:
    r = requests.get(f"{SITE}/api/films.json", headers=UA, timeout=60)
    r.raise_for_status()
    data = r.json()
    films = data.get("films") if isinstance(data, dict) else data
    if not isinstance(films, list) or not films:
        raise ValueError("films.json has no films list")
    return films


def newest_unseen(films: list[dict], seen: set[str]) -> dict | None:
    # API order is release order (oldest → newest). Prefer the last unseen film.
    unseen = [f for f in films if f.get("id") and f["id"] not in seen]
    return unseen[-1] if unseen else None


def write_og_from(src_x: Path, dest: Path) -> None:
    from PIL import Image

    im = Image.open(src_x).convert("RGB")
    w, h = 1200, 675
    sw, sh = im.size
    scale = max(w / sw, h / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x0, y0 = (nw - w) // 2, (nh - h) // 2
    dest.parent.mkdir(parents=True, exist_ok=True)
    im2.crop((x0, y0, x0 + w, y0 + h)).save(dest, quality=88, optimize=True, progressive=True)


def run_build(*, out: Path, target: str, canon: bool) -> None:
    cmd = [
        str(ROOT / ".venv/bin/python"),
        str(ROOT / "pipeline/build_mosaic.py"),
        "--no-refresh",
        "--max-uses",
        "1",
        "--target",
        target,
        "--out",
        str(out),
    ]
    if canon:
        cmd.append("--canon")
    log(" ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="only report whether an update is needed")
    ap.add_argument("--film", help="force a specific film id")
    ap.add_argument("--dry-run", action="store_true", help="pick targets but do not rebuild")
    ap.add_argument("--skip-archive", action="store_true", help="do not archive the current live mosaics")
    ap.add_argument("--target-all", help="override homage image id")
    args = ap.parse_args()

    films = fetch_films()
    by_id = {f["id"]: f for f in films if f.get("id")}
    data = editions.load_editions()
    seen = editions.known_film_ids(data)

    if args.film:
        if args.film not in by_id:
            raise SystemExit(f"unknown film id {args.film!r}. known: {', '.join(by_id)}")
        film = by_id[args.film]
    else:
        film = newest_unseen(films, seen)

    status = {
        "filmsInGallery": [f["id"] for f in films],
        "editions": [e["id"] for e in data.get("editions", [])],
        "current": data.get("current"),
        "needsUpdate": film is not None and (args.film is not None or film["id"] not in seen),
        "nextFilm": None if film is None else {"id": film["id"], "title": film.get("title")},
    }

    if args.check:
        print(json.dumps(status, indent=2))
        return

    if film is None:
        log("gallery has no films we have not already archived. nothing to do.")
        print(json.dumps(status, indent=2))
        return

    log(f"homage film: {film['id']} ({film.get('title')})")
    items = fetch.fetch_index(refresh=True)

    if args.target_all:
        target_all_item = next((it for it in items if it["id"] == args.target_all), None)
        if not target_all_item:
            raise SystemExit(f"--target-all {args.target_all} not in gallery")
    else:
        target_all_item = editions.pick_target(items, film["id"], canon=False)

    log(f"homage target: {target_all_item['id']}  framing={target_all_item.get('framing')} plate={target_all_item.get('plate')}")
    status["targets"] = {"all": target_all_item["id"]}

    if args.dry_run:
        print(json.dumps(status, indent=2))
        return

    # Archive whatever is currently live (previous edition)
    prev = data.get("current")
    if not args.skip_archive and prev and editions.CURRENT_ALL.exists():
        log(f"archiving current edition {prev!r}")
        editions.archive_current(prev)

    # Rebuild live All mosaic only (Film Canon UI retired)
    if editions.CURRENT_ALL.exists():
        shutil.rmtree(editions.CURRENT_ALL)

    run_build(out=editions.CURRENT_ALL, target=target_all_item["id"], canon=False)

    # X card from the All mosaic
    write_og_from(editions.CURRENT_ALL / "claudia-mosaic-x.jpg", editions.PUBLIC / "og.jpg")
    write_og_from(editions.CURRENT_ALL / "claudia-mosaic-x.jpg", editions.CURRENT_ALL / "og.jpg")

    # Register edition + archive a copy of the NEW live outputs too
    entry = editions.upsert_edition(
        film=film,
        target_all=target_all_item["id"],
        make_current=True,
    )
    log(f"archiving new edition {entry['id']!r}")
    editions.archive_current(entry["id"])

    meta = {
        **entry,
        "galleryFilms": [f["id"] for f in films],
    }
    (editions.ARCHIVES / entry["id"] / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")

    log("done")
    print(json.dumps({"ok": True, "edition": entry, "status": status}, indent=2))


if __name__ == "__main__":
    main()
