// Chrome around the map: title cartouche, search, light pill, explore dock, compass/zoom/home, settings, attribution, loading, stats.
import * as THREE from "three";
import { h } from "../dom.js";
import { BASE } from "../api.js";
import { MIN_MULT } from "./landmarks.js";

const SVGNS = "http://www.w3.org/2000/svg";
function compassSVG() {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "-50 -50 100 100"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = `<circle r="47" fill="rgba(24,20,17,.86)" stroke="rgba(243,235,221,.4)" stroke-width="1.5"/>
    <g class="rose"><path d="M0-34 7-7 34 0 7 7 0 34-7 7-34 0-7-7Z" fill="#f3ebdd" stroke="#1a140d" stroke-width=".8"/>
    <path d="M0-34 0 0 7-7ZM34 0 0 0 7 7ZM0 34 0 0-7 7ZM-34 0 0 0-7-7Z" fill="#a8946b"/><path d="M0-34 0 0-7-7Z" fill="#e9a23b"/>
    <text y="-37" text-anchor="middle" font-size="11" fill="#f3ebdd" font-family="Cormorant SC,serif" font-weight="700">N</text></g>`;
  return s;
}
const ICON = {
  layers: "M12 3 3 8l9 5 9-5-9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5",
  menu: "M4 7h16M4 12h16M4 17h16",
  down: "M12 3v12M7.5 10.5 12 15l4.5-4.5M5 19h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
};
function svgIcon(d) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ic"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}
function word(t) {      // large first letters, small caps rest, like the poster
  return t.split(/\s+/).map((w) => h("span", { class: "w" }, h("b", null, w[0]), w.slice(1)));
}
/** Clock time for the sun arc (0 = sunrise 5:20, 1 = sunset 19:10) and a mood word from the elevation. */
export function clockText(s, el) {
  const mins = Math.round(5 * 60 + 20 + s * 776), hh = Math.floor(mins / 60), mm = String(mins % 60).padStart(2, "0");
  const t = `${((hh + 11) % 12) + 1}:${mm} ${hh < 12 ? "am" : "pm"}`;
  const mood = el < 4 ? "Twilight" : el < 22 ? "Golden hour" : el < 45 ? (s < 0.5 ? "Morning" : "Afternoon") : "Midday";
  return `${mood} · ${t}`;
}

