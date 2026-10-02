// Landmark maquettes (place.model GLBs) as fixed-size heroes: displayed footprint HERO_M (at least real size, at most
// CAP_M), shown inside 15 km with an opacity fade, standing on the lowest ground under the footprint.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { shared } from "./material.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const SHOW_KM = 15, CAP_M = 260, HERO_M = 110;

/** Soft warm contact shadow: a radial gradient disc laid on the ground under a model. */
function contactDisc() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, "rgba(52,30,12,.6)"); gr.addColorStop(0.55, "rgba(52,30,12,.3)"); gr.addColorStop(1, "rgba(52,30,12,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  m.renderOrder = 4; return m;
}

export class Landmarks {
  constructor(pack, scene, { tier = "high" } = {}) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.mult = 1;              // user multiplier on the hero factor
    this.items = [];            // {place, obj, height, foot}
    this.tier = tier;
    this.loader = new GLTFLoader();
  }

  async load(onDone) {
    const jobs = this.pack.places.filter((pl) => pl.model).map(async (pl) => {
      try {
        const gltf = await this.loader.loadAsync(this.pack.base + pl.model);
        const obj = new THREE.Group(); obj.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        gltf.scene.position.y = -Math.min(0, box.min.y);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = this.tier === "high"; o.receiveShadow = true;
          o.userData.slug = pl.slug;
          for (const m of [].concat(o.material)) { m.roughness = Math.max(m.roughness ?? 0.9, 0.8); m.metalness = 0; m.emissive?.set(0x4a2a12); m.emissiveIntensity = 0.45; }   // warm lift so they read on pale ground
        });
        obj.userData.slug = pl.slug; obj.visible = false;
        const disc = contactDisc(); disc.visible = false;
        this.group.add(obj, disc);
        this.items.push({ place: pl, obj, disc, height: box.max.y - Math.min(0, box.min.y), foot: Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1), k: null, d: 1e9 });
      } catch (e) { console.warn("landmark failed", pl.slug, e.message); }
    });
    await Promise.all(jobs);
    onDone?.();
  }

  /** Fixed hero scale (independent of the camera, so models never grow or shrink while zooming): the displayed
   *  footprint is HERO_M metres, at least real size, at most CAP_M; times the user multiplier. Placement on the lowest
   *  ground under the footprint is computed once per scale. */
  place(it) {
    const p = this.pack, x = it.place.x, z = it.place.z;
    it.k = Math.max(1, Math.min((HERO_M / it.foot) * this.mult, CAP_M / it.foot));
    const r = (it.foot * it.k) / 2;
    let lo = 1e9;
    for (const [u, v] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) lo = Math.min(lo, p.groundY(x + u * r, z + v * r));
    it.obj.position.set(x, lo - 0.5 - 0.1 * it.k, z);
    it.obj.scale.setScalar(it.k);
    it.disc.position.set(x, lo + 0.6, z); it.disc.scale.setScalar(Math.max(it.foot * it.k * 1.9, 1));
  }

  /** Per frame: only visibility. Beyond SHOW_KM the model is hidden; near the limit it fades by opacity, not size. */
  update(camera) {
    const p = this.pack, cp = camera.position;
    for (const it of this.items) {
      if (it.k == null || it.placedExag !== p.exag) { this.place(it); it.placedExag = p.exag; }
      const x = it.place.x, z = it.place.z;
      const d = Math.hypot(cp.x - x, cp.y - p.groundY(x, z), cp.z - z);
      it.d = d;
      const fade = 1 - smooth(SHOW_KM * 1000 * 0.85, SHOW_KM * 1000, d);
      it.obj.visible = fade > 0.01; it.disc.visible = it.obj.visible;
      if (!it.obj.visible || it.fade === fade) continue;
      it.fade = fade;
      const see = fade < 0.999;
      it.obj.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { m.transparent = see; m.opacity = fade; m.depthWrite = !see; } });
      it.disc.material.opacity = fade;
    }
  }

  setScale(m) { this.mult = m; for (const it of this.items) this.place(it); }
  /** Displayed height of a place's model (metres), 0 if none or hidden. Lifts its label. */
  heightOf(slug) { const it = this.items.find((i) => i.place.slug === slug); return it && it.obj.visible ? it.height * it.k : 0; }
  meshes() { const out = []; for (const i of this.items) if (i.obj.visible) i.obj.traverse((o) => o.isMesh && out.push(o)); return out; }
}
