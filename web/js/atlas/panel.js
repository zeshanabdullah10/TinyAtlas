// Place side sheet (440 px on the right, bottom sheet on mobile): photo with credit, kind, name (+Urdu), stats, story, sources.
import { h, fill, KIND_LABEL } from "../dom.js";

const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };

export class Panel {
  constructor(root, pack, { onClose, onFly, signal } = {}) {
    this.pack = pack; this.onClose = onClose; this.onFly = onFly; this.current = null; this.opener = null;
    this.body = h("div", { class: "pn-body" });
    this.closeBtn = h("button", { class: "pn-close", type: "button", "aria-label": "Close", onClick: () => this.close() }, "×");
    this.el = h("aside", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": "Place details", tabindex: "-1", hidden: true }, this.closeBtn, this.body);
    root.append(this.el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && this.current) this.close(); }, { signal });
    addEventListener("pointerdown", (e) => {
      if (!this.current || this.el.contains(e.target)) return;
      if (e.target.closest?.(".chip, .search, .dock, .light")) return;       // those switch place or camera instead
      this.close();
    }, { capture: true, signal });
  }

  /** Screen rectangle taken by the sheet, so labels underneath can hide: [x0, y0, x1, y1] or null. */
  rect() {
    if (!this.current) return null;
    const r = this.el.getBoundingClientRect();
    return innerWidth <= 700 ? [0, innerHeight - Math.min(innerHeight * 0.72, r.height), innerWidth, innerHeight] : [innerWidth - 440, 0, innerWidth, innerHeight];
  }

  open(place, opener = document.activeElement) {
    this.current = place; this.opener = opener;
    const p = place, e = p.label_elevation_m ?? p.ground_m;
    const kind = KIND_LABEL[p.kind] || (p.kind ? p.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Place");
    const stats = [["Elevation", e != null ? `${Math.round(e).toLocaleString("en")} m` : "—"], ["Area", p.area || "—"], ["Confidence", p.confidence || "—"]];
    fill(this.body,
      this.hero(p),
      h("div", { class: "pn-head" },
        h("p", { class: "pn-kind" }, kind),
        h("div", { class: "pn-title" }, h("h2", { class: "pn-name" }, p.name), p.name_ur ? h("span", { class: "pn-ur", lang: "ur", dir: "rtl" }, p.name_ur) : null),
        h("dl", { class: "pn-stats" }, stats.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
        p.summary ? h("p", { class: "pn-sum" }, p.summary) : null,
        h("div", { class: "pn-actions" },
          h("button", { class: "primary", type: "button", onClick: () => this.onFly?.(p) }, "Fly there"),
          h("button", { type: "button", onClick: () => dispatchEvent(new CustomEvent("atlas:plan", { detail: p })) }, "Plan a day"),
          h("button", { type: "button", onClick: () => dispatchEvent(new CustomEvent("atlas:listen", { detail: p })) }, "Listen"))),
      p.access ? h("section", null, h("h3", null, "Getting there"), h("p", null, p.access)) : null,
      this.timeline(p), this.sources(p),
      p.photos?.length > 1 ? this.gallery(p) : null);
    this.el.hidden = false; document.body.classList.add("has-panel");
    requestAnimationFrame(() => { this.el.classList.add("open"); this.closeBtn.focus({ preventScroll: true }); });
    this.body.scrollTop = 0;
  }

  hero(p) {
    const ph = p.photos?.[0];
    if (!ph) return h("div", { class: "pn-hero none" });
    const u = safeUrl(ph.url);
    return h("figure", { class: "pn-hero" },
      h("img", { src: this.pack.base + ph.file, alt: `${p.name}. ${ph.attribution || ""}`, decoding: "async" }),
      h("figcaption", null, ph.attribution || "Photo credit unavailable", u ? [" ", h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, "source")] : null));
  }

  gallery(p) {
    return h("section", { class: "pn-photos" }, h("h3", null, "More photos"), p.photos.slice(1).map((ph) => {
      const u = safeUrl(ph.url);
      return h("figure", null, h("img", { src: this.pack.base + ph.file, alt: `${p.name}. ${ph.attribution || ""}`, loading: "lazy", decoding: "async" }),
        h("figcaption", null, ph.attribution || "Photo credit unavailable", u ? [" ", h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, "source")] : null));
    }));
  }

  timeline(p) {
    if (!p.timeline?.length) return null;
    return h("section", null, h("h3", null, "Timeline"),
      h("ol", { class: "pn-tl" }, p.timeline.map((t) => h("li", null, h("span", { class: "d" }, t.date), h("span", { class: "ev" }, t.event, " ", this.src(t.source))))));
  }

  sources(p) {
    if (!p.facts?.length) return null;
    return h("section", null, h("h3", null, "From the sources"),
      h("ul", { class: "pn-facts" }, p.facts.map((f) => h("li", null,
        h("p", null, f.text, " ", this.src(f.source)),
        f.quote ? h("details", null, h("summary", null, "What the source says"), h("blockquote", null, f.quote)) : null))));
  }

  src(url) {
    const u = safeUrl(url);
    return u ? h("a", { class: "src", href: u, target: "_blank", rel: "noopener noreferrer" }, host(u)) : null;
  }

  close() {
    if (!this.current) return;
    this.current = null;
    this.el.classList.remove("open"); document.body.classList.remove("has-panel");
    setTimeout(() => { if (!this.current) this.el.hidden = true; }, 260);
    this.opener?.focus?.({ preventScroll: true });
    this.onClose?.();
  }
}
