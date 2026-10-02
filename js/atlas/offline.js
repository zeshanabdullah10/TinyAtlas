// "Save for offline": posts the pack's file list to the service worker (same message as the place page: {type:"save", urls, id}),
// with a switch to leave the photos out, and shows progress.
import { h, toast } from "../dom.js";
import { api, BASE } from "../api.js";

const MB = (b) => `${Math.max(1, Math.round(b / 1e6))} MB`;
const SHELL = ["atlas.html", "css/tokens.css", "css/atlas.css", "js/dom.js", "js/api.js", "js/planner.js", "js/listen.js",
  ...["main", "controls", "day", "dispose", "labels", "landmarks", "material", "offline", "pack", "panel", "ribbon", "roads", "shade", "sheet", "sky", "terrain", "trees", "ui", "water"].map((n) => `js/atlas/${n}.js`)];
const CDN = ["https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js"];

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

export async function openOffline(pack, { onClose } = {}) {
  const slug = pack.slug, name = pack.meta.title;
  let files = [];
  try { files = await (await fetch(`${pack.base}files.json`)).json(); } catch { /* shown below */ }
  const total = files.reduce((a, f) => a + f.bytes, 0), noPhotos = files.filter((f) => !f.path.startsWith("photos/")).reduce((a, f) => a + f.bytes, 0);
  const photos = h("input", { type: "checkbox", checked: true });
  const sizes = h("p", { class: "ofl-sizes" }, files.length ? `~${MB(total)} · without photos ~${MB(noPhotos)}` : "The file list for this map is missing, so it can't be saved.");
  const status = h("p", { class: "ofl-status", role: "status", "aria-live": "polite" }, "");
  const bar = h("div", { class: "ofl-bar", hidden: true }, h("i"));
  const save = h("button", { class: "primary", type: "button", disabled: !files.length }, "Save for offline");
  const close = () => { card.remove(); removeEventListener("keydown", esc); onClose?.(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const card = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ofl-t" },
    h("div", { class: "modal-card" },
      h("h2", { id: "ofl-t" }, `Save ${name} for offline`),
      h("p", null, "Keeps the terrain, ground colour, places and stories on this device so the map opens with no signal. Trip planning and the guide still need a connection."),
      sizes,
      h("label", { class: "row chk" }, photos, h("span", null, "Include photos")),
      bar, status,
      h("div", { class: "modal-actions" }, save, h("button", { type: "button", onClick: close }, "Close"))));
  card.addEventListener("pointerdown", (e) => { if (e.target === card) close(); });
  addEventListener("keydown", esc);
  document.getElementById("app").append(card);
  save.focus();

  save.addEventListener("click", async () => {
    if (save.dataset.done) return close();
    save.disabled = photos.disabled = true; status.textContent = "Preparing…"; bar.hidden = false;
    const sw = await controller();
    if (!sw) { status.textContent = "Offline saving needs this page to be opened once more. Reload it, then try again."; save.disabled = photos.disabled = false; bar.hidden = true; return; }
    const keep = files.filter((f) => photos.checked || !f.path.startsWith("photos/"));
    const clips = await api.audio(slug).catch(() => ({}));
    const audio = Object.values(clips || {}).flatMap((ls) => Object.values(ls)).map((c) => api.audioUrl(slug, c.file));
    const urls = [...SHELL.map((p) => `${BASE}${p}`), ...CDN, `${pack.base}files.json`, ...keep.map((f) => pack.base + f.path), ...audio];
    const id = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      if (e.data?.type !== "save-progress" || e.data.id !== id) return;
      const f = e.data.done / e.data.total;
      bar.firstChild.style.width = `${Math.round(f * 100)}%`;
      status.textContent = `Saving ${Math.round(f * 100)}%`;
      if (e.data.done === e.data.total) {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        status.textContent = e.data.failed ? `Saved, but ${e.data.failed} files were missing.` : "Saved. This map now opens offline.";
        toast(e.data.failed ? `Saved, but ${e.data.failed} files were missing` : `${name} saved for offline`);
        save.textContent = "Done"; save.dataset.done = "1"; save.disabled = false; photos.disabled = false;
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    sw.postMessage({ type: "save", urls, id });
  });
  return { card, photos, save };
}
