// "Save for offline": posts the pack's file list to the service worker ({type:"save", urls, id}), with a switch to leave the
// photos out and one to take the pack's dioramas along, and shows progress. Also the helpers the diorama page shares:
// crawl() follows a page's imports so no file the code needs is forgotten, saveUrls() talks to the worker.
import { h, toast } from "../dom.js";
import { api, STATIC, BASE } from "../api.js";
import { tr } from "../i18n.js";

export const DATA_CACHE = "tinyatlas-data-v1";
export const MB = (b) => `${Math.max(1, Math.round(b / 1e6))} MB`;
const CDN_BASE = "https://cdn.jsdelivr.net/npm/three@0.160.0/";
// What the Atlas page and the trip kit need that no import names: pages, styles, data files fetched by URL. The JS here is the
// fallback if crawl() cannot read a file; backend/tests/test_offline_shell.py checks it covers the whole import graph.
export const SHELL = ["atlas.html", "tripkit.html", "css/tokens.css", "css/atlas.css", "css/tripkit.css", "css/heritage.css", "css/voices.css", "css/roadstatus.css", "css/storyflight.css", "css/i18n.css",
  "fonts/fonts.css", "manifest.webmanifest", "icon.svg", "img/icon-192.png",
  "data/emergency.json", "data/heritage.json", "data/voices.json", "data/roads.json", "data/phrases.json", "data/stories/swat-road.json", "data/i18n/en.json", "data/i18n/ur.json", "data/i18n/map.json",
  "js/dom.js", "js/api.js", "js/i18n.js", "js/planner.js", "js/listen.js", "js/tripkit.js", "js/voices.js", "js/roadstatus.js", "js/phrasecard.js", "js/diorama/offline.js",
  ...["main", "controls", "day", "dispose", "heritage", "labels", "landmarks", "localplan", "material", "offline", "pack", "panel", "ribbon", "roads", "shade", "sheet", "sky", "storyflight", "terrain", "trees", "ui", "water"].map((n) => `js/atlas/${n}.js`)];
// three.js comes from the CDN; GLTFLoader pulls in BufferGeometryUtils.
export const CDN = ["build/three.module.js", "examples/jsm/controls/OrbitControls.js", "examples/jsm/loaders/GLTFLoader.js", "examples/jsm/utils/BufferGeometryUtils.js"].map((p) => CDN_BASE + p);

export const abs = (p) => new URL(p, location.href).href;

// ---- the module graph
const JS_REF = [/\b(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g];
function refs(url, body) {
  const out = [];
  const add = (spec) => {
    if (!spec || /^(data|blob|mailto|javascript):|^#/.test(spec) || /\$\{/.test(spec)) return;
    out.push(spec);
  };
  if (/\.css(\?|$)/.test(url)) {
    for (const m of body.matchAll(/url\(\s*["']?([^)"']+?)["']?\s*\)|@import\s*["']([^"']+)["']/g)) add(m[1] || m[2]);
  } else if (/\.m?js(\?|$)/.test(url)) {
    for (const re of JS_REF) for (const m of body.matchAll(re)) add(m[1]);
  } else {                                                      // a page: styles, preloads, scripts (and what its inline module imports)
    for (const m of body.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)) if (/rel="(stylesheet|preload|manifest|modulepreload)"/.test(m[0])) add(m[1]);
    for (const m of body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const src = /\bsrc="([^"]+)"/.exec(m[1]);
      if (src) add(src[1]);
      else if (/type="module"/.test(m[1])) for (const re of JS_REF) for (const x of m[2].matchAll(re)) add(x[1]);
    }
  }
  return out;
}
function importMap() {
  try { return JSON.parse(document.querySelector('script[type="importmap"]')?.textContent || "{}").imports || {}; } catch { return {}; }
}
/** Every URL reachable from `entries` through html, css and js imports (same origin, plus the three.js addons). Bare specifiers
 *  resolve through the page's import map; the main three.js bundle has no imports and is not read. Fetches use the HTTP cache. */
