import * as THREE from "three";
import { h, fill, icon, kindIcon, KIND_LABEL, toast, fmtKm, fmtM, clamp } from "./dom.js";
import { api, BASE } from "./api.js";
import { Diorama } from "./scene.js";
import { sunPosition, riseSet, localInstant, utcOffsetMin, clock } from "./sun.js";
import { openPanorama } from "./panorama.js";
import { renderViews } from "./views.js";
import { renderPlanner } from "./planner.js";
import { makeListen } from "./listen.js";
import { openKeepsake } from "./keepsake.js";

const ATTRIBUTION = "Elevation: Mapzen and AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL). Landmark and guide text © Wikipedia and Wikivoyage contributors (CC BY-SA).";

const fatal = (root, title, text) => root.replaceChildren(h("div", { class: "place" }, h("div", { class: "chrome" },
  h("div", { class: "label fatal", style: "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)" },
    h("h2", {}, title), h("p", {}, text), h("a", { class: "btn", href: `${BASE}` }, icon("i-back"), "All places")))));

export async function mountPlace(root, slug, { lm: initialLm = null, clean = false } = {}) {
  document.body.classList.toggle("clean", clean);
  const stage = h("div", { class: "stage" });
  const chrome = h("div", { class: "chrome" });
  root.replaceChildren(h("div", { class: "place" }, stage, chrome));
  const loading = h("div", { class: "label loading", role: "status" }, h("h2", {}, "Unfolding the miniature"), h("div", { class: "bar" }, h("i")));
  chrome.append(loading);

  // ---------- data ----------
  let info, terrain, landmarks, itin, status, texture, viewpoints;
  try {
    [info, terrain, landmarks, itin, status, viewpoints] = await Promise.all([
      api.region(slug), api.terrain(slug, 320), api.landmarks(slug),
      api.itinerary(slug).catch(() => ({ stops: [], route: [] })), api.status().catch(() => ({ llm: false })),
      api.views(slug).then((v) => v.filter((x) => Object.keys(x.images).length)).catch(() => []),
    ]);
    texture = await new THREE.TextureLoader().loadAsync(api.textureUrl(slug)).catch(() => null);
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
  dio = new Diorama(stage, { terrain, texture, landmarks, itinerary: itin, viewFrom: info.view_from }, {
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
  let route = dio.route;
  const byslug = new Map(landmarks.map((l) => [l.slug, l]));
  const stopBtn = new Map();

  const stopItem = (lm, n, dist, off, plain) => {
    const b = h("button", { class: `stop${off ? " off" : ""}${plain ? " plain" : ""}`, type: "button", "aria-current": "false", onclick: () => select(lm.slug) },
      !plain && h("span", { class: "n" }, off ? "" : String(n)), kindIcon(lm.kind), h("span", { class: "nm", title: lm.name }, lm.name),
      h("span", { class: "d" }, dist == null ? "" : dist === 0 ? "Start" : `+${fmtKm(dist)}`));
    stopBtn.set(lm.slug, b);
    return h("li", {}, b);
  };
  els.rail = h("section", { class: "label rail", "aria-label": "Route" });
  /** The left rail for an itinerary: the place's tour, or a planned day (with a way back to the tour). */
  function renderRail(it, back = null) {
    route = dio.route; stopBtn.clear();
    const onRoute = new Set((route?.stops || []).map((s) => s.slug));
    const list = h("ol", { class: "stops", "aria-label": "Landmarks" });
    let prev = 0;
    (route?.stops || []).forEach((s, i) => {
      const lm = byslug.get(s.slug); if (!lm) return;
      list.append(stopItem(lm, i + 1, i === 0 ? 0 : s.dist - prev)); prev = s.dist;
    });
    const others = back ? [] : landmarks.filter((l) => !onRoute.has(l.slug));
    if (others.length) {
      if (route?.stops?.length) list.append(h("li", { class: "stops-note" }, "Also on the map, away from the road"));
      others.forEach((l) => list.append(stopItem(l, 0, null, !!route, !route)));
    }
    fill(els.rail,
      h("div", { class: "rail-head" },
        h("h2", {}, route ? it.name || "Route" : "Landmarks"),
        route && h("div", { class: "stats" }, `${fmtKm(route.total)} along the route`, h("br"), `${fmtM(route.gain)} of climbing`)),
      back && h("button", { class: "chip rail-back", type: "button", onclick: back }, icon("i-back"), "Back to the classic route"),
      list, route && buildProfile(route, dio));
    if (els.flyBtn) els.flyBtn.disabled = !route;
  }
  renderRail(itin);
  /** Draw a planned day on the map and in the rail. */
  const showDay = (day, planTitle) => {
    dio.setItinerary({ route: day.route, stops: day.stops.map((s) => ({ slug: s.slug, name: s.name })) });
    renderRail({ name: `Day ${day.n}: ${day.title}` }, () => { dio.setItinerary(itin); renderRail(itin); dio.resetView(); });
    dio.resetView();
    if (innerWidth <= 900) openSheet("route", true);
  };

  const back = h("a", { class: "btn back", href: `${BASE}`, "aria-label": "All places" }, icon("i-back"), h("span", { class: "back-text" }, "All places"));
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
    h("p", { class: "mode" }, status.offline ? "The guide isn't available on this copy of Tiny Atlas."
      : status.llm ? "Answers come from Wikipedia and Wikivoyage, put into words by an AI model." : "Answers are quoted from Wikipedia and Wikivoyage."));
  const viewsBody = h("div", { class: "scroll views" });
  let viewsUi = null;
  const panels = { place: placardPanel, guide: guidePanel };
  if (viewpoints.length) panels.views = h("section", { class: "label panel", id: "panel-views", role: "tabpanel", "aria-labelledby": "tab-views", hidden: true }, viewsBody);
  const planBody = h("div", { class: "scroll plan" });
  if (status.llm && !status.offline) panels.plan = h("section", { class: "label panel", id: "panel-plan", role: "tabpanel", "aria-labelledby": "tab-plan", hidden: true }, planBody);
  const TAB_LABEL = { place: "Place", views: "Views", plan: "Plan", guide: "Guide" };
  const order = ["place", "views", "plan", "guide"].filter((k) => panels[k]);
  const tabs = Object.fromEntries(order.map((k) => [k, h("button", { class: "tab", id: `tab-${k}`, role: "tab", "aria-selected": String(k === "place"), "aria-controls": `panel-${k}`, onclick: () => showTab(k) }, TAB_LABEL[k])]));
  const side = h("aside", { class: "side" }, h("div", { class: "tabs", role: "tablist" }, ...Object.values(tabs)), ...order.map((k) => panels[k]));

  function showTab(name) {
    if (!panels[name]) name = "place";
    for (const k of order) { tabs[k].setAttribute("aria-selected", String(k === name)); panels[k].hidden = k !== name; }
    if (name === "guide") { renderChips(); setTimeout(() => input.focus({ preventScroll: true }), 0); }
  }

  // two sentences are plenty in a placard; the link goes to the full article
  const intro = (info.intro || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 300);
  const storyCache = new Map();
  const listen = makeListen({ api, slug });
  // "Know before you go": practical facts, each backed by a quote the server found in its source
  const TOPIC = { getting_there: "Getting there", getting_around: "Getting around", when_to_go: "When to go", permits: "Permits and fees",
    health: "Altitude and health", money: "Money and connectivity", safety: "Staying safe", respect: "Local customs" };
  const factsP = api.facts(slug).catch(() => ({ facts: [] }));
  const knowBox = h("section", { class: "know", "aria-label": "Know before you go" });
  factsP.then(({ facts, checked }) => {
    if (!facts?.length) return;
    const groups = {};
    for (const f of facts) (groups[f.topic] = groups[f.topic] || []).push(f);
    knowBox.replaceChildren(h("h3", {}, "Know before you go"),
      ...Object.entries(groups).map(([t, fs]) => h("details", { open: t === "when_to_go" || t === "getting_there" },
        h("summary", {}, TOPIC[t] || t),
        h("ul", {}, ...fs.map((f) => h("li", {}, f.text, " ", h("a", { href: f.url, target: "_blank", rel: "noopener", title: `“${f.quote}”` }, f.source)))))),
      h("p", { class: "mode" }, `From Wikivoyage and Wikipedia${checked ? `, checked ${checked}` : ""}. Things change in the mountains; confirm locally.`));
  });
  function renderRegionCard() {
    fill(placardBody,
      h("p", { class: "empty" }, h("b", {}, "Pick a landmark. "), "Click one on the map, or choose from the route list.",
        intro && h("span", {}, " ", intro), info.intro_url && h("span", {}, " ", h("a", { href: info.intro_url, target: "_blank", rel: "noopener" }, "Read more"))),
      knowBox);
  }
  async function renderPlacard(lm) {
    const story = h("p", { class: "story" }, "Reading up on this place…");
    fill(placardBody,
      lm.image && h("figure", { class: "photo" }, h("img", { src: lm.image, alt: `${lm.name}`, loading: "lazy", width: 720, height: 450 }),
        h("figcaption", {}, "Photo from ", h("a", { href: lm.url, target: "_blank", rel: "noopener" }, "Wikipedia"), ", licensed as shown there")),
      h("p", { class: "kindline" }, kindIcon(lm.kind), KIND_LABEL[lm.kind] || KIND_LABEL.pin),
      h("h2", {}, lm.name), lm.description && h("p", { class: "desc" }, lm.description), story,
      h("a", { class: "src", href: lm.url, target: "_blank", rel: "noopener" }, "Source: Wikipedia"),
      listen.row(lm),
      h("div", { class: "ask-chips" },
        h("button", { class: "chip", type: "button", onclick: () => { showTab("guide"); ask(`Tell me about ${lm.name}`); } }, "Ask the guide about this"),
        h("button", { class: "chip", type: "button", onclick: () => view(lm.lat, lm.lon, lm.name) }, "What can I see from here?"),
        h("button", { class: "chip", type: "button", onclick: () => { showTab("guide"); ask(`What is there to see near ${lm.name}?`); } }, "What's nearby?")));
    if (!storyCache.has(lm.slug)) storyCache.set(lm.slug, api.story(slug, lm.slug).then((s) => s.story || lm.summary).catch(() => lm.summary));
    const text = await storyCache.get(lm.slug);
    if (selected === lm.slug) story.textContent = text || lm.summary || "";
  }

  function select(s, { focus = true } = {}) {
    if (s === selected) {
      // on the phone, a tap on the map (the same landmark again, or open ground) closes the sheet
      if (innerWidth <= 900 && document.body.classList.contains("sheet-open")) openSheet(document.body.dataset.sheet);
      else if (s) dio.select(s, { focus });
      return;
    }
    selected = s;
    dio.select(s, { focus });
    for (const [k, b] of stopBtn) b.setAttribute("aria-current", String(k === s));
    const url = new URL(location.href);
    s ? url.searchParams.set("lm", s) : url.searchParams.delete("lm");
    history.replaceState(null, "", url);
    if (s) { showTab("place"); renderPlacard(byslug.get(s)); if (innerWidth <= 900) openSheet("place", true); }
    else {
      renderRegionCard();
      if (innerWidth <= 900 && document.body.classList.contains("sheet-open")) openSheet(document.body.dataset.sheet);
    }
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
  const flyBtn = els.flyBtn = h("button", { class: "btn", type: "button", disabled: !route, onclick: () => (state.flying ? dio.stopFly() : dio.startFly()) }, icon("i-fly"), "Fly the route");
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
  // ---------- light: studio, or the real sun for a date and time on the place's own clock ----------
  const [lat, lon] = info.center || [0, 0], tz = info.tz;
  const today = new Date(Date.now() + utcOffsetMin(new Date(), tz, lon) * 60000);       // the place's calendar date
  const light = { real: false, y: today.getUTCFullYear(), m: today.getUTCMonth(), d: today.getUTCDate(), min: 17 * 60, play: null,
    season: "summer", pinned: false };                  // pinned: the visitor chose a season, so the date no longer sets it
  const seasons = info.seasons?.length ? info.seasons : ["summer"];
  const SEASON_OF_MONTH = ["winter", "winter", "spring", "spring", "summer", "summer", "summer", "summer", "summer", "autumn", "autumn", "winter"];
  const textures = new Map([["summer", Promise.resolve(texture)]]);
  const seasonBtns = Object.fromEntries(seasons.map((s) => [s, h("button", { class: "seg", type: "button", onclick: () => { light.pinned = true; setSeason(s); } },
    s[0].toUpperCase() + s.slice(1))]));
  async function setSeason(s) {
    if (!seasons.includes(s)) s = "summer";
    light.season = s;
    viewsUi?.setSeason(s);
    for (const [k, b] of Object.entries(seasonBtns)) b.setAttribute("aria-pressed", String(k === s));
    if (!textures.has(s)) textures.set(s, new THREE.TextureLoader().loadAsync(api.textureUrl(slug, s)).catch(() => null));
    const tex = await textures.get(s);
    if (tex && light.season === s) dio.setTexture(tex);
  }
  const followDate = () => { if (!light.pinned) setSeason(SEASON_OF_MONTH[light.m]); };
  const dateIn = h("input", { type: "date", "aria-label": "Date", value: today.toISOString().slice(0, 10) });
  const timeIn = h("input", { type: "range", min: "0", max: "1439", step: "5", value: String(light.min), "aria-label": "Time of day" });
  const timeVal = h("span", { class: "time" }), sunLine = h("p", { class: "sunline" }), sunChips = h("div", { class: "sun-chips" });
  const modeBtns = { studio: h("button", { class: "seg", type: "button" }, "Studio"), real: h("button", { class: "seg", type: "button" }, "Real sun") };
  const instant = () => localInstant(light.y, light.m, light.d, light.min, tz, lon);
  const minutesOf = (t) => { const l = new Date(t.getTime() + utcOffsetMin(t, tz, lon) * 60000); return l.getUTCHours() * 60 + l.getUTCMinutes(); };
  const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  function applyLight() {
    for (const [k, b] of Object.entries(modeBtns)) b.setAttribute("aria-pressed", String((k === "real") === light.real));
    lightPop.classList.toggle("studio", !light.real);
    if (!light.real) { dio.setSun(null); sunLine.textContent = "Soft light from the northwest, as the map was painted."; return; }
    const t = instant(), [az, alt] = sunPosition(t, lat, lon);
    dio.setSun({ az, alt });
    timeIn.value = String(light.min);
    timeVal.textContent = clock(t, tz, lon);
    sunLine.textContent = alt > 0 ? `The sun is ${Math.round(alt)}° up, in the ${COMPASS[Math.round(az / 45) % 8]}.` : "The sun is down.";
  }
  function dayChips() {
    const noon = localInstant(light.y, light.m, light.d, 12 * 60, tz, lon);
    const [rise, set] = riseSet(noon, lat, lon), [, golden] = riseSet(noon, lat, lon, 6);
    sunChips.replaceChildren(...[["Sunrise", rise], ["Golden hour", golden], ["Sunset", set]].map(([label, t]) =>
      h("button", { class: "chip", type: "button", disabled: !t, onclick: () => { stopDay(); light.real = true; light.min = minutesOf(t) + (label === "Sunset" ? -4 : 0); applyLight(); } },
        label, " ", h("b", {}, clock(t, tz, lon)))));
    return [rise, set];
  }
  function playDay() {
    if (light.play) return stopDay();
    const [rise, set] = dayChips(); if (!rise) return;
    const a = minutesOf(rise) - 25, b = minutesOf(set) + 30, t0 = performance.now(), ms = 16000;
    light.real = true; playBtn.replaceChildren(icon("i-stop"), "Stop");
    const step = (now) => {
      const f = Math.min(1, (now - t0) / ms);
      light.min = Math.round(a + (b - a) * f); applyLight();
      light.play = f < 1 ? requestAnimationFrame(step) : (stopDay(), null);
    };
    light.play = requestAnimationFrame(step);
  }
  function stopDay() { if (light.play) cancelAnimationFrame(light.play); light.play = null; playBtn.replaceChildren(icon("i-play"), "Play the day"); }
  const playBtn = h("button", { class: "btn", type: "button", onclick: playDay }, icon("i-play"), "Play the day");
  modeBtns.studio.onclick = () => { stopDay(); light.real = false; applyLight(); };
  modeBtns.real.onclick = () => { light.real = true; applyLight(); };
  dateIn.addEventListener("change", () => { const [y, m, d] = dateIn.value.split("-").map(Number); if (!y) return;
    Object.assign(light, { y, m: m - 1, d }); dayChips(); followDate(); if (light.real) applyLight(); });
  timeIn.addEventListener("input", () => { stopDay(); light.real = true; light.min = +timeIn.value; applyLight(); });
  const lightPop = h("div", { class: "label pop hidden light-pop", role: "dialog", "aria-label": "Light" },
    h("h3", {}, "Light"),
    h("div", { class: "segs", role: "group", "aria-label": "Light" }, modeBtns.studio, modeBtns.real),
    h("div", { class: "sun-when" }, dateIn, timeVal), timeIn, sunChips, sunLine, playBtn,
    seasons.length > 1 && h("h3", {}, "Season"),
    seasons.length > 1 && h("div", { class: "segs seasons", role: "group", "aria-label": "Season" }, ...Object.values(seasonBtns)),
    seasons.length > 1 && h("p", { class: "sunline" }, "Seasons follow the date. Their colours and snow show typical conditions, painted from the real terrain."));
  dayChips(); applyLight(); setSeason("summer");

  const popBtns = new Map();
  const togglePop = (pop, btn) => {
    const open = pop.classList.contains("hidden");
    for (const [p, b] of popBtns) { p.classList.add("hidden"); pressed(b, false); }
    if (open) { pop.classList.remove("hidden"); pressed(btn, true); }
  };
  const scaleBtn = mkIcon("i-scale", "Vertical scale", () => togglePop(scalePop, scaleBtn), { "aria-pressed": "false", class: "icon-btn optional" });
  const layerBtn = mkIcon("i-layers", "Layers", () => togglePop(layerPop, layerBtn), { "aria-pressed": "false" });
  const lightBtn = mkIcon("i-sun", "Light and time of day", () => togglePop(lightPop, lightBtn), { "aria-pressed": "false" });
  // ---------- "What can I see from here?" ----------
  const [bw, bs, be, bn] = info.bbox;
  const view = (la, lo, title) => openPanorama({ api, slug, lat: la, lon: lo, title, sun: { date: instant(), now: light.real ? instant() : null } });
  const nearestName = (u, v) => {
    let best = null, bd = Infinity;
    for (const l of landmarks) { const d = Math.hypot((l.u - u) * dio.widthM, (l.v - v) * dio.heightM); if (d < bd) { bd = d; best = l; } }
    return best && bd < 1500 ? `near ${best.name}` : "this spot";
  };
  const seeBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => {
    if (dio.onGround) { dio.onGround = null; seeBtn.setAttribute("aria-pressed", "false"); els.hint.classList.add("gone"); return; }
    seeBtn.setAttribute("aria-pressed", "true");
    els.hint.textContent = "Tap the map where you would stand."; els.hint.classList.remove("gone");
    if (innerWidth <= 900) toast("Tap the map where you would stand");
    dio.onGround = ({ u, v }) => {
      seeBtn.setAttribute("aria-pressed", "false"); els.hint.classList.add("gone");
      view(bn - v * (bn - bs), bw + u * (be - bw), nearestName(u, v));
    };
  } }, icon("i-eye"), "What can I see?");
  const uvOf = (la, lo) => ({ u: (lo - bw) / (be - bw), v: (bn - la) / (bn - bs) });
  // offline: the whole place (terrain, previews, audio, models) into the browser's cache, for the valley with no signal
  const saveBtn = mkIcon("i-down", "Save this place for offline", async () => {
    let sw = navigator.serviceWorker?.controller;
    if (!sw && navigator.serviceWorker) {          // on a first visit the worker claims the page a moment after load
      try {
        sw = await new Promise((res) => {
          const t = setTimeout(res, 4000);
          navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(t); res(navigator.serviceWorker.controller); }, { once: true });
        });
      } catch { /* fall through to the hint */ }
    }
    if (!sw) { toast("Offline saving needs this page to be opened once more, then try again"); return; }
    saveBtn.disabled = true; saveBtn.title = "Preparing…";
    const urls = await api.offlineUrls(slug), id = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      if (e.data?.type !== "save-progress" || e.data.id !== id) return;
      saveBtn.title = `Saving ${Math.round((e.data.done / e.data.total) * 100)}%`;
      if (e.data.done === e.data.total) {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        saveBtn.title = e.data.failed ? `Saved (${e.data.failed} files missing)` : "Saved for offline";
        toast(e.data.failed ? `Saved, but ${e.data.failed} files were missing` : "Saved for offline");
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    sw.postMessage({ type: "save", urls, id });
  }, { class: "icon-btn optional" });
  if (panels.plan) renderPlanner(planBody, { api, slug, placeName: info.name, month: () => light.m + 1, onShowDay: showDay });
  if (viewpoints.length) viewsUi = renderViews(viewsBody, { api, slug, views: viewpoints, season: light.season,
    onPanorama: (vp) => view(vp.lat, vp.lon, vp.name),
    onShowOnMap: (vp) => { const { u, v } = uvOf(vp.lat, vp.lon); select(null, { focus: false }); dio.lookFrom(u, v, vp.heading); } });
  popBtns.set(scalePop, scaleBtn); popBtns.set(layerPop, layerBtn); popBtns.set(lightPop, lightBtn);
  const toolbar = h("div", { class: "toolbar" },
    seeBtn, flyBtn, mkIcon("i-reset", "Reset view", () => { dio.resetView(); select(null, { focus: false }); }, { class: "icon-btn optional" }),
    lightBtn, scaleBtn, layerBtn, saveBtn,
    mkIcon("i-share", "Copy link", async () => { try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast("Copy the address from the browser bar"); } }),
    mkIcon("i-camera", "Save a picture", () => {
      dio.snapshot(info.name).toBlob((b) => { const a = h("a", { href: URL.createObjectURL(b), download: `tiny-atlas-${slug}.png` }); document.body.append(a); a.click(); a.remove(); toast("Picture saved"); });
    }, { class: "icon-btn optional" }),
    mkIcon("i-film", "My trip: photos and a film", () => openKeepsake({ dio, info }), { class: "icon-btn optional" }),
    mkIcon("i-help", "Keyboard shortcuts", () => help()),
    scalePop, layerPop, lightPop);

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
  const openSheet = (name, force = false) => {          // dock buttons toggle; selecting a landmark always opens
    const cur = document.body.dataset.sheet;
    const next = !force && cur === name ? "" : name;
    document.body.classList.toggle("sheet-open", !!next); document.body.dataset.sheet = next;
    dio.viewShiftY = next && innerWidth <= 900 ? Math.round(innerHeight * 0.24) : 0;      // keep the model above the sheet
    dio.resize();
    for (const [n, b] of Object.entries(sheetBtns)) pressed(b, n === next);
    if (panels[next]) showTab(next);
  };
  const dock = h("nav", { class: "dock", "aria-label": "Panels" },
    ...["route", ...order].map((n) => (sheetBtns[n] = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => openSheet(n) }, n[0].toUpperCase() + n.slice(1)))));
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
    else if (k === "/") { e.preventDefault(); showTab("guide"); if (innerWidth <= 900) openSheet("guide", true); }
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
  window.__view = (la, lo, title) => view(la, lo, title);
  window.__listen = listen.state;                     // the audio guide: { paused, playing }
  window.__sun = (date, hhmm) => {                   // "2026-10-12", "07:30": the real sun then, on the place's clock
    const [y, m, d] = date.split("-").map(Number), [hh, mm] = hhmm.split(":").map(Number);
    Object.assign(light, { real: true, y, m: m - 1, d, min: hh * 60 + mm }); dateIn.value = date; dayChips(); followDate(); applyLight();
  };

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
