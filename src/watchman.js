'use strict';
// "巡夜人" — appears only while the PA plays the off-key song. Cannot be hurt.
// It perceives light, gunfire and running; darkness and stillness are the counterplay (rule two).

class Watchman {
  constructor(x, z) {
    this.pos = new V3(x, 0, z);
    this.heading = 0; this.state = 'appear'; this.stateT = 0;
    this.lastKnown = new V3(); this.memory = 0; this.way = new V3(x, 0, z);
    this.active = true; this.fade = 0; this.flinch = 0;
    this.build();
    this.voice = G.audio.loop(this.pos, (g) => {
      const ctx = G.audio.ctx, o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const n = ctx.createBufferSource(); n.buffer = G.audio.noiseBuf; n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0.35;
      const trem = ctx.createOscillator(), tg = ctx.createGain(); trem.frequency.value = 7; tg.gain.value = 0.25; trem.connect(tg); tg.connect(ng.gain);
      o.connect(lp); lp.connect(g); n.connect(bp); bp.connect(ng); ng.connect(g);
      o.start(); n.start(); trem.start();
      return [o, n, trem];
    }, { level: 0, ref: 2.5, roll: 1.1 });
    G.audio.staticBurst(1.2, 0.35);
  }
  build() {
    const g = this.root = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a544c, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x3a0806, side: THREE.BackSide });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.2, 0.46, 1.9, 14, 1, true), coat, 0, 0.95, 0);
    add(new THREE.CylinderGeometry(0.19, 0.2, 0.25, 14), coat, 0, 1.98, 0);
    add(new THREE.BoxGeometry(0.62, 0.14, 0.26), coat, 0, 2.08, 0);
    this.armL = add(new THREE.CapsuleGeometry(0.045, 1.25, 3, 8), coat, 0.33, 1.38, 0.02, 0, 0, 0.06);
    this.armR = add(new THREE.CapsuleGeometry(0.045, 1.25, 3, 8), coat, -0.33, 1.38, 0.02, 0, 0, -0.06);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), metal, 0, 2.3, 0);
    this.head = new THREE.Group(); this.head.position.set(0, 2.5, 0.05); g.add(this.head);
    const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.34, 0.62, 18, 1, true), metal); horn.rotation.x = Math.PI / 2; horn.position.z = 0.22; horn.castShadow = true; this.head.add(horn);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.33, 0.6, 18, 1, true), this.glowMat); inner.rotation.x = Math.PI / 2; inner.position.z = 0.22; this.head.add(inner);
    const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 12), metal); driver.rotation.x = Math.PI / 2; driver.position.z = -0.12; this.head.add(driver);
    g.position.copy(this.pos);
    g.scale.setScalar(0.001);
    G.scene.add(g);
  }
  // Bullets pass through it; it notices who fired.
  checkShot(ro, rd, maxT) {
    if (!this.active || this.state === 'vanish') return;
    const a = _v3.set(this.pos.x, 0.3, this.pos.z), b = new V3(this.pos.x, 2.6, this.pos.z);
    const t = rayCapsule(ro, rd, a, b, 0.4);
    if (t > 0 && t < maxT) {
      this.flinch = 0.4;
      G.fx.staticPuff(new V3(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t), 30);
      G.audio.glitch(this.pos);
      this.detect(true);
    }
  }
  detect(loud) {
    const P = G.player;
    this.lastKnown.copy(P.pos); this.memory = 3.2;
    if (this.state !== 'hunt' && this.state !== 'attack') { this.state = 'hunt'; this.stateT = 0; G.audio.screech(this.head.getWorldPosition(new V3())); G.director.onWatchmanAlert(); }
  }
  update(dt) {
    const P = G.player;
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt);
    const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    this.dist = d;
    if (this.state === 'appear') {
      this.fade = Math.min(1, this.stateT / 1.5);
      if (this.stateT > 1.5) { this.state = 'wander'; this.stateT = 0; this.pickWaypoint(); }
    } else if (this.state === 'vanish') {
      this.fade = Math.max(0, 1 - this.stateT / 0.8);
      if (this.stateT > 0.8) { this.active = false; }
    } else if (this.state === 'relocate') {
      this.fade = 0;
      if (this.stateT > 2.2) { const p = G.director.farPoint(12); this.pos.set(p.x, 0, p.z); this.state = 'appear'; this.stateT = 0; G.fx.staticPuff(new V3(p.x, 1.4, p.z), 40); }
    } else {
      // Perception.
      const eye = this.head.getWorldPosition(_v4);
      const los = G.level.los(eye, P.camera.position);
      let seen = false;
      if (P.alive && P.state !== 'dead') {
        if (P.flashlightOn && d < 22 && los) seen = true;
        if (P.sprinting && P.speed > 3 && d < 10) seen = true;
        if (d < 2.4) seen = true;
        for (const n of G.noises) {
          if (G.time - n.t > 0.3) continue;
          if (n.kind === 'gun' && d < 32) seen = true;
          else if (n.kind === 'kick' && Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < n.r) seen = true;
        }
      }
      if (seen) this.detect();
      if (this.state === 'hunt') {
        if (seen) this.lastKnown.copy(P.pos);
        else this.memory -= dt;
        this.moveTo(this.lastKnown, 5.0, dt);
        if (d < 1.15 && P.state !== 'dead') this.attack();
        else if (this.memory <= 0) { this.state = 'wander'; this.stateT = 0; this.pickWaypoint(); }
      } else if (this.state === 'wander') {
        this.moveTo(this.way, 1.35, dt);
        if (Math.hypot(this.way.x - this.pos.x, this.way.z - this.pos.z) < 0.8 || this.stateT > 9) { this.stateT = 0; this.pickWaypoint(); }
      } else if (this.state === 'attack') {
        if (this.stateT > 0.5) { this.state = 'relocate'; this.stateT = 0; G.fx.staticPuff(new V3(this.pos.x, 1.5, this.pos.z), 50); }
      }
      // Its presence disturbs the flashlight.
      if (d < 9) P.flashInterfere = 0.15 * (1 - d / 9) + 0.02;
    }
    // Visual update.
    const s = Math.max(0.001, this.fade);
    this.root.scale.set(1, s, 1);
    this.root.visible = s > 0.01 && !(this.flinch > 0 && Math.random() < 0.5);
    this.root.position.set(this.pos.x + (this.flinch > 0 ? rand(-0.08, 0.08) : 0), 0, this.pos.z);
    this.root.rotation.y = this.heading;
    const hunting = this.state === 'hunt' || this.state === 'attack';
    this.glowMat.color.setRGB(hunting ? 0.9 : 0.25, hunting ? 0.08 : 0.03, 0.02).multiplyScalar(0.6 + Math.sin(G.time * (hunting ? 20 : 3)) * 0.4);
    this.head.rotation.x = Math.sin(G.time * 1.3) * 0.08 + (hunting ? -0.1 : 0.15);
    this.head.rotation.z = Math.sin(G.time * 0.7) * 0.15;
    this.armL.rotation.x = Math.sin(G.time * 0.9) * 0.05 - (hunting ? 0.5 : 0); this.armR.rotation.x = Math.sin(G.time * 0.9 + 1) * 0.05 - (hunting ? 0.5 : 0);
    if (this.voice) {
      const p = this.voice.panner;
      p.positionX.value = this.pos.x; p.positionY.value = 2.4; p.positionZ.value = this.pos.z;
      this.voice.set(this.active && this.fade > 0 ? (hunting ? 0.2 : 0.09) : 0);
    }
  }
  moveTo(target, speed, dt) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const want = Math.atan2(dx, dz);
    this.heading += clamp(angleTo(this.heading, want), -4 * dt, 4 * dt);
    const sp = Math.min(speed, d / dt);
    this.pos.x += Math.sin(this.heading) * sp * dt; this.pos.z += Math.cos(this.heading) * sp * dt;
    G.level.collideCircle(this.pos, 0.4, { noProps: true });
  }
  pickWaypoint() {
    const P = G.player;
    for (let i = 0; i < 20; i++) {
      const x = P.pos.x + rand(-9, 9), z = P.pos.z + rand(-9, 9);
      if (G.level.roomAt(x, z) === ROOMS[5]) { this.way.set(x, 0, z); return; }
    }
    this.way.set(41, 0, 28);
  }
  attack() {
    const P = G.player;
    this.state = 'attack'; this.stateT = 0;
    const dir = _v1.subVectors(P.pos, this.pos).setY(0).normalize();
    P.vel.addScaledVector(dir, 8);
    P.hurt(42, this.pos, 'watchman');
    G.audio.screech(this.pos); G.audio.staticBurst(0.8, 0.5);
    G.post && (G.post.glitch = 1);
  }
  vanish() { if (this.state !== 'vanish') { this.state = 'vanish'; this.stateT = 0; G.fx.staticPuff(new V3(this.pos.x, 1.4, this.pos.z), 40); } }
  dispose() {
    G.scene.remove(this.root);
    if (this.voice) { this.voice.set(0); const v = this.voice; setTimeout(() => { try { v.nodes.forEach((n) => n.stop()); v.panner.disconnect(); } catch (e) { /* already stopped */ } }, 300); G.audio.loops = G.audio.loops.filter((l) => l !== v); }
  }
}
