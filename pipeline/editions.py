"""
Edition helpers for Claudia — Every Frame.

An "edition" is one mosaic generation tied to a film drop. Live output lives in
public/mosaic/; finished editions are copied into public/archives/<id>/.

Target portrait rule
  Not "the best CU." Something creative, tasteful, and fitting for the video.
  Recreating a still from the new film is fine when that still feels right —
  it is not required. Mood / look / world fit matters more than sharpness of face.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
EDITIONS_PATH = PUBLIC / "editions.json"
CURRENT_ALL = PUBLIC / "mosaic"
CURRENT_CANON = PUBLIC / "mosaic-canon"
ARCHIVES = PUBLIC / "archives"

# Soft framing preference for a *tasteful* mosaic structure — not a CU arms race.
# Extreme close-ups are fine; mid shots and cinematic wides that still read as
# Claudia can win when they fit the film better.
FRAMING_TASTE = {
    "ECU": 18,
    "CU": 22,
    "MCU": 24,
    "MS": 16,
    "MWS": 10,
    "WS": 6,
    "full": 8,
    "EWS": 2,
    "aerial": -15,
    "macro": -20,
    "sheet": -50,
    "": 12,  # untagged cinematic stills are common and often great
}

_STOP = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "as", "is",
    "are", "was", "were", "be", "by", "with", "from", "at", "it", "she", "her",
    "his", "he", "they", "them", "that", "this", "into", "out", "up", "not",
    "but", "until", "than", "then", "now", "one", "two", "also", "still",
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


def _tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9']+", (text or "").lower())
    return {w for w in words if len(w) >= 3 and w not in _STOP}


def film_vibe(film: dict, items: list[dict]) -> dict:
    """Mood signature: title/logline/world keywords + looks used in the film."""
    film_id = film.get("id") or ""
    blob = " ".join(
        str(film.get(k) or "")
        for k in ("title", "subtitle", "logline", "world", "gallery_note")
    )
    keywords = _tokens(blob)
    looks: set[str] = set()
    look_names: set[str] = set()
    for it in items:
        if it.get("film") != film_id or it.get("her") is not True:
            continue
        if it.get("look"):
            looks.add(str(it["look"]))
        if it.get("look_name"):
            look_names.add(str(it["look_name"]).lower())
            keywords |= _tokens(str(it["look_name"]))
        keywords |= _tokens(str(it.get("prompt") or ""))
    if len(keywords) > 80:
        keywords = set(sorted(keywords, key=lambda w: (-len(w), w))[:80])
    return {
        "film_id": film_id,
        "keywords": keywords,
        "looks": looks,
        "look_names": look_names,
    }


def recent_target_ids(data: dict | None = None, *, limit: int = 8) -> set[str]:
    """Targets already used on recent editions — avoid repeating the same face."""
    data = data or load_editions()
    out: set[str] = set()
    for e in (data.get("editions") or [])[:limit]:
        t = (e.get("targets") or {}).get("all")
        if t:
            out.add(t)
    return out


def score_taste(item: dict) -> float:
    """
    Is this a tasteful mosaic subject — readable Claudia, cinematic, not junk.
    Intentionally flat across CU/MCU/MS so 'best face' does not always win.
    """
    if item.get("her") is not True:
        return -1e9
    framing = item.get("framing") or ""
    score = float(FRAMING_TASTE.get(framing, 0))
    prompt = (item.get("prompt") or "").lower()
    alt = (item.get("alt") or "").lower()
    blob = prompt + " " + alt

    # Creative / cinematic signals
    for word, bonus in (
        ("cinematic", 14),
        ("still", 4),
        ("portrait", 8),
        ("close-up", 6),
        ("eye level", 6),
        ("golden hour", 8),
        ("neon", 6),
        ("moody", 6),
        ("soft light", 5),
        ("turnaround", -55),
        ("character sheet", -55),
        ("sheet", -40),
        ("avatar", -35),
        ("grid", -25),
        ("reference", -15),
        ("anime", -20),
    ):
        if word in blob:
            score += bonus

    if item.get("plate") is True:
        score += 12  # actually in a cut — often the tasteful choice
    if item.get("cut") is True:
        score += 8
    if item.get("edited") is True:
        score += 4
    if item.get("profile") is True:
        score += 3

    w, h = item.get("w") or 0, item.get("h") or 0
    if w and h:
        # Prefer images large enough to structure a mosaic; mild portrait bonus
        if min(w, h) >= 1024:
            score += 4
        if h >= w:
            score += 3

    # Slight jitter-breaker only (keep deterministic)
    score -= 0.001 * int(item.get("n") or 0)
    return score


def score_fit(item: dict, vibe: dict) -> float:
    """How well this still belongs with the film's world / looks / language."""
    score = 0.0
    film_id = vibe.get("film_id") or ""
    if item.get("film") == film_id:
        score += 22.0  # nice when it is from the film — not mandatory
    look = item.get("look") or ""
    if look and look in (vibe.get("looks") or set()):
        score += 48.0
    look_name = (item.get("look_name") or "").lower()
    if look_name and look_name in (vibe.get("look_names") or set()):
        score += 18.0
    hay = _tokens(
        " ".join(
            str(item.get(k) or "")
            for k in ("prompt", "alt", "look_name", "batch_note", "film_title")
        )
    )
    overlap = hay & (vibe.get("keywords") or set())
    score += min(36.0, 2.5 * len(overlap))
    return score


