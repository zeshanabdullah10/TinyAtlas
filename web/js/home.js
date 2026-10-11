// Fills the landing page's two data-driven sections from web/data/home.json (built by backend/tools/home_data.py):
// the region cards (stats read from the packs) and the "Swat through time" strip. Everything else is plain HTML.
import { h } from "./dom.js";
import { BASE } from "./api.js";

const nf = (n) => n.toLocaleString("en");
const sourceName = (url) => decodeURIComponent(url.split("/").pop() || "").replace(/_/g, " ");

function card(r) {
  const open = `${BASE}atlas.html?pack=${encodeURIComponent(r.slug)}`;
  const stat = (k, v, note) => h("div", {}, h("dt", {}, k), h("dd", {}, v, note && h("small", {}, note)));
  return h("article", { class: "card" },
    h("a", { class: "card-pic", href: open, tabindex: "-1", "aria-hidden": "true" },
      h("img", { src: `${BASE}${r.cover}`, srcset: `${BASE}img/cover-${r.slug}-640.webp 640w, ${BASE}${r.cover} 1280w`, sizes: "(max-width: 860px) 100vw, 50vw", alt: "", width: 1280, height: 960, loading: "lazy" })),
    h("div", { class: "card-body" },
      h("h3", {}, r.title),
      h("p", { class: "card-sub" }, r.subtitle),
      h("dl", { class: "stats" },
        stat("Area", `${r.size_km[0]} × ${r.size_km[1]} km`),
        stat("Places", nf(r.places)),
        stat("Heritage sites", nf(r.heritage)),
        stat("Lakes", nf(r.lakes)),
        r.peak && stat("Highest peak", `${r.peak.name}, ${nf(r.peak.m)} m`, `Height from ${r.peak.source}`)),
      h("a", { class: "btn btn-primary", href: open }, `Open ${r.title}`)));
}

function era(e) {
  return h("li", { class: "era" },
    h("h3", {}, e.era), h("p", { class: "years" }, e.years),
    h("ul", {}, ...e.events.map((v) => h("li", {},
      h("b", {}, v.date), " ", v.text, " ",
      h("a", { href: v.source, rel: "noopener", "aria-label": `Source for ${v.date}: ${sourceName(v.source)}` }, `Source: ${sourceName(v.source)}`)))));
}

// 24x24 line glyphs for the kind of site; a typographic card, not an invented picture
const ICONS = {
  stupa: "M4 20h16M6 20a6 6 0 0 1 12 0M12 14V9M10 9h4M12 9V5",
  rock_carving: "M5 20V8l5-3 6 2 3 5v8ZM9 12h6M9 16h4",
  waterfall: "M6 4h12M9 4v8M12 4v12M15 4v8M4 20c3-2 5-2 8 0s5 2 8 0",
  mosque: "M5 20V12a7 7 0 0 1 14 0v8M12 2v3M3 20h18",
  museum: "M3 9l9-5 9 5M5 9v9M9 9v9M15 9v9M19 9v9M3 20h18",
  fort_ruin: "M4 20V9h3v3h3V9h4v3h3V9h3v11ZM11 20v-4h2v4",
  ski_resort: "M3 19l7-13 4 7 2-3 5 9ZM3 22h18",
  archaeological_site: "M5 20h14M7 20V10M12 20V6M17 20V12M5 10h4M10 6h4M15 12h4",
  palace: "M3 20h18M5 20V11M19 20V11M5 11l7-6 7 6M10 20v-5h4v5",
  lake: "M3 9c3-2 6 2 9 0s6 2 9 0M3 15c3-2 6 2 9 0s6 2 9 0",
  viewpoint: "M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11ZM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
};
const SHOWN = 12;

function siteCard(s, packs) {
  const icon = h("span", { class: "site-kind" });
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[s.kind] || ICONS.viewpoint}"/></svg>`;
  icon.append(s.kind_label);
  return h("a", { class: "site", href: `${BASE}diorama.html?site=${encodeURIComponent(s.site)}` },
    icon, h("h3", {}, s.title), s.subtitle && h("p", {}, s.subtitle), packs[s.pack] && h("span", { class: "pk" }, packs[s.pack]));
}

function sitesSection(list, packs) {
  const section = document.getElementById("sites"), grid = document.getElementById("site-grid"), more = document.getElementById("sites-more");
  const cards = list.map((s) => siteCard(s, packs));
  cards.forEach((c, i) => { if (i >= SHOWN) c.hidden = true; });
  grid.replaceChildren(...cards);
  section.hidden = false;
  if (cards.length > SHOWN) {
    more.hidden = false;
    more.textContent = `Show all ${cards.length} site models`;
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      cards.forEach((c, i) => { if (i >= SHOWN) c.hidden = !open; });
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Show fewer" : `Show all ${cards.length} site models`;
    });
  }
}

// counts shown under the hero buttons: all read from the data files, none typed in
function statsStrip(parts) {
  const box = document.getElementById("hero-stats");
  box.replaceChildren(...parts.filter(([n]) => n > 0).map(([n, label]) => h("div", {}, h("dt", {}, label), h("dd", {}, nf(n)))));
  box.hidden = !box.childElementCount;
}

export async function mountHome() {
  const get = (f) => fetch(`${BASE}data/${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [data, models] = await Promise.all([get("home.json"), get("dioramas.json")]);
  if (data) {
    document.getElementById("regions").replaceChildren(...data.regions.map(card));
    document.getElementById("timeline").replaceChildren(...data.timeline.map(era));
  }
  const packs = Object.fromEntries((data?.regions || []).map((r) => [r.slug, r.title]));
  if (models?.sites?.length) sitesSection(models.sites, packs);
  statsStrip([[data?.regions.length || 0, "valleys"], [data?.regions.reduce((n, r) => n + r.places, 0) || 0, "places"],
    [models?.stats.site_models || 0, "site models"], [models?.stats.audio_clips || 0, "audio clips"]]);
}
