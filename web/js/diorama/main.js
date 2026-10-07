// Diorama page: /diorama.html?site=mahodand[&t=17.5 solar hour][&tier=high|low]
// A tabletop model of one attraction, built from open data, that you can drive into: the jeep runs the real last
// stretch of the track, and the drive ends at the lake.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadSite } from "./site.js";
import { nearTerrain, farTerrain, tabletop } from "./land.js";
import { lake, streams, waterUniforms } from "./water.js";
import { flora } from "./flora.js";
import { Path, driveRibbon, trackRibbons, trailRibbon, roadStones } from "./road.js";
import { jeepModel, Ride } from "./jeep.js";
import { Dust } from "./dust.js";
import { Sky } from "./sky.js";
import { Sound } from "./audio.js";
import { Hud } from "./hud.js";
import { shoreLoop, ringLoop, footpath, viewpoints, viewpointPosts, Walker, waterRoute, loopAt, nearestOnLoop } from "./shore.js";
import { Life, boat as boatModel, horse as horseModel } from "./life.js";
import { Weather } from "./weather.js";
import { palace } from "./palace.js";
import { buildings } from "./buildings.js";
import { makePostcard, postcardSheet } from "../postcard.js";
import { roadStatusCard, loadRoads } from "../roadstatus.js";
import { Herders } from "./herders.js";
import { applyI18n } from "../i18n.js";
applyI18n("diorama");
import { Traffic, Riders } from "./traffic.js";
import { SEASONS, seasonU, mist } from "./season.js";

const qs = new URLSearchParams(location.search);
const SITE = (qs.get("site") || "mahodand").replace(/[^a-z0-9-]/g, "");
const base = new URL(`data/diorama/${SITE}/`, location.href).href;
const coarse = matchMedia("(pointer: coarse)").matches;
const tier = qs.get("tier") || (coarse || (navigator.hardwareConcurrency || 8) <= 4 ? "low" : "high");

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(tier === "high" ? Math.min(devicePixelRatio || 1, 2) : 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x15120f);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, 1, 0.2, 90000);
const hud = new Hud();
hud.loading("Opening the model");

const site = await loadSite(base, (f) => hud.loading(`Loading ${f}`)).catch((e) => { hud.loading(`Could not load this diorama (${e.message}).`); throw e; });
const meta = site.meta, F = meta.facts, Y0 = site.Y0;
document.title = `${meta.title} diorama · Tiny Atlas`;
document.querySelectorAll(".arrive h2, #title").forEach((el) => (el.textContent = meta.title));
{
  const back = document.getElementById("back-atlas");
  back.href = `atlas.html?pack=${meta.pack || "swat"}`;
  back.addEventListener("click", (e) => { if (document.referrer.includes("atlas.html") && history.length > 1) { e.preventDefault(); history.back(); } });
}
const latC = (meta.grid.bbox[0] + meta.grid.bbox[2]) / 2;

// ---- world
const sky = new Sky(scene, latC);
sky.set(Number(qs.get("t")) || 16.9);
document.getElementById("sun").value = sky.hour; document.getElementById("sun").dispatchEvent(new Event("input"));
const near = nearTerrain(site); scene.add(near);
const far = farTerrain(site); scene.add(far);
const table = tabletop(site); scene.add(table);
const water = meta.lake ? lake(site) : null; if (water) scene.add(water);
scene.add(streams(site));
const path = new Path(meta.drive, Y0);
scene.add(driveRibbon(path), ...trackRibbons(site, path), ...trailRibbon(site), roadStones(path));
const plants = flora(site, path, tier); scene.add(plants);
const lm = meta.landmark ? palace(site, meta.landmark, path.at(path.length), meta.landmark.model ? base + meta.landmark.model : null) : null; if (lm) scene.add(lm);
scene.add(buildings(site));
const jeep = jeepModel(); scene.add(jeep.root);
const ride = new Ride(path, jeep);
const traffic = new Traffic(scene, path, meta.lake ? "track" : "road", null);   // illustrative traffic, road rules on the drive
const dust = new Dust(scene, tier === "high" ? 800 : 400);
const sound = new Sound();
traffic.sound = sound;
const riders = new Riders(scene, path, jeep);
let toastT = 0;
function toast(text, secs = 4) { const el = document.getElementById("toast"); el.textContent = text; el.hidden = false; toastT = secs; }
function setLow(on) { ride.low = on; document.getElementById("btn-low").setAttribute("aria-pressed", on); }
/** A postcard: the current view with the site's measured facts and sources, shared from a sheet (WhatsApp first). */
async function photo() {
  renderer.render(scene, camera);
  const G = meta.facts, facts = [
    G.arrival_m != null && { label: G.lake_area_km2 != null ? "Lake" : "Height", value: `${Number(G.arrival_m).toLocaleString("en")} m` },
    G.lake_area_km2 != null && { label: "Area", value: `${G.lake_area_km2} km²` },
    G.walk_km != null ? { label: "Walk", value: `${G.walk_km} km` } : G.drive_km != null && { label: "Drive", value: `${G.drive_km} km` }].filter(Boolean);
  const blob = await makePostcard(renderer.domElement, { title: meta.title, subtitle: meta.subtitle, facts, painted: true });
  postcardSheet({ blob, title: meta.title, url: `${location.origin}${location.pathname}?site=${meta.site}` });
}
ride.update(0.016, { throttle: 0, brake: 0, steer: 0 });

