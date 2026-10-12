'use strict';
// Director: encounter scripting, pickups and notes, the arena (clock, broadcast event, foreman),
// adaptive supply, checkpoints, stats and rank.

const NOTES = {
  rules: {
    title: '夜班守则', meta: '星火机械厂 三号车间 · 一九八三年十一月修订',
    body: '<ol>' + RULES.map((r) => `<li>${r}</li>`).join('') + '</ol><p style="text-align:right;margin-top:1.2em">厂保卫科　三车间工段</p>',
  },
  log: {
    title: '保卫科值班记录', meta: '一九八三年十一月',
    body: `<p>十一月六日　夜　无异常。</p>
<p>十一月七日　零时　车间广播响了，放的不是厂歌。</p>
<p>老周说是“巡夜的”来了，叫我们把灯全关掉，别动，别开枪，更不能跑。</p>
<p>我蹲在料架后面，数到一百四十下，歌才换回来。</p>
<p>小刘没蹲下。他的手电一直亮着。</p>
<p>十一月八日　零时　小刘回来上班了。他的脸很干净，很白。</p>`,
  },
  agent: {
    title: '外勤记录纸', meta: '第三处 · 字迹潦草，纸被水泡过',
    body: `<ol>
<li>它们倒下不算数，脸碎了才算。别省那一颗子弹。没子弹就低头踩。</li>
<li>站定再瞄。准星收拢成一点的时候打头，一枪就碎。</li>
<li>被抓住了，枪里有子弹就直接开枪；没有就踢，一直踢。</li>
<li>它们扑过来之前会停住、不再哼歌。那一下踢过去，能把它们踢翻。</li>
</ol>`,
  },
  card: {
    title: '考勤卡', meta: '工号 0417　姓名 ████',
    body: `<p>上班　00:00　　下班　——</p>
<p>上班　00:00　　下班　——</p>
<p>上班　00:00　　下班　——</p>
<p class="hand">（背面，铅笔）钟面挡子弹。它只在报时的时候睁眼。报时的时候，钟面会打开。</p>
<p class="hand">它睁眼的时候，工友们走得更快。</p>`,
  },
};

