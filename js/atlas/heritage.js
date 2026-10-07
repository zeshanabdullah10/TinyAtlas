// Heritage provenance for Gandharan sites. Data: web/data/heritage.json (every statement has source, url, checked).
// Missing fields are omitted, never filled in. Rows are collapsible <details>; each line links to its source.

import { h } from "../dom.js";

/** Loads web/data/heritage.json. Resolves to {} on any failure so the panel still works without it. */
export async function loadHeritage(url = "data/heritage.json") {
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    const data = await r.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** One sourced line: text, then the source as a link, then the date checked. */
function line(item, text) {
  return h("li", null,
    h("span", { class: "hr-text" }, text),
    h("span", { class: "hr-src" }, " Source: ",
      h("a", { href: item.url, target: "_blank", rel: "noopener" }, item.source),
      item.checked ? ` (checked ${item.checked})` : ""));
}

function row(title, items) {
  return h("details", { class: "hr-row", open: false },
    h("summary", null, title),
    h("ul", { class: "hr-list" }, items));
}

/** <section> "Heritage record" for one site, or null when the entry has no sourced fields. */
export function heritageSection(entry) {
  if (!entry) return null;
  const rows = [];
  if (entry.period?.text) rows.push(row("Period", [line(entry.period, entry.period.text)]));
  if (entry.excavations?.length) rows.push(row("Excavated", entry.excavations.map((x) => line(x, `${x.years}: ${x.by}`))));
  if (entry.records_held_by?.length) rows.push(row("Records held by", entry.records_held_by.map((x) => line(x, x.name))));
  if (entry.conservation?.status) rows.push(row(`Conservation (${entry.conservation.date || "undated"})`, [line(entry.conservation, entry.conservation.status)]));
  if (entry.disputed?.length) {
    rows.push(row("Where scholars disagree", entry.disputed.map((d) =>
      h("li", { class: "hr-dispute" },
        h("p", { class: "hr-claim" }, d.claim),
        h("ul", { class: "hr-list" }, (d.views || []).map((v) => line(v, v.text)))))));
  }
  if (entry.further_reading?.length) rows.push(row("Further reading", entry.further_reading.map((x) => line(x, x.title))));
  if (!rows.length) return null;
  return h("section", { class: "heritage" },
    h("h3", null, "Heritage record"),
    rows);
}