// the place the visit is about: the lake, or (on a site without one) the arrival viewpoint
const A = meta.arrival;
const lb = water ? water.userData.box : { x0: A.x - 200, x1: A.x + 200, z0: A.z - 120, z1: A.z + 120 };
const lakeC = water ? new THREE.Vector3((lb.x0 + lb.x1) / 2, 0, (lb.z0 + lb.z1) / 2) : new THREE.Vector3(A.x, A.y - Y0, A.z);
const tableTarget = new THREE.Vector3(0, 380, 300);
hud.facts(meta);
if (!meta.lake) {
  document.getElementById("g-left-l").textContent = `km to the ${meta.arrival.name}`;
  document.querySelector('[data-act="lakeview"]').textContent = "Overview";
  document.querySelector("#intro .lede").textContent = `Built from real elevation, land cover and the mapped road. Take the wheel for the last stretch of the ${meta.road || "road"}, feel every bump, and roll out at the ${meta.arrival.name}.`;
} else if (meta.walk) {
  document.querySelector("#intro .lede").textContent = `Built from real elevation, land cover and the mapped track and footpath. Drive the last stretch of the ${meta.road || "track"} to where it ends, then follow the ${meta.walk.km} km path on foot up to the lake.`;
} else if (meta.site !== "mahodand") {
  document.querySelector("#intro .lede").textContent = `Built from real elevation, land cover and the mapped jeep track. Take the wheel for the last stretch of the ${meta.road || "track"}, feel every rut, and roll out at the lake.`;
}
hud.profile(path);
// optional, hand-kept: web/data/diorama/<site>/practical.json, [{label, value, source, url}], each with a source
fetch(base + "practical.json").then((r) => (r.ok ? r.json() : null)).then((p) => hud.practical(p)).catch(() => {});
const PLACE_SLUG = { mahodand: "mahodand-lake", "white-palace": "white-palace-marghazar" }[SITE] || SITE;
loadRoads().then((r) => { const c = roadStatusCard(r, { slug: PLACE_SLUG }); if (c?.childElementCount) { const b = document.getElementById("before"); b.append(c); b.hidden = false; } });

// ---- the shore: footpath, viewpoints, walker, life, mist
const loop = meta.lake ? shoreLoop(site) : ringLoop(site, A.x, A.z, meta.landmark ? 52 : 150);
if (!meta.landmark) scene.add(footpath(site, loop));   // around a building you walk the lawn, no traced path
const vps = viewpoints(site, loop, path);
scene.add(viewpointPosts(vps));
const walker = new Walker(site, loop, canvas);
const rowRoute = meta.lake ? waterRoute(site, loop) : null;
if (!rowRoute) { document.getElementById("m-boat").hidden = true; document.getElementById("m-horse").hidden = true; document.querySelector('[data-act="tour"]').textContent = "Tour around"; }
walker.mounts.horse = horseModel(0x9a6a3e);
walker.mounts.boat = boatModel(0xe2b347, { rower: false });
{
  // from the saddle: the neck reaches forward and down so the head sits low in the view, never across it
  const h = walker.mounts.horse, neck = h.userData.neck;
  h.userData.saddle.visible = false;
  h.userData.animate = (t, moving, phase) => { neck.rotation.x = -0.5 + Math.sin(phase * 0.9) * 0.05 * moving; };
  const b = walker.mounts.boat, oar = b.userData.oar;
  b.userData.animate = (t, moving) => { oar.rotation.y = Math.sin(t * 2.2) * 0.45 * Math.max(moving, 0.15); };
  for (const m of [h, b]) { m.visible = false; scene.add(m); }
}
const holdKeys = new Set();
// photos taken near here (Wikimedia Commons, geotagged, credited)
let photos = [];
fetch(base + "photos.json").then((r) => (r.ok ? r.json() : [])).then((list) => {
  photos = list.map((p) => { const [x, z] = site.toLocal(p.lat, p.lon); return { ...p, x, z }; });
  hud.addLabels(photos.map((p) => ({ text: `📷 ${p.caption}`, name: p.caption, sub: `${p.author}, ${p.date.slice(0, 4)}`, photo: p, group: "Photos",
    hint: "Open the photo and walk to where it was taken", p: new THREE.Vector3(p.x, site.heightAt(p.x, p.z) + 2.5, p.z), cls: "cam", modes: ["walk"], range: 300 })));
}).catch(() => {});
const weather = new Weather(latC, (meta.grid.bbox[1] + meta.grid.bbox[3]) / 2, F.arrival_m);
weather.load().then((t) => hud.weather(t)).catch(() => {});
const life = meta.lake ? new Life(scene, site, loop, path, lakeC) : { labels: [], horses: [], update() {} };
const mistG = mist(lakeC); scene.add(mistG);
let season = 0;
// herders' flocks (illustrative): the upper-valley village sites, where the sources describe summer grazing
const herders = ["kalam", "ushu", "utror", "gabral", "matiltan"].includes(SITE) ? new Herders(scene, site, path, {}) : null;
herders?.setSeason(SEASONS[season].name);
let _overview = null;
function lakeView() {           // the overview: high behind the track you came up, the whole site in view, never inside a ridge
  if (_overview) return { p: _overview.p.clone(), look: _overview.look.clone() };
  const look = lakeC.clone(), from = path.at(0), dir = new THREE.Vector3(from.x - look.x, 0, from.z - look.z).normalize();
  const D = meta.lake ? 1100 : 520;
  const p = look.clone().addScaledVector(dir, D); p.y = look.y + D * 0.62;
  const clear = () => { for (let i = 1; i <= 24; i++) { const q = p.clone().lerp(look, i / 25); if (q.y < site.heightAt(q.x, q.z) + 25) return false; } return true; };
  for (let k = 0; k < 40 && !clear(); k++) p.y += 40;
  p.y = Math.max(p.y, site.heightAt(p.x, p.z) + 80);
  _overview = { p, look };
  return { p: p.clone(), look: look.clone() };
}
/** Any free camera stays above the ground. */
function keepAbove(min = 18) {
  const g = site.heightAt(camera.position.x, camera.position.z) + min;
  if (camera.position.y < g) camera.position.y = g;
}

