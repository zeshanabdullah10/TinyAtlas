import { h, icon, fmtKm, fmtM } from "./dom.js";

// "See the view before you go": a card per curated viewpoint with an AI preview painted over the real skyline
// (backend/tools/previews.py). Summit labels come from the viewshed and are laid over the picture, never painted in.

const TIMES = [["sunrise", "Sunrise"], ["midday", "Midday"], ["evening", "Evening"]];
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

function figure(api, slug, v, name, big = false) {
  const labels = v.labels.map((p) => h("span", { class: "vlabel", style: `left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%` },
    h("b", {}, p.name), big && h("small", {}, ` ${fmtM(p.ele)} · ${fmtKm(p.dist)}`)));
  return h("figure", { class: `vfig${big ? " big" : ""}` },
    h("img", { src: api.viewImageUrl(slug, name), alt: `Preview of the view from ${v.name}`, loading: "lazy" }),
    h("div", { class: "vlabels", "aria-hidden": "true" }, ...labels),
    h("figcaption", { class: "vbadge" }, "AI preview of the real skyline"));
}

export function renderViews(root, { api, slug, views, season, onPanorama, onShowOnMap }) {
  const state = { season, time: "evening" };
  const cards = views.map((v) => {
    const fig = h("div", { class: "vfig-slot" });
    const segs = Object.fromEntries(TIMES.map(([t, label]) => [t, h("button", { class: "seg", type: "button", onclick: () => { state.time = t; paint(); } }, label)]));
    const card = h("article", { class: "vcard" },
      h("h3", {}, v.name),
      h("p", { class: "vmeta" }, `Facing ${COMPASS[Math.round(v.heading / 45) % 8]}, standing at ${fmtM(v.elev)}.`, v.labels.length ? ` ${v.labels.map((l) => l.name).join(", ")} in view.` : ""),
      fig,
      h("div", { class: "segs vtimes", role: "group", "aria-label": "Time of day" }, ...Object.values(segs)),
      h("div", { class: "ask-chips" },
        h("button", { class: "chip", type: "button", onclick: () => onPanorama(v) }, "360° view from here"),
        h("button", { class: "chip", type: "button", onclick: () => onShowOnMap(v) }, "Show on the map")));
    function paint() {
      const s = v.images[state.season] ? state.season : Object.keys(v.images)[0];
      const name = v.images[s]?.[state.time] || Object.values(v.images[s] || {})[0];
      for (const [t, b] of Object.entries(segs)) { b.setAttribute("aria-pressed", String(t === state.time)); b.disabled = !v.images[s]?.[t]; }
      fig.replaceChildren(name ? figure(api, slug, v, name) : h("p", { class: "empty" }, "No preview painted yet."));
      const f = fig.querySelector("figure"); if (f) f.onclick = () => lightbox(api, slug, v, name);
    }
    return { card, paint };
  });
  root.replaceChildren(
    h("p", { class: "vintro" }, "What you'll see from the best spots, at the season and time you choose. Pictures are painted by an AI model over the real skyline; summit names come from the map."),
    ...cards.map((c) => c.card));
  cards.forEach((c) => c.paint());
  return { setSeason: (s) => { state.season = s; cards.forEach((c) => c.paint()); } };
}

function lightbox(api, slug, v, name) {
  const close = () => { back.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const back = h("div", { class: "pano-back", role: "dialog", "aria-modal": "true", "aria-label": `View from ${v.name}`, onclick: (e) => e.target === back && close() },
    h("div", { class: "vbox" }, figure(api, slug, v, name, true),
      h("button", { class: "icon-btn vclose", type: "button", "aria-label": "Close", onclick: close }, icon("i-close"))));
  document.body.append(back); document.addEventListener("keydown", esc, true);
  back.querySelector(".vclose").focus();
}
