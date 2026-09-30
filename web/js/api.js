// Thin client for the Tiny Atlas backend.

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

export const api = {
  regions: () => json("/api/regions"),
  region: (slug) => json(`/api/region/${slug}`),
  geocode: (q) => json(`/api/geocode?q=${encodeURIComponent(q)}`),
  build: (body) => post("/api/build", body),
  job: (id) => json(`/api/jobs/${id}`),
  remove: (slug) => json(`/api/regions/${slug}`, { method: "DELETE" }),
  landmarks: (slug) => json(`/api/landmarks/${slug}`),
  itinerary: (slug) => json(`/api/itinerary/${slug}`),
  story: (slug, lm) => json(`/api/story/${slug}/${lm}`),
  ask: (slug, question, history) => post(`/api/guide/${slug}`, { question, history }),
  status: () => json("/api/status"),
  terrain: async (slug, size = 320) => {
    const r = await fetch(`/api/terrain/${slug}?size=${size}`);
    if (!r.ok) throw new Error(`terrain ${r.status}`);
    return r.arrayBuffer();
  },
};