// ---- labels (names only as the sources give them)
const river = meta.streams.find((s) => s.name);
const labels = [
  { text: meta.title, p: lakeC.clone().setY(lakeC.y + (lm ? 30 : 40)), cls: meta.lake ? "lake" : "start", group: "On the map" },
  { text: "Start of the drive", p: new THREE.Vector3(path.X[0], path.Y[0] + 30, path.Z[0]), cls: "start", table: true, group: "On the map", drive: true },
  { text: meta.road || "Mahodand Lake Road", group: "On the map", p: (() => { const q = path.at(path.length * 0.45); return new THREE.Vector3(q.x, q.y + 25, q.z); })(), cls: "road" },
];
if (river) { const m = river.pts[Math.floor(river.pts.length * 0.6)]; labels.push({ text: river.name, group: "On the map", p: new THREE.Vector3(m[0], site.heightAt(m[0], m[1]) + 25, m[1]), cls: "river" }); }
hud.makeLabels(labels);
hud.addLabels(vps.map((v) => ({ text: v.name, vp: v, group: "Viewpoints", sub: meta.lake ? "On the shore path" : "On the walk round the grounds", p: new THREE.Vector3(v.x, v.y + 3.2, v.z), cls: "vp", modes: ["walk"], range: 450 })));
hud.addLabels([...life.labels, ...(herders?.labels ?? [])].map((l) => ({ ...l, name: l.text.split(" · ")[0], sub: l.text.split(" · ")[1], group: `At the ${meta.lake ? "lake" : "site"}` })));

