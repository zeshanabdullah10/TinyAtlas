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

/** replaceChildren that skips null/false/undefined like h() does (the native one would print "null"). */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from the sprite in the page (`i-*`). */
export function icon(name, cls = "ic") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#${name}`);
  svg.append(use);
  return svg;
}

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
