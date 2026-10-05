// Diorama site data (web/data/diorama/<site>/, built by backend/tools/diorama_build.py).
// World frame: x east, z south, y up, metres; y = 0 is the measured lake level.

export async function loadSite(base, onProgress = () => {}) {
  const get = async (f, kind) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    onProgress(f);
    return kind === "json" ? r.json() : r.arrayBuffer();
  };
  const [meta, hb, cb, fb, fcb] = await Promise.all([
    get("meta.json", "json"), get("height.bin"), get("cover.bin"), get("far.bin"), get("farcover.bin")]);
  const g = meta.grid, f = meta.far, Y0 = meta.lake.level;
  const H = new Float32Array(g.cols * g.rows), raw = new Uint16Array(hb);
  for (let i = 0; i < H.length; i++) H[i] = g.hmin + raw[i] / 10 - Y0;
  const FH = new Float32Array(f.cols * f.rows), fraw = new Uint16Array(fb);
  for (let i = 0; i < FH.length; i++) FH[i] = f.hmin + fraw[i] * f.scale - Y0;
  const C = new Uint8Array(cb), FC = new Uint8Array(fcb);

  const x0 = -g.width / 2, z0 = -g.height / 2;
  function nearAt(x, z) {
    const c = Math.min(Math.max((x - x0) / g.cell, 0), g.cols - 1.001), r = Math.min(Math.max((z - z0) / g.cell, 0), g.rows - 1.001);
    const c0 = c | 0, r0 = r | 0, tx = c - c0, tz = r - r0, i = r0 * g.cols + c0;
    return H[i] * (1 - tx) * (1 - tz) + H[i + 1] * tx * (1 - tz) + H[i + g.cols] * (1 - tx) * tz + H[i + g.cols + 1] * tx * tz;
  }
  function farAt(x, z) {
    const c = Math.min(Math.max((x - f.x0) / f.cell, 0), f.cols - 1.001), r = Math.min(Math.max((z - f.z0) / f.cell, 0), f.rows - 1.001);
    const c0 = c | 0, r0 = r | 0, tx = c - c0, tz = r - r0, i = r0 * f.cols + c0;
    return FH[i] * (1 - tx) * (1 - tz) + FH[i + 1] * tx * (1 - tz) + FH[i + f.cols] * (1 - tx) * tz + FH[i + f.cols + 1] * tx * tz;
  }
  const inside = (x, z) => Math.abs(x) <= g.width / 2 && Math.abs(z) <= g.height / 2;
  const heightAt = (x, z) => (inside(x, z) ? nearAt(x, z) : farAt(x, z));
  const coverAt = (x, z) => {
    if (!inside(x, z)) return 0;
    const c = Math.round((x - x0) / g.cell), r = Math.round((z - z0) / g.cell);
    return C[r * g.cols + c];
  };
  return { meta, Y0, H, C, FH, FC, heightAt, coverAt, inside, x0, z0 };
}

/** Deterministic random in [0, 1) from integers (placement must not change between visits). */
export function hash(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
