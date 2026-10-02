// Loads an Atlas pack (docs/atlas-pack-v1.md) and answers height questions in real and scene metres.
import * as THREE from "three";

async function get(url, kind) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return kind === "json" ? r.json() : r.arrayBuffer();
}

function decode(buf, hmin, hmax) {
  const u = new Uint16Array(buf), out = new Float32Array(u.length), k = (hmax - hmin) / 65535;
  for (let i = 0; i < u.length; i++) out[i] = hmin + u[i] * k;
  return out;
}

export async function loadPack(base, progress = () => {}) {
  if (!base.endsWith("/")) base += "/";
  const meta = await get(base + "meta.json", "json");
  const steps = ["height.bin", "far.bin", "vectors.json", "places.json"];
  let done = 0;
  const tick = (label) => progress(++done / steps.length, label);
  const [hb, fb, vectors, places] = await Promise.all([
    get(base + "height.bin").then((r) => (tick("terrain"), r)),
    get(base + "far.bin").catch(() => null).then((r) => (tick("backdrop"), r)),
    get(base + "vectors.json", "json").catch(() => ({})).then((r) => (tick("water and roads"), r)),
    get(base + "places.json", "json").catch(() => []).then((r) => (tick("places"), r)),
  ]);
  return new Pack(base, meta, hb, fb, vectors, places);
}

export class Pack {
  constructor(base, meta, hb, fb, vectors, places) {
    Object.assign(this, { base, meta, vectors, places });
    this.cols = meta.cols; this.rows = meta.rows; this.res = meta.res_m;
    this.hmin = meta.hmin; this.hmax = meta.hmax;
    this.hm = decode(hb, meta.hmin, meta.hmax);
    this.W = this.cols * this.res; this.H = this.rows * this.res;   // pixel extents; samples are pixel-centred
    this.o = this.res / 2;
    this.exag = meta.exag_default ?? 1.6;
    this.far = null;
    if (fb && meta.far) {
      const f = meta.far;
      this.far = { ...f, hm: decode(fb, f.hmin, f.hmax) };
    }
    this.slug = meta.slug; this.chunkCells = meta.chunk_cells; this.ncx = meta.chunks[0]; this.ncy = meta.chunks[1];
    this.sun = meta.sun_default;
  }

  /** Real height in metres at scene (x, z); falls back to the backdrop outside the near grid. */
  heightAt(x, z) {
    const { cols, rows, res, hm } = this;
    if (x < this.o || z < this.o || x > this.W - this.o || z > this.H - this.o) return this.farHeightAt(x, z);
    const fx = x / res - 0.5, fz = z / res - 0.5;
    const i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j, o = j * cols + i;
    const a = hm[o], b = hm[o + 1], c = hm[o + cols], d = hm[o + cols + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  farHeightAt(x, z) {
    const f = this.far;
    if (!f) return this.hmin;
    const fx = Math.min(f.cols - 1.001, Math.max(0, (x - f.origin_m[0]) / f.res_m - 0.5));
    const fz = Math.min(f.rows - 1.001, Math.max(0, (z - f.origin_m[1]) / f.res_m - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, o = j * f.cols + i, h = f.hm;
    const a = h[o], b = h[o + 1], c = h[o + f.cols], d = h[o + f.cols + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz - 20;
  }

  /** Scene y (exaggerated) of the ground at (x, z). */
  groundY(x, z) { return (this.heightAt(x, z) - this.hmin) * this.exag; }
  yOf(realM) { return (realM - this.hmin) * this.exag; }

  /** Cell rectangle of chunk (cx, cy) in cells and metres. Edge chunks are clamped to the grid. */
  chunkRect(cx, cy) {
    const n = this.chunkCells;
    const nx = Math.min(n, this.cols - 1 - cx * n), nz = Math.min(n, this.rows - 1 - cy * n);
    return { nx, nz, x0: (cx * n + 0.5) * this.res, z0: (cy * n + 0.5) * this.res, w: nx * this.res, h: nz * this.res };
  }

  /** First ground hit of a ray (origin, unit dir) or null. Marches with a growing step, then bisects. */
  raycastGround(origin, dir, maxT = 400000) {
    let t = 0, prev = 0;
    const below = (p) => p.y < this.groundY(p.x, p.z);
    const p = new THREE.Vector3();
    while (t < maxT) {
      p.copy(dir).multiplyScalar(t).add(origin);
      if (below(p)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          p.copy(dir).multiplyScalar(mid).add(origin);
          if (below(p)) hi = mid; else lo = mid;
        }
        return p.copy(dir).multiplyScalar(hi).add(origin).clone();
      }
      prev = t;
      t += Math.max(15, t * 0.004);
    }
    return null;
  }

  /** Is `to` hidden behind the relief as seen from `from`? (heightfield ray march, ends excluded) */
  occluded(from, to, slack = 25) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz), n = Math.min(96, Math.max(8, Math.round(len / 120)));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (t > 0.97) break;
      const x = from.x + dx * t, z = from.z + dz * t;
      if (from.y + dy * t < this.groundY(x, z) - slack - len * 0.002 * Math.min(1, (1 - t) * 6)) return true;
    }
    return false;
  }

  tileUrl(l, cx, cy) { return `${this.base}albedo/L${l}/${cx}_${cy}.webp`; }
  setExag(e) { this.exag = e; }
}
