// Trip kit: download size before saving, low-data mode, emergency numbers, and "Print my trip".
import { h } from "./dom.js";

const KEY = "tinyatlas-lowdata";
const CHECKED = "2026-10-08";

/** Total size of a pack's files.json (an array of {path, bytes}), in MB. */
export function packSizeMB(filesJson) {
  const bytes = (Array.isArray(filesJson) ? filesJson : []).reduce((a, f) => a + (Number(f.bytes) || 0), 0);
  return Math.round((bytes / 1e6) * 10) / 10;
}

/** Saved low-data choice; falls back to the connection hint when nothing is saved. */
export function lowDataMode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "on" || saved === "off") return saved === "on";
  } catch { /* storage blocked: use the hint */ }
  const c = navigator.connection;
  return !!(c && (c.saveData || /2g/.test(c.effectiveType || "")));
}

/** Suggests low-data mode on a slow or data-saving connection (only when nothing is saved). */
export function lowDataSuggested() {
  const c = navigator.connection;
  return !!(c && (c.saveData || /2g/.test(c.effectiveType || "")));
}

export function setLowDataMode(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* not saved */ }
}

async function loadEmergency() {
  const base = new URL("../data/emergency.json", import.meta.url);
  try { return await (await fetch(base)).json(); } catch { return { numbers: [], checked: CHECKED }; }
}

/**
 * The trip-kit panel. Returns an element.
 * pack: {slug, base, meta}; places: the pack's places array; onDownload: called when "Save for offline" is pressed.
 * Low-data mode: the atlas should read lowDataMode() in detectTier() and return "low" when it is on
 * (web/js/atlas/main.js, detectTier(): add `if (lowDataMode()) return "low";` before the `coarse || weak` line).
 */
export function tripKitPanel({ pack, places = [], onDownload, onLowData } = {}) {
  const sizeLine = h("p", { class: "tk-size" }, "Checking download size…");
  fetch(`${pack.base}files.json`).then((r) => r.json()).then((files) => {
    const total = packSizeMB(files), noPhotos = packSizeMB(files.filter((f) => !f.path.startsWith("photos/")));
    sizeLine.textContent = `Download size: about ${total} MB (${noPhotos} MB without photos). Shown before you save.`;
  }).catch(() => { sizeLine.textContent = "Download size unavailable: the file list could not be read."; });

  const toggle = h("input", { type: "checkbox", checked: lowDataMode() });
  const hint = lowDataSuggested() && localStorage.getItem(KEY) == null
    ? h("p", { class: "tk-hint" }, "Your connection looks slow or data-saving is on. Low-data mode is suggested.") : null;
  toggle.addEventListener("change", () => { setLowDataMode(toggle.checked); onLowData?.(toggle.checked); });

  const picks = places.map((p) => h("label", { class: "tk-pick" },
    h("input", { type: "checkbox", value: p.slug }), h("span", null, p.name)));

  const nums = h("ul", { class: "tk-nums" }, "");
  loadEmergency().then((data) => {
    nums.replaceChildren(...data.numbers.map((n) => h("li", null,
      h("a", { href: `tel:${n.number}` }, `${n.name}: ${n.number}`),
      h("span", { class: "tk-cover" }, ` ${n.covers}. Source: `),
      h("a", { href: n.url, target: "_blank", rel: "noopener" }, n.source))));
    if (!data.numbers.length) nums.append(h("li", null, "No verified numbers are listed."));
  });

  const print = h("button", { class: "primary", type: "button", onClick: () => {
    const slugs = [...panel.querySelectorAll(".tk-pick input:checked")].map((i) => i.value).join(",");
    const url = new URL("../tripkit.html", import.meta.url);
    url.search = `?pack=${encodeURIComponent(pack.slug)}&slugs=${encodeURIComponent(slugs)}`;
    window.open(url.href, "_blank", "noopener");
  } }, "Print my trip");
  const save = h("button", { type: "button", onClick: () => onDownload?.() }, "Save for offline");

  const panel = h("section", { class: "tripkit", "aria-label": "Trip kit" },
    h("h2", null, "Trip kit"),
    sizeLine, hint,
    h("label", { class: "tk-row" }, toggle, h("span", null, "Low-data mode (skips the highest-detail terrain and photos)")),
    h("h3", null, "Places to print"), h("div", { class: "tk-picks" }, picks),
    h("h3", null, "Emergency numbers"), nums,
    h("p", { class: "tk-checked" }, `Numbers checked ${CHECKED} from official pages. Tap to call.`),
    h("div", { class: "tk-actions" }, save, print));
  return panel;
}
