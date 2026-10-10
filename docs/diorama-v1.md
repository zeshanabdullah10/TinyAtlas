# Diorama sites, v1

A diorama is a small tabletop model of one attraction that a visitor can drive into. It is a separate page,
`web/diorama.html?site=<site>`, and it does not touch the Atlas map or its packs. The first site is
**Mahodand Lake** (`?site=mahodand`).

The Atlas rule still holds: real data sets the facts, and only the paint is invented. Every number the page shows is
measured by the build from its inputs, and every edit to the ground is listed in `meta.edits` and shown on the page
under "How this model is made".

## What the visitor does
1. **The model.** The site sits on a walnut plinth with cut, banded edges and a brass name plate. Drag to turn it,
   scroll to zoom. The card gives the measured facts (lake level, track length, climb, time by jeep).
2. **Drive.** "Drive the last 600 m" dives the camera into the model and onto a Willys-type jeep at the start of the
   OSM track. W or ↑ is gas, S or ↓ is brake, A and D steer within the track, C changes the camera (chase, driver,
   trackside), Space toggles cruise, T (or the Pace chip) runs time 1×, 2×, 4× or 8× faster while the jeep keeps its
   real speed. On a touch screen there are on-screen pedals. The gauges show speed, real
   altitude, the distance left and the grade, with the elevation profile of the drive.
3. **Arrive.** At the end of the track the jeep stops, the camera glides low over the lake and then rises to an
   overview. From there the visitor can orbit the lake, drive again, or go back to the whole model.
4. **Tour the shore.** The lake card's main button runs a guided tour: it glides along the shore path to each
   viewpoint in turn, stops, turns to the water and holds the view for six seconds, then moves on. Any step (W A S D,
   or "Stop") takes over. **Walk it yourself** sets the visitor down at eye height where the track ends.
   W A S D walk (Shift runs), drag to look, Space or "Walk for me" follows the shore path, N or "Next viewpoint"
   glides to the next viewpoint and turns to the water. The path is traced 20 m outside the lake outline and the
   walker cannot step into the water. Viewpoints are named only by where they are: where the track ends, where a
   stream comes in (the OSM waterway end nearest the shore), the far end, and two along the shore.
   **Ride a horse** follows the shore path at a trot from the saddle; **Boat ride** is one short ride: it rows about 220 m along a route down the middle of the water (each shore point
   pushed across to the middle of the water in front of it), stops, and turns to look up the lake, seen from the stern of a
   painted wooden boat like the one in the Commons photo "Mahodand Lake 3044 (2)". On a phone, hold "Hold to go".
   **Photos from here:** near any of the geotagged Wikimedia Commons photos in `photos.json` (16, each credited with
   author, year and licence), a card shows the photo and how far from here it was taken; 📷 marks where they were taken.
5. **Life at the lake (illustrative).** Rowing boats, a camp on the flattest meadow near the water, tea stalls with
   smoke beside the end of the track, grazing horses. No source places these yet, so each carries an "illustrative"
   label. When a source turns up (OSM, research notes, credited geotagged photos), they move to the sourced places.
   They, the horse ride and the boat ride are drawn only at a lake whose site entry sets `lake_life` (Mahodand, whose
   pack card quotes "popular for boating and camping"); the other lakes have the shore walk only.
6. **Seasons.** Summer, autumn (golden meadows, red shrubs) and winter (snow on gentle ground and trees, an iced
   lake). Dawn mist forms over the basin before about 7:30. All of it is illustrative and the page says so.
7. **Opening on the lake.** `?view=lake` opens on the view from the end of the drive (the Atlas "See the lake"
   button); `?drive=1` starts the drive (the Atlas "Drive there" button).
8. **Sun.** A slider moves the sun along its July path for the site's latitude. At dusk the headlights come on.

Sound is synthesised in the browser: an engine note that follows speed and gear, gravel crunch, knocks over big
bumps, wind, water lapping that grows near the shore, footsteps, birdsong (not in winter) and distant hooves.

## Live conditions
`weather.js` asks Open-Meteo (free, no key) for the current temperature, sky, wind and three-day range, downscaled to
the arrival height (`elevation` parameter). The lake card shows it, labelled as a forecast, not a measurement.

## Navigation
Table and lake views use the Atlas gesture model: on touch one finger moves, pinch zooms and a two-finger twist
turns; with a mouse, drag turns, right-drag moves, the wheel zooms toward the cursor, and a double-click glides to
that spot. The view target stays on the model and rides the ground.

## Before you go (practical facts)
`web/data/diorama/<site>/practical.json` is optional and kept by hand. Each entry needs a source:
```json
[{ "label": "Best months", "value": "June to September", "source": "Source name", "url": "https://..." }]
```
When it exists, the lake card shows a "Before you go" list and the About dialog repeats it. Nothing is shown
without it.

