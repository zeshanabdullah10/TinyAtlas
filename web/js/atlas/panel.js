// Place side sheet (440 px on the right, bottom sheet on mobile): photo with credit, kind, name (+Urdu), stats, story, sources.
import { h, fill, KIND_LABEL } from "../dom.js";
import { heritageSection } from "./heritage.js";
import { voicesSection } from "../voices.js";
import { roadStatusCard, loadRoads } from "../roadstatus.js";
import { tr, ltr } from "../i18n.js";
const areaName = (a) => (a ? tr(`area.${a}`, AREAS[a] || a) : "—");
let ROADS = []; loadRoads().then((r) => { ROADS = r; });
// The packs name areas by slug; the panel shows their names (the trip kit page uses the same table).
const AREAS = { "swat-mid": "Mid Swat", "swat-lower": "Lower Swat", gateway: "Swat gateway", "malam-jabba": "Malam Jabba", kalam: "Kalam",
  kumrat: "Kumrat", "utror-gabral": "Utror and Gabral", "ushu-mahodand": "Ushu and Mahodand" };

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
    this.closeBtn = h("button", { class: "pn-close", type: "button", "aria-label": tr("panel.close", "Close"), onClick: () => this.close() }, "×");
    this.grab = h("button", { class: "pn-grab", type: "button", "aria-label": tr("panel.more", "More details"), onClick: () => this.togglePeek() }, h("i"));
    this.el = h("aside", { class: "panel", role: "dialog", "aria-modal": "false", "aria-label": tr("panel.label", "Place details"), tabindex: "-1", hidden: true }, this.grab, this.closeBtn, this.body);
    root.append(this.el);
    addEventListener("keydown", (e) => { if (e.key === "Escape" && this.current) this.close(); }, { signal });
    addEventListener("pointerdown", (e) => {
      if (!this.current || this.el.contains(e.target)) return;
      if (e.target.closest?.(".chip, .search, .dock, .light, .pn-viewer")) return;       // those switch place or camera instead
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
    this.grab.setAttribute("aria-label", peek ? tr("panel.more", "More details") : tr("panel.collapse", "Collapse details"));
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
    const kind = tr(`kind.${p.kind}`, KIND_LABEL[p.kind] || (p.kind ? p.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : tr("panel.place", "Place")));
    const stats = [[tr("panel.elevation", "Elevation"), e != null ? ltr(`${Math.round(e).toLocaleString("en")} m`) : "—"], [tr("panel.area", "Area"), areaName(p.area)], [tr("panel.confidence", "Confidence"), p.confidence || "—"]];
    const hero = this.hero(p);
    this.el.classList.toggle("no-hero", !hero);                              // no photo: the sheet starts at the kind line, no empty band
    const hasStory = !!(p.facts?.length || p.timeline?.length || this.heritage?.[p.slug]);
    fill(this.body,
      hero,
      h("div", { class: "pn-head" },
        h("p", { class: "pn-kind" }, kind),
        h("div", { class: "pn-title" }, h("h2", { class: "pn-name" }, p.name), p.name_ur ? h("span", { class: "pn-ur", lang: "ur", dir: "rtl" }, p.name_ur) : null),
        h("dl", { class: "pn-stats" }, stats.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v)))),
        p.summary ? h("p", { class: "pn-sum", dir: "auto" }, p.summary) : null,
        h("div", { class: "pn-actions" },
          DIORAMA[p.slug]
            ? h("button", { class: "primary", type: "button", onClick: () => location.assign(`diorama.html?site=${DIORAMA[p.slug]}&drive=1`) }, tr("panel.drive", "Drive there"))
            : h("button", { class: "primary", type: "button", onClick: () => this.onFly?.(p) }, tr("panel.fly", "Fly there")),
          h("button", { type: "button", onClick: () => { dispatchEvent(new CustomEvent("atlas:plan", { detail: p })); this.onPlan?.(p); } }, tr("panel.plan", "Plan a day")),
          this.listenBtn = h("button", { type: "button", class: "listen-btn", onClick: () => this.toggleListen(p) }, tr("panel.listen", "Listen")),
          DIORAMA[p.slug] ? h("button", { type: "button", onClick: () => location.assign(`diorama.html?site=${DIORAMA[p.slug]}&view=lake`) }, p.kind === "lake" ? tr("panel.see_lake", "See the lake") : tr("panel.up_close", "See it up close")) : null),
        this.listenSlot = h("div", { class: "pn-listen" })),
      p.access ? h("section", null, h("h3", null, tr("panel.getting", "Getting there")), h("p", { dir: "auto" }, p.access)) : null,
      ROADS.some((r) => r.segment_slugs?.includes(p.slug)) ? roadStatusCard(ROADS, { slug: p.slug }) : null,
      this.timeline(p), heritageSection(this.heritage?.[p.slug]), this.voices ? voicesSection(this.voices, { slug: p.slug }) : null, this.sources(p),
      hasStory ? null : h("section", { class: "pn-empty" }, h("h3", null, tr("panel.from_sources", "From the sources")), h("p", null, tr("panel.no_story", "No sourced facts or dated events are recorded for this place yet. Nothing here is filled in from memory."))));
    this.paintAudio();
    this.el.hidden = false; document.body.classList.add("has-panel");
    this.el.classList.toggle("peek", matchMedia("(max-width: 700px)").matches);   // phones open on the peek card
    this.grab.setAttribute("aria-label", this.el.classList.contains("peek") ? tr("panel.more", "More details") : tr("panel.collapse", "Collapse details"));
    requestAnimationFrame(() => { this.el.classList.add("open"); this.closeBtn.focus({ preventScroll: true }); setTimeout(() => this.onState?.(), 340); });
    this.body.scrollTop = 0;
    this.onState?.();
  }

  /** Listen: plays the place's clip through the shared player; with no clip yet the button says so and does nothing. */
  paintAudio() {
    const p = this.current, ok = !!(p && this.audio?.has(p));
    if (!this.listenBtn) return;
    this.listenBtn.disabled = !ok;
    this.listenBtn.textContent = ok ? tr("panel.listen", "Listen") : tr("panel.audio_soon", "Audio guide coming soon");
    this.listenBtn.title = ok ? "" : tr("panel.audio_soon_title", "The audio guide for this place hasn't been recorded yet");
    if (!ok) this.listenSlot.replaceChildren();
  }

  toggleListen(p) {
    if (!this.audio?.has(p)) return;
    if (this.listenSlot.firstChild) { this.listenSlot.replaceChildren(); return; }
    this.listenSlot.replaceChildren(this.audio.row(p));
  }

  /** Photo area: a swipeable carousel (arrows, dots, keyboard) when there are several photos, one photo otherwise, nothing when none. */
  hero(p) {
    const photos = (p.photos || []).filter((ph) => ph?.file);
    if (!photos.length) return null;
    const n = photos.length, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idx = 0;
    const credit = h("span", { class: "pn-credit", dir: "auto" }), cap = h("p", { class: "pn-cap", dir: "auto" });
    const slides = photos.map((ph, i) => {
      const img = h("img", { src: this.pack.base + ph.file, alt: ph.caption ? `${p.name}: ${ph.caption}` : `${p.name}. ${ph.attribution || ""}`, decoding: "async", loading: i ? "lazy" : "eager", draggable: "false" });
      const sl = h("button", { class: "pn-slide loading", type: "button", "aria-label": tr("panel.enlarge", "Enlarge photo {i} of {n}", { i: i + 1, n }), onClick: () => this.viewer(p, photos, i) }, img);
      img.addEventListener("load", () => sl.classList.remove("loading"));
      img.addEventListener("error", () => { sl.classList.remove("loading"); sl.classList.add("broken"); if (n === 1) { fig.hidden = true; this.el.classList.add("no-hero"); } });
      if (img.complete && img.naturalWidth) sl.classList.remove("loading");
      return sl;
    });
    const track = h("div", { class: "pn-track", dir: "ltr", tabindex: n > 1 ? "0" : null, role: "group", "aria-roledescription": n > 1 ? "carousel" : null, "aria-label": tr("panel.photos_of", "Photos of {name}", { name: p.name }) }, slides);
    const dots = n > 1 ? h("div", { class: "pn-dots" }, photos.map((_, i) => h("button", { type: "button", "aria-label": tr("panel.photo_n", "Photo {i} of {n}", { i: i + 1, n }), onClick: () => go(i) }, h("i")))) : null;
    const go = (i) => { i = (i + n) % n; track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? "auto" : "smooth" }); paint(i); };
    const paint = (i) => {
      idx = i; const ph = photos[i], u = safeUrl(ph.url);
      credit.replaceChildren(ph.attribution || tr("panel.no_credit", "Photo credit unavailable"), ...(u ? [" ", h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, tr("panel.source_link", "source"))] : []));
      cap.textContent = ph.caption || ""; cap.hidden = !ph.caption;
      dots?.querySelectorAll("button").forEach((b, j) => { j === i ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"); });
      count?.replaceChildren(`${i + 1} / ${n}`);
    };
    const count = n > 1 ? h("span", { class: "pn-count", "aria-hidden": "true" }) : null;
    let raf = 0;
    if (n > 1) {
      track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); if (i !== idx && i >= 0 && i < n) paint(i); }); }, { passive: true });
      track.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); } });
    }
    const arrow = (d, lab, path) => h("button", { class: `pn-nav ${d < 0 ? "prev" : "next"}`, type: "button", "aria-label": lab, onClick: () => go(idx + d) },
      (() => { const sv = document.createElementNS("http://www.w3.org/2000/svg", "svg"); sv.setAttribute("viewBox", "0 0 24 24"); sv.setAttribute("aria-hidden", "true"); sv.innerHTML = `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`; return sv; })());
    const fig = h("figure", { class: `pn-hero${n > 1 ? " multi" : ""}` },
      h("div", { class: "pn-stage" }, track, n > 1 ? [arrow(-1, tr("panel.prev", "Previous photo"), "M15 5l-7 7 7 7"), arrow(1, tr("panel.next", "Next photo"), "M9 5l7 7-7 7"), count, dots] : null),
      h("figcaption", null, cap, credit));
    paint(0);
    return fig;
  }

  /** Full-screen photo viewer: the picture whole, its caption and credit, arrows/keys to move, Esc to close. */
  viewer(p, photos, start) {
    const prevFocus = document.activeElement, n = photos.length;
    let i = start;
    const img = h("img", { alt: "" }), cap = h("p", { class: "pv-cap", dir: "auto" }), cr = h("p", { class: "pv-credit", dir: "auto" }), ct = h("span", { class: "pv-count" });
    const paint = () => {
      const ph = photos[i], u = safeUrl(ph.url);
      img.src = this.pack.base + ph.file; img.alt = ph.caption ? `${p.name}: ${ph.caption}` : `${p.name}. ${ph.attribution || ""}`;
      cap.textContent = ph.caption || ""; cap.hidden = !ph.caption;
      cr.replaceChildren(ph.attribution || tr("panel.no_credit", "Photo credit unavailable"), ...(u ? [" ", h("a", { href: u, target: "_blank", rel: "noopener noreferrer" }, tr("panel.source_link", "source"))] : []));
      ct.textContent = n > 1 ? `${i + 1} / ${n}` : "";
    };
    const shut = () => { removeEventListener("keydown", onKey, true); v.remove(); prevFocus?.focus?.({ preventScroll: true }); };
    const step = (d) => { i = (i + d + n) % n; paint(); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); shut(); }
      else if (n > 1 && e.key === "ArrowRight") step(1); else if (n > 1 && e.key === "ArrowLeft") step(-1);
      else if (e.key === "Tab") { const f = [...v.querySelectorAll("button, a[href]")].filter((x) => !x.hidden); if (!f.length) return; const k = f.indexOf(document.activeElement);
        if (e.shiftKey && k <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    const close = h("button", { class: "pv-close", type: "button", "aria-label": tr("panel.viewer_close", "Close photo viewer"), onClick: shut }, "×");
    const nav = (d, lab, t) => n > 1 ? h("button", { class: `pv-nav ${d < 0 ? "prev" : "next"}`, type: "button", "aria-label": lab, onClick: () => step(d) }, t) : null;
    const v = h("div", { class: "pn-viewer", role: "dialog", "aria-modal": "true", "aria-label": tr("panel.photos_of", "Photos of {name}", { name: p.name }), onClick: (e) => { if (e.target === v || e.target.classList.contains("pv-stage")) shut(); } },
      close, h("div", { class: "pv-stage", dir: "ltr" }, nav(-1, tr("panel.prev", "Previous photo"), "‹"), img, nav(1, tr("panel.next", "Next photo"), "›")), h("div", { class: "pv-meta" }, cap, cr, ct));
    paint(); document.body.append(v); addEventListener("keydown", onKey, true); close.focus({ preventScroll: true });
  }

  timeline(p) {
    if (!p.timeline?.length) return null;
    return h("section", null, h("h3", null, tr("panel.timeline", "Timeline")),
      h("ol", { class: "pn-tl" }, p.timeline.map((t) => h("li", null, h("span", { class: "d" }, t.date), h("span", { class: "ev", dir: "auto" }, t.event, this.src(t.source))))));
  }

  /** Facts: one scannable row each. Superscript marks follow the sentence: the source link, and a quote toggle that opens what the source says. */
  sources(p) {
    if (!p.facts?.length) return null;
    return h("section", null, h("h3", null, tr("panel.from_sources", "From the sources")),
      h("ol", { class: "pn-facts" }, p.facts.map((f) => {
        const q = f.quote ? h("blockquote", { class: "fq-body", hidden: true }, h("p", { dir: "auto" }, f.quote), safeUrl(f.source) ? h("cite", null, tr("panel.source_cite", "Source: "), h("a", { href: f.source, target: "_blank", rel: "noopener noreferrer" }, host(f.source))) : null) : null;
        const tg = q && h("button", { class: "fq", type: "button", "aria-expanded": "false", "aria-label": tr("panel.quote_label", "What the source says"), title: f.quote.length > 160 ? `“${f.quote.slice(0, 157)}…”` : `“${f.quote}”`,
          onClick: () => { const on = q.hidden; q.hidden = !on; tg.setAttribute("aria-expanded", String(on)); } }, tr("panel.quote", "Quote"));
        return h("li", null, h("p", { dir: "auto" }, f.text, this.src(f.source), tg), q);
      })));
  }

  /** Superscript source mark: a link to the page, host in its label and tooltip. */
  src(url) {
    const u = safeUrl(url);
    return u ? h("sup", { class: "sref" }, h("a", { class: "src", href: u, target: "_blank", rel: "noopener noreferrer", "aria-label": tr("panel.source_aria", "Source: {host}", { host: host(u) }), title: host(u) }, "↗")) : null;
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
