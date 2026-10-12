'use strict';
// "工友" — the hollow workers. Procedural skeleton + pose blending + spring hit reactions,
// locational damage with poise, perception, attack tokens, grab, and the rule that a body is
// only resting until its porcelain face is broken.

// Pose channels.
const PC = { PX: 0, PY: 1, PZ: 2, PRX: 3, PRY: 4, PRZ: 5, SRX: 6, SRY: 7, SRZ: 8, CRX: 9, CRY: 10, CRZ: 11, NRX: 12, NRY: 13, NRZ: 14, HRX: 15, HRY: 16, HRZ: 17,
  LSX: 18, LSY: 19, LSZ: 20, LE: 21, RSX: 22, RSY: 23, RSZ: 24, RE: 25, LTX: 26, LTZ: 27, LK: 28, LA: 29, RTX: 30, RTZ: 31, RK: 32, RA: 33, N: 34 };

// Global attack tokens keep fights readable: only a few enemies may commit to an attack at once.
const Tokens = {
  holders: new Set(), last: -9,
  request(e) {
    if (this.holders.has(e)) return true;
    if (TUNE.fx.tokens) { if (this.holders.size >= TUNE.tokens) return false; if (G.time - this.last < 0.45) return false; }
    this.holders.add(e); this.last = G.time; return true;
  },
  release(e) { this.holders.delete(e); },
  clear() { this.holders.clear(); },
};

const HOLLOW_TYPES = {
  worker: { hp: 100, head: 100, leg: 55, poise: 40, speed: 1.05, scale: 1, cloth: 0x4b5d73, cap: true },
  guard: { hp: 115, head: 100, leg: 60, poise: 45, speed: 1.1, scale: 1.02, cloth: 0x4c5638, cap: true, capColor: 0x3f4a30 },
  foreman: { hp: 330, head: 170, leg: 140, poise: 120, speed: 0.95, scale: 1.24, cloth: 0x3a3f46, mask: 90 },
};

let hollowShared = null;
function hollowMaterials() {
  if (hollowShared) return hollowShared;
  const geo = {
    pelvis: new THREE.CapsuleGeometry(0.14, 0.1, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.78),
    belly: new THREE.CapsuleGeometry(0.13, 0.12, 4, 10).scale(1.18, 1, 0.8),
    chest: new THREE.CapsuleGeometry(0.16, 0.16, 4, 12).scale(1.24, 1, 0.74),
    neck: new THREE.CapsuleGeometry(0.048, 0.07, 3, 8),
    upper: new THREE.CapsuleGeometry(0.056, 0.2, 3, 8),
    fore: new THREE.CapsuleGeometry(0.047, 0.18, 3, 8),
    hand: new THREE.CapsuleGeometry(0.036, 0.05, 3, 8).scale(1, 1, 0.6),
    thigh: new THREE.CapsuleGeometry(0.078, 0.3, 3, 8),
    shin: new THREE.CapsuleGeometry(0.062, 0.3, 3, 8),
    boot: new THREE.BoxGeometry(0.11, 0.09, 0.26),
    capTop: new THREE.SphereGeometry(0.128, 18, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.5, 1.05),
    brim: new THREE.CylinderGeometry(0.1, 0.1, 0.01, 18, 1, false, -0.9, 1.8).scale(1, 1, 0.9),
    sleeve: new THREE.CylinderGeometry(0.056, 0.052, 0.15, 10),
    stump: new THREE.IcosahedronGeometry(0.06, 1),
    mask: new THREE.BoxGeometry(0.2, 0.22, 0.03),
    apron: new THREE.BoxGeometry(0.34, 0.55, 0.02),
  };
  const sp = geo.stump.attributes.position;
  for (let i = 0; i < sp.count; i++) { const k = 0.6 + Math.random() * 0.8; sp.setXYZ(i, sp.getX(i) * k, sp.getY(i) * (0.5 + Math.random() * 0.9), sp.getZ(i) * k); }
  geo.stump.computeVertexNormals();
  // Face hemisphere with planar UVs (front) and plain back hemisphere.
  const R = 0.11;
  const front = new THREE.SphereGeometry(R, 22, 16, 0, Math.PI);
  const uv = front.attributes.uv, pos = front.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * R) * 0.96, 0.5 + pos.getY(i) / (2 * R) * 0.96);
  geo.faceFront = front;
  geo.faceBack = new THREE.SphereGeometry(R, 22, 16, Math.PI, Math.PI);
  const mats = {
    porcelain: new THREE.MeshPhysicalMaterial({ color: 0xece8de, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, emissive: 0x0b0a09 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x191613, roughness: 0.6 }),
    stump: new THREE.MeshStandardMaterial({ color: 0x0a0405, roughness: 0.35, emissive: 0x090203 }),
    sleeve: new THREE.MeshStandardMaterial({ map: TEX.fabric, color: 0xd8d4c8, roughness: 0.95 }),
    mask: new THREE.MeshStandardMaterial({ map: TEX.steelDark, normalMap: TEX.steelDarkN, color: 0x6a6258, roughness: 0.4, metalness: 0.7 }),
    maskGlass: new THREE.MeshStandardMaterial({ color: 0x0b1a10, roughness: 0.05, metalness: 0.3, emissive: 0x020502 }),
    apron: new THREE.MeshStandardMaterial({ map: TEX.fabric, color: 0x8a7a60, roughness: 0.95 }),
  };
  hollowShared = { geo, mats, cloth: {} };
  return hollowShared;
}
function clothMat(color) {
  const S = hollowMaterials();
  if (!S.cloth[color]) S.cloth[color] = new THREE.MeshStandardMaterial({ map: TEX.fabric, normalMap: TEX.fabricN, color, roughness: 0.93 });
  return S.cloth[color];
}

class Hollow {
  constructor(o) {
    this.type = o.type || 'worker';
    const T = this.T = HOLLOW_TYPES[this.type];
    this.pos = new V3(o.x, 0, o.z);
    this.vel = new V3();
    this.heading = o.heading ?? 0;
    this.scale = T.scale * (o.scale || rand(0.96, 1.04));
    this.hp = T.hp; this.headHP = T.head; this.legHP = [T.leg, T.leg]; this.maskHP = T.mask || 0;
    this.poise = 0; this.maxPoise = T.poise;
    this.speedMul = rand(0.9, 1.12) * T.speed;
    this.work = o.work || 'stand';
    this.state = o.state || 'idle'; this.stateT = 0;
    this.alive = true; this.confirmed = false; this.resting = false; this.crawler = false;
    this.suspicion = 0; this.aware = false; this.noticeDelay = -1;
    this.reviveOnce = !!o.reviveOnce; this.canRevive = o.canRevive ?? true; this.reviveChance = o.reviveChance ?? 0.65;
    this.zone = o.zone || 'workshop';
    this.tag = o.tag;
    this.humLevel = 0; this.humTempo = 62; this.humPitch = randi(-2, 2); this.humVoice = null;
    this.distToPlayer = 99; this.losT = 0; this.hasLOS = false; this.lurchT = rand(2, 5); this.stepPhase = rand(0, TAU); this.lastStep = 0;
    this.pose = new Float32Array(PC.N); this.from = new Float32Array(PC.N); this.target = new Float32Array(PC.N); this.blendT = 1; this.blendDur = 0.2;
    this.springs = {};
    for (const [k, f, z] of [['SRX', 3.2, 0.35], ['SRY', 3, 0.35], ['SRZ', 3.2, 0.35], ['CRX', 3.6, 0.4], ['NRX', 3.4, 0.3], ['NRY', 3, 0.35], ['NRZ', 3.2, 0.3], ['HRX', 4, 0.3], ['HRZ', 3.6, 0.3],
      ['LSX', 2.6, 0.3], ['LSZ', 2.6, 0.3], ['RSX', 2.6, 0.3], ['RSZ', 2.6, 0.3], ['PY', 3.5, 0.45], ['LK', 3, 0.4], ['RK', 3, 0.4]]) this.springs[k] = new Spring(f, z);
    this.headPos = new V3(); this.hitCenter = new V3();
    this.fallDir = 1; this.lieT = 0; this.restT = 0;
    this.build();
    if (this.state === 'resting') { this.alive = true; this.resting = true; this.hp = 0; this.setLie(o.lieDir ?? 1, true); }
    this.applyPose(0);
  }