// ---- tags and the Places list: go to what was chosen
hud.on("goto", (l) => {
  const p = typeof l.p === "function" ? l.p() : l.p;
  if (l.photo) hud.lightbox(l.photo);
  if (l.drive) { startDrive(); return; }
  if (state === "walk") {
    if (walker.mode !== "foot") { walker.setMode("foot", loop); walker.glide = null; }
    let x = p.x, z = p.z;
    if (site.coverAt(x, z) === 5) { const q = loopAt(loop, nearestOnLoop(loop, x, z)); x = q.x; z = q.z; }
    walker.glideTo({ x, z, s: nearestOnLoop(loop, x, z) }, l.photo || l.vp ? lakeC : new THREE.Vector3(p.x, 0, p.z));
    hud.auto(false, "foot");
  } else if (state === "explore" || state === "table") {
    if (l.vp || l.photo) { startWalk(l.vp || nearestVp(p)); return; }
    hud.intro(false); orbit.autoRotate = false;
    orbitFly = { t: 0, from: orbit.target.clone(), to: new THREE.Vector3(p.x, site.heightAt(p.x, p.z), p.z), cam: camera.position.clone() };
  }
});
function nearestVp(p) { return vps.reduce((a, v) => (Math.hypot(v.x - p.x, v.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? v : a), vps[0]); }

// ---- environment modes
let env = "";
function setEnv(e) {
  if (env === e) return;
  env = e;
  const real = e === "real";
  sky.dome.visible = real; far.visible = real; table.visible = !real;
  scene.fog = real ? new THREE.Fog(sky.horizon.clone(), 600, 26000) : null;
  document.body.dataset.env = e;
}
setEnv("table");

// ---- controls
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.dampingFactor = 0.07;
// the Atlas gesture model: one finger moves, pinch zooms, two-finger twist turns; mouse drag turns, right-drag moves
Object.assign(orbit, { screenSpacePanning: false, zoomToCursor: true, zoomSpeed: 0.9, rotateSpeed: 0.6, panSpeed: 0.9 });
orbit.touches.ONE = THREE.TOUCH.PAN;
orbit.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
orbit.addEventListener("start", () => { orbit.autoRotate = false; });
canvas.addEventListener("dblclick", (e) => {     // double-click flies to that spot, as on the map
  if (!orbit.enabled) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(near, false)[0];
  if (hit) orbitFly = { t: 0, from: orbit.target.clone(), to: hit.point.clone(), cam: camera.position.clone() };
});
let orbitFly = null;
function tableView(animate = false) {
  orbit.target.copy(tableTarget);
  orbit.minDistance = 1800; orbit.maxDistance = 22000; orbit.maxPolarAngle = 1.38;
  orbit.autoRotate = true; orbit.autoRotateSpeed = 0.35;
  if (!animate) camera.position.set(6100, 4700, 8300);
}
tableView();

const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, cruise: false };
addEventListener("keydown", (e) => {
  if (e.target.type === "range" || (e.key === " " && e.target.closest?.("button"))) return;   // the slider and buttons keep their keys
  keys.add(e.key.toLowerCase());
 if (state === "walk") {
    if (e.key === "t" || e.key === "T") hud.emit("pace");
    if (e.key === " ") { hud.emit("auto"); e.preventDefault(); }
    if (e.key === "n" || e.key === "N") hud.emit("nextvp");
    if (e.key.startsWith("Arrow")) e.preventDefault();
  }
  if (state === "drive") {
    if (e.key === " ") { input.cruise = !input.cruise; hud.cruise(input.cruise); e.preventDefault(); }
    if (e.key === "c" || e.key === "C") cycleCam();
    if (e.key === "h" || e.key === "H") traffic.horn(ride);
    if (e.key === "g" || e.key === "G") setLow(!ride.low);
    if (e.key === "p" || e.key === "P") photo();
    if (e.key === "t" || e.key === "T") hud.emit("pace");
    if (e.key.startsWith("Arrow")) e.preventDefault();
  }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
hud.bindPedals(input);

let state = "table", camMode = 0, lastState = "";
const CAMS = ["Chase", "Driver", "Trackside"];
function cycleCam() { camMode = (camMode + 1) % CAMS.length; hud.camName(CAMS[camMode]); }

// ---- transitions
let fly = null;      // { t, dur, from: {p, q}, to: () => {p, look}, mid?, onMid?, done? }
function flyTo(opts) { fly = { t: 0, ...opts, p0: camera.position.clone(), l0: currentLook() }; }
function currentLook() { const d = new THREE.Vector3(); camera.getWorldDirection(d); return camera.position.clone().addScaledVector(d, 50); }
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

hud.on("drive", startDrive);
hud.on("explore", () => { hud.intro(false); orbit.autoRotate = false; });
hud.on("again", () => { hud.arrive(null); startDrive(); });
hud.on("model", backToModel);
hud.on("cam", cycleCam);
hud.on("cruise", () => { input.cruise = !input.cruise; hud.cruise(input.cruise); });
const PACES = [1, 2, 4, 8];
let pace = 1;
hud.on("pace", () => { pace = PACES[(PACES.indexOf(pace) + 1) % PACES.length]; hud.pace(pace); });
hud.on("sound", () => { sound.start(); sound.mute(!sound.muted); hud.sound(!sound.muted); });
hud.on("sun", (h) => { sky.set(h); if (scene.fog) scene.fog.color.copy(sky.horizon); });
hud.on("walk", startWalk);
hud.on("tour", () => startWalk(vps[0], { tour: true }));
// The shore tour: glide along the path to each viewpoint in turn, stop, turn to the water, look for a few seconds.
let tour = null;
const relS = (v) => ((((v.s - walker.s) % loop.length) + loop.length) % loop.length);
function tourLeg() {
  if (!tour) return;
  if (tour.left-- <= 0) { endTour(); return; }
  const next = vps.filter((v) => relS(v) > 15).sort((a, b) => relS(a) - relS(b))[0];
  if (!next) { endTour(); return; }
  walker.speed = 15; walker.stopAt = walker.s + relS(next); walker.auto = true;
  walker.onStop = () => { walker.glideTo({ x: walker.pos.x, z: walker.pos.z, s: walker.s }, lakeC); tour.pause = 6; tour.at = next; };
  hud.auto(true, walker.mode);
}
function endTour() { tour = null; walker.auto = false; walker.stopAt = null; walker.onStop = null; walker.speed = 1; hud.auto(false, walker.mode); }
hud.on("auto", () => { if (state !== "walk") return; if (tour) { endTour(); return; } walker.auto = !walker.auto; walker.glide = null; hud.auto(walker.auto, walker.mode); });
for (const m of ["foot", "horse", "boat"]) hud.on(`mode-${m}`, () => {
  if (state !== "walk" || walker.mode === m) return;
  if (tour) endTour();
  walker.setMode(m, m === "boat" ? rowRoute : loop);
  hud.auto(false, m);
  if (m === "boat") boatRide();
});
// One short ride: row ~220 m out along the middle of the water, stop, and turn to look up the lake.
function boatRide() {
  walker.afterGlide = () => {
    if (walker.mode !== "boat") return;
    walker.speed = 1.6; walker.stopAt = walker.s + Math.min(220, rowRoute.length * 0.25); walker.auto = true;
    walker.onStop = () => {
      const far = vps.reduce((a, v) => (Math.hypot(v.x - walker.pos.x, v.z - walker.pos.z) > Math.hypot(a.x - walker.pos.x, a.z - walker.pos.z) ? v : a), vps[0]);
      walker.glideTo({ x: walker.pos.x, z: walker.pos.z, s: walker.s }, far); hud.auto(false, "boat");
    };
    hud.auto(true, "boat");
  };
}
hud.bindHold("#p-walk", () => holdKeys.add("w"), () => holdKeys.delete("w"));
hud.on("nextvp", () => {
  if (state !== "walk") return;
  const rel = (v) => ((((v.s - walker.s) % loop.length) + loop.length) % loop.length);
  const next = vps.filter((v) => rel(v) > 15).sort((a, b) => rel(a) - rel(b))[0] || vps[0];
  if (tour) endTour();
  if (walker.mode === "boat") walker.setMode("foot", loop);
  walker.glideTo(next, lakeC); hud.auto(false, walker.mode);
});
hud.on("lakeview", () => leaveWalk());
hud.on("season", () => {
  season = (season + 1) % SEASONS.length;
  herders?.setSeason(SEASONS[season].name);
  hud.season(SEASONS[season].name, SEASONS[season].note);
});
hud.on("low", () => setLow(!ride.low));
hud.on("photo", photo);
hud.on("more", () => { const on = document.body.classList.toggle("more"), b = document.querySelector('[data-act="more"]'); b.setAttribute("aria-pressed", on); b.textContent = on ? "Close" : "More"; });
hud.on("horn", () => { sound.start(); traffic.horn(ride); });
document.getElementById("p-horn")?.addEventListener("pointerdown", (e) => { e.preventDefault(); sound.start(); traffic.horn(ride); });
hud.on("skip", () => { if (state === "drive") ride.s = path.length - 40; });

let arrived = false;
function startWalk(target, opts = {}) {
  sound.start(); hud.sound(!sound.muted); hud.driving(false);
  hud.arrive(null); hud.intro(false);
  const v = target && target.x != null ? target : vps[0];
  orbit.enabled = false; orbit.autoRotate = false;
  state = "walkin";
  const eye = new THREE.Vector3(v.x, v.y + 1.65, v.z);
  flyTo({ dur: env === "table" ? 4 : 3.2, lift: env === "table" ? 1800 : 60, to: () => ({ p: eye, look: lakeC.clone().setY(2) }),
    mid: env === "table" ? 0.6 : -1, onMid: () => { hud.flash(); setEnv("real"); },
    done: () => { walker.place(v.x, v.z, lakeC.x, lakeC.z); walker.pitch = -0.04; walker.on = true; state = "walk"; hud.walking(true); hud.vp(v.name);
      if (opts.tour) { tour = { left: vps.length, pause: 4, at: v }; } } });
}
function leaveWalk() {
  if (tour) endTour();
  if (walker.mode !== "foot") { walker.setMode("foot", loop); walker.glide = null; }
  walker.on = false; walker.auto = false; hud.auto(false); hud.walking(false); hud.photo(null);
  state = "back";
  flyTo({ dur: 3.2, to: () => lakeView(), lift: 0,
    done: () => { state = "explore"; orbit.enabled = true; orbit.target.copy(lakeC); setExploreOrbit(); hud.arrive(F, { arrived }); } });
}
function setExploreOrbit() {
  orbit.minDistance = 120; orbit.maxDistance = 6000; orbit.maxPolarAngle = 1.15; orbit.autoRotate = true; orbit.autoRotateSpeed = 0.18;
}

function startDrive() {
  sound.start(); hud.sound(!sound.muted);
  walker.on = false; hud.walking(false);
  hud.intro(false); hud.arrive(null);
  ride.s = 6; ride.v = 0; ride.lat = -0.45; ride.done = false; ride._init = false;
  ride.update(0.016, { throttle: 0, brake: 0, steer: 0 });
  orbit.enabled = false; orbit.autoRotate = false;
  state = "dive";
  const goal = chasePose(1);
  flyTo({
    dur: env === "table" ? 4.2 : 2.2, to: () => goal,
    lift: env === "table" ? 2200 : 120,
    onMid: () => { hud.flash(); setEnv("real"); }, mid: env === "table" ? 0.62 : -1,
    done: () => { state = "drive"; hud.driving(true); hud.camName(CAMS[camMode]); },
  });
}

function backToModel() {
  hud.arrive(null); hud.driving(false); walker.on = false; hud.walking(false);
  state = "back"; orbit.enabled = false;
  flyTo({
    dur: 3.4, to: () => ({ p: new THREE.Vector3(6100, 4700, 8300), look: tableTarget }), lift: 1500, mid: 0.35,
    onMid: () => { hud.flash(); setEnv("table"); },
    done: () => { state = "table"; orbit.enabled = true; tableView(true); hud.intro(true); },
  });
}

function arrive() {               // a short rise from the jeep to the overview; nothing flies low through the hills
  if (riders.aboard) toast(`You brought ${riders.aboard} ${riders.aboard > 1 ? "people" : "person"} up. Shukriya!`, 5);
  state = "arrive"; hud.driving(false); arrived = true;
  if (meta.walk && !hike) { hikeToLake(); return; }
  hike = null;
  flyTo({ dur: 5, to: () => lakeView(), lift: 0, done: () => { state = "explore"; orbit.enabled = true; orbit.target.copy(lakeC); setExploreOrbit(); } });
  setTimeout(() => { if (state === "arrive" || state === "explore") hud.arrive(F, { arrived: true }); }, 1800);
}

// A lake reached on foot (meta.walk): the jeep stops at the trailhead; the camera follows the path to the shore, sped up.
let hike = null;
function hikeToLake() {
  const W = meta.walk, P = W.pts, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const hours = W.km / 3 + W.climb_m / 400;     // walking pace with Naismith's rule for the climb
  toast(`The jeep track ends here. ${W.km} km on foot to the lake, about ${hours.toFixed(1)} h` +
        (W.traced_km ? ` (the last ${W.traced_km} km has no mapped path)` : "") + ".", 7);
  hike = { s: 0, cum, P, dur: Math.min(40, 14 + W.km * 3) };
  state = "hike";
}
function hikeStep(dt) {
  const h = hike, L = h.cum[h.cum.length - 1];
  h.s = Math.min(L, h.s + (L / h.dur) * dt);
  let i = 1; while (i < h.P.length - 1 && h.cum[i] < h.s) i++;
  const a = h.P[i - 1], b = h.P[i], t = (h.s - h.cum[i - 1]) / Math.max(h.cum[i] - h.cum[i - 1], 0.01);
  const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
  const ahead = h.P[Math.min(i + 12, h.P.length - 1)];
  const eye = new THREE.Vector3(x, site.heightAt(x, z) + 9, z);
  const back = new THREE.Vector3(x - ahead[0], 0, z - ahead[1]).normalize().multiplyScalar(14);
  eye.add(back); eye.y = Math.max(eye.y, site.heightAt(eye.x, eye.z) + 6);
  camera.position.lerp(eye, 1 - Math.exp(-dt * 3));
  camera.lookAt(ahead[0], site.heightAt(ahead[0], ahead[1]) + 2, ahead[1]);
  if (h.s >= L) { hike.done = true; arrive(); }
}

// ---- drive camera
const camP = new THREE.Vector3(), camL = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
function chasePose(k) {
  const r = jeep.root, fwd = new THREE.Vector3(-Math.sin(r.rotation.y), 0, -Math.cos(r.rotation.y));
  const tall = innerHeight > innerWidth;                 // a phone held upright sees less sideways: pull back further
  const p = r.position.clone().addScaledVector(fwd, (tall ? -17 : -14) * k).add(new THREE.Vector3(0, tall ? 7.5 : 6.2, 0));
  p.y = Math.max(p.y, site.heightAt(p.x, p.z) + 2.4);
  return { p, look: r.position.clone().addScaledVector(fwd, 14).add(new THREE.Vector3(0, 0.8, 0)) };
}
let side = null;
function driveCamera(dt) {
  const r = jeep.root;
  if (camMode === 0) {
    const g = chasePose(1 + ride.v * 0.025);
    const k = 1 - Math.exp(-dt * 4.5);
    camP.lerp(g.p, k); camL.lerp(g.look, 1 - Math.exp(-dt * 8));
    camP.y = Math.max(camP.y, site.heightAt(camP.x, camP.z) + 1.4);
    camera.position.copy(camP); camera.lookAt(camL);
  } else if (camMode === 1) {
    jeep.body.localToWorld(tmpV.set(-0.35, 1.34, -0.2));
    jeep.body.localToWorld(tmpL.set(-0.3, 0.6, -25));
    camera.position.copy(tmpV); camera.lookAt(tmpL);
    camP.copy(tmpV); camL.copy(tmpL);
  } else {
    if (!side || ride.s - side.s > 30) {
      const s = Math.min(ride.s + 38, path.length - 1), q = path.at(s), l = side?.l === 7 ? -7 : 7;
      const p = new THREE.Vector3(q.x - q.tz * l, 0, q.z + q.tx * l);
      p.y = Math.max(site.heightAt(p.x, p.z), q.y) + 2.2;
      side = { s, l, p };
    }
    camera.position.copy(side.p);
    camera.lookAt(tmpL.copy(r.position).setY(r.position.y + 1));
    camP.copy(camera.position); camL.copy(tmpL);
  }
  const fov = (innerHeight > innerWidth ? 62 : 52) + ride.v * 0.6;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 2); camera.updateProjectionMatrix(); }
}

