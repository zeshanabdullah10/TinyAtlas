// Router: "/" is the gallery, "/?region=<slug>" is a place. Plain navigation, so each view starts clean.
import { BASE, api } from "./api.js";
import { mountHome } from "./home.js";

// offline support (not in automated test browsers, which must always see fresh files)
if ("serviceWorker" in navigator && !navigator.webdriver) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});

const qs = new URLSearchParams(location.search);
const root = document.getElementById("app");
const region = qs.get("region");

const atlasRegions = region ? await api.regions().catch(() => ({})) : {};
if (region && atlasRegions[region]?.atlas) {
  location.replace(`${BASE}atlas.html?pack=${encodeURIComponent(atlasRegions[region].atlas)}`);        // Atlas places have no old-style page
} else if (region) {
  const { mountPlace } = await import("./place.js");
  await mountPlace(root, region, { lm: qs.get("lm"), clean: qs.get("clean") === "1" });
} else {
  await mountHome(root);
  window.__ready = true;
}
