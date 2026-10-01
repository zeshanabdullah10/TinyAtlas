// Height-grid derived lighting data: a gradient/curvature texture (crisp normals at any mesh LOD) and a
// horizon-sweep sun shadow texture that gives long cast shadows across the whole map.
import * as THREE from "three";

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function f2h(f) {                       // float32 -> float16 bits (no denormals; plenty for slopes)
  f32[0] = f;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7bff;
  return s | (e << 10) | ((x >>> 13) & 0x3ff);
}

/** Subsampled grid with a half-float texture of (dh/dx, dh/dz, curvature, 0) in real units. */
export function buildGrid(pack, stride = 1) {
  const { cols, rows, hm, res } = pack;
  const w = Math.ceil(cols / stride), h = Math.ceil(rows / stride), cs = res * stride;
  const hs = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hs[j * w + i] = hm[Math.min(rows - 1, j * stride) * cols + Math.min(cols - 1, i * stride)];
  const data = new Uint16Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const jm = Math.max(0, j - 1) * w, jp = Math.min(h - 1, j + 1) * w, jc = j * w;
    for (let i = 0; i < w; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(w - 1, i + 1), c = hs[jc + i];
      const l = hs[jc + im], r = hs[jc + ip], u = hs[jm + i], d = hs[jp + i];
      const o = (jc + i) * 4;
      data[o] = f2h((r - l) / (2 * cs));
      data[o + 1] = f2h((d - u) / (2 * cs));
      data[o + 2] = f2h((l + r + u + d - 4 * c) / (2 * cs));
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  return { w, h, stride, cs, hs, grad: tex };
}

/** Sun shadow term over the grid: 255 = lit. The surface "shadow height" is swept along the sun azimuth. */
export function sweepShadow(grid, az, el, exag = 1, out = null) {
  const { w, h, hs, cs } = grid;
  const n = w * h;
  if (!out) out = new Uint8Array(n);
  if (el <= 0.3) { out.fill(0); return out; }
  const a = (az * Math.PI) / 180, sx = Math.sin(a), sz = -Math.cos(a), tanE = Math.tan((el * Math.PI) / 180);
  const S = new Float32Array(n);
  const rowMajor = Math.abs(sz) >= Math.abs(sx);
  const major = rowMajor ? sz : sx, minor = rowMajor ? sx : sz, dir = Math.sign(major) || 1;
  const off = minor / Math.abs(major), rise = (tanE * cs) / Math.abs(major) / exag;   // per step of one cell along the major axis
  const nMaj = rowMajor ? h : w, nMin = rowMajor ? w : h;
  const idx = rowMajor ? (maj, mn) => maj * w + mn : (maj, mn) => mn * w + maj;
  for (let k = 0; k < nMaj; k++) {
    const maj = dir > 0 ? nMaj - 1 - k : k, up = maj + dir;   // the cell one step towards the sun is already done
    for (let mn = 0; mn < nMin; mn++) {
      const o = idx(maj, mn), hh = hs[o];
      let sup = -1e9;
      if (up >= 0 && up < nMaj) {
        const m = mn + off, m0 = Math.floor(m), t = m - m0;
        const a0 = Math.min(nMin - 1, Math.max(0, m0)), a1 = Math.min(nMin - 1, Math.max(0, m0 + 1));
        sup = S[idx(up, a0)] * (1 - t) + S[idx(up, a1)] * t - rise;
      }
      S[o] = sup > hh ? sup : hh;
      const cover = sup - hh;                     // metres of relief between this cell and the sun
      const v = cover <= -4 ? 1 : cover >= 60 ? 0 : 1 - (cover + 4) / 64;
      out[o] = Math.round(v * v * (3 - 2 * v) * 255);
    }
  }
  return out;
}
