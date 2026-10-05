// Dust kicked up behind the wheels: a small pool of soft, warm sprites that rise, spread and fade.
import * as THREE from "three";

export class Dust {
  constructor(scene, n = 700) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.age = new Float32Array(n).fill(99); this.life = new Float32Array(n).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aAge", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.uni = { uCol: { value: new THREE.Color(0.86, 0.74, 0.58) }, uPx: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni, transparent: true, depthWrite: false,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aAge; varying float vA; uniform float uPx;
        void main() { vA = aAge; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = uPx * (0.3 + 1.5 * aAge) / -mv.z;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vA; uniform vec3 uCol;
        void main() {
          #include <logdepthbuf_fragment>
          float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0 || vA >= 1.0) discard;
          float a = (1.0 - d * d) * (1.0 - vA) * min(vA * 6.0, 1.0) * 0.24;
          gl_FragColor = vec4(uCol, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(p, speed, n) {
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.pos.set([p.x + (Math.random() - 0.5) * 0.4, p.y + 0.15, p.z + (Math.random() - 0.5) * 0.4], i * 3);
      this.vel.set([(Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.8 + speed * 0.05, (Math.random() - 0.5) * 1.2], i * 3);
      this.age[i] = 0; this.life[i] = 1.6 + Math.random() * 1.6;
    }
  }
  update(dt, wind) {
    const A = this.points.geometry.attributes.aAge.array;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] > this.life[i]) { A[i] = 1; continue; }
      this.age[i] += dt;
      const v = this.vel;
      v[i * 3 + 1] *= 1 - dt * 0.8;
      this.pos[i * 3] += (v[i * 3] + wind.x) * dt; this.pos[i * 3 + 1] += v[i * 3 + 1] * dt; this.pos[i * 3 + 2] += (v[i * 3 + 2] + wind.z) * dt;
      A[i] = this.age[i] / this.life[i];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAge.needsUpdate = true;
  }
}
