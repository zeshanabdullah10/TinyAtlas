// The landing page. "/" is the only page here; the map lives at atlas.html?pack=<slug>.
import { BASE } from "./api.js";
import { mountHome } from "./home.js";

// offline support (not in automated test browsers, which must always see fresh files)
if ("serviceWorker" in navigator && !navigator.webdriver) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});

await mountHome();
window.__ready = true;
