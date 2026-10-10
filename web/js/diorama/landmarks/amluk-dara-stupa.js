// Amluk-Dara Stupa: the drawn rubble and wall stubs round the Atlas maquette (landmark.module). Photos 01-06 show
// tumbled stones and loose masonry at the plinth foot, and low ruined walls on the court side. The model keeps its
// own plinth, drum and stair; this adds only what the photos show around it. Local frame: x right, -z front; the
// stair of the GLB projects toward +z, so the stone heaps and walls stay off that sector.
// Positions are illustrative (drawn after Commons photos, not a survey).
export default function build(ctx) {
  const { THREE, M, hash, group } = ctx;
  const seed = 41;
  const rnd = (i, k) => hash(i, seed, k);
  const outsidePlinth = (x, z) => Math.max(Math.abs(x), Math.abs(z)) >= 17.8;   // the 34 m square plinth is 17 m each way
  const stairClear = (x, z) => Math.abs(x) < 6.5 && z > 0;                       // the 6 m stair, to the +z side

  // Tumbled boulders and loose masonry heaped at the plinth foot (photos 01 and 02): three heaps of 10-12 stones,
  // 0.4-1.2 m, each heap about 2 m across, 17.8-21 m from the centre, kept off the stair and the court side.
  const heaps = [[205, 19.2], [255, 19.6], [335, 19.0]];
  let n = 0;
  heaps.forEach(([deg, R], h) => {
    const a0 = (deg * Math.PI) / 180, cx = Math.cos(a0) * R, cz = Math.sin(a0) * R;
    for (let j = 0; j < 12; j++) {
      const i = h * 40 + j;
      const x = cx + (rnd(i, 3) - 0.5) * 4.2, z = cz + (rnd(i, 5) - 0.5) * 4.2;
      if (!outsidePlinth(x, z) || stairClear(x, z)) continue;
      const k = 0.4 + rnd(i, 13) * 0.8;
      const o = new THREE.Mesh(new THREE.DodecahedronGeometry(k, 0), M.stone);
      o.scale.set(1, 0.5 + rnd(i, 17) * 0.4, 1 + rnd(i, 19) * 0.5);
      o.rotation.set(rnd(i, 23) * 3, rnd(i, 29) * 3, 0);
      o.position.set(x, ctx.ground(x, z) + k * 0.3, z);
      o.castShadow = o.receiveShadow = true;
      group.add(o);
      n++;
    }
  });

  // Short stretches of ruined dry-stone wall (court or monastery remains), 0.5-1.5 m high, 0.6 m thick, on the
  // west and north-east sides, 1.5 m segments, each seated on the ground under it.
  const walls = [
    { axis: "x", fixed: -19.2, from: -13, to: -2 },    // west: runs north-south, at x = -19.2
    { axis: "z", fixed: -19.6, from: 4, to: 15 },      // back: runs east-west, at z = -19.6
  ];
  walls.forEach((w, wi) => {
    const n = Math.round((w.to - w.from) / 1.5);
    for (let s = 0; s < n; s++) {
      if (rnd(wi * 10 + s, 31) < 0.2) continue;        // gaps where the wall has fallen
      const t = w.from + (s + 0.5) * (w.to - w.from) / n;
      const h = 0.5 + rnd(wi * 10 + s, 37) * 1.0;
      const len = (w.to - w.from) / n;
      const x = w.axis === "x" ? w.fixed : t, z = w.axis === "x" ? t : w.fixed;
      if (stairClear(x, z)) continue;
      ctx.box(group, w.axis === "x" ? 0.6 : len, h, w.axis === "x" ? len : 0.6, M.stone,
        x, ctx.ground(x, z), z, 0);
    }
  });

  ctx.batch(group);
}