export async function crawl(entries) {
  const map = importMap(), seen = new Set(), todo = entries.map(abs);
  const resolve = (spec, from) => {
    if (/^[a-z]+:/i.test(spec) && !/^https?:/i.test(spec)) return null;
    const hit = Object.keys(map).sort((a, b) => b.length - a.length).find((k) => (k.endsWith("/") ? spec.startsWith(k) : spec === k));
    if (hit) return map[hit] + (hit.endsWith("/") ? spec.slice(hit.length) : "");
    if (!/^(\.|\/|[a-z0-9_-]+\.|[a-z0-9_-]+\/)/i.test(spec) && !/^https?:/.test(spec)) return null;   // a bare package name we have no mapping for
    return new URL(spec, from).href;
  };
  while (todo.length) {
    const batch = todo.splice(0, 8);
    await Promise.all(batch.map(async (u) => {
      u = u.split("#")[0];
      if (seen.has(u)) return;
      seen.add(u);
      const mine = new URL(u).origin === location.origin, cdnAddon = u.startsWith(CDN_BASE) && u.includes("/examples/");
      if ((!mine && !cdnAddon) || /\.(json|webp|png|jpg|jpeg|svg|woff2?|bin|glb|m4a|webmanifest|ico)(\?|$)/.test(u)) return;
      try {
        const r = await fetch(u);
        if (!r.ok) return;
        for (const spec of refs(u, await r.text())) { const n = resolve(spec, u); if (n && !seen.has(n.split("#")[0])) todo.push(n); }
      } catch { /* the fallback lists cover it */ }
    }));
  }
  return [...seen].filter((u) => new URL(u).origin === location.origin || u.startsWith(CDN_BASE));
}

// ---- talking to the worker
async function controller() {
  let sw = navigator.serviceWorker?.controller;
  if (!sw && navigator.serviceWorker) {                 // on a first visit the worker claims the page a moment after load
    sw = await new Promise((res) => {
      const t = setTimeout(res, 4000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(t); res(navigator.serviceWorker.controller); }, { once: true });
    }).catch(() => null);
  }
  return sw;
}
/** Ask the worker to keep `urls`; calls onProgress({done, failed, total}) and resolves with the last one. Rejects (with a message
 *  to show) if there is no worker yet. */
