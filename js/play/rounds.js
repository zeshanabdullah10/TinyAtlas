// Pure game logic for "Where is this view?". No DOM here, so it can be checked in node.
// Coordinates are pack metres: x = E - origin_E, z = origin_N - N (same frame as the atlas).

export const ROUNDS_PER_GAME = 10;
export const MAX_POINTS = 5000;
const STORE_KEY = "tinyatlas.play.best.v1";

/** Pick n distinct rounds at random (Fisher-Yates on a copy). */
export function pickRounds(all, n = ROUNDS_PER_GAME, rnd = Math.random) {
  const a = all.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

/** Distance in km between two points in pack metres. */
export function distanceKm(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) / 1000;
}

/** Points for a guess: full marks at 0 km, falling off exponentially (about 37% left at 300 km). */
export function scoreFor(km) {
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round(MAX_POINTS * Math.exp(-km / 300));
}

/** Map a point on the mini map (pixels inside a w×h box) to pack metres over the grid [0,sx]×[0,sz]. */
export function pixelToWorld(px, py, w, h, size) {
  const x = Math.min(size[0], Math.max(0, (px / w) * size[0]));
  const z = Math.min(size[1], Math.max(0, (py / h) * size[1]));
  return { x, z };
}

/** Pack metres to a pixel position on the mini map. */
export function worldToPixel(p, w, h, size) {
  return { px: (p.x / size[0]) * w, py: (p.z / size[1]) * h };
}

/**
 * Four choices for easy mode: the answer plus three other places of the same pack that sit on the grid.
 * Returns an array of places (the answer included), shuffled.
 */
export function makeChoices(answer, places, size, rnd = Math.random) {
  const pool = places.filter((p) => p.slug !== answer.slug && p.x >= 0 && p.x <= size[0] && p.z >= 0 && p.z <= size[1]
    && p.name && typeof p.x === "number" && typeof p.z === "number");
  const picks = [];
  const seen = new Set([answer.slug]);
  while (picks.length < 3 && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    const [p] = pool.splice(i, 1);
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    picks.push({ slug: p.slug, name: p.name, x: p.x, z: p.z });
  }
  const all = [{ slug: answer.slug, name: answer.name, x: answer.x, z: answer.z }, ...picks];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

/** Best score so far, read from localStorage. Any failure gives the default. */
export function loadBest(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage.getItem(STORE_KEY) || "null");
    if (v && Number.isFinite(v.best) && Number.isFinite(v.games)) return v;
  } catch { /* private mode, blocked storage or bad JSON */ }
  return { best: 0, games: 0 };
}

/** Record a finished game. Returns the stored record. */
export function saveGame(total, storage = globalThis.localStorage) {
  const cur = loadBest(storage);
  const next = { best: Math.max(cur.best, total), games: cur.games + 1 };
  try { storage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep it in memory only */ }
  return next;
}
