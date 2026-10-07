// Interface language: English or Urdu. Strings live in web/data/i18n/<lang>.json.
// Keys are stable; Urdu falls back to English for any missing key.

const KEY = "tinyatlas.lang";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu&display=swap";

const cache = {};
let current = null;
let tables = null;

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

/** Translate a key with {name} substitutions. Falls back to English, then the key. */
export function t(key, vars = {}) {
  const l = lang();
  const table = (l === "ur" && tables?.ur) || tables?.en || {};
  let s = table[key] ?? tables?.en?.[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

function ensureUrduFont() {
  if (document.querySelector(`link[data-i18n-font]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  link.dataset.i18nFont = "1";
  document.head.append(link);
}

/**
 * Apply translations for one page. `page` is "index", "atlas" or "diorama"; the
 * selector-to-key table is web/data/i18n/map.json. Sets <html lang/dir> and loads the
 * Urdu font. Runs once at load; a language change reloads the page (see setLang).
 * Text is set with textContent, never HTML. For a mixed element, `text` picks the
 * n-th non-empty direct text node and keeps its surrounding spaces.
 */
export async function applyI18n(page) {
  const l = lang();
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
  return l;
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