## Files (`web/data/diorama/<site>/`, committed, ~1.5 MB per site)
| File | Contents |
|---|---|
| `meta.json` | grid, far ring, lake level, the drive, the rest of the track, streams, facts, edits, sources |
| `height.bin` | uint16 LE, row-major north to south, decimetres above `grid.hmin`, `grid.cell` (10 m) spacing |
| `cover.bin` | uint8 per cell: 1 tree, 2 grass, 3 bare/rock, 4 snow/ice, 5 water (the lake only), 6 moss, 7 shrub |
| `far.bin`, `farcover.bin` | the horizon ring seen from the drive, 60 m cells, half-metres above `far.hmin` |

World frame on the page: x east, z south, y up, metres, origin at the grid centre, `y = 0` at the lake level.
`meta.drive` is `[x, z, height]` every ~4 m, already smoothed; the terrain under it is cut to those heights.

## Build
```
python backend/tools/diorama_build.py mahodand --dem <DEM.tif> --worldcover <WC.tif> --osm <OSM.json>
```
Inputs (download once, not committed):
- Copernicus GLO-30 DSM tile: `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N35_00_E072_00_DEM/Copernicus_DSM_COG_10_N35_00_E072_00_DEM.tif`
- ESA WorldCover 2021 tile: `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N33E072_Map.tif`
- Overpass JSON (`out geom;`) of `way["highway"]` and `way["waterway"]` over the far box.

When a site's inputs are not at hand (OSM changes over time, so a rebuild from a fresh extract is not the same model),
`python backend/tools/diorama_meta_sync.py <site>|--all` brings only the words and switches that come from the site
entry (title, subtitle, pack, road kind, lake camp, generic edit lines) up to date; on a fresh build it changes nothing.

What the build does:
- resamples the DEM (bilinear) and WorldCover (nearest) onto the 10 m grid and the 60 m horizon ring;
- finds the lake as the WorldCover water patch holding the place point, with the inflowing river channels opened
  away, and takes the lake level as the median DEM height over it;
- chains the OSM ways of the track, cuts the drive where it first comes within 40 m of the lake, smooths it (~28 m),
  takes its profile from the DEM (smoothed over ~80 m), and cuts a bench to that profile, full width to 7 m from the
  centre line and blended out by 23 m;
- writes the facts it measured and the list of edits.

The terrain is shown at true scale with no height exaggeration.

## What is illustrative (and says so)
- The lake bed depth (no published bathymetry).
- The road bench (the DSM includes tree canopy and the 30 m grid cannot hold a 4 m track).
- Ruts, potholes, stones and washboard on the track. They come from one deterministic function (`bump()` in
  `web/js/diorama/road.js`) that both the drawn road and the jeep's wheels use, so every bump you see is one you feel.
  The grade and the line of the track are real.
- The size and number of trees, shrubs, grass tufts and boulders. Their places follow WorldCover.

## Adding an attraction
1. Add a site file, `backend/tools/diorama_sites/<site>.json`: the box (about 5 × 5 km), the lake or place seed,
   the OSM way ids of the drive and of the whole track, the drive start, and a far box about 20 km across. Mahodand
   and White Palace are the two entries in `SITES` in `backend/tools/diorama_build.py`; every other site is a site file.
2. Download the DEM and WorldCover tiles that cover the far box and an Overpass extract, run the build, and look at
   the result from the table, along the drive, and at the arrival.
3. `python -m pytest -q backend/tests/test_diorama.py` checks the files against `meta.json`, that the drive lies on
   the model, follows the cut terrain and ends at the water, and that the sources and edits are declared.

