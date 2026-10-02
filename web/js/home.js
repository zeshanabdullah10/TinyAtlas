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
      h("img", { src: `${BASE}${r.cover}`, alt: "", width: 1280, height: 960, loading: "lazy" })),
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

export async function mountHome() {
  let data;
  try { data = await (await fetch(`${BASE}data/home.json`)).json(); } catch { return; }
  document.getElementById("regions").replaceChildren(...data.regions.map(card));
  document.getElementById("timeline").replaceChildren(...data.timeline.map(era));
}
