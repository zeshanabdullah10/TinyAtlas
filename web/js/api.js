// Thin client for the Tiny Atlas backend.
// In a static build (window.TINYATLAS.static) places come from their packs under <base>packs/<slug>/atlas/, and only the
// planner (and the audio list, when clips exist) go elsewhere: the planner to the live server at window.TINYATLAS.api.

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

const server = {
  audio: (slug) => json(`/api/audio/${slug}`),
  audioUrl: (slug, name) => `/api/audio-file/${slug}/${name}`,
};
const packs = {
  audio: (slug) => cached(pack(slug, "audio.json")),
  audioUrl: (slug, name) => pack(slug, `audio/${name}`),
};

export const api = {
  ...(STATIC ? packs : server),
  plan: (slug, body) => post(`${LIVE}/api/plan/${slug}`, body),
  status: () => (STATIC && !LIVE ? Promise.resolve({ llm: false, offline: true }) : json(`${LIVE}/api/status`)),
};
