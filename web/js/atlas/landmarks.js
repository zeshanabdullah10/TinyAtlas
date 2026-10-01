// Landmark maquettes (place.model GLBs) stood on the ground at hero scale.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class Landmarks {
  constructor(pack, scene, { tier = "high" } = {}) {
    this.pack = pack; this.group = new THREE.Group(); scene.add(this.group);
    this.scale = pack.meta.landmark_scale_default ?? 30;
    this.items = [];            // {place, obj, height}
    this.tier = tier;
    this.loader = new GLTFLoader();
  }

  async load(onDone) {
    const jobs = this.pack.places.filter((pl) => pl.model).map(async (pl) => {
      try {
        const gltf = await this.loader.loadAsync(this.pack.base + pl.model);
        const obj = new THREE.Group(); obj.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const height = box.max.y - Math.max(0, box.min.y);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = this.tier === "high"; o.receiveShadow = true;
          o.userData.slug = pl.slug;
          for (const m of [].concat(o.material)) { m.roughness = Math.max(m.roughness ?? 0.9, 0.8); m.metalness = 0; }
        });
        obj.userData.slug = pl.slug;
        this.group.add(obj);
        this.items.push({ place: pl, obj, height });
      } catch (e) { console.warn("landmark failed", pl.slug, e.message); }
    });
    await Promise.all(jobs);
    this.place();
    onDone?.();
  }

  /** Stand every model on the ground (lowest terrain under its footprint) at the current scale. */
  place() {
    const p = this.pack;
    for (const { place, obj } of this.items) {
      const y = p.groundY(place.x, place.z);
      obj.position.set(place.x, y - this.scale * 0.15, place.z);
      obj.scale.setScalar(this.scale);
    }
  }
  setScale(s) { this.scale = s; this.place(); }
  /** Height of a place's model at the current scale (metres), 0 if none. Used to lift its label. */
  heightOf(slug) { const it = this.items.find((i) => i.place.slug === slug); return it ? it.height * this.scale : 0; }
  meshes() { const out = []; for (const i of this.items) i.obj.traverse((o) => o.isMesh && out.push(o)); return out; }
}
