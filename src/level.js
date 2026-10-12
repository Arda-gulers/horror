'use strict';
// Level: grid map, static geometry, props, colliders, lamps, navigation and ray queries.

const MAP_W = 57, MAP_H = 41;
const ROOMS = [
  { id: 'locker', name: '更衣室', x0: 1, z0: 1, x1: 10, z1: 11, h: 3.2, floor: 'terrazzo', wall: 'dado', ceil: 'plaster', reverb: 'room' },
  { id: 'corridor', name: '走廊', x0: 12, z0: 7, x1: 44, z1: 9, h: 3.0, floor: 'terrazzo', wall: 'dado', ceil: 'plaster', reverb: 'corridor' },
  { id: 'security', name: '保卫科', x0: 16, z0: 1, x1: 24, z1: 5, h: 3.0, floor: 'terrazzo', wall: 'dado', ceil: 'plaster', reverb: 'room' },
  { id: 'washroom', name: '水房', x0: 28, z0: 11, x1: 34, z1: 16, h: 3.0, floor: 'mosaic', wall: 'tile', ceil: 'plaster', reverb: 'tile' },
  { id: 'vestibule', name: '车间门厅', x0: 39, z0: 11, x1: 43, z1: 16, h: 3.2, floor: 'concrete', wall: 'dado', ceil: 'plaster', reverb: 'room' },
  { id: 'workshop', name: '三号车间', x0: 26, z0: 18, x1: 55, z1: 39, h: 8.0, floor: 'concrete', wall: 'ws', ceil: 'wsCeil', reverb: 'hall' },
  { id: 'store', name: '料库', x0: 21, z0: 25, x1: 24, z1: 31, h: 3.0, floor: 'concrete', wall: 'dado', ceil: 'plaster', reverb: 'room' },
];
const DOORS = [
  { id: 'lockerDoor', cells: [[11, 8]], h: 2.2, floor: 'terrazzo', axis: 'x', leaf: 'open' },
  { id: 'secDoor', cells: [[20, 6]], h: 2.2, floor: 'terrazzo', axis: 'z', leaf: 'open' },
  { id: 'washDoor', cells: [[30, 10]], h: 2.2, floor: 'terrazzo', axis: 'z', leaf: 'closed' },
  { id: 'vestNorth', cells: [[40, 10], [41, 10], [42, 10]], h: 3.0, floor: 'concrete', axis: 'z' },
  { id: 'bigDoor', cells: [[40, 17], [41, 17], [42, 17]], h: 3.0, floor: 'concrete', axis: 'z' },
  { id: 'storeDoor', cells: [[25, 28]], h: 2.2, floor: 'concrete', axis: 'x', leaf: 'closed', swing: 1 },
];
// Texture metres per repeat (u, v) for world-scaled UVs.
const MAT_TM = {
  terrazzo: [2, 2], concrete: [4, 4], mosaic: [1, 1], dado: [2, 3], ws: [4, 8], tile: [1.2, 1.2], plaster: [2, 2], wsCeil: [4, 4],
  machine: [1, 1], locker: [1, 1], steel: [1, 1], wood: [1, 1], red: [1, 1], hazard: [0.5, 0.5], plain: [1, 1], rubber: [1, 1],
  enamel: [1, 1], yellow: [4, 4], brass: [1, 1],
};
const SURF = { terrazzo: 'concrete', concrete: 'concrete', mosaic: 'tile', dado: 'plaster', ws: 'concrete', tile: 'tile', plaster: 'plaster', wsCeil: 'concrete' };

class MeshBuilder {
  constructor() { this.groups = new Map(); }
  g(key) { let g = this.groups.get(key); if (!g) { g = { pos: [], nor: [], uv: [] }; this.groups.set(key, g); } return g; }
  // Quad from four corners (bl, br, tr, tl) with uv in metres.
  quad(key, p, n, uv) {
    const g = this.g(key), tm = MAT_TM[key] || [1, 1];
    const idx = [0, 1, 2, 0, 2, 3];
    for (const i of idx) { g.pos.push(p[i][0], p[i][1], p[i][2]); g.nor.push(n[0], n[1], n[2]); g.uv.push(uv[i][0] / tm[0], uv[i][1] / tm[1]); }
  }
  // Axis box centred at (cx,cy,cz) with sizes, optional Y rotation. UVs in metres per face.
  box(key, cx, cy, cz, sx, sy, sz, ry = 0, topKey) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const F = [
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], sz, sy],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], sz, sy],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], sx, sy],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], sx, sy],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], sx, sz],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], sx, sz],
    ];
    const c = Math.cos(ry), s = Math.sin(ry);
    const rot = (v) => [v[0] * c + v[2] * s + cx, v[1] + cy, -v[0] * s + v[2] * c + cz];
    const rn = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    F.forEach((f, i) => {
      const k = (i === 4 && topKey) ? topKey : key;
      const off = [(cx + cz) % 7, cy % 3];
      this.quad(k, f[1].map(rot), rn(f[0]), [[off[0], off[1]], [off[0] + f[2], off[1]], [off[0] + f[2], off[1] + f[3]], [off[0], off[1] + f[3]]]);
    });
  }
  // Merge an arbitrary geometry, transformed by matrix.
  geo(key, geometry, matrix) {
    const gg = geometry.index ? geometry.toNonIndexed() : geometry;
    gg.applyMatrix4(matrix);
    const g = this.g(key), P = gg.attributes.position.array, N = gg.attributes.normal.array, U = gg.attributes.uv ? gg.attributes.uv.array : null;
    for (let i = 0; i < P.length; i++) { g.pos.push(P[i]); g.nor.push(N[i]); }
    for (let i = 0; i < P.length / 3; i++) { g.uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0); }
  }
  build(mats, parent, shadows = true) {
    const meshes = [];
    for (const [key, g] of this.groups) {
      if (!g.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mats[key]);
      m.castShadow = shadows; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.static = true;
      parent.add(m); meshes.push(m);
    }
    return meshes;
  }
}

