"""Try the facts extractor and the planner on a region from the command line.

    python backend/tools/try_planner.py hunza "3 days in October, my parents can't walk far" [--month 10]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tinyatlas import api  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("region")
ap.add_argument("request")
ap.add_argument("--month", type=int, default=10)
a = ap.parse_args()

f = api.region_facts(a.region)
print(f"{len(f['facts'])} facts (checked {f['checked']}):")
for x in f["facts"]:
    print(f"  [{x['topic']}] {x['text']}  <- \"{x['quote']}\" ({x['source']})")
p = api.plan_trip(a.region, api.PlanRequest(request=a.request, month=a.month))
print(f"\n{p['title']}: {p['summary']}")
for d in p["days"]:
    print(f"Day {d['n']}: {d['title']} - {d['km']} km, {d['travel_min']} min; sleep {d['sleep'] and d['sleep']['name']}")
    print("   " + " > ".join(f"{s['name']} ({s['elev']} m)" for s in d["stops"]))
    for w in d["warnings"]:
        print("   ! " + w)
    print("   " + d["notes"])
