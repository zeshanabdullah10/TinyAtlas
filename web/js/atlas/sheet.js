// "Plan a day" sheet: the in-browser planner (js/planner.js + localplan.js) in a side sheet; a shown day is handed to onShowDay.
import { h } from "../dom.js";
import { api } from "../api.js";
import { tr } from "../i18n.js";
import { renderPlanner, renderLocalPlanner } from "../planner.js";
import { localPlanner } from "./localplan.js";

const mobile = () => matchMedia("(max-width: 700px)").matches;

export class PlanSheet {
  constructor(root, pack, { signal, onShowDay, onOpen, onClose }) {
    Object.assign(this, { pack, onShowDay, onOpen, onClose, planner: null, current: null, lastPrefill: "" });
    this.closeBtn = h("button", { class: "pn-close", type: "button", "aria-label": tr("plan.sheet_close", "Close the planner"), onClick: () => this.close() }, "×");
    this.body = h("div", { class: "sheet-body" });
    this.el = h("aside", { class: "panel sheet", role: "dialog", "aria-modal": "false", "aria-label": tr("plan.sheet_label", "Plan a day"), tabindex: "-1", hidden: true },
      this.closeBtn, h("div", { class: "pn-head" }, h("p", { class: "pn-kind" }, tr("plan.sheet_kind", "Trip planner")), h("h2", { class: "pn-name sheet-title" }, tr("plan.sheet_label", "Plan a day"))), this.body);
    root.append(this.el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && this.current) this.close(); }, { signal });
  }

  rect() { return this.current ? (innerWidth <= 700 ? [0, innerHeight * 0.3, innerWidth, innerHeight] : [innerWidth - 440, 0, innerWidth, innerHeight]) : null; }

  // The default planner runs here in the browser (localplan.js); the AI planner is an optional extra when the live server answers.
  build(place) {
    const local = h("div", { class: "plan lp" }), ai = h("div", { class: "plan lp-ai" });
    this.body.replaceChildren(local, ai);
    let day = null;
    const show = (d, t) => { day = [d, t]; this.onShowDay(d, t); };
    this.lp = renderLocalPlanner(local, { pack: this.pack, lp: localPlanner(this.pack), start: place,
      onShowDay: show, onSeeMap: () => { if (day) this.onShowDay(...day); if (mobile()) this.close(); } });
    this.planner = local;
    api.status().catch(() => ({ llm: false })).then((st) => {
      if (!st.llm || st.offline || !this.planner) return;
      const box = h("details", { class: "lp-more" }, h("summary", {}, tr("plan.ai.summary", "Ask the AI planner for ideas (needs the live server)")), h("div", { class: "plan" }));
      ai.append(box);
      renderPlanner(box.lastChild, { api, slug: this.pack.slug, placeName: this.pack.meta.title, month: () => new Date().getMonth() + 1,
        onShowDay: (d, title) => { this.onShowDay(d, title); if (mobile()) this.close(); } });
    });
  }

  open(place) {
    this.current = place || {};
    this.onOpen?.();                                      // closes the place panel first (it clears has-panel)
    this.el.hidden = false; document.body.classList.add("has-panel");
    requestAnimationFrame(() => this.el.classList.add("open"));
    if (!this.planner) this.build(place?.slug ? place : null); else if (place?.slug) this.lp.setStart(this.pack.places.find((p) => p.slug === place.slug));
    this.planner.querySelector(".lp-find")?.focus({ preventScroll: true });
  }

  close() {
    if (!this.current) return;
    this.current = null;
    this.el.classList.remove("open"); document.body.classList.remove("has-panel");
    setTimeout(() => { if (!this.current) this.el.hidden = true; }, 260);
    this.onClose?.();
  }
}