A site does not need a lake. Leave out `lake_seed` and give `"arrival": {"name": ..., "point": (lat, lon)}`: the
drive stops at the track point nearest it, `meta.lake` is `null`, `meta.arrival` is the viewpoint, the page skips the
water, boats and life, and the walk is a 150 m circle around the point (a landmark's `ring_m`, default 52 m). For a lake, `--s2 <Sentinel-2 L2A COG item
URL>` traces the outline from a recent cloud-free scene (NDWI > 0.05, thin channels opened away) instead of
WorldCover 2021. Mahodand uses scene S2C_43SBV_20250921_0_L2A: the lake is a 1.4 km ribbon, 0.08 km².

### White Palace (`?site=white-palace`)
The second site has no lake. The drive is the last 600 m of the OSM road up the Marghazar valley to the palace gate
(the build starts it where the road enters the model). OSM maps no footprint for the palace, so `meta.landmark` places
an illustrative model (`web/js/diorama/palace.js`) laid out after visitors' photos: a white house with a gabled upper
floor over a columned veranda, cream one-storey wings, a lawn with marble table sets, hedges, a metal arch, trees and
the flag. The palace itself is the Atlas TRELLIS model (`palace.glb`, from three CC BY-SA Commons photos, credited in
`palace.attribution.txt` and the sources), scaled to a 28 m front; the drawn house is the fallback. The grounds are levelled to a terrace 58 m around the place point (listed in `meta.edits`), and the walk is
a 52 m circle around the house with four viewpoints. `practical.json` quotes Wikipedia and The News. No Commons photos
yet (the API was rate-limited when it was built).

Inputs: `Copernicus_DSM_COG_10_N34_00_E072_00_DEM.tif` (the build reads the tile corner from the file name), WorldCover
N33E072, and an OSM extract from the main API (`/api/0.6/map?bbox=72.30,34.63,72.38,34.69`, converted to Overpass
`out geom` JSON).

### Landmarks, towns and heritage sites
`meta.landmark` (from the site file's `landmark`) is drawn by `web/js/diorama/landmark.js`. The White Palace keeps
`palace.js`. Any other landmark stands on the ground at its point and is made of up to two parts: `model`, a GLB next to
the site data in real metres (the Atlas maquettes of the stupas, the TRELLIS models of the museum and the Thal mosque,
credited in `landmark.sources`), and `module`, the site's own drawn geometry in `web/js/diorama/landmarks/<site>.js`
(default export `build(ctx)`; the API is in the header of `landmarks/kit.js`: seat every piece on `ctx.ground`, merge
static parts with `ctx.batch`, return `{ update }` for water or a moving lift). The front faces `heading_deg` or the
end of the drive. Site-file keys: `terrace_m` (radius of the levelled ground; 0 keeps the real slope, as for a rock
relief or a waterfall), `clear_m` (OSM buildings that are the landmark itself are dropped), `top_m`, `ring_m` (the
visitor's walking circle), `footpath`, and `edits`/`sources` (what is drawn after photos or a plan, what is
estimated). Town sites set `built_up` (WorldCover built-up is drawn as town ground, cover class 8, not rock),
`buildings_radius_m` (only the OSM buildings near the arrival, so Mingora stays light) and `road_kind: "road"` (the
page says road, not jeep track). Below about 1,700 m the trees are broadleaf; snow never lies below 3,400 m.

Inputs for every site south of 36 N: the stacked DEM (`N35` over `N34`, named with `N34`, 7,200 rows) and WorldCover
N33E072 (the build reads either the full tile or a crop with the same top-left corner). OSM comes from the main API
(`backend/tools/osm_fetch.py S W N E out.json`, Overpass shape) when Overpass is unreachable. Check a build by eye
with `backend/tools/diorama_shot.py <site> <dir> --shots table,lake,close,ground`.

### Lower Swat heritage and more attractions (Oct 2026)
Twenty more sites, each with its site file, a landmark module where one is drawn, sourced `practical.json` and
credited Commons photos: Butkara I, Butkara III, Saidu Sharif I stupa and monastery, the Swat Museum, Amluk-Dara,
Shingardar, Gumbat (Balo Kale), the Ghalegay and Jahanabad Buddhas, the Gogdara carvings, the Mahmud Ghaznavi mosque,
Raja Gira castle, Bazira (Barikot), Malam Jabba (the OSM chairlift with moving chairs), the Thal wooden mosque, the
Kumrat and Mighty 22 waterfalls, Gabin Jabba meadow, and Bashigram and Kharkhari lakes. Every drawn landmark is laid
out after the Commons photos and any published plan or size; what is estimated is said in `landmark.edits`. Notes:
- Kharkhari: the Gabral river runs through the lake, so `lake_radius_m` (260) keeps the lake apart from the river.
- Bazira: the dig is the OSM archaeological-site outline 290 m south-west of the Wikidata node; one stretch of town
  wall is drawn to show its kind, not its line.
- Bashigram: the jeep road ends at Bishigram village (sources: "jeep to Bashigram"); the 9.5 km walk is traced.
- Waterfalls: no published heights; the falls follow the mapped stream (Mighty 22) or the DEM gully (Kumrat).
- Parked: Katora Lake (no mapped road within 4.5 km of Jandrai, where the trek starts) and Chakdara Fort (its horizon
  ring runs west of the E072 DEM tile the build reads).

### Driving (both sites)
The drive is the last 600 m of the track, about a minute (`drive_km` in `SITES`; `--shorten-only` trims a built site). Traffic is
illustrative (`web/js/diorama/traffic.js`): Willys jeeps, a Hilux and motorbikes on the Mahodand track; painted
Bedford trucks, Suzuki vans, Mehran cars, CD70 motorbikes, a Qingqi rickshaw and a jeep on the Marghazar road. Road
rules: keep left; oncoming vehicles slow and squeeze past, and stop with the horn if you are on their side (wait and
they creep by); a slower vehicle ahead holds you until you sound the horn (H), then pulls left so you can pass on the
right; horns at blind bends. 4×4 low (G) is needed on pitches over 12%. Three people wait on the left verge; stop
beside them and they ride in the back. Photo (P) saves a postcard of the view. On phones the dash is a small pill,
options sit in one row (More opens the rest), and the chase camera sits further back with a wider view.

## Known limits (v1)
- The lake outline is one Sentinel-2 scene (21 Sep 2025) at 10 m; the level changes through the season.
- Shadows cover the area around the jeep while driving and around the view in the overview, not the whole valley.
- The test hook `window.__diorama.advance(seconds, keys)` steps the simulation without drawing, because headless
  software GL runs at under 1 fps.
