// Check web/js/viewshed.js against the Python version on the same grid:
//   node backend/tools/check_viewshed_port.mjs http://localhost:8001 hunza 36.329 74.666
import { parseHorizon, panorama, toRC } from "../../web/js/viewshed.js";

const [base, region, lat, lon] = process.argv.slice(2);
const g = parseHorizon(await (await fetch(`${base}/api/horizon/${region}`)).arrayBuffer());
const peaks = (await (await fetch(`${base}/api/peaks/${region}`)).json()).map((p) => { const [row, col] = toRC(p.lat, p.lon, g); return { ...p, row, col }; });
const near = parseHorizon(await (await fetch(`${base}/api/near/${region}`)).arrayBuffer());
const p = panorama(g, toRC(+lat, +lon, g), { peaks, near });
console.log(JSON.stringify({ elev: p.elev, peaks: p.peaks.map((s) => [s.name, Math.round(s.az * 10) / 10, Math.round(s.alt * 100) / 100]) }));
