"""Label-chip text for a place name: parentheticals and qualifiers stripped, <= 22 chars (places.json "short_name")."""
import re

OVERRIDES = {
    "Saidu Sharif I Stupa and Monastery": "Saidu Sharif Stupa",
    "White Palace, Marghazar": "White Palace",
    "Bridge over the Ushu River at Matiltan": "Matiltan Bridge",
}
SUFFIXES = (" Ski Resort", " and Monastery", " Stupa and Monastery", " Rock Carvings")
MAXLEN = 22


def short_name(name):
    if name in OVERRIDES: return OVERRIDES[name]
    s = re.sub(r"\s*\([^)]*\)", "", name).strip()
    for suf in SUFFIXES:
        if s.endswith(suf) and suf in (" Ski Resort", " and Monastery"):
            s = s[: -len(suf)]
    if len(s) > MAXLEN:
        s = re.sub(r"\s+(Lake|Valley|Waterfall|Castle|Ruins|Fort)$", "", s) if len(re.sub(r"\s+(Lake|Valley|Waterfall|Castle|Ruins|Fort)$", "", s)) <= MAXLEN else s
    if len(s) > MAXLEN:
        s = s[: MAXLEN - 1].rstrip() + "…"
    return s
