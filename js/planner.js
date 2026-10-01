import { h, fill, icon, toast } from "./dom.js";

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