class Level {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.cells = new Array(MAP_W * MAP_H).fill(null); // null = solid, else { room, h, floor, wall, ceil, door }
    this.boxes = [];      // colliders { x0,y0,z0,x1,y1,z1, surf, on, id }
    this.lamps = [];
    this.pool = [];
    this.interactables = [];
    this.doors = {};
    this.decor = [];      // dynamic decor updated per frame (swinging lamp, crane hook)
    this.mats = this.makeMaterials();
    this.carve();
    this.buildStatic();
    this.buildNav();
    this.initLightPool();
  }

  // ------------------------------------------------------------------ materials
  makeMaterials() {
    const S = (o) => new THREE.MeshStandardMaterial(o);
    const m = {
      terrazzo: S({ map: TEX.terrazzo, normalMap: TEX.terrazzoN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.38, envMapIntensity: 0.9 }),
      concrete: S({ map: TEX.concrete, normalMap: TEX.concreteN, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: TEX.concreteR, roughness: 1 }),
      mosaic: S({ map: TEX.mosaic, roughness: 0.28, envMapIntensity: 1.2 }),
      dado: S({ map: TEX.dado, normalMap: TEX.dadoN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.82 }),
      ws: S({ map: TEX.wsWall, normalMap: TEX.wsWallN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }),
      tile: S({ map: TEX.tileWall, roughnessMap: TEX.tileWallR, roughness: 1, envMapIntensity: 1.3 }),
      plaster: S({ map: TEX.ceiling, roughness: 1 }),
      wsCeil: S({ color: 0x2a2826, roughness: 1 }),
      machine: S({ map: TEX.machineGreen, normalMap: TEX.machineGreenN, roughness: 0.5, metalness: 0.2 }),
      locker: S({ map: TEX.lockerGrey, normalMap: TEX.lockerGreyN, roughness: 0.45, metalness: 0.3 }),
      steel: S({ map: TEX.steelDark, normalMap: TEX.steelDarkN, roughness: 0.42, metalness: 0.65 }),
      wood: S({ map: TEX.wood, normalMap: TEX.woodN, roughness: 0.6 }),
      red: S({ map: TEX.paintRed, normalMap: TEX.paintRedN, roughness: 0.45, metalness: 0.2 }),
      hazard: S({ map: TEX.hazard, roughness: 0.7 }),
      plain: S({ color: 0x8c877a, roughness: 0.9 }),
      rubber: S({ color: 0x141414, roughness: 0.9 }),
      enamel: S({ color: 0x3d5b48, roughness: 0.3, metalness: 0.1 }),
      yellow: S({ color: 0x9c7f2a, roughness: 0.75, normalMap: TEX.concreteN }),
      brass: S({ color: 0x8d6b2c, roughness: 0.32, metalness: 0.85 }),
    };
    for (const k in m) m[k].userData.key = k;
    return m;
  }

  // ------------------------------------------------------------------ grid
  idx(x, z) { return z * MAP_W + x; }
  cell(x, z) { if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return null; return this.cells[z * MAP_W + x]; }
  cellAt(px, pz) { return this.cell(Math.floor(px), Math.floor(pz)); }
  roomAt(px, pz) { const c = this.cellAt(px, pz); return c ? c.room : null; }
  carve() {
    for (const r of ROOMS) for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++)
      this.cells[this.idx(x, z)] = { room: r, h: r.h, floor: r.floor, wall: r.wall, ceil: r.ceil };
    for (const d of DOORS) for (const [x, z] of d.cells)
      this.cells[this.idx(x, z)] = { room: null, door: d, h: d.h, floor: d.floor, wall: 'dado', ceil: 'plaster' };
  }

  // ------------------------------------------------------------------ static geometry
  buildStatic() {
    const B = this.B = new MeshBuilder();
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) {
      const c = this.cell(x, z); if (!c) continue;
      const x0 = x, x1 = x + 1, z0 = z, z1 = z + 1, h = c.h;
      B.quad(c.floor, [[x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
      B.quad(c.ceil, [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dz] of nb) {
        const n = this.cell(x + dx, z + dz);
        let y0 = 0, y1 = h;
        if (n) { if (n.h >= h) continue; y0 = n.h; }
        const k = c.wall;
        if (dx === 1) B.quad(k, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
        if (dx === -1) B.quad(k, [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
        if (dz === 1) B.quad(k, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
        if (dz === -1) B.quad(k, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
    }
    this.buildProps();
    this.staticMeshes = B.build(this.mats, this.root, true);
  }

  // Collider helper.
  col(x0, y0, z0, x1, y1, z1, surf = 'metal', id) {
    const b = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1), surf, on: true, id };
    this.boxes.push(b); return b;
  }
  // Box with its collider in one call (rotation limited to multiples of 90 degrees for the collider).
  solid(key, cx, cy, cz, sx, sy, sz, ry = 0, surf) {
    this.B.box(key, cx, cy, cz, sx, sy, sz, ry);
    const swap = Math.abs(Math.sin(ry)) > 0.7;
    const hx = (swap ? sz : sx) / 2, hz = (swap ? sx : sz) / 2;
    return this.col(cx - hx, cy - sy / 2, cz - hz, cx + hx, cy + sy / 2, cz + hz, surf || (key === 'wood' ? 'wood' : key === 'plain' ? 'concrete' : 'metal'));
  }
  cyl(key, x, y, z, rTop, rBot, h, seg = 16, rx = 0, rz = 0, ry = 0, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    _m1.compose(_v1.set(x, y, z), _q1.setFromEuler(_e1.set(rx, ry, rz)), _v2.set(1, 1, 1));
    this.B.geo(key, g, _m1);
  }
  // Plane hung on a wall. facing: direction of its normal.
  wallPlane(mat, x, y, z, w, h, facing, parent = this.root) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 }[facing];
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  decalMat(tex, o = {}) {
    return new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: o.roughness || 0.9, metalness: 0, alphaTest: 0.02 });
  }

  buildProps() {
    const B = this.B;
    const P = (tex) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });

    // ---------------- Locker room ----------------
    for (let i = 0; i < 16; i++) this.locker(1.3 + i * 0.52, 1.28, 0, i === 12);
    for (let i = 0; i < 6; i++) this.locker(1.28, 3.4 + i * 0.52, Math.PI / 2, i === 2);
    for (let i = 0; i < 6; i++) { this.locker(5.35, 3.6 + i * 0.52, -Math.PI / 2); this.locker(5.87, 3.6 + i * 0.52, Math.PI / 2, i === 4); }
    this.bench(3.3, 5.0, 2.4, Math.PI / 2); this.bench(8.3, 5.2, 2.4, Math.PI / 2);
    this.table(2.6, 10.3, 1.2, 0.6, 0);
    this.wallPlane(P(TEX.rulesPoster), 1.012, 1.55, 8.9, 0.62, 0.89, '+x');
    this.wallPlane(P(TEX.safetyPoster), 10.988, 1.6, 3.2, 0.5, 0.7, '-x');
    this.radiator(10.75, 5.4, 1.4, Math.PI / 2);
    this.lamp('bulb', 5.5, 2.75, 6.3, { color: 0xffc98a, intensity: 7, range: 11, flicker: 'slight', room: 'locker' });
    this.doorFrame('lockerDoor');

    // ---------------- Corridor ----------------
    const cz = 8.5;
    [15, 22, 29, 36, 43].forEach((x, i) => this.lamp('tube', x, 2.94, cz, { color: 0xd6f0e0, intensity: [6, 5, 0, 5.5, 4.5][i], range: 9, flicker: ['slight', 'bad', 'dead', 'slight', 'dying'][i], room: 'corridor' }));
    this.radiator(14.5, 7.22, 1.6, 0); this.radiator(26.5, 9.78, 1.6, Math.PI); this.radiator(35.5, 7.22, 1.6, 0);
    this.bench(17.5, 9.6, 1.8, 0);
    this.fireCabinet(24.7, 7.08, 0);
    this.wallPlane(P(TEX.safetyPoster), 33.2, 1.6, 7.012, 0.5, 0.7, '+z');
    this.cart(37.2, 8.9);
    this.crate(44.2, 7.6, 0.8, 0.2); this.crate(44.1, 8.5, 0.7, -0.1); this.crate(44.2, 7.8, 0.6, 0.5, 0.8);
    this.doorFrame('secDoor'); this.doorFrame('washDoor');
    this.signPlate(20.5, 2.55, 7.01, '保卫科', '+z'); this.signPlate(30.5, 2.55, 9.99, '水房', '-z');

    // ---------------- Security office ----------------
    this.desk(21.8, 3.0, 0);
    this.lamp('desk', 22.4, 1.12, 2.85, { color: 0xffd9a0, intensity: 3.2, range: 6, flicker: 'none', room: 'security' });
    this.cabinetSteel(16.5, 1.5, 0); this.cabinetSteel(17.2, 1.5, 0);
    this.gunRack(23.6, 1.18);
    this.wallPlane(P(TEX.safetyPoster), 19.0, 1.6, 1.012, 0.46, 0.64, '+z');
    this.chair(21.6, 3.9, Math.PI);

    // ---------------- Washroom ----------------
    this.trough(34.6, 13.8, 4.2);
    this.lamp('bulb', 31, 2.6, 13.5, { color: 0xe8f0ff, intensity: 4.5, range: 8, flicker: 'bad', room: 'washroom' });
    this.shelf(28.6, 15.6, 1.4, Math.PI / 2, 2);

    // ---------------- Vestibule (safe room) ----------------
    this.table(42.4, 12.6, 1.3, 0.7, Math.PI / 2);
    this.bench(39.5, 14.0, 2.0, Math.PI / 2);
    this.lamp('bulb', 41.2, 2.8, 13.4, { color: 0xffc47a, intensity: 6, range: 9, flicker: 'none', room: 'vestibule' });
    this.wallPlane(P(TEX.safetyPoster), 43.988, 1.6, 15.0, 0.46, 0.64, '-x');
    this.slidingDoor();

    // ---------------- Workshop ----------------
    this.workshop();

    // ---------------- Store ----------------
    this.shelf(21.4, 26.5, 2.2, Math.PI / 2, 3); this.shelf(21.4, 30.0, 2.2, Math.PI / 2, 3);
    this.crate(23.8, 25.8, 0.9, 0.1); this.drum(24.0, 30.8, 'red');
    this.doorFrame('storeDoor');
  }

  workshop() {
    const B = this.B;
    const H = 8;
    // Pillars with hazard bands.
    this.pillars = [];
    for (const x of [32, 50]) for (const z of [23, 29, 35]) {
      this.solid('plain', x, H / 2, z, 0.62, H, 0.62, 0, 'concrete');
      B.box('hazard', x, 0.6, z, 0.66, 1.2, 0.66);
      this.pillars.push(new V3(x, 0, z));
    }
    // Lathes in three rows, leaving the centre aisle (x 37..45) open.
    this.machines = [];
    const rows = [21.3, 27.4, 33.6];
    rows.forEach((z, ri) => {
      [29.2, 35.2, 47.0, 53.0].forEach((x, i) => {
        if (ri === 2 && (i === 1 || i === 2)) { this.drillPress(x + (i === 1 ? -0.4 : 0.4), z); this.machines.push({ x, z, kind: 'drill' }); return; }
        this.lathe(x, z, 0); this.machines.push({ x, z, kind: 'lathe' });
      });
    });
    // Workbenches along the west wall and shelving on the east wall.
    this.workbench(26.55, 21.2, 3.0, Math.PI / 2); this.workbench(26.55, 34.8, 3.0, Math.PI / 2);
    this.shelf(55.35, 21.5, 3.0, -Math.PI / 2, 4); this.shelf(55.35, 33.0, 3.0, -Math.PI / 2, 4);
    // Cover in the centre aisle.
    this.crate(39.4, 24.6, 1.0, 0.1); this.crate(39.3, 25.5, 0.8, -0.2); this.crate(39.5, 24.9, 0.7, 0.3, 1.0);
    this.drum(43.2, 30.6, 'blue'); this.drum(43.8, 31.1, 'blue'); this.drum(43.1, 31.3, 'red');
    this.crate(38.6, 34.4, 0.9, 0.35);
    this.cart(44.4, 22.3);
    // Painted walkway lines.
    for (const x of [37.3, 44.7]) B.box('yellow', x, 0.004, 28.5, 0.1, 0.008, 20.6);
    B.box('yellow', 41, 0.004, 18.3, 7.5, 0.008, 0.1);
    // Roof trusses, crane rails and beam.
    for (let z = 20; z <= 38; z += 6) B.box('steel', 40.5, 7.6, z, 30, 0.3, 0.2);
    B.box('steel', 40.5, 6.6, 18.3, 30, 0.35, 0.35); B.box('steel', 40.5, 6.6, 39.7, 30, 0.35, 0.35);
    this.crane = new THREE.Group(); this.root.add(this.crane);
    const craneBeam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 21.5), this.mats.steel); craneBeam.position.set(0, 6.95, 29); craneBeam.castShadow = true;
    const hoist = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.7), this.mats.machine); hoist.position.set(0, 6.4, 27.5); hoist.castShadow = true;
    this.crane.add(craneBeam, hoist); this.crane.position.x = 46;
    const chainMat = this.mats.steel;
    this.hook = new THREE.Group(); this.hook.position.set(0, 6.15, 27.5); this.crane.add(this.hook);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.6, 6), chainMat); chain.position.y = -1.3; this.hook.add(chain);
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 12, Math.PI * 1.5), chainMat); hk.position.y = -2.72; hk.rotation.z = 0.6; this.hook.add(hk);
    this.decor.push((dt, t) => { this.hook.rotation.z = Math.sin(t * 0.4) * 0.05; this.hook.rotation.x = Math.sin(t * 0.31 + 1) * 0.04; });
    // High windows.
    const winMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: TEX.window, emissiveIntensity: 0.55, roughness: 0.3 });
    for (let z = 21; z <= 37; z += 4) { this.wallPlane(winMat, 26.01, 5.6, z, 2.2, 2.0, '+x'); this.wallPlane(winMat, 55.99, 5.6, z, 2.2, 2.0, '-x'); }
    // Slogans.
    const sl = (tex, x, y, z, w, f) => this.wallPlane(this.decalMat(tex), x, y, z, w, w * 180 / 1024, f);
    sl(TEX.slogan3, 41, 6.0, 39.98, 9, '-z');
    sl(TEX.slogan1, 26.02, 3.4, 28.5, 8, '+x');
    sl(TEX.slogan2, 55.98, 3.4, 27.5, 8, '-x');
    sl(TEX.slogan1, 34, 3.6, 18.02, 7, '+z');
    // Lamps: four hanging enamel lamps plus the swinging centre lamp.
    [[31, 24, 'slight'], [51, 24, 'bad'], [31, 34, 'slight'], [51, 34, 'none']].forEach(([x, z, f]) =>
      this.lamp('hang', x, 5.2, z, { color: 0xffb46b, intensity: 42, range: 20, flicker: f, room: 'workshop', group: 'ws' }));
    // PA horns on pillars.
    this.horns = [];
    [[32, 23, 1], [50, 23, -1], [32, 35, 1], [50, 35, -1]].forEach(([x, z, s]) => this.paHorn(x + s * 0.34, 4.6, z, s));
    // Entrance sign, seen when looking back at the door.
    this.signPlate(41.5, 3.6, 18.01, '三号车间', '+z', 1.6);
  }

  // ------------------------------------------------------------------ props
  locker(x, z, ry, open = false) {
    const B = this.B;
    B.box('locker', x, 0.93, z, 0.5, 1.86, 0.5, ry);
    this.col(x - 0.26, 0, z - 0.26, x + 0.26, 1.86, z + 0.26, 'metal');
    const c = Math.cos(ry), s = Math.sin(ry);
    const f = (dx, dy, dz) => [x + dx * c + dz * s, dy, z - dx * s + dz * c];
    let p = f(0, 1.55, 0.255); B.box('steel', p[0], p[1], p[2], 0.3, 0.12, 0.012, ry);
    p = f(0.17, 1.0, 0.262); B.box('steel', p[0], p[1], p[2], 0.03, 0.12, 0.03, ry);
    if (open) { p = f(0.25 + 0.2, 0.93, 0.35); B.box('locker', p[0], p[1], p[2], 0.02, 1.7, 0.46, ry + 0.9); }
  }
  bench(x, z, len, ry) {
    const B = this.B;
    B.box('wood', x, 0.44, z, len, 0.05, 0.3, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const d of [-len / 2 + 0.15, len / 2 - 0.15]) B.box('steel', x + d * c, 0.21, z - d * s, 0.04, 0.42, 0.26, ry);
    const hl = len / 2, sw = Math.abs(s) > 0.7;
    this.col(x - (sw ? 0.15 : hl), 0, z - (sw ? hl : 0.15), x + (sw ? 0.15 : hl), 0.47, z + (sw ? hl : 0.15), 'wood');
  }
  table(x, z, w, d, ry) {
    const B = this.B;
    B.box('wood', x, 0.76, z, w, 0.05, d, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const dx = a * (w / 2 - 0.05), dz = b * (d / 2 - 0.05); B.box('wood', x + dx * c + dz * s, 0.37, z - dx * s + dz * c, 0.05, 0.74, 0.05, ry); }
    const sw = Math.abs(s) > 0.7;
    this.col(x - (sw ? d : w) / 2, 0, z - (sw ? w : d) / 2, x + (sw ? d : w) / 2, 0.79, z + (sw ? w : d) / 2, 'wood');
  }
  desk(x, z, ry) {
    this.solid('wood', x, 0.38, z, 1.4, 0.76, 0.7, ry, 'wood');
    this.B.box('wood', x, 0.77, z, 1.46, 0.03, 0.76, ry);
  }
  chair(x, z, ry) {
    const B = this.B;
    B.box('wood', x, 0.45, z, 0.42, 0.04, 0.42, ry);
    const c = Math.cos(ry), s = Math.sin(ry);
    B.box('wood', x + 0 * c + (-0.2) * s, 0.7, z - 0 * s + (-0.2) * c, 0.42, 0.45, 0.03, ry);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const dx = a * 0.18, dz = b * 0.18; B.box('steel', x + dx * c + dz * s, 0.22, z - dx * s + dz * c, 0.03, 0.44, 0.03, ry); }
    this.col(x - 0.22, 0, z - 0.22, x + 0.22, 0.9, z + 0.22, 'wood');
  }
  cabinetSteel(x, z, ry) {
    this.solid('locker', x, 0.9, z, 0.6, 1.8, 0.5, ry);
    for (let i = 0; i < 4; i++) this.B.box('steel', x, 0.3 + i * 0.42, z + 0.255, 0.16, 0.03, 0.02, ry);
  }
  radiator(x, z, len, ry) {
    const c = Math.cos(ry), s = Math.sin(ry), n = Math.floor(len / 0.08);
    for (let i = 0; i < n; i++) { const d = -len / 2 + i * 0.08 + 0.04; this.B.box('steel', x + d * c, 0.45, z - d * s, 0.05, 0.6, 0.14, ry); }
    const sw = Math.abs(s) > 0.7;
    this.col(x - (sw ? 0.08 : len / 2), 0, z - (sw ? len / 2 : 0.08), x + (sw ? 0.08 : len / 2), 0.8, z + (sw ? len / 2 : 0.08), 'metal');
  }
  fireCabinet(x, z, ry) {
    this.solid('red', x, 1.1, z + 0.12, 0.7, 0.9, 0.22, ry);
    this.B.box('steel', x, 1.1, z + 0.235, 0.6, 0.8, 0.01, ry);
  }
  cart(x, z) {
    const B = this.B;
    B.box('steel', x, 0.55, z, 1.2, 0.05, 0.6); B.box('steel', x, 0.25, z, 1.2, 0.04, 0.6);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('steel', x + a * 0.56, 0.3, z + b * 0.26, 0.04, 0.6, 0.04);
    B.box('steel', x - 0.62, 0.85, z, 0.04, 0.6, 0.6);
    this.crate(x + 0.15, z, 0.5, 0.2, 0.58);
    this.col(x - 0.64, 0, z - 0.32, x + 0.62, 0.95, z + 0.32, 'metal');
  }
  crate(x, z, s, ry = 0, y0 = 0) {
    this.B.box('wood', x, y0 + s / 2, z, s, s, s, ry);
    this.B.box('steel', x, y0 + s * 0.8, z, s * 1.01, 0.04, s * 1.01, ry);
    this.col(x - s * 0.55, y0, z - s * 0.55, x + s * 0.55, y0 + s, z + s * 0.55, 'wood');
  }
  drum(x, z, color) {
    const key = color === 'red' ? 'red' : 'machine';
    this.cyl(key, x, 0.44, z, 0.29, 0.29, 0.88, 18);
    this.cyl('steel', x, 0.3, z, 0.3, 0.3, 0.03, 18); this.cyl('steel', x, 0.6, z, 0.3, 0.3, 0.03, 18);
    this.col(x - 0.3, 0, z - 0.3, x + 0.3, 0.88, z + 0.3, 'metal');
  }
  shelf(x, z, len, ry, levels = 3) {
    const B = this.B, c = Math.cos(ry), s = Math.sin(ry);
    for (const d of [-len / 2, len / 2]) B.box('steel', x + d * c, 1.0, z - d * s, 0.05, 2.0, 0.45, ry);
    for (let i = 0; i < levels; i++) {
      const y = 0.15 + i * (1.8 / (levels - 0.5));
      B.box('steel', x, y, z, len, 0.03, 0.45, ry);
      for (let k = 0; k < 3; k++) { const d = -len / 2 + 0.3 + k * (len - 0.6) / 2 + (Math.sin(i * 7 + k) * 0.1); const bs = 0.22 + ((i + k) % 3) * 0.06; B.box((i + k) % 2 ? 'wood' : 'plain', x + d * c, y + bs / 2 + 0.015, z - d * s, bs * 1.2, bs, bs, ry + (k - 1) * 0.1); }
    }
    const sw = Math.abs(s) > 0.7;
    this.col(x - (sw ? 0.24 : len / 2), 0, z - (sw ? len / 2 : 0.24), x + (sw ? 0.24 : len / 2), 2.0, z + (sw ? len / 2 : 0.24), 'metal');
  }
  trough(x, z, len) {
    const B = this.B;
    B.box('plain', x, 0.78, z, 0.7, 0.08, len); B.box('plain', x - 0.33, 0.62, z, 0.06, 0.34, len);
    B.box('plain', x, 0.45, z, 0.7, 0.06, len); B.box('tile', x + 0.34, 1.3, z, 0.02, 1.0, len);
    for (let i = 0; i < 5; i++) { const zz = z - len / 2 + 0.4 + i * (len - 0.8) / 4; this.cyl('steel', x + 0.25, 1.1, zz, 0.018, 0.018, 0.25, 8, 0, Math.PI / 2); this.cyl('steel', x + 0.14, 1.02, zz, 0.014, 0.014, 0.12, 8); }
    this.col(x - 0.36, 0, z - len / 2, x + 0.36, 0.86, z + len / 2, 'concrete');
  }
  lathe(x, z, ry) {
    const B = this.B;
    B.box('machine', x - 1.1, 0.45, z, 0.72, 0.9, 0.62); B.box('machine', x + 1.15, 0.45, z, 0.62, 0.9, 0.62);
    B.box('steel', x, 0.94, z, 3.0, 0.1, 0.52); B.box('steel', x, 1.0, z - 0.14, 3.0, 0.04, 0.06); B.box('steel', x, 1.0, z + 0.14, 3.0, 0.04, 0.06);
    B.box('machine', x - 1.15, 1.25, z, 0.72, 0.52, 0.6);
    this.cyl('steel', x - 0.72, 1.2, z, 0.14, 0.14, 0.14, 16, 0, Math.PI / 2);
    B.box('machine', x + 1.2, 1.15, z, 0.34, 0.32, 0.34);
    B.box('machine', x + 0.05, 1.1, z, 0.42, 0.18, 0.62);
    this.cyl('steel', x + 0.05, 1.02, z + 0.4, 0.12, 0.12, 0.03, 18, Math.PI / 2);
    B.box('steel', x, 0.52, z, 2.9, 0.06, 0.84);
    B.box('machine', x - 1.15, 1.55, z + 0.1, 0.5, 0.06, 0.3);
    this.col(x - 1.52, 0, z - 0.42, x + 1.52, 1.52, z + 0.44, 'metal');
  }
  drillPress(x, z) {
    const B = this.B;
    B.box('machine', x, 0.1, z, 0.7, 0.2, 0.7);
    this.cyl('steel', x, 1.0, z - 0.2, 0.07, 0.07, 1.8, 12);
    B.box('machine', x, 1.75, z, 0.42, 0.42, 0.72);
    B.box('machine', x, 0.8, z + 0.05, 0.5, 0.06, 0.5);
    this.cyl('steel', x, 1.4, z + 0.2, 0.025, 0.025, 0.3, 8);
    this.col(x - 0.36, 0, z - 0.4, x + 0.36, 2.0, z + 0.4, 'metal');
  }
  workbench(x, z, len, ry) {
    const B = this.B, c = Math.cos(ry), s = Math.sin(ry);
    B.box('wood', x, 0.84, z, len, 0.08, 0.8, ry);
    for (const d of [-len / 2 + 0.1, len / 2 - 0.1]) B.box('steel', x + d * c, 0.4, z - d * s, 0.06, 0.8, 0.7, ry);
    B.box('steel', x, 0.25, z, len - 0.2, 0.03, 0.7, ry);
    for (const d of [-0.6, 0.7]) { B.box('steel', x + d * c, 0.97, z - d * s, 0.18, 0.18, 0.14, ry); B.box('steel', x + d * c, 0.97, z - d * s + 0.12, 0.05, 0.05, 0.3, ry + Math.PI / 2); }
    const sw = Math.abs(s) > 0.7;
    this.col(x - (sw ? 0.4 : len / 2), 0, z - (sw ? len / 2 : 0.4), x + (sw ? 0.4 : len / 2), 0.9, z + (sw ? len / 2 : 0.4), 'wood');
  }
  gunRack(x, z) {
    const B = this.B;
    B.box('wood', x, 1.35, z - 0.12, 1.1, 0.9, 0.04);
    B.box('wood', x, 1.0, z - 0.05, 1.0, 0.06, 0.12); B.box('wood', x, 1.7, z - 0.05, 1.0, 0.06, 0.12);
    this.gunRackPos = new V3(x, 1.3, z);
  }
  doorFrame(id) {
    const d = DOORS.find((q) => q.id === id), [cx, cz] = d.cells[0];
    const B = this.B;
    if (d.axis === 'x') {
      for (const xx of [cx + 0.02, cx + 0.98]) { B.box('wood', xx, 1.1, cz + 0.04, 0.06, 2.2, 0.08); B.box('wood', xx, 1.1, cz + 0.96, 0.06, 2.2, 0.08); B.box('wood', xx, 2.22, cz + 0.5, 0.06, 0.08, 1.0); }
    } else {
      for (const zz of [cz + 0.02, cz + 0.98]) { B.box('wood', cx + 0.04, 1.1, zz, 0.08, 2.2, 0.06); B.box('wood', cx + 0.96, 1.1, zz, 0.08, 2.2, 0.06); B.box('wood', cx + 0.5, 2.22, zz, 1.0, 0.08, 0.06); }
    }
    if (!d.leaf) return;
    const pivot = new THREE.Group();
    const leafMat = new THREE.MeshStandardMaterial({ map: TEX.wood, normalMap: TEX.woodN, color: 0x7d8f7c, roughness: 0.6 });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.05), leafMat);
    leaf.castShadow = leaf.receiveShadow = true;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.15, metalness: 0.1 }));
    win.position.set(0, 0.45, 0.027); leaf.add(win);
    const win2 = win.clone(); win2.rotation.y = Math.PI; win2.position.z = -0.027; leaf.add(win2);
    leaf.position.set(0.45, 1.05, 0);
    pivot.add(leaf); this.root.add(pivot);
    let closedRot;
    if (d.axis === 'x') { pivot.position.set(cx + 0.5, 0, cz + 0.05); closedRot = -Math.PI / 2; }
    else { pivot.position.set(cx + 0.05, 0, cz + 0.5); closedRot = 0; }
    const door = { id, pivot, leaf, closedRot, openRot: closedRot + (d.swing ?? (d.axis === 'x' ? -1 : 1)) * 1.75, angle: 0, target: 0, vel: 0, collider: null, cx, cz, axis: d.axis };
    const setCol = () => {
      if (door.collider) door.collider.on = door.angle < 0.35;
    };
    door.collider = d.axis === 'x' ? this.col(cx + 0.45, 0, cz, cx + 0.55, 2.2, cz + 1, 'wood', id) : this.col(cx, 0, cz + 0.45, cx + 1, 2.2, cz + 0.55, 'wood', id);
    door.apply = () => { pivot.rotation.y = lerp(door.closedRot, door.openRot, door.angle); setCol(); };
    door.angle = d.leaf === 'open' ? 0.92 : 0; door.target = door.angle; door.apply();
    this.doors[id] = door;
  }
  // Big sliding door on the workshop side of the entrance. Open = slid east over the wall.
  slidingDoor() {
    const mat = new THREE.MeshStandardMaterial({ map: TEX.steelDark, normalMap: TEX.steelDarkN, color: 0x7c8a82, roughness: 0.5, metalness: 0.5 });
    const g = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.95, 0.08), mat); p.position.set(0.8 + i * 1.6, 1.475, 0); p.castShadow = p.receiveShadow = true; g.add(p);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.09), this.mats.hazard); band.position.set(0.8 + i * 1.6, 0.2, 0); g.add(band);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.1), this.mats.steel); rib.position.set(0.8 + i * 1.6, 1.5, 0); g.add(rib);
    }
    g.position.set(43.2, 0, 18.07); this.root.add(g);
    this.B.box('steel', 43.2, 3.05, 18.08, 6.8, 0.12, 0.12);
    const col = this.col(40, 0, 17.9, 43.2, 3, 18.12, 'metal', 'bigDoor'); col.on = false;
    this.bigDoor = { group: g, open: 1, target: 1, col, vel: 0 };
    this.decor.push((dt) => {
      const d = this.bigDoor;
      if (d.open === d.target) return;
      const sp = d.target < d.open ? 2.6 : 1.2;
      d.open = d.target < d.open ? Math.max(d.target, d.open - dt * sp) : Math.min(d.target, d.open + dt * sp);
      g.position.x = 40 + d.open * 3.2;
      const wasOn = d.col.on; d.col.on = d.open < 0.8;
      if (wasOn !== d.col.on) this.refreshNavCell(d.col);
      if (d.open === d.target && d.onDone) { const f = d.onDone; d.onDone = null; f(); }
    });
  }
  signPlate(x, y, z, text, facing, w = 0.8) {
    const c = makeCanvas(256, 64), x2 = ctx2d(c);
    x2.fillStyle = '#e8e2d0'; x2.fillRect(0, 0, 256, 64); x2.strokeStyle = '#1f3a5c'; x2.lineWidth = 4; x2.strokeRect(4, 4, 248, 56);
    x2.fillStyle = '#1f2d44'; x2.font = '900 38px "Noto Serif SC", serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillText(text, 128, 34, 230);
    const m = new THREE.MeshStandardMaterial({ map: toTex(c, { repeat: false }), roughness: 0.6 });
    this.wallPlane(m, x, y, z, w, w / 4, facing);
  }
  paHorn(x, y, z, side) {
    const g = new THREE.Group();
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.24, 0.5, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x5f6b62, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    horn.rotation.z = -side * Math.PI / 2 + side * 0.25;
    const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12), this.mats.steel);
    driver.rotation.z = horn.rotation.z; driver.position.x = -side * 0.3;
    g.add(horn, driver); g.position.set(x, y, z);
    horn.castShadow = true;
    this.root.add(g);
    this.horns.push({ pos: new V3(x + side * 0.3, y, z), group: g });
  }

  // ------------------------------------------------------------------ lamps
  lamp(kind, x, y, z, o) {
    const lamp = { kind, pos: new V3(x, y, z), color: new THREE.Color(o.color), base: o.intensity, range: o.range, flicker: o.flicker, room: o.room, group: o.group, f: 1, on: o.flicker !== 'dead', override: null, phase: Math.random() * 100, state: 1, timer: rand(1, 4), mesh: null, poolSlot: -1, weight: 0 };
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    lamp.bulbMat = bulbMat; lamp.bulbColor = new THREE.Color(o.color);
    if (kind === 'bulb') {
      this.cyl('rubber', x, (y + this.cellAt(x, z).h) / 2, z, 0.006, 0.006, this.cellAt(x, z).h - y, 6);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), bulbMat); b.position.set(x, y - 0.03, z); this.root.add(b);
      this.cyl('enamel', x, y + 0.04, z, 0.03, 0.03, 0.08, 10);
    } else if (kind === 'tube') {
      this.B.box('steel', x, y + 0.02, z, 1.25, 0.05, 0.16);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.18, 8), bulbMat); b.rotation.z = Math.PI / 2; b.position.set(x, y - 0.04, z); this.root.add(b);
    } else if (kind === 'desk') {
      this.cyl('enamel', x, y - 0.3, z, 0.08, 0.1, 0.03, 12); this.cyl('steel', x, y - 0.14, z, 0.01, 0.01, 0.3, 6);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.12, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x2f5a3c, roughness: 0.3, side: THREE.DoubleSide })); shade.position.set(x, y + 0.02, z); this.root.add(shade);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), bulbMat); b.position.set(x, y - 0.01, z); this.root.add(b);
    } else if (kind === 'hang') {
      const g = new THREE.Group(); g.position.set(x, 8, z); this.root.add(g);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 8 - y, 6), this.mats.rubber); wire.position.y = -(8 - y) / 2; g.add(wire);
      const shadeO = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.36, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x3d5b48, roughness: 0.35, side: THREE.FrontSide })); shadeO.position.y = -(8 - y) - 0.02; g.add(shadeO);
      const shadeI = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.355, 0.215, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.3, side: THREE.BackSide, emissive: 0xffc890, emissiveIntensity: 0.4 })); shadeI.position.copy(shadeO.position); g.add(shadeI);
      lamp.shadeMat = shadeI.material;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), bulbMat); b.position.y = -(8 - y) - 0.08; g.add(b);
      lamp.pos.y = y - 0.12;
    }
    this.lamps.push(lamp);
    return lamp;
  }
  initLightPool() {
    for (let i = 0; i < 6; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 10, 2);
      L.castShadow = false; this.scene.add(L);
      this.pool.push({ light: L, lamp: null, fade: 0 });
    }
    // One shadow-casting swinging lamp over the centre aisle.
    const sp = new THREE.SpotLight(0xffc27a, 0, 22, 1.0, 0.6, 1.4);
    sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.0004; sp.shadow.normalBias = 0.03; sp.shadow.camera.near = 0.3; sp.shadow.camera.far = 18;
    this.scene.add(sp, sp.target);
    this.swing = { light: sp, anchor: new V3(41, 8, 28.5), len: 2.43, ang: 0.35, vel: 0, angZ: 0, velZ: 0.3, base: 70, f: 1, flicker: 'slight', on: true, override: null, phase: 3.3 };
    const g = new THREE.Group(); this.root.add(g);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.3, 6), this.mats.rubber); wire.position.y = -1.15; g.add(wire);
    const shadeO = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.42, 0.26, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x3d5b48, roughness: 0.35 })); shadeO.position.y = -2.35; g.add(shadeO);
    const shadeI = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.415, 0.255, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.3, side: THREE.BackSide, emissive: 0xffc890, emissiveIntensity: 0.5 })); shadeI.position.y = -2.35; g.add(shadeI);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); bulb.position.y = -2.43; g.add(bulb);
    g.position.copy(this.swing.anchor);
    this.swing.group = g; this.swing.bulbMat = bulb.material; this.swing.shadeMat = shadeI.material;
  }
  kickSwing(amount) { this.swing.vel += amount; this.swing.velZ += amount * 0.6 * (Math.random() < 0.5 ? -1 : 1); }

  flickerValue(l, dt, t) {
    if (!l.on) return 0;
    if (l.override !== null) return l.override;
    switch (l.flicker) {
      case 'none': return 1;
      case 'slight': return 0.93 + 0.07 * Noise1(t * 6 + l.phase);
      case 'bad': {
        l.timer -= dt;
        if (l.timer <= 0) { l.state = l.state ? 0 : 1; l.timer = l.state ? rand(0.4, 5) : rand(0.03, 0.18); }
        return l.state ? 0.9 + 0.1 * Noise1(t * 30 + l.phase) : 0.06;
      }
      case 'dying': {
        l.timer -= dt;
        if (l.timer <= 0) { l.state = l.state ? 0 : 1; l.timer = l.state ? rand(0.03, 0.12) : (chance(0.3) ? rand(0.04, 0.12) : rand(0.8, 3.5)); }
        return l.state ? 0.85 : 0.0;
      }
      default: return 1;
    }
  }
  update(dt, t, eye) {
    // Lamp states and fixture glow.
    for (const l of this.lamps) {
      const target = this.flickerValue(l, dt, t) * (l.dim === undefined ? 1 : l.dim);
      l.f = l.flicker === 'bad' || l.flicker === 'dying' ? target : damp(l.f, target, 20, dt);
      const tint = l.tint || l.color;
      l.bulbMat.color.copy(tint).multiplyScalar(0.2 + l.f * (l.kind === 'tube' ? 5 : 7));
      if (l.shadeMat) { l.shadeMat.emissive.copy(tint); l.shadeMat.emissiveIntensity = 0.05 + l.f * 0.55; }
      l.weight = (l.base > 0 && l.on) ? eye.distanceTo(l.pos) : 999;
    }
    // Assign the nearest lamps to the light pool with fades.
    const want = this.lamps.filter((l) => l.base > 0 && l.weight < 30).sort((a, b) => a.weight - b.weight).slice(0, this.pool.length);
    for (const s of this.pool) {
      if (s.lamp && !want.includes(s.lamp)) { s.fade -= dt * 4; if (s.fade <= 0) { s.lamp.poolSlot = -1; s.lamp = null; s.fade = 0; } }
    }
    for (const l of want) {
      if (l.poolSlot >= 0) continue;
      const s = this.pool.find((q) => !q.lamp);
      if (!s) break;
      s.lamp = l; l.poolSlot = this.pool.indexOf(s); s.fade = 0;
      s.light.position.copy(l.pos); s.light.distance = l.range;
    }
    for (const s of this.pool) {
      if (!s.lamp) { s.light.intensity = 0; continue; }
      if (want.includes(s.lamp)) s.fade = Math.min(1, s.fade + dt * 4);
      const l = s.lamp;
      s.light.color.copy(l.tint || l.color);
      s.light.intensity = l.base * l.f * s.fade * TUNE.brightness;
      s.light.position.copy(l.pos);
    }
    // Swinging lamp pendulum (two axes).
    const sw = this.swing;
    sw.vel += (-9.8 / sw.len * Math.sin(sw.ang)) * dt; sw.vel *= Math.exp(-0.08 * dt); sw.ang += sw.vel * dt;
    sw.velZ += (-9.8 / sw.len * Math.sin(sw.angZ)) * dt; sw.velZ *= Math.exp(-0.08 * dt); sw.angZ += sw.velZ * dt;
    sw.group.rotation.set(sw.ang, 0, sw.angZ);
    // Euler XYZ applies Z first, then X: bulb = anchor + Rx(Rz((0, -L, 0))).
    const L = sw.len;
    const bx = sw.anchor.x + L * Math.sin(sw.angZ);
    const by = sw.anchor.y - L * Math.cos(sw.angZ) * Math.cos(sw.ang);
    const bz = sw.anchor.z - L * Math.cos(sw.angZ) * Math.sin(sw.ang);
    sw.light.position.set(bx, by, bz);
    sw.light.target.position.set(bx + (bx - sw.anchor.x) * 3, by + (by - sw.anchor.y) * 3, bz + (bz - sw.anchor.z) * 3);
    sw.light.shadow.autoUpdate = eye.x > 24 && eye.z > 10.5;
    const sf = this.flickerValue(sw, dt, t) * (sw.dim === undefined ? 1 : sw.dim);
    sw.f = damp(sw.f, sf, 20, dt);
    const stint = sw.tint || sw.light.color;
    sw.light.intensity = sw.base * sw.f * TUNE.brightness;
    if (sw.tint) sw.light.color.copy(sw.tint); else sw.light.color.setHex(0xffc27a);
    sw.bulbMat.color.setRGB(1, 0.8, 0.55).multiplyScalar(0.2 + sw.f * 7); if (sw.tint) sw.bulbMat.color.copy(sw.tint).multiplyScalar(0.2 + sw.f * 7);
    sw.shadeMat.emissive.copy(stint); sw.shadeMat.emissiveIntensity = 0.05 + sw.f * 0.6;
    // Doors.
    for (const id in this.doors) {
      const d = this.doors[id];
      if (d.angle !== d.target || Math.abs(d.vel) > 0.001) {
        const k = d.burst ? 90 : 20;
        d.vel += ((d.target - d.angle) * k - d.vel * (d.burst ? 7 : 9)) * dt;
        d.angle += d.vel * dt;
        if (d.angle > 1.02) { d.angle = 1.02; d.vel *= -0.35; }
        if (Math.abs(d.target - d.angle) < 0.001 && Math.abs(d.vel) < 0.01) { d.angle = d.target; d.vel = 0; d.burst = false; }
        const was = d.collider.on;
        d.apply();
        if (was !== d.collider.on) this.refreshNavCell(d.collider);
      }
    }
    for (const f of this.decor) f(dt, t);
  }
  setGroupLights(group, o) {
    for (const l of this.lamps) if (l.group === group || (group === 'ws' && l.room === 'workshop')) {
      if ('tint' in o) l.tint = o.tint ? new THREE.Color(o.tint) : null;
      if ('dim' in o) l.dim = o.dim;
      if ('override' in o) l.override = o.override;
    }
    if (group === 'ws') { if ('tint' in o) this.swing.tint = o.tint ? new THREE.Color(o.tint) : null; if ('dim' in o) this.swing.dim = o.dim; if ('override' in o) this.swing.override = o.override; }
  }

  // ------------------------------------------------------------------ navigation
  buildNav() {
    const NS = 2; // cells per metre
    this.nw = MAP_W * NS; this.nh = MAP_H * NS; this.ns = NS;
    const N = this.nw * this.nh;
    this.navBlocked = new Uint8Array(N);
    this.flow = new Float32Array(N).fill(1e9);
    const R = 0.32;
    for (let j = 0; j < this.nh; j++) for (let i = 0; i < this.nw; i++) {
      const px = (i + 0.5) / NS, pz = (j + 0.5) / NS;
      let blocked = false;
      for (let dz = -1; dz <= 1 && !blocked; dz++) for (let dx = -1; dx <= 1 && !blocked; dx++) {
        const cx = Math.floor(px + dx * R), cz = Math.floor(pz + dz * R);
        if (!this.cell(cx, cz)) blocked = true;
      }
      if (!blocked) for (const b of this.boxes) {
        if (b.y0 > 1.0 || b.y1 < 0.3) continue;
        if (px > b.x0 - R && px < b.x1 + R && pz > b.z0 - R && pz < b.z1 + R) { blocked = true; break; }
      }
      this.navBlocked[j * this.nw + i] = blocked ? 1 : 0;
    }
    this.heap = new Int32Array(N * 8); this.heapKey = new Float32Array(N * 8);
    this.flowTarget = -1; this.flowTime = -1;
  }
  refreshNavCell(b) {
    // Recompute nav blocking around a collider that changed (doors).
    const NS = this.ns, R = 0.32;
    const i0 = Math.max(0, Math.floor((b.x0 - 1) * NS)), i1 = Math.min(this.nw - 1, Math.ceil((b.x1 + 1) * NS));
    const j0 = Math.max(0, Math.floor((b.z0 - 1) * NS)), j1 = Math.min(this.nh - 1, Math.ceil((b.z1 + 1) * NS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) / NS, pz = (j + 0.5) / NS;
      let blocked = false;
      for (let dz = -1; dz <= 1 && !blocked; dz++) for (let dx = -1; dx <= 1 && !blocked; dx++) if (!this.cell(Math.floor(px + dx * R), Math.floor(pz + dz * R))) blocked = true;
      if (!blocked) for (const q of this.boxes) { if (!q.on || q.y0 > 1.0 || q.y1 < 0.3) continue; if (px > q.x0 - R && px < q.x1 + R && pz > q.z0 - R && pz < q.z1 + R) { blocked = true; break; } }
      this.navBlocked[j * this.nw + i] = blocked ? 1 : 0;
    }
    this.flowTarget = -1;
  }
  navIndex(x, z) { const i = clamp(Math.floor(x * this.ns), 0, this.nw - 1), j = clamp(Math.floor(z * this.ns), 0, this.nh - 1); return j * this.nw + i; }
  // Dijkstra flow field toward (x, z).
  computeFlow(x, z) {
    let start = this.navIndex(x, z);
    if (this.navBlocked[start]) {
      const si = start % this.nw, sj = (start / this.nw) | 0; let best = -1, bd = 1e9;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const ii = si + di, jj = sj + dj; if (ii < 0 || jj < 0 || ii >= this.nw || jj >= this.nh) continue; const k = jj * this.nw + ii; if (!this.navBlocked[k] && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = k; } }
      if (best < 0) return; start = best;
    }
    if (start === this.flowTarget) return;
    this.flowTarget = start; this.flowTime = G.time;
    const W = this.nw, H = this.nh, D = this.flow, blk = this.navBlocked, heap = this.heap, key = this.heapKey;
    D.fill(1e9); D[start] = 0;
    let n = 0;
    const push = (k, d) => { let i = n++; heap[i] = k; key[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= key[i]) break; const tk = heap[p], td = key[p]; heap[p] = heap[i]; key[p] = key[i]; heap[i] = tk; key[i] = td; i = p; } };
    const pop = () => { const top = heap[0]; n--; heap[0] = heap[n]; key[0] = key[n]; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < n && key[l] < key[m]) m = l; if (r < n && key[r] < key[m]) m = r; if (m === i) break; const tk = heap[m], td = key[m]; heap[m] = heap[i]; key[m] = key[i]; heap[i] = tk; key[i] = td; i = m; } return top; };
    push(start, 0);
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (n > 0) {
      const d0 = key[0]; const k = pop();
      if (d0 > D[k]) continue;
      const i = k % W, j = (k / W) | 0;
      for (const [di, dj, c] of dirs) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const kk = jj * W + ii; if (blk[kk]) continue;
        if (di && dj && (blk[j * W + ii] || blk[jj * W + i])) continue;
        const nd = d0 + c; if (nd < D[kk]) { D[kk] = nd; push(kk, nd); }
      }
    }
  }
  // Direction along the flow field from (x, z). Returns false if no path.
  flowDir(x, z, out) {
    const W = this.nw, k = this.navIndex(x, z), i = k % W, j = (k / W) | 0, D = this.flow, blk = this.navBlocked;
    let best = D[k], bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= this.nh) continue;
      const kk = jj * W + ii; if (blk[kk]) continue;
      if (di && dj && (blk[j * W + ii] || blk[jj * W + i])) continue;
      if (D[kk] < best) { best = D[kk]; bi = ii; bj = jj; }
    }
    if (bi < 0) return false;
    out.set((bi + 0.5) / this.ns - x, 0, (bj + 0.5) / this.ns - z);
    const l = out.length(); if (l < 1e-4) return false; out.divideScalar(l);
    return true;
  }
  flowDist(x, z) { return this.flow[this.navIndex(x, z)] / this.ns; }
  isWalkable(x, z) { return !this.navBlocked[this.navIndex(x, z)]; }

  // ------------------------------------------------------------------ collision
  collideCircle(p, r, opts = {}) {
    let hit = false;
    for (let it = 0; it < 2; it++) {
      const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r), z0 = Math.floor(p.z - r), z1 = Math.floor(p.z + r);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!this.cell(x, z)) hit = pushOut(p, r, x, x + 1, z, z + 1) || hit;
      if (!opts.noProps) for (const b of this.boxes) {
        if (!b.on || b.y0 > 1.0 || b.y1 < 0.25) continue;
        if (p.x + r < b.x0 || p.x - r > b.x1 || p.z + r < b.z0 || p.z - r > b.z1) continue;
        hit = pushOut(p, r, b.x0, b.x1, b.z0, b.z1) || hit;
      }
    }
    return hit;
  }

  // ------------------------------------------------------------------ rays
  // Ray against walls/floor/ceiling via grid DDA.
  rayGrid(ro, rd, maxT) {
    let cx = Math.floor(ro.x), cz = Math.floor(ro.z);
    const sx = rd.x > 0 ? 1 : -1, sz = rd.z > 0 ? 1 : -1;
    const tdx = rd.x !== 0 ? Math.abs(1 / rd.x) : 1e9, tdz = rd.z !== 0 ? Math.abs(1 / rd.z) : 1e9;
    let tmx = rd.x !== 0 ? (rd.x > 0 ? (cx + 1 - ro.x) / rd.x : (ro.x - cx) / -rd.x) : 1e9;
    let tmz = rd.z !== 0 ? (rd.z > 0 ? (cz + 1 - ro.z) / rd.z : (ro.z - cz) / -rd.z) : 1e9;
    let t = 0, axis = -1;
    for (let guard = 0; guard < 400; guard++) {
      const c = this.cell(cx, cz);
      if (!c) return this._hit(t, axis === 0 ? -sx : 0, 0, axis === 2 ? -sz : 0, this._wallSurf(cx - (axis === 0 ? sx : 0), cz - (axis === 2 ? sz : 0)));
      const tExit = Math.min(tmx, tmz, maxT);
      if (rd.y < 0) { const tf = -ro.y / rd.y; if (tf >= t - 1e-6 && tf <= tExit) return this._hit(tf, 0, 1, 0, SURF[c.floor] || 'concrete'); }
      else if (rd.y > 0) { const tc = (c.h - ro.y) / rd.y; if (tc >= t - 1e-6 && tc <= tExit) return this._hit(tc, 0, -1, 0, 'plaster'); }
      if (tExit >= maxT) return null;
      if (tmx < tmz) { t = tmx; tmx += tdx; cx += sx; axis = 0; } else { t = tmz; tmz += tdz; cz += sz; axis = 2; }
      const n = this.cell(cx, cz);
      if (n && ro.y + rd.y * t > n.h) return this._hit(t, axis === 0 ? -sx : 0, 0, axis === 2 ? -sz : 0, 'plaster');
    }
    return null;
  }
  _wallSurf(cx, cz) { const c = this.cell(cx, cz); return c ? (SURF[c.wall] || 'plaster') : 'plaster'; }
  _hit(t, nx, ny, nz, surf) { return { t, nx, ny, nz, surf, box: null }; }
  rayBoxes(ro, rd, maxT, best, filter) {
    const ix = 1 / (rd.x || 1e-9), iy = 1 / (rd.y || 1e-9), iz = 1 / (rd.z || 1e-9);
    for (const b of this.boxes) {
      if (!b.on || (filter && !filter(b))) continue;
      let t1 = (b.x0 - ro.x) * ix, t2 = (b.x1 - ro.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
      t1 = (b.y0 - ro.y) * iy; t2 = (b.y1 - ro.y) * iy;
      let n0 = Math.min(t1, t2); if (n0 > tmin) { tmin = n0; ax = 1; } tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.z0 - ro.z) * iz; t2 = (b.z1 - ro.z) * iz;
      n0 = Math.min(t1, t2); if (n0 > tmin) { tmin = n0; ax = 2; } tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < Math.max(tmin, 0) || tmin > maxT) continue;
      if (tmin < 0) continue;
      if (!best || tmin < best.t) {
        best = { t: tmin, nx: ax === 0 ? -Math.sign(rd.x) : 0, ny: ax === 1 ? -Math.sign(rd.y) : 0, nz: ax === 2 ? -Math.sign(rd.z) : 0, surf: b.surf, box: b };
      }
    }
    return best;
  }
  raycast(ro, rd, maxT = 80, filter) {
    let best = this.rayGrid(ro, rd, maxT);
    best = this.rayBoxes(ro, rd, best ? best.t : maxT, best, filter);
    if (best) best.point = new V3(ro.x + rd.x * best.t, ro.y + rd.y * best.t, ro.z + rd.z * best.t);
    return best;
  }
  // Line of sight between two points, ignoring props lower than the line.
  los(a, b, ignoreLow = true) {
    _v1.subVectors(b, a); const d = _v1.length(); if (d < 1e-4) return true; _v1.divideScalar(d);
    const g = this.rayGrid(a, _v1, d - 0.05);
    if (g) return false;
    const hit = this.rayBoxes(a, _v1, d - 0.05, null, ignoreLow ? (q) => q.y1 > 1.35 : null);
    return !hit;
  }
}

function pushOut(p, r, x0, x1, z0, z1) {
  const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); p.x += dx / d * (r - d); p.z += dz / d * (r - d); }
  else {
    const l = p.x - x0, rr = x1 - p.x, t = p.z - z0, b = z1 - p.z, m = Math.min(l, rr, t, b);
    if (m === l) p.x = x0 - r; else if (m === rr) p.x = x1 + r; else if (m === t) p.z = z0 - r; else p.z = z1 + r;
  }
  return true;
}
