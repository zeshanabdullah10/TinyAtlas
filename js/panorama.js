import { h, icon, toast, fmtKm, fmtM } from "./dom.js";
import { panorama, parseHorizon, toRC } from "./viewshed.js";
import { sunPosition, riseSet } from "./sun.js";

// "What can I see from here?": a 360 degree drawing of the skyline from a point, ridges layered by distance, every
// visible named summit labelled, and the day's sun path on top. It can also be laid over the visitor's own photo.

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const INK = [[62, 76, 70], [88, 102, 96], [116, 129, 123], [146, 157, 151], [174, 183, 178], [198, 205, 200]];   // near -> far
let grids = null;                                   // {slug, g, near, peaks}: loaded once per place

async function loadGrids(api, slug) {
  if (grids?.slug === slug) return grids;
  const [[wide, near], peaks] = await Promise.all([api.horizon(slug), api.peaks(slug)]);
  const g = parseHorizon(wide), n = parseHorizon(near);
  grids = { slug, g, near: n, peaks: peaks.map((p) => { const [row, col] = toRC(p.lat, p.lon, g); return { ...p, row, col }; }) };
  return grids;
}

/**
 * Open the panorama from {lat, lon} with a title ("View from Karimabad").
 * sun: {date: Date (any instant on the day), now: Date|null} to draw the day's sun path, or null.
 */
