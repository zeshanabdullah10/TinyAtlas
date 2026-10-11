// Landmark maquettes (place.model GLBs) as map markers. Displayed size follows the zoom: a target on-screen footprint
// (PX, times the "Landmark size" slider), but never below real size, never above MIN..mult × real, never wider than
// CAP_M, and never wider than NEIGH × the gap to the nearest other mapped place, so a hero-scaled model can not cover
// its neighbours (the ×20-fixed scale drew the 45 m Swat Museum as a ~900 m box over Saidu Sharif and Butkara).
// Shown inside 15 km with an opacity fade. On slopes the base is cut part-way into the hill and a stone terrace
// fills the downhill side, so nothing floats and the uphill side is never cut deeper than BURY of its height.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { shared } from "./material.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const SHOW_KM = 15, CAP_M = 300, MIN_MULT = 20;
const PX = 58, NEIGH = 0.55, BURY = 0.35, QK = Math.log(1.04);
const rad = (d) => (d * Math.PI) / 180;

/** Model yaw (radians about +y). The TRELLIS GLBs face +z (checked by rendering them from four sides), not −z as the
 *  pack contract says. Only orientations with a basis are set; everything else keeps the authored orientation. */
const YAW = {
  "swat-museum": () => rad(-108.7 + 90),                // long axis of the OSM building outlines on the site (108.7° from east)
  "jamia-masjid-thal": () => Math.PI - rad(78),          // entrance side away from the qibla (≈ 258° from Swat), facing ≈ 78°
  "white-palace-marghazar": (pl, p) => {                 // front to the valley floor (downhill; no published orientation)
    const gx = p.heightAt(pl.x + 30, pl.z) - p.heightAt(pl.x - 30, pl.z), gz = p.heightAt(pl.x, pl.z + 30) - p.heightAt(pl.x, pl.z - 30);
    return Math.atan2(-gx, -gz);
  },
};

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

const terraceMat = new THREE.MeshStandardMaterial({ color: 0xb59c78, roughness: 0.95, metalness: 0 });   // dry-stone terrace, warm ochre
// unit square frustum, top at y=0 (1 x 1), battered sides widening to 1.35 at y=-1
const terraceGeo = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.35, 1, 4, 1).rotateY(Math.PI / 4).translate(0, -0.5, 0);

