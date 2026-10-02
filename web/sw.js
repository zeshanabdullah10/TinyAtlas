// Offline support. The app shell (HTML, CSS, JS, three.js, fonts) is cached as it is used; a place's data is cached
// in full when the visitor presses "Save for offline" (the page posts the list of URLs). Place data is served from
// the cache first when saved; everything else goes to the network first and falls back to the cache.

const SHELL = "tinyatlas-shell-v2";
const DATA = "tinyatlas-data-v1";
// The site may live under a subpath (GitHub Pages); the scope knows where it is ("/" at a domain root).
const BASE = new URL(self.registration.scope).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, `${BASE}index.html`, `${BASE}css/tokens.css`, `${BASE}css/home.css`, `${BASE}js/main.js`, `${BASE}js/home.js`,
    `${BASE}js/api.js`, `${BASE}js/dom.js`, `${BASE}data/home.json`, `${BASE}img/hero-1600.webp`, `${BASE}img/hero-800.webp`, `${BASE}manifest.webmanifest`,
    `${BASE}icon.svg`, `${BASE}atlas.html`, `${BASE}css/atlas.css`]))   // home + the Atlas shell; js/atlas/*.js and the rest are cached as they are used, or by "Save for offline"
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("tinyatlas-shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("message", (e) => {
  if (e.data?.type !== "save") return;
  const { urls, id } = e.data;
  e.waitUntil((async () => {
    const cache = await caches.open(DATA);
    let done = 0, failed = 0;
    for (const url of urls) {
      try { const r = await fetch(url, { cache: "reload" }); if (!r.ok) throw new Error(r.status); await cache.put(url, r); }
      catch { failed++; }
      done++;
      if (done % 5 === 0 || done === urls.length) e.source?.postMessage({ type: "save-progress", id, done, failed, total: urls.length });
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cdn = /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (url.origin !== location.origin && !cdn) return;
  const rel = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length - 1) : url.pathname;  // "/"-rooted again
  const isData = rel.startsWith("/packs/") || rel.startsWith("/api/");
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit && (cdn || rel.startsWith("/packs/") || /\.(png|jpg|webp|m4a|bin)$|\/audio-file\//.test(rel))) return hit;
    try {
      const r = await fetch(req);
      if (r.ok && (!isData || hit)) (await caches.open(isData ? DATA : SHELL)).put(req, r.clone());   // refresh what is saved
      return r;
    } catch {
      return hit || (req.mode === "navigate" ? (await caches.match(req, { ignoreSearch: true })) || caches.match(`${BASE}index.html`) : Response.error());   // atlas.html?pack=… matches its saved page
    }
  })());
});
