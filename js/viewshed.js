// What can you see from here: a line-for-line port of backend/tinyatlas/viewshed.py. Keep the two in step.
// Distances are metres, angles degrees; azimuth clockwise from north. Grids are row 0 = north, col 0 = west.

const EARTH_R = 6371000, REFRACTION = 0.13;
export const BANDS_M = [2000, 5000, 10000, 20000, 40000, 90000];
export const AZ_STEP = 0.25, EYE_M = 1.7;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

/** Parse /api/horizon (or a pack's horizon.bin) into {hm, rows, cols, size: [w, h], bbox}. */
export function parseHorizon(buf) {
  const dv = new DataView(buf);
  const rows = dv.getUint32(0, true), cols = dv.getUint32(4, true);
  const size = [dv.getFloat32(8, true), dv.getFloat32(12, true)];
  const bbox = [0, 1, 2, 3].map((i) => dv.getFloat64(16 + i * 8, true));
  const raw = new Int16Array(buf.slice(48, 48 + rows * cols * 2));
  return { hm: Float32Array.from(raw), rows, cols, size, bbox };
}

export const toRC = (lat, lon, g) => { const [w, s, e, n] = g.bbox; return [(n - lat) / (n - s) * (g.rows - 1), (lon - w) / (e - w) * (g.cols - 1)]; };

export function sample(g, r, c) {
  if (!(r >= 0 && r <= g.rows - 1 && c >= 0 && c <= g.cols - 1)) return NaN;
  const r0 = Math.floor(r), c0 = Math.floor(c), r1 = Math.min(r0 + 1, g.rows - 1), c1 = Math.min(c0 + 1, g.cols - 1);
  const fr = r - r0, fc = c - c0, at = (y, x) => g.hm[y * g.cols + x];
  return (at(r0, c0) * (1 - fc) + at(r0, c1) * fc) * (1 - fr) + (at(r1, c0) * (1 - fc) + at(r1, c1) * fc) * fr;
}

/** Height at wide-grid position (r, c): from the finer `near` grid wherever it reaches, else from the wide grid. */
function height(g, near, r, c) {
  if (near) {
    const [w, s, e, n] = g.bbox, lat = n - r / (g.rows - 1) * (n - s), lon = w + c / (g.cols - 1) * (e - w);
    const [nr, nc] = toRC(lat, lon, near), h = sample(near, nr, nc);
    if (!Number.isNaN(h)) return h;
  }
  return sample(g, r, c);
}

export function distances(maxM, n = 480, first = 40) {
  return Float64Array.from({ length: n }, (_, i) => first * (maxM / first) ** (i / (n - 1)));
}
export const drop = (d) => (d * d) / (2 * EARTH_R) * (1 - REFRACTION);

/** Skyline layers and visible peaks from grid position [r0, c0]. peaks: [{name, ele, row, col}] (ele may be null).
 *  `near` is an optional finer grid (parseHorizon of /api/near) used wherever it reaches. */
export function panorama(g, [r0, c0], { eye = EYE_M, peaks = [], azStep = AZ_STEP, near = null } = {}) {
  const dy = g.size[1] / (g.rows - 1), dx = g.size[0] / (g.cols - 1);
  const at = (r, c) => height(g, near, r, c);
  const h0 = at(r0, c0) + eye;
  const ds = distances(Math.max(...g.size) * 0.75), N = ds.length;
  const bandIdx = BANDS_M.map((b) => { let i = 0; while (i < N && ds[i] < b) i++; return Math.max(0, i - 1); });
  const nAz = Math.round(360 / azStep), bands = BANDS_M.map(() => new Float32Array(nAz));
  const drops = ds.map(drop);
  for (let k = 0; k < nAz; k++) {
    const a = rad(k * azStep), cr = -Math.cos(a) / dy, cc = Math.sin(a) / dx;
    let run = -90, b = 0;
    for (let i = 0; i < N; i++) {
      const h = at(r0 + cr * ds[i], c0 + cc * ds[i]);
      if (!Number.isNaN(h)) run = Math.max(run, deg(Math.atan2(h - drops[i] - h0, ds[i])));
      while (b < BANDS_M.length && bandIdx[b] === i) bands[b++][k] = run;
    }
    while (b < BANDS_M.length) bands[b++][k] = run;
  }
  const seen = [];
  for (const p of peaks) {
    const north = (r0 - p.row) * dy, east = (p.col - c0) * dx, dist = Math.hypot(north, east);
    if (dist < 200 || dist > ds[N - 1]) continue;
    const az = ((deg(Math.atan2(east, north)) % 360) + 360) % 360;
    const ele = p.ele ?? sample(g, p.row, p.col);
    const alt = deg(Math.atan2(ele - drop(dist) - h0, dist));
    const a = rad(az); let block = -90;
    const front = dist - Math.max(3 * Math.max(dx, dy), 0.03 * dist);      // leave out the summit's own cells
    for (let i = 0; i < N && ds[i] < front; i++) {
      const h = at(r0 - Math.cos(a) * ds[i] / dy, c0 + Math.sin(a) * ds[i] / dx);
      if (!Number.isNaN(h)) block = Math.max(block, deg(Math.atan2(h - drops[i] - h0, ds[i])));
    }
    if (alt >= block - 0.05) seen.push({ name: p.name, ele: Math.round(ele), az, alt, dist: Math.round(dist) });
  }
  seen.sort((x, y) => x.az - y.az);
  return { elev: Math.round(h0 - eye), azStep, bands, peaks: seen };
}
