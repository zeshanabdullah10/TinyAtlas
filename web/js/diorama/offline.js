// "Save this site for offline" on the diorama page: keeps the diorama's code (and the three.js modules it imports), the page, and
// web/data/diorama/<site>/* on this device through the service worker. Self-mounting: diorama.html loads this module and any
// element with [data-offline] opens the dialog. dioramaUrls(site) is also what the Atlas dialog uses to save a map's dioramas.
import { crawl, saveUrls, savedUnder, forget, abs, MB, CDN } from "../atlas/offline.js";

// What no import names: shared data the diorama fetches by URL, and the page itself.
const SHARED = ["diorama.html", "index.html", "atlas.html", "fonts/fonts.css", "manifest.webmanifest", "icon.svg", "img/icon-192.png", "data/i18n/en.json", "data/i18n/ur.json", "data/i18n/map.json", "data/roads.json", "data/diorama/herders.json", "data/dioramas.json"];
// A diorama's own files; optional ones are probed before saving so a missing one is not reported as a failure.
const FIXED = ["meta.json", "height.bin", "cover.bin", "far.bin", "farcover.bin", "albedo.webp", "albedo_far.webp"], OPTIONAL = ["photos.json", "practical.json", "town.json"];
const dirOf = (site) => abs(`data/diorama/${site}/`);

let code;                                                      // the diorama page's module graph, read once
const codeUrls = () => (code ||= crawl(["diorama.html"]).catch(() => []));
let manifest;                                                  // data/diorama/files.json: {site: [{path, bytes, hash}]}, written by backend/tools/pack_optimize.py --dioramas
const manifestOnce = () => (manifest ||= fetch(abs("data/diorama/files.json")).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

/** [{path, bytes}] for the site's own data files (bytes 0 when unknown). */
export async function siteFiles(site) {
  const listed = (await manifestOnce())[site];
  const dir = dirOf(site);
  const meta = await fetch(dir + "meta.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const lm = meta?.landmark, model = lm?.model && lm.model.replace(/^\.\//, "");
  let files = listed ? listed.map((f) => ({ path: f.path, bytes: f.bytes })) : [];
  if (!listed) {                                               // no manifest: ask the server for each file (HEAD) so only real ones are listed
    files = (await Promise.all([...FIXED, ...OPTIONAL, ...(model ? [model] : [])].map(async (p) => {
      try { const r = await fetch(dir + p, { method: "HEAD" }); return r.ok ? { path: p, bytes: Number(r.headers.get("content-length")) || 0 } : null; } catch { return null; }
    }))).filter(Boolean);
  }
  if (model && !files.some((f) => f.path === model)) files.push({ path: model, bytes: 0 });
  return files;
}

/** Every URL a saved diorama needs: page, code, fonts, three.js, shared data and the site's own files. */
export async function dioramaUrls(site) {
  const dir = dirOf(site);
  const meta = await fetch(dir + "meta.json").then((r) => r.json());
  const mod = meta.landmark?.module?.replace(/[^a-z0-9-_]/g, "");
  const [base, own, files] = await Promise.all([codeUrls(), mod ? crawl([`js/diorama/landmarks/${mod}.js`]) : [], siteFiles(site)]);
  return [...new Set([...SHARED.map(abs), ...base, ...own, ...CDN, ...files.map((f) => dir + f.path)])];
}

const STYLE = `#offline { max-width: min(520px, calc(100vw - 32px)); }
#offline .ofl-bar { height: 8px; border-radius: 4px; background: rgba(243,235,221,.16); overflow: hidden; margin: 12px 0 6px; } #offline .ofl-bar[hidden] { display: none; }
#offline .ofl-bar i { display: block; height: 100%; width: 0; background: var(--saffron, #e9a23b); transition: width .2s; }
#offline .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; } #offline .btn { min-height: 44px; }
#offline .ofl-status { min-height: 1.4em; margin: 4px 0 0; } #offline .ofl-sizes { font-weight: 600; margin: 10px 0 0; }`;

async function open() {
  const site = (new URLSearchParams(location.search).get("site") || "mahodand").replace(/[^a-z0-9-]/g, "");
  const dir = dirOf(site);
  if (!document.getElementById("offline-style")) document.head.append(Object.assign(document.createElement("style"), { id: "offline-style", textContent: STYLE }));
  document.getElementById("offline")?.remove();
  const d = document.createElement("dialog"); d.id = "offline"; d.className = "about";
  d.innerHTML = `<h2>Save this site for offline</h2>
    <p>Keeps this model (terrain, ground colour, the code that draws it and the three.js library) on this device so it opens with no signal. It is checked for updates in the background whenever you are online.</p>
    <p class="fine">Photo thumbnails are loaded from Wikimedia Commons and still need a connection. The weather line needs one too.</p>
    <p class="ofl-sizes" id="ofl-size">Checking the size…</p>
    <div class="ofl-bar" id="ofl-bar" hidden><i></i></div>
    <p class="ofl-status" id="ofl-status" role="status" aria-live="polite"></p>
    <div class="row"><button class="btn primary" id="ofl-save" type="button" disabled>Save this site for offline</button><button class="btn" id="ofl-remove" type="button" hidden>Remove the saved copy</button><button class="btn" id="ofl-close" type="button">Close</button></div>`;
  document.getElementById("app").append(d);
  const $ = (s) => d.querySelector(s);
  $("#ofl-close").addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.showModal();

  const files = await siteFiles(site);
  const known = files.reduce((a, f) => a + f.bytes, 0);
  $("#ofl-size").textContent = `${files.length} data files${known ? `, about ${known < 1e6 ? "1 MB" : MB(known)}` : ""}, plus the page's code and fonts (shared with the other dioramas).`;
  const refresh = async () => {
    const n = (await savedUnder(dir)).length;
    $("#ofl-remove").hidden = !n;
    $("#ofl-save").textContent = n ? "Save again (update)" : "Save this site for offline";
    if (n && !$("#ofl-status").textContent) $("#ofl-status").textContent = "Already saved on this device.";
  };
  $("#ofl-save").disabled = !files.length; await refresh();
  $("#ofl-save").addEventListener("click", async () => {
    const save = $("#ofl-save"), bar = $("#ofl-bar"), status = $("#ofl-status");
    save.disabled = true; bar.hidden = false; status.textContent = "Preparing…";
    try {
      const urls = await dioramaUrls(site);
      const r = await saveUrls(urls, ({ done, total }) => { bar.firstChild.style.width = `${Math.round((done / total) * 100)}%`; status.textContent = `Saving ${Math.round((done / total) * 100)}%`; });
      status.textContent = r.failed ? `Saved, but ${r.failed} of ${r.total} files could not be fetched.` : `Saved: ${r.total} files. This model now opens offline.`;
    } catch (e) { status.textContent = e.message || "Could not save."; bar.hidden = true; }
    save.disabled = false; await refresh();
  });
  $("#ofl-remove").addEventListener("click", async () => {
    await forget(dir); $("#ofl-status").textContent = "Removed. Shared code and fonts stay."; $("#ofl-bar").hidden = true; await refresh();
  });
}

if (document.body.classList.contains("diorama")) document.addEventListener("click", (e) => { if (e.target.closest("[data-offline]")) { e.preventDefault(); open(); } });