export async function openPanorama({ api, slug, lat, lon, title, sun = null, heading = null }) {
  const busy = h("div", { class: "pano-back" }, h("div", { class: "label loading", role: "status" }, h("h2", {}, "Working out the view"), h("div", { class: "bar" }, h("i"))));
  document.body.append(busy);
  let data;
  try {
    const G = await loadGrids(api, slug);
    await new Promise((r) => setTimeout(r, 30));                                  // let the loading card paint
    data = panorama(G.g, toRC(lat, lon, G.g), { peaks: G.peaks, near: G.near });
  } catch (e) {
    busy.remove(); toast("The view can't be worked out right now."); return;
  }
  busy.remove();

  // ---------- state ----------
  const st = { az: heading ?? (data.peaks.length ? [...data.peaks].sort((a, b) => b.alt - a.alt)[0].az : 180), fov: 90, photo: null, photoAlpha: 0.85 };
  const nAz = data.bands[0].length, step = data.azStep;
  const sunPath = [];
  if (sun) {
    const [rise, set] = riseSet(sun.date, lat, lon);
    if (rise) for (let t = rise.getTime() - 20 * 60000; t <= set.getTime() + 20 * 60000; t += 5 * 60000) {
      const [az, alt] = sunPosition(new Date(t), lat, lon); sunPath.push({ az, alt, t });
    }
  }
  const sunNow = sun?.now ? (([az, alt]) => ({ az, alt }))(sunPosition(sun.now, lat, lon)) : null;

  // ---------- DOM ----------
  const canvas = h("canvas", { class: "pano-canvas", role: "img", "aria-label": `Skyline from ${title}` });
  const list = h("ul", { class: "pano-peaks", "aria-label": "Summits in view" });
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const photoCtl = h("div", { class: "pano-photo hidden" },
    h("label", {}, "Photo", h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(st.photoAlpha), oninput: (e) => { st.photoAlpha = +e.target.value; draw(); } })),
    h("label", {}, "Zoom", h("input", { type: "range", min: "20", max: "120", step: "1", value: String(st.fov), "aria-label": "Field of view", oninput: (e) => { st.fov = +e.target.value; draw(); } })),
    h("span", { class: "hint-s" }, "Drag until the ridgelines sit on your photo."));
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "ArrowLeft") { st.az -= 5; draw(); }
    if (e.key === "ArrowRight") { st.az += 5; draw(); }
  };
  const back = h("div", { class: "pano-back", role: "dialog", "aria-modal": "true", "aria-label": `View from ${title}` },
    h("div", { class: "pano" },
      h("header", { class: "pano-head" },
        h("div", {}, h("h2", {}, `View from ${title}`), h("p", { class: "sub" }, `Standing at ${fmtM(data.elev)}. ${data.peaks.length ? `${data.peaks.length} named summit${data.peaks.length > 1 ? "s" : ""} in view.` : "No named summits in view from here."}`)),
        h("div", { class: "pano-tools" },
          h("button", { class: "btn", type: "button", onclick: () => fileIn.click() }, icon("i-camera"), "Match my photo"),
          h("button", { class: "btn", type: "button", onclick: save }, icon("i-share"), "Save picture"),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, icon("i-close")))),
      h("div", { class: "pano-stage" }, canvas, h("button", { class: "icon-btn pano-l", type: "button", "aria-label": "Turn left", onclick: () => { st.az -= 30; draw(); } }, icon("i-back")),
        h("button", { class: "icon-btn pano-r", type: "button", "aria-label": "Turn right", onclick: () => { st.az += 30; draw(); } }, icon("i-back"))),
      photoCtl, list,
      h("p", { class: "pano-note" }, "Drawn from open elevation data and OpenStreetMap summit names, with earth curvature and refraction. Nearby buildings and trees are not in the data."),
      fileIn));
  document.body.append(back);
  document.addEventListener("keydown", onKey, true);

  data.peaks.forEach((p) => list.append(h("li", {}, h("button", { class: "chip", type: "button", onclick: () => { st.az = p.az; draw(); } },
    h("b", {}, p.name), ` ${fmtM(p.ele)} · ${fmtKm(p.dist)} · ${COMPASS[Math.round(p.az / 45) % 8]}`))));

  // ---------- drawing ----------
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, pxPerDeg = 1, horizonY = 0;
  function layout() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // angles stay true (the same scale across and up), so a deep valley widens the view rather than stretching it
    const maxAlt = Math.min(50, Math.max(8, ...data.peaks.map((p) => p.alt + 2), ...data.bands.at(-1)));
    pxPerDeg = Math.min(W / st.fov, (H - LABEL_ROOM - 30) / (maxAlt + 3));
    horizonY = H - 30 - 3 * pxPerDeg;
  }
  const LABEL_ROOM = 130;
  const xOf = (az) => { let d = ((az - st.az + 540) % 360) - 180; return W / 2 + d * pxPerDeg; };
  const yOf = (alt) => horizonY - alt * pxPerDeg;

  function draw() {
    st.az = ((st.az % 360) + 360) % 360;
    layout();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, "#e9ece6"); sky.addColorStop(1, "#fbfaf6");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    if (st.photo) {                                                                  // the visitor's photo, centred on the view
      const ph = st.photo, s = W / ph.width;
      ctx.globalAlpha = st.photoAlpha; ctx.drawImage(ph, 0, horizonY - ph.height * s * 0.62, W, ph.height * s); ctx.globalAlpha = 1;
    }
    // ridges: far layers first, each a filled silhouette
    const cols = Math.ceil(W) + 2;
    for (let b = data.bands.length - 1; b >= 0; b--) {
      const band = data.bands[b], [r, g, bl] = INK[b];
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= cols; x++) {                                            // linear between ray samples
        const az = st.az + (x - W / 2) / pxPerDeg, f = (((az % 360) + 360) % 360) / step;
        const i = Math.floor(f) % nAz, j = (i + 1) % nAz, t = f - Math.floor(f);
        ctx.lineTo(x, yOf(Math.max(band[i] * (1 - t) + band[j] * t, -3)));
      }
      ctx.lineTo(cols, H); ctx.closePath();
      if (st.photo) {
        ctx.fillStyle = `rgba(${r},${g},${bl},.18)`; ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.9 - b * 0.1})`; ctx.lineWidth = 1.2; ctx.stroke();
      } else {                                                                     // aerial perspective: lit crest, deeper base
        const grad = ctx.createLinearGradient(0, horizonY - 30 * pxPerDeg, 0, H);
        grad.addColorStop(0, `rgb(${r + 22},${g + 22},${bl + 20})`); grad.addColorStop(1, `rgb(${r * 0.8},${g * 0.8},${bl * 0.8})`);
        ctx.fillStyle = grad; ctx.fill();
        ctx.strokeStyle = `rgba(251,250,246,${0.5 - b * 0.06})`; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // compass ticks along the bottom
    ctx.fillStyle = st.photo ? "#fff" : "#fbfaf6"; ctx.font = "600 12px Schibsted Grotesk, system-ui"; ctx.textAlign = "center";
    for (let k = 0; k < 360; k += 15) {
      const x = xOf(k); if (x < -20 || x > W + 20) continue;
      ctx.fillRect(x - 0.5, H - (k % 45 ? 8 : 14), 1, k % 45 ? 8 : 14);
      if (k % 45 === 0) ctx.fillText(COMPASS[k / 45], x, H - 20);
    }
    // the sun's path for the day, and where it is now
    if (sunPath.length) {
      ctx.strokeStyle = "rgba(194,149,58,.85)"; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5; ctx.beginPath();
      let prevX = null;
      for (const p of sunPath) { const x = xOf(p.az), y = yOf(p.alt); if (prevX == null || Math.abs(x - prevX) > W / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y); prevX = x; }
      ctx.stroke(); ctx.setLineDash([]);
      if (sunNow) { ctx.fillStyle = "#e0a43a"; ctx.beginPath(); ctx.arc(xOf(sunNow.az), yOf(sunNow.alt), 9, 0, Math.PI * 2); ctx.fill(); }
    }
    // summit labels: leader lines up to staggered rows so neighbours never collide
    const rows = [];
    ctx.font = "500 13px Schibsted Grotesk, system-ui"; ctx.textAlign = "left";
    for (const p of [...data.peaks].sort((a, b) => b.alt - a.alt)) {
      const x = xOf(p.az); if (x < 0 || x > W) continue;
      const text = p.name, sub = `${fmtM(p.ele)} · ${fmtKm(p.dist)}`;
      const w = Math.max(ctx.measureText(text).width, ctx.measureText(sub).width) + 14;
      let row = 0; while ((rows[row] || []).some(([a, b]) => x - 2 < b && x + w + 2 > a)) row++;
      (rows[row] = rows[row] || []).push([x, x + w]);
      const ly = 16 + row * 40, sy = yOf(p.alt);
      if (ly + 34 > sy - 6) continue;
      ctx.strokeStyle = st.photo ? "rgba(255,255,255,.9)" : "rgba(44,55,51,.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, ly + 34); ctx.lineTo(x + 0.5, sy - 3); ctx.stroke();
      ctx.fillStyle = "rgba(251,250,246,.94)"; ctx.fillRect(x, ly, w, 34);
      ctx.fillStyle = "#2c3733"; ctx.fillText(text, x + 7, ly + 15);
      ctx.fillStyle = "#56625d"; ctx.font = "400 11.5px Schibsted Grotesk, system-ui"; ctx.fillText(sub, x + 7, ly + 29);
      ctx.font = "500 13px Schibsted Grotesk, system-ui";
      ctx.fillStyle = "#d2452b"; ctx.beginPath(); ctx.arc(x + 0.5, sy, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- interaction ----------
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, az: st.az }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (drag) { st.az = drag.az - (e.clientX - drag.x) / pxPerDeg; draw(); } });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); st.fov = Math.min(140, Math.max(20, st.fov * (e.deltaY > 0 ? 1.08 : 0.93))); draw(); }, { passive: false });
  const ro = new ResizeObserver(draw); ro.observe(canvas);
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files?.[0]; if (!f) return;
    const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => null);
    st.photo = img; st.fov = 65; photoCtl.classList.remove("hidden"); draw();
    toast("Drag and zoom until the ridgelines match your photo");
  });

  function save() {
    const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height + 64 * dpr;
    const c = out.getContext("2d"); c.fillStyle = "#fbfaf6"; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, 0, 0);
    c.scale(dpr, dpr); c.fillStyle = "#2c3733"; c.font = "600 16px Schibsted Grotesk, system-ui";
    c.fillText(`View from ${title}`, 14, H + 26);
    c.fillStyle = "#56625d"; c.font = "400 11px Schibsted Grotesk, system-ui";
    c.fillText("Tiny Atlas · Elevation: Mapzen/AWS Terrain Tiles · Summits: © OpenStreetMap contributors", 14, H + 46);
    out.toBlob((b) => { const a = h("a", { href: URL.createObjectURL(b), download: `view-from-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png` }); document.body.append(a); a.click(); a.remove(); toast("Picture saved"); });
  }
  requestAnimationFrame(draw);
  back.querySelector(".pano-tools .btn")?.focus();
  return { close, data };
}
