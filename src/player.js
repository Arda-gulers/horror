'use strict';
// Player: movement, camera feel (aim recoil vs view punch vs shake), flashlight, health, grab struggle.

const MOVE = {
  walk: 3.3, strafe: 0.92, back: 0.72, sprint: 5.7, ads: 0.52, heal: 0.5, danger: 0.9,
  accel: 13, decel: 15, radius: 0.33, eye: 1.62,
  stride: 1.55, bobWalk: 0.026, bobSprint: 0.045,
  staminaSprint: 15, staminaKick: 20, staminaRegen: 26, staminaDelay: 0.9,
};

class Player {
  constructor(scene, camera) {
    this.camera = camera;
    this.pos = new V3(3.4, 0, 9.4);
    this.vel = new V3();
    this.yaw = Math.PI / 2 - 0.35; this.pitch = -0.05;
    this.hp = 100; this.maxHp = 100; this.stamina = 100; this.exhausted = false; this.staminaT = 0;
    this.inv = { pistol: 16, shells: 0, aid: 0, hasShotgun: false };
    this.state = 'normal';
    this.recoilP = new Spring(4.2, 0.95); this.recoilY = new Spring(4.2, 0.95);
    this.punchP = new Spring(6.5, 0.42); this.punchY = new Spring(6.5, 0.42); this.punchR = new Spring(5.5, 0.38);
    this.fovPunch = new Spring(7, 0.55);
    this.trauma = 0; this.shakeT = 0;
    this.bobPhase = 0; this.bobAmp = 0; this.lastStep = 0;
    this.sprinting = false; this.sprintBlend = 0; this.moving = 0; this.speed = 0;
    this.healing = 0; this.healDur = 2.3;
    this.grab = null; this.grabImmune = 0;
    this.deathT = 0; this.hurtT = 0; this.lowHpBeat = 0;
    this.flashlightOn = true; this.flashFlicker = 0;
    this.flashDir = new V3(0, 0, -1);
    this.aimDir = new V3(0, 0, -1);
    this.lunge = new Spring(6, 0.6); // forward camera lunge on kicks
    this.dmgFlash = 0; this.dmgCA = 0;
    this.noiseT = 0;
    this.lookLock = null;
    this.stats = { shots: 0, hits: 0, heads: 0, kills: 0, confirms: 0, grabs: 0, escapes: 0, dmg: 0, heals: 0, deaths: 0, violations: 0, stomps: 0, kicks: 0 };
    this.initFlashlight(scene);
  }

  initFlashlight(scene) {
    // Lower decay than physical: a handheld beam that still reaches the far end of a corridor.
    const L = this.flashlight = new THREE.SpotLight(0xfff0dc, 0, 30, 0.5, 0.85, 1.3);
    L.map = TEX.cookie;
    L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0003; L.shadow.normalBias = 0.025;
    L.shadow.camera.near = 0.15; L.shadow.camera.far = 28;
    scene.add(L, L.target);
    this.flashBase = 24;
  }

  get eye() { return this.camera.position; }
  get alive() { return this.state !== 'dead'; }
  forward(out) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  // Recoil: 'aim' part moves where bullets go (partially recovers), 'view' part is visual only.
  addRecoil(pitchDeg, yawDeg, recoverFrac, viewDeg, rollDeg, fov, trauma) {
    const m = TUNE.recoil;
    const w = TAU * 4.2;
    if (TUNE.fx.aimRecoil) {
      this.pitch += pitchDeg * DEG * m * (1 - recoverFrac);
      this.yaw += yawDeg * DEG * m * (1 - recoverFrac);
      this.recoilP.kick(pitchDeg * DEG * m * recoverFrac * w * Math.E);
      this.recoilY.kick(yawDeg * DEG * m * recoverFrac * w * Math.E);
    }
    if (TUNE.fx.viewPunch) {
      this.punchP.kick(viewDeg * DEG * m * 30);
      this.punchR.kick(rollDeg * DEG * m * 30);
    }
    if (TUNE.fx.fovPunch) this.fovPunch.kick(fov * 30);
    this.addTrauma(trauma);
  }
  addTrauma(t) { if (TUNE.fx.shake) this.trauma = Math.min(1, this.trauma + t * TUNE.shake); }

