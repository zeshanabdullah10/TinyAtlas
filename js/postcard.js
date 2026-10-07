// Postcards: the current view with a card band (title, measured facts, sources) and a share sheet.
// Facts are passed in by the caller from meta.facts; nothing is computed or invented here.
import { h } from "./dom.js";

const CARD = "#f3e9d2", INK = "#15120f", ACCENT = "#e9a23b", MUTED = "#6b5f4e";
const SERIF = '"Cormorant SC", "Iowan Old Style", Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const SOURCES = "Built from Copernicus DEM, ESA WorldCover, OpenStreetMap · tinyatlas";
const PAINTED = "Scene painted; heights and roads are real";

/** True on a phone-sized screen, where the card is portrait. */
export function isPhone() {
  return typeof matchMedia === "function" && matchMedia("(max-width: 700px) and (pointer: coarse)").matches;
}

/** Fit `text` into maxW px by shrinking the font; returns the font size used. */
function fitText(x, text, weight, size, maxW, family) {
  let s = size;
  do { x.font = `${weight} ${s}px ${family}`; if (x.measureText(text).width <= maxW) break; s -= 2; } while (s > 14);
  return s;
}

/**
 * makePostcard(canvas, {title, subtitle, facts:[{label,value}], credit, painted})
 * -> Promise<Blob> (JPEG). Landscape 1600x1000, or portrait 1080x1350 on a phone.
 */
export async function makePostcard(canvas, { title = "", subtitle = "", facts = [], credit = "", painted = false, portrait = isPhone() } = {}) {
  const W = portrait ? 1080 : 1600, H = portrait ? 1350 : 1000;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  const band = Math.round(H * (portrait ? 0.34 : 0.32)), pad = Math.round(W * 0.05), imgH = H - band;

  // the view, cover-fitted into the top part
  x.fillStyle = INK; x.fillRect(0, 0, W, H);
  const sw = canvas.width, sh = canvas.height, s = Math.max(W / sw, imgH / sh);
  const dw = sw * s, dh = sh * s;
  x.drawImage(canvas, (W - dw) / 2, (imgH - dh) / 2, dw, dh);

  // the warm card band
  x.fillStyle = CARD; x.fillRect(0, imgH, W, band);
  x.fillStyle = ACCENT; x.fillRect(pad, imgH + 4, Math.round(W * 0.08), 4);

  let y = imgH + Math.round(band * 0.14);
  x.fillStyle = INK; x.textBaseline = "top";
  const tSize = fitText(x, title, 600, Math.round(H * (portrait ? 0.05 : 0.06)), W - 2 * pad, SERIF);
  x.font = `600 ${tSize}px ${SERIF}`; x.fillText(title, pad, y);
  y += Math.round(tSize * 1.25);

  if (subtitle) {
    const sSize = fitText(x, subtitle, 400, Math.round(H * 0.026), W - 2 * pad, SANS);
    x.font = `${sSize}px ${SANS}`; x.fillStyle = MUTED; x.fillText(subtitle, pad, y);
    y += Math.round(sSize * 1.6);
  }

  if (facts.length) {
    const line = facts.slice(0, 3).map((f) => `${f.label} ${f.value}`).join("  ·  ");
    const fSize = fitText(x, line, 600, Math.round(H * 0.028), W - 2 * pad, SANS);
    x.font = `600 ${fSize}px ${SANS}`; x.fillStyle = INK; x.fillText(line, pad, y);
  }

  const foot = [SOURCES, painted ? PAINTED : "", credit].filter(Boolean).join("  ·  ");
  const oSize = fitText(x, foot, 400, Math.round(H * 0.019), W - 2 * pad, SANS);
  x.font = `${oSize}px ${SANS}`; x.fillStyle = MUTED; x.fillText(foot, pad, H - pad * 0.7 - oSize);

  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("postcard: JPEG encode failed"))), "image/jpeg", 0.92));
}

function slug(t) { return String(t || "postcard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "postcard"; }

/** Save the JPEG to the device. */
export function downloadPostcard(blob, title = "postcard") {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${slug(title)}-postcard.jpg` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open WhatsApp with the title and link. */
export function openWhatsApp(title, url) {
  window.open(`https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}`, "_blank", "noopener");
}

/**
 * sharePostcard(blob, {title, url}) -> "shared" | "cancelled" | "fallback".
 * Native share with the image when the device supports files; otherwise downloads the JPEG and opens WhatsApp.
 */
export async function sharePostcard(blob, { title = "", url = "" } = {}) {
  const file = new File([blob], `${slug(title)}-postcard.jpg`, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: title, url }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  downloadPostcard(blob, title);
  openWhatsApp(title, url);
  return "fallback";
}

/** A modal with the preview and Share / WhatsApp / Download / Close. Returns the sheet element. */
export function postcardSheet({ blob, title = "", url = "" }) {
  const imgUrl = URL.createObjectURL(blob);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { sheet.remove(); URL.revokeObjectURL(imgUrl); document.removeEventListener("keydown", onKey); };
  const status = h("p", { class: "pc-status", role: "status" });
  const say = (t) => { status.textContent = t; };
  const sheet = h("div", { class: "pc-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Postcard" },
    h("div", { class: "pc-card" },
      h("img", { class: "pc-img", src: imgUrl, alt: `Postcard: ${title}` }),
      status,
      h("div", { class: "pc-actions" },
        h("button", { type: "button", class: "pc-btn pc-primary", onclick: async () => {
          const r = await sharePostcard(blob, { title, url });
          say(r === "fallback" ? "Picture saved; WhatsApp is open. Attach it there." : r === "shared" ? "Shared." : "");
        } }, "Share"),
        h("button", { type: "button", class: "pc-btn", onclick: () => { openWhatsApp(title, url); say("WhatsApp is open. Attach the saved picture."); } }, "WhatsApp"),
        h("button", { type: "button", class: "pc-btn", onclick: () => { downloadPostcard(blob, title); say("Saved."); } }, "Download"),
        h("button", { type: "button", class: "pc-btn", onclick: close }, "Close")
      )
    )
  );
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(sheet);
  sheet.querySelector(".pc-primary").focus();
  return sheet;
}
