"""Plan a trip by talking to the map.

The model never works out a distance, a time or an altitude. The server first measures everything it may need:
road and footpath distances between every pair of stops, rough travel times, each stop's altitude, the day's
sunrise and sunset. The model only chooses and orders stops into days and writes the notes. Then the server
recomputes every number for the plan it returned, drops stops it made up, and adds warnings (long driving days,
sleeping altitude rising too fast, stops the map cannot connect).
"""
import json
import math
from datetime import datetime, timezone
from functools import lru_cache

from . import llm, routing, sun
from .regions import slugify

ROAD_KMH = 30.0            # Karakoram roads: the KKH is faster, jeep tracks far slower; the app says "about"
WALK_KMH = 3.5
CLIMB_M_PER_H = 400.0
MAX_SNAP_M = 2000.0
LONG_DAY_MIN = 6 * 60
ALTITUDE_START_M = 3000.0  # above this, sleeping altitude should rise slowly
ALTITUDE_STEP_M = 500.0

SYSTEM = (
    "You plan trips for tourists using ONLY the stops listed. Choose and order stops into days that fit the "
    "traveller's request, keep driving days reasonable, and put the best viewpoints near sunrise or sunset when it "
    "helps. Use only stop ids from the list. Never state distances, times or altitudes yourself; the app adds them. "
    "Notes may use the facts given. Reply with JSON only: "
    '{"title": "short plan title", "summary": "one or two sentences", "days": [{"title": "short day title", '
    '"stops": ["stop id", ...], "sleep": "stop id of a town to sleep in, or null", "notes": "one or two sentences"}]}'
)


def road_kmh(grade: float) -> float:
    """Typical speed on a mountain road of this average grade."""
    return ROAD_KMH if grade < 0.04 else 20.0 if grade < 0.08 else 10.0


def _travel_min(km: float, mode: str, climb_m: float = 0.0) -> int:
    if mode == "road":
        return round(km / ROAD_KMH * 60)
    return round(km / WALK_KMH * 60 + max(climb_m, 0.0) / CLIMB_M_PER_H * 60)


def _leg_from_path(adj, path, a, b) -> dict:
    road_m = foot_m = road_min = 0.0
    for p, q in zip(path, path[1:]):
        e = next(e for e in adj[p] if e[0] == q)
        foot_m += e[2] if e[3] else 0.0
        road_m += 0.0 if e[3] else e[2]
        road_min += 0.0 if e[3] else e[1]
    mode = "foot" if road_m == 0 and foot_m else "road" if foot_m == 0 else "mixed"
    climb = b["elev"] - a["elev"] if foot_m else 0.0
    mins = round(road_min) + _travel_min(foot_m / 1000, "foot", climb * foot_m / max(foot_m + road_m, 1))
    return {"km": round((road_m + foot_m) / 1000, 1), "walk_km": round(foot_m / 1000, 1), "mode": mode, "min": mins,
            "path": [list(p) for p in path]}


def _tree(adj, src):
    """Dijkstra from one node over everything: (minutes, previous node)."""
    import heapq
    best, prev, pq = {src: 0.0}, {}, [(0.0, src)]
    while pq:
        t, n = heapq.heappop(pq)
        if t > best.get(n, math.inf):
            continue
        for m, mins, _, _ in adj[n]:
            if t + mins < best.get(m, math.inf):
                best[m], prev[m] = t + mins, n
                heapq.heappush(pq, (t + mins, m))
    return best, prev


@lru_cache(maxsize=4)
def _atlas_catalog(slug: str, stops_key: tuple):
    """catalog() for an Atlas region: heights, roads and stops come from its pack; one Dijkstra per stop."""
    from . import atlaspack
    stops = {s["slug"]: s for s in map(dict, stops_key)}
    adj, size = atlaspack.network(slug)
    ends = {}
    for k, s in stops.items():
        n = routing.nearest_node(adj, (s["u"], s["v"]), size) if adj else None
        if n and math.hypot((n[0] - s["u"]) * size[0], (n[1] - s["v"]) * size[1]) <= MAX_SNAP_M:
            ends[k] = n
    legs = {}
    for a, na in ends.items():
        best, prev = _tree(adj, na)
        for b, nb in ends.items():
            if a == b or nb not in best:
                continue
            path = [nb]
            while path[-1] != na:
                path.append(prev[path[-1]])
            legs[(a, b)] = _leg_from_path(adj, path[::-1], stops[a], stops[b])
    return stops, legs


def catalog(region: str, cfg: dict, landmarks: list[dict]) -> tuple[dict, dict]:
    """(stops by slug with elevation, legs {(a, b): leg}) for an Atlas region: heights, roads and stops come from its pack."""
    from . import atlaspack
    stops = {l["slug"]: {**{k: l[k] for k in ("slug", "name", "kind", "u", "v", "lat", "lon")},
                         "elev": round(atlaspack.elevation(cfg["atlas"], l["u"], l["v"])),
                         "about": (l.get("description") or l.get("summary", "")[:140])} for l in landmarks}
    key = tuple(tuple(sorted(s.items())) for s in stops.values())
    return _atlas_catalog(cfg["atlas"], key)