  // ------------------------------------------------------------------ update
  update(dt, rdt) {
    const W = G.weapons;
    this.grabImmune = Math.max(0, this.grabImmune - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.state === 'dead') { this.updateDeath(rdt); this.updateCamera(rdt); return; }

    // Look. Raw input, never time-scaled.
    const ads = W ? W.ads : 0;
    const sens = 0.0021 * TUNE.sens * (1 - ads * (1 - TUNE.adsSens));
    let dx = Input.mdx * sens, dy = Input.mdy * sens * (TUNE.invertY ? -1 : 1);
    if (this.state === 'grabbed') { dx *= 0.15; dy *= 0.15; }
    this.yaw -= dx; this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
    this.lookDelta = Math.hypot(Input.mdx, Input.mdy);

    if (this.state === 'grabbed') this.updateGrab(dt);
    else this.updateMove(dt);

    // Healing channel.
    if (this.healing > 0) {
      this.healing -= dt;
      if (this.state !== 'normal') this.healing = 0;
      else if (this.healing <= 0) {
        this.hp = Math.min(this.maxHp, this.hp + 55); this.inv.aid--; this.stats.heals++;
        G.audio.pickup('paper'); G.ui.toast('包扎完毕');
      }
    }
    if (Input.hit('KeyQ') && this.state === 'normal' && this.healing <= 0) this.startHeal();
    if (Input.hit('KeyF') && this.state === 'normal') this.toggleFlashlight();
    // Stamina.
    if (this.staminaT > 0) this.staminaT -= dt;
    else this.stamina = Math.min(100, this.stamina + MOVE.staminaRegen * dt);
    if (this.exhausted && this.stamina > 35) this.exhausted = false;
    this.breathT = (this.breathT || 0) - dt;
    if (this.stamina < 25 && this.breathT <= 0) { this.breathT = 1.3; G.audio.breath(0.2 + (25 - this.stamina) / 60); }
    // Low health heartbeat.
    const danger = this.hp / this.maxHp;
    if (danger < 0.4) {
      this.lowHpBeat -= dt;
      if (this.lowHpBeat <= 0) { this.lowHpBeat = lerp(0.55, 1.1, danger / 0.4); G.audio.heartbeat(0.25 + (0.4 - danger)); }
      G.audio.setMuffle(lerp(1400, 9000, danger / 0.4), 0.5);
    } else if (this.wasLow) G.audio.setMuffle(20000, 0.5);
    this.wasLow = danger < 0.4;
    this.interact();
    this.updateCamera(rdt, dt);
  }

