// "Plan a day" sheet: the app's own planner (js/planner.js, POST /api/plan/<slug>) in a side sheet. A shown day is handed to onShowDay.
import { h } from "../dom.js";
import { api } from "../api.js";
import { renderPlanner } from "../planner.js";

const mobile = () => matchMedia("(max-width: 700px)").matches;

export class PlanSheet {
  constructor(root, pack, { signal, onShowDay, onOpen, onClose }) {
    Object.assign(this, { pack, onShowDay, onOpen, onClose, planner: null, current: null, lastPrefill: "" });
    this.closeBtn = h("button", { class: "pn-close", type: "button", "aria-label": "Close the planner", onClick: () => this.close() }, "×");
    this.body = h("div", { class: "sheet-body" });
    this.el = h("aside", { class: "panel sheet", role: "dialog", "aria-modal": "false", "aria-label": "Plan a day", tabindex: "-1", hidden: true },
      this.closeBtn, h("div", { class: "pn-head" }, h("p", { class: "pn-kind" }, "Trip planner"), h("h2", { class: "pn-name sheet-title" }, "Plan a day")), this.body);
    root.append(this.el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && this.current) this.close(); }, { signal });
  }

  rect() { return this.current ? (innerWidth <= 700 ? [0, innerHeight * 0.3, innerWidth, innerHeight] : [innerWidth - 440, 0, innerWidth, innerHeight]) : null; }

  async build() {
    this.body.replaceChildren(h("p", { class: "vintro" }, "Opening the planner…"));
    const status = await api.status().catch(() => ({ llm: false }));
    if (!status.llm || status.offline) {
      this.body.replaceChildren(h("p", { class: "vintro" }, "The trip planner needs the live Tiny Atlas server, which isn't reachable from here."));
      return;
    }
    const root = h("div", { class: "plan" });
    this.body.replaceChildren(root);
    renderPlanner(root, { api, slug: this.pack.slug, placeName: this.pack.meta.title, month: () => new Date().getMonth() + 1,
      onShowDay: (d, title) => { this.onShowDay(d, title); if (mobile()) this.close(); } });
    this.planner = root;
  }

  async open(place) {
    this.current = place || {};
    this.onOpen?.();                                      // closes the place panel first (it clears has-panel)
    this.el.hidden = false; document.body.classList.add("has-panel");
    requestAnimationFrame(() => this.el.classList.add("open"));
    if (!this.planner) await this.build();
    const ta = this.planner?.querySelector("textarea");
    if (ta && place) {
      const text = `A day from ${place.short_name || place.name}`;
      if (!ta.value.trim() || ta.value === this.lastPrefill) { ta.value = text; this.lastPrefill = text; }
      ta.focus({ preventScroll: true });
    }
  }

  close() {
    if (!this.current) return;
    this.current = null;
    this.el.classList.remove("open"); document.body.classList.remove("has-panel");
    setTimeout(() => { if (!this.current) this.el.hidden = true; }, 260);
    this.onClose?.();
  }
}
