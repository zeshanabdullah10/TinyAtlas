# Atlas pack, format v1

An Atlas pack is everything the interactive illustrated map needs for one region, as static files. It is produced by
`backend/tools/atlas_pack.py <bundle>` from a geo bundle (`data/bundles/<name>/`, see `geo_bundle.py`) plus the
research data, and lives at `data/packs/<slug>/atlas/`. The dev server serves it at `/packs/<slug>/atlas/`; the
static site copies it to `dist/packs/<slug>/atlas/`.

## Scene coordinates
All geometry in the pack is already in **scene metres**: `x` = metres east of the near grid's NW corner, `z` =
metres south of it (three.js: +x east, +z south, +y up, so north is −z). Heights are **real metres above sea level**;
the renderer applies `(h - hmin) * exag`. Nothing in the pack is exaggerated except where a field says so.

Grid samples are **pixel-centred**: sample `(col i, row j)` of `height.bin` sits at `x = (i + 0.5) * res_m`,
`z = (j + 0.5) * res_m` (same for `far.bin` relative to `far.origin_m`). Vectors, places and albedo are true UTM
positions, so a renderer that puts vertex `i` at `i * res_m` is half a cell (15 m) off.

## Files

| File | Content |
|---|---|
| `meta.json` | Region description (below). |
| `height.bin` | Near terrain: little-endian `uint16`, `rows × cols`, row 0 = north. `h = hmin + v / 65535 * (hmax - hmin)`. 30 m cells. |
| `far.bin` | Backdrop terrain, same encoding with its own `hmin/hmax` in `meta.far`, 120 m cells, covering a larger box. The renderer draws it under the near terrain and cuts it where the near grid exists. |
| `albedo/L{l}/{cx}_{cy}.webp` | Baked, unlit ground colour per chunk (see Chunks). Level 0 = 10 m/px; each level halves. |
| `albedo/overview.webp` | Whole near grid at 2048 px wide, for the far LOD and loading fallback. |
| `albedo/far.webp` | Backdrop colour, 2048 px wide. |
| `trees/{cx}_{cy}.bin` | Per chunk, `float32` triples `[x, z, scale]`, `scale` ≈ real tree height / 30 m. |
| `vectors.json` | Lakes, rivers, roads, buildings, routes (below). |
| `places.json` | Labelled places with their story (below). |
| `models/<slug>.glb` (+ `.attribution.txt`) | Landmark maquettes, real-metre scale, origin at ground centre, +y up, front facing −z. |
| `sky.jpg` | Equirectangular LDR sky (2048×1024), for the background only. |

## meta.json
```json
{
  "version": 1, "slug": "swat", "title": "Swat Valley", "subtitle": "Kalam · Utror · Ushu · Mahodand",
  "crs": "EPSG:32643", "origin_utm": [x_west, y_north], "res_m": 30, "cols": 2470, "rows": 2097,
  "size_m": [W, H], "hmin": 1560.0, "hmax": 5975.0,
  "chunk_cells": 128, "chunks": [ncx, ncy], "albedo_levels": 4, "albedo_px_m": 10,
  "far": {"origin_m": [x, z], "size_m": [W, H], "cols": c, "rows": r, "res_m": 120, "hmin": h0, "hmax": h1},
  "exag_default": 1.6, "tree_scale_default": 2.5, "landmark_scale_default": 30,
  "sun_default": {"azimuth_deg": 215, "elevation_deg": 12, "color": [1.0, 0.78, 0.55]},
  "home_camera": {"target": [x, y, z], "heading_deg": 5, "pitch_deg": -32, "distance_m": 52000},
  "attribution": ["Terrain © Copernicus DEM GLO-30", "..."]
}
```
`home_camera.target[1]` is a real height in metres (unexaggerated).

Optional `"neighbors": [{"slug": "swat-lower", "title": "Lower Swat", "edge": "south"}]` lists adjacent packs (`edge` = north|south|east|west, the side of *this* pack the neighbour touches). The renderer offers each neighbour in its Explore dock and at the matching map edge, and links to `?pack=<slug>`; the reverse link (`"edge": "north"`) lives in the neighbour's own meta. Packs need not share a grid; only the shared edge matters.

