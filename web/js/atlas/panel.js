// Place side sheet (440 px on the right, bottom sheet on mobile): photo with credit, kind, name (+Urdu), stats, story, sources.
import { h, fill, KIND_LABEL } from "../dom.js";
import { heritageSection } from "./heritage.js";
import { voicesSection } from "../voices.js";
import { roadStatusCard, loadRoads } from "../roadstatus.js";
let ROADS = []; loadRoads().then((r) => { ROADS = r; });

const DIORAMA = { "mahodand-lake": "mahodand", "white-palace-marghazar": "white-palace",   // place slug → web/data/diorama/<site>/
  kalam: "kalam", ushu: "ushu", utror: "utror", gabral: "gabral", matiltan: "matiltan",
  "kundol-lake": "kundol-lake", "spin-khwar-lake": "spin-khwar-lake", "jabba-zomalu-lake": "jabba-zomalu-lake", bahrain: "bahrain",
  madyan: "madyan", miandam: "miandam", "izmis-lake": "izmis-lake", "mushroom-lake": "mushroom-lake", "daral-lake": "daral-lake",
  "pari-lake": "pari-lake", "shahi-bagh": "shahi-bagh", "desan-meadows": "desan-meadows",
  "butkara-i-stupa": "butkara-i-stupa", "saidu-sharif-stupa": "saidu-sharif-stupa", "swat-museum": "swat-museum",
  "amluk-dara-stupa": "amluk-dara-stupa", "shingardar-stupa": "shingardar-stupa",
  "gumbat-balo-kale-stupa": "gumbat-balo-kale-stupa", "butkara-iii-stupa": "butkara-iii-stupa",
  "ghalegay-buddha-rock": "ghalegay-buddha-rock", "jahanabad-buddha": "jahanabad-buddha",
  "gogdara-rock-carvings": "gogdara-rock-carvings", "mahmud-ghaznavi-mosque": "mahmud-ghaznavi-mosque",
  "raja-gira-castle": "raja-gira-castle", "bazira-barikot-ghundai": "bazira-barikot-ghundai",
  "bashigram-lake": "bashigram-lake", "malam-jabba": "malam-jabba", "jamia-masjid-thal": "jamia-masjid-thal",
  "kumrat-waterfall": "kumrat-waterfall", "mighty-22-falls": "mighty-22-falls", "gabin-jabba": "gabin-jabba",
  "kharkhari-lake": "kharkhari-lake" };

const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; } };

