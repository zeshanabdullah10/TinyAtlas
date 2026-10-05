// Diorama page: /diorama.html?site=mahodand[&t=17.5 solar hour][&tier=high|low]
// A tabletop model of one attraction, built from open data, that you can drive into: the jeep runs the real last
// stretch of the track, and the drive ends at the lake.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadSite } from "./site.js";
import { nearTerrain, farTerrain, tabletop } from "./land.js";
import { lake, streams, waterUniforms } from "./water.js";
import { flora } from "./flora.js";
import { Path, driveRibbon, trackRibbons, roadStones } from "./road.js";
import { jeepModel, Ride } from "./jeep.js";
import { Dust } from "./dust.js";
import { Sky } from "./sky.js";
import { Sound } from "./audio.js";
import { Hud } from "./hud.js";

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
const latC = (meta.grid.bbox[0] + meta.grid.bbox[2]) / 2;

// ---- world
const sky = new Sky(scene, latC);
sky.set(Number(qs.get("t")) || 16.9);
const near = nearTerrain(site); scene.add(near);
const far = farTerrain(site); scene.add(far);
const table = tabletop(site); scene.add(table);
const water = lake(site); scene.add(water);
scene.add(streams(site));
const path = new Path(meta.drive, Y0);
scene.add(driveRibbon(path), ...trackRibbons(site, path), roadStones(path));
const plants = flora(site, path, tier); scene.add(plants);
const jeep = jeepModel(); scene.add(jeep.root);
const ride = new Ride(path, jeep);
const dust = new Dust(scene, tier === "high" ? 800 : 400);
const sound = new Sound();
ride.update(0.016, { throttle: 0, brake: 0, steer: 0 });

const lb = water.userData.box;
const lakeC = new THREE.Vector3((lb.x0 + lb.x1) / 2, 0, (lb.z0 + lb.z1) / 2);
const tableTarget = new THREE.Vector3(0, 380, 300);
hud.facts(meta);
hud.profile(path);