export async function saveUrls(urls, onProgress = () => {}) {
  const sw = await controller();
  if (!sw) throw new Error(tr("ofl.need_sw", "Offline saving needs this page to be opened once more. Reload it, then try again."));
  const id = Math.random().toString(36).slice(2);
  return new Promise((res) => {
    const onMsg = (e) => {
      if (e.data?.type !== "save-progress" || e.data.id !== id) return;
      onProgress(e.data);
      if (e.data.done === e.data.total) { navigator.serviceWorker.removeEventListener("message", onMsg); res(e.data); }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    sw.postMessage({ type: "save", urls, id });
  });
}
/** The saved copies of every url that starts with `prefix` (absolute), e.g. one diorama's folder. */
export async function savedUnder(prefix) {
  try { return (await (await caches.open(DATA_CACHE)).keys()).filter((r) => r.url.startsWith(prefix)); } catch { return []; }
}
export async function forget(prefix) {
  try { const c = await caches.open(DATA_CACHE); for (const r of await c.keys()) if (r.url.startsWith(prefix)) await c.delete(r); } catch { /* none */ }
}

// ---- the Atlas dialog
export async function dioramaList(slug) {
  try {
    const all = (await (await fetch(abs("data/dioramas.json"))).json()).sites || [];
    const sizes = await (await fetch(abs("data/diorama/files.json"))).json().catch(() => ({}));
    return all.filter((s) => s.pack === slug).map((s) => ({ ...s, bytes: (sizes[s.site] || []).reduce((a, f) => a + f.bytes, 0) }));
  } catch { return []; }
}

export async function openOffline(pack, { onClose } = {}) {
  const slug = pack.slug, name = tr(`region.${pack.slug}`, pack.meta.title);
  let files = [];
  try { files = await (await fetch(`${pack.base}files.json`)).json(); } catch { /* shown below */ }
  const total = files.reduce((a, f) => a + f.bytes, 0), noPhotos = files.filter((f) => !f.path.startsWith("photos/")).reduce((a, f) => a + f.bytes, 0);
  const sites = await dioramaList(slug), dioBytes = sites.reduce((a, s) => a + s.bytes, 0);
  const photos = h("input", { type: "checkbox", checked: true });
  const dios = h("input", { type: "checkbox", checked: false });
  const sizes = h("p", { class: "ofl-sizes" }, files.length ? tr("ofl.sizes", "~{total} · without photos ~{nophotos}", { total: MB(total), nophotos: MB(noPhotos) }) : tr("ofl.nofiles", "The file list for this map is missing, so it can't be saved."));
  const status = h("p", { class: "ofl-status", role: "status", "aria-live": "polite" }, "");
  const bar = h("div", { class: "ofl-bar", hidden: true }, h("i"));
  const save = h("button", { class: "primary", type: "button", disabled: !files.length }, tr("kit.save", "Save for offline"));
  const close = () => { card.remove(); removeEventListener("keydown", esc); onClose?.(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const card = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ofl-t" },
    h("div", { class: "modal-card" },
      h("h2", { id: "ofl-t" }, tr("ofl.title", "Save {name} for offline", { name })),
      h("p", null, tr("ofl.p", "Keeps the terrain, ground colour, places and stories on this device so the map opens with no signal. Trip planning and the guide still need a connection.")),
      sizes,
      h("label", { class: "row chk" }, photos, h("span", null, tr("ofl.photos", "Include photos"))),
      sites.length ? h("label", { class: "row chk" }, dios, h("span", null, tr("ofl.dios", "Also save its {n} dioramas{more}", { n: sites.length, more: dioBytes ? tr("ofl.dios_more", " (~{mb} more)", { mb: MB(dioBytes) }) : "" }))) : null,
      bar, status,
      h("div", { class: "modal-actions" }, save, h("button", { type: "button", onClick: close }, tr("kit.close", "Close")))));
  card.addEventListener("pointerdown", (e) => { if (e.target === card) close(); });
  addEventListener("keydown", esc);
  document.getElementById("app").append(card);
  save.focus();

  save.addEventListener("click", async () => {
    if (save.dataset.done) return close();
    save.disabled = photos.disabled = dios.disabled = true; status.textContent = tr("ofl.preparing", "Preparing…"); bar.hidden = false;
    const keep = files.filter((f) => photos.checked || !f.path.startsWith("photos/"));
    const clips = await api.audio(slug).catch(() => ({}));
    const audioList = STATIC ? `${BASE}packs/${encodeURIComponent(slug)}/audio.json` : `/api/audio/${encodeURIComponent(slug)}`;   // the clip list itself, or no clip would be found offline
    const audio = [audioList, ...Object.values(clips || {}).flatMap((ls) => Object.values(ls)).map((c) => api.audioUrl(slug, c.file))];
    const code = await crawl(["atlas.html", "tripkit.html"]).catch(() => []);
    const urls = [...new Set([...SHELL.map(abs), ...code, ...CDN, `${pack.base}files.json`, ...keep.map((f) => pack.base + f.path), ...audio])];
    let extra = [];
    if (dios.checked) {
      const { dioramaUrls } = await import("../diorama/offline.js");
      extra = (await Promise.all(sites.map((s) => dioramaUrls(s.site).catch(() => [])))).flat();
    }
    const all = [...new Set([...urls, ...extra])];
    try {
      const r = await saveUrls(all, ({ done, total }) => {
        const f = done / total;
        bar.firstChild.style.width = `${Math.round(f * 100)}%`;
        status.textContent = tr("ofl.saving", "Saving {n}%", { n: Math.round(f * 100) });
      });
      status.textContent = r.failed ? tr("ofl.partial", "Saved, but {n} files were missing.", { n: r.failed }) : tr("ofl.done", "Saved. This map now opens offline.");
      toast(r.failed ? tr("ofl.toast_partial", "Saved, but {n} files were missing", { n: r.failed }) : tr("ofl.toast_done", "{name} saved for offline", { name }));
      save.textContent = tr("ofl.done_btn", "Done"); save.dataset.done = "1"; save.disabled = false; photos.disabled = dios.disabled = false;
    } catch (err) {
      status.textContent = err.message; save.disabled = photos.disabled = dios.disabled = false; bar.hidden = true;
    }
  });
  return { card, photos, dios, save };
}
