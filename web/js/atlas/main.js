// Atlas map page: /atlas.html?pack=swat[&base=/packs/swat/atlas/][&tier=high|low][&fps=1][&t=0..1 sun time]
import * as THREE from "three";
import { loadPack } from "./pack.js";
import { buildGrid, sweepShadow } from "./shade.js";
import { shared } from "./material.js";
import { Terrain } from "./terrain.js";
import { Sky } from "./sky.js";
import { Trees } from "./trees.js";
import { Water } from "./water.js";
import { Roads } from "./roads.js";
import { Landmarks } from "./landmarks.js";
import { Labels } from "./labels.js";
import { Panel } from "./panel.js";
import { MapControls } from "./controls.js";
import { buildUI, makeAreas } from "./ui.js";
import { disposeScene } from "./dispose.js";

const qs = new URLSearchParams(location.search);
const forced = qs.get("tier");
const root = document.getElementById("app"), canvas = document.getElementById("gl"), labelLayer = document.getElementById("labels");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = qs.get("tm") === "agx" ? (THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping) : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function detectTier() {
  if (forced === "high" || forced === "low") return forced;
  const coarse = matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || renderer.capabilities.maxTextureSize < 8192;
  return coarse || weak ? "low" : "high";
}
let tier = detectTier();