export class Panel {
  constructor(root, pack, { onClose, onFly, onPlan, audio, signal, onState } = {}) {
    this.pack = pack; this.onClose = onClose; this.onFly = onFly; this.onPlan = onPlan; this.audio = audio; this.onState = onState; this.current = null; this.opener = null;
    this.body = h("div", { class: "pn-body" });
    this.closeBtn = h("button", { class: "pn-close", type: "button", "aria-label": "Close", onClick: () => this.close() }, "×");
    this.grab = h("button", { class: "pn-grab", type: "button", "aria-label": "More details", onClick: () => this.togglePeek() }, h("i"));
    this.el = h("aside", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": "Place details", tabindex: "-1", hidden: true }, this.grab, this.closeBtn, this.body);
    root.append(this.el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && this.current) this.close(); }, { signal });
    addEventListener("pointerdown", (e) => {
      if (!this.current || this.el.contains(e.target)) return;
      if (e.target.closest?.(".chip, .search, .dock, .light")) return;       // those switch place or camera instead
      this.close();
    }, { capture: true, signal });
    // Touch: drag the sheet's top zone (grab handle / photo / title). Down from full collapses to the peek card,
    // down from the peek closes it, up from the peek expands to the full sheet.
    let y0 = null, dy = 0, dragged = false;
    this.el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || !this.current) return;
      if (e.clientY - this.el.getBoundingClientRect().top > 200) return;     // only the top zone drags; the body scrolls
      y0 = e.clientY; dy = 0; dragged = false;
      this.el.style.transition = "none";
    });
    this.el.addEventListener("pointermove", (e) => {
      if (y0 == null) return;
      dy = e.clientY - y0;
      if (Math.abs(dy) > 8) dragged = true;
      this.el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
    });
    const dragEnd = () => {
      if (y0 == null) return;
      this.el.style.transition = ""; this.el.style.transform = "";
      if (dy > 90) { this.el.classList.contains("peek") ? this.close() : this.togglePeek(); }
      else if (dy < -50 && this.el.classList.contains("peek")) this.togglePeek();
      this.suppressClick = dragged;                                            // a drag must not become a tap on a link
      y0 = null; dy = 0;
    };
    this.el.addEventListener("pointerup", dragEnd);
    this.el.addEventListener("pointercancel", dragEnd);
    this.el.addEventListener("click", (e) => { if (this.suppressClick) { e.stopPropagation(); e.preventDefault(); this.suppressClick = false; } }, { capture: true });
  }

  /** Phone two-state sheet: peek (the card with kind/name/actions) <-> full details. No-op on desktop CSS. */
  togglePeek() {
    const peek = this.el.classList.toggle("peek");
    this.grab.setAttribute("aria-label", peek ? "More details" : "Collapse details");
    this.onState?.(); setTimeout(() => this.onState?.(), 340);                // label blockers track the animated box
  }
  collapse() { if (this.el.classList.contains("peek")) return; this.togglePeek(); }

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
          DIORAMA[p.slug]
            ? h("button", { class: "primary", type: "button", onClick: () => location.assign(`diorama.html?site=${DIORAMA[p.slug]}&drive=1`) }, "Drive there")
            : h("button", { class: "primary", type: "button", onClick: () => this.onFly?.(p) }, "Fly there"),
          h("button", { type: "button", onClick: () => { dispatchEvent(new CustomEvent("atlas:plan", { detail: p })); this.onPlan?.(p); } }, "Plan a day"),
          this.listenBtn = h("button", { type: "button", class: "listen-btn", onClick: () => this.toggleListen(p) }, "Listen"),
          DIORAMA[p.slug] ? h("button", { type: "button", onClick: () => location.assign(`diorama.html?site=${DIORAMA[p.slug]}&view=lake`) }, p.kind === "lake" ? "See the lake" : "See it up close") : null),
        this.listenSlot = h("div", { class: "pn-listen" })),
      p.access ? h("section", null, h("h3", null, "Getting there"), h("p", null, p.access)) : null,
      ROADS.some((r) => r.segment_slugs?.includes(p.slug)) ? roadStatusCard(ROADS, { slug: p.slug }) : null,
      this.timeline(p), heritageSection(this.heritage?.[p.slug]), this.voices ? voicesSection(this.voices, { slug: p.slug }) : null, this.sources(p),
      p.photos?.length > 1 ? this.gallery(p) : null);
    this.paintAudio();
    this.el.hidden = false; document.body.classList.add("has-panel");
    this.el.classList.toggle("peek", matchMedia("(max-width: 700px)").matches);   // phones open on the peek card
    this.grab.setAttribute("aria-label", this.el.classList.contains("peek") ? "More details" : "Collapse details");
    requestAnimationFrame(() => { this.el.classList.add("open"); this.closeBtn.focus({ preventScroll: true }); setTimeout(() => this.onState?.(), 340); });
    this.body.scrollTop = 0;
    this.onState?.();
  }

  /** Listen: plays the place's clip through the shared player; with no clip yet the button says so and does nothing. */
  paintAudio() {
    const p = this.current, ok = !!(p && this.audio?.has(p));
    if (!this.listenBtn) return;
    this.listenBtn.disabled = !ok;
    this.listenBtn.textContent = ok ? "Listen" : "Audio guide coming soon";
    this.listenBtn.title = ok ? "" : "The audio guide for this place hasn't been recorded yet";
    if (!ok) this.listenSlot.replaceChildren();
  }

  toggleListen(p) {
    if (!this.audio?.has(p)) return;
    if (this.listenSlot.firstChild) { this.listenSlot.replaceChildren(); return; }
    this.listenSlot.replaceChildren(this.audio.row(p));
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
    this.el.style.transform = ""; this.el.style.transition = "";
    this.el.classList.remove("open"); document.body.classList.remove("has-panel");
    setTimeout(() => { if (!this.current) this.el.hidden = true; }, 260);
    this.opener?.focus?.({ preventScroll: true });
    this.onClose?.();
  }
}