Optional `"areas": [{"name": "Mingora & Saidu Sharif", "camera": {"target": [x, y, z], "heading_deg": 305, "pitch_deg": -30, "distance_m": 9000}}]` lists the Explore-dock areas; `camera` has the same shape as `home_camera` (target in scene metres, `y` a real height). Each frames its key places at 8-15 km, heading chosen so a ~215 deg sun rakes from the side.

## Chunks
The near grid is split into chunks of `chunk_cells` cells (128 × 30 m = 3.84 km). Chunk `(cx, cy)` covers cells
`[cx*128, cx*128+128] × [cy*128, cy*128+128]` (inclusive edge, clamped to the grid), x from west, y from north.
Albedo level `l` for a chunk is `chunk_cells * 3 / 2^l` px square (384, 192, 96, 48) and covers exactly the chunk's
extent (edge chunks: the partial area is stretched to the full tile; the renderer uses the chunk's true size).

## vectors.json
```json
{
  "lakes":    [{"name": "...", "slug": "...|null", "level_m": 2861.5, "rings": [[[x, z], ...]]}],
  "rivers":   [{"name": "...|null", "kind": "river|stream", "width_m": 30, "pts": [[x, z], ...]}],
  "roads":    [{"name": "...|null", "class": "paved|jeep|minor|track|path", "pts": [[x, z], ...]}],
  "buildings":[{"x": 0, "z": 0, "w": 9, "d": 12, "angle_deg": 15, "roof": "gable|flat"}],
  "routes":   [{"slug": "...", "name": "...", "kind": "trek|jeep|road", "confidence": "high|medium|low",
                "length_km": 0, "ascent_m": 0, "pieces": [[[x, z], ...]]}]
}
```
Road `class`: where `data/research/swat_road_classes.json` classifies a way (upper Swat only) it decides (`jeep` = classified jeep roads); otherwise the OSM `highway` tag does: motorway/trunk/primary/secondary -> `paved`, tertiary -> `jeep`, unclassified/residential/service/living_street -> `minor` (village and city streets), track -> `track`, path/footway/steps -> `path`. Renderers must draw `minor` thinner than `paved`.
Buildings: `w` is the long side; `angle_deg` is the long axis measured from +x (east) toward +z (south).
Lake `rings[0]` is the outer ring; holes follow. Route `pieces` are the OSM-backed segments; gaps are NOT bridged.

## places.json
List of
```json
{"slug": "...", "name": "...", "name_ur": "...|null", "short_name": "...", "kind": "town|lake|peak|stupa|...", "area": "...",
 "x": 0, "z": 0, "ground_m": 2002, "label_elevation_m": 5918, "tier": 1,
 "summary": "...", "timeline": [{"date": "...", "event": "...", "source": "url"}],
 "facts": [{"text": "...", "quote": "...", "source": "url"}], "access": "...", "hidden_gem": false,
 "photos": [{"file": "photos/<slug>/01.jpg", "attribution": "Photo: X, CC BY-SA 4.0, via Wikimedia Commons", "url": "..."}],
 "model": "models/<slug>.glb|null", "confidence": "high|medium|low"}
```
`tier`: 1 towns, villages and major lakes (lakes of 0.15 km² or more, and the named major lakes); 2 peaks at or above 5,500 m (2,500 m in Lower Swat, `peak_tier2_min` in `atlas_pack.py`) and heritage sites; 3 other lakes; 4 the rest.
`label_elevation_m` follows the poster rule: the sourced value nearest the DEM summit within 250 m, else DEM.
`short_name` is the label-chip text (name without parentheticals/qualifiers, <= 22 chars, `backend/tools/shortname.py`); `name` stays for the panel.
Optional `anchor: [x, z]` + `anchor_source: "worldcover-built"` (towns/villages only): centre of the densest 300 m cell of WorldCover built-up pixels within 1.5 km of the node, present only when it has >= 40 built pixels and is > 250 m from `x, z` (which stay the OSM node); use it to place the label over the built-up area.
Photos referenced here are copied into `photos/<slug>/` inside the pack (≤ 1600 px JPEG).