  updateMove(dt) {
    const W = G.weapons, fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw), rX = Math.cos(this.yaw), rZ = -Math.sin(this.yaw);
    let f = (Input.key('KeyW') ? 1 : 0) - (Input.key('KeyS') ? 1 : 0);
    let s = (Input.key('KeyD') ? 1 : 0) - (Input.key('KeyA') ? 1 : 0);
    const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
    const wantSprint = Input.key('ShiftLeft') || Input.key('ShiftRight');
    const canSprint = f > 0.5 && !this.exhausted && this.stamina > 0 && W.ads < 0.3 && this.healing <= 0 && W.action !== 'kick';
    this.sprinting = wantSprint && canSprint;
    let speed = MOVE.walk;
    if (this.sprinting) speed = MOVE.sprint;
    const dirScale = f < 0 ? MOVE.back : (Math.abs(s) > Math.abs(f) ? MOVE.strafe : 1);
    speed *= this.sprinting ? 1 : dirScale;
    speed *= lerp(1, MOVE.ads, W.ads);
    if (this.healing > 0) speed *= MOVE.heal;
    if (this.hp / this.maxHp < 0.25) speed *= MOVE.danger;
    const tx = (fwdX * f + rX * s) * speed, tz = (fwdZ * f + rZ * s) * speed;
    const rate = len > 0 ? MOVE.accel : MOVE.decel;
    this.vel.x = damp(this.vel.x, tx, rate, dt); this.vel.z = damp(this.vel.z, tz, rate, dt);
    if (this.sprinting && Math.hypot(this.vel.x, this.vel.z) > 3) { this.stamina = Math.max(0, this.stamina - MOVE.staminaSprint * dt); this.staminaT = MOVE.staminaDelay; if (this.stamina <= 0) this.exhausted = true; }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    G.level.collideCircle(this.pos, MOVE.radius);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.sprintBlend = damp(this.sprintBlend, this.sprinting && this.speed > 3 ? 1 : 0, 10, dt);
    // Footsteps and bob.
    const prev = this.bobPhase;
    this.bobPhase += this.speed / MOVE.stride * Math.PI * dt;
    this.bobAmp = damp(this.bobAmp, this.speed > 0.3 ? (this.sprinting ? MOVE.bobSprint : MOVE.bobWalk * this.speed / MOVE.walk) : 0, 8, dt);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI) && this.speed > 0.8) {
      const c = G.level.cellAt(this.pos.x, this.pos.z);
      G.audio.footstep(this.pos, c && c.floor === 'mosaic' ? 'tile' : 'concrete', this.sprinting, true);
      if (this.sprinting) emitNoise(this.pos.x, 0, this.pos.z, 9, 'step');
    }
  }

  updateGrab(dt) {
    const g = this.grab;
    this.vel.set(0, 0, 0);
    g.t += dt;
    if (Input.hit('KeyV') || Input.hit('Space') || Input.mmbP) {
      g.escape += 0.15; G.audio.whoosh(); this.addTrauma(0.12); this.punchR.kick(rand(-1, 1) * 1.2);
      if (g.enemy) g.enemy.struggleJolt();
    }
    g.escape = Math.max(0, g.escape - 0.35 * dt);
    if (g.escape >= 1 && g.enemy) g.enemy.grabEscaped('struggle');
    // Force the view onto the attacker's face.
    if (g.enemy) {
      const h = g.enemy.headPos;
      const dx = h.x - this.eye.x, dy = h.y - this.eye.y, dz = h.z - this.eye.z;
      const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
      this.yaw += angleTo(this.yaw, ty) * (1 - Math.exp(-10 * dt));
      this.pitch += (tp - this.pitch) * (1 - Math.exp(-10 * dt));
    }
  }
  beginGrab(enemy) {
    this.state = 'grabbed';
    this.grab = { enemy, t: 0, escape: 0 };
    this.healing = 0;
    this.stats.grabs++;
    this.hurt(7, enemy.pos, 'grab');
    slowmo(0.16, 0.25);
    this.addTrauma(0.5); this.punchP.kick(-2);
    if (TUNE.fx.fovPunch) this.fovPunch.kick(-8 * 30 / 30);
    G.audio.scream(0.9);
    G.audio.setMuffle(3500, 0.05);
  }
  endGrab(escaped) {
    if (this.state !== 'grabbed') return;
    this.state = 'normal';
    this.grab = null;
    this.grabImmune = 1.6;
    if (escaped) this.stats.escapes++;
    G.audio.setMuffle(this.hp / this.maxHp < 0.4 ? 5000 : 20000, 0.3);
  }

  startHeal() {
    if (this.inv.aid <= 0) { G.ui.toast('没有急救包'); return; }
    if (this.hp >= this.maxHp) { G.ui.toast('无需包扎'); return; }
    this.healing = this.healDur;
    G.audio.pickup('paper');
  }
  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashFlicker = 0.12;
    G.audio.flashlight(this.flashlightOn);
  }

  hurt(amount, from, kind) {
    if (this.state === 'dead' || G.debugGod) return;
    this.hp = Math.max(0, this.hp - amount);
    this.stats.dmg += amount;
    this.hurtT = 0.4;
    this.dmgFlash = Math.min(1, this.dmgFlash + amount / 30);
    this.dmgCA = Math.min(1, this.dmgCA + amount / 25);
    // Kick the view away from the source.
    if (from) {
      const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
      const rel = angleTo(this.yaw, Math.atan2(-dx, -dz));
      this.punchY.kick(-Math.sin(rel) * amount * 0.6 * DEG * 30);
      this.punchR.kick(Math.sin(rel) * amount * 0.5 * DEG * 30);
      this.punchP.kick(amount * 0.5 * DEG * 30);
      G.ui.damageDir(rel);
    }
    this.addTrauma(clamp(amount / 45, 0.15, 0.8));
    G.audio.hurt(amount >= 25);
    if (amount >= 25) slowmo(0.1, 0.3);
    if (this.hp <= 0) this.die(kind);
  }
  die(kind) {
    this.state = 'dead'; this.deathT = 0; this.stats.deaths++;
    this.healing = 0;
    if (this.grab && this.grab.enemy) this.grab.enemy.grabEscaped('death');
    this.grab = null;
    G.audio.setMuffle(600, 0.8);
    G.director.onPlayerDeath(kind);
  }
  updateDeath(rdt) {
    this.deathT += rdt;
    const t = clamp01(this.deathT / 1.1);
    this.deathDrop = easeIn(t) * 1.3;
    this.deathRoll = easeIn(t) * 1.2;
  }
  respawn(pos, yaw) {
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0;
    this.state = 'normal'; this.grab = null; this.hp = this.maxHp; this.stamina = 100; this.exhausted = false;
    this.deathDrop = 0; this.deathRoll = 0; this.trauma = 0; this.healing = 0; this.grabImmune = 2;
    this.recoilP.reset(); this.recoilY.reset(); this.punchP.reset(); this.punchY.reset(); this.punchR.reset();
    G.audio.setMuffle(20000, 0.3);
  }

  // ------------------------------------------------------------------ interaction
  interact() {
    let best = null, bestScore = 0;
    const fwd = this.forward(_v2);
    for (const it of G.level.interactables) {
      if (it.done || !it.pos) continue;
      const d = this.eye.distanceTo(it.pos);
      if (d > (it.range || 2.1)) continue;
      _v3.subVectors(it.pos, this.eye).divideScalar(d);
      const dot = _v3.dot(fwd);
      if (dot < 0.8 && d > 0.9) continue;
      const score = dot / (0.5 + d);
      if (score > bestScore) { bestScore = score; best = it; }
    }
    this.focusItem = best;
    G.ui.prompt(best && this.state === 'normal' ? best.label : null);
    if (best && this.state === 'normal' && Input.hit('KeyE')) best.use();
  }

  // ------------------------------------------------------------------ camera
  updateCamera(rdt, dt = rdt) {
    const cam = this.camera, W = G.weapons;
    this.recoilP.update(rdt); this.recoilY.update(rdt);
    this.punchP.update(rdt); this.punchY.update(rdt); this.punchR.update(rdt); this.fovPunch.update(rdt); this.lunge.update(rdt);
    this.trauma = Math.max(0, this.trauma - rdt * 1.35);
    this.shakeT += rdt;
    const sh = this.trauma * this.trauma;
    const sp = sh * 0.05 * Noise1(this.shakeT * 22), sy = sh * 0.05 * Noise1(this.shakeT * 22 + 50), sr = sh * 0.07 * Noise1(this.shakeT * 18 + 100);
    // Aim direction (bullets): base look + recovering recoil.
    const ap = this.pitch + this.recoilP.x, ay = this.yaw + this.recoilY.x;
    this.aimDir.set(-Math.sin(ay) * Math.cos(ap), Math.sin(ap), -Math.cos(ay) * Math.cos(ap)).normalize();
    // Camera = aim + visual punch + shake + death roll.
    const bobY = -this.bobAmp * (1 - Math.cos(this.bobPhase * 2)) * 0.5;
    const bobX = this.bobAmp * 0.55 * Math.sin(this.bobPhase);
    const eyeH = MOVE.eye - (this.deathDrop || 0);
    cam.position.set(this.pos.x, eyeH + bobY + (W ? W.kickDip : 0), this.pos.z);
    cam.position.x += Math.cos(this.yaw) * bobX; cam.position.z += -Math.sin(this.yaw) * bobX;
    cam.position.x += -Math.sin(this.yaw) * this.lunge.x; cam.position.z += -Math.cos(this.yaw) * this.lunge.x;
    const hurtWobble = this.state === 'grabbed' ? Noise1(this.shakeT * 7) * 0.05 : 0;
    cam.rotation.set(ap + this.punchP.x + sp, ay + this.punchY.x + sy, this.punchR.x + sr + (this.deathRoll || 0) + hurtWobble + bobX * 0.35, 'YXZ');
    // FOV.
    const baseFov = TUNE.fov;
    const adsFov = W ? W.def.adsFov : baseFov;
    let fov = lerp(baseFov, adsFov * baseFov / 74, W ? easeInOut(W.ads) : 0) + this.sprintBlend * 5 + this.fovPunch.x;
    if (this.state === 'grabbed') fov -= 10;
    this.fovCur = damp(this.fovCur || fov, fov, 25, rdt);
    if (Math.abs(cam.fov - this.fovCur) > 0.01) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // Flashlight trails the view slightly: a held light, not a camera-attached one.
    const L = this.flashlight;
    const fwd = this.forward(_v1);
    const lagRate = 16;
    this.flashDir.x = damp(this.flashDir.x, fwd.x, lagRate, rdt); this.flashDir.y = damp(this.flashDir.y, fwd.y, lagRate, rdt); this.flashDir.z = damp(this.flashDir.z, fwd.z, lagRate, rdt);
    this.flashDir.normalize();
    _v2.set(0.2, -0.16, -0.05).applyQuaternion(cam.quaternion);
    L.position.copy(cam.position).add(_v2);
    L.target.position.copy(L.position).addScaledVector(this.flashDir, 10);
    L.target.updateMatrixWorld();
    // Flicker when toggled or when something wrong is near.
    this.flashFlicker = Math.max(0, this.flashFlicker - rdt);
    let fl = this.flashlightOn ? 1 : 0;
    if (this.flashFlicker > 0) fl *= chance(0.5) ? 0.2 : 1;
    if (this.flashInterfere > 0) { fl *= Noise1(this.shakeT * 30) > 0.1 ? 0.15 : 1; this.flashInterfere -= rdt; }
    L.intensity = this.flashBase * fl * TUNE.brightness;
    // Damage screen fx decay.
    this.dmgFlash = Math.max(0, this.dmgFlash - rdt * 1.6);
    this.dmgCA = Math.max(0, this.dmgCA - rdt * 2.2);
  }
}
