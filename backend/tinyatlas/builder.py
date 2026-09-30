"""Build a miniature for any place: search -> landmarks -> elevation -> OSM -> painted texture -> guide sources."""
from . import discover, geocode, jobs, osm, paint, regions, sources, terrain

STEPS = [
    ("locate", "Finding the place"),
    ("landmarks", "Choosing landmarks"),
    ("terrain", "Fetching elevation"),
    ("map", "Downloading roads and rivers"),
    ("paint", "Painting the miniature"),
    ("guide", "Gathering guide text"),
]


def region_config(place: dict, landmarks: list[dict], pages: list[tuple[str, str]]) -> dict:
    return {
        "name": place["name"], "subtitle": place.get("subtitle", ""),
        "center": (place["lat"], place["lon"]),
        "bbox": geocode.make_bbox(place["lat"], place["lon"]),
        "landmarks": landmarks, "guide_pages": pages,
    }


def build(query: str, job: jobs.Job, place: dict | None = None, client=None) -> str:
    """Runs all steps and returns the new region's slug. Existing regions are reused, not rebuilt.
    `place` ({name, subtitle, lat, lon}) skips the search when the caller already resolved it."""
    job.begin("locate", f"Searching for “{query}”")
    if place is None:
        found = geocode.search(query, client=client)
        if not found:
            raise ValueError(f"No place found for “{query}”. Try a town, a mountain or a landmark name.")
        place = found[0]
    slug = regions.slugify(place["name"])
    if slug in regions.REGIONS:
        return slug

    bbox = geocode.make_bbox(place["lat"], place["lon"])
    job.begin("landmarks", f"Looking for landmarks around {place['name']}")
    lms = discover.discover(bbox, client=client)
    pages = discover.guide_pages(place["name"], client=client)

    job.begin("terrain", "Downloading elevation tiles")
    terrain.heightmap(bbox, z=11, size=64)
    job.begin("map", "Downloading roads and rivers from OpenStreetMap (this is the slow part)")
    osm.features(bbox, client=client)
    job.begin("paint", "Painting terrain, water and roads")
    paint.paint_region(slug, bbox)

    job.begin("guide", "Reading up on the landmarks")
    cfg = region_config(place, lms, pages)
    sources.chunks(cfg, client)            # warms the cache so the first question is instant
    regions.save(slug, cfg)
    return slug


def start(query: str, place: dict | None = None) -> jobs.Job:
    return jobs.start(STEPS, lambda job: build(query, job, place))
