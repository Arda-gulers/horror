'use strict';
// Boot, main loop, post-processing drivers, debug hooks.

async function boot() {
  const canvas = document.getElementById('game');
  const fill = document.getElementById('loadFill');
  Input.init(canvas);
  G.renderer = new Renderer(canvas);
  G.post = G.renderer;
  G.scene = new THREE.Scene();
  G.scene.background = new THREE.Color(0x020303);
  G.scene.fog = new THREE.FogExp2(0x030404, 0.05);
  G.camera = new THREE.PerspectiveCamera(TUNE.fov, innerWidth / innerHeight, 0.05, 90);
  await generateTextures((p) => { fill.style.width = (50 + p * 35) + '%'; });
  // Dim environment for glossy surfaces (porcelain, gun metal, terrazzo).
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x050506);
  const pan = (c, x, y, z, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
  pan(0x3a3228, 0, 6, 0, 6); pan(0x14181c, 6, 1, 0, 5); pan(0x1a1612, -6, 1, 2, 5); pan(0x101010, 0, -6, 0, 8);
  const pmrem = new THREE.PMREMGenerator(G.renderer.r);
  G.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  G.scene.environmentIntensity = 0.6;
  G.scene.add(new THREE.HemisphereLight(0x1c2530, 0x0a0806, 0.45));
  G.level = new Level(G.scene);
  G.fx = new FX(G.scene);
  G.audio = new AudioEngine();
  G.player = new Player(G.scene, G.camera);
  G.weapons = new Weapons(G.player);
  G.weapons.scene.environment = G.scene.environment;
  G.clock = new TimeClock();
  G.director = new Director();
  G.ui = new UI();
  G.renderer.resize();
  G.director.setupAll();
  fill.style.width = '92%';
  // Warm up shader programs so the first fight does not stutter.
  G.player.updateCamera(0.016);
  G.weapons.updateViewmodel(0.016, 0.016);
  G.renderer.r.compile(G.scene, G.camera);
  G.renderer.r.compile(G.weapons.scene, G.weapons.camera);
  G.renderer.render(G.scene, G.camera, G.weapons.scene, G.weapons.camera);
  fill.style.width = '100%';
  document.getElementById('loading').hidden = true;
  document.getElementById('title').hidden = false;
  if (G.debug) G.start();
  last = performance.now();
  requestAnimationFrame(loop);
}

G.start = function () {
  G.audio.init();
  document.getElementById('title').hidden = true;
  document.getElementById('hud').hidden = false;
  G.started = true; G.paused = false;
  G.fadeIn = 1.6;
  G.director.begin();
  G.ui.ammoDirty();
  if (!G.debug) G.ui.lock();
};

let last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const rdt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  G.rdt = rdt; G.realTime += rdt; G.frame++;
  const P = G.player;
  if (G.started && !G.paused) {
    updateTimeScale(rdt);
    const dt = rdt * G.timeScale;
    G.dt = dt; G.time += dt;
    P.update(dt, rdt);
    G.weapons.update(dt, rdt);
    for (const e of G.enemies) e.update(dt);
    if (G.watchman) { G.watchman.update(dt); if (!G.watchman.active) { G.watchman.dispose(); G.watchman = null; } }
    G.clock.update(dt);
    G.director.update(dt);
    G.fx.update(dt, G.time);
    G.level.update(dt, G.time, P.camera.position);
    const room = G.level.roomAt(P.pos.x, P.pos.z);
    G.audio.update(rdt, P.camera, room ? room.id : null);
    G.ui.update(rdt);
    G.noises = G.noises.filter((n) => G.time - n.t < 1);
  } else if (!G.started) {
    // Title: idle camera in the locker room.
    P.updateCamera(rdt);
    G.level.update(rdt, G.realTime, P.camera.position);
    G.fx.update(rdt, G.realTime);
  }
  updatePost(rdt);
  if (!G.skipRender) G.renderer.render(G.scene, G.camera, G.started && P.state !== 'dead' ? G.weapons.scene : null, G.weapons.camera);
  Input.endFrame();
}

function updatePost(rdt) {
  const u = G.renderer.u, P = G.player, R = G.renderer;
  u.uTime.value = G.realTime;
  const hpf = P.hp / P.maxHp;
  const low = hpf < 0.4 ? (0.4 - hpf) / 0.4 : 0;
  u.uDamage.value = Math.min(1, P.dmgFlash * 0.9 + low * (0.35 + 0.2 * Math.sin(G.realTime * 7)));
  u.uCA.value = P.dmgCA * 0.8 + (P.state === 'grabbed' ? 0.5 : 0);
  R.anomaly = damp(R.anomaly, G.director && G.director.bc ? 1 : 0, 2, rdt);
  u.uAnomaly.value = R.anomaly;
  const wd = G.watchman && G.watchman.active ? G.watchman.dist : 99;
  R.glitch = Math.max(0, R.glitch - rdt * 2.5);
  u.uGlitch.value = Math.min(1, R.glitch + (wd < 8 ? (1 - wd / 8) * 0.45 : 0));
  u.uGaze.value = damp(u.uGaze.value, G.clock && G.clock.gazing ? 1 : 0, 4, rdt);
  u.uDesat.value = low * 0.65 + R.anomaly * 0.15 + (P.state === 'dead' ? 0.6 : 0);
  u.uVignette.value = 0.42 + (G.weapons ? G.weapons.ads * 0.18 : 0) + (P.state === 'grabbed' ? 0.3 : 0);
  u.uExposure.value = 1.25;
  u.uFlash.value = G.fx ? G.fx.flash * 0.25 : 0;
  // Fades: into the level, and out on death.
  if (G.fadeIn > 0) G.fadeIn -= rdt;
  let fade = G.started ? clamp01(G.fadeIn / 1.6) : 0.35;
  if (P.state === 'dead') fade = Math.max(fade, clamp01((P.deathT - 0.6) / 1.6));
  u.uFade.value = fade;
}

// Debug hooks for testing from the console.
window.__g = {
  G, TUNE,
  tp(x, z, yaw) { G.player.pos.set(x, 0, z); if (yaw !== undefined) G.player.yaw = yaw; },
  god(on = true) { G.debugGod = on; },
  give() { const P = G.player; P.inv.pistol = 60; P.inv.shells = 20; P.inv.aid = 3; P.inv.hasShotgun = true; G.weapons.ammo.shotgun.n = 5; G.weapons.ammo.shotgun.ready = true; G.ui.ammoDirty(); },
  spawn(x, z, type) { return G.director.spawnHollow(x, z, { type }); },
  look(yaw, pitch) { G.player.yaw = yaw; G.player.pitch = pitch; },
  fire() { Input.lmbP = true; G.weapons.fireBuffer = 0.14; },
  arena() { __g.tp(41, 19.8, Math.PI); },
  seg() { G.clock.breakSegment(); },
  broadcast() { G.director.startBroadcast(); },
  // Advance the loop by hand (hidden tabs do not get animation frames).
  step(n = 30, dt = 1 / 60) {
    let t = Math.max(performance.now(), last);
    for (let i = 0; i < n; i++) { t += dt * 1000; G.skipRender = i < n - 1; loop(t); }
    G.skipRender = false;
    return G.frame;
  },
};

addEventListener('game-scripts-ready', () => boot().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  l.hidden = false; l.innerHTML = '<div style="max-width:560px;padding:0 20px;line-height:1.8">加载失败：' + String(e.message || e) + '</div>';
}));
