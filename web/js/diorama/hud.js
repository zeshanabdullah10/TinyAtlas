// Diorama page chrome: intro card, driving gauges and elevation profile, touch pedals, arrival card, labels, about.
import * as THREE from "three";

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => Number(n).toLocaleString("en", { maximumFractionDigits: d, minimumFractionDigits: d });

export class Hud {
  constructor() {
    this.ev = {};
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b) this.emit(b.dataset.act);
    });
    const sun = $("#sun");
    sun.addEventListener("input", () => { this.emit("sun", Number(sun.value)); $("#sun-out").textContent = clock(Number(sun.value)); });
    $("#sun-out").textContent = clock(Number(sun.value));
    $("#about-open").addEventListener("click", () => $("#about").showModal());
    $("#about-close").addEventListener("click", () => $("#about").close());
    this.v = new THREE.Vector3();
  }
  on(k, f) { this.ev[k] = f; }
  emit(k, a) { this.ev[k]?.(a); }
  loading(t) { const el = $("#loading"); el.hidden = !t; if (t) el.textContent = t; }

  facts(meta) {
    const F = meta.facts;
    $("#title").textContent = meta.title;
    $("#sub").textContent = meta.subtitle;
    $("#cta-km").textContent = fmt(F.drive_km, 1);
    $("#facts").innerHTML = [
      F.lake_level_m != null ? [fmt(F.lake_level_m), "m", "lake level"] : [fmt(F.arrival_m), "m", "at the end of the drive"],
      [fmt(F.drive_km, 1), "km", "of jeep track"],
      [fmt(F.drive_climb_m), "m", "climb on the way"],
      [`~${F.drive_minutes_at_9kmh}`, "min", "by jeep at 9 km/h"],
    ].map(([n, u, l]) => `<li><b>${n}<small>${u}</small></b><span>${l}</span></li>`).join("");
    $("#about-facts").innerHTML = [
      ...(F.lake_level_m != null ? [
        ["Lake surface", `${fmt(F.lake_level_m)} m above sea level (median of the DEM over the lake)`],
        ["Lake extent", `${fmt(F.lake_area_km2, 2)} km², ${fmt(F.lake_length_km, 2)} km end to end (${meta.lake?.outline || "mapped water"})`]]
        : [["Arrival", `${meta.arrival.name}, ${fmt(F.arrival_m)} m above sea level`]]),
      ["The drive", `${fmt(F.drive_km, 2)} km on the OSM track, from ${fmt(F.drive_start_m)} m to ${fmt(F.drive_end_m)} m, ${fmt(F.drive_climb_m)} m of climbing, steepest ~${F.drive_max_grade_pct}% over 60 m`],
      ["Model", `${F.box_km[0]} × ${F.box_km[1]} km at true scale, no height exaggeration`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    $("#about-sources").innerHTML = meta.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>: ${s.use}. <span>${s.licence}</span></li>`).join("");
    $("#about-edits").innerHTML = meta.edits.map((e) => `<li>${e}</li>`).join("");
    this.F = F;
  }

  profile(path) {
    const W = 260, H = 54, n = 120, ys = [];
    for (let i = 0; i <= n; i++) ys.push(path.at((path.length * i) / n).y);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    this.prof = { W, H, lo, hi, L: path.length };
    const pts = ys.map((y, i) => `${((i / n) * W).toFixed(1)},${(H - 4 - ((y - lo) / (hi - lo || 1)) * (H - 10)).toFixed(1)}`);
    $("#prof").setAttribute("viewBox", `0 0 ${W} ${H}`);
    $("#prof-line").setAttribute("points", pts.join(" "));
    $("#prof-fill").setAttribute("points", `0,${H} ${pts.join(" ")} ${W},${H}`);
  }

  update(ride, Y0, L) {
    if (!this.F) return;
    $("#g-speed").textContent = fmt(Math.abs(ride.v) * 3.6);
    $("#g-alt").textContent = fmt(ride.alt + Y0);
    $("#g-left").textContent = fmt(Math.max(L - ride.s, 0) / 1000, 2);
    $("#g-grade").textContent = `${ride.grade >= 0 ? "+" : ""}${fmt(ride.grade * 100)}`;
    const p = this.prof, x = (ride.s / p.L) * p.W, y = p.H - 4 - ((ride.alt - p.lo) / (p.hi - p.lo || 1)) * (p.H - 10);
    $("#prof-dot").setAttribute("cx", x.toFixed(1)); $("#prof-dot").setAttribute("cy", y.toFixed(1));
  }

  intro(show) { $("#intro").hidden = !show; document.body.classList.toggle("is-intro", show); }
  modeBtns(mode) { for (const m of ["foot", "horse", "boat"]) $(`#m-${m}`).setAttribute("aria-pressed", m === mode); $("#btn-auto").textContent = $("#btn-auto").getAttribute("aria-pressed") === "true" ? "Stop" : mode === "boat" ? "Row for me" : mode === "horse" ? "Ride for me" : "Walk for me"; }
  weather(text) { const el = $("#wx"); el.hidden = !text; el.innerHTML = text || ""; }
  photo(p, dist) {
    const el = $("#photo");
    if (!p) { el.hidden = true; this.shownPhoto = null; return; }
    el.hidden = false;
    if (this.shownPhoto !== p) {
      this.shownPhoto = p;
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      $("#photo-img").src = p.thumb; $("#photo-img").alt = p.caption; $("#photo-link").href = p.page;
      $("#photo-cap").textContent = p.caption;
      $("#photo-credit").innerHTML = `Photo ${esc(p.author)}, ${esc(p.date.slice(0, 4))}, <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.licence)}</a> · Wikimedia Commons · <span id="photo-d"></span>`;
    }
    const d = document.getElementById("photo-d"); if (d) d.textContent = `taken about ${Math.round(dist / 10) * 10} m from here`;
  }
  bindHold(sel, on, off) {
    const el = $(sel);
    const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add("on"); on(); };
    const up = () => { el.classList.remove("on"); off(); };
    el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
  }
  walking(on) { document.body.classList.toggle("is-walking", on); $("#walkbar").hidden = !on; }
  vp(name) { $("#vp-name").textContent = name; }
  auto(on, mode = "foot") { $("#btn-auto").setAttribute("aria-pressed", on); this.modeBtns(mode); }
  season(name, note) { $("#season-name").textContent = name; $("#season-note").hidden = !note; $("#season-note").textContent = note || ""; }
  practical(items) {
    if (!items?.length) return;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
    const row = (it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.value)} <a href="${esc(it.url)}" target="_blank" rel="noopener" title="${esc(it.quote || "")}">${esc(it.source)}</a></dd>`;
    $("#before-list").innerHTML = items.map(row).join("");
    $("#before").hidden = false;
    $("#about-practical").innerHTML = `<dl>${items.map(row).join("")}</dl>`;
  }
  driving(on) { document.body.classList.toggle("is-driving", on); $("#hud").hidden = !on; }
  camName(n) { $("#cam-name").textContent = n; }
  pace(n) { $("#pace-x").textContent = `${n}×`; $("#btn-pace").setAttribute("aria-pressed", n > 1); }
  cruise(on) { $("#btn-cruise").setAttribute("aria-pressed", on); }
  sound(on) { $("#btn-sound").setAttribute("aria-pressed", on); }
  flash() { const f = $("#flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }

  arrive(F, { arrived = true } = {}) {
    $("#arrive").hidden = !F;
    if (!F) return;
    $("#arrive-eyebrow").textContent = arrived ? "You have arrived" : "Tiny Atlas · Diorama";
    $("#btn-again").textContent = arrived ? "Drive it again" : "Drive up the track";
    $("#arrive-facts").innerHTML = `You climbed <b>${fmt(F.drive_climb_m)} m</b> over <b>${fmt(F.drive_km, 1)} km</b> of jeep track. ` + (F.lake_level_m != null
      ? `The lake lies at <b>${fmt(F.lake_level_m)} m</b>, about <b>${fmt(F.lake_length_km, 1)} km</b> end to end.`
      : `You are at <b>${fmt(F.arrival_m)} m</b>.`);
  }

  bindPedals(input) {
    const hold = (sel, on, off) => {
      const el = $(sel);
      const down = (e) => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add("on"); on(); };
      const up = () => { el.classList.remove("on"); off(); };
      el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
    };
    hold("#p-gas", () => (input.throttle = 1), () => (input.throttle = 0));
    hold("#p-brake", () => (input.brake = 1), () => (input.brake = 0));
    hold("#p-left", () => (input.steer = -1), () => (input.steer = 0));
    hold("#p-right", () => (input.steer = 1), () => (input.steer = 0));
  }

  makeLabels(list) {
    const layer = $("#labels");
    this.labels = list.map((l) => {
      const el = document.createElement("div");
      el.className = `lbl lbl-${l.cls}`; el.textContent = l.text;
      layer.append(el);
      return { ...l, el };
    });
  }
  addLabels(list) {
    const layer = $("#labels");
    for (const l of list) {
      const el = document.createElement("div");
      el.className = `lbl lbl-${l.cls}`; el.textContent = l.text;
      layer.append(el);
      this.labels.push({ ...l, el });
    }
  }
  placeLabels(camera, w, h, state) {
    const base = state === "table" || state === "explore" || state === "back";
    for (const l of this.labels) {
      const p = typeof l.p === "function" ? l.p() : l.p;
      const v = this.v.copy(p).project(camera);
      const mode = l.modes ? l.modes.includes(state) : base && (l.table ? document.body.dataset.env === "table" : true);
      const far = state === "walk" && camera.position.distanceTo(p) > (l.range || 650);
      const ok = mode && !far && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.opacity = ok ? 1 : 0;
      if (ok) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }
}

function clock(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${hh}:${String(mm).padStart(2, "0")}`; }
