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
2. **Drive.** "Drive the last 3.5 km" dives the camera into the model and onto a Willys-type jeep at the start of the
   OSM track. W or ↑ is gas, S or ↓ is brake, A and D steer within the track, C changes the camera (chase, driver,
   trackside), Space toggles cruise. On a touch screen there are on-screen pedals. The gauges show speed, real
   altitude, the distance left and the grade, with the elevation profile of the drive.
3. **Arrive.** At the end of the track the jeep stops, the camera glides low over the lake and then rises to an
   overview. From there the visitor can orbit the lake, drive again, or go back to the whole model.
4. **Sun.** A slider moves the sun along its July path for the site's latitude. At dusk the headlights come on.

Sound is synthesised in the browser: an engine note that follows speed and gear, gravel crunch, knocks over big
bumps, wind, and water near the lake.

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
1. Add an entry to `SITES` in `backend/tools/diorama_build.py`: the box (about 5 × 5 km), the lake or place seed,
   the OSM way ids of the drive and of the whole track, the drive start, and a far box about 20 km across.
2. Download the DEM and WorldCover tiles that cover the far box and an Overpass extract, run the build, and look at
   the result from the table, along the drive, and at the arrival.
3. `python -m pytest -q backend/tests/test_diorama.py` checks the files against `meta.json`, that the drive lies on
   the model, follows the cut terrain and ends at the water, and that the sources and edits are declared.

Sites that are not lakes need a different arrival target (a viewpoint, a stupa). `arrive()` in `main.js` assumes
the lake mesh. Generalising that is the first job for the second site.

## Known limits (v1)
- The lake outline is WorldCover 2021 at 10 m, softened. OSM had no lake polygon in the extract used.
- Shadows cover the area around the jeep while driving and around the view in the overview, not the whole valley.
- The test hook `window.__diorama.advance(seconds, keys)` steps the simulation without drawing, because headless
  software GL runs at under 1 fps.
