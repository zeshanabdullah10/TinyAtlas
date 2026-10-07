// The landing page. "/" is the only page here; the map lives at atlas.html?pack=<slug>.
import { BASE } from "./api.js";
import { mountHome } from "./home.js";
import { applyI18n, lang, setLang, t } from "./i18n.js";

// offline support (not in automated test browsers, which must always see fresh files)
if ("serviceWorker" in navigator && !navigator.webdriver) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});

await mountHome();
await applyI18n("index");
const toggle = document.querySelector("[data-lang-toggle]");
if (lang() === "ur") toggle.textContent = "English";
toggle.addEventListener("click", () => setLang(lang() === "ur" ? "en" : "ur"));
document.querySelector("[data-phrases]").addEventListener("click", async () => {   // the traveller phrase card, in a modal
  const [{ phraseCard }, phrases, ...packs] = await Promise.all([import("./phrasecard.js"), fetch("data/phrases.json").then((r) => r.json()),
    ...["swat", "swat-lower"].map((p) => fetch(`${BASE}packs/${p}/atlas/places.json`).then((r) => r.json()).catch(() => []))]);
  const box = document.createElement("div"); box.className = "pc-modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  const x = document.createElement("button"); x.type = "button"; x.className = "pc-close"; x.textContent = t("phrases.close") || "Close";
  x.onclick = () => box.remove(); box.addEventListener("click", (e) => { if (e.target === box) box.remove(); });
  box.append(phraseCard(phrases.phrases || phrases, packs.flat()), x); document.body.append(box);
});
window.__ready = true;
