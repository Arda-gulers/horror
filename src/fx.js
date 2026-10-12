'use strict';
// Visual feedback: particles, spark streaks, physical debris, decals, muzzle light, dust motes.

const PARTICLE_VS = `
attribute float size; attribute float alpha; attribute vec3 color;
uniform float uScale;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.05, -mv.z);
  vAlpha = alpha; vColor = color;
}`;
const PARTICLE_FS = `
uniform sampler2D map;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

class ParticlePool {
  constructor(scene, cap, additive, tex) {
    this.cap = cap; this.i = 0;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, uScale: { value: 600 } }, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.drag = new Float32Array(cap); this.grav = new Float32Array(cap); this.grow = new Float32Array(cap); this.a0 = new Float32Array(cap); this.s0 = new Float32Array(cap);
    this.fadeIn = new Float32Array(cap); this.kind = new Uint8Array(cap); this.base = new Float32Array(cap * 3);
  }
  spawn(x, y, z, vx, vy, vz, o) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const c = o.color;
    this.base[i * 3] = c[0]; this.base[i * 3 + 1] = c[1]; this.base[i * 3 + 2] = c[2];
    this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    this.life[i] = this.max[i] = o.life; this.drag[i] = o.drag ?? 2; this.grav[i] = o.grav ?? 0; this.grow[i] = o.grow ?? 0;
    this.a0[i] = o.alpha ?? 1; this.s0[i] = o.size; this.size[i] = o.size; this.alpha[i] = o.fadeIn ? 0 : this.a0[i]; this.fadeIn[i] = o.fadeIn || 0; this.kind[i] = o.kind || 0;
    return i;
  }
  update(dt, onFloor) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= k; V[i * 3 + 1] = V[i * 3 + 1] * k - this.grav[i] * dt; V[i * 3 + 2] *= k;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < 0.01) {
        P[i * 3 + 1] = 0.01;
        if (this.kind[i] === 1 && onFloor) { onFloor(P[i * 3], P[i * 3 + 2]); this.life[i] = 0; continue; }
        V[i * 3 + 1] *= -0.2; V[i * 3] *= 0.5; V[i * 3 + 2] *= 0.5;
      }
      const t = 1 - this.life[i] / this.max[i];
      this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
      const fin = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      this.alpha[i] = this.a0[i] * fin * (1 - t) * (1 - t * 0.3);
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; }
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.color.needsUpdate = true;
  }
}

// Short bright streaks for sparks.
class SparkPool {
  constructor(scene, cap) {
    this.cap = cap; this.i = 0;
    this.pos = new Float32Array(cap * 6); this.col = new Float32Array(cap * 6);
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.heat = new Float32Array(cap);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false; scene.add(this.lines);
  }
  spawn(x, y, z, vx, vy, vz, life, heat = 1) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life; this.heat[i] = heat;
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      const o = i * 6;
      if (this.life[i] <= 0) { for (let k = 0; k < 6; k++) { this.col[o + k] = 0; } continue; }
      this.life[i] -= dt;
      const p = this.p, v = this.v, j = i * 3;
      v[j + 1] -= 9.8 * dt; v[j] *= Math.exp(-1.5 * dt); v[j + 2] *= Math.exp(-1.5 * dt);
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < 0.01) { p[j + 1] = 0.01; v[j + 1] *= -0.35; v[j] *= 0.6; v[j + 2] *= 0.6; }
      const t = this.life[i] / this.max[i], s = 0.018;
      this.pos[o] = p[j]; this.pos[o + 1] = p[j + 1]; this.pos[o + 2] = p[j + 2];
      this.pos[o + 3] = p[j] - v[j] * s; this.pos[o + 4] = p[j + 1] - v[j + 1] * s; this.pos[o + 5] = p[j + 2] - v[j + 2] * s;
      const h = this.heat[i] * t;
      const r = 6 * h, gg = 3.2 * h * h, b = 1.2 * h * h * h;
      this.col[o] = r; this.col[o + 1] = gg; this.col[o + 2] = b;
      this.col[o + 3] = r * 0.4; this.col[o + 4] = gg * 0.3; this.col[o + 5] = b * 0.2;
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true;
  }
}

// Instanced rigid debris with simple floor/wall collision.
class DebrisPool {
  constructor(scene, geo, mat, cap, o = {}) {
    this.cap = cap; this.i = 0; this.o = o;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = !!o.shadow; this.mesh.receiveShadow = false; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < cap; i++) { this.items.push({ p: new V3(0, -10, 0), v: new V3(), q: new THREE.Quaternion(), w: new V3(), life: 0, rest: false, bounces: 0, s: 1 }); this.write(i); }
    this.half = o.half || 0.01;
  }
  write(i) { const it = this.items[i]; _m1.compose(it.p, it.q, _v4.set(it.s, it.s, it.s)); this.mesh.setMatrixAt(i, _m1); }
  spawn(p, v, o = {}) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    const it = this.items[i];
    it.p.copy(p); it.v.copy(v); it.q.setFromEuler(_e1.set(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
    it.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(o.spin ?? 25);
    it.life = o.life ?? 20; it.rest = false; it.bounces = 0; it.s = o.scale ?? 1;
    if (o.color && this.mesh.instanceColor !== undefined) { this.mesh.setColorAt(i, o.color); if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
    this.write(i);
    return it;
  }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.p.y = -10; this.write(i); dirty = true; continue; }
      if (it.rest) continue;
      it.v.y -= 9.8 * dt;
      it.p.addScaledVector(it.v, dt);
      const h = this.half * it.s;
      if (it.p.y < h) {
        it.p.y = h;
        const speed = Math.abs(it.v.y);
        if (speed > 0.6 && this.o.onBounce && it.bounces < 3) this.o.onBounce(it, speed);
        it.bounces++;
        it.v.y = -it.v.y * (this.o.bounce ?? 0.35); it.v.x *= 0.55; it.v.z *= 0.55; it.w.multiplyScalar(0.6);
        if (Math.abs(it.v.y) < 0.25 && it.v.lengthSq() < 0.06) { it.rest = true; it.v.set(0, 0, 0); it.q.setFromEuler(_e1.set(Math.PI / 2 * (this.o.lie ? 1 : 0), rand(0, TAU), 0)); }
      }
      const L = G.level;
      if (L && !L.cellAt(it.p.x, it.p.z)) { it.p.addScaledVector(it.v, -dt); it.v.x *= -0.4; it.v.z *= -0.4; }
      _q1.setFromEuler(_e1.set(it.w.x * dt, it.w.y * dt, it.w.z * dt)); it.q.multiply(_q1);
      this.write(i); dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (let i = 0; i < this.cap; i++) { this.items[i].life = 0; this.items[i].p.y = -10; this.write(i); } this.mesh.instanceMatrix.needsUpdate = true; }
}

class DecalPool {
  constructor(scene, tex, cap, o = {}) {
    this.cap = cap; this.i = 0;
    this.mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0, color: o.color ?? 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, cap);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 2;
    _m1.makeScale(0, 0, 0); for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m1);
    scene.add(this.mesh);
    this.grow = [];
  }
  add(p, n, size, rot = Math.random() * TAU, growTo = 0) {
    const i = this.i; this.i = (this.i + 1) % this.cap;
    const q = new THREE.Quaternion().setFromUnitVectors(_v1.set(0, 0, 1), _v2.set(n.x, n.y, n.z).normalize());
    q.multiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), rot));
    const pos = new V3(p.x + n.x * 0.006, p.y + n.y * 0.006, p.z + n.z * 0.006);
    _m1.compose(pos, q, _v3.set(size, size, size));
    this.mesh.setMatrixAt(i, _m1); this.mesh.instanceMatrix.needsUpdate = true;
    this.grow = this.grow.filter((g) => g.i !== i);
    if (growTo > 0) this.grow.push({ i, pos, q, s: size, to: growTo, rate: rand(0.08, 0.14) });
  }
  update(dt) {
    if (!this.grow.length) return;
    for (const g of this.grow) { g.s = Math.min(g.to, g.s + g.rate * dt); _m1.compose(g.pos, g.q, _v3.set(g.s, g.s, g.s)); this.mesh.setMatrixAt(g.i, _m1); }
    this.grow = this.grow.filter((g) => g.s < g.to);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { _m1.makeScale(0, 0, 0); for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, _m1); this.mesh.instanceMatrix.needsUpdate = true; this.grow = []; }
}

class FX {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticlePool(scene, 900, true, TEX.softDot);
    this.smoke = new ParticlePool(scene, 900, false, TEX.smoke);
    this.drops = new ParticlePool(scene, 700, false, TEX.softDot);
    this.sparks = new SparkPool(scene, 360);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.28 });
    this.casings = new DebrisPool(scene, new THREE.CylinderGeometry(0.0048, 0.0048, 0.024, 8), brass, 60, { half: 0.005, bounce: 0.45, lie: true, onBounce: (it, s) => { if (it.bounces === 0) G.audio.casing(it.p, false); } });
    const shellGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 0.068, 10); shellGeo.translate(0, 0.0, 0);
    this.shells = new DebrisPool(scene, shellGeo, new THREE.MeshStandardMaterial({ color: 0x9c2c22, roughness: 0.55 }), 30, { half: 0.011, bounce: 0.3, lie: true, onBounce: (it) => { if (it.bounces === 0) G.audio.casing(it.p, true); } });
    const shardGeo = new THREE.BufferGeometry();
    shardGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.012, 0.02, 0, -0.01, -0.016, 0.004, -0.012, 0, 0.004, 0.012, -0.016, 0.004, -0.012, 0.02, 0.004, -0.01, 0, 0, 0.012, 0, 0.004, 0.012, 0.02, 0, -0.01, 0.02, 0, -0.01, 0, 0.004, 0.012, 0.02, 0.004, -0.01], 3));
    shardGeo.computeVertexNormals();
    this.shards = new DebrisPool(scene, shardGeo, new THREE.MeshStandardMaterial({ color: 0xf1ede3, roughness: 0.18, metalness: 0.0, side: THREE.DoubleSide }), 160, { half: 0.004, bounce: 0.4, lie: false });
    this.chips = new DebrisPool(scene, new THREE.BoxGeometry(0.012, 0.01, 0.014), new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.9 }), 90, { half: 0.006, bounce: 0.3 });
    this.splinters = new DebrisPool(scene, new THREE.BoxGeometry(0.006, 0.006, 0.04), new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 0.8 }), 60, { half: 0.004, bounce: 0.3 });
    this.mags = new DebrisPool(scene, new THREE.BoxGeometry(0.022, 0.1, 0.034), new THREE.MeshStandardMaterial({ map: TEX.gunMetal, metalness: 0.7, roughness: 0.4 }), 10, { half: 0.012, bounce: 0.25, lie: true, shadow: true });
    this.decals = {
      concrete: new DecalPool(scene, TEX.holeConcrete, 140), plaster: null, metal: new DecalPool(scene, TEX.holeMetal, 90, { roughness: 0.4, metalness: 0.4 }),
      wood: new DecalPool(scene, TEX.holeWood, 60), glass: new DecalPool(scene, TEX.glassCrack, 20, { roughness: 0.1 }),
      blood: [0, 1, 2].map((k) => new DecalPool(scene, TEX['blood' + k], 70, { roughness: 0.3 })), pool: new DecalPool(scene, TEX.pool, 24, { roughness: 0.15 }),
    };
    this.decals.plaster = this.decals.concrete; this.decals.tile = this.decals.concrete;
    this.muzzleLight = new THREE.PointLight(0xffa24a, 0, 14, 2); scene.add(this.muzzleLight);
    this.flash = 0; this.flashPeak = 0;
    this.initMotes();
    this.floorBlood = (x, z) => { if (chance(0.35) && TUNE.fx.decals) this.decals.blood[randi(0, 2)].add(_v3.set(x, 0.002, z), { x: 0, y: 1, z: 0 }, rand(0.05, 0.14)); };
  }
  // Brightness at a point from the flashlight, muzzle flash and lamps, for unlit sprites.
  lightAt(p) {
    let b = 0.08;
    const pl = G.player;
    if (pl && pl.flashlight && pl.flashlightOn) {
      const L = pl.flashlight; _v4.subVectors(p, L.position); const d = _v4.length(); _v4.divideScalar(d || 1);
      const c = _v4.dot(pl.flashDir); b += smooth(clamp01((c - 0.9) / 0.08)) * 1.2 / (1 + d * d * 0.03);
    }
    b += this.flash * 1.5;
    if (G.level) for (const s of G.level.pool) { if (!s.lamp) continue; const d2 = s.light.position.distanceToSquared(p); b += s.light.intensity / (d2 + 1) * 0.12; }
    return clamp(b, 0.05, 1.6);
  }
  // ------------------------------------------------------------------ effects
  muzzle(pos, dir, big) {
    if (TUNE.fx.muzzleLight) { this.flashPeak = big ? 95 : 55; this.flash = 1; this.muzzleLight.position.copy(pos); }
    for (let i = 0; i < (big ? 10 : 5); i++) {
      const s = rand(0.3, 1.2);
      this.smoke.spawn(pos.x + dir.x * 0.05, pos.y + dir.y * 0.05, pos.z + dir.z * 0.05, dir.x * s + rand(-0.2, 0.2), dir.y * s + rand(0, 0.3), dir.z * s + rand(-0.2, 0.2), { color: [0.5, 0.48, 0.45], size: big ? 0.16 : 0.1, grow: 3, life: rand(0.5, 1.1), drag: 3, grav: -0.15, alpha: big ? 0.22 : 0.14, fadeIn: 0.1 });
    }
    for (let i = 0; i < (big ? 14 : 4); i++) this.sparks.spawn(pos.x, pos.y, pos.z, dir.x * rand(4, 9) + rand(-1.5, 1.5), dir.y * rand(4, 9) + rand(-1, 1.5), dir.z * rand(4, 9) + rand(-1.5, 1.5), rand(0.05, 0.18), 0.8);
  }
  impact(p, n, surf, dir, strength = 1) {
    const L = this.lightAt(p);
    const tan = _v4.set(n.x, n.y, n.z);
    // Reflected spray direction.
    const dn = dir.x * n.x + dir.y * n.y + dir.z * n.z;
    const rx = dir.x - 2 * dn * n.x, ry = dir.y - 2 * dn * n.y, rz = dir.z - 2 * dn * n.z;
    if (surf === 'metal') {
      for (let i = 0; i < 10 * strength; i++) this.sparks.spawn(p.x, p.y, p.z, (rx + rand(-0.6, 0.6)) * rand(3, 8), (ry + rand(-0.3, 0.9)) * rand(3, 8), (rz + rand(-0.6, 0.6)) * rand(3, 8), rand(0.15, 0.5), 1);
      this.add.spawn(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02, 0, 0, 0, { color: [4, 2.6, 1.3], size: 0.14, life: 0.06, drag: 0 });
      this.flash = Math.max(this.flash, 0.25);
    } else {
      const col = surf === 'wood' ? [0.42, 0.32, 0.22] : surf === 'tile' ? [0.8, 0.8, 0.76] : [0.62, 0.6, 0.55];
      for (let i = 0; i < 7 * strength; i++) {
        const s = rand(0.4, 2.2);
        this.smoke.spawn(p.x + n.x * 0.03, p.y + n.y * 0.03, p.z + n.z * 0.03, (n.x + rand(-0.5, 0.5) + rx * 0.4) * s, (n.y + rand(-0.3, 0.6) + ry * 0.4) * s, (n.z + rand(-0.5, 0.5) + rz * 0.4) * s,
          { color: [col[0] * L, col[1] * L, col[2] * L], size: rand(0.05, 0.12), grow: 3.5, life: rand(0.5, 1.3), drag: 4, grav: 0.4, alpha: 0.55 });
      }
      const pool = surf === 'wood' ? this.splinters : this.chips;
      for (let i = 0; i < 4 * strength; i++) pool.spawn(_v3.set(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02), new V3((n.x + rand(-0.7, 0.7)) * rand(1, 3), (n.y + rand(0, 1)) * rand(1, 3), (n.z + rand(-0.7, 0.7)) * rand(1, 3)), { life: 8 });
      if (chance(0.3)) for (let i = 0; i < 3; i++) this.sparks.spawn(p.x, p.y, p.z, (rx + rand(-0.5, 0.5)) * 4, (ry + rand(0, 0.6)) * 4, (rz + rand(-0.5, 0.5)) * 4, rand(0.05, 0.12), 0.7);
    }
    if (TUNE.fx.decals) { const d = this.decals[surf] || this.decals.concrete; d.add(p, n, surf === 'metal' ? rand(0.035, 0.05) : rand(0.05, 0.075)); }
  }
  // Blood from a flesh hit; also paints the wall behind the target.
  blood(p, dir, amount = 1) {
    if (!TUNE.fx.gore) amount *= 0.3;
    const L = this.lightAt(p);
    for (let i = 0; i < 10 * amount; i++) {
      const s = rand(0.5, 2.6);
      this.smoke.spawn(p.x, p.y, p.z, (dir.x + rand(-0.4, 0.4)) * s, (dir.y + rand(-0.3, 0.5)) * s, (dir.z + rand(-0.4, 0.4)) * s, { color: [0.16 * L, 0.02 * L, 0.02 * L], size: rand(0.06, 0.14), grow: 2.4, life: rand(0.35, 0.8), drag: 5, grav: 0.8, alpha: 0.75 });
    }
    for (let i = 0; i < 16 * amount; i++) {
      const s = rand(1, 4.5);
      this.drops.spawn(p.x, p.y, p.z, (dir.x + rand(-0.35, 0.35)) * s, (dir.y + rand(-0.2, 0.6)) * s, (dir.z + rand(-0.35, 0.35)) * s, { color: [0.2 * L, 0.02 * L, 0.02 * L], size: rand(0.012, 0.03), life: rand(0.6, 1.4), drag: 0.6, grav: 9.8, alpha: 1, kind: 1 });
    }
    if (TUNE.fx.decals && TUNE.fx.gore) {
      const hit = G.level.raycast(p, dir, 2.4);
      if (hit) this.decals.blood[hit.ny > 0.5 ? randi(0, 1) : 2].add(hit.point, { x: hit.nx, y: hit.ny, z: hit.nz }, rand(0.25, 0.55) * Math.min(1.6, amount), hit.ny > 0.5 ? Math.random() * TAU : Math.atan2(dir.y, 1) + rand(-0.3, 0.3));
    }
  }
  porcelain(p, dir, amount = 1) {
    const L = this.lightAt(p);
    for (let i = 0; i < 5 * amount; i++) this.shards.spawn(p, new V3(dir.x * rand(0.5, 2.5) + rand(-1.2, 1.2), rand(0.5, 2.8), dir.z * rand(0.5, 2.5) + rand(-1.2, 1.2)), { life: 40, spin: 30, scale: rand(0.6, 1.5) });
    for (let i = 0; i < 6 * amount; i++) { const s = rand(0.3, 1.6); this.smoke.spawn(p.x, p.y, p.z, (dir.x + rand(-0.6, 0.6)) * s, rand(-0.2, 0.8) * s, (dir.z + rand(-0.6, 0.6)) * s, { color: [0.85 * L, 0.84 * L, 0.8 * L], size: rand(0.04, 0.09), grow: 3, life: rand(0.4, 0.9), drag: 4, grav: 0.3, alpha: 0.6 }); }
  }
  shatterHead(p, dir) {
    this.porcelain(p, dir, 4.5);
    const L = this.lightAt(p);
    for (let i = 0; i < 26; i++) { const s = rand(0.5, 2.5); this.smoke.spawn(p.x, p.y, p.z, (dir.x * 0.6 + rand(-0.8, 0.8)) * s, rand(-0.2, 1) * s, (dir.z * 0.6 + rand(-0.8, 0.8)) * s, { color: [0.03 * L, 0.02 * L, 0.03 * L], size: rand(0.1, 0.22), grow: 3, life: rand(0.8, 1.8), drag: 3.5, grav: -0.1, alpha: 0.85 }); }
    this.blood(p, dir, 1.2);
  }
  ejectCasing(pos, vel, shell) { if (!TUNE.fx.shells) return; (shell ? this.shells : this.casings).spawn(pos, vel, { life: 25, spin: 30 }); }
  dropMag(pos, vel) { this.mags.spawn(pos, vel, { life: 60, spin: 8 }); G.audio.magDrop(pos); }
  dust(p, amount = 1, spread = 1, col = [0.5, 0.48, 0.44]) {
    const L = this.lightAt(p);
    for (let i = 0; i < 10 * amount; i++) { const a = rand(0, TAU), s = rand(0.3, 1.5) * spread; this.smoke.spawn(p.x + rand(-0.3, 0.3) * spread, p.y + rand(0, 0.2), p.z + rand(-0.3, 0.3) * spread, Math.cos(a) * s, rand(0, 0.5), Math.sin(a) * s, { color: [col[0] * L, col[1] * L, col[2] * L], size: rand(0.15, 0.35), grow: 2, life: rand(0.8, 1.8), drag: 2.5, grav: -0.05, alpha: 0.4 }); }
  }
  pool(p, size) { if (TUNE.fx.decals && TUNE.fx.gore) this.decals.pool.add(_v3.set(p.x, 0.003, p.z), { x: 0, y: 1, z: 0 }, 0.2, Math.random() * TAU, size); }
  staticPuff(p, n = 20) {
    for (let i = 0; i < n; i++) { const s = rand(0.5, 2); this.add.spawn(p.x + rand(-0.4, 0.4), p.y + rand(-0.8, 0.8), p.z + rand(-0.4, 0.4), rand(-1, 1) * s, rand(-1, 1) * s, rand(-1, 1) * s, { color: chance(0.5) ? [1.2, 1.2, 1.3] : [0.2, 0.25, 0.4], size: rand(0.02, 0.06), life: rand(0.1, 0.5), drag: 4 }); }
  }
  // ------------------------------------------------------------------ dust motes
  initMotes() {
    const N = 380, g = new THREE.BufferGeometry();
    this.moteP = new Float32Array(N * 3); this.moteC = new Float32Array(N * 3); this.moteS = new Float32Array(N); this.moteA = new Float32Array(N); this.moteSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.moteP[i * 3] = rand(0, 60); this.moteP[i * 3 + 1] = rand(0.2, 4); this.moteP[i * 3 + 2] = rand(0, 40); this.moteS[i] = rand(0.008, 0.02); this.moteSeed[i] = rand(0, 100); }
    g.setAttribute('position', new THREE.BufferAttribute(this.moteP, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.moteC, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.moteS, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.moteA, 1).setUsage(THREE.DynamicDrawUsage));
    this.moteMat = new THREE.ShaderMaterial({ uniforms: { map: { value: TEX.softDot }, uScale: { value: 600 } }, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.motes = new THREE.Points(g, this.moteMat); this.motes.frustumCulled = false; this.scene.add(this.motes);
    this.moteN = N;
  }
  updateMotes(dt, t) {
    const pl = G.player; if (!pl) return;
    const c = pl.camera.position, R = 5;
    const P = this.moteP;
    for (let i = 0; i < this.moteN; i++) {
      const j = i * 3, s = this.moteSeed[i];
      P[j] += Math.sin(t * 0.21 + s) * 0.03 * dt; P[j + 1] += Math.sin(t * 0.17 + s * 2) * 0.02 * dt - 0.004 * dt; P[j + 2] += Math.cos(t * 0.19 + s) * 0.03 * dt;
      // Wrap around the camera.
      if (P[j] < c.x - R) P[j] += 2 * R; else if (P[j] > c.x + R) P[j] -= 2 * R;
      if (P[j + 2] < c.z - R) P[j + 2] += 2 * R; else if (P[j + 2] > c.z + R) P[j + 2] -= 2 * R;
      if (P[j + 1] < c.y - 1.8) P[j + 1] += 3.6; else if (P[j + 1] > c.y + 1.8) P[j + 1] -= 3.6;
      _v3.set(P[j], P[j + 1], P[j + 2]);
      let b = 0;
      if (pl.flashlightOn) { _v4.subVectors(_v3, pl.flashlight.position); const d = _v4.length(); _v4.divideScalar(d || 1); b = smooth(clamp01((_v4.dot(pl.flashDir) - 0.93) / 0.06)) * clamp01(1.4 - d * 0.22) * clamp01(d * 2 - 0.3); }
      b += this.flash * 0.6;
      this.moteA[i] = b * 0.55; this.moteC[j] = 1; this.moteC[j + 1] = 0.92; this.moteC[j + 2] = 0.8;
    }
    const a = this.motes.geometry.attributes; a.position.needsUpdate = a.alpha.needsUpdate = a.color.needsUpdate = true;
  }
  setScale(s) { this.add.mat.uniforms.uScale.value = s; this.smoke.mat.uniforms.uScale.value = s; this.drops.mat.uniforms.uScale.value = s; this.moteMat.uniforms.uScale.value = s; }
  update(dt, t) {
    this.add.update(dt); this.smoke.update(dt); this.drops.update(dt, this.floorBlood); this.sparks.update(dt);
    this.casings.update(dt); this.shells.update(dt); this.shards.update(dt); this.chips.update(dt); this.splinters.update(dt); this.mags.update(dt);
    for (const k of ['concrete', 'metal', 'wood', 'glass', 'pool']) this.decals[k].update(dt);
    this.decals.blood.forEach((d) => d.update(dt));
    this.flash = Math.max(0, this.flash - dt * 18);
    this.muzzleLight.intensity = this.flashPeak * this.flash * this.flash;
    this.updateMotes(dt, t);
  }
  clearDebris() { [this.casings, this.shells, this.shards, this.chips, this.splinters, this.mags].forEach((p) => p.clear()); }
}