def score_fitting(item: dict, vibe: dict, *, used: set[str] | None = None) -> float:
    """Fit (heavy) + taste (moderate). Not a 'best CU' maximizer."""
    if item.get("her") is not True:
        return -1e9
    score = score_fit(item, vibe) * 1.35 + score_taste(item)
    if used and item.get("id") in used:
        score -= 40.0
    return score


# Back-compat for anything still calling the old name
def score_target(item: dict, *, prefer_plate: bool) -> float:
    _ = prefer_plate
    return score_taste(item)


def _stable_pick(candidates: list[dict], *, salt: str) -> dict:
    """
    Among a shortlist of equally-good-enough options, pick one creatively but
    stably (same film → same pick). Avoids always taking ranked[0].
    """
    if len(candidates) == 1:
        return candidates[0]
    digest = hashlib.sha256(salt.encode("utf-8")).hexdigest()
    idx = int(digest[:8], 16) % len(candidates)
    return candidates[idx]


def pick_target(
    items: list[dict],
    film_id: str,
    *,
    canon: bool = False,
    allow_her_fallback: bool = True,
    film: dict | None = None,
    require_same_film: bool = False,
) -> dict:
    """
    Pick a creative, tasteful portrait that fits this film.

    Searches the her===true archive by default. Same-film stills are preferred
    when they fit, not required. From a shortlist of strong fits, chooses one
    stably via film id — not whichever has the highest CU score.
    """
    _ = allow_her_fallback
    film_meta = film or {"id": film_id}
    if not film_meta.get("id"):
        film_meta = {**film_meta, "id": film_id}

    vibe = film_vibe(film_meta, items)
    used = recent_target_ids()
    pool = [it for it in items if it.get("her") is True]
    if require_same_film or canon:
        local = [it for it in pool if it.get("film") == film_id]
        if canon:
            plates = [it for it in local if it.get("plate") is True]
            pool = plates or local
        else:
            pool = local
    if not pool:
        raise ValueError(f"no usable her===true images for film {film_id!r}")

    ranked = sorted(
        pool,
        key=lambda it: score_fitting(it, vibe, used=used),
        reverse=True,
    )
    top = ranked[0]
    top_score = score_fitting(top, vibe, used=used)

    # Shortlist: within a tasteful band of the leader (not just #1)
    band = 18.0
    shortlist = [
        it for it in ranked
        if score_fitting(it, vibe, used=used) >= top_score - band
    ][:16]

    # Prefer shortlist members that are from the film OR share a film look,
    # when any exist inside the band — keeps editions feeling on-world without
    # forcing a literal frame copy.
    on_world = [
        it for it in shortlist
        if it.get("film") == film_id
        or (it.get("look") and it.get("look") in (vibe.get("looks") or set()))
    ]
    if on_world:
        shortlist = on_world

    pick = dict(_stable_pick(shortlist, salt=f"fit:{film_id}"))
    pick["_fit_score"] = score_fitting(pick, vibe, used=used)
    pick["_fit_from_film"] = pick.get("film") == film_id
    pick["_fit_look"] = pick.get("look")
    pick["_fit_shortlist"] = len(shortlist)
    return pick


def pick_target_pair(items: list[dict], film_id: str) -> tuple[dict, dict]:
    """Legacy All + Film Canon pair."""
    canon = pick_target(items, film_id, canon=True, require_same_film=True)
    all_pick = pick_target(items, film_id, canon=False, require_same_film=False)
    return all_pick, canon


def archive_current(edition_id: str) -> Path:
    """Copy the live mosaic folder into public/archives/<edition_id>/all/."""
    dest = ARCHIVES / edition_id
    meta_path = dest / "meta.json"
    saved_meta = meta_path.read_text(encoding="utf-8") if meta_path.exists() else None
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    if CURRENT_ALL.exists():
        shutil.copytree(CURRENT_ALL, dest / "all")
    if saved_meta is not None:
        meta_path.write_text(saved_meta, encoding="utf-8")
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
    target_canon: str | None = None,
    make_current: bool = True,
    target_from_film: bool | None = None,
    homage: str | None = None,
    note: str | None = None,
) -> dict:
    _ = target_canon
    data = load_editions()
    edition_id = film["id"]
    all_counts = read_counts(CURRENT_ALL)
    title = film.get("title") or film["id"]
    if not homage:
        if target_from_film is True:
            homage = f"Edition for {title} — portrait {target_all} (from the film)."
        elif target_from_film is False:
            homage = (
                f"Edition for {title} — portrait {target_all} "
                f"(fitting look from the archive)."
            )
        else:
            homage = f"Edition for {title} — portrait {target_all}."
    entry = {
        "id": edition_id,
        "filmId": film["id"],
        "filmTitle": title,
        "label": title,
        "released": film.get("released"),
        "createdAt": date.today().isoformat(),
        "homage": homage,
        "targets": {"all": target_all},
        "paths": {
            "all": f"/archives/{edition_id}/all",
        },
        "counts": {
            "allUnique": all_counts.get("unique"),
            "allTiles": all_counts.get("tiles"),
        },
        "note": note or (
            "Every photograph once · none reused. "
            "Portrait chosen to feel fitting for the film — not necessarily a frame copy."
        ),
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
