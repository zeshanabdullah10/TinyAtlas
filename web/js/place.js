import * as THREE from "three";
import { h, icon, kindIcon, KIND_LABEL, toast, fmtKm, fmtM, clamp } from "./dom.js";
import { api } from "./api.js";
import { Diorama } from "./scene.js";

const ATTRIBUTION = "Elevation: Mapzen and AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL). Landmark and guide text © Wikipedia and Wikivoyage contributors (CC BY-SA).";

const fatal = (root, title, text) => root.replaceChildren(h("div", { class: "place" }, h("div", { class: "chrome" },
  h("div", { class: "label fatal", style: "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)" },
    h("h2", {}, title), h("p", {}, text), h("a", { class: "btn", href: "/" }, icon("i-back"), "All places")))));

export async function mountPlace(root, slug, { lm: initialLm = null, clean = false } = {}) {
  document.body.classList.toggle("clean", clean);
  const stage = h("div", { class: "stage" });
  const chrome = h("div", { class: "chrome" });
  root.replaceChildren(h("div", { class: "place" }, stage, chrome));
  const loading = h("div", { class: "label loading", role: "status" }, h("h2", {}, "Unfolding the miniature"), h("div", { class: "bar" }, h("i")));
  chrome.append(loading);

  // ---------- data ----------
  let info, terrain, landmarks, itin, status, texture;
  try {
    [info, terrain, landmarks, itin, status] = await Promise.all([
      api.region(slug), api.terrain(slug, 320), api.landmarks(slug),
      api.itinerary(slug).catch(() => ({ stops: [], route: [] })), api.status().catch(() => ({ llm: false })),
    ]);
    texture = await new THREE.TextureLoader().loadAsync(`/api/texture/${slug}`).catch(() => null);
  } catch (e) {
    return e.status === 404
      ? fatal(root, "That place isn't in the collection", "It may have been removed, or the link is mistyped.")
      : fatal(root, "This miniature didn't load", `${e.message}. Check that the server is running, then reload.`);
  }
  if (!info.ready) return fatal(root, `${info.name} is still being built`, "Come back in a few minutes, or watch its progress on the home page.");
  document.title = `${info.name} | Tiny Atlas`;

  // ---------- scene ----------
  let dio, selected = null;
  const state = { flying: false };
  const els = {};
  dio = new Diorama(stage, { terrain, texture, landmarks, itinerary: itin }, {
    onSelect: (s) => select(s),
    onInteract: () => els.hint?.classList.add("gone"),
    onFly: (e) => flyUi(e),
    onFrame: (az) => {
      els.needle && (els.needle.style.transform = `rotate(${(-az * 180 / Math.PI).toFixed(1)}deg)`);
      if (!window.__ready && dio.introT0 == null) window.__ready = true;
    },
  });
  loading.remove();

  // ---------- title, route rail ----------
  const route = dio.route;
  const byslug = new Map(landmarks.map((l) => [l.slug, l]));
  const onRoute = new Set((route?.stops || []).map((s) => s.slug));
  const stopBtn = new Map();

  const stopItem = (lm, n, dist, off, plain) => {
    const b = h("button", { class: `stop${off ? " off" : ""}${plain ? " plain" : ""}`, type: "button", "aria-current": "false", onclick: () => select(lm.slug) },
      !plain && h("span", { class: "n" }, off ? "" : String(n)), kindIcon(lm.kind), h("span", { class: "nm", title: lm.name }, lm.name),
      h("span", { class: "d" }, dist == null ? "" : dist === 0 ? "Start" : `+${fmtKm(dist)}`));
    stopBtn.set(lm.slug, b);
    return h("li", {}, b);
  };
  const list = h("ol", { class: "stops", "aria-label": "Landmarks" });
  let prev = 0;
  (route?.stops || []).forEach((s, i) => {
    const lm = byslug.get(s.slug); if (!lm) return;
    list.append(stopItem(lm, i + 1, i === 0 ? 0 : s.dist - prev)); prev = s.dist;
  });
  const others = landmarks.filter((l) => !onRoute.has(l.slug));
  if (others.length) {
    if (route?.stops?.length) list.append(h("li", { class: "stops-note" }, "Also on the map, away from the road"));
    others.forEach((l) => list.append(stopItem(l, 0, null, !!route, !route)));
  }

  const profile = route && buildProfile(route, dio);
  els.rail = h("section", { class: "label rail", "aria-label": "Route" },
    h("div", { class: "rail-head" },
      h("h2", {}, route ? "Route" : "Landmarks"),
      route && h("div", { class: "stats" }, `${fmtKm(route.total)} along the route`, h("br"), `${fmtM(route.gain)} of climbing`)),
    list, profile);

  const back = h("a", { class: "btn back", href: "/", "aria-label": "All places" }, icon("i-back"), h("span", { class: "back-text" }, "All places"));
  const left = h("div", { class: "left" }, back,
    h("header", { class: "label titleblock" }, h("h1", {}, info.name), info.subtitle && h("p", { class: "sub" }, info.subtitle)),
    els.rail);

  // ---------- right side: landmark placard and guide ----------
  const placardBody = h("div", { class: "scroll placard" });
  const placardPanel = h("section", { class: "label panel", id: "panel-place", role: "tabpanel", "aria-labelledby": "tab-place" }, placardBody);
  const log = h("div", { class: "log", role: "log", "aria-live": "polite" });
  const input = h("input", { id: "q", type: "text", maxlength: "300", autocomplete: "off", "aria-label": "Ask the guide", placeholder: "Ask about this place" });
  const chips = h("div", { class: "ask-chips", style: "padding:0 16px" });
  const guidePanel = h("section", { class: "label panel chat", id: "panel-guide", role: "tabpanel", "aria-labelledby": "tab-guide", hidden: true },
    log, chips,
    h("form", { class: "ask", onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, h("button", { class: "btn btn-primary", type: "submit", "aria-label": "Send question" }, icon("i-send"))),
    h("p", { class: "mode" }, status.llm ? "Answers come from Wikipedia and Wikivoyage, put into words by an AI model." : "Answers are quoted from Wikipedia and Wikivoyage."));
  const tabPlace = h("button", { class: "tab", id: "tab-place", role: "tab", "aria-selected": "true", "aria-controls": "panel-place", onclick: () => showTab("place") }, "Place");
  const tabGuide = h("button", { class: "tab", id: "tab-guide", role: "tab", "aria-selected": "false", "aria-controls": "panel-guide", onclick: () => showTab("guide") }, "Guide");
  const side = h("aside", { class: "side" }, h("div", { class: "tabs", role: "tablist" }, tabPlace, tabGuide), placardPanel, guidePanel);

  function showTab(name) {
    const guide = name === "guide";
    tabPlace.setAttribute("aria-selected", String(!guide)); tabGuide.setAttribute("aria-selected", String(guide));
    placardPanel.hidden = guide; guidePanel.hidden = !guide;
    if (guide) { renderChips(); setTimeout(() => input.focus({ preventScroll: true }), 0); }
  }

  // two sentences are plenty in a placard; the link goes to the full article
  const intro = (info.intro || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 300);
  const storyCache = new Map();
  function renderRegionCard() {
    placardBody.replaceChildren(
      h("p", { class: "empty" }, h("b", {}, "Pick a landmark. "), "Click one on the map, or choose from the route list.",
        intro && h("span", {}, " ", intro), info.intro_url && h("span", {}, " ", h("a", { href: info.intro_url, target: "_blank", rel: "noopener" }, "Read more"))));
  }
  async function renderPlacard(lm) {
    const story = h("p", { class: "story" }, "Reading up on this place…");
    placardBody.replaceChildren(
      lm.image && h("figure", { class: "photo" }, h("img", { src: lm.image, alt: `${lm.name}`, loading: "lazy", width: 720, height: 450 }),
        h("figcaption", {}, "Photo from ", h("a", { href: lm.url, target: "_blank", rel: "noopener" }, "Wikipedia"), ", licensed as shown there")),
      h("p", { class: "kindline" }, kindIcon(lm.kind), KIND_LABEL[lm.kind] || KIND_LABEL.pin),
      h("h2", {}, lm.name), lm.description && h("p", { class: "desc" }, lm.description), story,
      h("a", { class: "src", href: lm.url, target: "_blank", rel: "noopener" }, "Source: Wikipedia"),
      h("div", { class: "ask-chips" },
        h("button", { class: "chip", type: "button", onclick: () => { showTab("guide"); ask(`Tell me about ${lm.name}`); } }, "Ask the guide about this"),
        h("button", { class: "chip", type: "button", onclick: () => { showTab("guide"); ask(`What is there to see near ${lm.name}?`); } }, "What's nearby?")));
    if (!storyCache.has(lm.slug)) storyCache.set(lm.slug, api.story(slug, lm.slug).then((s) => s.story || lm.summary).catch(() => lm.summary));
    const text = await storyCache.get(lm.slug);
    if (selected === lm.slug) story.textContent = text || lm.summary || "";
  }

  function select(s, { focus = true } = {}) {
    if (s === selected) { if (s) dio.select(s, { focus }); return; }
    selected = s;
    dio.select(s, { focus });
    for (const [k, b] of stopBtn) b.setAttribute("aria-current", String(k === s));
    const url = new URL(location.href);
    s ? url.searchParams.set("lm", s) : url.searchParams.delete("lm");
    history.replaceState(null, "", url);
    if (s) { showTab("place"); renderPlacard(byslug.get(s)); openSheet("place"); }
    else renderRegionCard();
    if (s) stopBtn.get(s)?.scrollIntoView({ block: "nearest" });
  }

  // ---------- guide chat ----------
  const history_ = [];
  function renderChips() {
    chips.replaceChildren();
    if (log.children.length) return;
    const lm = selected && byslug.get(selected);
    const qs = lm ? [`Tell me about ${lm.name}`, "What should I know before visiting?"] : [`What is ${info.name} known for?`, "How do I get there?", "What is there to see?"];
    qs.forEach((q) => chips.append(h("button", { class: "chip", type: "button", onclick: () => ask(q) }, q)));
  }
  async function ask(q) {
    q = q.trim(); if (!q) return;
    input.value = ""; chips.replaceChildren();
    log.append(h("div", { class: "msg q" }, q));
    const a = h("div", { class: "msg a think" }, "Looking through the sources…");
    log.append(a); log.scrollTop = log.scrollHeight;
    try {
      const r = await api.ask(slug, q, history_);
      a.className = "msg a"; a.textContent = r.answer;
      if (r.sources?.length) {
        const c = h("div", { class: "cites" }, "Sources: ");
        r.sources.forEach((s, i) => { if (i) c.append(", "); c.append(h("a", { href: s.url, target: "_blank", rel: "noopener" }, `[${s.n}] ${s.source}`)); });
        a.append(c);
      }
      history_.push({ role: "user", content: q }, { role: "assistant", content: r.answer });
    } catch (e) { a.className = "msg a"; a.textContent = "The guide can't be reached right now. Try again in a moment."; }
    log.scrollTop = log.scrollHeight;
  }

  // ---------- toolbar ----------
  const pressed = (b, on) => b.setAttribute("aria-pressed", String(on));
  const flyBtn = h("button", { class: "btn", type: "button", disabled: !route, onclick: () => (state.flying ? dio.stopFly() : dio.startFly()) }, icon("i-fly"), "Fly the route");
  const mkIcon = (name, label, onclick, extra = {}) => h("button", { class: "icon-btn", type: "button", "aria-label": label, title: label, onclick, ...extra }, icon(name));
  const scaleVal = h("span", {}, "1.5×");
  const scalePop = h("div", { class: "label pop hidden", role: "dialog", "aria-label": "Vertical scale" },
    h("h3", {}, "Vertical scale"),
    h("input", { type: "range", min: "0.5", max: "3", step: "0.1", value: "1.5", "aria-label": "Vertical scale", oninput: (e) => { dio.setExag(+e.target.value); scaleVal.textContent = `${(+e.target.value).toFixed(1)}×`; dio.controls.update(); } }),
    h("div", { class: "val" }, h("span", {}, "True to life is 1×"), scaleVal));
  const layerPop = h("div", { class: "label pop hidden", role: "dialog", "aria-label": "Layers" },
    h("h3", {}, "Show on the map"),
    h("label", {}, h("input", { type: "checkbox", checked: true, onchange: (e) => dio.setLabels(e.target.checked) }), "Landmark labels"),
    h("label", {}, h("input", { type: "checkbox", checked: true, disabled: !route, onchange: (e) => dio.setRoute(e.target.checked) }), "Route"));
  const popBtns = new Map();
  const togglePop = (pop, btn) => {
    const open = pop.classList.contains("hidden");
    for (const [p, b] of popBtns) { p.classList.add("hidden"); pressed(b, false); }
    if (open) { pop.classList.remove("hidden"); pressed(btn, true); }
  };
  const scaleBtn = mkIcon("i-scale", "Vertical scale", () => togglePop(scalePop, scaleBtn), { "aria-pressed": "false", class: "icon-btn optional" });
  const layerBtn = mkIcon("i-layers", "Layers", () => togglePop(layerPop, layerBtn), { "aria-pressed": "false" });
  popBtns.set(scalePop, scaleBtn); popBtns.set(layerPop, layerBtn);
  const toolbar = h("div", { class: "toolbar" },
    flyBtn, mkIcon("i-reset", "Reset view", () => { dio.resetView(); select(null, { focus: false }); }, { class: "icon-btn optional" }),
    scaleBtn, layerBtn,
    mkIcon("i-share", "Copy link", async () => { try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast("Copy the address from the browser bar"); } }),
    mkIcon("i-camera", "Save a picture", () => {
      dio.snapshot(info.name).toBlob((b) => { const a = h("a", { href: URL.createObjectURL(b), download: `tiny-atlas-${slug}.png` }); document.body.append(a); a.click(); a.remove(); toast("Picture saved"); });
    }, { class: "icon-btn optional" }),
    mkIcon("i-help", "Keyboard shortcuts", () => help()),
    scalePop, layerPop);

  // ---------- flight caption ----------
  const capTitle = h("h2", {}), capText = h("p", {}), capBar = h("i");
  const caption = h("div", { class: "label caption hidden", "aria-live": "polite" }, capTitle, capText, h("div", { class: "bar" }, capBar),
    h("button", { class: "icon-btn stopfly", type: "button", "aria-label": "Stop the flight", onclick: () => dio.stopFly() }, icon("i-close")));
  let lastStop = null;
  function flyUi(e) {
    if (e.state === "start") { state.flying = true; flyBtn.replaceChildren(icon("i-stop"), "Stop"); caption.classList.remove("hidden"); lastStop = null; select(null, { focus: false }); }
    if (e.state === "stop") { state.flying = false; flyBtn.replaceChildren(icon("i-fly"), "Fly the route"); caption.classList.add("hidden"); }
    if (e.state === "run" && route) {
      capBar.style.width = `${(e.t * 100).toFixed(1)}%`;
      const stops = route.stops.filter((s) => s.index != null), cur = [...stops].reverse().find((s) => s.index / (route.pts.length - 1) <= e.s + 0.012);
      if (cur?.slug !== lastStop && cur) { lastStop = cur.slug; const lm = byslug.get(cur.slug); capTitle.textContent = lm.name; capText.textContent = lm.summary.split(/(?<=[.!?])\s/)[0]; }
      if (!cur && lastStop !== "start") { lastStop = "start"; capTitle.textContent = info.name; capText.textContent = "Following the road."; }
    }
  }

  // ---------- compass, hint, dock, attribution ----------
  const needle = els.needle = h("span");
  needle.innerHTML = '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 19.5 15h-9L15 3Z" fill="#d2452b"/><path d="M15 27 10.5 15h9L15 27Z" fill="#2c3733"/><circle cx="15" cy="15" r="1.6" fill="#fbfaf6"/></svg>';
  const compass = h("button", { class: "compass", type: "button", "aria-label": "Turn north to the top", title: "North up", onclick: () => dio.northUp() }, needle);
  els.hint = h("p", { class: "hint" }, "Drag to turn it, scroll to zoom, click a landmark.");
  setTimeout(() => els.hint.classList.add("gone"), 9000);
  const sheetBtns = {};
  const openSheet = (name) => {
    const cur = document.body.dataset.sheet;
    const next = cur === name ? "" : name;
    document.body.classList.toggle("sheet-open", !!next); document.body.dataset.sheet = next;
    for (const [n, b] of Object.entries(sheetBtns)) pressed(b, n === next);
    if (next === "guide") showTab("guide"); if (next === "place") showTab("place");
  };
  const dock = h("nav", { class: "dock", "aria-label": "Panels" },
    ...["route", "place", "guide"].map((n) => (sheetBtns[n] = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => openSheet(n) }, n[0].toUpperCase() + n.slice(1)))));
  const attr = h("p", { id: "attr" }, ATTRIBUTION);

  chrome.append(left, toolbar, side, compass, els.hint, caption, dock, attr);
  // labels must not hide under the panels: hand their screen rectangles to the scene
  const measure = () => { dio.occluders = [...chrome.querySelectorAll(".left .label, .side .label, .toolbar > *:not(.pop), .compass, .caption:not(.hidden)")]
    .filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect()); };
  setInterval(measure, 400);
  // keep the model centred in the space the panels leave free
  const fit = () => { dio.viewShift = innerWidth > 900 ? 60 : 0; dio.resize(); measure(); };
  addEventListener("resize", fit); fit();
  renderRegionCard();

  // ---------- help dialog and keys ----------
  function help() {
    const close = () => { back.remove(); document.removeEventListener("keydown", esc, true); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const back = h("div", { class: "dialog-back", onclick: (e) => e.target === back && close() },
      h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" },
        h("h2", {}, "Moving around"),
        h("div", { class: "keys" }, h("kbd", {}, "F"), "Fly along the route", h("kbd", {}, "R"), "Reset the view", h("kbd", {}, "L"), "Show or hide labels",
          h("kbd", {}, "/"), "Ask the guide", h("kbd", {}, "Esc"), "Close a landmark or stop the flight", h("kbd", {}, "Arrows"), "Move the view (click the map first)"),
        h("button", { class: "btn btn-primary", type: "button", onclick: close }, "Got it")));
    document.body.append(back); document.addEventListener("keydown", esc, true); back.querySelector("button").focus();
  }
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "f" && route) state.flying ? dio.stopFly() : dio.startFly();
    else if (k === "r") { dio.resetView(); select(null, { focus: false }); }
    else if (k === "l") { const on = !dio.labelsOn; dio.setLabels(on); layerPop.querySelector("input").checked = on; }
    else if (k === "/") { e.preventDefault(); showTab("guide"); openSheet("guide"); }
    else if (k === "?") help();
    else if (k === "escape") { if (state.flying) dio.stopFly(); else if (selected) select(null, { focus: false }); for (const [p, b] of popBtns) { p.classList.add("hidden"); pressed(b, false); } }
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".pop, .toolbar")) for (const [p, b] of popBtns) { p.classList.add("hidden"); pressed(b, false); } });

  // ---------- hooks used by the test and export tools ----------
  window.__landmarks = landmarks.length;
  window.__open = (s) => select(s);
  window.__project = (s) => dio.project(s);
  window.renderFrame = (t) => dio.renderFrame(t);
  window.__flyPose = (t) => { const f = dio.flyPose(t); return f && { cam: f.cam.toArray(), look: f.look.toArray(), widthM: dio.widthM, heightM: dio.heightM }; };
  window.__dio = dio;

  if (initialLm && byslug.has(initialLm)) setTimeout(() => select(initialLm), 2300);
}