export class Landmarks {
  constructor(pack, scene, { tier = "high" } = {}) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.mult = MIN_MULT;      // "Landmark size" slider: scales the target on-screen size and the multiplier ceiling
    this.items = [];            // {place, obj, height, foot, ...}
    this.tier = tier;
    this.loader = new GLTFLoader();
  }

  async load(onDone) {
    const p = this.pack, mapped = p.places.filter((q) => q.tier <= 2 || q.model);
    const jobs = p.places.filter((pl) => pl.model).map(async (pl) => {
      try {
        const gltf = await this.loader.loadAsync(p.base + pl.model);
        const obj = new THREE.Group(), inner = new THREE.Group(); inner.add(gltf.scene); obj.add(inner);
        inner.rotation.y = YAW[pl.slug]?.(pl, p) ?? 0;
        const box = new THREE.Box3().setFromObject(gltf.scene);
        gltf.scene.position.y = -Math.min(0, box.min.y);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = this.tier === "high"; o.receiveShadow = true;
          o.userData.slug = pl.slug;
          // Keep the baked texture readable at map scale without flattening it: clamp roughness into a matte band
          // (specular highlights survive, nothing goes mirror), drop TRELLIS's fake metalness (no env map → black),
          // warm the shadows just enough to lift the model off pale ground, and sharpen textures at grazing angles.
          for (const m of [].concat(o.material)) {
            m.roughness = Math.min(0.95, Math.max(m.roughness ?? 0.85, 0.55));
            m.metalness = 0;
            m.emissive?.set(0x4a2a12); m.emissiveIntensity = 0.18;
            for (const t of Object.values(m)) if (t?.isTexture) t.anisotropy = 8;
          }
        });
        const terrace = new THREE.Mesh(terraceGeo, terraceMat.clone()); terrace.visible = false;
        terrace.castShadow = this.tier === "high"; terrace.receiveShadow = true; terrace.userData.slug = pl.slug;
        obj.add(terrace);
        obj.userData.slug = pl.slug; obj.visible = false;
        const disc = contactDisc(); disc.visible = false;
        this.group.add(obj, disc);
        const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
        // nearest other mapped place (towns, heritage, other models); same-spot duplicates (< 100 m) do not count
        let gap = 1e9;
        for (const q of mapped) { const d = Math.hypot(q.x - pl.x, q.z - pl.z); if (q !== pl && d > 100 && d < gap) gap = d; }
        this.items.push({ place: pl, obj, inner, terrace, disc, height: box.max.y - Math.min(0, box.min.y), foot: Math.max(sx, sz, 1), sx, sz, gap, k: null, kq: null, d: 1e9 });
      } catch (e) { console.warn("landmark failed", pl.slug, e.message); }
    });
    await Promise.all(jobs);
    onDone?.();
  }

  /** Scale for a camera distance d (metres): the target on-screen footprint, clamped between real size and the caps. */
  scaleAt(it, d) {
    const s = this.mult / MIN_MULT, mpp = Math.max(d, 1) * shared.uPx.value;
    const kMax = Math.min(this.mult, (CAP_M * s) / it.foot, (NEIGH * it.gap) / it.foot);
    return Math.max(1, Math.min((PX * s * mpp) / it.foot, kMax));
  }

  /** Stand the model at scale k: sample the ground over its (rotated) footprint; the base sits on the centre ground,
   *  raised so the uphill side is cut at most BURY of the height into the hill; a terrace fills down to the lowest ground. */
  place(it, k) {
    const p = this.pack, x = it.place.x, z = it.place.z, yaw = it.inner.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = (it.sx * k) / 2 * 0.9, hz = (it.sz * k) / 2 * 0.9, H = it.height * k;
    let lo = 1e9, hi = -1e9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const u = (a / 2) * hx, v = (b / 2) * hz, y = p.groundY(x + u * c + v * s, z - u * s + v * c);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const gc = p.groundY(x, z), base = Math.max(gc, hi - BURY * H, lo) - 0.3;
    it.obj.position.set(x, base, z);
    it.inner.scale.setScalar(k);
    const drop = base - lo;
    it.terrace.visible = drop > 0.04 * H + 0.5;
    if (it.terrace.visible) {
      it.terrace.scale.set(it.sx * k * 1.04, drop + 2, it.sz * k * 1.04); it.terrace.rotation.y = yaw;
      it.terrace.position.y = 0.02 * H;                   // top flush with the model's floor
    }
    it.disc.position.set(x, lo + 0.6, z); it.disc.scale.setScalar(Math.max(it.foot * k * 1.9, 1));
    it.k = k;
  }

  /** Per frame: zoom-driven scale (quantised to 4 % steps so placement is not redone every frame) and the fade. */
  update(camera) {
    const p = this.pack, cp = camera.position;
    for (const it of this.items) {
      const x = it.place.x, z = it.place.z;
      const d = Math.hypot(cp.x - x, cp.y - p.groundY(x, z), cp.z - z);
      it.d = d;
      const fade = 1 - smooth(SHOW_KM * 1000 * 0.85, SHOW_KM * 1000, d);
      it.obj.visible = fade > 0.01; it.disc.visible = it.obj.visible;
      if (!it.obj.visible) continue;
      const kq = Math.exp(Math.round(Math.log(this.scaleAt(it, d)) / QK) * QK);
      if (kq !== it.kq || it.placedExag !== p.exag || it.placedMult !== this.mult) { it.kq = kq; it.placedExag = p.exag; it.placedMult = this.mult; this.place(it, kq); }
      if (it.fade === fade) continue;
      it.fade = fade;
      const see = fade < 0.999;
      it.obj.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) { m.transparent = see; m.opacity = fade; m.depthWrite = !see; } });
      it.disc.material.opacity = fade;
    }
  }

  setScale(m) { this.mult = m; }
  /** Displayed height of a place's model (metres), 0 if none or hidden. Lifts its label. */
  heightOf(slug) { const it = this.items.find((i) => i.place.slug === slug); return it && it.obj.visible && it.k ? it.height * it.k + (it.obj.position.y - this.pack.groundY(it.place.x, it.place.z)) : 0; }
  meshes() { const out = []; for (const i of this.items) if (i.obj.visible) i.obj.traverse((o) => o.isMesh && out.push(o)); return out; }
}