// ---- labels (names only as the sources give them)
const river = meta.streams.find((s) => s.name);
const labels = [
  { text: meta.title, p: lakeC.clone().setY(40), cls: "lake" },
  { text: "Start of the drive", p: new THREE.Vector3(path.X[0], path.Y[0] + 30, path.Z[0]), cls: "start", table: true },
  { text: "Mahodand Lake Road", p: (() => { const q = path.at(path.length * 0.45); return new THREE.Vector3(q.x, q.y + 25, q.z); })(), cls: "road" },
];
if (river) { const m = river.pts[Math.floor(river.pts.length * 0.6)]; labels.push({ text: river.name, p: new THREE.Vector3(m[0], site.heightAt(m[0], m[1]) + 25, m[1]), cls: "river" }); }
hud.makeLabels(labels);

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
  if (state === "drive") {
    if (e.key === "c" || e.key === "C") cycleCam();
    if (e.key === "t" || e.key === "T") hud.emit("pace");
    if (e.key === " ") { input.cruise = !input.cruise; hud.cruise(input.cruise); e.preventDefault(); }
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
hud.on("skip", () => { if (state === "drive") ride.s = path.length - 40; });

function startDrive() {
  sound.start(); hud.sound(!sound.muted);
  hud.intro(false); hud.arrive(null);
  ride.s = 6; ride.v = 0; ride.lat = 0.2; ride.done = false; ride._init = false;
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
  hud.arrive(null); hud.driving(false);
  state = "back"; orbit.enabled = false;
  flyTo({
    dur: 3.4, to: () => ({ p: new THREE.Vector3(6100, 4700, 8300), look: tableTarget }), lift: 1500, mid: 0.35,
    onMid: () => { hud.flash(); setEnv("table"); },
    done: () => { state = "table"; orbit.enabled = true; tableView(true); hud.intro(true); },
  });
}

function arrive() {
  state = "arrive"; hud.driving(false);
  const fwd = new THREE.Vector3(-Math.sin(jeep.root.rotation.y), 0, -Math.cos(jeep.root.rotation.y));
  const j = jeep.root.position.clone();
  const axis = new THREE.Vector3(lb.x1 - lb.x0, 0, lb.z1 - lb.z0).normalize();
  // end high above the track you came up, looking up the valley over the lake
  const back = path.at(Math.max(path.length - 750, 0));
  const overlook = new THREE.Vector3(back.x, back.y + 340, back.z);
  if (axis.dot(fwd) < 0) axis.negate();
  const pts = [
    camera.position.clone(),
    j.clone().addScaledVector(fwd, 6).add(new THREE.Vector3(0, 7, 0)),
    lakeC.clone().addScaledVector(axis, -260).setY(9),
    lakeC.clone().addScaledVector(axis, 40).setY(6),
    lakeC.clone().addScaledVector(axis, 320).add(new THREE.Vector3(-axis.z * 260, 140, axis.x * 260)),
    lakeC.clone().addScaledVector(axis, -150).add(new THREE.Vector3(-axis.z * 420, 300, axis.x * 420)),
    overlook,
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const looks = new THREE.CatmullRomCurve3([j.clone().setY(j.y + 1), lakeC.clone().addScaledVector(axis, -120), lakeC.clone().addScaledVector(axis, 200),
    lakeC.clone().addScaledVector(axis, 420), lakeC.clone().addScaledVector(axis, 200), lakeC.clone(), lakeC.clone()], false, "centripetal");
  fly = { t: 0, dur: 15, curve, looks, done: () => {
    state = "explore"; orbit.enabled = true; orbit.target.copy(lakeC);
    orbit.minDistance = 40; orbit.maxDistance = 9000; orbit.maxPolarAngle = 1.52; orbit.autoRotate = true; orbit.autoRotateSpeed = 0.25;
  } };
  setTimeout(() => hud.arrive(F), 1800);
}

// ---- drive camera
const camP = new THREE.Vector3(), camL = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3();
function chasePose(k) {
  const r = jeep.root, fwd = new THREE.Vector3(-Math.sin(r.rotation.y), 0, -Math.cos(r.rotation.y));
  const p = r.position.clone().addScaledVector(fwd, -9.5 * k).add(new THREE.Vector3(0, 3.8, 0));
  p.y = Math.max(p.y, site.heightAt(p.x, p.z) + 1.6);
  return { p, look: r.position.clone().addScaledVector(fwd, 5).add(new THREE.Vector3(0, 1.3, 0)) };
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
  const fov = 50 + ride.v * 0.6;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 2); camera.updateProjectionMatrix(); }
}

