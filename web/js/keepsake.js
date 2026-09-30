import * as THREE from "three";
import { h, fill, icon, toast } from "./dom.js";

// Your trip as a keepsake: photos placed on the miniature by their GPS tags, joined in the order they were taken,
// and a short film that flies from one to the next. Everything happens in the browser; photos never leave the device.

const EXIFR = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs";
const W = 1280, H = 720;

async function readPhoto(file) {
  const exifr = await import(EXIFR);
  const [gps, meta] = await Promise.all([exifr.gps(file).catch(() => null), exifr.parse(file, ["DateTimeOriginal"]).catch(() => null)]);
  const bmp = await createImageBitmap(file, { resizeWidth: 900, resizeQuality: "high" }).catch(() => null);
  return { file, bmp, lat: gps?.latitude, lon: gps?.longitude, time: meta?.DateTimeOriginal ? new Date(meta.DateTimeOriginal) : new Date(file.lastModified) };
}

function thumbTexture(bmp) {
  const s = 256, c = document.createElement("canvas"); c.width = c.height = s;
  const g = c.getContext("2d"), side = Math.min(bmp.width, bmp.height);
  g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, s, s);
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 14, 14, s - 28, s - 28);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function openKeepsake({ dio, info }) {
  const [bw, bs, be, bn] = info.bbox;
  let photos = [], group = null;
  const fileIn = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  const drop = h("label", { class: "keep-drop" }, fileIn, icon("i-camera"), h("b", {}, "Add your trip photos"),
    h("span", {}, "Photos with a location are placed on the map. They stay on this device."));
  const summary = h("p", { class: "keep-sum", "aria-live": "polite" });
  const filmBtn = h("button", { class: "btn btn-primary", type: "button", disabled: true, onclick: film }, icon("i-play"), "Make my film");
  const out = h("div", { class: "keep-out" });
  const close = () => { back.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const back = h("div", { class: "dialog-back", onclick: (e) => e.target === back && close() },
    h("div", { class: "dialog keep", role: "dialog", "aria-modal": "true", "aria-label": "My trip" },
      h("div", { class: "keep-head" }, h("h2", {}, `My ${info.name} trip`), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, icon("i-close"))),
      drop, summary, h("div", { class: "keep-actions" }, filmBtn), out));
  document.body.append(back); document.addEventListener("keydown", esc, true);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); });
  fileIn.addEventListener("change", () => add([...fileIn.files]));

  async function add(files) {
    files = files.filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    summary.textContent = `Reading ${files.length} photo${files.length > 1 ? "s" : ""}…`;
    const read = await Promise.all(files.map(readPhoto));
    photos = [...photos, ...read].sort((a, b) => a.time - b.time);
    const placed = photos.filter((p) => p.lat != null && p.lon >= bw && p.lon <= be && p.lat >= bs && p.lat <= bn && p.bmp);
    const noGps = photos.filter((p) => p.lat == null).length, away = photos.length - placed.length - noGps;
    summary.textContent = `${placed.length} photo${placed.length === 1 ? "" : "s"} placed on the map.` +
      (noGps ? ` ${noGps} had no location.` : "") + (away ? ` ${away} were taken outside this map.` : "");
    filmBtn.disabled = placed.length < 1;
    pin(placed);
  }

  function pin(placed) {
    if (group) dio.scene.remove(group);
    group = new THREE.Group();
    for (const p of placed) {
      p.u = (p.lon - bw) / (be - bw); p.v = (bn - p.lat) / (bn - bs);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: thumbTexture(p.bmp), depthTest: false }));
      s.scale.setScalar(dio.S * 7); s.position.copy(dio.world(p.u, p.v, dio.S * 7)); s.renderOrder = 5;
      group.add(s);
    }
    dio.scene.add(group);
    if (placed.length > 1) dio.setItinerary({ route: placed.map((p) => [p.u, p.v]), stops: [] });
  }

  // ---------- the film: flight + framed photos composited into one canvas, recorded in the browser ----------
  async function film() {
    const placed = photos.filter((p) => p.u != null);
    if (!window.MediaRecorder) { toast("This browser can't record video"); return; }
    filmBtn.disabled = true; back.classList.add("recording");
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");
    const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 });
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start();
    const src = dio.renderer.domElement;
    const frame = (overlay) => {
      g.drawImage(src, 0, 0, src.width, src.height, 0, 0, W, H);
      overlay?.(g);
    };
    const hold = (ms, overlay) => new Promise((res) => { const t0 = performance.now(); const tick = (now) => { frame(overlay); now - t0 < ms ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
    const title = (a, b) => (ctx) => {
      ctx.fillStyle = "rgba(28,36,33,.55)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fbfaf6"; ctx.textAlign = "center";
      ctx.font = "500 64px 'Schibsted Grotesk', system-ui"; ctx.fillText(a, W / 2, H / 2 - 6);
      ctx.font = "400 26px Literata, Georgia, serif"; ctx.fillText(b, W / 2, H / 2 + 44);
    };
    const when = placed[0].time.toLocaleDateString("en", { month: "long", year: "numeric" });
    dio.resetView(); await hold(1600, title(info.name, when));
    for (const [i, p] of placed.entries()) {
      const next = placed[i + 1] || p;
      const heading = (Math.atan2(next.u - p.u, -(next.v - p.v)) * 180) / Math.PI;
      dio.lookFrom(p.u, p.v + 0.04, isFinite(heading) && next !== p ? heading : 0);
      await hold(1600);
      await hold(2400, (ctx) => {                                   // the photo, framed like a print, with its date
        const bmp = p.bmp, sc = Math.min((W * 0.6) / bmp.width, (H * 0.7) / bmp.height), w = bmp.width * sc, hh = bmp.height * sc;
        const x = (W - w) / 2, y = (H - hh) / 2 - 16;
        ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x - 6, y + 10, w + 28, hh + 70);
        ctx.fillStyle = "#fbfaf6"; ctx.fillRect(x - 14, y - 14, w + 28, hh + 70);
        ctx.drawImage(bmp, x, y, w, hh);
        ctx.fillStyle = "#2c3733"; ctx.font = "400 22px Literata, Georgia, serif"; ctx.textAlign = "left";
        ctx.fillText(p.time.toLocaleString("en", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }), x, y + hh + 38);
      });
    }
    dio.resetView(); await hold(1400); await hold(1800, title(`${info.name}, ${when}`, "Made with Tiny Atlas"));
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: rec.mimeType }), url = URL.createObjectURL(blob);
    const ext = rec.mimeType.includes("mp4") ? "mp4" : "webm";
    fill(out, h("video", { src: url, controls: true, playsinline: true, class: "keep-video" }),
      h("a", { class: "btn btn-primary", href: url, download: `my-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-trip.${ext}` }, icon("i-down"), "Save the film"));
    back.classList.remove("recording"); filmBtn.disabled = false;
  }
  return { close, add };
}