class Director {
  constructor() {
    this.pickups = []; this.triggers = []; this.timers = [];
    this.cp = 0; this.snapshot = null;
    this.hints = new Set();
    this.bc = null; this.phase = 'explore';
    this.startTime = 0; this.endTime = 0;
    this.pickupMats = {
      box: new THREE.MeshStandardMaterial({ color: 0x8b6a43, roughness: 0.85 }),
      green: new THREE.MeshStandardMaterial({ color: 0x5d6b48, roughness: 0.8 }),
      white: new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7 }),
      paper: new THREE.MeshStandardMaterial({ map: TEX.logSheet, roughness: 0.9 }),
      card: new THREE.MeshStandardMaterial({ map: TEX.punchCard, roughness: 0.9 }),
      agent: new THREE.MeshStandardMaterial({ map: TEX.logSheet, color: 0xc8c0a8, roughness: 0.95 }),
    };
    this.glintMat = new THREE.SpriteMaterial({ map: TEX.softDot, color: 0xffe2a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  // ------------------------------------------------------------------ lifecycle
  begin() {
    this.startTime = G.time;
    G.ui.objective('阅读守则，前往三号车间');
    this.later(1.5, () => G.ui.toast('墙上贴着守则，走近按 E 阅读'));
  }
  setupAll() {
    this.setupLocker(); this.setupCorridor(); this.setupVestibule(); this.setupArena();
  }
  later(t, fn) { this.timers.push({ t, fn }); }
  update(dt) {
    const P = G.player;
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0); this.timers = this.timers.filter((tm) => tm.t > 0);
    due.forEach((tm) => tm.fn());
    G.level.computeFlow(P.pos.x, P.pos.z);
    for (const tr of this.triggers) {
      if (tr.done) continue;
      if (P.pos.x > tr.x0 && P.pos.x < tr.x1 && P.pos.z > tr.z0 && P.pos.z < tr.z1 && (!tr.cond || tr.cond())) { tr.done = true; tr.fn(); }
    }
    // Glints pulse.
    for (const pk of this.pickups) if (pk.glint) { const k = (Math.sin(G.time * 2.2 + pk.phase) + 1) / 2; pk.glint.material.opacity = Math.pow(k, 6) * 0.9; pk.glint.scale.setScalar(0.05 + Math.pow(k, 6) * 0.07); }
    if (this.phase === 'arena' || this.phase === 'broadcast') this.updateArena(dt);
    if (this.bc) this.updateBroadcast(dt);
    this.hintChecks();
    if (this.deathT > 0) { this.deathT -= G.rdt; if (this.deathT <= 0) G.ui.showDeath(this.deathKind); }
  }
  hintChecks() {
    const W = G.weapons, P = G.player;
    if (W.ads > 0.95 && !this.hints.has('ads')) { this.hints.add('ads'); G.ui.toast('站定瞄准，准星会收拢；收拢成一点时打头，一枪击碎面部', 5.5); }
    if (P.state === 'grabbed' && !this.hints.has('grab')) { this.hints.add('grab'); }
    if (W.roundsInGun() <= 2 && P.inv.pistol > 0 && W.current === 'pistol' && !this.hints.has('reload')) { this.hints.add('reload'); G.ui.toast('按 R 装填。弹匣里还有子弹时装填更快'); }
  }

  // ------------------------------------------------------------------ pickups and notes
  addPickup(kind, x, y, z, o = {}) {
    const g = new THREE.Group(), M = this.pickupMats;
    const top = (tex, w, h, yy) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); m.rotation.x = -Math.PI / 2; m.position.y = yy; g.add(m); };
    let label = '', range = 1.9;
    if (kind === 'ammo') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.1), M.box); b.position.y = 0.035; g.add(b); top(TEX.lblAmmo, 0.15, 0.075, 0.0705); label = `拾取 7.62毫米手枪弹 ×${o.n}`; }
    else if (kind === 'shells') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.09), M.green); b.position.y = 0.035; g.add(b); top(TEX.lblShell, 0.13, 0.065, 0.0705); label = `拾取 12号霰弹 ×${o.n}`; }
    else if (kind === 'aid') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.14), M.white); b.position.y = 0.045; g.add(b); top(TEX.lblAid, 0.18, 0.09, 0.0905); label = '拾取 急救包'; }
    else if (kind === 'shotgun') { this.shotgunModel(g); label = '拿起 五连发猎枪'; range = 2.2; }
    else if (kind === 'note') { const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w || 0.21, o.h || 0.28), o.mat || M.paper); m.rotation.x = -Math.PI / 2; m.rotation.z = rand(-0.3, 0.3); m.position.y = 0.003; g.add(m); label = `阅读 ${NOTES[o.note].title}`; }
    g.position.set(x, y, z); g.rotation.y = o.ry ?? rand(0, TAU);
    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    G.scene.add(g);
    const pk = { kind, mesh: g, pos: new V3(x, y + 0.05, z), label, range, done: false, zone: o.zone, phase: rand(0, TAU), o };
    if (kind !== 'note' && kind !== 'wallnote') { pk.glint = new THREE.Sprite(this.glintMat.clone()); pk.glint.position.set(x, y + 0.12, z); G.scene.add(pk.glint); }
    pk.use = () => this.usePickup(pk);
    this.pickups.push(pk); G.level.interactables.push(pk);
    return pk;
  }
  addWallNote(note, x, y, z, zone) {
    const pk = { kind: 'wallnote', pos: new V3(x, y, z), label: `阅读 ${NOTES[note].title}`, range: 2.2, done: false, zone, keep: true };
    pk.use = () => G.ui.showNote(NOTES[note]);
    this.pickups.push(pk); G.level.interactables.push(pk);
    return pk;
  }
  shotgunModel(g) {
    const W = G.weapons, M = W.mats();
    const s = new THREE.Group(); g.add(s);
    W.box(s, M.metal, 0.036, 0.056, 0.2, 0, 0, -0.02);
    W.cyl(s, M.metal, 0.0115, 0.0115, 0.52, 0, 0.018, -0.38); W.cyl(s, M.metal, 0.0105, 0.0105, 0.42, 0, -0.008, -0.33);
    W.cyl(s, M.wood, 0.021, 0.023, 0.17, 0, -0.012, -0.27);
    W.box(s, M.wood, 0.032, 0.075, 0.1, 0, -0.045, 0.115, -0.5); W.box(s, M.wood, 0.036, 0.1, 0.26, 0, -0.075, 0.27, -0.12);
    s.rotation.set(-0.18, 0, Math.PI / 2 + 0.1);
  }
  usePickup(pk) {
    const P = G.player, W = G.weapons;
    if (pk.kind === 'note') { G.ui.showNote(NOTES[pk.o.note]); return; }
    pk.done = true;
    G.scene.remove(pk.mesh); if (pk.glint) G.scene.remove(pk.glint);
    G.level.interactables = G.level.interactables.filter((i) => i !== pk);
    switch (pk.kind) {
      case 'ammo': P.inv.pistol += pk.o.n; G.audio.pickup('ammo'); G.ui.toast(`手枪弹 +${pk.o.n}`); break;
      case 'shells': P.inv.shells += pk.o.n; G.audio.pickup('ammo'); G.ui.toast(`霰弹 +${pk.o.n}`); break;
      case 'aid':
        if (P.inv.aid >= 3) { pk.done = false; G.scene.add(pk.mesh); if (pk.glint) G.scene.add(pk.glint); G.level.interactables.push(pk); G.ui.toast('急救包已满（3）'); return; }
        P.inv.aid++; G.audio.pickup('paper'); G.ui.toast('急救包 +1　按 Q 包扎'); break;
      case 'shotgun':
        P.inv.hasShotgun = true; P.inv.shells += 4; W.ammo.shotgun.n = 3; W.ammo.shotgun.ready = true;
        G.audio.pickup('weapon'); G.ui.toast('获得 五连发猎枪　按 2 切换', 4);
        W.cancelReload(); W.startAction('unequip', W.def.unequip, { next: 'shotgun' });
        if (pk.o.onTake) pk.o.onTake();
        break;
    }
    G.ui.ammoDirty();
  }
  clearZone(zone) {
    for (const pk of this.pickups) if (pk.zone === zone || zone === '*') { if (pk.mesh) G.scene.remove(pk.mesh); if (pk.glint) G.scene.remove(pk.glint); pk.done = true; }
    this.pickups = this.pickups.filter((pk) => !pk.done);
    G.level.interactables = G.level.interactables.filter((i) => !i.done);
  }
  trigger(x0, z0, x1, z1, fn, cond, zone) { this.triggers.push({ x0, z0, x1, z1, fn, cond, zone, done: false }); }

  // ------------------------------------------------------------------ zones
  addEnemy(o) { const h = new Hollow(o); G.enemies.push(h); return h; }
  setupLocker() {
    this.addPickup('ammo', 2.5, 0.785, 10.35, { n: 8, zone: 'A', ry: 0.3 });
    this.addWallNote('rules', 1.1, 1.55, 8.9, 'A');
    const h = this.addEnemy({ x: 7.55, z: 2.15, heading: Math.PI, work: 'locker', reviveOnce: true, zone: 'A' });
    this.lockerEnemy = h;
    this.trigger(11.4, 6.5, 13, 10, () => { G.ui.objective('穿过走廊，前往三号车间'); }, null, 'B');
  }
  setupCorridor() {
    this.addEnemy({ x: 42.4, z: 7.7, heading: Math.PI / 2, work: 'face', zone: 'B' });
    this.addEnemy({ x: 43.5, z: 8.8, heading: Math.PI / 2 + 0.3, work: 'face', zone: 'B' });
    const wash = this.washEnemy = this.addEnemy({ x: 33.7, z: 13.2, heading: Math.PI / 2, work: 'sink', zone: 'B' });
    const guard = this.guard = this.addEnemy({ x: 18.6, z: 3.6, heading: 0.4, type: 'guard', state: 'resting', canRevive: false, zone: 'B' });
    this.addPickup('ammo', 37.35, 1.085, 8.9, { n: 6, zone: 'B' });
    this.addPickup('shotgun', 23.6, 1.34, 1.2, { zone: 'B', ry: 0, onTake: () => this.later(1.3, () => { if (guard.resting && guard.alive) { guard.reviveOnce = true; guard.restT = 0; G.audio.creak(guard.headPos, 0.9); } }) });
    this.addPickup('shells', 21.3, 0.79, 3.1, { n: 6, zone: 'B' });
    this.addPickup('note', 22.0, 0.79, 2.75, { note: 'log', zone: 'B', mat: this.pickupMats.paper });
    this.addPickup('aid', 28.6, 0.9, 15.2, { zone: 'B' });
    this.addPickup('ammo', 28.6, 0.9, 16.0, { n: 8, zone: 'B' });
    this.addPickup('note', 34.35, 0.83, 12.1, { note: 'agent', zone: 'B', mat: this.pickupMats.agent });
    // The washroom door bursts open as the player passes.
    this.trigger(28.2, 7, 32, 10, () => {
      if (!wash.alive || wash.resting) return;
      const d = G.level.doors.washDoor; d.target = 1; d.burst = true; d.vel = 9;
      G.audio.doorBang(new V3(30.5, 1.2, 10.5)); G.fx.dust(new V3(30.5, 1.0, 9.8), 1.5, 1);
      G.player.addTrauma(0.25);
      wash.pos.set(30.5, 0, 11.4); wash.heading = Math.PI; wash.alert(true);
    }, null, 'B');
    this.faucet = this.faucet || G.audio.faucet(new V3(34.6, 1.0, 13.0));
    if (!this.buzz) { this.buzz = []; for (const l of G.level.lamps) if (l.kind === 'tube' && l.base > 0) { const b = G.audio.tubeBuzz(l.pos); if (b) { b.update = () => b.set(0.012 * l.f); this.buzz.push(b); } } }
  }
  setupVestibule() {
    this.addPickup('ammo', 42.25, 0.785, 12.15, { n: 12, zone: 'V' });
    this.addPickup('shells', 42.55, 0.785, 12.8, { n: 4, zone: 'V' });
    this.addPickup('aid', 42.4, 0.785, 13.1, { zone: 'V' });
    this.addPickup('note', 42.5, 0.786, 11.95, { note: 'card', zone: 'V', w: 0.18, h: 0.09, mat: this.pickupMats.card });
    this.trigger(39, 11.2, 44, 16.6, () => {
      this.cp = 1;
      G.ui.objective('进入三号车间');
      G.ui.toast('检查点', 2.5);
      G.audio.setSong('normal');
    }, null, 'V');
  }
  setupArena() {
    const W = (x, z, heading, work) => this.addEnemy({ x, z, heading, work, zone: 'workshop', reviveChance: 0.55 });
    W(29.2, 22.25, Math.PI, 'lathe'); W(47.0, 22.25, Math.PI, 'lathe'); W(53.0, 28.35, Math.PI, 'lathe'); W(26.95, 34.6, -Math.PI / 2, 'hammer');
    this.addPickup('ammo', 32.55, 0.02, 29.6, { n: 8, zone: 'workshop' });
    this.addPickup('shells', 49.45, 0.02, 29.6, { n: 5, zone: 'workshop' });
    this.addPickup('aid', 26.7, 0.88, 21.8, { zone: 'workshop' });
    this.addPickup('ammo', 55.25, 0.96, 32.6, { n: 8, zone: 'workshop' });
    this.addPickup('shells', 38.6, 0.92, 34.4, { n: 4, zone: 'workshop' });
    this.trigger(37, 19.4, 45, 21, () => this.startArena(), null, 'workshop');
  }

  // ------------------------------------------------------------------ arena
  startArena() {
    const L = G.level, P = G.player;
    this.phase = 'arena';
    this.snapshot = { inv: { ...P.inv }, ammo: JSON.parse(JSON.stringify(G.weapons.ammo)), weapon: G.weapons.current, hp: P.hp };
    L.bigDoor.target = 0; L.bigDoor.onDone = () => { G.audio.metalSlam(new V3(41.5, 1.5, 18.2)); P.addTrauma(0.3); L.kickSwing(0.5); };
    G.audio.rumble(new V3(41.5, 1.5, 18.2), 1.2);
    L.setGroupLights('ws', { override: 0 }); this.later(0.25, () => L.setGroupLights('ws', { override: null }));
    this.later(1.4, () => { G.audio.paChime(); G.ui.subtitle('广播', '三号车间全体同志请注意：夜班开始。请各就各位。', 4.5); });
    this.later(5.5, () => G.ui.objective('摧毁考勤钟　报时的时候，钟面会打开'));
    G.clock.activate();
    this.spawnCd = 12;
  }
  arenaAlive() { return G.enemies.filter((e) => e.zone === 'workshop' && e.alive && !e.resting && e.state !== 'dying' && e.state !== 'gone'); }
  updateArena(dt) {
    if (this.phase !== 'arena') return;
    const C = G.clock;
    this.spawnCd -= dt;
    const alive = this.arenaAlive().length;
    if (this.spawnCd <= 0 && alive < 2 && C.timer > 7) { this.spawnCd = rand(9, 13); const p = this.hiddenPoint(); if (p) this.spawnHollow(p.x, p.z); }
  }
  onChime(n) {
    const C = G.clock;
    if (n === 1) G.ui.subtitle('广播', '考勤钟报时。请按时打卡。', 3.5);
    if (n === 6) { G.ui.subtitle('广播', '考勤钟敲响六下。夜班延长。', 4); C.period = 20; C.overtime = true; G.level.setGroupLights('ws', { override: 0.2 }); this.later(0.6, () => G.level.setGroupLights('ws', { override: null })); }
    // Everyone still at a station looks up when it chimes.
    for (const e of G.enemies) if (e.zone === 'workshop' && e.state === 'idle') this.later(rand(0.3, 1.5), () => e.alert(true));
    const per = C.segment === 0 ? 2 : C.segment === 1 ? 3 : 2;
    const cap = C.segment === 2 ? 6 : 7;
    let count = Math.min(per + (C.overtime ? 2 : 0), cap - this.arenaAlive().length);
    const pts = [[38.3, 38.4], [43.7, 38.4], [36.8, 37.6], [45.2, 37.6]];
    for (let i = 0; i < count; i++) {
      const [x, z] = pts[i % pts.length];
      this.later(0.9 + i * 0.85, () => this.spawnHollow(x + rand(-0.3, 0.3), z, { punch: true }));
    }
  }
  spawnHollow(x, z, o = {}) {
    const P = G.player;
    const h = this.addEnemy({ x, z, heading: Math.atan2(P.pos.x - x, P.pos.z - z), state: 'spawn', zone: 'workshop', reviveChance: 0.5, type: o.type });
    h.aware = true;
    G.fx.staticPuff(new V3(x, 1.2, z), 26);
    if (o.punch) G.audio.punchCard(new V3(x, 1.5, z)); else G.audio.glitch(new V3(x, 1.2, z));
    return h;
  }
  hiddenPoint() {
    const P = G.player, cand = [[27.3, 19.3], [54.6, 19.4], [54.6, 38.5], [27.3, 38.4], [36.2, 38.6], [46.0, 38.6]];
    if (G.level.doors.storeDoor.angle > 0.5) cand.push([24.0, 28.5]);
    let best = null, bestS = -1;
    for (const [x, z] of cand) {
      const d = Math.hypot(P.pos.x - x, P.pos.z - z); if (d < 8) continue;
      _v3.set(x, 1.6, z);
      const seen = G.level.los(P.camera.position, _v3) && _v1.subVectors(_v3, P.camera.position).normalize().dot(P.forward(_v2)) > 0.6;
      const s = d * (seen ? 0.3 : 1) + rand(0, 4);
      if (s > bestS) { bestS = s; best = { x, z }; }
    }
    return best;
  }
  farPoint(min) {
    const P = G.player;
    for (let i = 0; i < 40; i++) {
      const x = rand(27, 55), z = rand(19, 38.5);
      if (!G.level.isWalkable(x, z)) continue;
      if (Math.hypot(P.pos.x - x, P.pos.z - z) < min) continue;
      return { x, z };
    }
    return { x: 54, z: 38 };
  }
  onClockSegment(n) {
    const C = G.clock;
    if (n === 1) { this.later(2.2, () => this.startBroadcast()); }
    if (n === 2) {
      C.period = 24;
      this.later(3, () => {
        G.ui.subtitle('广播', '车间主任到岗检查。', 3.5);
        const d = G.level.doors.storeDoor; d.target = 1; d.burst = true; d.vel = 10;
        G.audio.doorBang(new V3(25.5, 1.2, 28.5)); G.fx.dust(new V3(26, 1, 28.5), 2, 1.2); G.player.addTrauma(0.2);
        const f = this.spawnHollow(24.2, 28.5, { type: 'foreman' }); f.aware = true;
        G.ui.toast('侧身躲开冲撞，让它撞上机床或墙', 5);
      });
    }
  }
  // Rule two, made playable.
  startBroadcast() {
    const L = G.level;
    this.phase = 'broadcast';
    this.bc = { t: 0, dur: 28, grace: 3.2, lightV: false, shotV: false, runV: false };
    G.clock.paused = true;
    G.audio.staticBurst(1.5, 0.45); G.audio.setSong('wrong');
    L.setGroupLights('ws', { tint: 0xff2d1a, dim: 0.4 });
    G.ui.subtitle('广播', '同志们……请……关……灯……', 4);
    G.ui.objective('守则第二条：关闭照明，停止作业，不要奔跑');
    this.later(1.2, () => { if (G.player.flashlightOn) G.ui.toast('按 F 关闭手电', 3); });
    // Workers stop and listen to the broadcast.
    for (const e of G.enemies) if ((e.zone === 'workshop' || L.roomAt(e.pos.x, e.pos.z) === ROOMS[5]) && e.alive && !e.resting && !e.isLow && e.state !== 'grab' && e.type !== 'foreman') { e.setState('listen', 0.6); }
  }
  updateBroadcast(dt) {
    const b = this.bc, P = G.player;
    b.t += dt;
    if (b.t > b.grace && !G.watchman) { const p = this.farPoint(14); G.watchman = new Watchman(p.x, p.z); }
    if (b.t > b.grace) {
      if (P.flashlightOn && !b.lightV) { b.lightV = true; P.stats.violations++; }
      if (P.sprinting && P.speed > 3 && !b.runV) { b.runV = true; P.stats.violations++; }
    }
    if (b.t >= b.dur) this.endBroadcast();
  }
  onShot() { if (this.bc && this.bc.t > this.bc.grace && !this.bc.shotV) { this.bc.shotV = true; G.player.stats.violations++; } }
  onWatchmanAlert() { G.post && (G.post.glitch = Math.max(G.post.glitch, 0.6)); }
  endBroadcast() {
    const L = G.level;
    this.bc = null; this.phase = 'arena';
    G.audio.staticBurst(1, 0.4); G.audio.setSong('normal');
    L.setGroupLights('ws', { tint: null, dim: 1 });
    if (G.watchman) { G.watchman.vanish(); const w = G.watchman; this.later(1, () => { w.dispose(); if (G.watchman === w) G.watchman = null; }); }
    G.clock.paused = false; G.clock.timer = 9;
    G.ui.subtitle('广播', '厂歌恢复。请继续作业。', 3.5);
    G.ui.objective('摧毁考勤钟　报时的时候，钟面会打开');
    for (const e of G.enemies) if (e.state === 'listen') { e.aware = true; e.setState('chase', 0.4); }
  }
  onClockDestroyed() {
    const L = G.level;
    this.phase = 'end'; this.endTime = G.time;
    if (this.bc) { this.bc = null; }
    if (G.watchman) { G.watchman.vanish(); }
    G.audio.setSong('off');
    for (const e of G.enemies) if (e.zone === 'workshop' || e.alive) e.release && e.release();
    L.setGroupLights('ws', { override: 0 });
    this.later(1.8, () => { L.setGroupLights('ws', { override: null, tint: 0xfff0d8, dim: 1.25 }); for (const l of L.lamps) if (l.room === 'workshop') l.flicker = 'none'; });
    this.later(3.2, () => { G.audio.paChime(); G.ui.subtitle('广播', '……下班了。', 4); });
    this.later(4.5, () => { L.bigDoor.target = 1; G.audio.rumble(new V3(41.5, 1.5, 18.2), 1.5); });
    this.later(8, () => G.ui.showResults(this.results()));
    G.ui.objective('下班');
  }
  // ------------------------------------------------------------------ kills and supply
  onEnemyDown(e) {
    if (!this.hints.has('down')) { this.hints.add('down'); this.later(1.2, () => G.ui.toast('它只是倒下了。击碎面部才算确认：射击头部，或走近、低头按 V 踩踏', 6)); }
  }
  onEnemyKilled(e) {
    // Adaptive supply: a dry player finds rounds on the bodies.
    if (!TUNE.fx.dynamicSupply) return;
    const P = G.player, W = G.weapons;
    const total = P.inv.pistol + W.ammo.pistol.mag + W.ammo.pistol.chamber + (P.inv.shells + W.ammo.shotgun.n) * 2;
    if (total < 10 && chance(0.6)) this.later(0.9, () => this.addPickup('ammo', e.pos.x + rand(-0.3, 0.3), 0.02, e.pos.z + rand(-0.3, 0.3), { n: 6, zone: e.zone }));
    else if (P.hp < 40 && P.inv.aid === 0 && chance(0.3)) this.later(0.9, () => this.addPickup('aid', e.pos.x + rand(-0.3, 0.3), 0.02, e.pos.z + rand(-0.3, 0.3), { zone: e.zone }));
  }

  // ------------------------------------------------------------------ death and checkpoints
  onPlayerDeath(kind) { this.deathKind = kind; this.deathT = 2.4; }
  respawn() {
    const P = G.player, W = G.weapons, L = G.level;
    this.timers = [];
    if (G.watchman) { G.watchman.dispose(); G.watchman = null; }
    this.bc = null;
    G.audio.setSong(this.cp >= 1 ? 'normal' : 'off');
    L.setGroupLights('ws', { tint: null, dim: 1, override: null });
    Tokens.clear();
    if (this.cp === 0) {
      for (const e of G.enemies) e.dispose(); G.enemies = [];
      this.clearZone('*'); this.triggers = [];
      for (const id in L.doors) { const d = L.doors[id]; d.angle = d.target = (id === 'washDoor' || id === 'storeDoor') ? 0 : 0.92; d.vel = 0; d.apply(); L.refreshNavCell(d.collider); }
      L.bigDoor.target = 1; L.bigDoor.open = 0.999;
      G.clock.reset(); this.phase = 'explore';
      P.inv = { pistol: 16, shells: 0, aid: 0, hasShotgun: false };
      W.ammo = { pistol: { mag: 7, chamber: 1 }, shotgun: { n: 0, ready: false } };
      W.action = null; W.setWeapon('pistol', true);
      P.respawn(new V3(3.4, 0, 9.4), Math.PI / 2 - 0.35);
      this.setupAll();
      G.ui.objective('阅读守则，前往三号车间');
    } else {
      for (const e of G.enemies.filter((q) => q.zone === 'workshop')) e.dispose();
      G.enemies = G.enemies.filter((q) => q.zone !== 'workshop');
      this.clearZone('workshop'); this.triggers = this.triggers.filter((t) => t.zone !== 'workshop');
      const sd = L.doors.storeDoor; sd.angle = sd.target = 0; sd.vel = 0; sd.apply(); L.refreshNavCell(sd.collider);
      L.bigDoor.target = 1; L.bigDoor.open = 0.999;
      G.clock.reset(); this.phase = 'explore';
      const s = this.snapshot;
      if (s) {
        P.inv = { ...s.inv }; W.ammo = JSON.parse(JSON.stringify(s.ammo)); W.action = null; W.setWeapon(s.weapon, true);
        if (P.inv.pistol + W.ammo.pistol.mag < 12) P.inv.pistol += 8;
      }
      P.respawn(new V3(41.2, 0, 14.6), Math.PI);
      this.setupArena();
      G.ui.objective('摧毁考勤钟　报时的时候，钟面会打开');
    }
    G.fx.clearDebris();
    G.ui.ammoDirty();
  }

  // ------------------------------------------------------------------ results
  results() {
    const s = G.player.stats, t = (this.endTime || G.time) - this.startTime;
    const acc = s.shots ? s.hits / s.shots : 0, hs = s.hits ? s.heads / s.hits : 0;
    let score = 100 - s.deaths * 15 - s.violations * 8 + (acc - 0.5) * 40 + hs * 25 - s.dmg / 12 + (t < 480 ? 10 : t > 900 ? -10 : 0);
    const rank = score >= 112 ? '先进工作者' : score >= 92 ? '生产标兵' : score >= 72 ? '合格' : '留厂察看';
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    return {
      rank,
      text: `夜班于 ${mm} 分 ${ss} 秒后结束。考勤钟一共敲了 ${G.clock.chimes} 次，` + (G.clock.overtime ? '夜班被延长过。' : '没有敲到第六下。') + (s.violations ? '' : '你没有违反守则。'),
      rows: [
        ['用时', `${mm}:${String(ss).padStart(2, '0')}`], ['命中率', `${Math.round(acc * 100)}%`], ['爆头占命中', `${Math.round(hs * 100)}%`],
        ['确认击杀（面部击碎）', s.kills], ['其中补刀确认', s.confirms], ['踩踏', s.stomps], ['被抓 / 挣脱', `${s.grabs} / ${s.escapes}`],
        ['承受伤害', Math.round(s.dmg)], ['包扎', s.heals], ['死亡', s.deaths], ['违反守则', s.violations],
      ],
    };
  }
}
