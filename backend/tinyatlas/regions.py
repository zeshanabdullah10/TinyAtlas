REGIONS = {
    # bbox = (west, south, east, north)
    "hunza": {
        "name": "Hunza Valley",
        "bbox": (74.5, 36.2, 75.0, 36.55),
        # Wikipedia titles; coordinates and text are fetched live, then filtered to the bbox.
        "landmarks": [
            {"title": "Baltit Fort", "kind": "fort"},
            {"title": "Altit Fort", "kind": "fort"},
            {"title": "Attabad Lake", "kind": "lake"},
            {"title": "Passu Cones", "kind": "peak"},
            {"title": "Ultar Sar", "kind": "peak"},
            {"title": "Hussaini Suspension Bridge", "kind": "bridge"},
        ],
        # Extra guide text (Wikivoyage) used for retrieval-grounded answers.
        "guide_pages": [("en.wikivoyage.org", "Hunza"), ("en.wikivoyage.org", "Karakoram Highway")],
    },
}
