// Thin client for the Tiny Atlas backend.
// In a static build (window.TINYATLAS.static) everything about a place comes from its pack under /packs/<slug>/,
// and only live features (the guide) go to the API at window.TINYATLAS.api.

const CONFIG = window.TINYATLAS || {};
export const STATIC = !!CONFIG.static;
// Path prefix when the static site is deployed under a subpath (GitHub Pages: "/tinyatlas/"); "" at a domain root.
export const BASE = CONFIG.base || "";
const LIVE = (CONFIG.api || "").replace(/\/$/, "");

async function json(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).detail; } catch { /* not JSON */ }
    const err = new Error(detail || `${r.status} ${r.statusText}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

const post = (url, body) => json(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const pack = (slug, file) => `${BASE}packs/${encodeURIComponent(slug)}/${file}`;
const once = new Map();
const cached = (url) => { if (!once.has(url)) once.set(url, json(url).catch((e) => { once.delete(url); throw e; })); return once.get(url); };
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });

const server = {
  regions: () => json("/api/regions"),
  region: (slug) => json(`/api/region/${slug}`),
  landmarks: (slug) => json(`/api/landmarks/${slug}`),
  itinerary: (slug) => json(`/api/itinerary/${slug}`),
  story: (slug, lm) => json(`/api/story/${slug}/${lm}`),
  terrainUrl: (slug, size) => `/api/terrain/${slug}?size=${size}`,
  views: (slug) => json(`/api/views/${slug}`),
  facts: (slug) => json(`/api/facts/${slug}`),
  pois: (slug) => json(`/api/pois/${slug}`),
  audio: (slug) => json(`/api/audio/${slug}`),
  audioUrl: (slug, name) => `/api/audio-file/${slug}/${name}`,
  /** Everything a place needs to work with no connection (fetched into the cache by "Save for offline"). */
  offlineUrls: async (slug) => {
    const [info, views, audio] = await Promise.all([json(`/api/region/${slug}`), json(`/api/views/${slug}`), json(`/api/audio/${slug}`)]);
    const lms = await json(`/api/landmarks/${slug}`);
    return [`/api/region/${slug}`, `/api/regions`, `/api/terrain/${slug}?size=320`, `/api/landmarks/${slug}`, `/api/itinerary/${slug}`,
      `/api/horizon/${slug}`, `/api/near/${slug}`, `/api/peaks/${slug}`, `/api/views/${slug}`, `/api/facts/${slug}`, `/api/pois/${slug}`,
      `/api/audio/${slug}`, `/api/status`, ...info.seasons.map((s) => `/api/texture/${slug}?season=${s}`),
      ...lms.filter((l) => l.model).map((l) => `/models/${l.slug}.glb`),
      ...lms.map((l) => `/api/story/${slug}/${l.slug}`),
      ...views.flatMap((v) => Object.values(v.images).flatMap((t) => Object.values(t))).map((n) => `/api/view-image/${slug}/${n}`),
      ...Object.values(audio).flatMap((ls) => Object.values(ls)).map((c) => `/api/audio-file/${slug}/${c.file}`)];
  },
  viewImageUrl: (slug, name) => `/api/view-image/${slug}/${name}`,
  horizonUrl: (slug) => `/api/horizon/${slug}`,
  nearUrl: (slug) => `/api/near/${slug}`,
  peaks: (slug) => json(`/api/peaks/${slug}`),
  textureUrl: (slug, season = "summer") => `/api/texture/${slug}?season=${season}`,
  thumbUrl: (slug, w) => `/api/thumb/${slug}?w=${w}`,
};

const packs = {
  regions: () => cached(`${BASE}packs/index.json`),
  region: async (slug) => { const r = (await cached(`${BASE}packs/index.json`))[slug]; if (!r) throw notFound("place"); return cached(pack(slug, "region.json")); },
  landmarks: (slug) => cached(pack(slug, "landmarks.json")),
  itinerary: (slug) => cached(pack(slug, "itinerary.json")),
  story: async (slug, lm) => { const s = (await cached(pack(slug, "stories.json")))[lm]; if (!s) throw notFound("story"); return s; },
  terrainUrl: (slug) => pack(slug, "terrain.bin"),
  views: (slug) => cached(pack(slug, "views.json")),
  facts: (slug) => cached(pack(slug, "facts.json")),
  pois: (slug) => cached(pack(slug, "pois.json")),
  audio: (slug) => cached(pack(slug, "audio.json")),
  audioUrl: (slug, name) => pack(slug, `audio/${name}`),
  offlineUrls: async (slug) => {
    const [m, lms] = await Promise.all([cached(pack(slug, "manifest.json")), cached(pack(slug, "landmarks.json"))]);
    return [`${BASE}packs/index.json`, ...Object.keys(m.files).map((f) => pack(slug, f)),
      ...lms.filter((l) => l.model).map((l) => `${BASE}models/${l.slug}.glb`)];
  },
  viewImageUrl: (slug, name) => pack(slug, `views/${name}`),
  horizonUrl: (slug) => pack(slug, "horizon.bin"),
  nearUrl: (slug) => pack(slug, "near.bin"),
  peaks: (slug) => cached(pack(slug, "peaks.json")),
  textureUrl: (slug, season = "summer") => pack(slug, `texture_${season}.webp`),
  thumbUrl: (slug) => pack(slug, "thumb.jpg"),
};

const src = STATIC ? packs : server;

export const api = {
  ...src,
  geocode: (q) => json(`/api/geocode?q=${encodeURIComponent(q)}`),
  build: (body) => post("/api/build", body),
  job: (id) => json(`/api/jobs/${id}`),
  remove: (slug) => json(`/api/regions/${slug}`, { method: "DELETE" }),
  ask: (slug, question, history) => post(`${LIVE}/api/guide/${slug}`, { question, history }),
  plan: (slug, body) => post(`${LIVE}/api/plan/${slug}`, body),
  status: () => (STATIC && !LIVE ? Promise.resolve({ llm: false, offline: true }) : json(`${LIVE}/api/status`)),
  /** The panorama's grids: [wide ArrayBuffer, near ArrayBuffer]. */
  horizon: (slug) => Promise.all([src.horizonUrl(slug), src.nearUrl(slug)].map(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw Object.assign(new Error(`horizon ${r.status}`), { status: r.status });
    return r.arrayBuffer();
  })),
  terrain: async (slug, size = 320) => {
    const r = await fetch(src.terrainUrl(slug, size));
    if (!r.ok) throw Object.assign(new Error(`terrain ${r.status}`), { status: r.status });
    return r.arrayBuffer();
  },
};