/** Elevation profile of the route: an SVG you can scrub to move a marker along the road on the map. */
function buildProfile(route, dio) {
  const pts = route.pts, N = 180, pick = (i) => pts[Math.round(i / (N - 1) * (pts.length - 1))];
  const lo = route.min, hi = route.max, span = Math.max(hi - lo, 1);
  const X = (i) => (i / (N - 1)) * 100, Y = (e) => 36 - ((e - lo) / span) * 32;
  let d = "";
  for (let i = 0; i < N; i++) d += `${i ? "L" : "M"}${X(i).toFixed(2)},${Y(pick(i).e).toFixed(2)}`;
  const ticks = route.stops.filter((s) => s.index != null).map((s) => `<line class="tick" x1="${(s.index / (pts.length - 1) * 100).toFixed(2)}" x2="${(s.index / (pts.length - 1) * 100).toFixed(2)}" y1="0" y2="40"/>`).join("");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 40"); svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Elevation along the route, from ${fmtM(lo)} to ${fmtM(hi)}`);
  svg.innerHTML = `<path class="area" d="${d}L100,40L0,40Z"/><path class="ln" d="${d}"/>${ticks}<line class="scrub" x1="0" x2="0" y1="0" y2="40" style="display:none"/>`;
  const scrub = svg.querySelector(".scrub");
  const cap = h("div", { class: "cap" }, h("span", {}, `Low ${fmtM(lo)}`), h("span", {}, `High ${fmtM(hi)}`));
  const [capL, capR] = cap.children;
  const set = (f) => {
    if (f == null) { scrub.style.display = "none"; capL.textContent = `Low ${fmtM(lo)}`; capR.textContent = `High ${fmtM(hi)}`; dio.scrub(null); return; }
    const p = dio.scrub(f); scrub.style.display = ""; scrub.setAttribute("x1", (f * 100).toFixed(2)); scrub.setAttribute("x2", (f * 100).toFixed(2));
    capL.textContent = `${fmtKm(p.d)} along`; capR.textContent = `${fmtM(p.e)} up`;
  };
  const at = (e) => { const r = svg.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
  svg.addEventListener("pointermove", (e) => set(at(e)));
  svg.addEventListener("pointerleave", () => set(null));
  svg.addEventListener("pointerdown", (e) => set(at(e)));
  return h("div", { class: "profile" }, svg, cap);
}
