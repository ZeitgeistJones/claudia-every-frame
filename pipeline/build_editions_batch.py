"""
Build an homage edition archive for every film currently on claudia.gallery.

Does NOT change the live public/mosaic folder unless --promote <film-id>.
Each film gets:
  - mosaic under public/archives/<film-id>/all/
  - an editions.json entry (Edition menu)

Usage
  .venv/bin/python pipeline/build_editions_batch.py
  .venv/bin/python pipeline/build_editions_batch.py --only clodyssey,bliss
  .venv/bin/python pipeline/build_editions_batch.py --promote dont-let-me-scroll
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
UA = {"User-Agent": "claudia-every-frame-mosaic/1.0 (+edition batch)"}
WORK = ROOT / "work" / "edition-batch"


def log(msg: str) -> None:
    print(f"[batch] {msg}", flush=True)


def fetch_films() -> list[dict]:
    r = requests.get(f"{SITE}/api/films.json", headers=UA, timeout=60)
    r.raise_for_status()
    data = r.json()
    films = data.get("films") if isinstance(data, dict) else data
    if not isinstance(films, list) or not films:
        raise SystemExit("films.json empty")
    return films


def run_build(*, out: Path, target: str) -> None:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
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
    log(" ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT))


def register_from_archive(film: dict, target_all: str, *, make_current: bool) -> dict:
    edition_id = film["id"]
    arch = editions.ARCHIVES / edition_id
    all_counts = editions.read_counts(arch / "all")
    data = editions.load_editions()
    entry = {
        "id": edition_id,
        "filmId": film["id"],
        "filmTitle": film.get("title") or film["id"],
        "label": film.get("title") or film["id"],
        "released": film.get("released"),
        "createdAt": __import__("datetime").date.today().isoformat(),
        "homage": f"Homage to {film.get('title') or film['id']} — portrait {target_all}.",
        "targets": {"all": target_all},
        "paths": {"all": f"/archives/{edition_id}/all"},
        "counts": {
            "allUnique": all_counts.get("unique"),
            "allTiles": all_counts.get("tiles"),
        },
        "note": "Every photograph once · none reused.",
    }
    editions_list = [e for e in data.get("editions", []) if e.get("id") != edition_id]
    editions_list.insert(0, entry)
    data["editions"] = editions_list
    known = set(data.get("knownFilms") or [])
    known.add(edition_id)
    data["knownFilms"] = sorted(known)
    if make_current:
        data["current"] = edition_id
    editions.save_editions(data)
    return entry


def promote_to_live(film_id: str) -> None:
    arch = editions.ARCHIVES / film_id
    if not (arch / "all").exists():
        raise SystemExit(f"cannot promote {film_id}: archive incomplete")
    if editions.CURRENT_ALL.exists():
        shutil.rmtree(editions.CURRENT_ALL)
    shutil.copytree(arch / "all", editions.CURRENT_ALL)
    data = editions.load_editions()
    data["current"] = film_id
    editions.save_editions(data)
    from update_mosaic import write_og_from  # noqa: E402

    write_og_from(editions.CURRENT_ALL / "claudia-mosaic-x.jpg", editions.PUBLIC / "og.jpg")
    log(f"promoted {film_id} to live + refreshed og.jpg")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated film ids (default: all missing editions)")
    ap.add_argument("--rebuild-existing", action="store_true", help="also rebuild films that already have editions")
    ap.add_argument("--promote", help="after building, copy this film's archive to live folders")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    films = fetch_films()
    by_id = {f["id"]: f for f in films if f.get("id")}
    data = editions.load_editions()
    have = {e["id"] for e in data.get("editions", [])}

    if args.only:
        want = [x.strip() for x in args.only.split(",") if x.strip()]
        for w in want:
            if w not in by_id:
                raise SystemExit(f"unknown film {w!r}")
        todo = [by_id[w] for w in want]
    else:
        todo = [f for f in films if args.rebuild_existing or f["id"] not in have]

    log(f"{len(todo)} film(s) to build: {[f['id'] for f in todo]}")
    if not todo:
        log("nothing to do")
        return

    items = fetch.fetch_index(refresh=True)

    for film in todo:
        fid = film["id"]
        log(f"=== {fid} ({film.get('title')}) ===")
        all_t = editions.pick_target(items, fid, canon=False)
        log(f"homage target: {all_t['id']}  framing={all_t.get('framing')} plate={all_t.get('plate')}")
        if args.dry_run:
            continue

        tmp_all = WORK / fid / "all"
        run_build(out=tmp_all, target=all_t["id"])

        dest = editions.ARCHIVES / fid
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        shutil.copytree(tmp_all, dest / "all")
        (dest / "meta.json").write_text(
            json.dumps(
                {"id": fid, "targets": {"all": all_t["id"]}, "title": film.get("title")},
                indent=2,
            )
            + "\n"
        )
        entry = register_from_archive(film, all_t["id"], make_current=False)
        log(f"archived + registered {entry['id']}  allTiles={entry['counts']['allTiles']}")

    if args.promote:
        if args.dry_run:
            log(f"(dry-run) would promote {args.promote}")
        else:
            promote_to_live(args.promote)

    data = editions.load_editions()
    order = {f["id"]: i for i, f in enumerate(films)}
    data["editions"] = sorted(
        data.get("editions", []),
        key=lambda e: -order.get(e.get("filmId") or e.get("id"), -1),
    )
    editions.save_editions(data)
    log("done")
    print(json.dumps({"ok": True, "editions": [e["id"] for e in data["editions"]], "current": data.get("current")}, indent=2))


if __name__ == "__main__":
    main()
