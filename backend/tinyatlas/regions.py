"""The two places Tiny Atlas draws: Swat Valley and Lower Swat, each an Atlas pack (docs/atlas-pack-v1.md).

A region config is a plain dict: name, subtitle, bbox (west, south, east, north), center (lat, lon),
atlas (the pack slug under data/packs/<slug>/atlas/), landmarks [{title, slug, kind, lat, lon}] and tours
(hand-drawn visiting orders by landmark title). `REGIONS` maps slug -> config.
"""
import re

REGIONS = {
    "swat": {
        "name": "Swat Valley",
        "subtitle": "Kalam · Utror · Ushu · Mahodand",
        "bbox": (72.1, 35.3, 72.9, 35.85),
        "center": (35.6, 72.6),
        "atlas": "swat",
        "landmarks": [
            {"title": "Andrab Lake", "slug": "andrab-lake", "kind": "lake", "lat": 35.6455, "lon": 72.51229},
            {"title": "Gabral", "slug": "gabral", "kind": "village", "lat": 35.51629, "lon": 72.42038},
            {"title": "Izmis Lake", "slug": "izmis-lake", "kind": "lake", "lat": 35.39996, "lon": 72.37728},
            {"title": "Jabba Zomalu Lake", "slug": "jabba-zomalu-lake", "kind": "lake", "lat": 35.6239, "lon": 72.7986},
            {"title": "Jandrai", "slug": "jandrai", "kind": "village", "lat": 35.39488, "lon": 72.30902},
            {"title": "Kalam", "slug": "kalam", "kind": "town", "lat": 35.48611, "lon": 72.58458},
            {"title": "Katora Lake", "slug": "katora-lake", "kind": "lake", "lat": 35.36771, "lon": 72.34612},
            {"title": "Kharkhari Lake", "slug": "kharkhari-lake", "kind": "lake", "lat": 35.6772, "lon": 72.4015},
            {"title": "Kundol Lake", "slug": "kundol-lake", "kind": "lake", "lat": 35.41854, "lon": 72.43302},
            {"title": "Laddu", "slug": "laddu", "kind": "village", "lat": 35.46946, "lon": 72.43959},
            {"title": "Laddu Lake", "slug": "laddu-lake", "kind": "lake", "lat": 35.32331, "lon": 72.46978},
            {"title": "Mahodand Lake", "slug": "mahodand-lake", "kind": "lake", "lat": 35.70825, "lon": 72.65398},
            {"title": "Matiltan", "slug": "matiltan", "kind": "village", "lat": 35.54145, "lon": 72.66128},
            {"title": "Mushroom Lake", "slug": "mushroom-lake", "kind": "lake", "lat": 35.6357, "lon": 72.29624},
            {"title": "Pearl Lake", "slug": "pearl-lake", "kind": "lake", "lat": 35.60234, "lon": 72.59772},
            {"title": "Spin Khwar Lake", "slug": "spin-khwar-lake", "kind": "lake", "lat": 35.43375, "lon": 72.45202},
            {"title": "Thal", "slug": "thal-kumrat", "kind": "village", "lat": 35.47823, "lon": 72.24551},
            {"title": "Ushu", "slug": "ushu", "kind": "village", "lat": 35.60756, "lon": 72.69019},
            {"title": "Utror", "slug": "utror", "kind": "village", "lat": 35.49151, "lon": 72.46902},
            {"title": "Falak Sar", "slug": "falak-sar", "kind": "peak", "lat": 35.6786, "lon": 72.78075},
            {"title": "Jamia Masjid Thal", "slug": "jamia-masjid-thal", "kind": "mosque", "lat": 35.47843, "lon": 72.2454},
            {"title": "Mankial Sar", "slug": "mankial-sar", "kind": "peak", "lat": 35.41745, "lon": 72.7192},
            {"title": "Thalo Zom", "slug": "thalo-zom", "kind": "peak", "lat": 35.78112, "lon": 72.28262},
        ],
        "tours": [
            {"name": "Kalam to Mahodand Lake", "days": 1, "stops": ["Kalam", "Ushu", "Mahodand Lake"]},
            {"name": "Utror, Kalam and Gabral", "days": 1, "stops": ["Utror", "Kalam", "Matiltan", "Gabral"]},
        ],
    },
    "swat-lower": {
        "name": "Lower Swat",
        "subtitle": "Mingora · Udegram · Malam Jabba",
        "bbox": (72.0, 34.58, 72.7, 35.3),
        "center": (34.84, 72.4),
        "atlas": "swat-lower",
        "landmarks": [
            {"title": "Bahrain", "slug": "bahrain", "kind": "town", "lat": 35.2078, "lon": 72.5474},
            {"title": "Barikot", "slug": "barikot", "kind": "town", "lat": 34.678, "lon": 72.22377},
            {"title": "Daral Lake", "slug": "daral-lake", "kind": "lake", "lat": 35.2171, "lon": 72.37524},
            {"title": "Fatehpur", "slug": "fatehpur-swat", "kind": "town", "lat": 35.06907, "lon": 72.48696},
            {"title": "Kanju", "slug": "kanju", "kind": "village", "lat": 34.80442, "lon": 72.33744},
            {"title": "Khwazakhela", "slug": "khwazakhela", "kind": "town", "lat": 34.93632, "lon": 72.46929},
            {"title": "Madyan", "slug": "madyan", "kind": "town", "lat": 35.14129, "lon": 72.53744},
            {"title": "Manglawar", "slug": "manglawar", "kind": "town", "lat": 34.80854, "lon": 72.4304},
            {"title": "Miandam", "slug": "miandam", "kind": "town", "lat": 35.0534, "lon": 72.5606},
            {"title": "Mingora", "slug": "mingora", "kind": "town", "lat": 34.77254, "lon": 72.36077},
            {"title": "Saidu Sharif", "slug": "saidu-sharif", "kind": "town", "lat": 34.74473, "lon": 72.35628},
            {"title": "Udegram", "slug": "udegram", "kind": "village", "lat": 34.752, "lon": 72.293},
            {"title": "Amluk-Dara Stupa", "slug": "amluk-dara-stupa", "kind": "stupa", "lat": 34.64747, "lon": 72.28985},
            {"title": "Bazira", "slug": "bazira-barikot-ghundai", "kind": "archaeological_site", "lat": 34.67834, "lon": 72.21477},
            {"title": "Butkara I Stupa", "slug": "butkara-i-stupa", "kind": "stupa", "lat": 34.76524, "lon": 72.3682},
            {"title": "Butkara III Stupa", "slug": "butkara-iii-stupa", "kind": "stupa", "lat": 34.75852, "lon": 72.37171},
            {"title": "Chakdara Fort", "slug": "chakdara-fort", "kind": "fort_ruin", "lat": 34.64716, "lon": 72.02851},
            {"title": "Elum Ghar", "slug": "elum-ghar", "kind": "peak", "lat": 34.61949, "lon": 72.33073},
            {"title": "Ghalegay Buddha", "slug": "ghalegay-buddha-rock", "kind": "rock_carving", "lat": 34.7059, "lon": 72.26045},
            {"title": "Gogdara Rock Carvings", "slug": "gogdara-rock-carvings", "kind": "rock_carving", "lat": 34.74307, "lon": 72.29508},
            {"title": "Gumbat Stupa", "slug": "gumbat-balo-kale-stupa", "kind": "stupa", "lat": 34.68973, "lon": 72.18542},
            {"title": "Jahanabad Buddha", "slug": "jahanabad-buddha", "kind": "rock_carving", "lat": 34.81151, "lon": 72.46735},
            {"title": "Mahmud Ghaznavi Mosque", "slug": "mahmud-ghaznavi-mosque", "kind": "mosque", "lat": 34.74315, "lon": 72.31426},
            {"title": "Nimogram Stupa", "slug": "nimogram-stupa", "kind": "stupa", "lat": 34.7252, "lon": 72.135},
            {"title": "Raja Gira Castle", "slug": "raja-gira-castle", "kind": "fort_ruin", "lat": 34.74185, "lon": 72.31318},
            {"title": "Saidu Sharif Stupa", "slug": "saidu-sharif-stupa", "kind": "stupa", "lat": 34.75747, "lon": 72.36215},
            {"title": "Shingardar Stupa", "slug": "shingardar-stupa", "kind": "stupa", "lat": 34.69139, "lon": 72.24722},
            {"title": "Swat Museum", "slug": "swat-museum", "kind": "museum", "lat": 34.7635, "lon": 72.35922},
            {"title": "White Palace", "slug": "white-palace-marghazar", "kind": "palace", "lat": 34.66328, "lon": 72.34486},
        ],
        "tours": [
            {"name": "Mingora and the Buddhist valley", "days": 1, "stops": ["Mingora", "Saidu Sharif Stupa", "Butkara I Stupa", "Swat Museum", "Udegram"]},
            {"name": "Chakdara to Barikot", "days": 1, "stops": ["Chakdara Fort", "Manglawar", "Mingora", "Barikot"]},
        ],
    },
}


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().encode("ascii", "ignore").decode()).strip("-")
    return s or "place"
