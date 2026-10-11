import { h, fill, icon, toast } from "./dom.js";
import { KMH, LABEL, LONG_DAY_MIN, ALT_START_M, ALT_STEP_M, BIG_CLIMB_M, sunsetMin } from "./atlas/localplan.js";

// Plan by talking to the map: the traveller describes the trip, the server's planner picks stops into days and
// measures every leg itself (backend/tinyatlas/planner.py). Each day can be drawn on the miniature.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const IDEAS = ["2 days, relaxed, with kids", "3 days for photographers: best light at the best spots", "1 day, I don't like long drives", "Active: long walks are fine"];
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);
const HOW = { road: "by road", foot: "on foot", mixed: "by road and on foot" };

export function renderPlanner(root, { api, slug, placeName, month, onShowDay }) {
  let current = null;
  const text = h("textarea", { rows: "3", maxlength: "600", "aria-label": "Describe your trip", placeholder: `How long are you in ${placeName}, who's coming, what do you love?` });
  const monthSel = h("select", { "aria-label": "Month of travel" }, ...MONTHS.map((m, i) => h("option", { value: String(i + 1), selected: i + 1 === month() }, m)));
  const go = h("button", { class: "btn btn-primary", type: "submit" }, "Make a plan");
  const out = h("div", { class: "plan-out", "aria-live": "polite" });
  const ideas = h("div", { class: "ask-chips" }, ...IDEAS.map((q) => h("button", { class: "chip", type: "button", onclick: () => { text.value = q; text.focus(); } }, q)));
  const form = h("form", { class: "plan-form", onsubmit: (e) => { e.preventDefault(); ask(text.value); } },
    text, h("div", { class: "plan-row" }, h("label", {}, "Travelling in ", monthSel), go));
  root.replaceChildren(h("p", { class: "vintro" }, "Tell the planner about your trip. It only uses places on this map, and every distance and time is measured on the real roads and paths."), form, ideas, out);

  async function ask(q) {
    q = q.trim(); if (!q) { text.focus(); return; }
    go.disabled = true; go.textContent = current ? "Updating the plan…" : "Planning…";
    out.prepend(h("p", { class: "plan-wait" }, "Measuring roads and choosing stops…"));
    try {
      const plan = await api.plan(slug, { request: q, month: +monthSel.value, current });
      current = plan.choices;
      text.value = ""; text.placeholder = "Change something: 'swap day 2 for something shorter', 'add Borith Lake'…";
      go.textContent = "Change the plan"; ideas.remove();
      show(plan);
    } catch (e) {
      out.querySelector(".plan-wait")?.remove();
      toast(e.message || "The planner couldn't be reached.");
      go.textContent = current ? "Change the plan" : "Make a plan";
    } finally { go.disabled = false; }
  }

  function show(plan) {
    fill(out,
      h("h3", { class: "plan-title" }, plan.title), plan.summary && h("p", { class: "plan-sum" }, plan.summary),
      ...plan.days.map((d) => h("article", { class: "plan-day" },
        h("div", { class: "plan-day-head" }, h("span", { class: "n" }, String(d.n)), h("h4", {}, d.title)),
        h("p", { class: "plan-stats" }, `${d.km} km, about ${dur(d.travel_min)} on the move`, d.sleep ? ` · night in ${d.sleep.name} (${d.sleep.elev.toLocaleString("en")} m)` : ""),
        h("ol", { class: "plan-stops" }, ...d.stops.map((s, i) => h("li", {}, s.name,
          d.legs[i] && d.legs[i].km != null && h("span", { class: "leg" }, `${d.legs[i].km} km ${HOW[d.legs[i].mode]}, about ${dur(d.legs[i].min)}`)))),
        d.notes && h("p", { class: "plan-notes" }, d.notes),
        ...d.warnings.map((w) => h("p", { class: "plan-warn", role: "note" }, w)),
        d.route.length > 1 && h("button", { class: "chip", type: "button", onclick: () => onShowDay(d, plan.title) }, icon("i-route"), "Show this day on the map"))),
      h("p", { class: "mode" }, "Times are estimates for mountain roads and trails; ask locally about road conditions before you set off."));
    out.querySelector(".plan-day .chip")?.focus();
  }
}

// ---- The default planner: runs in the browser on the pack's own roads (atlas/localplan.js), no server needed.
const MAX_STOPS = 6, KEY = "tinyatlas.dayplan";
const clock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;
const km1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const name = (p) => p.short_name || p.name;
const FOOT = "Estimates from mapped road length and a set speed per road type; real times vary with weather and traffic.";