export function buildUI(root, { pack, controls, settings, tier, showFps, sky, openPlace, areas, neighbors = [], onNeighbor, onOffline }) {
  const m = pack.meta;
  const loading = h("div", { class: "loading", role: "status" }, h("p", { class: "ld-t" }, m.title), h("div", { class: "ld-bar" }, h("i")), h("p", { class: "ld-l" }, "Opening the map"));
  const bar = loading.querySelector("i"), label = loading.querySelector(".ld-l");
  const cart = h("header", { class: "cartouche" }, h("a", { class: "back", href: BASE || "./" }, "← All places"), h("h1", null, word(m.title)),
    h("p", { class: "sub" }, h("span", { class: "rule" }), h("em", null, m.subtitle || ""), h("span", { class: "rule" })));
  // Phone: the cartouche is one compact line; tapping the title reveals the subtitle again.
  const title = cart.querySelector("h1");
  title.setAttribute("tabindex", "0"); title.setAttribute("role", "button"); title.setAttribute("aria-label", "Show the map subtitle");
  const cartToggle = () => { if (matchMedia("(max-width: 700px)").matches) document.body.classList.toggle("cart-open"); };
  title.addEventListener("click", cartToggle);
  title.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cartToggle(); } });

  // ---- search
  const results = h("ul", { class: "results", role: "listbox", hidden: true });
  const input = h("input", { type: "search", placeholder: "Search places", "aria-label": "Search places", autocomplete: "off", spellcheck: "false" });
  const pick = (pl) => { results.hidden = true; input.value = ""; input.blur(); openPlace(pl); };
  const find = (q) => { q = q.trim().toLowerCase(); return q ? pack.places.filter((p) => p.name.toLowerCase().includes(q) || (p.area || "").toLowerCase().includes(q)).slice(0, 7) : []; };
  input.addEventListener("input", () => {
    const r = find(input.value);
    results.replaceChildren(...r.map((p) => h("li", { role: "option" }, h("button", { type: "button", onClick: () => pick(p) }, h("span", null, p.name), h("small", null, (p.kind || "").replace(/_/g, " "))))));
    results.hidden = !r.length;
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = find(input.value)[0]; if (r) pick(r); } if (e.key === "Escape") { results.hidden = true; input.blur(); } });
  const search = h("div", { class: "search" }, svgIcon(ICON.search), input, results);

  // ---- settings popover (layers)
  const check = (lab, on, val = true) => { const i = h("input", { type: "checkbox", checked: val }); i.addEventListener("change", () => on(i.checked)); return h("label", { class: "row chk" }, i, h("span", null, lab)); };
  const fmtV = (v, step) => (step >= 1 ? String(Math.round(v)) : String(+v.toFixed(2)));
  /** One setting, two synced representations: a desktop slider row and a phone stepper row (44 px ± buttons). */
  const paired = (lab, min, max, step, val, apply) => {
    const sIn = h("input", { type: "range", min, max, step, value: val });
    const sOut = h("output", null, fmtV(val, step)), pOut = h("output", null, fmtV(val, step));
    const paint = (v) => { sIn.value = v; sOut.textContent = pOut.textContent = fmtV(v, step); };
    const set = (v, fin) => { v = Math.min(max, Math.max(min, Math.round(v / step) * step)); paint(v); apply(v, fin); };
    sIn.addEventListener("input", () => { paint(+sIn.value); apply(+sIn.value, false); });
    sIn.addEventListener("change", () => apply(+sIn.value, true));
    const stp = (t, d) => h("button", { class: "stp", type: "button", "aria-label": `${lab} ${d > 0 ? "more" : "less"}`, onClick: () => set(+sIn.value + d * step, true) }, t);
    return [
      h("label", { class: "row desk-only" }, h("span", null, lab), sIn, sOut),
      h("div", { class: "row stp-row mob-only" }, h("span", null, lab), h("span", { class: "stp-grp" }, stp("−", -1), pOut, stp("+", 1))),
    ];
  };
  const exP = paired("Height exaggeration", 1, 2.2, 0.05, pack.exag, (v, fin) => settings.onExag(v, fin));
  const trP = paired("Tree size", 0.5, 5, 0.1, settings.treeScale, (v) => settings.onTrees(v));
  const lmP = paired("Landmark size", MIN_MULT, 80, 5, settings.landmarkScale, (v) => settings.onLandmarks(v));
  const routesRow = check("Routes", settings.onRoutes, false), routesBox = routesRow.querySelector("input");
  const light2 = h("input", { type: "range", min: 0, max: 1, step: 0.004, value: sky.time, "aria-label": "Time of day" });
  const lt2 = h("output", { class: "lt2" }, "");
  const lightStep = (t, d) => h("button", { class: "stp", type: "button", "aria-label": `Light ${d > 0 ? "later" : "earlier"}`,
    onClick: () => { light.value = Math.min(1, Math.max(0, +light.value + d * 0.05)); settings.onTime(+light.value); upLight(); lt2s.textContent = lt2.textContent; } }, t);
  const lt2s = h("output", { class: "lt2" }, "");
  const pop = h("div", { class: "settings", hidden: true, role: "group", "aria-label": "Map layers and scale" },
    // Light as a stepper on phone (the pill slider is desktop-only; light2/lt2 stay as synced state holders)
    h("div", { class: "row stp-row mob-only" }, h("span", null, "Light"), h("span", { class: "stp-grp" }, lightStep("−", -1), lt2s, lightStep("+", 1))),
    ...exP, ...trP, ...lmP,
    check("Place labels", settings.onLabels), routesRow, check("Roads and buildings", settings.onRoads), check("Trees", settings.onTreesOn),
    h("p", { class: "tier" }, `Quality: ${tier}`));
  const gear = h("button", { class: "ibtn layers-btn", type: "button", "aria-label": "Layers and scale", "aria-expanded": "false", title: "Layers", onClick: () => { pop.hidden = !pop.hidden; gear.setAttribute("aria-expanded", String(!pop.hidden)); } }, svgIcon(ICON.layers));
  const about = h("div", { class: "about", hidden: true }, h("p", null, (m.attribution || []).join(" · ")));
  const menu = h("button", { class: "ibtn", type: "button", "aria-label": "About this map", title: "About and credits", onClick: () => { about.hidden = !about.hidden; if (matchMedia("(max-width: 700px)").matches) pop.hidden = about.hidden; } }, svgIcon(ICON.menu));

  // ---- light pill
  const lightTxt = h("span", { class: "lt" }, "");
  const light = h("input", { type: "range", min: 0, max: 1, step: 0.004, value: sky.time, "aria-label": "Time of day" });
  const upLight = () => { lightTxt.textContent = clockText(+light.value, sky.el); lt2.textContent = lightTxt.textContent.split(" · ")[1] || ""; light2.value = light.value; };
  light2.addEventListener("input", () => { light.value = light2.value; settings.onTime(+light2.value); upLight(); });
  light.addEventListener("input", () => { settings.onTime(+light.value); upLight(); });
  upLight();
  const pill = h("div", { class: "light" }, h("span", { class: "lbl-k" }, "Light"), light, lightTxt);

  const offBtn = onOffline && h("button", { class: "ibtn off-btn", type: "button", "aria-label": `Save ${m.title} for offline`, title: `Save ${m.title} for offline`, onClick: () => onOffline() }, svgIcon(ICON.down));
  const top = h("div", { class: "topright" }, h("div", { class: "trow" }, search, offBtn, gear, menu), pill, pop, about);

  // ---- explore dock
  const dock = h("nav", { class: "dock", "aria-label": "Explore" }, h("span", { class: "dk" }, "Explore"));
  let sel = null;
  for (const a of areas) {
    const b = h("button", { type: "button", onClick: () => { sel?.classList.remove("sel"); sel = b; b.classList.add("sel"); a.go(); } }, a.name);
    dock.append(b);
  }
  const ARROW = { north: "↑", south: "↓", east: "→", west: "←" };
  for (const n of neighbors) dock.append(h("button", { type: "button", class: "nb", title: `Switch to ${n.title}`, onClick: () => onNeighbor(n.slug) }, `${n.title} ${ARROW[n.edge] || ""}`));
  // The dock scrolls horizontally on a phone; a right-edge fade on the wrapper hints at it and disappears at the end.
  const dockWrap = h("div", { class: "dockwrap" }, dock);
  const dockEnd = () => dockWrap.classList.toggle("end", dock.scrollLeft + dock.clientWidth >= dock.scrollWidth - 6);
  dock.addEventListener("scroll", dockEnd, { passive: true });
  const edgeBtn = h("button", { class: "edge-prompt", type: "button", hidden: true }, "");
  let edgeN = null;
  edgeBtn.addEventListener("click", () => edgeN && onNeighbor(edgeN.slug));
  const deselect = () => { sel?.classList.remove("sel"); sel = null; };
  controls.c.addEventListener("start", deselect);

  // ---- bottom right
  const compass = h("button", { class: "compass", type: "button", "aria-label": "Compass. Reset the view to north", title: "Reset north", onClick: () => controls.resetNorth() }, compassSVG());
  const rose = compass.querySelector(".rose");
  const btn = (txt, lab, fn, cls = "") => h("button", { class: `mbtn ${cls}`, type: "button", "aria-label": lab, title: lab, onClick: fn }, txt);
  const zoom = (f) => () => controls.flyTo(controls.target.clone(), Math.min(90000, Math.max(1000, controls.distance * f)), controls.heading, controls.pitchDeg(), 450);
  const tools = h("div", { class: "tools" }, compass, h("div", { class: "zoomgrp" }, btn("+", "Zoom in", zoom(0.6)), btn("−", "Zoom out", zoom(1.6))), btn("⌂", "Home view", () => { deselect(); controls.goHome(); }, "home"));

  const foot = h("footer", { class: "attrib" }, (m.attribution || []).join(" · "), " · Heights exaggerated ×", h("span", { class: "exv" }, pack.exag.toFixed(1)));
  const stats = showFps ? h("pre", { class: "fps" }, "") : null;
  root.append(cart, top, dockWrap, edgeBtn, tools, foot, loading, stats);
  requestAnimationFrame(dockEnd);
  return {
    setProgress(f, text) { bar.style.width = `${Math.round(f * 100)}%`; if (text) label.textContent = `Loading ${text}`; },
    done() { loading.classList.add("gone"); setTimeout(() => loading.remove(), 700); },
    compass(deg) { rose.style.transform = `rotate(${-deg}deg)`; rose.style.transformOrigin = "0 0"; },
    exag(v) { foot.querySelector(".exv").textContent = v.toFixed(1); },
    stats(t) { if (stats) stats.textContent = t; },
    tier(t) { pop.querySelector(".tier").textContent = `Quality: ${t}`; },
    edge(n) { if (n === edgeN) return; edgeN = n; edgeBtn.hidden = !n; if (n) edgeBtn.textContent = `Continue to ${n.title} ${ARROW[n.edge] || ""}`; },
    routes(on) { routesBox.checked = on; settings.onRoutes(on); },
    refreshLight() { light.value = sky.time; upLight(); },
  };
}

