// Offline support. Two caches:
//   SHELL  the app (HTML, CSS, JS, fonts, three.js from the CDN). Filled as pages are used and by "Save for offline"; bump the
//          version below on every release that changes a shell file: the new worker re-fetches everything the old shell held
//          (so a saved Atlas keeps working offline after an update) and the old shell is deleted.
//   DATA   what a visitor saved: an Atlas pack (/packs/...) or a diorama (/data/diorama/<site>/...). Served from the cache first
//          (instant, works with no signal); when online the saved copy is checked in the background and files that changed
//          on the server are fetched again: packs by comparing files.json (bytes and hash per file), dioramas by the
//          ETag / Last-Modified / Content-Length of each saved file.
// The page tells the worker what to keep with {type:"save", urls, id}; progress comes back as {type:"save-progress"}.

const SHELL = "tinyatlas-shell-v7";   // v7: self-hosted fonts, diorama offline, background pack refresh; v6: shared header, site models, planner, trip kit print, PNG icons
const DATA = "tinyatlas-data-v1";
// The site may live under a subpath (GitHub Pages); the scope knows where it is ("/" at a domain root).
const BASE = new URL(self.registration.scope).pathname;
const CORE = ["", "index.html", "css/tokens.css", "css/home.css", "css/i18n.css", "js/main.js", "js/home.js", "js/api.js", "js/dom.js", "js/i18n.js", "data/home.json", "data/dioramas.json",
  "img/hero-1600.webp", "img/hero-800.webp", "manifest.webmanifest", "icon.svg", "img/icon-192.png", "atlas.html", "css/atlas.css",
  "fonts/fonts.css", "fonts/cormorant-sc-600-latin.woff2", "fonts/cormorant-sc-700-latin.woff2", "fonts/schibsted-grotesk-latin.woff2", "fonts/literata-latin.woff2"].map((p) => BASE + p);