/** Basis sentence for one leg, e.g. "2.1 km minor road at ~25 km/h, 7.7 km jeep track at ~14 km/h". */
export const basis = (mix) => Object.keys(LABEL).filter((c) => mix[c] >= 0.05).map((c) => `${km1(mix[c])} km ${LABEL[c]} at ~${KMH[c]} km/h`).join(", ");

export function renderLocalPlanner(root, { pack, lp, start, onShowDay, onSeeMap }) {
  let stops = start ? [start] : [], q = "";
  const places = pack.places.filter((p) => p.slug);
  const list = h("ol", { class: "lp-stops" }), chips = h("div", { class: "ask-chips lp-sug", "aria-label": "Suggested stops" }), out = h("div", { class: "plan-out lp-out", "aria-live": "polite" });
  const find = h("input", { type: "search", class: "lp-find", placeholder: "Add a stop: type a place", "aria-label": "Add a stop", autocomplete: "off", oninput: (e) => { q = e.target.value.trim().toLowerCase(); suggest(); } });
  const hits = h("ul", { class: "lp-hits" });
  const date = h("input", { type: "date", "aria-label": "Date of travel", value: new Date().toLocaleDateString("en-CA"), onchange: () => render() });
  const time = h("input", { type: "time", "aria-label": "Leaving at", value: "08:00", onchange: () => render() });
  const best = h("button", { class: "chip", type: "button", onclick: () => { stops = lp.bestOrder(stops); render(); } }, "Best order");
  root.replaceChildren(h("p", { class: "vintro" }, "Pick stops on this map. The planner follows the mapped roads between them and tells you how it got each time."),
    list, h("div", { class: "lp-add" }, find, hits), chips, h("div", { class: "plan-row lp-opts" }, h("label", {}, "Date ", date), h("label", {}, "Leaving ", time), best), out);

  const add = (p) => { if (stops.length < MAX_STOPS && !stops.includes(p)) { stops.push(p); find.value = q = ""; render(); } };
  const move = (i, d) => { [stops[i], stops[i + d]] = [stops[i + d], stops[i]]; render(); };
  const sb = (t, lab, fn, dis) => h("button", { class: "lp-b", type: "button", "aria-label": lab, title: lab, disabled: dis, onclick: fn }, t);

  function render() {
    fill(list, ...stops.map((p, i) => h("li", {}, h("span", { class: "n" }, String(i + 1)), h("span", { class: "lp-name" }, name(p)),
      sb("↑", `Move ${name(p)} earlier`, () => move(i, -1), i === 0), sb("↓", `Move ${name(p)} later`, () => move(i, 1), i === stops.length - 1),
      sb("×", `Remove ${name(p)}`, () => { stops.splice(i, 1); render(); }))));
    const full = stops.length >= MAX_STOPS, last = stops[stops.length - 1];
    find.disabled = full; find.placeholder = full ? `Up to ${MAX_STOPS} stops` : stops.length ? "Add a stop: type a place" : "Choose where to start: type a place";
    const rest = places.filter((p) => !stops.includes(p));
    suggest();
    const sug = full ? [] : last ? lp.near(last, rest.filter((p) => p.tier <= 2)).slice(0, 4) : rest.filter((p) => p.tier === 1).slice(0, 4);
    fill(chips, ...(sug.length ? [h("span", { class: "lp-k" }, last ? "Nearby:" : "Start from:"), ...sug.map((p) => h("button", { class: "chip", type: "button", onclick: () => add(p) }, "+ " + name(p)))] : []));
    best.hidden = stops.length < 3;
    summary();
  }

  function suggest() {
    const full = stops.length >= MAX_STOPS;
    fill(hits, ...(q && !full ? places.filter((p) => !stops.includes(p) && (p.name + " " + (p.short_name || "")).toLowerCase().includes(q)).sort((a, b) => (+b.name.toLowerCase().startsWith(q) - +a.name.toLowerCase().startsWith(q)) || a.tier - b.tier).slice(0, 6).map((p) => h("li", {}, h("button", { type: "button", onclick: () => add(p) }, p.name, h("small", {}, ` ${p.kind}`)))) : []));
  }

  function summary() {
    if (stops.length < 2) { fill(out, h("p", { class: "plan-wait" }, stops.length ? "Add a second stop to see the route, distance and time." : "Add a stop to begin.")); return; }
    const pl = lp.plan(stops), warn = [], d = new Date(date.value + "T12:00:00"), [hh, mm] = (time.value || "08:00").split(":").map(Number);
    const el = (p) => p.ground_m ?? pack.heightAt(...lp.posOf(p));
    pl.legs.forEach((l, i) => { if (!l.ok) warn.push(`The map has no road or path between ${name(stops[i])} and ${name(stops[i + 1])}, so that leg is not timed or drawn.`); else if (l.gap_m) warn.push(`${name(stops[i + 1])} is ${l.gap_m} m from the nearest mapped road; that stretch is counted on foot.`); });
    if (pl.minutes > LONG_DAY_MIN) warn.push(`About ${Math.floor(pl.minutes / 60)} h ${String(pl.minutes % 60).padStart(2, "0")} min of travel: a long day.`);
    const rise = el(last0()) - el(stops[0]);
    if (el(last0()) > ALT_START_M && rise > ALT_STEP_M) warn.push(`You'd end ${Math.round(rise)} m higher than you started, at ${Math.round(el(last0()))} m. Above 3,000 m, climbing slowly (about 300-500 m a night) helps avoid altitude sickness.`);
    if (pl.ascent_m > BIG_CLIMB_M) warn.push(`${pl.ascent_m.toLocaleString("en")} m of climbing along the way: a hard day on slow roads.`);
    const sun = sunsetMin(pack, d), arrive = hh * 60 + mm + pl.minutes;
    if (sun != null && arrive > sun - 60) warn.push(`Leaving at ${clock(hh * 60 + mm)} you would arrive about ${clock(arrive)}, within an hour of sunset (about ${clock(sun)}). Part of the drive may be in the dark, with no time counted at the stops.`);
    const title = `${name(stops[0])} to ${name(last0())}`;
    fill(out, h("h3", { class: "plan-title" }, title),
      ...pl.legs.map((l, i) => h("article", { class: "plan-day lp-leg" },
        h("p", { class: "lp-route" }, name(stops[i]), " → ", name(stops[i + 1])),
        l.ok ? h("p", { class: "plan-stats" }, h("b", {}, `${km1(l.km)} km · about ${dur(Math.round(l.minutes))}`), ` — ${basis(l.mix)} · climbs ${l.ascent_m} m`) : h("p", { class: "plan-stats" }, "No mapped road or path joins these two."))),
      h("p", { class: "lp-total" }, h("b", {}, !pl.legs.some((l) => l.ok) ? "Not timed: no mapped road or path joins these stops."   // never "0.0 km · about 0 min"
        : `${pl.legs.every((l) => l.ok) ? "Total" : "Timed legs only:"} ${km1(pl.km)} km · about ${dur(pl.minutes)} · climbs ${pl.ascent_m.toLocaleString("en")} m`)),
      sun != null && h("p", { class: "mode" }, `Sunset on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} is about ${clock(sun)} (Pakistan time, worked out from the date and position).`),
      ...warn.map((w) => h("p", { class: "plan-warn", role: "note" }, w)),
      h("p", { class: "mode" }, FOOT),
      h("div", { class: "lp-acts" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => onSeeMap() }, icon("i-route"), "See it on the map"),
        h("a", { class: "btn", href: `tripkit.html?plan=1&pack=${encodeURIComponent(pack.slug)}`, target: "_blank", rel: "noopener" }, "Print this plan")));
    const route = pl.pts.map(([x, z]) => [x / pack.W, z / pack.H]);
    if (route.length > 1) onShowDay({ n: 1, title, stops: stops.map((p) => ({ slug: p.slug, name: p.name })), route }, title);
    save(title, pl, warn);
  }
  const last0 = () => stops[stops.length - 1];

  function save(title, pl, warn) {
    const r1 = (v) => Math.round(v * 10) / 10;
    const rec = { v: 1, pack: pack.slug, made: new Date().toISOString(), title, stops: stops.map((p) => p.slug),
      legs: pl.legs.map((l) => (l.ok ? { from: l.from, to: l.to, km: r1(l.km), minutes: Math.round(l.minutes), mix: Object.fromEntries(Object.entries(l.mix).map(([c, v]) => [c, r1(v)])), ascent_m: l.ascent_m } : { from: l.from, to: l.to, km: null, minutes: null })),
      total: { km: r1(pl.km), minutes: pl.minutes }, notes: [...warn, FOOT], speeds: KMH };
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* storage blocked: the plan still shows */ }
  }

  render();
  return { setStart(p) { if (p && stops[0] !== p) { stops = [p]; render(); } } };
}
