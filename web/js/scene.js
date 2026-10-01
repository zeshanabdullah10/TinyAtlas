import * as THREE from "three";
import { BASE } from "./api.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { h, kindIcon, clamp, reducedMotion } from "./dom.js";
import { makeModel, selectionRing } from "./models.js";
import { LightMap, terrainMaterial, sunDir, sunColors } from "./light.js";

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const smooth = (t) => t * t * (3 - 2 * t);

/** Canvas textures for the plinth and the strata skirt (generated, so there is nothing to download). */
function woodTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#7a5a3a"; g.fillRect(0, 0, 512, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const y = rnd() * 512, a = 0.05 + rnd() * 0.16;
    g.strokeStyle = rnd() > 0.5 ? `rgba(40,24,10,${a})` : `rgba(210,170,120,${a * 0.8})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 64) g.lineTo(x, y + Math.sin(x * 0.02 + i) * (1 + rnd() * 3));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function strataTexture() {
  const c = document.createElement("canvas"); c.width = 8; c.height = 128;
  const g = c.getContext("2d");
  const bands = [["#efe6cf", 20], ["#d9c79c", 14], ["#f3ecd8", 10], ["#c19f62", 18], ["#e2d3ad", 12], ["#8f7147", 6], ["#d3bd8c", 16], ["#6b553a", 3], ["#e9dfc3", 29]];
  let y = 0; for (const [col, hgt] of bands) { g.fillStyle = col; g.fillRect(0, y, 8, hgt); y += hgt; }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  return t;
}
function shadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, "rgba(20,28,25,.55)"); grad.addColorStop(0.55, "rgba(20,28,25,.22)"); grad.addColorStop(1, "rgba(20,28,25,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Diorama {
  /**
   * @param {HTMLElement} container element that will hold the canvas and the label layer
   * @param {{terrain: ArrayBuffer, texture: THREE.Texture|null, landmarks: object[], itinerary: object}} data
   */
  constructor(container, data, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.landmarks = data.landmarks;
    this.viewFrom = data.viewFrom ?? 180;
    this.exag = 0.42;              // compressed relief: the map reads flat, like an illustrated atlas
    this.place = 2.3;              // places are the heroes: landmarks are drawn far larger than life
    this.rise = 0;                 // 0..1: terrain rising out of the plinth on entry
    this.reveal = 0;               // 0..1: landmarks and route appearing after the rise
    this.selected = null;
    this.labelsOn = true;
    this.routeOn = true;
    this.occluders = [];           // screen rects of UI panels; labels under them are hidden
    this.manual = false;           // an external driver (video export) owns the camera
    this.fly = null;               // {t0, dur}
    this.focusTween = null;
    this.viewTween = null;

    const dv = new DataView(data.terrain);
    this.rows = dv.getUint32(0, true); this.cols = dv.getUint32(4, true);
    this.widthM = dv.getFloat32(8, true); this.heightM = dv.getFloat32(12, true);
    this.hm = new Float32Array(data.terrain, 16, this.rows * this.cols);
    this.min = Infinity; this.max = -Infinity;
    for (const v of this.hm) { if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
    this.S = this.widthM * 0.008;  // one landmark "unit" in metres

    this.initRenderer();
    this.buildTerrain(data.texture);
    this.buildBase();
    this.buildMarkers();
    this.buildRoute(data.itinerary);
    this.buildTags();
    this.buildCameraPath();
    this.applyHeights();
    this.home = this.homePose();
    this.placeCamera(this.home.pos, this.home.target);
    this.attachEvents();
    this.startIntro();
    this.renderer.setAnimationLoop((now) => this.tick(now));
  }

  /* ---------------- setup ---------------- */
  initRenderer() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    this.container.append(r.domElement);
    r.domElement.tabIndex = 0;
    r.domElement.setAttribute("aria-label", "3D miniature. Drag to turn, scroll to zoom, arrow keys to move.");
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, this.S * 4, this.widthM * 12);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, minDistance: this.S * 12, maxDistance: this.widthM * 3.2,
      maxPolarAngle: 1.42, screenSpacePanning: false, zoomSpeed: 0.9, rotateSpeed: 0.7 });
    this.controls.listenToKeyEvents(r.domElement);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa89c88, 1.05);
    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.9);
    this.studioSun = new THREE.Vector3(-this.widthM, this.widthM * 1.2, this.heightM * 0.7);
    this.sunLight.position.copy(this.studioSun);
    this.scene.add(this.hemi, this.sunLight);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || innerWidth, hh = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, hh, false);
    this.camera.aspect = w / hh;
    if (this.viewShift || this.viewShiftY) this.camera.setViewOffset(w, hh, this.viewShift || 0, this.viewShiftY || 0, w, hh); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.size = { w, h: hh };
  }

  buildTerrain(texture) {
    const geo = this.terrainGeo = new THREE.PlaneGeometry(this.widthM, this.heightM, this.cols - 1, this.rows - 1);
    geo.rotateX(-Math.PI / 2);                                  // row 0 = north = -z
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }
    this.lightMap = new LightMap(this.hm, this.rows, this.cols, this.widthM, this.heightM);
    this.terrain = new THREE.Mesh(geo, terrainMaterial(texture, this.lightMap));
    this.scene.add(this.terrain);
  }

  buildBase() {
    const S = this.S, W = this.widthM, D = this.heightM;
    this.depth = S * 3;
    const strata = strataTexture(), wood = woodTexture();
    strata.repeat.set(1, 1);
    // unlit like the terrain (the wall geometry carries no normals), tinted a little to sit in shade
    this.skirtMat = new THREE.MeshBasicMaterial({ map: strata, color: 0xd9d6cc, side: THREE.DoubleSide });
    // four walls; each keeps the indices of its terrain edge so the wall follows the relief
    const idx = (r, c) => r * this.cols + c;
    const edge = (n, at) => Array.from({ length: n }, (_, i) => at(i));
    this.walls = [
      { ids: edge(this.cols, (c) => idx(0, c)), a: [-W / 2, -D / 2], b: [W / 2, -D / 2] },                      // north
      { ids: edge(this.cols, (c) => idx(this.rows - 1, c)), a: [-W / 2, D / 2], b: [W / 2, D / 2] },            // south
      { ids: edge(this.rows, (r) => idx(r, 0)), a: [-W / 2, -D / 2], b: [-W / 2, D / 2] },                      // west
      { ids: edge(this.rows, (r) => idx(r, this.cols - 1)), a: [W / 2, -D / 2], b: [W / 2, D / 2] },            // east
    ].map((w) => {
      const n = w.ids.length, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
      const index = [];
      for (let i = 0; i < n - 1; i++) { const t0 = i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3; index.push(t0, b0, t1, t1, b0, b1); }
      geo.setIndex(index);
      const mesh = new THREE.Mesh(geo, this.skirtMat);
      this.scene.add(mesh);
      return { ...w, geo, n };
    });
    // plinth: a walnut slab with a wider foot, and a soft shadow beneath
    wood.repeat.set(3, 1);
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.6 });
    const t1 = S * 2.2, t2 = S * 1.4, p1 = S * 1.3, p2 = S * 3.4;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * p1, t1, D + 2 * p1), woodMat);
    slab.position.y = -this.depth - t1 / 2;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * p2, t2, D + 2 * p2), woodMat);
    foot.position.y = -this.depth - t1 - t2 / 2;
    const y0 = -this.depth - t1 - t2 - S * 0.02;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry((W + 2 * p2) * 1.5, (D + 2 * p2) * 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = y0;
    this.scene.add(slab, foot, shadow);
    this.baseBottom = y0;
  }

  buildMarkers() {
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    const BUILT = new Set(["fort", "temple", "bridge", "museum", "tower", "ruins", "monument", "town", "rail"]);
    this.builtKinds = BUILT;
    this.ring = selectionRing(this.S * 1.8);
    this.ring.visible = false;
    for (const lm of this.landmarks) {
      const holder = new THREE.Group();
      holder.userData.lm = lm;
      holder.add(makeModel(lm.kind, BUILT.has(lm.kind) ? this.S * this.place : this.S));
      holder.scale.setScalar(0.001);
      this.markers.add(holder);
      if (lm.model) this.loadModel(holder, lm);
    }
    this.scene.add(this.ring);
  }

  /** Swap the procedural model for web/models/<slug>.glb: a plaster maquette of the same size, sitting on the ground. */
  async loadModel(holder, lm) {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(`${BASE}models/${lm.slug}.glb`);
      const obj = gltf.scene;
      const plaster = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
      obj.traverse((o) => {                            // generated meshes come without normals: light needs them
        if (o.isMesh) { o.geometry.computeVertexNormals(); o.material = plaster; o.castShadow = false; }
      });
      const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
      const k = (this.S * 4.5 * this.place) / Math.max(size.y, Math.max(size.x, size.z) * 0.7, 1e-6);   // like the other models
      obj.scale.setScalar(k);
      box.setFromObject(obj);
      obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      holder.clear(); holder.add(obj);
    } catch { /* keep the procedural model */ }
  }

  /** Replace the drawn route (a planned day, or back to the place's tour). */
  setItinerary(itin) {
    this.stopFly(true);
    for (const m of [this.routeHalo, this.routeDots, this.traveler]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
    this.routeHalo = this.routeDots = this.traveler = null;
    this.buildRoute(itin); this.buildCameraPath(); this.drapeRoute();
  }

  buildRoute(itin) {
    this.route = null;
    const line = itin?.route || [];
    if (line.length < 2) return;
    // Curve through the road polyline, resampled evenly. Heights are re-draped whenever the relief changes.
    const flat = line.map(([u, v]) => new THREE.Vector3((u - 0.5) * this.widthM, 0, (v - 0.5) * this.heightM));
    const curve = this.curve = new THREE.CatmullRomCurve3(flat, false, "centripetal");
    const N = 1400, pts = [];
    let dist = 0;
    for (let i = 0; i < N; i++) {
      const p = curve.getPointAt(i / (N - 1));
      if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      pts.push({ x: p.x, z: p.z, u: p.x / this.widthM + 0.5, v: p.z / this.heightM + 0.5, d: dist });
    }
    const raw = pts.map((p) => this.rawHeight(p.u, p.v));
    const sm = raw.map((_, i) => { let a = 0, n = 0; for (let k = -6; k <= 6; k++) { const j = clamp(i + k, 0, N - 1); a += raw[j]; n++; } return a / n; });
    let gain = 0; for (let i = 1; i < N; i++) if (sm[i] > sm[i - 1]) gain += sm[i] - sm[i - 1];
    pts.forEach((p, i) => { p.e = sm[i]; });
    this.route = { pts, total: dist, gain, min: Math.min(...sm), max: Math.max(...sm), stops: itin.stops || [] };
    // dots: a white halo under vermilion beads
    const mk = (color, size, order) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const m = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, depthWrite: false }));
      m.renderOrder = order; m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.routeHalo = mk(0xffffff, this.S * 0.62, 2);
    this.routeDots = mk(0xd2452b, this.S * 0.4, 3);
    this.traveler = new THREE.Mesh(new THREE.SphereGeometry(this.S * 0.55, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd2452b }));
    this.traveler.visible = false;
    this.scene.add(this.traveler);
    // where each itinerary stop falls along the route
    const at = (lm) => { let best = 0, bd = Infinity; pts.forEach((p, i) => { const d = (p.u - lm.u) ** 2 + (p.v - lm.v) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
    for (const s of this.route.stops) { const lm = this.landmarks.find((l) => l.slug === s.slug); if (lm) { s.index = at(lm); s.dist = pts[s.index].d; } }
  }

  buildTags() {
    this.tagLayer = h("div", { id: "tags" });
    this.container.append(this.tagLayer);
    this.tags = new Map();
    for (const lm of this.landmarks) {
      const btn = h("button", { type: "button", "aria-label": `${lm.name}. Open details`, onclick: () => this.handlers.onSelect?.(lm.slug) }, kindIcon(lm.kind), lm.name);
      const el = h("div", { class: "tag" }, btn);
      this.tagLayer.append(el);
      this.tags.set(lm.slug, { el, w: 0 });
    }
  }

  /* ---------------- terrain maths ---------------- */
  rawHeight(u, v) {
    const x = clamp(u, 0, 1) * (this.cols - 1), y = clamp(v, 0, 1) * (this.rows - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, this.cols - 1), y1 = Math.min(y0 + 1, this.rows - 1);
    const fx = x - x0, fy = y - y0, g = (r, c) => this.hm[r * this.cols + c];
    return (g(y0, x0) * (1 - fx) + g(y0, x1) * fx) * (1 - fy) + (g(y1, x0) * (1 - fx) + g(y1, x1) * fx) * fy;
  }
  get k() { return this.exag * this.rise; }
  heightAt(u, v) { return (this.rawHeight(u, v) - this.min) * this.k; }
  world(u, v, lift = 0) { return new THREE.Vector3((u - 0.5) * this.widthM, this.heightAt(u, v) + lift, (v - 0.5) * this.heightM); }
  groundAtXZ(x, z) { return this.heightAt(x / this.widthM + 0.5, z / this.heightM + 0.5); }

  /** Re-derive every height-dependent thing: terrain, skirt, landmarks, route. */
  applyHeights() {
    const pos = this.terrainGeo.attributes.position, k = this.k;
    for (let i = 0; i < pos.count; i++) pos.setY(i, (this.hm[i] - this.min) * k);
    pos.needsUpdate = true;
    const bandM = this.S;            // one strata cycle spans 5 x bandM of height
    for (const w of this.walls) {
      const p = w.geo.attributes.position, uv = w.geo.attributes.uv, n = w.n;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1), x = w.a[0] + (w.b[0] - w.a[0]) * f, z = w.a[1] + (w.b[1] - w.a[1]) * f;
        const top = (this.hm[w.ids[i]] - this.min) * k;
        p.setXYZ(i * 2, x, top, z); p.setXYZ(i * 2 + 1, x, -this.depth, z);
        uv.setXY(i * 2, f * len / (bandM * 8), top / (bandM * 5)); uv.setXY(i * 2 + 1, f * len / (bandM * 8), -this.depth / (bandM * 5));
      }
      p.needsUpdate = true; uv.needsUpdate = true;
    }
    this.layoutMarkers();
    this.drapeRoute();
  }

  layoutMarkers() {
    this.markers.children.forEach((hd, i) => {
      const lm = hd.userData.lm;
      hd.position.copy(this.world(lm.u, lm.v, 0));
      const local = clamp(this.reveal * (this.landmarks.length + 3) - i, 0, 1);      // staggered pop
      hd.scale.setScalar(Math.max(0.001, easeOutBack(local)) * (lm.slug === this.selected ? 1.12 : 1));
      if (lm.slug === this.selected) this.ring.position.set(hd.position.x, hd.position.y, hd.position.z);
    });
  }

  drapeRoute() {
    if (!this.route) return;
    const { pts } = this.route, lift = this.S * 0.28;
    for (const m of [this.routeHalo, this.routeDots]) {
      const a = m.geometry.attributes.position;
      pts.forEach((p, i) => a.setXYZ(i, p.x, this.heightAt(p.u, p.v) + lift, p.z));
      a.needsUpdate = true;
      m.geometry.setDrawRange(0, Math.floor(pts.length * clamp(this.reveal * 1.6 - 0.5, 0, 1)));
      m.visible = this.routeOn;
    }
  }

  /** Light the miniature with the real sun at {az, alt} (degrees), or null for the studio light. Shadows are
   *  recomputed on the next frame, so dragging a time slider stays smooth. */
  setSun(sun) {
    const u = this.terrain.material.uniforms;
    this.sun = sun;
    if (!sun) {
      u.uReal.value = 0; this.sunLight.position.copy(this.studioSun); this.sunLight.color.set(0xfff1d6);
      this.sunLight.intensity = 1.9; this.hemi.intensity = 1.05; this.skirtMat.color.set(0xd9d6cc);
      return;
    }
    const dir = sunDir(sun.az, sun.alt), c = sunColors(sun.alt);
    u.uReal.value = 1; u.uSun.value.copy(dir); u.uDirect.value.copy(c.direct); u.uAmb.value.copy(c.amb);
    this.sunLight.position.copy(dir).multiplyScalar(this.widthM * 2);
    this.sunLight.color.copy(c.direct).multiplyScalar(1 / Math.max(0.05, Math.max(c.direct.r, c.direct.g, c.direct.b)));
    this.sunLight.intensity = 2.6 * Math.max(c.direct.r, c.direct.g, c.direct.b);
    this.hemi.intensity = 0.35 + 0.8 * c.day;
    this.skirtMat.color.copy(c.amb).multiplyScalar(1.6).add(c.direct.clone().multiplyScalar(0.5));
    this.shadowDue = true;
  }

  setTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const u = this.terrain.material.uniforms;
    u.map.value = texture; u.uHasMap.value = 1;
  }

  setExag(v) { this.exag = v; this.applyHeights(); }
  setLabels(on) { this.labelsOn = on; }
  setRoute(on) { this.routeOn = on; this.drapeRoute(); }

  /* ---------------- camera ---------------- */
  /** The opening view: from the compass bearing `viewFrom` (180 = standing south, looking north). */
  homePose() {
    const cy = (this.max - this.min) * this.exag * 0.32, b = (this.viewFrom * Math.PI) / 180;
    const d = Math.hypot(this.widthM * Math.sin(b), this.heightM * Math.cos(b)) * 0.92;
    return { target: new THREE.Vector3(0, cy, 0), pos: new THREE.Vector3(Math.sin(b) * d, this.widthM * 0.56 + cy, -Math.cos(b) * d) };
  }
  placeCamera(pos, target) { this.camera.position.copy(pos); this.controls.target.copy(target); this.camera.lookAt(target); this.controls.update(); }

  tween(pos, target, ms = 900) {
    if (reducedMotion()) { this.placeCamera(pos, target); return; }
    this.focusTween = { t0: performance.now(), ms, fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), toP: pos.clone(), toT: target.clone() };
  }
  /** A marker for a live position on the map (blue dot with a soft ring), or null to hide it. */
  setMe(u, v) {
    if (!this.me) {
      this.me = new THREE.Group();
      this.me.add(new THREE.Mesh(new THREE.SphereGeometry(this.S * 0.7, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2f7fd0 })));
      const ring = new THREE.Mesh(new THREE.RingGeometry(this.S * 1.2, this.S * 1.6, 32), new THREE.MeshBasicMaterial({ color: 0x2f7fd0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; this.me.add(ring);
      this.scene.add(this.me);
    }
    this.me.visible = u != null;
    if (u != null) this.me.position.copy(this.world(u, v, this.S * 0.8));
  }

  /** Fly to just above the ground at (u, v), looking along compass `heading` (degrees). */
  lookFrom(u, v, heading) {
    this.stopFly(true);
    const a = (heading * Math.PI) / 180, p = this.world(u, v, this.S * 14);
    const t = p.clone().add(new THREE.Vector3(Math.sin(a) * this.widthM * 0.22, -this.S * 6, -Math.cos(a) * this.widthM * 0.22));
    this.tween(p, t, 1500);
  }
  resetView() { this.stopFly(); this.tween(this.homePose().pos, this.homePose().target, 1000); }
  northUp() { const t = this.controls.target, off = this.camera.position.clone().sub(t); const d = Math.hypot(off.x, off.z); this.tween(new THREE.Vector3(t.x, this.camera.position.y, t.z + d), t.clone(), 600); }

  select(slug, { focus = true } = {}) {
    this.selected = slug;
    const hd = this.markers.children.find((m) => m.userData.lm.slug === slug);
    this.ring.visible = !!hd;
    for (const [s, t] of this.tags) t.el.classList.toggle("sel", s === slug);
    this.layoutMarkers();
    if (hd && focus) {
      const off = this.camera.position.clone().sub(this.controls.target).normalize();
      const dist = clamp(this.S * 64, this.controls.minDistance * 1.2, this.widthM);
      const target = hd.position.clone().add(new THREE.Vector3(0, this.S * 1.5, 0));
      this.tween(target.clone().addScaledVector(off, dist), target, 1000);
    }
  }

  /* ---------------- intro ---------------- */
  startIntro() {
    if (reducedMotion()) { this.rise = 1; this.reveal = 1; this.applyHeights(); return; }
    this.introT0 = performance.now();
    this.rise = 0.001;
    const from = this.home.pos.clone().multiplyScalar(1.35).add(new THREE.Vector3(this.widthM * 0.25, this.widthM * 0.1, 0));
    this.introFrom = from;
  }
  finishIntro() { this.introT0 = null; this.rise = 1; this.reveal = 1; this.applyHeights(); }

  /* ---------------- flyover ---------------- */
  buildCameraPath() {
    this.camPath = null;
    if (!this.route) return;
    const S = this.S, pts = this.route.pts, M = 600;
    const at = (t) => pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
    const camP = [];
    let dir = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < M; i++) {
      const t = i / (M - 1), p = at(t), a = at(Math.min(t + 0.04, 1));
      const d = new THREE.Vector3(a.x - p.x, 0, a.z - p.z);
      if (d.lengthSq() > 1e-6) dir = d.normalize().clone();
      const cx = p.x - dir.x * S * 30, cz = p.z - dir.z * S * 30;
      camP.push({ cx, cz, ax: a.x, az: a.z, pu: p.u, pv: p.v, au: a.u, av: a.v });
    }
    this.camSeed = camP;
    this.rebuildCameraHeights();
  }
  /** Heights depend on the current exaggeration, so recompute them when a flight starts. */
  rebuildCameraHeights() {
    if (!this.camSeed) return;
    const S = this.S, M = this.camSeed.length, ground = (x, z) => this.heightAt(x / this.widthM + 0.5, z / this.heightM + 0.5);
    const rawY = [], lookY = [];
    for (const s of this.camSeed) {
      const ly = ground(s.ax, s.az) + S * 2;
      let y = Math.max(ground(s.cx + (s.ax - s.cx) * 0.98, s.cz + (s.az - s.cz) * 0.98) + S * 10, ground(s.cx, s.cz) + S * 6,
        ly + Math.hypot(s.ax - s.cx, s.az - s.cz) * 0.53);                       // at least ~28 degrees of downward pitch
      for (let k = 1; k <= 12; k++) {                                            // line of sight must clear the ground
        const f = k / 13, gy = ground(s.cx + (s.ax - s.cx) * f, s.cz + (s.az - s.cz) * f) + S * 3;
        y = Math.max(y, (gy - f * ly) / (1 - f));
      }
      rawY.push(y); lookY.push(ly);
    }
    const maxF = (a, r) => a.map((_, i) => Math.max(...a.slice(Math.max(0, i - r), i + r + 1)));
    const blur = (a, sg) => { const r = Math.ceil(sg * 3), w = []; for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sg * sg)));
      return a.map((_, i) => { let s = 0, ws = 0; for (let k = -r; k <= r; k++) { const j = clamp(i + k, 0, M - 1); s += a[j] * w[k + r]; ws += w[k + r]; } return s / ws; }); };
    const ys = blur(maxF(rawY, 14), 8);
    const cxs = blur(this.camSeed.map((s) => s.cx), 8), czs = blur(this.camSeed.map((s) => s.cz), 8);
    const lxs = blur(this.camSeed.map((s) => s.ax), 6), lys = blur(lookY, 6), lzs = blur(this.camSeed.map((s) => s.az), 6);
    this.camPath = { cam: cxs.map((x, i) => new THREE.Vector3(x, ys[i], czs[i])), look: lxs.map((x, i) => new THREE.Vector3(x, lys[i], lzs[i])) };
  }
  flyPose(t) {
    if (!this.camPath) return null;
    const P = this.camPath, f = smooth(clamp(t, 0, 1)) * (P.cam.length - 1), i = Math.min(Math.floor(f), P.cam.length - 2), a = f - i;
    return { cam: P.cam[i].clone().lerp(P.cam[i + 1], a), look: P.look[i].clone().lerp(P.look[i + 1], a), s: smooth(clamp(t, 0, 1)) };
  }
  /** Seconds a flight takes: about 25 s per 50 km, within sensible bounds. */
  flyDuration() { return this.route ? clamp((this.route.total / 1000) * 0.5, 14, 40) : 0; }
  startFly() {
    if (!this.route || this.fly) return false;
    this.rebuildCameraHeights();
    this.focusTween = null;
    this.fly = { t0: performance.now(), dur: this.flyDuration() * 1000 };
    this.controls.enabled = false;
    this.traveler.visible = true;
    this.handlers.onFly?.({ state: "start", t: 0 });
    return true;
  }
  stopFly(silent = false) {
    if (!this.fly) return;
    this.fly = null; this.controls.enabled = true; this.traveler.visible = false;
    if (!silent) this.handlers.onFly?.({ state: "stop", t: 0 });
    this.tween(this.homePose().pos, this.homePose().target, 1100);
  }
  /** Deterministic single frame at t in [0, 1] for the video export: freezes the interactive loop. */
  renderFrame(t) {
    this.manual = true;
    if (this.shadowDue && this.sun) { this.shadowDue = false; this.lightMap.shade(this.sun.az, this.sun.alt); }
    if (this.introT0) this.finishIntro();
    if (!this.camPath) this.rebuildCameraHeights();
    const f = this.flyPose(t); if (!f) return;
    this.camera.position.copy(f.cam); this.camera.lookAt(f.look);
    this.moveTraveler(f.s);
    this.updateTags();
    this.renderer.render(this.scene, this.camera);
  }
  moveTraveler(s) {
    if (!this.route) return;
    const p = this.route.pts[Math.round(clamp(s, 0, 1) * (this.route.pts.length - 1))];
    this.traveler.position.set(p.x, this.heightAt(p.u, p.v) + this.S * 0.7, p.z);
  }
  scrub(fraction) {                     // hover on the elevation profile
    if (fraction == null) { if (!this.fly) this.traveler.visible = false; return null; }
    this.traveler.visible = true; this.moveTraveler(fraction);
    return this.route.pts[Math.round(clamp(fraction, 0, 1) * (this.route.pts.length - 1))];
  }

  /* ---------------- events ---------------- */
  attachEvents() {
    const el = this.renderer.domElement;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; this.interrupt(); });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      if (this.onGround) {                              // "stand here" mode: the next tap on the relief is a place
        const g = this.pickGround(e);
        if (g) { const f = this.onGround; this.onGround = null; el.style.cursor = ""; f(g); }
        return;
      }
      const lm = this.pick(e);
      if (lm) this.handlers.onSelect?.(lm.slug); else this.handlers.onSelect?.(null);
    });
    el.addEventListener("pointermove", (e) => { if (e.buttons === 0) el.style.cursor = this.onGround ? "crosshair" : this.pick(e) ? "pointer" : ""; });
    el.addEventListener("wheel", () => this.interrupt(), { passive: true });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
  }
  interrupt() {
    this.focusTween = null;
    if (this.introT0) this.finishIntro();
    this.handlers.onInteract?.();
  }
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObjects(this.markers.children, true)[0];
    if (!hit) return null;
    let o = hit.object; while (o && !o.userData.lm) o = o.parent;
    return o?.userData.lm || null;
  }
  /** {u, v} (0..1, east / south) of the relief under the pointer, or null. */
  pickGround(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.intersectObject(this.terrain, false)[0];
    return hit ? { u: hit.point.x / this.widthM + 0.5, v: hit.point.z / this.heightM + 0.5 } : null;
  }
  project(slug) {
    const hd = this.markers.children.find((m) => m.userData.lm.slug === slug); if (!hd) return null;
    const v = hd.position.clone().add(new THREE.Vector3(0, this.S * 1.5, 0)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  /* ---------------- per-frame ---------------- */
  hidden(x, y, z) {          // is the point behind the relief as seen from the camera? (heightfield ray march)
    const c = this.camera.position, n = 22;
    for (let k = 1; k < n; k++) {
      const f = k / n, px = c.x + (x - c.x) * f, py = c.y + (y - c.y) * f, pz = c.z + (z - c.z) * f;
      if (this.groundAtXZ(px, pz) > py + this.S * 0.5) return true;
    }
    return false;
  }
  updateTags() {
    if (!this.tags) return;
    const { w, h: hh } = this.size, placed = [];
    const up = (lm) => new THREE.Vector3(0, this.S * 5.8 * (this.builtKinds?.has(lm.kind) ? this.place : 1), 0);
    const order = [...this.markers.children].sort((a, b) => (b.userData.lm.slug === this.selected) - (a.userData.lm.slug === this.selected));
    for (const hd of order) {
      const lm = hd.userData.lm, tag = this.tags.get(lm.slug), p = hd.position.clone().add(up(lm));
      const v = p.clone().project(this.camera);
      let show = this.labelsOn && this.reveal > 0.85 && v.z < 1 && Math.abs(v.x) < 1.02 && v.y > -1 && v.y < 1.02 && !this.hidden(p.x, p.y, p.z);
      const sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * hh;
      if (!tag.w) tag.w = tag.el.offsetWidth || 120;
      if (show) {                                                      // declutter: skip a label that would overlap one already placed
        const box = [sx - tag.w / 2, sy - 48, sx + tag.w / 2, sy];
        if (box[0] < 4 || box[2] > w - 4 || box[1] < 4) show = false;               // never a half-cut label at the screen edge
        else if (this.occluders.some((r) => box[0] < r.right && box[2] > r.left && box[1] < r.bottom && box[3] > r.top)) show = false;
        else if (lm.slug !== this.selected && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) show = false;
        else placed.push(box);
      }
      tag.el.classList.toggle("on", show);
      if (show) tag.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  tick(now) {
    if (this.shadowDue && this.sun) { this.shadowDue = false; this.lightMap.shade(this.sun.az, this.sun.alt); }
    if (this.manual) return;
    // entry: the relief rises out of the plinth while the camera settles, then landmarks pop and the route draws
    if (this.introT0) {
      const t = (now - this.introT0) / 2400;
      this.rise = Math.max(0.001, easeOut(clamp(t / 0.62, 0, 1)));
      this.reveal = clamp((t - 0.5) / 0.5, 0, 1);
      const c = easeOut(clamp(t / 0.9, 0, 1));
      this.placeCamera(this.introFrom.clone().lerp(this.home.pos, c), this.home.target);
      this.applyHeights();
      if (t >= 1) this.finishIntro();
    } else if (this.fly) {
      const t = (now - this.fly.t0) / this.fly.dur;
      if (t >= 1) { this.stopFly(); }
      else {
        const f = this.flyPose(t);
        this.camera.position.copy(f.cam); this.camera.lookAt(f.look);
        this.moveTraveler(f.s);
        this.handlers.onFly?.({ state: "run", t, s: f.s });
      }
    } else {
      if (this.focusTween) {
        const f = this.focusTween, t = clamp((now - f.t0) / f.ms, 0, 1), e = smooth(t);
        this.camera.position.lerpVectors(f.fromP, f.toP, e); this.controls.target.lerpVectors(f.fromT, f.toT, e);
        if (t >= 1) this.focusTween = null;
      }
      this.controls.update();
      const c = this.camera.position, g = this.groundAtXZ(c.x, c.z) + this.S * 4;      // never go under the relief
      if (c.y < g) c.y = g;
      const t = this.controls.target, lim = this.widthM * 0.55;
      t.x = clamp(t.x, -lim, lim); t.z = clamp(t.z, -this.heightM * 0.55, this.heightM * 0.55);
    }
    this.renderer.render(this.scene, this.camera);
    this.updateTags();
    this.handlers.onFrame?.(this.controls.getAzimuthalAngle());
  }

  /** A PNG of the current view with a title band and the required attribution. */
  snapshot(title) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement, band = Math.round(src.height * 0.09);
    const c = document.createElement("canvas"); c.width = src.width; c.height = src.height + band;
    const g = c.getContext("2d");
    g.fillStyle = "#dcdfd6"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    g.fillStyle = "#2c3733"; g.textBaseline = "middle";
    g.font = `500 ${Math.round(band * 0.46)}px "Schibsted Grotesk", system-ui, sans-serif`;
    g.fillText(title, band * 0.5, src.height + band * 0.4);
    g.font = `400 ${Math.round(band * 0.19)}px "Schibsted Grotesk", system-ui, sans-serif`; g.fillStyle = "#4d5a55";
    g.fillText("Elevation: Mapzen/AWS Terrain Tiles. Map data © OpenStreetMap contributors (ODbL). Text © Wikipedia/Wikivoyage contributors (CC BY-SA).", band * 0.5, src.height + band * 0.82);
    return c;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro?.disconnect();
    this.renderer.dispose();
  }
}
