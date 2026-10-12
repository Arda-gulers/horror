'use strict';
// "考勤钟" — the anchor of the anomaly. Armoured face; on each chime it opens and an eye looks out.
// Rule six: it only looks at you when it chimes. That look is the damage window.

class TimeClock {
  constructor() {
    this.base = new V3(41, 0, 39.55);
    this.faceC = new V3(41, 3.25, 39.2);
    this.state = 'dormant'; this.stateT = 0;
    this.segment = 0; this.hp = 100; this.segHP = 100;
    this.period = 30; this.timer = 30; this.chimes = 0;
    this.faceOpen = 0; this.exposeT = 0; this.gazing = false; this.eyeFlinch = 0;
    this.tickT = 0; this.tock = false; this.pend = 0; this.spinV = 0;
    this.build();
  }
  build() {
    const L = G.level, g = this.root = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: TEX.wood, normalMap: TEX.woodN, color: 0x7a4a36, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x140b08, roughness: 0.6 });
    const brass = L.mats.brass;
    const glass = new THREE.MeshStandardMaterial({ color: 0x9aa8b0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false });
    const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    // Case.
    add(new THREE.BoxGeometry(1.8, 0.5, 0.8), wood, 0, 0.25, 0);
    add(new THREE.BoxGeometry(1.4, 2.1, 0.6), wood, 0, 1.55, 0.02);
    add(new THREE.BoxGeometry(1.1, 1.7, 0.02), dark, 0, 1.55, -0.29);
    add(new THREE.BoxGeometry(1.14, 1.74, 0.01), glass, 0, 1.55, -0.305);
    // Hood: a frame around a recess where the eye lives, closed off by a round bezel.
    add(new THREE.BoxGeometry(0.25, 1.5, 0.75), wood, -0.725, 3.35, 0);
    add(new THREE.BoxGeometry(0.25, 1.5, 0.75), wood, 0.725, 3.35, 0);
    add(new THREE.BoxGeometry(1.2, 0.15, 0.75), wood, 0, 4.025, 0);
    add(new THREE.BoxGeometry(1.2, 0.15, 0.75), wood, 0, 2.675, 0);
    add(new THREE.BoxGeometry(1.2, 1.2, 0.05), dark, 0, 3.35, 0.35);
    add(new THREE.RingGeometry(0.58, 0.86, 40), wood, 0, 3.3, -0.376).rotation.y = Math.PI;
    add(new THREE.BoxGeometry(1.9, 0.18, 0.85), wood, 0, 4.18, 0);
    add(new THREE.BoxGeometry(1.1, 0.35, 0.6), wood, 0, 4.44, 0.05);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12), brass, 0, 4.7, 0.05);
    // Pendulum.
    this.pendulum = new THREE.Group(); this.pendulum.position.set(0, 2.45, -0.22); g.add(this.pendulum);
    add(new THREE.BoxGeometry(0.03, 1.2, 0.01), brass, 0, -0.6, 0, this.pendulum);
    const bob = add(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 24), brass, 0, -1.25, 0, this.pendulum); bob.rotation.x = Math.PI / 2;
    // Eye behind the face.
    this.eyeMat = new THREE.MeshStandardMaterial({ map: TEX.eye, roughness: 0.15, emissive: 0xffffff, emissiveMap: TEX.eye, emissiveIntensity: 0.3 });
    // Iris sits on the sphere's +Z (u = 0.25); yaw PI turns it toward the room.
    this.eye = add(new THREE.SphereGeometry(0.42, 28, 20), this.eyeMat, 0, 3.3, 0.1);
    this.eye.rotation.order = 'YXZ'; this.eye.rotation.y = Math.PI;
    add(new THREE.CylinderGeometry(0.58, 0.5, 0.7, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a0c08, roughness: 0.7, side: THREE.BackSide }), 0, 3.3, 0.0).rotation.x = Math.PI / 2;
    // Hinged face (door) with dial and hands.
    this.faceHinge = new THREE.Group(); this.faceHinge.position.set(-0.6, 3.3, -0.4); g.add(this.faceHinge);
    this.faceMat = new THREE.MeshStandardMaterial({ map: TEX.clockFace, roughness: 0.35, emissive: 0xffffff, emissiveMap: TEX.clockFace, emissiveIntensity: 0.22 });
    const dial = add(new THREE.CircleGeometry(0.56, 40), this.faceMat, 0.6, 0, -0.012, this.faceHinge); dial.rotation.y = Math.PI;
    const rim = add(new THREE.TorusGeometry(0.58, 0.035, 8, 40), brass, 0.6, 0, -0.01, this.faceHinge);
    const back = add(new THREE.CircleGeometry(0.58, 40), dark, 0.6, 0, 0.005, this.faceHinge);
    this.glass = add(new THREE.CircleGeometry(0.56, 40), glass, 0.6, 0, -0.03, this.faceHinge); this.glass.rotation.y = Math.PI;
    const handMat = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.5, metalness: 0.4 });
    this.hourHand = new THREE.Group(); this.hourHand.position.set(0.6, 0, -0.022); this.faceHinge.add(this.hourHand);
    this.minHand = new THREE.Group(); this.minHand.position.set(0.6, 0, -0.026); this.faceHinge.add(this.minHand);
    add(new THREE.BoxGeometry(0.035, 0.3, 0.008), handMat, 0, 0.13, 0, this.hourHand);
    add(new THREE.BoxGeometry(0.022, 0.46, 0.008), handMat, 0, 0.2, 0, this.minHand);
    this.hourHand.rotation.z = 0; this.minHand.rotation.z = -0.05;
    // Punch card racks on both sides.
    const cardMat = new THREE.MeshStandardMaterial({ map: TEX.punchCard, roughness: 0.8 });
    for (const sx of [-1.9, 1.9]) {
      add(new THREE.BoxGeometry(1.1, 1.5, 0.12), wood, sx, 1.7, 0.28);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
        if (Math.random() < 0.12) continue;
        const card = add(new THREE.PlaneGeometry(0.2, 0.1), cardMat, sx - 0.39 + c * 0.26, 1.1 + r * 0.22 + rand(0, 0.04), 0.21);
        card.rotation.y = Math.PI; card.rotation.z = rand(-0.05, 0.05);
      }
    }
    // Built facing -Z (north, into the workshop): no rotation needed.
    g.position.copy(this.base);
    G.scene.add(g);
    // Colliders (world space; clock faces -Z, i.e. north).
    L.col(40.05, 0, 39.1, 41.95, 4.6, 40, 'wood', 'clock');
    L.col(38.8, 0.9, 39.6, 39.9, 2.5, 40, 'wood'); L.col(42.1, 0.9, 39.6, 43.2, 2.5, 40, 'wood');
    // Glow as a managed lamp.
    this.lamp = { kind: 'none', pos: new V3(41, 4.2, 37.9), color: new THREE.Color(0xe8e0b0), base: 6, range: 10, flicker: 'slight', f: 1, on: true, override: null, phase: 7, state: 1, timer: 1, poolSlot: -1, weight: 0, bulbMat: new THREE.MeshBasicMaterial(), room: 'workshop' };
    L.lamps.push(this.lamp);
  }
  reset() {
    this.state = 'dormant'; this.stateT = 0; this.segment = 0; this.hp = this.segHP; this.period = 30; this.timer = 30; this.chimes = 0;
    this.faceOpen = 0; this.gazing = false; this.exposeT = 0; this.paused = false; this.overtime = false;
    this.lamp.tint = null; this.eyeMat.emissiveIntensity = 0.6; this.eyeMat.color.setHex(0xffffff);
    this.faceHinge.rotation.set(0, 0, 0); this.eye.rotation.x = 0;
  }
  activate() { this.state = 'active'; this.stateT = 0; this.timer = 14; }
  // ------------------------------------------------------------------ hits
  rayHit(ro, rd, maxT) {
    if (!this.root) return null;
    let best = null;
    if (this.faceOpen > 0.55 && this.state !== 'dead') {
      const eyeC = this.eyeC || (this.eyeC = new V3(41, 3.3, 39.65));
      const t = raySphere(ro, rd, eyeC, 0.42);
      if (t > 0 && t < maxT) best = { t, part: 'eye', point: new V3().copy(ro).addScaledVector(rd, t), normal: new V3(0, 0, -1) };
    }
    // Closed face (glass disc) — a thin slab at z = 39.12.
    if (!best && rd.z > 0.01) {
      const t = (39.12 - ro.z) / rd.z;
      if (t > 0 && t < maxT) {
        const x = ro.x + rd.x * t, y = ro.y + rd.y * t;
        if (Math.hypot(x - 41, y - 3.3) < 0.58 && this.faceOpen < 0.55) best = { t, part: 'glass', point: new V3(x, y, 39.12), normal: new V3(0, 0, -1) };
      }
    }
    return best;
  }
  takeHit(hit, def, focused, dir) {
    if (hit.part === 'glass') {
      G.fx.decals.glass.add(hit.point, hit.normal, rand(0.12, 0.2));
      G.fx.impact(hit.point, hit.normal, 'metal', dir, 0.4);
      G.audio.impact(hit.point, 'glass');
      if (!this.glassHint) { this.glassHint = true; G.ui.toast('表盘打不穿。等它报时。'); }
      return;
    }
    if (hit.part !== 'eye' || this.state === 'dead') return;
    const dmg = def.dmg * (focused ? 1.5 : 1) * (def.pellets > 1 ? 0.75 : 1) * lerp(1, 0.6, invLerp(10, 25, hit.t));
    this.hp -= dmg;
    this.eyeFlinch = 0.25;
    G.fx.blood(hit.point, dir, def.pellets > 1 ? 0.35 : 0.9);
    if (!this.lastHurt || G.time - this.lastHurt > 0.35) { this.lastHurt = G.time; G.audio.eyeHurt(hit.point); }
    G.ui.hitMarker('head');
    G.player.stats.hits++;
    if (this.hp <= 0) this.breakSegment();
  }
  breakSegment() {
    this.segment++;
    this.hp = this.segHP;
    G.audio.eyeHurt(this.faceC); G.audio.metalSlam(this.faceC);
    G.fx.blood(new V3(41, 3.3, 39.0), new V3(0, -0.2, -1), 3);
    G.player.addTrauma(0.45); hitstop(0.12, 0.03); slowmo(0.5, 0.35);
    G.level.kickSwing(0.9);
    this.spinV = -40;
    if (this.segment >= 3) { this.state = 'dead'; this.stateT = 0; G.director.onClockDestroyed(); return; }
    this.state = 'active'; this.timer = Math.max(8, this.period * 0.6); this.exposeT = 0;
    G.director.onClockSegment(this.segment);
  }
  // ------------------------------------------------------------------ update
  update(dt) {
    this.stateT += dt;
    const P = G.player;
    // Pendulum and tick-tock, faster when a chime is near.
    const urgency = this.state === 'active' ? clamp01(1 - this.timer / 6) : 0;
    const rate = this.state === 'dead' ? 0 : (1 + urgency * 2.5);
    this.pend += dt * rate * Math.PI;
    this.pendulum.rotation.z = Math.sin(this.pend) * 0.12;
    this.tickT -= dt * rate;
    if (this.tickT <= 0 && this.state !== 'dead') { this.tickT = 1; this.tock = !this.tock; if (this.dist() < 30) G.audio.tick(this.faceC, this.tock); }
    // Hands.
    this.spinV = damp(this.spinV, this.state === 'chime' ? -8 : 0, 1.5, dt);
    this.minHand.rotation.z += (this.spinV - 0.01) * dt; this.hourHand.rotation.z += (this.spinV / 12 - 0.001) * dt;
    if (this.state === 'active' && !this.paused) {
      this.timer -= dt;
      if (this.timer <= 0) this.chime();
    } else if (this.state === 'chime') {
      if (this.stateT > 0.5) this.faceOpen = Math.min(1, this.faceOpen + dt * 2.2);
      this.exposeT -= dt;
      if (this.exposeT <= 0) { this.state = 'active'; this.timer = this.period; this.stateT = 0; }
    }
    if (this.state !== 'chime') this.faceOpen = Math.max(0, this.faceOpen - dt * (this.state === 'dead' ? 0.4 : 1.6));
    this.faceHinge.rotation.y = this.faceOpen * 1.85;
    // The eye tracks the player; its gaze empowers the workers.
    this.eyeFlinch = Math.max(0, this.eyeFlinch - dt);
    const open = this.faceOpen > 0.55 && this.state !== 'dead';
    this.gazing = open && G.level.los(_v4.set(41, 3.3, 39.0), P.camera.position);
    if (open) {
      const lx = P.camera.position.x - this.base.x, ly = P.camera.position.y - 3.3, lz = P.camera.position.z - (this.base.z + 0.1);
      const yaw = Math.atan2(lx, lz), pitch = Math.atan2(ly, Math.hypot(lx, lz));
      const jitter = this.eyeFlinch > 0 ? rand(-0.3, 0.3) : 0;
      this.eye.rotation.y += angleTo(this.eye.rotation.y, yaw + jitter) * (1 - Math.exp(-8 * dt));
      this.eye.rotation.x = damp(this.eye.rotation.x, -pitch, 8, dt);
    }
    // The exposed eye is the weak point: it has to read from the far end of the hall.
    this.eyeMat.emissiveIntensity = open ? 2.6 + Math.sin(G.time * 6) * 0.6 + (this.eyeFlinch > 0 ? 3 : 0) : 0.3;
    this.lamp.tint = open ? new THREE.Color(0xff5a3a) : null;
    this.lamp.base = open ? 11 : 6;
    this.faceMat.emissiveIntensity = this.state === 'dead' ? 0.02 : 0.22 + urgency * 0.4 * (Math.sin(G.time * 12) > 0 ? 1 : 0.3);
    if (this.state === 'dead') {
      // The face hangs off its hinge and the spent eye sags in its socket.
      this.faceHinge.rotation.y = 2.3; this.faceHinge.rotation.x = damp(this.faceHinge.rotation.x, 0.4, 3, dt);
      this.eye.rotation.x = damp(this.eye.rotation.x, 0.75, 1.5, dt);
      this.eyeMat.emissiveIntensity = 0; this.eyeMat.color.setHex(0x5a5048);
    }
  }
  dist() { return G.player.camera.position.distanceTo(this.faceC); }
  chime() {
    this.chimes++;
    this.state = 'chime'; this.stateT = 0;
    const strikes = Math.min(this.chimes, 6);
    G.audio.bell(this.faceC, strikes, 1.05);
    this.exposeT = 0.5 + strikes * 1.05 + 3.2;
    G.level.kickSwing(0.25);
    G.director.onChime(this.chimes);
  }
}