const rel = (u) => (u.pathname.startsWith(BASE) ? u.pathname.slice(BASE.length - 1) : u.pathname);   // "/"-rooted again
const isDataPath = (r) => r.startsWith("/packs/") || r.startsWith("/api/") || /^\/data\/diorama\/[^/]+\/[^/]+$/.test(r);   // a diorama's own files; data/diorama/herders.json is shared and counts as app data
const keyOf = (u) => { try { return new URL(u, location.href); } catch { return null; } };
const sameOrigin = (u) => u.origin === location.origin;
const mapPool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); };
const say = async (msg) => { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg); };

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(CORE);                                   // the home page and the Atlas shell: if these fail the install fails and the old worker stays
    const old = (await caches.keys()).filter((k) => k.startsWith("tinyatlas-shell-") && k !== SHELL);
    const seen = new Set(CORE);
    for (const k of old.sort().reverse()) {                    // everything else the old shell held (saved Atlas and diorama code, three.js) comes along, fresh
      const oc = await caches.open(k);
      const reqs = (await oc.keys()).filter((r) => !seen.has(r.url) && (seen.add(r.url), true));
      await mapPool(reqs, 6, async (r) => {
        try {
          if (sameOrigin(new URL(r.url))) { const res = await fetch(r.url, { cache: "reload" }); if (res.ok) await cache.put(r, res); }
          else { const res = await oc.match(r); if (res) await cache.put(r, res); }
        } catch { const res = await oc.match(r); if (res) await cache.put(r, res).catch(() => {}); }   // offline during the update: keep the old copy
      });
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("tinyatlas-") && k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// ---- saving
self.addEventListener("message", (e) => {
  if (e.data?.type !== "save") return;
  const { urls, id } = e.data;
  e.waitUntil((async () => {
    const [shell, data] = await Promise.all([caches.open(SHELL), caches.open(DATA)]);
    let done = 0, failed = 0;
    await mapPool([...new Set(urls)], 4, async (url) => {
      try {
        const u = new URL(url, location.href), r = await fetch(url, { cache: "reload" });
        if (!r.ok) throw new Error(r.status);
        await (sameOrigin(u) && isDataPath(rel(u)) ? data : shell).put(url, r);   // code and fonts go with the shell (renewed on release); data stays in DATA
      } catch { failed++; }
      done++;
      if (done % 5 === 0 || done === urls.length) e.source?.postMessage({ type: "save-progress", id, done, failed, total: urls.length });
    });
  })());
});

// ---- keeping saved data current
const checked = new Map();
const due = (k, ms) => { const t = Date.now(); if (t - (checked.get(k) || 0) < ms) return false; checked.set(k, t); return true; };
const stamp = (r) => r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length") || "";

/** A saved pack: compare its files.json with the server's and fetch again every file whose size or hash changed (or is new). */
async function refreshPack(filesUrl) {
  if (!due(filesUrl, 5 * 60e3)) return;
  try {
    const data = await caches.open(DATA);
    const oldRes = await data.match(filesUrl);
    if (!oldRes) return;
    const fresh = await fetch(filesUrl, { cache: "no-cache" });
    if (!fresh.ok) return;
    const next = await fresh.clone().json(), prev = await oldRes.clone().json();
    const hash = (f) => f.hash || f.sha256 || f.sha1 || f.h || "";
    const was = new Map(prev.map((f) => [f.path, f]));
    const changed = (f) => { const o = was.get(f.path); return !o || o.bytes !== f.bytes || (hash(o) && hash(f) && hash(o) !== hash(f)); };   // a list without hashes (older packs) is compared by size only
    const base = filesUrl.slice(0, filesUrl.lastIndexOf("/") + 1);
    const cached = new Set((await data.keys()).map((r) => r.url));
    const hadPhotos = prev.some((f) => f.path.startsWith("photos/") && cached.has(base + f.path)) || !prev.some((f) => f.path.startsWith("photos/"));   // photos were left out of this save: keep leaving them out
    const todo = next.filter((f) => changed(f) && (hadPhotos || !f.path.startsWith("photos/")));
    let failed = 0;
    await mapPool(todo, 4, async (f) => {
      try { const r = await fetch(base + f.path, { cache: "reload" }); if (!r.ok) throw 0; await data.put(base + f.path, r); } catch { failed++; }
    });
    if (failed) { checked.delete(filesUrl); return; }           // try again on the next visit; files.json stays the old one until everything arrived
    const keep = new Set(next.map((f) => base + f.path));
    let removed = 0;
    for (const r of await data.keys()) if (r.url.startsWith(base) && r.url !== filesUrl && !keep.has(r.url)) { await data.delete(r); removed++; }
    await data.put(filesUrl, fresh);
    if (todo.length || removed) say({ type: "pack-updated", base, changed: todo.length, removed });
  } catch { /* offline, or the list was unreadable: the saved copy keeps working */ }
}

/** A saved diorama: ask the server whether each saved file changed (conditional request) and replace those that did. */
async function refreshDiorama(dirUrl) {
  if (!due(dirUrl, 10 * 60e3)) return;
  try {
    const data = await caches.open(DATA);
    const reqs = (await data.keys()).filter((r) => r.url.startsWith(dirUrl));
    let changed = 0;
    await mapPool(reqs, 4, async (r) => {
      try {
        const [have, now] = [await data.match(r), await fetch(r.url, { cache: "no-cache" })];
        if (now.ok && stamp(now) !== stamp(have)) { await data.put(r, now); changed++; }
      } catch { /* offline */ }
    });
    if (changed) say({ type: "diorama-updated", base: dirUrl, changed });
  } catch { /* ignore */ }
}

/** Honour a Range request from a cached body (audio elements ask for ranges and some browsers refuse a plain 200). */
async function ranged(req, res) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (!m || res.status !== 200 || (!m[1] && !m[2])) return res;
  const buf = await res.clone().arrayBuffer(), size = buf.byteLength;
  const s = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]), t = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (s > t || s >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(buf.slice(s, t + 1), { status: 206, headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream", "Content-Range": `bytes ${s}-${t}/${size}`, "Content-Length": String(t - s + 1) } });
}

// ---- serving
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const cdn = /(^|\.)cdn\.jsdelivr\.net$|^fonts\.(googleapis|gstatic)\.com$/.test(url.host);
  if (!sameOrigin(url) && !cdn) return;
  const r = rel(url);
  const saved = isDataPath(r), bg = [];                         // background work, kept alive after the response is sent
  const answer = (async () => {
    if (saved) {                                                // saved data: from the cache first; unsaved data goes to the network and is not kept
      const hit = await (await caches.open(DATA)).match(req, { ignoreVary: true });
      if (hit) {
        if (r.endsWith("/files.json")) bg.push(refreshPack(url.href));
        else if (r.startsWith("/data/diorama/")) bg.push(refreshDiorama(url.href.slice(0, url.href.lastIndexOf("/") + 1)));
        return ranged(req, hit);
      }
      return fetch(req);                                        // offline: the page sees a network error and says so
    }
    const hit = await caches.match(req);
    if (hit && (cdn || r.startsWith("/fonts/") || /\.(png|jpg|webp|m4a)$/.test(r))) return hit;   // fonts, images and the pinned CDN never change under the same name
    try {
      const net = fetch(req);
      // a slow or half-dead connection must not hold the page back when a copy is on the device: after 4 s the copy wins
      const res = hit ? await Promise.race([net, new Promise((ok) => setTimeout(() => ok(null), 4000))]) : await net;
      if (!res) { bg.push(net.then((x) => x.status === 200 && caches.open(SHELL).then((c) => c.put(req, x))).catch(() => {})); return hit; }
      if (res.status === 200) { const copy = res.clone(); bg.push(caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {})); }
      return res;
    } catch {
      return hit || (req.mode === "navigate" ? (await caches.match(req, { ignoreSearch: true })) || caches.match(`${BASE}index.html`) : Response.error());   // atlas.html?pack=… matches its saved page
    }
  })();
  e.respondWith(answer);
  e.waitUntil(answer.then(() => Promise.allSettled(bg), () => {}));
});