def prompt(cfg: dict, stops: dict, legs: dict, facts: list[dict], request: str, month: int, current=None) -> str:
    lat, lon = cfg["center"]
    day = datetime(datetime.now().year, month, 15, tzinfo=timezone.utc)
    rise, set_ = sun.rise_set(day, lat, lon)
    lines = [f"Place: {cfg['name']}, {cfg.get('subtitle', '')}. Month of travel: {day:%B}."]
    if rise:
        tz_h = round(lon / 15)
        lines.append(f"Sunrise about {(rise.hour + tz_h) % 24:02d}:{rise.minute:02d}, sunset about {(set_.hour + tz_h) % 24:02d}:{set_.minute:02d} local time.")
    linked = {a for a, _ in legs}
    lines.append("\nStops you can visit (id | name | kind | altitude | about):")
    for s in stops.values():
        if s["slug"] in linked:
            lines.append(f"{s['slug']} | {s['name']} | {s['kind']} | {s['elev']} m | {s['about']}")
    far = [s["name"] for s in stops.values() if s["slug"] not in linked]
    if far:
        lines.append("Seen from a distance only (no road or path reaches them; mention them in notes, never as stops): "
                     + ", ".join(far))
    lines.append("\nConnections (the app measured these; use them to judge what fits in a day):")
    how = {"road": "by road", "foot": "on foot", "mixed": "by road then on foot"}
    for (a, b), leg in legs.items():
        if a < b:
            walk = f" ({leg['walk_km']} km of it walking)" if leg["mode"] == "mixed" else ""
            lines.append(f"{a} - {b}: {leg['km']} km {how[leg['mode']]}{walk}, about {leg['min']} min "
                         f"(the other way about {legs[(b, a)]['min']} min)")
    if facts:
        lines.append("\nFacts from the guidebooks:")
        lines += [f"- {f['text']}" for f in facts[:14]]
    for tour in cfg.get("tours", []):
        lines.append(f"\nA classic route: {tour['name']}: " + " -> ".join(slugify(t) for t in tour["stops"]))
    if current:
        lines.append("\nThe traveller's current plan (change it as they ask, keep what they don't mention):\n" + json.dumps(current))
    lines.append(f"\nTraveller's request: {request}")
    return "\n".join(lines)


def validate(raw: dict, stops: dict, legs: dict, size_m) -> dict:
    """Rebuild the plan from the model's choices with measured numbers, and warn where it asks too much."""
    days, prev_sleep = [], None
    for i, d in enumerate(raw.get("days") or []):
        chosen = [s for s in (d.get("stops") or []) if s in stops]
        chosen = [s for k, s in enumerate(chosen) if k == 0 or s != chosen[k - 1]]
        if not chosen:
            continue
        sleep = d.get("sleep") if d.get("sleep") in stops else None
        warnings, out_legs, path = [], [], []
        for a, b in zip(chosen, chosen[1:]):
            leg = legs.get((a, b))
            if not leg:
                warnings.append(f"The map has no road or path between {stops[a]['name']} and {stops[b]['name']}.")
                out_legs.append({"from": a, "to": b, "km": None, "min": None, "mode": None})
                path += [[stops[a]["u"], stops[a]["v"]], [stops[b]["u"], stops[b]["v"]]]
                continue
            out_legs.append({"from": a, "to": b, "km": leg["km"], "min": leg["min"], "mode": leg["mode"],
                             "walk_km": leg.get("walk_km", 0.0)})
            path += leg["path"]
        travel = sum(l["min"] or 0 for l in out_legs)
        if travel > LONG_DAY_MIN:
            warnings.append(f"About {travel // 60} h {travel % 60:02d} min of travel: a long day.")
        night = stops[sleep or chosen[-1]]["elev"]
        if prev_sleep is not None and night > ALTITUDE_START_M and night - prev_sleep > ALTITUDE_STEP_M:
            warnings.append(f"You'd sleep {night - prev_sleep} m higher than the night before, at {night} m. Above "
                            f"3,000 m, climbing slowly (about 300-500 m a night) helps avoid altitude sickness.")
        prev_sleep = night
        slim = [path[0]] if path else []
        for p in path[1:]:
            if math.hypot(p[0] - slim[-1][0], p[1] - slim[-1][1]) >= 0.0015:
                slim.append(p)
        days.append({"n": len(days) + 1, "title": str(d.get("title") or f"Day {i + 1}")[:80],
                     "notes": str(d.get("notes") or "")[:400],
                     "stops": [{"slug": s, "name": stops[s]["name"], "elev": stops[s]["elev"]} for s in chosen],
                     "sleep": {"slug": sleep, "name": stops[sleep]["name"], "elev": stops[sleep]["elev"]} if sleep else None,
                     "legs": out_legs, "travel_min": travel, "km": round(sum(l["km"] or 0 for l in out_legs), 1),
                     "warnings": warnings, "route": slim})
    return {"title": str(raw.get("title") or "Your trip")[:80], "summary": str(raw.get("summary") or "")[:400], "days": days,
            "choices": {"days": [{"title": d["title"], "stops": [s["slug"] for s in d["stops"]],
                                  "sleep": d["sleep"]["slug"] if d["sleep"] else None, "notes": d["notes"]} for d in days]}}


def _size(cfg: dict) -> tuple[float, float]:
    from . import atlaspack
    return atlaspack.size_m(cfg["atlas"])


def plan(region: str, cfg: dict, landmarks: list[dict], facts: list[dict], request: str, month: int,
         current: dict | None = None) -> dict:
    stops, legs = catalog(region, cfg, landmarks)
    text = prompt(cfg, stops, legs, facts, request, month, current)
    raw = llm.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
                            max_tokens=1800, task="planner")
    result = validate(raw if isinstance(raw, dict) else {}, stops, legs, _size(cfg))
    if not result["days"]:
        raise llm.LLMUnavailable("the model's plan used none of this place's stops")
    return result