// ---- loop
function frameView() {             // keep the model clear of the side card on wide screens
  const w = innerWidth, h = innerHeight, side = w > 900 && (state === "table" || state === "explore");
  const phone = w <= 640 && (state === "table" || state === "explore");     // phones: lift the model above the bottom card
  if (side) camera.setViewOffset(w, h, -Math.min(w * 0.17, 300), 0, w, h);
  else if (phone) camera.setViewOffset(w, h, 0, h * 0.2, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; frameView();
  dust.uni.uPx.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}
addEventListener("resize", resize); resize();

const clock = new THREE.Clock();
const contacts = [];
let lastHV = 0, elapsed = 0;
const wind = new THREE.Vector3(0.7, 0, 0.35);
const shadowHi = tier === "high" ? 4096 : 2048;

function tick(dt) {
  elapsed += dt;
  if (state !== lastState) { lastState = state; frameView(); }
  waterUniforms.uTime.value = elapsed;
  waterUniforms.uSky.value.copy(sky.horizon);

  if (state === "hike") hikeStep(dt);
  if (state === "drive" || state === "arrive" || state === "dive") {
    const kb = (k) => keys.has(k);
    const driving = state === "drive";
    let throttle = driving ? (kb("w") || kb("arrowup") ? 1 : input.throttle) : 0;
    let brake = driving ? (kb("s") || kb("arrowdown") ? 1 : input.brake) : 1;
    const steer = driving ? (kb("d") || kb("arrowright") ? 1 : 0) - (kb("a") || kb("arrowleft") ? 1 : 0) || input.steer : 0;
    if (driving && input.cruise && !throttle && !brake) { throttle = Math.min(Math.max((7.6 - ride.v) * 0.7, 0), 1); brake = ride.v > 8.8 ? 0.3 : 0; }
    if (state === "dive") { throttle = 0; brake = 0; }
    const reps = driving ? pace : 1;                // time-lapse: the same physics, stepped more often
    for (let i = 0; i < reps; i++) ride.update(dt, { throttle, brake, steer });
    const dHV = Math.abs(ride.heaveV - lastHV); lastHV = ride.heaveV;
    if (dHV > 0.35) sound.knock(dHV * 0.8);
    if (ride.v > 0.6) for (const c of ride.rearContacts(contacts)) dust.emit(c, ride.v, Math.random() < ride.v * dt * 7 ? 1 : 0);
    sound.update(dt, { engine: 1, speed: Math.max(ride.v, 0), throttle, rough: Math.min(ride.jolt * 2, 1), wind: 0.4,
      water: Math.max(0, 1 - camera.position.distanceTo(lakeC) / 700) });
    let tip = traffic.update(dt * reps, ride, driving);
    const boarded = riders.update(dt, ride, driving);
    if (boarded) { toast(boarded); document.body.classList.add("has-riders"); document.getElementById("g-riders").textContent = riders.aboard; }
    if (!tip && driving && ride.lugging && ride.v < 3.5) tip = "Steep pitch: shift to 4×4 low (G)";
    if (!tip && driving && riders.near(ride)) tip = "Someone is waving: stop beside them to give a ride";
    const rt = document.getElementById("roadtip"); if (rt.textContent !== tip) rt.textContent = tip; rt.hidden = !tip || !driving;
    hud.update(ride, Y0, path.length);
    if (driving) {
      driveCamera(dt);
      if (ride.done) arrive();
    }
  } else {
    traffic.update(dt, ride, false);
    sound.update(dt, { engine: 0, speed: 0, throttle: 0, rough: 0, wind: env === "real" ? 0.6 : 0.15,
      water: env === "real" ? Math.max(sound.lake || 0, 1 - camera.position.distanceTo(lakeC) / 900) : 0 });
  }
  if (toastT > 0 && (toastT -= dt) <= 0) document.getElementById("toast").hidden = true;
  dust.update(dt, wind);
  life.update(dt, elapsed, wind);
  herders?.update(dt, elapsed);
  // seasons ease in; mist follows dawn
  const S = SEASONS[season], k = Math.min(1, dt * 1.5);
  seasonU.uAutumn.value += (S.autumn - seasonU.uAutumn.value) * k;
  seasonU.uWinter.value += (S.winter - seasonU.uWinter.value) * k;
  plants.userData.tufts.visible = seasonU.uWinter.value < 0.5;
  mistG.visible = env === "real";
  mistG.userData.uni.uT.value = elapsed;
  mistG.userData.uni.uMist.value = Math.min(1, Math.max(0, (7.4 - sky.hour) / 1.8)) * 0.95 + seasonU.uWinter.value * 0.12;
  if (state === "walk") {
    const k2 = holdKeys.size ? new Set([...keys, ...holdKeys]) : keys;
    if (tour && ["w", "a", "s", "d", "arrowup", "arrowdown"].some((x) => k2.has(x))) endTour();   // any step takes over
    if (tour && tour.pause > 0 && !walker.glide && (tour.pause -= dt) <= 0) tourLeg();
    walker.update(dt, k2, pace, lakeC, camera);
    let ph = null, pd = 120;
    for (const p of photos) { const d = Math.hypot(p.x - walker.pos.x, p.z - walker.pos.z); if (d < pd) { pd = d; ph = p; } }
    hud.photo(ph, pd);
    if (walker.mode === "foot" && walker.speed === 1) for (let i = 0; i < walker.steps; i++) sound.step(keys.has("shift") ? 1.2 : 0.8);
    if (walker.mode === "horse" && walker.steps && Math.random() < 0.12) sound.hooves(0.3);
    const near = vps.find((v) => Math.hypot(v.x - walker.pos.x, v.z - walker.pos.z) < 30);
    hud.vp(near ? near.name : meta.lake ? `${meta.title} shore` : meta.arrival.name);
  }
  if (env === "real" && state !== "drive") {
    let dl = Infinity;
    for (let i = 0; i < loop.pts.length; i += 6) dl = Math.min(dl, Math.hypot(loop.pts[i][0] - camera.position.x, loop.pts[i][1] - camera.position.z));
    const h = camera.position.y - site.heightAt(camera.position.x, camera.position.z);
    const near = Math.max(0, 1 - (dl + h) / 90);
    if (Math.random() < dt * 0.35 * (state === "walk" ? 1 : 0.4) && seasonU.uWinter.value < 0.5) sound.bird(0.4 + 0.6 * near);
    if (state === "walk" && Math.random() < dt * 0.04 && life.horses.length) {
      const d = Math.min(...life.horses.map((x) => x.m.position.distanceTo(camera.position)));
      if (d < 220) sound.hooves(1 - d / 220);
    }
    sound.lake = near;
  }

  if (fly) {
    fly.t += dt / fly.dur;
    const t = Math.min(fly.t, 1), e = ease(t);
    if (fly.curve) {
      camera.position.copy(fly.curve.getPoint(e));
      camera.position.y = Math.max(camera.position.y, site.heightAt(camera.position.x, camera.position.z) + 3);
      camera.lookAt(fly.looks.getPoint(Math.min(e * 1.05, 1)));
    } else {
      const goal = fly.to();
      const p = fly.p0.clone().lerp(goal.p, e);
      p.y += Math.sin(Math.PI * e) * (fly.lift || 0) * (1 - e);
      camera.position.copy(p);
      if (state !== "walkin" || t < 0.85) keepAbove(state === "walkin" || state === "dive" ? 2 + 40 * (1 - t) : 12);
      camera.lookAt(fly.l0.clone().lerp(goal.look, ease(Math.min(t * 1.3, 1))));
      camP.copy(p); camL.copy(goal.look);
    }
    if (fly.mid >= 0 && t >= fly.mid && !fly.midDone) { fly.midDone = true; fly.onMid?.(); }
    if (t >= 1) { const f = fly; fly = null; f.done?.(); }
  } else if (orbit.enabled) {
    if (orbitFly) {                                  // glide target and camera together, closing in by half
      orbitFly.t = Math.min(1, orbitFly.t + dt / 1.1);
      const e = 1 - (1 - orbitFly.t) ** 3;
      const off = orbitFly.cam.clone().sub(orbitFly.from).multiplyScalar(1 - 0.5 * e);
      orbit.target.lerpVectors(orbitFly.from, orbitFly.to, e);
      camera.position.copy(orbit.target).add(off);
      if (orbitFly.t >= 1) orbitFly = null;
    }
    const gw = meta.grid.width / 2, gh = meta.grid.height / 2;     // keep the target on the model, riding the ground
    orbit.target.x = Math.min(gw, Math.max(-gw, orbit.target.x)); orbit.target.z = Math.min(gh, Math.max(-gh, orbit.target.z));
    if (env === "real") { const dy = (site.heightAt(orbit.target.x, orbit.target.z) - orbit.target.y) * 0.1; orbit.target.y += dy; camera.position.y += dy; }
    orbit.update();
    if (env === "real") {
      const g = site.heightAt(camera.position.x, camera.position.z) + 25;
      if (camera.position.y < g) camera.position.y = g;
    }
  }

  // light rig follows what you look at
  if (env === "table") sky.frame(tmpV.set(0, 600, 0), 4200, shadowHi);
  else if (state === "drive" || state === "dive" && fly?.t > 0.6) sky.frame(jeep.root.position, 110, tier === "high" ? 2048 : 1024);
  else if (state === "walk" || state === "walkin" && fly?.t > 0.5) sky.frame(camera.position, 160, tier === "high" ? 2048 : 1024);
  else sky.frame(orbit.target.clone(), Math.min(3200, Math.max(400, camera.position.distanceTo(orbit.target) * 1.6)), shadowHi);
  sky.dome.position.copy(camera.position);
  sky.dome.scale.setScalar(60000);
  jeep.beam.intensity = sky.night > 0.3 ? 40 : 0;
  jeep.lamp.emissiveIntensity = sky.night > 0.3 ? 3 : 0.3;
  plants.visible = true;

  hud.placeLabels(camera, innerWidth, innerHeight, state);
}
let paused = false;
function frame() {
  if (!paused) { tick(Math.min(clock.getDelta(), 0.05)); renderer.render(scene, camera); }
  requestAnimationFrame(frame);
}
hud.loading(null);
// ?drive=1 (from the Atlas "Drive there" button) starts the drive straight away; sound waits for the first gesture
if (qs.get("drive") === "1") startDrive();
else if (qs.get("view") === "lake") {          // from the Atlas "See the lake" button: open on the view from the end of the drive
  ride.s = path.length - 3; ride._init = false; ride.update(0.016, { throttle: 0, brake: 1, steer: 0 });
  setEnv("real"); state = "explore";
  const v = lakeView(); camera.position.copy(v.p); camera.lookAt(v.look);
  orbit.target.copy(lakeC); setExploreOrbit();
  hud.arrive(F, { arrived: false });
} else hud.intro(true);
addEventListener("pointerdown", () => sound.ctx?.resume?.(), { once: true });
addEventListener("keydown", () => sound.ctx?.resume?.(), { once: true });
requestAnimationFrame(frame);
// test hook: advance the simulation by fixed steps without drawing (software GL runs at under 1 fps)
window.__diorama = { site, path, ride, traffic, riders, camera, scene, keys, input, renderer, walker, loop, vps, rowRoute, state: () => state, start: startDrive, emit: (k, a) => hud.emit(k, a),
  advance(seconds, hold = []) { paused = true; hold.forEach((k) => keys.add(k)); for (let t = 0; t < seconds; t += 1 / 30) tick(1 / 30);
    hold.forEach((k) => keys.delete(k)); renderer.render(scene, camera); clock.getDelta(); return { s: ride.s, v: ride.v, state, lat: ride.lat }; },
  resume() { paused = false; clock.getDelta(); } };
