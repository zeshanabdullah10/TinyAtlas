// Road status card: dated, sourced advisories for the roads that touch one place.
// Reads web/data/roads.json. Advisories older than 30 days are shown as "unknown (last report ...)".
import { h } from "./dom.js";

export const STATUS = {
  open: { label: "Open", color: "#6fae5b" },
  caution: { label: "Caution", color: "#e9a23b" },
  closed: { label: "Closed", color: "#d0533f" },
  unknown: { label: "Unknown", color: "#8a8580" },
};

export const STALE_DAYS = 30;
export const FOOTER = "Advisories are dated reports, not live conditions. Check locally before you travel.";

const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const MS_DAY = 86400000;

/** Whole days between an ISO date (YYYY-MM-DD) and `now` (a Date). */
export function daysAgo(iso, now = new Date()) {
  const [y, m, d] = iso.split("-").map(Number);
  const then = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / MS_DAY);
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** Roads whose segment_slugs include `slug`, each with its advisories sorted latest first. */
export function roadsFor(roads, slug) {
  return (roads || []).filter((r) => (r.segment_slugs || []).includes(slug))
    .map((r) => ({ ...r, advisories: [...(r.advisories || [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) }));
}

/**
 * Card for the roads touching `slug`. Always returns an HTMLElement (a short note when no road is listed).
 * options: { slug, now? } (now is a Date, for tests).
 */
export function roadStatusCard(roads, { slug, now = new Date() } = {}) {
  const list = roadsFor(roads, slug);
  const rows = list.map((road) => h("li", { class: "rs-road" },
    h("h4", { class: "rs-name" }, road.name),
    (road.seasonal || []).map((se) => h("p", { class: "rs-season" }, h("b", null, "Usually " + se.months + ": "), se.text, " ",
      safeUrl(se.url) ? h("a", { class: "rs-src", href: se.url, target: "_blank", rel: "noopener" }, se.source) : se.source)),
    road.advisories.length
      ? h("ul", { class: "rs-advs" }, road.advisories.map((a) => advisoryRow(a, now)))
      : h("p", { class: "rs-none" }, "No dated advisory yet. Ask locally before you travel.")));
  return h("section", { class: "rs-card", "aria-label": "Road status" },
    h("h3", { class: "rs-title" }, "Road status"),
    list.length ? h("ol", { class: "rs-roads" }, rows) : h("p", { class: "rs-none" }, "No road in this atlas is listed for this place."),
    h("p", { class: "rs-foot" }, FOOTER));
}

function advisoryRow(a, now) {
  const age = daysAgo(a.date, now);
  const stale = age > STALE_DAYS;
  const st = stale ? "unknown" : (STATUS[a.status] ? a.status : "unknown");
  const meta = STATUS[st];
  const chipText = stale ? `Unknown (last report ${fmtDate(a.date)})` : meta.label;
  const url = safeUrl(a.url);
  return h("li", { class: "rs-adv" + (stale ? " is-stale" : "") },
    h("span", { class: "rs-chip", style: `background:${meta.color}` }, chipText),
    h("span", { class: "rs-date" }, fmtDate(a.date), " · ", age <= 0 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`),
    h("p", { class: "rs-text" }, a.text),
    url ? h("a", { class: "rs-src", href: url, target: "_blank", rel: "noopener" }, a.source || "Source") : h("span", { class: "rs-src" }, a.source || "Source"));
}

/** Loads the roads file. Resolves to the roads array, or [] when it cannot be read. */
export async function loadRoads(base = ".") {
  try {
    const r = await fetch(`${base}/data/roads.json`, { cache: "no-cache" });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.roads) ? data.roads : [];
  } catch {
    return [];
  }
}