// ---- loop
function frameView() {             // keep the model clear of the side card on wide screens
  const w = innerWidth, h = innerHeight, side = w > 900 && (state === "table" || state === "explore");
  if (side) camera.setViewOffset(w, h, -Math.min(w * 0.17, 300), 0, w, h); else camera.clearViewOffset();
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

  if (state === "drive" || state === "arrive" || state === "dive") {
    const kb = (k) => keys.has(k);
    const driving = state === "drive";
    let throttle = driving ? (kb("w") || kb("arrowup") ? 1 : input.throttle) : 0;
    let brake = driving ? (kb("s") || kb("arrowdown") ? 1 : input.brake) : 1;
    const steer = driving ? (kb("d") || kb("arrowright") ? 1 : 0) - (kb("a") || kb("arrowleft") ? 1 : 0) || input.steer : 0;
    if (driving && input.cruise && !throttle && !brake) { throttle = Math.min(Math.max((6.2 - ride.v) * 0.7, 0), 1); brake = ride.v > 7.5 ? 0.3 : 0; }
    if (state === "dive") { throttle = 0; brake = 0; }
    const reps = driving ? pace : 1;                // time-lapse: the same physics, stepped more often
    for (let i = 0; i < reps; i++) ride.update(dt, { throttle, brake, steer });
    const dHV = Math.abs(ride.heaveV - lastHV); lastHV = ride.heaveV;
    if (dHV > 0.35) sound.knock(dHV * 0.8);
    if (ride.v > 0.6) for (const c of ride.rearContacts(contacts)) dust.emit(c, ride.v, Math.random() < ride.v * dt * 7 ? 1 : 0);
    sound.update(dt, { engine: 1, speed: Math.max(ride.v, 0), throttle, rough: Math.min(ride.jolt * 2, 1), wind: 0.4,
      water: Math.max(0, 1 - camera.position.distanceTo(lakeC) / 700) });
    hud.update(ride, Y0, path.length);
    if (driving) {
      driveCamera(dt);
      if (ride.done) arrive();
    }
  } else {
    sound.update(dt, { engine: 0, speed: 0, throttle: 0, rough: 0, wind: env === "real" ? 0.6 : 0.15,
      water: env === "real" ? Math.max(0, 1 - camera.position.distanceTo(lakeC) / 900) : 0 });
  }
  dust.update(dt, wind);

  if (fly) {
    fly.t += dt / fly.dur;
    const t = Math.min(fly.t, 1), e = ease(t);
    if (fly.curve) {
      camera.position.copy(fly.curve.getPoint(e));
      camera.lookAt(fly.looks.getPoint(Math.min(e * 1.05, 1)));
    } else {
      const goal = fly.to();
      const p = fly.p0.clone().lerp(goal.p, e);
      p.y += Math.sin(Math.PI * e) * (fly.lift || 0) * (1 - e);
      camera.position.copy(p);
      camera.lookAt(fly.l0.clone().lerp(goal.look, ease(Math.min(t * 1.3, 1))));
      camP.copy(p); camL.copy(goal.look);
    }
    if (fly.mid >= 0 && t >= fly.mid && !fly.midDone) { fly.midDone = true; fly.onMid?.(); }
    if (t >= 1) { const f = fly; fly = null; f.done?.(); }
  } else if (orbit.enabled) {
    orbit.update();
    if (env === "real") {
      const g = site.heightAt(camera.position.x, camera.position.z) + 8;
      if (camera.position.y < g) camera.position.y = g;
    }
  }

  // light rig follows what you look at
  if (env === "table") sky.frame(tmpV.set(0, 600, 0), 4200, shadowHi);
  else if (state === "drive" || state === "dive" && fly?.t > 0.6) sky.frame(jeep.root.position, 110, tier === "high" ? 2048 : 1024);
  else sky.frame(orbit.target.clone(), Math.min(3200, Math.max(400, camera.position.distanceTo(orbit.target) * 1.6)), shadowHi);
  sky.dome.position.copy(camera.position);
  sky.dome.scale.setScalar(60000);
  jeep.beam.intensity = sky.night > 0.3 ? 40 : 0;
  jeep.lamp.emissiveIntensity = sky.night > 0.3 ? 3 : 0.3;
  plants.visible = true;

  hud.placeLabels(camera, innerWidth, innerHeight, state === "table" || state === "explore" || state === "back");
}
let paused = false;
function frame() {
  if (!paused) { tick(Math.min(clock.getDelta(), 0.05)); renderer.render(scene, camera); }
  requestAnimationFrame(frame);
}
hud.loading(null);
// ?drive=1 (from the Atlas "Drive there" button) starts the drive straight away; sound waits for the first gesture
if (qs.get("drive") === "1") startDrive(); else hud.intro(true);
addEventListener("pointerdown", () => sound.ctx?.resume?.(), { once: true });
addEventListener("keydown", () => sound.ctx?.resume?.(), { once: true });
requestAnimationFrame(frame);
// test hook: advance the simulation by fixed steps without drawing (software GL runs at under 1 fps)
window.__diorama = { site, path, ride, camera, scene, keys, input, renderer, state: () => state, start: startDrive,
  advance(seconds, hold = []) { paused = true; hold.forEach((k) => keys.add(k)); for (let t = 0; t < seconds; t += 1 / 30) tick(1 / 30);
    hold.forEach((k) => keys.delete(k)); renderer.render(scene, camera); clock.getDelta(); return { s: ride.s, v: ride.v, state, lat: ride.lat }; },
  resume() { paused = false; clock.getDelta(); } };
