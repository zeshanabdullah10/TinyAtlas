// Interface language: English or Urdu. Strings live in web/data/i18n/<lang>.json.
// Keys are stable; Urdu falls back to English for any missing key.

const KEY = "tinyatlas.lang";
const FONT_HREF = new URL("../fonts/fonts.css", import.meta.url).href;   // self-hosted; holds the Nastaliq face (works offline)

const cache = {};
let current = null;
let tables = null;
let urSites = {};        // site-model slug -> Urdu title (ur.json "sites")
let urPlaces = {};       // slug -> Urdu name, for places whose card has no name_ur (draft transliterations, in ur.json "places")

function normal(l) {
  return l && String(l).toLowerCase().startsWith("ur") ? "ur" : "en";
}

/** Current language: ?lang= first, then localStorage, then the browser language. */
export function lang() {
  if (current) return current;
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q) return (current = normal(q));
  } catch (_) {}
  try {
    const s = localStorage.getItem(KEY);
    if (s) return (current = normal(s));
  } catch (_) {}
  const nav = (typeof navigator !== "undefined" && navigator.language) || "en";
  return (current = normal(nav));
}

async function loadTable(l) {
  if (cache[l]) return cache[l];
  const res = await fetch(new URL(`../data/i18n/${l}.json`, import.meta.url), { cache: "no-cache" });
  if (!res.ok) throw new Error(`i18n ${l}: HTTP ${res.status}`);
  const json = await res.json();
  if (l === "ur") { urPlaces = json.places || {}; urSites = json.sites || {}; }
  cache[l] = l === "ur" ? json.strings : json;
  return cache[l];
}

/** Load the English table and, for Urdu, the Urdu table. Call once before t(). */
export async function loadLang(l = lang()) {
  tables = {
    en: await loadTable("en"),
    ur: l === "ur" ? await loadTable("ur") : null,
  };
  return tables;
}

/** Resolves once the tables for the current language are in (never rejects: without them tr() uses its English fallback). */
export const ready = loadLang().catch(() => null);

const fill = (s, vars) => {
  for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

/** For strings built in JS: tr("key", "English as written", {n: 3}). English stays the code's own text; Urdu comes from
 *  ur.json and falls back to the English if the key or the table is missing, so nothing breaks. */
export function tr(key, fallback, vars) {
  const u = lang() === "ur" ? tables?.ur?.[key] : null;
  return fill(u ?? fallback ?? tables?.en?.[key] ?? key, vars);
}

export const isUr = () => lang() === "ur";

/** Keeps a number with its unit ("12 km", "2,000 m") in one left-to-right run inside Urdu text; unchanged in English. */
export const ltr = (s) => (lang() === "ur" ? `\u2066${s}\u2069` : s);

/** A site model's title: the Urdu name in ur.json, else the title as the data gives it. */
export const siteTitle = (site, title) => (lang() === "ur" && urSites[site]) || title;

/** A place's name for the current language: name_ur on the card, else the draft transliteration in ur.json, else the English name. */
export function placeName(p, key = "name") {
  if (!p) return "";
  if (lang() !== "ur") return p[key] || p.name;
  return p.name_ur || urPlaces[p.slug] || p[key] || p.name;
}

/** Translate a key with {name} substitutions. Falls back to English, then the key. */
export function t(key, vars = {}) {
  const l = lang();
  const table = (l === "ur" && tables?.ur) || tables?.en || {};
  return fill(table[key] ?? tables?.en?.[key] ?? key, vars);
}

function ensureUrduFont() {
  if (document.querySelector(`link[data-i18n-font], link[href$="fonts/fonts.css"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  link.dataset.i18nFont = "1";
  document.head.append(link);
}

/**
 * Apply translations for one page. `page` is "index", "atlas", "diorama", "play" or "tripkit" (the last two have no map, only data-i18n marks); the
 * selector-to-key table is web/data/i18n/map.json. Sets <html lang/dir> and loads the
 * Urdu font. Runs once at load; a language change reloads the page (see setLang).
 * Text is set with textContent, never HTML. For a mixed element, `text` picks the
 * n-th non-empty direct text node and keeps its surrounding spaces.
 */
export async function applyI18n(page) {
  const l = lang();
  await ready;
  if (!tables) await loadLang(l);
  const html = document.documentElement;
  html.lang = l === "ur" ? "ur" : "en";
  html.dir = l === "ur" ? "rtl" : "ltr";
  if (l !== "ur") return l;                 // English is the page as written
  ensureUrduFont();
  const map = await fetch(new URL("../data/i18n/map.json", import.meta.url), { cache: "no-cache" }).then((r) => r.json());
  for (const e of map[page] || []) {
    const el = document.querySelector(e.sel);
    if (!el) continue;
    const val = t(e.key);
    if (e.attr) {
      el.setAttribute(e.attr, val);
    } else if (e.text != null) {
      const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      const node = nodes[e.text];
      if (node) {
        const lead = node.textContent.match(/^\s*/)[0];
        const trail = node.textContent.match(/\s*$/)[0];
        node.textContent = lead + val + trail;
      }
    } else {
      el.textContent = val;
    }
  }
  translateTree(document);
  return l;
}

/**
 * Elements marked in the HTML: data-i18n="key" sets the text, data-i18n-attr="aria-label:key;title:key2" sets attributes.
 * Used by pages whose markup is small (play, trip kit, the shared header and footer) instead of a selector map.
 */
export function translateTree(root) {
  if (lang() !== "ur") return;
  for (const el of root.querySelectorAll("[data-i18n]")) { const v = tables?.ur?.[el.dataset.i18n]; if (v) el.textContent = v; }
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [a, k] = pair.split(":").map((x) => x.trim()), v = tables?.ur?.[k];
      if (a && v) el.setAttribute(a, v);
    }
  }
}

/** Store the choice, reflect it in the URL, and reload with the new language. */
export function setLang(l) {
  const v = normal(l);
  try {
    localStorage.setItem(KEY, v);
  } catch (_) {}
  current = v;
  const url = new URL(location.href);
  url.searchParams.set("lang", v);
  location.href = url.toString();
}