/** Explore areas: meta.areas when the pack has them (camera like home_camera), else guessed from place names. */
export function makeAreas(pack, controls, onTreks) {
  const out = [];
  for (const a of pack.meta.areas || []) {
    const cam = a.camera || a, t = cam.target || a.target;
    if (!t) continue;
    const [x, y, z] = t.length === 2 ? [t[0], null, t[1]] : t;
    out.push({ name: a.name || a.title || a.slug, go: () => {
      const v = new THREE.Vector3(x, y == null ? pack.groundY(x, z) : pack.yOf(y), z);
      controls.flyTo(v, cam.distance_m ?? 12000, cam.heading_deg ?? controls.heading, cam.pitch_deg ?? -30, 1800);
      if (/trek/i.test(a.name || a.slug || "")) onTreks?.();
    } });
  }
  if (out.length) return out;
  const by = (re) => pack.places.filter((p) => re.test(p.name) || re.test(p.slug));
  const mid = (list) => list.reduce((acc, p) => acc.add(new THREE.Vector3(p.anchor?.[0] ?? p.x, 0, p.anchor?.[1] ?? p.z)), new THREE.Vector3()).multiplyScalar(1 / list.length);
  const defs = pack.slug === "swat" ? [["Kalam & Ushu", /^(kalam|ushu)/i, 11000], ["Utror & Gabral", /^(utror|gabral)/i, 11000], ["Kumrat", /kumrat/i, 12000]] : [["Mingora", /^mingora/i, 12000], ["Saidu Sharif", /^saidu/i, 8000]];
  for (const [name, re, dist] of defs) {
    const l = by(re).filter((p, i, arr) => arr.findIndex((q) => q.name === p.name) === i).slice(0, 3);
    if (!l.length) continue;
    out.push({ name, go: () => { const t = mid(l); t.y = pack.groundY(t.x, t.z); controls.flyTo(t, dist, controls.heading, -30, 1600); } });
  }
  if (pack.vectors.routes?.length) out.push({ name: "Treks", go: () => { controls.goHome(); onTreks?.(); } });
  return out;
}