/** Build one pack's map. Returns a handle whose dispose() frees every listener, DOM node and GPU resource it made. */
async function boot(slug, { base, time = null } = {}) {
  const ac = new AbortController(), signal = ac.signal;
  const keep = new Set([...root.children]);
  renderer.setPixelRatio(tier === "high" ? Math.min(devicePixelRatio || 1, 2) : 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 50, 600000);
  const loadingEl = document.createElement("div");
  loadingEl.className = "loading"; loadingEl.textContent = "Opening the map"; root.append(loadingEl);
  const pack = await loadPack(base || `/packs/${slug}/atlas/`, (f, t) => { loadingEl.textContent = `Loading ${t}`; }).catch((e) => {
    loadingEl.textContent = `Could not load the map pack (${e.message}).`; throw e;
  });
  loadingEl.remove();
  let ui = { setProgress() {}, exag() {} };

  // ---- height-derived lighting data
  const stride = tier === "high" ? 1 : 2;
  const grid = buildGrid(pack, stride);
  shared.uGrad.value = grid.grad;
  shared.uGridUV.value.set(1 / (pack.res * stride), 0.5 - 0.5 / stride, grid.w, grid.h);
  shared.uGridSize.value.set(pack.W, pack.H);
  shared.uExag.value = pack.exag; shared.uHmin.value = pack.hmin;
  shared.uDetail.value = tier === "high" ? 1 : 0;
  const shadowData = new Uint8Array(grid.w * grid.h);
  const shadowTex = new THREE.DataTexture(shadowData, grid.w, grid.h, THREE.RedFormat, THREE.UnsignedByteType);
  shadowTex.magFilter = shadowTex.minFilter = THREE.LinearFilter; shadowTex.flipY = false;
  shared.uShadow.value = shadowTex;

  const sky = new Sky(scene, pack, { tier });
  if (time != null) sky.setTime(time);
  const reshade = () => { sweepShadow(grid, sky.az, sky.el, pack.exag, shadowData); shadowTex.needsUpdate = true; };
  let reshadeT = 0;
  const reshadeSoon = () => { clearTimeout(reshadeT); reshadeT = setTimeout(reshade, 120); };
  reshade();

  const terrain = new Terrain(pack, scene, { tier, renderer });
  const water = new Water(pack, scene);
  const roads = new Roads(pack, scene);
  const trees = new Trees(pack, scene, { tier });
  const landmarks = new Landmarks(pack, scene, { tier });
  const controls = new MapControls(camera, canvas, pack);
  let sizeW = 1, sizeH = 1;
  const resize = () => {
    sizeW = root.clientWidth || innerWidth; sizeH = root.clientHeight || innerHeight;
    renderer.setSize(sizeW, sizeH, false); camera.aspect = sizeW / sizeH; camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize, { signal }); resize();

  const anchorOf = (pl) => [pl.anchor?.[0] ?? pl.x, pl.anchor?.[1] ?? pl.z];
  const panel = new Panel(root, pack, {
    signal, onClose: () => { labels.select(null); labels.block = null; },
    onFly: (pl) => { const [ax, az] = anchorOf(pl); controls.flyTo(new THREE.Vector3(ax, pack.groundY(ax, az), az), 2800, controls.heading, -28, 1800); },
  });
  const open = (pl, opener) => {
    labels.select(pl.slug); panel.open(pl, opener); labels.block = panel.rect();
    const [ax, az] = anchorOf(pl);
    controls.flyTo(new THREE.Vector3(ax, pack.groundY(ax, az), az), Math.min(controls.distance, 9000), controls.heading, controls.pitchDeg(), 1100);
  };
  const labels = new Labels(pack, labelLayer, { onPick: (pl) => open(pl, document.activeElement), anchorLift: (s) => landmarks.heightOf(s) });
  roads.setRoutes(false);
  labels.blockers = () => [...document.querySelectorAll(".topright .trow, .topright .light, .dock, .tools, .attrib, .cartouche h1, .cartouche .sub")]
    .map((e) => { const r = e.getBoundingClientRect(); return [r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]; });
  const settings = {
    time: sky.time, treeScale: trees.scale, landmarkScale: 1,
    onTime: (v) => { sky.setTime(v); reshadeSoon(); },
    onExag: (v, final) => {
      pack.setExag(v); terrain.rebuildY(false); ui.exag(v);
      if (final) { terrain.rebuildY(true); water.rebuild(); roads.rebuild(); trees.refresh(); labels.elevAnchor(); reshade(); }
    },
    onTrees: (v) => trees.setScale(v), onLandmarks: (v) => landmarks.setScale(v),
    onLabels: (on) => labels.setVisible(on), onRoutes: (on) => roads.setRoutes(on), onRoads: (on) => roads.setRoads(on),
    onTreesOn: (on) => { trees.visible = on; trees.group.visible = on; },
  };
  const neighbors = pack.meta.neighbors || [];
  ui = buildUI(root, {
    pack, controls, settings, tier, showFps: qs.get("fps") === "1", sky, openPlace: (pl) => open(pl, canvas),
    areas: makeAreas(pack, controls, () => ui.routes(true)), neighbors, onNeighbor: (s) => switchPack(s),
  });

  const steps = [["sky", sky.load()], ["overview", terrain.loadOverview()], ["landmarks", landmarks.load(() => labels.elevAnchor())]];
  let nDone = 0;
  await Promise.all(steps.map(([n, p]) => p.catch((e) => console.warn(n, e.message)).then(() => ui.setProgress(++nDone / steps.length, n))));

  trees.clearings = landmarks.items.map((i) => ({ x: i.place.x, z: i.place.z, r: Math.max(40, Math.min(260, i.foot * 8)) * 0.65 }));   // displayed footprint + 30 %

  // ---- picking: tap a landmark, double-click the ground
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const toNdc = (e) => ndc.set((e.offsetX / sizeW) * 2 - 1, -(e.offsetY / sizeH) * 2 + 1);
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { signal });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 450) return;
    toNdc(e); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(landmarks.meshes(), false)[0];
    if (hit) { const pl = pack.places.find((p) => p.slug === hit.object.userData.slug); if (pl) open(pl, canvas); }
  }, { signal });
  canvas.addEventListener("dblclick", (e) => { toNdc(e); const pt = controls.pick(ndc); if (pt) controls.flyToPoint(pt); }, { signal });

  // ---- adaptive quality: a few slow frames drop the high tier to low (unless the tier was forced)
  function applyTier(t) {
    tier = t; renderer.setPixelRatio(t === "high" ? Math.min(devicePixelRatio || 1, 2) : 1); resize();
    sky.setTier(t); terrain.tol = t === "high" ? 14 : 26; terrain.maxTileLevel = t === "high" ? pack.meta.albedo_levels - 1 : 2;
    trees.cap = t === "high" ? 120000 : 30000; trees.radius = t === "high" ? 12000 : 7000; shared.uDetail.value = t === "high" ? 1 : 0;
    ui.tier(t);
  }
  const probe = { n: 0, sum: 0, last: 0, done: !!forced || tier === "low" };
  const edgeNear = () => {                                       // within ~3 km of an edge shared with a neighbour
    const t = controls.target, m = 3000;
    for (const n of neighbors) {
      const near = { north: t.z < m, south: t.z > pack.H - m, west: t.x < m, east: t.x > pack.W - m }[n.edge];
      if (near) return n;
    }
    return null;
  };

  // ---- loop
  const fpsBox = { frames: 0, t: performance.now(), fps: 0 };
  let settled = 0, frameCount = 0;
  function frame(now) {
    shared.uTime.value = now / 1000;
    controls.update();
    camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    shared.uPx.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / sizeH;
    const dist = controls.distance;
    sky.updateHaze(dist); sky.update(controls.target, dist);
    terrain.update(camera, sizeH, frameCount < 2);
    trees.update(camera, terrain);
    landmarks.update(camera);
    labels.update(camera, sizeW, sizeH, dist, now);
    ui.compass(controls.heading);
    if (frameCount % 10 === 0) ui.edge(edgeNear());
    renderer.render(scene, camera);
    frameCount++;
    if (!probe.done && frameCount > 60) {
      if (probe.last) { probe.sum += now - probe.last; probe.n++; }
      probe.last = now;
      if (probe.n >= 40) { probe.done = true; if (probe.sum / probe.n > 50) applyTier("low"); }
    }
    if (!window.__ready) { settled = terrain.inflight === 0 && !terrain.queue.length ? settled + 1 : 0; if (settled > 15 && frameCount > 40) window.__ready = true; }
    fpsBox.frames++;
    if (now - fpsBox.t > 500) {
      fpsBox.fps = (fpsBox.frames * 1000) / (now - fpsBox.t); fpsBox.frames = 0; fpsBox.t = now;
      const i = renderer.info;
      ui.stats([`fps ${fpsBox.fps.toFixed(1)}  tier ${tier}`, `draw calls ${i.render.calls}`, `triangles ${(i.render.triangles / 1e6).toFixed(2)} M`,
        `trees ${trees.count.toLocaleString("en")} (${trees.draws} draws)`, `dist ${(dist / 1000).toFixed(1)} km  tiles ${terrain.stats.tilesLoaded}`].join("\n"));
    }
  }
  ui.done();
  renderer.setAnimationLoop(frame);

  const toScene = (e, n) => ({ x: e - pack.meta.origin_utm[0], z: pack.meta.origin_utm[1] - n });
  return {
    slug, pack, sky, controls, labels, landmarks, terrain, trees, roads, water, panel, ui, settings, scene, camera, toScene, renderer, THREE, shared,
    get time() { return sky.time; },
    info: () => ({
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, trees: trees.count, treeDraws: trees.draws, fps: fpsBox.fps, tier,
      terrainTris: terrain.stats.tris, tiles: terrain.stats.tilesLoaded, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    }),
    view({ x, z, e, n, heading = 5, pitch = -32, dist = 8000 }) {
      if (e != null) ({ x, z } = toScene(e, n));
      controls.tween = null; controls.pose(new THREE.Vector3(x, pack.groundY(x, z), z), heading, pitch, dist);
      window.__ready = false; settled = 0;
    },
    dispose() {
      renderer.setAnimationLoop(null); ac.abort(); clearTimeout(reshadeT);
      controls.dispose(); terrain.dispose(); disposeScene(scene, renderer);
      for (const el of [...root.children]) if (!keep.has(el)) el.remove();
      labelLayer.replaceChildren();
    },
  };
}

let current = null, busy = false;
async function switchPack(slug, { push = true } = {}) {
  if (busy || !slug || slug === current?.slug) return;
  busy = true;
  const time = current?.time ?? null;
  window.__ready = false;
  if (push) history.pushState({ slug }, "", `?pack=${slug}${forced ? `&tier=${forced}` : ""}${qs.get("fps") ? "&fps=1" : ""}${time != null ? `&t=${time.toFixed(3)}` : ""}`);
  current?.dispose();
  current = null;
  try { current = await boot(slug, { time }); window.__atlas = current; } finally { busy = false; }
}
addEventListener("popstate", () => switchPack(new URLSearchParams(location.search).get("pack") || "swat", { push: false }));

current = await boot(qs.get("pack") || "swat", { base: qs.get("base") || undefined, time: qs.get("t") != null ? +qs.get("t") : null });
window.__atlas = current;
window.__switch = (slug) => switchPack(slug);
