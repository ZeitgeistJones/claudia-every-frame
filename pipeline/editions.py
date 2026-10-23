"""
Edition helpers for Claudia — Every Frame.

An "edition" is one homage mosaic generation, usually tied to a film.
Current live outputs live in public/mosaic (All) and public/mosaic-canon
(Film Canon). Finished editions are copied into public/archives/<id>/.

Future editions may use DIFFERENT target portraits for All vs Film Canon —
e.g. All uses a striking CU from the new film's archive, Film Canon uses a
plate that actually appears in the finished cut.
"""
from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
EDITIONS_PATH = PUBLIC / "editions.json"
CURRENT_ALL = PUBLIC / "mosaic"
CURRENT_CANON = PUBLIC / "mosaic-canon"
ARCHIVES = PUBLIC / "archives"

FRAMING_SCORE = {
    "ECU": 100,
    "CU": 90,
    "MCU": 55,
    "MS": 25,
    "full": 10,
    "sheet": -40,
    "macro": -20,
    "aerial": -30,
    "EWS": -10,
    "WS": 0,
    "MWS": 5,
    "": 15,
}


def load_editions() -> dict:
    if not EDITIONS_PATH.exists():
        return {"current": None, "editions": []}
    return json.loads(EDITIONS_PATH.read_text())


def save_editions(data: dict) -> None:
    EDITIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    EDITIONS_PATH.write_text(json.dumps(data, indent=2) + "\n")


def known_film_ids(data: dict | None = None) -> set[str]:
    """Films we have already handled (editions + baseline knownFilms list)."""
    data = data or load_editions()
    ids = {e["filmId"] for e in data.get("editions", []) if e.get("filmId")}
    ids.update(x for x in data.get("knownFilms", []) if isinstance(x, str))
    return ids


def score_target(item: dict, *, prefer_plate: bool) -> float:
    """Higher = better homage portrait for a film."""
    if item.get("her") is not True:
        return -1e9
    framing = item.get("framing") or ""
    score = float(FRAMING_SCORE.get(framing, 0))
    if item.get("plate") is True:
        score += 40 if prefer_plate else 15
    # Prefer upright / face-forward looking prompts and pages
    prompt = (item.get("prompt") or "").lower()
    for word, bonus in (
        ("close-up portrait", 35),
        ("close-up", 20),
        ("portrait", 18),
        ("eye level", 12),
        ("front", 8),
        ("head and shoulders", 10),
        ("looking at", 6),
        ("turnaround", -50),
        ("sheet", -40),
        ("avatar", -30),
        ("anime", -25),
    ):
        if word in prompt:
            score += bonus
    # Prefer near-square or portrait aspect for faces; landscape is fine for CU too
    w, h = item.get("w") or 0, item.get("h") or 0
    if w and h and h >= w:
        score += 8
    # Prefer later / higher-n variants slightly less; keep deterministic
    score -= 0.01 * int(item.get("n") or 0)
    return score


def pick_target(items: list[dict], film_id: str, *, canon: bool, allow_her_fallback: bool = True) -> dict:
    """
    Pick a Claudia still from `film_id` to be the homage portrait.

    - All mode: any her===true image from that film (prefers CU/ECU, plates ok).
    - Film Canon: her===true && plate===true from that film; if the film has no
      plates yet (brand-new drop), fall back to the best her===true still.
    """
    pool = [it for it in items if it.get("film") == film_id and it.get("her") is True]
    used_fallback = False
    if canon:
        plates = [it for it in pool if it.get("plate") is True]
        if plates:
            pool = plates
        elif allow_her_fallback and pool:
            used_fallback = True
        else:
            raise ValueError(f"no usable plate images for film {film_id!r}")
    if not pool:
        raise ValueError(
            f"no usable {'plate' if canon else 'her'} images for film {film_id!r}"
        )
    ranked = sorted(pool, key=lambda it: score_target(it, prefer_plate=canon and not used_fallback), reverse=True)
    pick = ranked[0]
    if used_fallback:
        pick = dict(pick)
        pick["_canon_her_fallback"] = True
    return pick


def pick_target_pair(items: list[dict], film_id: str) -> tuple[dict, dict]:
    """
    Pick All + Film Canon homage stills for a film.

    Prefers two DIFFERENT images when the film has another strong option for All
    (within a score margin of the top pick). Film Canon prefers a real plate;
    if none exist yet, both modes may share (or split) her===true stills.
    """
    canon = pick_target(items, film_id, canon=True)
    all_pool = [it for it in items if it.get("film") == film_id and it.get("her") is True]
    ranked = sorted(all_pool, key=lambda it: score_target(it, prefer_plate=False), reverse=True)
    if not ranked:
        raise ValueError(f"no her===true images for film {film_id!r}")
    best = ranked[0]
    best_score = score_target(best, prefer_plate=False)
    all_pick = best
    for cand in ranked:
        if cand["id"] == canon["id"]:
            continue
        if score_target(cand, prefer_plate=False) >= best_score - 30:
            all_pick = cand
            break
    return all_pick, canon


def archive_current(edition_id: str) -> Path:
    """Copy the live mosaic folder into public/archives/<edition_id>/all/."""
    dest = ARCHIVES / edition_id
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    if CURRENT_ALL.exists():
        shutil.copytree(CURRENT_ALL, dest / "all")
    return dest


def read_counts(folder: Path) -> dict:
    report = folder / "report.json"
    if not report.exists():
        return {}
    r = json.loads(report.read_text())
    return {
        "unique": r.get("unique_sources_placed"),
        "tiles": r.get("total_tiles"),
        "target": r.get("target"),
        "fullResolution": r.get("full_resolution"),
    }


def upsert_edition(
    *,
    film: dict,
    target_all: str,
    target_canon: str | None = None,  # legacy kwarg; ignored (Film Canon UI retired)
    make_current: bool = True,
) -> dict:
    _ = target_canon
    data = load_editions()
    edition_id = film["id"]
    all_counts = read_counts(CURRENT_ALL)
    entry = {
        "id": edition_id,
        "filmId": film["id"],
        "filmTitle": film.get("title") or film["id"],
        "label": film.get("title") or film["id"],
        "released": film.get("released"),
        "createdAt": date.today().isoformat(),
        "homage": (
            f"Homage to {film.get('title') or film['id']} — "
            f"portrait {target_all}."
        ),
        "targets": {"all": target_all},
        "paths": {
            "all": f"/archives/{edition_id}/all",
        },
        "counts": {
            "allUnique": all_counts.get("unique"),
            "allTiles": all_counts.get("tiles"),
        },
        "note": "Every photograph once · none reused.",
    }
    editions = [e for e in data.get("editions", []) if e.get("id") != edition_id]
    editions.insert(0, entry)
    data["editions"] = editions
    known = set(data.get("knownFilms") or [])
    known.add(edition_id)
    data["knownFilms"] = sorted(known)
    if make_current:
        data["current"] = edition_id
    save_editions(data)
    return entry
