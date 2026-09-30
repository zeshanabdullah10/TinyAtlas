// Tiny DOM helpers. Text always goes in as text nodes, never as HTML.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from the sprite in index.html (`i-*` for interface, `k-*` for landmark kinds). */
export function icon(name, cls = "ic") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}

export const kindIcon = (kind) => icon(`k-${KINDS.has(kind) ? kind : "pin"}`);
export const KINDS = new Set(["fort", "temple", "peak", "glacier", "lake", "waterfall", "bridge", "museum", "tower",
  "ruins", "monument", "park", "town", "rail", "pin"]);

export const KIND_LABEL = {
  fort: "Fort or palace", temple: "Place of worship", peak: "Peak", glacier: "Glacier", lake: "Lake",
  waterfall: "Waterfall", bridge: "Bridge", museum: "Museum", tower: "Tower", ruins: "Ruins",
  monument: "Monument", park: "Park or natural area", town: "Town", rail: "Railway", pin: "Place of interest",
};

export function toast(message, ms = 2600) {
  const t = h("div", { class: "toast" }, message);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), ms);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const fmtKm = (m) => (m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`);
export const fmtM = (m) => `${Math.round(m).toLocaleString("en")} m`;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