  // ------------------------------------------------------------------ construction
  build() {
    const S = hollowMaterials(), g = S.geo, T = this.T;
    const cloth = clothMat(T.cloth);
    const root = this.root = new THREE.Group();
    root.position.copy(this.pos); root.rotation.y = this.heading; root.scale.setScalar(this.scale);
    const J = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const M = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    this.j = {};
    const j = this.j;
    j.hips = J(root, 0, 0.95, 0);
    M(j.hips, g.pelvis, cloth, 0, 0.0, 0);
    j.spine = J(j.hips, 0, 0.09, 0); M(j.spine, g.belly, cloth, 0, 0.08, 0);
    j.chest = J(j.spine, 0, 0.2, 0); M(j.chest, g.chest, cloth, 0, 0.1, -0.005);
    j.neck = J(j.chest, 0, 0.26, 0); M(j.neck, g.neck, S.mats.porcelain, 0, 0.03, 0);
    j.head = J(j.neck, 0, 0.1, 0.01);
    // Per-enemy face canvas so cracks land where bullets hit.
    this.faceCanvas = makeCanvas(256); this.faceCtx = this.faceCanvas.getContext('2d'); this.faceCtx.drawImage(CANVAS.face, 0, 0);
    this.faceTex = toTex(this.faceCanvas, { repeat: false });
    this.faceMat = S.mats.porcelain.clone(); this.faceMat.map = this.faceTex; this.faceMat.emissiveMap = this.faceTex; this.faceMat.emissive = new THREE.Color(0x0e0d0c);
    const headG = this.headGroup = new THREE.Group(); headG.position.set(0, 0.09, 0); headG.scale.set(1, 1.18, 1.05); j.head.add(headG);
    this.faceMesh = M(headG, g.faceFront, this.faceMat); M(headG, g.faceBack, S.mats.porcelain);
    this.headMarker = J(j.head, 0, 0.09, 0.005);
    if (T.cap) {
      const cm = clothMat(T.capColor || 0x34465c);
      this.cap = new THREE.Group(); this.cap.position.set(0, 0.155, -0.005); this.cap.rotation.x = -0.1; j.head.add(this.cap);
      M(this.cap, g.capTop, cm); M(this.cap, g.brim, cm, 0, 0.0, 0.07);
    }
    if (T.mask) {
      this.mask = new THREE.Group(); this.mask.position.set(0, 0.07, 0.115); j.head.add(this.mask);
      M(this.mask, g.mask, S.mats.mask); M(this.mask, new THREE.BoxGeometry(0.12, 0.04, 0.01), S.mats.maskGlass, 0, 0.03, 0.017);
    }
    this.stump = M(j.neck, g.stump, S.mats.stump, 0, 0.1, 0); this.stump.visible = false;
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      const sh = j['sh' + side] = J(j.chest, s * 0.2, 0.2, 0);
      M(sh, g.upper, cloth, 0, -0.14, 0);
      const el = j['el' + side] = J(sh, 0, -0.29, 0);
      M(el, g.fore, cloth, 0, -0.12, 0);
      if (this.type === 'worker' && Math.random() < 0.5) M(el, g.sleeve, S.mats.sleeve, 0, -0.13, 0);
      const wr = j['wr' + side] = J(el, 0, -0.25, 0);
      M(wr, g.hand, S.mats.porcelain, 0, -0.05, 0);
      j['fi' + side] = J(wr, 0, -0.1, 0);
      const hip = j['hip' + side] = J(j.hips, s * 0.1, -0.06, 0);
      M(hip, g.thigh, cloth, 0, -0.21, 0);
      const kn = j['kn' + side] = J(hip, 0, -0.43, 0);
      M(kn, g.shin, cloth, 0, -0.2, 0);
      const an = j['an' + side] = J(kn, 0, -0.42, 0);
      M(an, g.boot, S.mats.boot, 0, -0.03, 0.05);
    }
    if (this.type === 'worker' && Math.random() < 0.35) M(j.chest, g.apron, S.mats.apron, 0, -0.08, 0.13);
    G.scene.add(root);
  }
  dispose() {
    G.scene.remove(this.root);
    this.faceTex.dispose(); this.faceMat.dispose();
    Tokens.release(this);
    if (this.humVoice) { this.humVoice.owner = null; this.humVoice.g.gain.value = 0; this.humVoice = null; }
  }

  // ------------------------------------------------------------------ queries
  get hittable() { return this.state !== 'gone' && !this.confirmed; }
  get kickable() { return this.alive && !this.confirmed && this.state !== 'grab' && this.state !== 'spawn'; }
  get isLow() { return this.resting || this.state === 'down' || this.state === 'knock' || this.state === 'crawl' || this.state === 'dying'; }
  get attacking() { return this.state === 'windup' || this.state === 'lunge' || this.state === 'grab'; }
  seenByPlayer() {
    const P = G.player; _v1.subVectors(this.hitCenter, P.camera.position); const d = _v1.length();
    return _v1.dot(P.forward(_v2)) / d > Math.cos((P.camera.fov * 0.5 + 10) * DEG * 1.2) && this.hasLOS;
  }

  // ------------------------------------------------------------------ hitboxes
  // Head sphere plus capsules on the animated joints. The torso capsule stops below the chin
  // so it never steals a headshot.
  rayHit(ro, rd, maxT) {
    if (!this.hittable) return null;
    const s = this.scale;
    const tb = raySphere(ro, rd, this.hitCenter, 1.35 * s);
    if (tb < 0 || tb > maxT) return null;
    const j = this.j, A = this._ha || (this._ha = new V3()), B = this._hb || (this._hb = new V3()), C = this._hc || (this._hc = new V3());
    const W = (o, v) => { const e = o.matrixWorld.elements; return v.set(e[12], e[13], e[14]); };
    let best = null;
    const test = (t, part) => { if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, part }; };
    if (this.faceMesh.parent.visible) test(raySphere(ro, rd, this.headPos, 0.13 * s), 'head');
    W(j.chest, B); W(j.neck, C); B.lerp(C, 0.3);
    test(rayCapsule(ro, rd, W(j.hips, A), B, 0.19 * s), 'torso');
    for (const side of ['L', 'R']) {
      test(rayCapsule(ro, rd, W(j['sh' + side], A), W(j['el' + side], B), 0.065 * s), 'arm' + side);
      test(rayCapsule(ro, rd, W(j['el' + side], A), W(j['fi' + side], B), 0.055 * s), 'arm' + side);
      test(rayCapsule(ro, rd, W(j['hip' + side], A), W(j['kn' + side], B), 0.085 * s), 'leg' + side);
      test(rayCapsule(ro, rd, W(j['kn' + side], A), W(j['an' + side], B), 0.07 * s), 'leg' + side);
    }
    if (!best) return null;
    best.point = new V3().copy(ro).addScaledVector(rd, best.t);
    return best;
  }

  // ------------------------------------------------------------------ damage
  takeHits(hits, info) {
    const d = info.def, P = G.player;
    let head = false, kill = false, knock = false;
    if (!this.hittable) return { head, kill };
    let headDmg = 0, bodyDmg = 0, poise = 0, pellets = hits.length, minDist = 99;
    const leg = [0, 0];
    const local = this._local || (this._local = new V3());
    local.copy(info.dir); local.y = 0; local.applyAxisAngle(_v4.set(0, 1, 0), -this.heading);
    for (const h of hits) {
      minDist = Math.min(minDist, h.t);
      const f = d.falloff ? lerp(1, d.falloff[2], invLerp(d.falloff[0], d.falloff[1], h.t)) : 1;
      const base = d.dmg * f * (info.melee ? 1 : 1);
      const shot = pellets > 1 ? 0.35 : 1;
      switch (h.part) {
        case 'head': {
          let m = d.headMul * (info.focused ? 1.5 : 1) * (info.pointBlank ? 2 : 1);
          if (this.maskHP > 0) { this.maskHP -= base * m; m = 0; G.fx.impact(h.point, { x: -info.dir.x, y: 0, z: -info.dir.z }, 'metal', info.dir, 0.6); G.audio.impact(h.point, 'metal'); if (this.maskHP <= 0) this.breakMask(info.dir); }
          headDmg += base * m; bodyDmg += base * 0.35; poise += d.headPoise; head = true;
          if (m > 0) { this.crackAt(h.point, base * m); G.fx.porcelain(h.point, info.dir, pellets > 1 ? 0.5 : 1); }
          this.kickSpring('NRX', local.z * 7 * shot); this.kickSpring('HRX', local.z * 9 * shot); this.kickSpring('NRZ', -local.x * 6 * shot); this.kickSpring('NRY', rand(-3, 3) * shot);
          break;
        }
        case 'torso':
          bodyDmg += base; poise += d.poise; G.fx.blood(h.point, info.dir, pellets > 1 ? 0.45 : 1);
          this.kickSpring('SRX', local.z * 3.5 * shot); this.kickSpring('SRZ', -local.x * 3.5 * shot); this.kickSpring('CRX', local.z * 2 * shot);
          this.kickSpring('SRY', (h.point.y > this.hitCenter.y ? 1 : -1) * rand(-2.5, 2.5) * shot);
          break;
        case 'armL': case 'armR': {
          bodyDmg += base * d.limbMul; poise += d.poise * 0.6; G.fx.blood(h.point, info.dir, pellets > 1 ? 0.3 : 0.6);
          const s = h.part === 'armL' ? 'L' : 'R';
          this.kickSpring(s + 'SX', -local.z * 6 * shot); this.kickSpring(s + 'SZ', (s === 'L' ? 1 : -1) * Math.abs(local.x) * 5 * shot + rand(-1, 1));
          break;
        }
        case 'legL': case 'legR': {
          const i = h.part === 'legL' ? 0 : 1;
          leg[i] += base * d.limbMul * 1.25; bodyDmg += base * d.limbMul * 0.5; poise += d.poise * 0.8; G.fx.blood(h.point, info.dir, pellets > 1 ? 0.3 : 0.6);
          this.kickSpring('PY', -1.2 * shot); this.kickSpring(i ? 'RK' : 'LK', 7 * shot);
          break;
        }
      }
    }
    // Knockback.
    const kb = pellets > 1 ? Math.min(3.2, pellets * 0.35) * (minDist < 4 ? 1 : 0.5) : (head ? 0.5 : 0.35);
    this.vel.x += info.dir.x * kb; this.vel.z += info.dir.z * kb;
    const wasResting = this.resting;
    this.headHP -= headDmg; this.hp -= bodyDmg; this.legHP[0] -= leg[0]; this.legHP[1] -= leg[1];
    this.poise += poise;
    this.alert(true);
    // Audio.
    const pt = hits[0].point;
    if (head && headDmg > 0) G.audio.porcelainCrack(pt, headDmg > 60); else G.audio.fleshHit(pt, pellets > 1);
    // Outcomes, most severe first.
    if (this.headHP <= 0) { this.shatter(info.dir); kill = true; P.stats.kills++; if (wasResting) P.stats.confirms++; hitstop(0.075, 0.03); slowmo(0.16, 0.4); P.addTrauma(0.08); }
    else if (this.resting || this.state === 'dying') { this.twitch(); }
    else if (this.hp <= 0) { this.goDown(info.dir); hitstop(0.045, 0.06); }
    else if (!this.crawler && (this.legHP[0] <= 0 || this.legHP[1] <= 0)) { this.crawler = true; this.knockdown(info.dir, true); hitstop(0.04, 0.08); }
    else if (pellets > 1 && d.knockPellets && pellets >= (this.type === 'foreman' ? 8 : d.knockPellets) && minDist < d.knockRange) { this.knockdown(info.dir); knock = true; hitstop(0.055, 0.06); }
    else if (this.poise >= this.maxPoise) { this.stagger(head ? 0.85 : 0.6, info.dir); if (head) hitstop(0.035, 0.1); }
    else if (head) hitstop(0.02, 0.15);
    if (info.pointBlank && this.state === 'grab') this.grabEscaped('shot');
    return { head: head && headDmg > 0, kill };
  }
  kickSpring(k, v) { if (TUNE.fx.hitReact && this.springs[k]) this.springs[k].kick(v); }
  // Kick from the player: stagger, knockdown when committed to an attack, stomp when down.
  kicked(dir, weak) {
    const P = G.player;
    // Caught listening to the broadcast: off guard, goes straight down.
    if (this.state === 'listen') { this.aware = true; this.knockdown(dir); this.lieT = rand(2.6, 3.4); G.ui.hitMarker('head'); return; }
    this.alert(true);
    if (this.isLow && this.state !== 'crawl') {
      // Stomp on the face.
      P.stats.stomps++;
      this.headHP -= weak ? 30 : 55;
      this.crackAt(this.headPos, 55);
      G.fx.porcelain(this.headPos, _v1.set(0, -1, 0), 1.2);
      G.audio.porcelainCrack(this.headPos, true);
      this.kickSpring('NRX', 5); this.kickSpring('HRX', 6);
      if (this.headHP <= 0) { const wasResting = this.resting; this.shatter(_v1.set(dir.x, -0.5, dir.z)); P.stats.kills++; if (wasResting) P.stats.confirms++; G.ui.hitMarker('kill'); hitstop(0.08, 0.03); }
      else G.ui.hitMarker('head');
      return;
    }
    this.vel.x += dir.x * (weak ? 2 : 3.8); this.vel.z += dir.z * (weak ? 2 : 3.8);
    this.hp -= weak ? 5 : 12;
    this.kickSpring('SRX', -5); this.kickSpring('CRX', -3); this.kickSpring('NRX', -4);
    G.fx.dust(_v3.copy(this.pos).setY(1.0), 0.4, 0.4);
    if (this.state === 'crawl') { this.stagger(0.8, dir); return; }
    // A stunned foreman goes over: the payoff for baiting the charge into a wall.
    if (this.type === 'foreman' && this.state === 'stun') { this.knockdown(dir); this.lieT = rand(2.6, 3.2); G.ui.hitMarker('head'); hitstop(0.07, 0.05); P.addTrauma(0.2); return; }
    if (this.type === 'foreman') { this.poise += weak ? 15 : 35; if (this.poise >= this.maxPoise) this.stagger(0.7, dir); return; }
    if (this.attacking || (!weak && this.poise + 50 >= this.maxPoise)) { this.knockdown(dir); G.ui.hitMarker('head'); }
    else this.stagger(0.75, dir);
  }
  crackAt(point, dmg) {
    const lp = this.faceMesh.worldToLocal(_v4.copy(point));
    if (lp.z < -0.02) return;
    const R = 0.11, S = 256, x = (0.5 + lp.x / (2 * R) * 0.96) * S, y = (1 - (0.5 + lp.y / (2 * R) * 0.96)) * S;
    const c = this.faceCtx, sev = clamp01(dmg / 90) * (1.6 - this.headHP / this.T.head);
    c.lineCap = 'round';
    for (let i = 0; i < 4 + sev * 7; i++) {
      let px = x, py = y, a = rand(0, TAU); const len = rand(6, 16) + sev * 20;
      c.strokeStyle = `rgba(18,14,12,${0.7 + Math.random() * 0.3})`; c.lineWidth = rand(0.8, 1.8) + sev;
      c.beginPath(); c.moveTo(px, py);
      for (let s = 0; s < 6; s++) { a += rand(-0.6, 0.6); px += Math.cos(a) * len / 6; py += Math.sin(a) * len / 6; c.lineTo(px, py); }
      c.stroke();
    }
    if (sev > 0.5 || this.headHP < this.T.head * 0.45) {
      c.fillStyle = '#050304'; c.beginPath();
      const r = 4 + sev * 12;
      for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, rr = r * rand(0.4, 1.1); k ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      c.fill();
      c.strokeStyle = 'rgba(60,8,6,.8)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, y + r * 0.6); c.lineTo(x + rand(-3, 3), y + r + rand(10, 40)); c.stroke();
    }
    this.faceTex.needsUpdate = true;
  }
  breakMask(dir) {
    if (!this.mask) return;
    const p = new V3(); this.mask.getWorldPosition(p);
    this.mask.visible = false;
    G.fx.impact(p, { x: -dir.x, y: 0, z: -dir.z }, 'metal', dir, 1.5);
    G.fx.mags.spawn(p, new V3(dir.x * 2 + rand(-1, 1), 2.5, dir.z * 2 + rand(-1, 1)), { life: 60, spin: 12, scale: 2.5 });
    G.audio.impact(p, 'metal'); G.audio.metalSlam(p);
    this.stagger(1.0, dir);
    G.ui.toast('面罩打掉了');
  }

  // ------------------------------------------------------------------ state changes
  setState(s, blend = 0.2) {
    if (this.state === s) return;
    if (this.attacking && !(s === 'lunge' || s === 'grab')) Tokens.release(this);
    this.state = s; this.stateT = 0;
    this.from.set(this.pose); this.blendT = 0; this.blendDur = blend;
  }
  alert(immediate) {
    if (this.resting || !this.alive) return;
    if (this.state === 'listen') { this.aware = true; this.setState('chase', 0.25); return; }
    if (this.aware) return;
    if (immediate) { this.aware = true; if (this.state === 'idle' || this.state === 'notice') this.setState('chase', 0.3); return; }
    if (this.state === 'idle') { this.setState('notice', 0.3); G.audio.notice(this.headPos); }
  }
  stagger(dur, dir) {
    if (!this.alive || this.resting || this.state === 'knock' || this.state === 'down' || this.state === 'getup') return;
    if (this.state === 'grab') this.releaseGrab();
    this.poise = 0; this.staggerDur = dur;
    this.setState('stagger', 0.08);
    this.kickSpring('SRX', -3); this.kickSpring('PY', -1);
  }
  knockdown(dir, toCrawl) {
    if (this.state === 'grab') this.releaseGrab();
    this.poise = 0;
    const fwd = Math.sin(this.heading) * dir.x + Math.cos(this.heading) * dir.z;
    this.fallDir = toCrawl ? 1 : (fwd > 0 ? 1 : -1);
    this.thudded = false;
    this.setState('knock', 0.05);
    this.lieT = toCrawl ? 1.2 : rand(1.6, 2.4);
    this.vel.x += dir.x * 1.5; this.vel.z += dir.z * 1.5;
  }
  goDown(dir) {
    // Not dead: resting until the face breaks.
    if (this.state === 'grab') this.releaseGrab();
    const fwd = Math.sin(this.heading) * dir.x + Math.cos(this.heading) * dir.z;
    this.fallDir = fwd > 0 ? 1 : -1;
    this.thudded = false; this.crumple = false;
    this.setState('dying', 0.05);
    this.resting = false;
    this.restT = rand(6, 11);
    this.hp = 0;
    G.audio.silenceHum(this);
    G.director && G.director.onEnemyDown(this);
  }
  shatter(dir) {
    if (this.state === 'grab') this.releaseGrab();
    this.confirmed = true; this.alive = false;
    this.faceMesh.parent.visible = false; if (this.cap) this.cap.visible = false; if (this.mask) this.mask.visible = false;
    this.stump.visible = true;
    const hp = this.headPos.clone();
    G.fx.shatterHead(hp, dir);
    G.audio.headShatter(hp);
    G.audio.silenceHum(this);
    if (this.state === 'down' || this.state === 'rise') this.setState('dead', 0.1);
    else if (this.state !== 'dying') {
      const fwd = Math.sin(this.heading) * dir.x + Math.cos(this.heading) * dir.z;
      this.fallDir = fwd > 0 ? 1 : -1;
      this.thudded = false;
      this.setState('dying', 0.05); this.crumple = true;
    }
    this.resting = false;
    this.smokeT = 3;
    Tokens.release(this);
    G.director && G.director.onEnemyKilled(this);
  }
  twitch() { this.kickSpring('SRX', rand(-3, 3)); this.kickSpring('NRX', rand(-3, 3)); this.kickSpring('LSX', rand(-4, 4)); }
  // Shift over: the anomaly lets go of them.
  release() {
    if (this.confirmed) return;
    if (this.state === 'grab') this.releaseGrab();
    const wasLow = this.isLow || this.resting;
    this.alive = false; this.confirmed = true; this.resting = false; this.freed = true;
    G.audio.silenceHum(this); Tokens.release(this);
    if (wasLow) { this.setState('dead', 0.4); return; }
    this.fallDir = 1; this.crumple = true; this.thudded = false;
    this.setState('dying', 0.5 + Math.random() * 0.4);
  }
  setLie(dir, instant) {
    this.fallDir = dir; this.setState('down', 0);
    if (instant) { this.blendT = 1; this.poseLie(this.pose, dir); }
  }

  // ------------------------------------------------------------------ grab
  // Any hit reaction during a grab frees the player, and counts as breaking free.
  releaseGrab() {
    Tokens.release(this);
    if (G.player.grab && G.player.grab.enemy === this) G.player.endGrab(true);
  }
  grabEscaped(how) {
    const P = G.player;
    if (P.grab && P.grab.enemy === this) P.endGrab(how === 'struggle' || how === 'shot');
    Tokens.release(this);
    if (how === 'struggle') {
      const dir = _v1.subVectors(this.pos, P.pos).setY(0).normalize();
      this.knockdown(dir); G.audio.kickHit(this.pos); P.addTrauma(0.3); hitstop(0.06, 0.05);
    } else if (this.alive && this.state === 'grab') this.setState('recover', 0.1);
  }
  struggleJolt() { this.kickSpring('SRX', rand(-4, 4)); this.kickSpring('NRY', rand(-4, 4)); this.kickSpring('LSZ', rand(-3, 3)); }

  // ------------------------------------------------------------------ update
  update(dt) {
    const P = G.player;
    this.stateT += dt;
    if (this.state === 'dead' && this.stateT > 1.5) { if (this.smokeT > 0) this.smokeT -= dt; return; }
    this.distToPlayer = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.poise = Math.max(0, this.poise - 22 * dt);
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = 0.2 + Math.random() * 0.1; this.hasLOS = G.level.los(this.headPos, P.camera.position); }
    if (this.smokeT > 0) { this.smokeT -= dt; if (Math.random() < dt * 14) { const p = new V3(); this.stump.getWorldPosition(p); G.fx.smoke.spawn(p.x, p.y + 0.05, p.z, rand(-0.1, 0.1), rand(0.2, 0.5), rand(-0.1, 0.1), { color: [0.03, 0.02, 0.03], size: 0.08, grow: 3, life: 1.4, drag: 1, grav: -0.2, alpha: 0.5 }); } }
    const s = this.state;
    this.humLevel = 0;
    switch (s) {
      case 'idle': this.updateIdle(dt); break;
      case 'notice': this.updateNotice(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'windup': this.updateWindup(dt); break;
      case 'lunge': this.updateLunge(dt); break;
      case 'recover': if (this.stateT > 0.95) this.setState('chase', 0.3); this.humLevel = 0.3; break;
      case 'grab': this.updateGrab(dt); break;
      case 'stagger': if (this.stateT > this.staggerDur) this.setState(this.crawler ? 'crawl' : 'chase', 0.25); break;
      case 'knock': if (this.stateT > 0.55) this.setState('down', 0.1); break;
      case 'down':
        if (this.resting) this.updateResting(dt);
        else if (this.stateT > this.lieT) this.setState(this.crawler ? 'crawl' : 'getup', this.crawler ? 0.5 : 0.1);
        break;
      case 'getup': if (this.stateT > 1.15) { this.setState('chase', 0.2); } break;
      case 'crawl': this.updateCrawl(dt); break;
      case 'dying': if (this.stateT > 0.85) { if (!this.freed) G.fx.pool(this.pos, rand(0.7, 1.1)); if (this.confirmed) this.setState('dead', 0.1); else { this.resting = true; this.setState('down', 0.1); } } break;
      case 'listen': this.humLevel = 0.9; this.humTempo = 46; break;
      case 'rise': if (this.stateT > 1.7) { this.resting = false; this.alive = true; this.hp = this.T.hp * 0.5; this.aware = true; this.setState(this.crawler ? 'crawl' : 'chase', 0.2); } break;
      case 'spawn': if (this.stateT > 1.3) { this.aware = true; this.setState(G.director.bc && this.type !== 'foreman' ? 'listen' : 'chase', 0.25); } this.humLevel = 0.4; break;
      case 'stun': this.humLevel = 0; if (this.stateT > 2.2) this.setState('chase', 0.3); break;
      case 'charge': this.updateCharge(dt); break;
      case 'roar': this.updateRoar(dt); break;
    }
    // Physics: knockback slide and collisions.
    const moving = !(this.state === 'dead' || this.state === 'gone');
    if (moving) {
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      const fr = Math.exp(-7 * dt); this.vel.x *= fr; this.vel.z *= fr;
      if (!this.isLow || this.state === 'crawl') {
        for (const o of G.enemies) {
          if (o === this || !o.alive || o.isLow) continue;
          const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz, r = 0.62 * (this.type === 'foreman' || o.type === 'foreman' ? 1.3 : 1);
          if (d2 < r * r && d2 > 1e-6) { const d = Math.sqrt(d2), push = (r - d) * 0.5; this.pos.x += dx / d * push; this.pos.z += dz / d * push; }
        }
        if (P.alive && this.state !== 'grab') {
          const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz), r = 0.72;
          if (d < r && d > 1e-4) { const push = r - d; this.pos.x += dx / d * push * 0.6; this.pos.z += dz / d * push * 0.6; P.pos.x -= dx / d * push * 0.4; P.pos.z -= dz / d * push * 0.4; }
        }
      }
      G.level.collideCircle(this.pos, this.isLow && this.state !== 'crawl' ? 0.2 : 0.3);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.animate(dt);
  }

  perceive(dt) {
    const P = G.player;
    if (!P.alive) return false;
    const d = this.distToPlayer;
    // Hearing.
    for (const n of G.noises) {
      if (G.time - n.t > 0.25) continue;
      if (!n.heard) n.heard = new Set();
      if (n.heard.has(this)) continue;
      n.heard.add(this);
      const nd = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (nd < n.r) { if (n.kind === 'gun') { if (this.noticeDelay < 0) this.noticeDelay = rand(0.15, 0.6); } else this.suspicion += 0.5; }
    }
    if (this.noticeDelay >= 0) { this.noticeDelay -= dt; if (this.noticeDelay < 0) return true; }
    if (d < 1.8) return true;
    // Sight: rule three — do not let them see your face.
    const lit = P.flashlightOn && this.inFlashlight();
    const range = lit ? 21 : 12;
    if (d < range && this.hasLOS) {
      const fx = Math.sin(this.heading + (this.lookYaw || 0)), fz = Math.cos(this.heading + (this.lookYaw || 0));
      const dot = ((P.pos.x - this.pos.x) * fx + (P.pos.z - this.pos.z) * fz) / (d || 1);
      if (dot > 0.45) this.suspicion += dt * (1.1 + (range - d) / 5) * (lit ? 1.6 : 1) * (P.sprinting ? 1.5 : 1);
      else this.suspicion = Math.max(0, this.suspicion - dt * 0.25);
    } else this.suspicion = Math.max(0, this.suspicion - dt * 0.3);
    return this.suspicion >= 1;
  }
  inFlashlight() {
    const P = G.player, L = P.flashlight;
    _v1.subVectors(this.hitCenter, L.position); const d = _v1.length(); if (d > 22) return false;
    return _v1.divideScalar(d).dot(P.flashDir) > 0.9;
  }
  updateIdle(dt) {
    this.humLevel = 0.55; this.humTempo = 58;
    if (this.perceive(dt)) { this.setState('notice', 0.35); G.audio.silenceHum(this); G.audio.notice(this.headPos); return; }
    // Head drifts toward the player as suspicion rises: the tell before they turn.
    const P = G.player;
    const want = this.suspicion > 0.3 ? clamp(angleTo(this.heading, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z)), -1.3, 1.3) * smooth(clamp01((this.suspicion - 0.3) / 0.7)) : 0;
    this.lookYaw = damp(this.lookYaw || 0, want, 2.5, dt);
  }
  updateNotice(dt) {
    const P = G.player;
    const want = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.lookYaw = damp(this.lookYaw || 0, 0, 3, dt);
    if (this.stateT > 0.5) this.heading += angleTo(this.heading, want) * (1 - Math.exp(-3 * dt));
    if (this.stateT > 1.05) { this.aware = true; this.setState('chase', 0.35); }
  }
  updateChase(dt) {
    const P = G.player;
    this.aware = true;
    this.humLevel = 1; this.humTempo = 84;
    if (!P.alive) { this.humLevel = 0.5; return; }
    const d = this.distToPlayer;
    const seen = this.seenByPlayer();
    // Movement direction: straight when the line is clear, otherwise the flow field.
    const dir = _v2;
    let direct = false;
    if (d < 12 && this.hasLOS) {
      direct = true;
      for (let k = 1; k <= 3 && direct; k++) { const t = k / 4; if (!G.level.isWalkable(lerp(this.pos.x, P.pos.x, t), lerp(this.pos.z, P.pos.z, t))) direct = false; }
    }
    if (direct) dir.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
    else if (!G.level.flowDir(this.pos.x, this.pos.z, dir)) dir.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
    const want = Math.atan2(dir.x, dir.z);
    this.heading += clamp(angleTo(this.heading, want), -3.2 * dt, 3.2 * dt);
    // Attack decision.
    const facing = Math.abs(angleTo(this.heading, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z)));
    let speed = 1.05 * this.speedMul;
    if (d > 8) speed *= 1.2;
    if (!seen) speed *= 1.25;
    if (G.clock && G.clock.gazing && this.zone === 'workshop') speed *= 1.3;
    const canAttack = P.state === 'normal' && P.grabImmune <= 0 && facing < 0.6;
    if (d < 1.75 && canAttack) {
      if (Tokens.request(this)) { this.setState('windup', 0.12); G.audio.silenceHum(this); G.audio.windup(this.headPos); return; }
      speed = d < 1.25 ? -0.3 : 0.15;
    } else if (d < 2.4 && Tokens.holders.size >= TUNE.tokens && TUNE.fx.tokens && !Tokens.holders.has(this)) speed *= 0.35;
    // The foreman charges from mid range; backing off invites the charge.
    if (this.type === 'foreman') {
      this.chargeCd = (this.chargeCd ?? 1.2) - dt;
      if (this.chargeCd <= 0 && d > 3.5 && d < 11 && this.hasLOS && facing < 0.35) { this.chargeCd = rand(4.5, 7); this.setState('roar', 0.2); return; }
    }
    // Lurch: skips forward like a missing film frame.
    this.lurchT -= dt;
    if (TUNE.fx.lurch && this.lurchT <= 0 && d > 4.5 && this.type !== 'foreman') {
      this.lurchT = rand(2.5, 5.5);
      const jump = rand(0.9, 1.3), nx = this.pos.x + dir.x * jump, nz = this.pos.z + dir.z * jump;
      if (G.level.isWalkable(nx, nz)) { G.fx.staticPuff(this.hitCenter, 14); this.pos.x = nx; this.pos.z = nz; this.stepPhase += 1.6; G.audio.glitch(this.hitCenter); this.lurchFlash = 0.12; }
    }
    this.pos.x += Math.sin(this.heading) * speed * dt; this.pos.z += Math.cos(this.heading) * speed * dt;
    this.moveSpeed = Math.abs(speed);
    this.stepAudio(speed, dt);
  }
  stepAudio(speed, dt) {
    const prev = this.stepPhase;
    this.stepPhase += Math.abs(speed) * dt * 2.4;
    if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI) && this.distToPlayer < 15) {
      const drag = Math.floor(this.stepPhase / Math.PI) % 2 === 0;
      if (drag) G.audio.drag(this.pos); else G.audio.footstep(this.pos, 'concrete', this.type === 'foreman', false);
    }
  }
  updateWindup(dt) {
    const P = G.player;
    const want = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.heading += clamp(angleTo(this.heading, want), -5 * dt, 5 * dt);
    const dur = this.crawler ? 0.5 : (this.type === 'foreman' ? 0.75 : 0.62);
    if (this.stateT >= dur) {
      if (this.crawler) this.tryGrab(1.25);
      else { this.setState('lunge', 0.06); this.lungeDir = this.heading; G.audio.lunge(this.headPos); }
    }
  }
  updateLunge(dt) {
    const sp = this.type === 'foreman' ? 4.4 : 5;
    this.pos.x += Math.sin(this.lungeDir) * sp * dt; this.pos.z += Math.cos(this.lungeDir) * sp * dt;
    if (this.stateT >= 0.26) this.tryGrab(0.8);
  }
  tryGrab(reach) {
    const P = G.player;
    const gx = this.pos.x + Math.sin(this.heading) * 0.5, gz = this.pos.z + Math.cos(this.heading) * 0.5;
    const d = Math.hypot(P.pos.x - gx, P.pos.z - gz);
    if (d < reach && P.state === 'normal' && P.grabImmune <= 0) {
      if (this.type === 'foreman') { P.hurt(30, this.pos, 'hit'); const dir = _v1.subVectors(P.pos, this.pos).setY(0).normalize(); P.vel.addScaledVector(dir, 6); Tokens.release(this); this.setState('recover', 0.2); return; }
      this.setState('grab', 0.1);
      this.grabT = 0; this.biteAt = 2.1;
      P.beginGrab(this);
    } else { this.setState('recover', 0.15); Tokens.release(this); }
  }
  updateGrab(dt) {
    const P = G.player;
    if (P.state !== 'grabbed' || !P.grab || P.grab.enemy !== this) { this.setState('recover', 0.1); Tokens.release(this); return; }
    this.grabT += dt;
    // Hold position in front of the player.
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const tx = P.pos.x + fx * 0.62, tz = P.pos.z + fz * 0.62;
    this.pos.x = damp(this.pos.x, tx, 12, dt); this.pos.z = damp(this.pos.z, tz, 12, dt);
    this.heading = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    if (this.grabT >= this.biteAt) {
      G.audio.bite(); P.hurt(26, this.pos, 'bite'); G.fx.blood(P.camera.position.clone().addScaledVector(_v1.set(fx, 0, fz), 0.3), _v2.set(-fx, 0.2, -fz), 0.6);
      P.endGrab(false);
      this.setState('recover', 0.1); Tokens.release(this);
      P.vel.set(-fx * 3, 0, -fz * 3);
    }
  }
  updateResting(dt) {
    if (!this.canRevive && !this.reviveOnce) return;
    this.restT -= dt;
    if (Math.random() < dt * 0.3) this.twitch();
    if (this.restT > 0) return;
    const P = G.player;
    if (this.distToPlayer > 13 || !P.alive) return;
    const seen = this.seenByPlayer();
    if (this.reviveOnce || (!seen && Math.random() < this.reviveChance) || (seen && Math.random() < 0.15)) {
      this.reviveOnce = false;
      this.setState('rise', 0.1); G.audio.creak(this.headPos, 0.7); G.audio.notice(this.headPos);
    } else this.restT = rand(3, 6);
  }
  updateCrawl(dt) {
    const P = G.player;
    this.humLevel = 0.8; this.humTempo = 70;
    const dir = _v2;
    if (!G.level.flowDir(this.pos.x, this.pos.z, dir)) dir.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
    if (this.distToPlayer < 3 && this.hasLOS) dir.set(P.pos.x - this.pos.x, 0, P.pos.z - this.pos.z).normalize();
    this.heading += clamp(angleTo(this.heading, Math.atan2(dir.x, dir.z)), -2 * dt, 2 * dt);
    const sp = 0.55 * this.speedMul;
    if (this.distToPlayer < 1.35 && P.state === 'normal' && P.grabImmune <= 0 && Tokens.request(this)) { this.setState('windup', 0.1); G.audio.windup(this.headPos); return; }
    this.pos.x += Math.sin(this.heading) * sp * dt; this.pos.z += Math.cos(this.heading) * sp * dt;
    this.stepPhase += sp * dt * 3;
    if (Math.random() < dt * 0.8 && this.distToPlayer < 12) G.audio.drag(this.pos);
  }
  updateRoar(dt) {
    const P = G.player;
    this.heading += clamp(angleTo(this.heading, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z)), -4 * dt, 4 * dt);
    if (this.stateT < dt * 1.5) { G.audio.screech(this.headPos); P.addTrauma(0.2); }
    if (this.stateT > 0.9) { this.setState('charge', 0.1); this.chargeDir = this.heading; this.chargeHit = false; }
  }
  updateCharge(dt) {
    const P = G.player, sp = 6.2;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += Math.sin(this.chargeDir) * sp * dt; this.pos.z += Math.cos(this.chargeDir) * sp * dt;
    this.stepPhase += sp * dt * 2;
    // Running into a wall or machine stuns: the opening the charge is designed around.
    if (G.level.collideCircle(this.pos, 0.42)) {
      const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
      if (moved < sp * dt * 0.6) { this.setState('stun', 0.1); G.audio.metalSlam(this.pos); G.fx.dust(this.pos.clone().setY(1), 2, 1); P.addTrauma(0.25); G.level.kickSwing(0.4); return; }
    }
    if (!this.chargeHit && this.distToPlayer < 1.1 && P.state === 'normal') {
      this.chargeHit = true;
      P.hurt(34, this.pos, 'charge');
      P.vel.set(Math.sin(this.chargeDir) * 7, 0, Math.cos(this.chargeDir) * 7);
    }
    if (this.stateT > 1.7) this.setState('chase', 0.3);
  }

  // ------------------------------------------------------------------ animation
  animate(dt) {
    const p = this.target, t = G.time, s = this.state;
    p.fill(0);
    switch (s) {
      case 'idle': this.poseWork(p, t); break;
      case 'notice': this.poseStand(p, t); p[PC.NRY] += (this.lookYaw || 0); p[PC.HRX] += -0.15; break;
      case 'listen': this.poseStand(p, t); p[PC.NRX] = -0.5; p[PC.HRX] = -0.3; p[PC.HRZ] = 0.12 + Math.sin(t * 0.6 + this.stepPhase) * 0.08; p[PC.SRX] = -0.05; break;
      case 'chase': case 'recover': this.poseWalk(p, this.stepPhase, s === 'recover'); break;
      case 'windup': this.poseWindup(p, smooth(clamp01(this.stateT / (this.crawler ? 0.5 : 0.62)))); break;
      case 'lunge': this.poseLunge(p, clamp01(this.stateT / 0.26)); break;
      case 'grab': this.poseGrab(p, this.grabT || 0); break;
      case 'stagger': this.poseStagger(p, clamp01(this.stateT / (this.staggerDur || 0.6))); break;
      case 'knock': this.poseFall(p, clamp01(this.stateT / 0.55), this.fallDir, false); break;
      case 'dying': this.poseFall(p, clamp01(this.stateT / 0.8), this.fallDir, this.crumple); break;
      case 'down': case 'dead': case 'gone': this.poseLie(p, this.fallDir); break;
      case 'getup': this.poseRise(p, this.stateT / 1.15, this.fallDir, false); break;
      case 'rise': this.poseRise(p, this.stateT / 1.7, this.fallDir, true); break;
      case 'crawl': this.poseCrawl(p, this.stepPhase); break;
      case 'spawn': this.poseSpawn(p, clamp01(this.stateT / 1.3)); break;
      case 'stun': this.poseStagger(p, 0.5); p[PC.SRX] += 0.5; p[PC.NRX] += 0.4; p[PC.LSZ] += 0.3; p[PC.RSZ] -= 0.3; break;
      case 'roar': this.poseWindup(p, smooth(clamp01(this.stateT / 0.5))); p[PC.HRX] -= 0.4; p[PC.LSZ] += 0.6; p[PC.RSZ] -= 0.6; break;
      case 'charge': this.poseWalk(p, this.stepPhase, false); p[PC.SRX] += 0.45; p[PC.CRX] += 0.2; break;
    }
    // Blend from the previous state's pose.
    this.blendT = Math.min(1, this.blendT + dt / Math.max(0.001, this.blendDur));
    const k = smooth(this.blendT), P = this.pose;
    for (let i = 0; i < PC.N; i++) P[i] = lerp(this.from[i], p[i], k);
    // Springs (hit reactions) on top.
    for (const key in this.springs) this.springs[key].update(dt);
    this.applyPose(dt);
  }
  applyPose(dt) {
    const P = this.pose, j = this.j, S = this.springs;
    const sp = (k) => (S[k] ? S[k].x : 0);
    j.hips.position.set(P[PC.PX], 0.95 + P[PC.PY] + sp('PY') * 0.05, P[PC.PZ]);
    j.hips.rotation.set(P[PC.PRX], P[PC.PRY], P[PC.PRZ]);
    j.spine.rotation.set(P[PC.SRX] + sp('SRX') * 0.12, P[PC.SRY] + sp('SRY') * 0.12, P[PC.SRZ] + sp('SRZ') * 0.12);
    j.chest.rotation.set(P[PC.CRX] + sp('CRX') * 0.12, P[PC.CRY], P[PC.CRZ]);
    j.neck.rotation.set(P[PC.NRX] + sp('NRX') * 0.14, P[PC.NRY] + sp('NRY') * 0.14 + (this.state === 'idle' ? (this.lookYaw || 0) * 0.6 : 0), P[PC.NRZ] + sp('NRZ') * 0.14);
    j.head.rotation.set(P[PC.HRX] + sp('HRX') * 0.14, P[PC.HRY] + (this.state === 'idle' ? (this.lookYaw || 0) * 0.4 : 0), P[PC.HRZ] + sp('HRZ') * 0.12);
    j.shL.rotation.set(P[PC.LSX] + sp('LSX') * 0.14, P[PC.LSY], P[PC.LSZ] + sp('LSZ') * 0.14);
    j.shR.rotation.set(P[PC.RSX] + sp('RSX') * 0.14, P[PC.RSY], P[PC.RSZ] + sp('RSZ') * 0.14);
    j.elL.rotation.x = -P[PC.LE]; j.elR.rotation.x = -P[PC.RE];
    j.hipL.rotation.set(P[PC.LTX], 0, P[PC.LTZ]); j.hipR.rotation.set(P[PC.RTX], 0, P[PC.RTZ]);
    j.knL.rotation.x = P[PC.LK] + Math.max(0, sp('LK')) * 0.12; j.knR.rotation.x = P[PC.RK] + Math.max(0, sp('RK')) * 0.12;
    j.anL.rotation.x = P[PC.LA]; j.anR.rotation.x = P[PC.RA];
    this.root.position.copy(this.pos); this.root.rotation.y = this.heading;
    this.root.updateMatrixWorld(true);
    this.headMarker.getWorldPosition(this.headPos);
    j.spine.getWorldPosition(this.hitCenter); this.hitCenter.y += 0.1 * this.scale;
    if (this.lurchFlash > 0) { this.lurchFlash -= dt; this.root.visible = Math.random() > 0.5; } else this.root.visible = true;
  }

  // ------------------------------------------------------------------ poses
  poseStand(p, t) {
    const sw = Math.sin(t * 0.8 + this.stepPhase) * 0.03;
    p[PC.SRX] = 0.12; p[PC.SRZ] = sw; p[PC.CRX] = 0.08; p[PC.NRX] = 0.15; p[PC.HRZ] = 0.28 + sw; p[PC.HRX] = 0.1;
    p[PC.LSX] = -0.12; p[PC.RSX] = -0.08; p[PC.LSZ] = 0.08; p[PC.RSZ] = -0.08; p[PC.LE] = 0.25; p[PC.RE] = 0.3;
    p[PC.LK] = 0.05; p[PC.RK] = 0.08; p[PC.PY] = -0.01;
  }
  poseWork(p, t) {
    this.poseStand(p, t);
    const w = t * 1.6 + this.stepPhase;
    switch (this.work) {
      case 'lathe':
        p[PC.SRX] = 0.28; p[PC.NRX] = 0.35; p[PC.HRZ] = 0.1;
        p[PC.LSX] = -0.9 + Math.sin(w) * 0.18; p[PC.RSX] = -0.85 + Math.cos(w) * 0.18; p[PC.LSZ] = -0.15; p[PC.RSZ] = 0.15;
        p[PC.LE] = 1.1 + Math.cos(w) * 0.25; p[PC.RE] = 1.0 - Math.sin(w) * 0.25; break;
      case 'hammer': {
        const c = (t * 0.9 + this.stepPhase) % 1, up = c < 0.7 ? smooth(c / 0.7) : 1 - easeIn((c - 0.7) / 0.3);
        p[PC.SRX] = 0.3; p[PC.NRX] = 0.4; p[PC.RSX] = -0.6 - up * 1.8; p[PC.RE] = 0.4 + up * 1.2; p[PC.LSX] = -0.8; p[PC.LE] = 1.2; p[PC.LSZ] = -0.2;
        if (c > 0.97 && !this.clanked) { this.clanked = true; if (this.distToPlayer < 20) G.audio.impact(this.headPos.clone().setY(1.0), 'metal'); }
        if (c < 0.5) this.clanked = false;
        break;
      }
      case 'locker': {
        const c = Math.sin(t * 0.7 + this.stepPhase);
        p[PC.RSX] = -1.1 - c * 0.25; p[PC.RE] = 0.5 + c * 0.3; p[PC.RSZ] = -0.2; p[PC.NRX] = 0.2; p[PC.HRZ] = 0.35;
        if (c > 0.97 && !this.clanked) { this.clanked = true; if (this.distToPlayer < 14) G.audio.impact(this.headPos.clone().setY(1.1), 'metal'); }
        if (c < 0) this.clanked = false;
        break;
      }
      case 'sink':
        p[PC.SRX] = 0.45; p[PC.NRX] = 0.45; p[PC.LSX] = -0.7 + Math.sin(w * 2) * 0.12; p[PC.RSX] = -0.7 - Math.sin(w * 2) * 0.12; p[PC.LE] = 1.2; p[PC.RE] = 1.2; p[PC.LSZ] = -0.3; p[PC.RSZ] = 0.3; break;
      case 'sweep': {
        const c = Math.sin(t * 1.1 + this.stepPhase);
        p[PC.SRY] = c * 0.35; p[PC.SRX] = 0.25; p[PC.LSX] = -0.5; p[PC.RSX] = -0.6; p[PC.LE] = 0.8; p[PC.RE] = 0.5; p[PC.LSZ] = -0.4 + c * 0.2; p[PC.RSZ] = 0.1 + c * 0.2; break;
      }
      case 'face': p[PC.NRX] = -0.05; p[PC.HRZ] = 0.45; p[PC.HRX] = 0; break;
    }
  }
  poseWalk(p, ph, recover) {
    const s = Math.sin(ph), c = Math.cos(ph), limp = this.crawler ? 0 : 0.5;
    p[PC.PY] = -0.03 - Math.abs(c) * 0.025; p[PC.PRZ] = s * 0.06; p[PC.PRY] = s * 0.1;
    p[PC.SRX] = 0.22 + (recover ? 0.2 : 0); p[PC.SRY] = -s * 0.12; p[PC.SRZ] = -s * 0.05 + 0.04;
    p[PC.CRX] = 0.12; p[PC.NRX] = 0.25 + Math.abs(s) * 0.08; p[PC.HRZ] = 0.3 + s * 0.06; p[PC.HRX] = 0.12;
    p[PC.LTX] = -0.42 * s; p[PC.RTX] = 0.42 * s * (1 - limp * 0.35);
    p[PC.LK] = Math.max(0, Math.sin(ph + 1.3)) * 0.75 + 0.05; p[PC.RK] = Math.max(0, Math.sin(ph + Math.PI + 1.3)) * 0.35 + 0.05;
    p[PC.RTZ] = -0.06; p[PC.LA] = 0.1; p[PC.RA] = 0.2;
    p[PC.LSX] = -0.45 + s * 0.18; p[PC.RSX] = -0.2 - s * 0.1; p[PC.LSZ] = 0.08; p[PC.RSZ] = -0.14;
    p[PC.LE] = 0.55; p[PC.RE] = 0.25;
  }
  poseWindup(p, k) {
    this.poseStand(p, 0);
    p[PC.SRX] = lerp(0.15, -0.28, k); p[PC.NRX] = lerp(0.2, -0.3, k); p[PC.HRX] = lerp(0.1, -0.25, k); p[PC.HRZ] = lerp(0.3, 0.05, k);
    p[PC.LSX] = lerp(-0.2, -1.9, k); p[PC.RSX] = lerp(-0.2, -1.9, k); p[PC.LSZ] = lerp(0.1, 0.45, k); p[PC.RSZ] = lerp(-0.1, -0.45, k);
    p[PC.LE] = lerp(0.3, 0.9, k); p[PC.RE] = lerp(0.3, 0.9, k);
    p[PC.PY] = -0.06 * k; p[PC.LK] = 0.3 * k; p[PC.RK] = 0.3 * k; p[PC.LTX] = -0.25 * k; p[PC.RTX] = 0.15 * k;
    if (this.crawler) { this.poseCrawl(p, 0); p[PC.LSX] = -2.6; p[PC.RSX] = -2.6; p[PC.NRX] = -0.5; }
  }
  poseLunge(p, k) {
    this.poseStand(p, 0);
    p[PC.SRX] = lerp(-0.28, 0.45, k); p[PC.NRX] = lerp(-0.3, 0.1, k); p[PC.HRX] = -0.1;
    p[PC.LSX] = -1.55; p[PC.RSX] = -1.55; p[PC.LSZ] = lerp(0.45, 0.1, k); p[PC.RSZ] = lerp(-0.45, -0.1, k); p[PC.LE] = lerp(0.9, 0.3, k); p[PC.RE] = lerp(0.9, 0.3, k);
    p[PC.LTX] = -0.6 * k; p[PC.RTX] = 0.4 * k; p[PC.LK] = 0.4; p[PC.RK] = 0.5 * k; p[PC.PY] = -0.08;
  }
  poseGrab(p, t) {
    this.poseStand(p, 0);
    const bite = this.biteAt ? clamp01((t - (this.biteAt - 0.5)) / 0.5) : 0;
    p[PC.SRX] = 0.3 + Math.sin(t * 9) * 0.04; p[PC.NRX] = 0.2 + bite * 0.3; p[PC.HRX] = -0.35 + bite * 0.2; p[PC.HRZ] = Math.sin(t * 5) * 0.15;
    p[PC.LSX] = -1.45; p[PC.RSX] = -1.45; p[PC.LSZ] = -0.35; p[PC.RSZ] = 0.35; p[PC.LE] = 1.15; p[PC.RE] = 1.15;
    p[PC.LK] = 0.25; p[PC.RK] = 0.3; p[PC.PY] = -0.05;
  }
  poseStagger(p, k) {
    this.poseStand(p, 0);
    const a = Math.sin(k * Math.PI);
    p[PC.SRX] = -0.35 * a + 0.1; p[PC.NRX] = -0.3 * a; p[PC.HRX] = -0.2 * a;
    p[PC.LSX] = 0.25 * a; p[PC.RSX] = 0.3 * a; p[PC.LSZ] = 0.5 * a; p[PC.RSZ] = -0.45 * a; p[PC.LE] = 0.5; p[PC.RE] = 0.4;
    p[PC.LTX] = 0.3 * a; p[PC.LK] = 0.4 * a; p[PC.RK] = 0.2 * a; p[PC.PY] = -0.05 * a;
  }
  // Fall: backward (dir -1) or forward (1). Crumple folds at the knees first.
  poseFall(p, k, dir, crumple) {
    this.poseStand(p, 0);
    if (crumple) {
      const k1 = clamp01(k / 0.4), k2 = clamp01((k - 0.35) / 0.65), e2 = easeIn(k2);
      p[PC.PY] = -0.45 * easeOut(k1) - 0.35 * e2; p[PC.LK] = 1.6 * k1 * (1 - e2 * 0.8); p[PC.RK] = 1.7 * k1 * (1 - e2 * 0.8); p[PC.LTX] = -1.2 * k1 * (1 - e2 * 0.9); p[PC.RTX] = -1.1 * k1 * (1 - e2 * 0.9);
      p[PC.PRX] = e2 * 1.45; p[PC.PZ] = e2 * 0.35; p[PC.SRX] = 0.3 + e2 * 0.1; p[PC.NRX] = 0.4 * k1 - e2 * 0.2; p[PC.HRZ] = 0.4 * k1;
      p[PC.LSX] = -0.3 + e2 * -1.2; p[PC.RSX] = -0.2 + e2 * -1.4; p[PC.LSZ] = 0.2 + e2 * 0.5; p[PC.RSZ] = -0.2 - e2 * 0.5; p[PC.LE] = 0.4; p[PC.RE] = 0.6;
      if (k > 0.97 && !this.thudded) { this.thudded = true; G.audio.thud(this.pos); G.fx.dust(_v3.copy(this.pos).setY(0.1), 0.6, 0.8); }
      return;
    }
    const e = easeIn(k);
    this.fallPose(p, e, dir);
    if (k > 0.97 && !this.thudded) { this.thudded = true; G.audio.thud(this.pos); G.fx.dust(_v3.copy(this.pos).setY(0.1), 0.6, 0.8); }
  }
  fallPose(p, e, dir) {
    p[PC.PRX] = dir * 1.5 * e; p[PC.PY] = -0.8 * e + Math.sin(e * Math.PI) * 0.05; p[PC.PZ] = dir * 0.45 * e * (dir < 0 ? 1 : 0.6);
    p[PC.LK] = 0.9 * Math.sin(e * Math.PI) + 0.1; p[PC.RK] = 0.7 * Math.sin(e * Math.PI) + 0.1; p[PC.LTX] = -0.4 * Math.sin(e * Math.PI) - (dir < 0 ? 0 : 0.1); p[PC.RTX] = -0.2 * Math.sin(e * Math.PI);
    p[PC.LTZ] = 0.15 * e; p[PC.RTZ] = -0.2 * e;
    p[PC.SRX] = dir * 0.2 * e; p[PC.NRX] = dir < 0 ? -0.2 * e : 0.3 * e; p[PC.HRZ] = 0.5 * e;
    p[PC.LSX] = dir < 0 ? -0.4 - e * 0.8 : -1.4 * e; p[PC.RSX] = dir < 0 ? -0.3 - e * 1.4 : -1.2 * e; p[PC.LSZ] = 0.3 + e * 0.9; p[PC.RSZ] = -0.3 - e * 0.7; p[PC.LE] = 0.3; p[PC.RE] = 0.7;
  }
  poseLie(p, dir) {
    this.fallPose(p, 1, dir);
    this.thudded = true;
    const b = Math.sin(G.time * 0.7 + this.stepPhase) * 0.01;
    p[PC.SRX] += b;
  }
  poseRise(p, k, dir, jerky) {
    // Stop-motion: hold poses between jumps so the rise reads as wrong.
    let kk = clamp01(k);
    if (jerky) { const steps = 9; kk = Math.floor(kk * steps) / steps + (Math.random() < 0.08 ? 0.05 : 0); kk = clamp01(kk); }
    const e = 1 - smooth(kk);
    this.poseStand(p, 0);
    this.fallPose(p, e, dir);
    if (jerky && k < 0.5) { p[PC.NRY] = Math.sin(G.time * 17) * 0.4 * (1 - k * 2); p[PC.HRX] = -0.5; }
  }
  poseCrawl(p, ph) {
    this.fallPose(p, 1, 1);
    const s = Math.sin(ph), c = Math.cos(ph);
    p[PC.PY] = -0.78; p[PC.NRX] = -0.75; p[PC.HRX] = -0.35;
    p[PC.LSX] = -2.6 + s * 0.5; p[PC.RSX] = -2.6 - s * 0.5; p[PC.LSZ] = 0.35; p[PC.RSZ] = -0.35;
    p[PC.LE] = 0.6 + Math.max(0, c) * 0.8; p[PC.RE] = 0.6 + Math.max(0, -c) * 0.8;
    p[PC.LTX] = 0.1; p[PC.RTX] = 0.25; p[PC.LK] = 0.2; p[PC.RK] = 0.6; p[PC.SRZ] = s * 0.1;
  }
  poseSpawn(p, k) {
    // Rising from a kneel, head last.
    this.poseStand(p, 0);
    const e = 1 - smooth(k);
    p[PC.PY] = -0.45 * e; p[PC.LK] = 1.7 * e; p[PC.RK] = 1.2 * e; p[PC.LTX] = -1.3 * e; p[PC.RTX] = -0.3 * e;
    p[PC.SRX] = 0.6 * e + 0.1; p[PC.NRX] = 0.9 * e; p[PC.LSX] = -0.3; p[PC.RSX] = -0.3;
  }
}
