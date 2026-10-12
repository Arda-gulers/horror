'use strict';
// Weapons: definitions, firing and hit resolution, focus aiming, reload/pump/kick timelines, procedural viewmodel.

const WDEF = {
  pistol: {
    key: 'pistol', name: '54式手枪', cap: 8, dmg: 34, headMul: 2.5, limbMul: 0.7, pellets: 1,
    poise: 22, headPoise: 55, interval: 0.16,
    hipSpread: 3.0, adsSpreadMax: 1.6, adsSpreadMin: 0.12, focusTime: 0.8, focusBloom: 0.55,
    recoil: { pitch: [1.9, 2.7], yaw: 0.55, recover: 0.78, view: 2.2, roll: 1.4, fov: 1.0, trauma: 0.1 },
    kick: { z: 0.05, rx: 0.15, y: 0.01, rz: 0.05 },
    adsFov: 56, adsTime: 0.17, noise: 24, falloff: [25, 60, 0.75],
    reloadTac: 1.35, reloadEmpty: 1.8, equip: 0.34, unequip: 0.22,
    hip: [0.115, -0.118, -0.32], ads: [0, -0.056, -0.3], muzzle: [0, 0.034, -0.168], port: [0.02, 0.04, -0.03],
  },
  shotgun: {
    key: 'shotgun', name: '五连发猎枪', cap: 5, dmg: 15, headMul: 1.6, limbMul: 0.8, pellets: 9,
    poise: 9, headPoise: 16, interval: 0.16, pump: 0.5,
    hipSpread: 5.0, adsSpreadMax: 3.8, adsSpreadMin: 2.7, focusTime: 0.55, focusBloom: 1.0,
    recoil: { pitch: [5.2, 6.6], yaw: 1.3, recover: 0.7, view: 5.5, roll: 4, fov: 3.2, trauma: 0.3 },
    kick: { z: 0.1, rx: 0.26, y: 0.018, rz: 0.1 },
    adsFov: 63, adsTime: 0.22, noise: 34, falloff: [6, 20, 0.2],
    reloadStart: 0.3, reloadShell: 0.5, reloadEnd: 0.28, equip: 0.42, unequip: 0.28,
    knockPellets: 5, knockRange: 5.5,
    hip: [0.135, -0.15, -0.4], ads: [0, -0.036, -0.34], muzzle: [0, 0.02, -0.64], port: [0.022, 0.012, -0.03],
  },
};

// Keyframe track: rows of [t, v0, v1, ...] -> smooth interpolation.
function track(keys, t, out) {
  if (t <= keys[0][0]) { for (let i = 1; i < keys[0].length; i++) out[i - 1] = keys[0][i]; return out; }
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k], b = keys[k + 1];
    if (t <= b[0]) { const u = smooth((t - a[0]) / (b[0] - a[0])); for (let i = 1; i < a.length; i++) out[i - 1] = lerp(a[i], b[i], u); return out; }
  }
  const l = keys[keys.length - 1]; for (let i = 1; i < l.length; i++) out[i - 1] = l[i]; return out;
}
const ZERO6 = [0, 0, 0, 0, 0, 0];

// Gun offsets [px, py, pz, rx, ry, rz] and left hand position [x, y, z] (gun space) per action.
const ANIM = {
  pistolTac: {
    gun: [[0, 0, 0, 0, 0, 0, 0], [0.12, -0.02, 0.03, 0.02, 0.25, 0.15, 0.45], [0.45, -0.025, 0.035, 0.02, 0.3, 0.18, 0.5], [0.56, -0.02, 0.045, 0.015, 0.42, 0.18, 0.45], [0.66, -0.01, 0.03, 0.01, 0.28, 0.1, 0.3], [0.86, 0, 0.008, 0, 0.04, 0, 0.04], [1, 0, 0, 0, 0, 0, 0]],
    hand: [[0, -0.018, -0.055, -0.01], [0.12, -0.05, -0.3, 0.05], [0.3, -0.03, -0.32, 0.03], [0.45, -0.005, -0.15, 0.02], [0.56, 0, -0.085, 0.012], [0.66, -0.01, -0.07, 0], [0.86, -0.018, -0.055, -0.01], [1, -0.018, -0.055, -0.01]],
    magOut: 0.14, magShowNew: 0.3, magIn: 0.56,
  },
  pistolEmpty: {
    gun: [[0, 0, 0, 0, 0, 0, 0], [0.1, -0.02, 0.03, 0.02, 0.25, 0.15, 0.45], [0.34, -0.025, 0.035, 0.02, 0.3, 0.18, 0.5], [0.44, -0.02, 0.045, 0.015, 0.42, 0.18, 0.45], [0.55, -0.015, 0.03, 0.01, 0.15, 0.05, -0.2], [0.72, -0.01, 0.02, 0.01, 0.12, 0.02, -0.25], [0.8, -0.005, 0.03, 0.005, 0.2, 0, -0.1], [0.92, 0, 0.005, 0, 0.02, 0, 0], [1, 0, 0, 0, 0, 0, 0]],
    hand: [[0, -0.018, -0.055, -0.01], [0.1, -0.05, -0.3, 0.05], [0.24, -0.03, -0.32, 0.03], [0.34, -0.005, -0.15, 0.02], [0.44, 0, -0.085, 0.012], [0.55, -0.03, 0.02, 0.02], [0.66, -0.012, 0.055, 0.03], [0.74, -0.012, 0.055, 0.06], [0.8, -0.04, 0.06, 0.08], [0.92, -0.018, -0.055, -0.01], [1, -0.018, -0.055, -0.01]],
    magOut: 0.1, magShowNew: 0.24, magIn: 0.44, slideGrab: 0.66, slideRelease: 0.76,
  },
  shotgunStart: { gun: [[0, 0, 0, 0, 0, 0, 0], [1, -0.01, 0.035, 0.03, 0.14, 0.06, -0.38]] },
  shotgunShell: {
    gun: [[0, -0.01, 0.035, 0.03, 0.14, 0.06, -0.38], [0.7, -0.01, 0.037, 0.028, 0.16, 0.06, -0.4], [0.78, -0.01, 0.04, 0.02, 0.18, 0.06, -0.37], [1, -0.01, 0.035, 0.03, 0.14, 0.06, -0.38]],
    hand: [[0, 0.0, -0.05, -0.05], [0.3, 0.02, -0.26, 0.0], [0.55, 0.0, -0.08, -0.04], [0.7, 0.0, -0.04, -0.035], [0.8, 0.0, -0.05, -0.05], [1, 0.0, -0.05, -0.05]],
    insert: 0.72,
  },
  shotgunEnd: { gun: [[0, -0.01, 0.035, 0.03, 0.14, 0.06, -0.38], [1, 0, 0, 0, 0, 0, 0]] },
  pump: { gun: [[0, 0, 0, 0, 0, 0, 0], [0.35, 0.005, -0.01, 0.015, 0.05, -0.02, -0.05], [0.7, 0, -0.004, 0.005, 0.02, 0, 0], [1, 0, 0, 0, 0, 0, 0]], back: 0.36, fwd: 0.72 },
  kick: { gun: [[0, 0, 0, 0, 0, 0, 0], [0.15, 0.05, 0.07, 0.03, 0.5, -0.3, 0.3], [0.45, 0.05, 0.07, 0.03, 0.5, -0.3, 0.3], [1, 0, 0, 0, 0, 0, 0]], hit: 0.28 },
  equip: { gun: [[0, 0.02, -0.28, 0.06, -1.0, 0.3, 0.2], [0.75, 0, 0.01, 0, 0.04, 0, 0], [1, 0, 0, 0, 0, 0, 0]] },
  unequip: { gun: [[0, 0, 0, 0, 0, 0, 0], [1, 0.02, -0.3, 0.06, -1.0, 0.3, 0.2]] },
};

class Weapons {
  constructor(player) {
    this.player = player;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 10);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.ammo = { pistol: { mag: 7, chamber: 1 }, shotgun: { n: 0, ready: false } };
    this.current = 'pistol'; this.def = WDEF.pistol;
    this.ads = 0; this.focus = 0; this.focusFull = false;
    this.cool = 0; this.fireBuffer = 0; this.action = null; this.actionT = 0; this.actionDur = 1; this.adata = {};
    this.pendingPump = -1; this.autoReload = -1;
    this.kz = new Spring(9, 0.5); this.krx = new Spring(8, 0.42); this.krz = new Spring(7, 0.4); this.ky = new Spring(9, 0.5);
    this.swayX = new Spring(5, 0.6); this.swayY = new Spring(5, 0.6); this.swayR = new Spring(4.5, 0.55);
    this.jolt = new Spring(10, 0.45);
    this.flashT = 0; this.kickDip = 0; this.slideOff = 0; this.pumpOff = 0;
    this.spreadDeg = 3;
    this.buildLights();
    this.buildModels();
    this.setWeapon('pistol', true);
    this.shellPattern = [[0, 0]];
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; this.shellPattern.push([Math.cos(a) * 0.68, Math.sin(a) * 0.68]); }
  }

  // ------------------------------------------------------------------ models
  buildLights() {
    this.vmHemi = new THREE.HemisphereLight(0x6c6862, 0x1a1410, 0.25); this.scene.add(this.vmHemi);
    this.vmFill = new THREE.DirectionalLight(0xd8d4cc, 0.3); this.vmFill.position.set(-0.6, 0.8, 0.9); this.scene.add(this.vmFill);
    this.vmKey = new THREE.DirectionalLight(0xffd0a0, 0); this.vmKey.position.set(0.5, 1, 0.2); this.scene.add(this.vmKey);
    this.vmBounce = new THREE.PointLight(0xfff0dc, 0, 3, 2); this.vmBounce.position.set(0.05, 0.05, -0.9); this.scene.add(this.vmBounce);
    this.vmFlash = new THREE.PointLight(0xffa050, 0, 2.5, 2); this.scene.add(this.vmFlash);
    this.scene.environment = null;
  }
  mats() {
    if (this._mats) return this._mats;
    const S = (o) => new THREE.MeshStandardMaterial(o);
    this._mats = {
      metal: S({ map: TEX.gunMetal, color: 0xffffff, metalness: 0.55, roughness: 0.34 }),
      dark: S({ color: 0x060606, roughness: 0.6 }),
      grip: S({ map: TEX.bakelite, roughness: 0.55 }),
      wood: S({ map: TEX.wood, color: 0xb88a66, roughness: 0.45 }),
      glove: S({ map: TEX.glove, normalMap: TEX.gloveN, normalScale: new THREE.Vector2(0.35, 0.35), color: 0xffffff, roughness: 0.7 }),
      sleeve: S({ map: TEX.fabric, color: 0x8a8e96, roughness: 0.9 }),
      brass: S({ color: 0xb58d3c, metalness: 0.85, roughness: 0.3 }),
      shell: S({ color: 0xa3281f, roughness: 0.5 }),
      boot: S({ color: 0x1c1712, roughness: 0.55 }),
      trouser: S({ map: TEX.fabric, color: 0x2e3238, roughness: 0.92 }),
    };
    return this._mats;
  }
  box(parent, mat, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  }
  cyl(parent, mat, r1, r2, len, x, y, z, axis = 'z', seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); m.position.set(x, y, z);
    if (axis === 'z') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.z = Math.PI / 2;
    parent.add(m); return m;
  }
  cap(parent, mat, r, len, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  }
  // Bevelled extrusion of a 2D outline, centred on its depth. side = true lays the outline in the
  // (forward, up) plane and extrudes across the gun; otherwise the outline is a cross-section
  // extruded along the barrel. UVs are planar over the outline, or along the barrel for sections.
  ext(parent, mat, pts, depth, bevel, o = {}) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (o.hole) sh.holes.push(new THREE.Path(o.hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -depth / 2);
    geo.computeBoundingBox();
    const bb = geo.boundingBox, pos = geo.attributes.position, uv = geo.attributes.uv;
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    for (let i = 0; i < pos.count; i++) {
      const u = o.side ? (pos.getX(i) - bb.min.x) / sx : (pos.getZ(i) - bb.min.z) / sz;
      uv.setXY(i, u * (o.uvScale || 1), (pos.getY(i) - bb.min.y) / sy * (o.uvScale || 1));
    }
    const m = new THREE.Mesh(geo, mat);
    if (o.side) m.rotation.y = Math.PI / 2;
    m.position.set(o.x || 0, o.y || 0, o.z || 0);
    parent.add(m); return m;
  }
  // Gloved hand: palm plus four curled fingers and a thumb. grip = 0 open .. 1 closed.
  makeHand(side, grip = 1) {
    const M = this.mats(), h = new THREE.Group(), s = side === 'R' ? 1 : -1;
    this.ext(h, M.glove, [[-0.023, -0.029], [0.023, -0.03], [0.024, 0.03], [-0.022, 0.029]], 0.016, 0.0075, { side: true });
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Group(); f.position.set(-s * 0.006, 0.028 - i * 0.019, -0.03); h.add(f);
      this.cap(f, M.glove, 0.0085, 0.02, -s * 0.012, 0, -0.008, 0, 0, Math.PI / 2 * s * 0.0 + Math.PI / 2);
      const tip = new THREE.Group(); tip.position.set(-s * 0.026, 0, 0); f.add(tip);
      this.cap(tip, M.glove, 0.008, 0.014, -s * 0.004, 0, 0.012, Math.PI / 2 * 0.9, 0, 0);
      f.rotation.y = s * grip * 0.35;
    }
    const th = this.cap(h, M.glove, 0.009, 0.03, -s * 0.02, 0.028, -0.02, -0.6, s * 0.4, 0);
    h.userData.thumb = th;
    return h;
  }
  buildModels() {
    const M = this.mats();
    // ---- Pistol (origin at the top of the grip, muzzle toward -Z).
    const p = this.pistol = new THREE.Group();
    const slide = this.slide = new THREE.Group(); p.add(slide);
    // Slide: rounded-top section run along the barrel, rear serrations, sights, ejection port, bushing.
    const w = 0.0122, y0 = 0.0225, y1 = 0.0485, c = 0.0045;
    this.ext(slide, M.metal, [[-w, y0], [w, y0], [w, y1 - c], [w - c * 0.45, y1 - c * 0.3], [w - c, y1], [-w + c, y1], [-w + c * 0.45, y1 - c * 0.3], [-w, y1 - c]], 0.174, 0.0011, { z: -0.062 });
    for (let i = 0; i < 9; i++) this.box(slide, M.dark, 0.0272, 0.017, i % 2 ? 0.0008 : 0.0014, 0, 0.034, 0.006 + i * 0.0024);
    this.box(slide, M.metal, 0.003, 0.0055, 0.009, 0, 0.0515, -0.141);
    this.box(slide, M.metal, 0.014, 0.003, 0.006, 0, 0.0505, 0.019);
    this.box(slide, M.metal, 0.0045, 0.0045, 0.006, 0.0048, 0.0535, 0.019); this.box(slide, M.metal, 0.0045, 0.0045, 0.006, -0.0048, 0.0535, 0.019);
    this.box(slide, M.dark, 0.0015, 0.011, 0.024, 0.0131, 0.0355, -0.034);
    this.cyl(slide, M.metal, 0.0064, 0.0064, 0.003, 0, 0.034, -0.1505, 'z', 16);
    this.cyl(slide, M.dark, 0.0038, 0.0038, 0.004, 0, 0.034, -0.1515, 'z', 12);
    // Frame in side profile: dust cover, trigger guard (with its opening), tang.
    this.ext(p, M.metal, [[-0.027, 0.0225], [0.137, 0.0225], [0.139, 0.012], [0.135, 0.008], [0.08, 0.008], [0.077, -0.004], [0.072, -0.013], [0.064, -0.017], [0.03, -0.017], [0.022, -0.012], [0.006, -0.004], [-0.03, -0.004], [-0.034, 0.004], [-0.031, 0.016]], 0.021, 0.0008,
      { side: true, hole: [[0.070, 0.006], [0.071, -0.004], [0.067, -0.010], [0.060, -0.012], [0.032, -0.012], [0.026, -0.008], [0.024, 0.002], [0.026, 0.006]] });
    this.box(p, M.metal, 0.002, 0.004, 0.022, -0.0118, 0.018, -0.052);
    this.trigger = this.box(p, M.metal, 0.004, 0.016, 0.005, 0, -0.001, -0.037, 0.2);
    // Grip raked back, frame plus bakelite panels with the star.
    const gripG = new THREE.Group(); gripG.rotation.x = -0.2; p.add(gripG);
    this.ext(gripG, M.metal, [[-0.032, 0.004], [0.004, 0.004], [0.004, -0.094], [0, -0.1], [-0.028, -0.1], [-0.032, -0.096]], 0.0205, 0.0008, { side: true });
    this.ext(gripG, M.grip, [[-0.029, -0.004], [0.001, -0.004], [0.001, -0.086], [-0.003, -0.091], [-0.025, -0.091], [-0.029, -0.087]], 0.024, 0.0014, { side: true });
    this.pistolMag = this.box(gripG, M.metal, 0.021, 0.005, 0.037, 0, -0.1025, 0.014);
    this.cyl(gripG, M.metal, 0.005, 0.005, 0.004, 0, -0.1, 0.03, 'x', 10);
    this.hammer = new THREE.Group(); this.hammer.position.set(0, 0.03, 0.03); p.add(this.hammer);
    this.cyl(this.hammer, M.metal, 0.0062, 0.0062, 0.006, 0, 0.007, 0.004, 'x', 12);
    this.box(this.hammer, M.metal, 0.006, 0.01, 0.006, 0, 0.001, 0.001);
    // Hands on the pistol; the index finger rests along the frame.
    const hr = this.makeHand('R', 1); hr.position.set(0.017, -0.045, 0.024); hr.rotation.set(-0.2, -0.15, 0.05); p.add(hr);
    this.cap(p, M.glove, 0.0072, 0.03, 0.0128, 0.003, -0.044, Math.PI / 2, 0, 0);
    const hl = this.pistolLeft = this.makeHand('L', 1); hl.rotation.set(0.35, 0.5, -0.2); p.add(hl);
    this.pistolLeftBase = new V3(-0.018, -0.055, -0.01);
    hl.position.copy(this.pistolLeftBase);
    this.newMag = this.box(hl, M.metal, 0.022, 0.1, 0.034, 0.012, 0.03, -0.02); this.newMag.visible = false;
    this.pistolRight = hr;
    // ---- Shotgun (origin at the receiver, muzzle toward -Z).
    const s = this.shotgun = new THREE.Group();
    // Receiver in side profile with ejection and loading ports; trigger guard loop below.
    this.ext(s, M.metal, [[-0.084, 0.012], [-0.07, 0.03], [0.118, 0.03], [0.12, 0.024], [0.12, -0.026], [0.116, -0.028], [-0.012, -0.028], [-0.022, -0.033], [-0.07, -0.033], [-0.084, -0.02]], 0.032, 0.002, { side: true });
    this.box(s, M.dark, 0.0015, 0.016, 0.05, 0.0181, 0.012, -0.03);
    this.box(s, M.dark, 0.022, 0.002, 0.06, 0, -0.0305, -0.045);
    this.ext(s, M.metal, [[-0.012, -0.03], [-0.014, -0.05], [-0.022, -0.057], [-0.052, -0.057], [-0.06, -0.05], [-0.064, -0.03]], 0.009, 0.001,
      { side: true, hole: [[-0.019, -0.034], [-0.021, -0.048], [-0.026, -0.051], [-0.049, -0.051], [-0.054, -0.047], [-0.057, -0.034]] });
    this.box(s, M.metal, 0.004, 0.014, 0.004, 0, -0.04, 0.03, 0.2);
    this.cyl(s, M.metal, 0.0115, 0.0115, 0.52, 0, 0.018, -0.38);
    this.cyl(s, M.metal, 0.0105, 0.0105, 0.42, 0, -0.008, -0.33);
    this.cyl(s, M.metal, 0.0128, 0.0128, 0.03, 0, 0.018, -0.63);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 6), M.brass); bead.position.set(0, 0.0325, -0.628); s.add(bead);
    const pumpG = this.pump = new THREE.Group(); pumpG.position.set(0, -0.008, -0.27); s.add(pumpG);
    const fore = this.cyl(pumpG, M.wood, 0.021, 0.023, 0.17, 0, -0.004, 0, 'z', 14);
    for (let i = 0; i < 6; i++) this.cyl(pumpG, M.dark, 0.0232, 0.0232, 0.003, 0, -0.004, -0.06 + i * 0.024, 'z', 14);
    const stock = new THREE.Group(); s.add(stock);
    this.ext(stock, M.wood, [[-0.078, 0.024], [-0.2, 0.006], [-0.44, -0.018], [-0.446, -0.15], [-0.25, -0.114], [-0.14, -0.084], [-0.1, -0.05], [-0.078, -0.03]], 0.028, 0.004, { side: true });
    this.box(stock, M.dark, 0.037, 0.136, 0.012, 0, -0.084, 0.449);
    const hr2 = this.shotgunRight = this.makeHand('R', 1); hr2.position.set(0.02, -0.058, 0.1); hr2.rotation.set(0.9, -0.1, 0.05); s.add(hr2);
    const hl2 = this.shotgunLeft = this.makeHand('L', 0.8); hl2.rotation.set(-0.2, 0.15, -0.9); s.add(hl2);
    this.shotgunLeftBase = new V3(-0.006, -0.042, -0.27);
    hl2.position.copy(this.shotgunLeftBase);
    this.handShell = new THREE.Group(); hl2.add(this.handShell); this.handShell.position.set(0.02, 0.035, -0.02); this.handShell.rotation.x = Math.PI / 2;
    this.cyl(this.handShell, M.shell, 0.0105, 0.0105, 0.055, 0, 0, 0, 'y'); this.cyl(this.handShell, M.brass, 0.011, 0.011, 0.014, 0, 0.032, 0, 'y');
    this.handShell.visible = false;
    // ---- Arms: sleeves that follow the hands.
    this.armR = this.makeArm(); this.armL = this.makeArm();
    // ---- Muzzle flash sprites.
    const fm = new THREE.MeshBasicMaterial({ map: TEX.muzzle, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
    this.flashMat = fm;
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), fm); this.flash.add(f1);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.07), fm); f2.rotation.y = Math.PI / 2; f2.position.z = -0.05; this.flash.add(f2);
    const f3 = f2.clone(); f3.rotation.set(0, Math.PI / 2, Math.PI / 2); this.flash.add(f3);
    this.flash.visible = false;
    // ---- Boot for the kick.
    const boot = this.boot = new THREE.Group();
    this.cyl(boot, M.trouser, 0.06, 0.055, 0.5, 0, 0.25, 0, 'y');
    this.box(boot, M.boot, 0.11, 0.12, 0.27, 0, -0.03, -0.07);
    this.box(boot, M.dark, 0.115, 0.03, 0.29, 0, -0.1, -0.075);
    boot.visible = false; this.root.add(boot);
    this.gun = new THREE.Group(); this.root.add(this.gun);
  }
  makeArm() {
    const M = this.mats(), g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, 1, 12), M.sleeve);
    m.position.y = 0.5; g.add(m);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 12), M.sleeve); cuff.position.y = 0.015; g.add(cuff);
    this.root.add(g);
    return g;
  }
  // Point an arm from anchor (camera space) to the wrist.
  placeArm(arm, wrist, anchor) {
    _v1.subVectors(anchor, wrist); const len = _v1.length();
    arm.position.copy(wrist);
    arm.quaternion.setFromUnitVectors(_v2.set(0, 1, 0), _v1.divideScalar(len));
    arm.children[0].scale.y = len; arm.children[0].position.y = len / 2;
  }
  setWeapon(key, instant) {
    this.current = key; this.def = WDEF[key];
    this.gun.remove(this.pistol, this.shotgun);
    const m = key === 'pistol' ? this.pistol : this.shotgun;
    this.gun.add(m);
    m.add(this.flash); this.flash.position.fromArray(this.def.muzzle);
    this.vmFlash.position.fromArray(this.def.muzzle);
    this.focus = 0;
    if (!instant) this.startAction('equip', this.def.equip);
    G.ui && G.ui.ammoDirty();
  }

  // ------------------------------------------------------------------ state helpers
  get busy() { return this.action && this.action !== 'reload'; }
  startAction(name, dur, data = {}) { this.action = name; this.actionT = 0; this.actionDur = dur; this.adata = data; this.events = new Set(); }
  ev(name, at) { if (this.events.has(name)) return false; if (this.actionT / this.actionDur >= at) { this.events.add(name); return true; } return false; }
  roundsInGun() { return this.current === 'pistol' ? this.ammo.pistol.mag + this.ammo.pistol.chamber : this.ammo.shotgun.n; }
  canFireNow() {
    const P = this.player;
    if (P.state === 'dead' || P.healing > 0) return false;
    if (this.cool > 0 || P.sprintBlend > 0.35) return false;
    if (this.action && this.action !== 'reload') return false;
    return true;
  }
  currentSpread() {
    const d = this.def, P = this.player;
    const move = clamp01(P.speed / MOVE.walk);
    if (this.ads < 0.9) return d.hipSpread * (1 + move * 0.5) * (1 + P.sprintBlend);
    const f = TUNE.fx.focus ? this.focus : 0.35;
    return lerp(d.adsSpreadMax, d.adsSpreadMin, easeOut(f)) * (1 + move * 0.35);
  }

  // ------------------------------------------------------------------ update
  update(dt, rdt) {
    const P = this.player, d = this.def;
    this.cool = Math.max(0, this.cool - dt);
    this.fireBuffer = Math.max(0, this.fireBuffer - rdt);
    if (Input.lmbP) this.fireBuffer = 0.14;
    const normal = P.state === 'normal';

    // Point-blank shot while grabbed.
    if (P.state === 'grabbed' && Input.lmbP) this.pointBlank(P.grab.enemy);

    if (normal) {
      // Weapon switching.
      let want = null;
      if (Input.hit('Digit1')) want = 'pistol';
      if (Input.hit('Digit2') && P.inv.hasShotgun) want = 'shotgun';
      if (Input.wheel && P.inv.hasShotgun) want = this.current === 'pistol' ? 'shotgun' : 'pistol';
      if (want && want !== this.current && this.action !== 'unequip' && this.action !== 'kick') { this.cancelReload(); this.startAction('unequip', d.unequip, { next: want }); }
      // Kick.
      if ((Input.hit('KeyV') || Input.hit('Space') || Input.mmbP) && this.action !== 'kick' && this.action !== 'unequip' && P.healing <= 0) this.startKick();
      // Reload.
      if (Input.hit('KeyR') && !this.action && P.healing <= 0) this.startReload();
    }
    // ADS.
    const wantAds = normal && Input.rmb && P.healing <= 0 && this.action !== 'kick' && this.action !== 'unequip' && this.action !== 'equip';
    if (wantAds) P.sprinting = false;
    this.ads = clamp01(this.ads + (wantAds ? 1 : -1) * dt / d.adsTime);
    this.updateFocus(dt);
    // Fire.
    if (normal && this.fireBuffer > 0) {
      P.sprinting = false;
      if (this.action === 'reload' && this.current === 'shotgun' && this.ammo.shotgun.n > 0 && this.ammo.shotgun.ready) { this.cancelReload(); }
      if (this.canFireNow() && this.action !== 'reload') { this.fireBuffer = 0; this.fire(); }
    }
    // Deferred actions wait until the weapon is free instead of being dropped.
    if (this.pendingPump >= 0) {
      this.pendingPump = Math.max(0, this.pendingPump - dt);
      if (this.pendingPump === 0 && !this.action && this.current === 'shotgun') { this.pendingPump = -1; if (!this.ammo.shotgun.ready) this.startAction('pump', d.pump); }
    }
    if (this.autoReload >= 0) {
      this.autoReload = Math.max(0, this.autoReload - dt);
      if (this.autoReload === 0 && !this.action && normal) { this.autoReload = -1; this.startReload(); }
    }
    this.updateAction(dt);
    this.updateViewmodel(dt, rdt);
    this.spreadDeg = this.currentSpread();
  }

  updateFocus(dt) {
    const P = this.player, d = this.def;
    const prev = this.focus;
    if (this.ads < 0.9 || this.action === 'reload') { this.focus = Math.max(0, this.focus - dt * 4); }
    else {
      const still = P.speed < 0.6;
      const cap = still ? 1 : 0.25;
      if (this.focus < cap) this.focus = Math.min(cap, this.focus + dt / d.focusTime * TUNE.focusSpeed);
      else this.focus = Math.max(cap, this.focus - dt * 2);
      this.focus = Math.max(0, this.focus - (P.lookDelta || 0) * 0.0011);
    }
    this.focusFull = this.focus >= 0.97 && this.ads > 0.9;
    if (this.focusFull && prev < 0.97 && TUNE.fx.focus && this.current === 'pistol') G.audio.focusReady();
  }

  // ------------------------------------------------------------------ fire
  fire() {
    const P = this.player, d = this.def;
    if (this.current === 'pistol') {
      const a = this.ammo.pistol;
      if (!a.chamber) { G.audio.dryFire(); this.cool = 0.25; this.jolt.kick(-0.3); if (P.inv.pistol > 0) this.autoReload = 0.3; else G.ui.toast('手枪没有子弹了'); return; }
      if (a.mag > 0) a.mag--; else a.chamber = 0;
      if (!a.chamber) G.audio.click(0.35, 4200);
    } else {
      const a = this.ammo.shotgun;
      if (a.n <= 0) { G.audio.dryFire(); this.cool = 0.3; if (P.inv.shells > 0) this.autoReload = 0.3; else G.ui.toast('没有霰弹了'); return; }
      if (!a.ready) { this.startAction('pump', d.pump); return; }
      a.n--; a.ready = false; this.pendingPump = 0.14;
    }
    this.cool = d.interval;
    const focused = this.focusFull && TUNE.fx.focus;
    const spread = this.currentSpread() * DEG;
    this.focus = Math.max(0, this.focus - d.focusBloom);
    P.stats.shots++;
    // Muzzle position in world space (camera space offset, approximate).
    const cam = P.camera;
    const mp = _v3.set(0.1 * (1 - this.ads), -0.07 - 0.02 * (1 - this.ads), -0.55).applyQuaternion(cam.quaternion).add(cam.position);
    const muzzleWorld = new V3().copy(mp);
    // Pellets.
    const origin = new V3().copy(cam.position);
    const dir = P.aimDir;
    const byEnemy = new Map();
    let wallFx = 0;
    const up = Math.abs(dir.y) < 0.99 ? _v4.set(0, 1, 0) : _v4.set(1, 0, 0);
    const u = new V3().crossVectors(up, dir).normalize(), w = new V3().crossVectors(dir, u);
    const rot = Math.random() * TAU;
    for (let i = 0; i < d.pellets; i++) {
      const pd = new V3();
      if (d.pellets === 1) coneDir(dir, spread, pd);
      else {
        const [px, py] = this.shellPattern[i];
        const c = Math.cos(rot), s = Math.sin(rot), tr = Math.tan(spread);
        const jx = gauss() * 0.22, jy = gauss() * 0.22;
        pd.copy(dir).addScaledVector(u, (px * c - py * s + jx) * tr).addScaledVector(w, (px * s + py * c + jy) * tr).normalize();
      }
      const hit = this.trace(origin, pd);
      if (G.watchman) G.watchman.checkShot(origin, pd, hit.t);
      if (hit.kind === 'enemy') {
        let arr = byEnemy.get(hit.e); if (!arr) { arr = []; byEnemy.set(hit.e, arr); }
        arr.push({ part: hit.part, point: hit.point, t: hit.t, dir: pd });
      } else if (hit.kind === 'clock') {
        G.clock.takeHit(hit, d, focused, pd);
      } else if (hit.kind === 'wall') {
        const h = hit.hit;
        G.fx.impact(h.point, { x: h.nx, y: h.ny, z: h.nz }, h.surf, pd, d.pellets > 1 ? 0.45 : 1);
        if (wallFx++ < 2) G.audio.impact(h.point, h.surf);
      }
    }
    let anyHit = false, anyHead = false, anyKill = false;
    for (const [e, hits] of byEnemy) {
      const r = e.takeHits(hits, { def: d, dir, origin, focused });
      anyHit = true; anyHead = anyHead || r.head; anyKill = anyKill || r.kill;
    }
    if (anyHit) { P.stats.hits++; G.ui.hitMarker(anyKill ? 'kill' : anyHead ? 'head' : 'hit'); G.audio.hitTick(anyHead); }
    if (anyHead) P.stats.heads++;
    // Feedback.
    const R = d.recoil;
    const vp = focused ? 0.85 : 1;
    P.addRecoil(rand(R.pitch[0], R.pitch[1]) * vp, rand(-R.yaw, R.yaw), R.recover, R.view, rand(-R.roll, R.roll), R.fov, R.trauma);
    if (TUNE.fx.gunKick) {
      const K = d.kick;
      this.kickSpring(this.kz, K.z); this.kickSpring(this.krx, K.rx); this.kickSpring(this.ky, K.y); this.kickSpring(this.krz, rand(-K.rz, K.rz));
    }
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * TAU; this.flash.scale.setScalar(rand(0.8, 1.25) * (d.pellets > 1 ? 1.6 : 1));
    G.fx.muzzle(muzzleWorld, dir, d.pellets > 1);
    if (this.current === 'pistol') {
      G.audio.pistolShot();
      this.slideOff = 0.028;
      this.hammer.rotation.x = -0.9;
      this.ejectCasing(false);
    } else G.audio.shotgunShot();
    emitNoise(P.pos.x, 1.5, P.pos.z, d.noise, 'gun');
    G.director && G.director.onShot();
    G.ui.ammoDirty();
  }
  kickSpring(s, amount) { const w = Math.sqrt(s.k); s.kick(amount * w / 0.55); }
  trace(origin, dir) {
    let best = { t: 80, kind: 'none' };
    // The clock's movement collider must not stop bullets; the clock resolves its own face and eye.
    const wall = G.level.raycast(origin, dir, 80, (b) => b.id !== 'clock');
    if (wall) best = { t: wall.t, kind: 'wall', hit: wall };
    for (const e of G.enemies) {
      if (!e.hittable) continue;
      const h = e.rayHit(origin, dir, best.t);
      if (h && h.t < best.t) best = { t: h.t, kind: 'enemy', e, part: h.part, point: h.point };
    }
    if (G.clock) { const h = G.clock.rayHit(origin, dir, best.t); if (h && h.t < best.t) best = { t: h.t, kind: 'clock', part: h.part, point: h.point, normal: h.normal }; }
    return best;
  }
  ejectCasing(shell) {
    const cam = this.player.camera;
    const p = new V3().fromArray(this.def.port).add(this.gun.position).applyQuaternion(cam.quaternion).add(cam.position);
    const v = new V3(rand(1.2, 2.0), rand(1.4, 2.4), rand(-0.3, 0.3)).applyQuaternion(cam.quaternion);
    v.x += this.player.vel.x; v.z += this.player.vel.z;
    G.fx.ejectCasing(p, v, shell);
  }
  pointBlank(enemy) {
    const P = this.player;
    if (!enemy || this.cool > 0 || (this.action && this.action !== 'reload')) return;
    const loaded = this.current === 'pistol' ? this.ammo.pistol.chamber > 0 : (this.ammo.shotgun.n > 0 && this.ammo.shotgun.ready);
    if (!loaded) { G.audio.dryFire(); this.cool = 0.3; G.ui.toast('没有子弹'); return; }
    this.cancelReload();
    if (this.current === 'pistol') { const a = this.ammo.pistol; if (a.mag > 0) a.mag--; else a.chamber = 0; }
    else { this.ammo.shotgun.n--; this.ammo.shotgun.ready = false; this.pendingPump = 0.3; }
    this.cool = 0.3;
    P.stats.shots++; P.stats.hits++; P.stats.heads++;
    const dir = _v1.subVectors(enemy.headPos, P.camera.position).normalize().clone();
    const r = enemy.takeHits([{ part: 'head', point: enemy.headPos.clone(), t: 0.5, dir }], { def: this.def, dir, origin: P.camera.position.clone(), focused: true, pointBlank: true });
    G.ui.hitMarker(r.kill ? 'kill' : 'head');
    const R = this.def.recoil;
    P.addRecoil(R.pitch[1], 0, 0.9, R.view * 1.5, R.roll, R.fov, 0.5);
    this.kickSpring(this.kz, this.def.kick.z); this.kickSpring(this.krx, this.def.kick.rx);
    this.flashT = 0.05;
    G.fx.muzzle(enemy.headPos, dir, true);
    if (this.current === 'pistol') { G.audio.pistolShot(); this.slideOff = 0.028; this.ejectCasing(false); } else G.audio.shotgunShot();
    emitNoise(P.pos.x, 1.5, P.pos.z, this.def.noise, 'gun');
    G.ui.ammoDirty();
  }

  // ------------------------------------------------------------------ reload / pump / kick
  startReload() {
    const P = this.player;
    if (this.current === 'pistol') {
      const a = this.ammo.pistol;
      if (a.mag >= 8) return;
      if (P.inv.pistol <= 0) { G.ui.toast('没有备用子弹'); return; }
      const empty = !a.chamber;
      this.startAction('reload', empty ? this.def.reloadEmpty : this.def.reloadTac, { empty, anim: empty ? ANIM.pistolEmpty : ANIM.pistolTac, magOut: false, magIn: false });
    } else {
      const a = this.ammo.shotgun;
      if (a.n >= 5) return;
      if (P.inv.shells <= 0) { G.ui.toast('没有备用霰弹'); return; }
      this.startAction('reload', this.def.reloadStart, { phase: 'start', needPump: !a.ready });
    }
  }
  cancelReload() {
    if (this.action !== 'reload') return;
    const a = this.adata, P = this.player;
    if (this.current === 'pistol' && a.magOut && !a.magIn) {
      const take = Math.min(8, P.inv.pistol); this.ammo.pistol.mag = take; P.inv.pistol -= take;
      this.pistolMag.visible = true; this.newMag.visible = false;
    }
    this.handShell.visible = false;
    this.action = null;
    G.ui.ammoDirty();
  }
  startKick() {
    const P = this.player;
    this.cancelReload();
    const weak = P.stamina < MOVE.staminaKick;
    P.stamina = Math.max(0, P.stamina - MOVE.staminaKick); P.staminaT = MOVE.staminaDelay;
    this.startAction('kick', weak ? 0.66 : 0.5, { weak, hit: false });
    this.ads = Math.min(this.ads, 0.3);
    G.audio.whoosh();
    P.stats.kicks++;
  }
  doKickHit() {
    const P = this.player, fwd = _v1.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    let best = null, bestD = 1e9;
    const lookingDown = P.pitch < -0.35;
    for (const e of G.enemies) {
      if (!e.kickable) continue;
      // Bodies on the floor are stomped at the face; crawlers are kicked at the head.
      const low = e.isLow;
      const tx = low ? e.headPos.x : e.pos.x, tz = low ? e.headPos.z : e.pos.z;
      const dx = tx - P.pos.x, dz = tz - P.pos.z, dist = Math.hypot(dx, dz);
      const range = low ? 1.55 : 1.95;
      if (dist > range) continue;
      const dot = (dx * fwd.x + dz * fwd.z) / (dist || 1);
      if (dot < (low ? 0.2 : 0.55) && dist > 0.6) continue;
      if (low && !lookingDown && e.state !== 'crawl') continue;
      if (dist < bestD) { bestD = dist; best = e; }
    }
    if (!best) return false;
    emitNoise(P.pos.x, 1, P.pos.z, 5.5, 'kick');
    const dir = new V3(best.pos.x - P.pos.x, 0, best.pos.z - P.pos.z).normalize();
    best.kicked(dir, this.adata.weak);
    P.addTrauma(0.2); P.punchP.kick(-1.5 * DEG * 30);
    hitstop(0.06, 0.05);
    G.audio.kickHit(best.pos);
    return true;
  }
  updateAction(dt) {
    if (!this.action) return;
    const P = this.player, d = this.def, a = this.adata;
    this.actionT += dt;
    const t = this.actionT / this.actionDur;
    switch (this.action) {
      case 'equip': break;
      case 'unequip': if (t >= 1) { this.setWeapon(a.next); return; } break;
      case 'pump':
        if (this.ev('back', ANIM.pump.back)) { G.audio.pump(); this.ejectCasing(true); }
        if (t >= 1) { this.ammo.shotgun.ready = this.ammo.shotgun.n > 0; this.action = null; G.ui.ammoDirty(); }
        break;
      case 'kick':
        this.boot.visible = true;
        if (this.ev('hit', ANIM.kick.hit)) a.hit = this.doKickHit();
        if (this.ev('lunge', 0.12)) P.lunge.kick(3.2);
        break;
      case 'reload':
        if (this.current === 'pistol') this.updatePistolReload(t);
        else this.updateShotgunReload(t);
        break;
    }
    if (this.action && this.actionT >= this.actionDur && this.action !== 'reload') {
      if (this.action === 'kick') this.boot.visible = false;
      this.action = null;
    }
  }
  updatePistolReload(t) {
    const a = this.adata, an = a.anim, P = this.player, A = this.ammo.pistol;
    if (this.ev('out', an.magOut)) {
      a.magOut = true; P.inv.pistol += A.mag; A.mag = 0; this.pistolMag.visible = false; G.audio.magOut();
      const cam = P.camera;
      const p = new V3(0.12, -0.34, -0.3).applyQuaternion(cam.quaternion).add(cam.position);
      const v = new V3(0, -0.5, 0).add(P.vel);
      G.fx.dropMag(p, v);
      G.ui.ammoDirty();
    }
    if (this.ev('show', an.magShowNew)) this.newMag.visible = true;
    if (this.ev('in', an.magIn)) {
      a.magIn = true; const take = Math.min(8, P.inv.pistol); A.mag = take; P.inv.pistol -= take;
      this.newMag.visible = false; this.pistolMag.visible = true; G.audio.magIn(); this.jolt.kick(1.2);
      G.ui.ammoDirty();
    }
    if (a.empty && this.ev('rel', an.slideRelease)) {
      if (A.mag > 0) { A.mag--; A.chamber = 1; }
      this.slideOff = 0; G.audio.slideRelease(); this.jolt.kick(1.6); G.ui.ammoDirty();
    }
    if (t >= 1) this.action = null;
  }
  updateShotgunReload(t) {
    const a = this.adata, P = this.player, A = this.ammo.shotgun;
    if (a.phase === 'start' && t >= 1) { a.phase = 'shell'; this.actionT = 0; this.actionDur = this.def.reloadShell; this.events = new Set(); return; }
    if (a.phase === 'shell') {
      if (this.ev('show', 0.35)) this.handShell.visible = true;
      if (this.ev('ins', ANIM.shotgunShell.insert)) {
        this.handShell.visible = false; A.n++; P.inv.shells--; G.audio.shellInsert(); this.jolt.kick(0.6); G.ui.ammoDirty();
      }
      if (t >= 1) {
        if (A.n < 5 && P.inv.shells > 0) { this.actionT = 0; this.events = new Set(); }
        else { a.phase = 'end'; this.actionT = 0; this.actionDur = this.def.reloadEnd; this.events = new Set(); }
      }
      return;
    }
    if (a.phase === 'end' && t >= 1) {
      this.action = null;
      if (a.needPump || !A.ready) this.startAction('pump', this.def.pump);
    }
  }

  // ------------------------------------------------------------------ viewmodel
  updateViewmodel(dt, rdt) {
    const P = this.player, d = this.def;
    const a = easeInOut(this.ads);
    let px = lerp(d.hip[0], d.ads[0], a), py = lerp(d.hip[1], d.ads[1], a), pz = lerp(d.hip[2], d.ads[2], a);
    let rx = 0, ry = lerp(0.06, 0, a), rz = lerp(-0.04, 0, a);
    const sb = P.sprintBlend;
    px += -0.035 * sb; py += -0.045 * sb; pz += 0.03 * sb; rx += -0.42 * sb; ry += 0.6 * sb; rz += 0.32 * sb;
    const bk = 1 - a * 0.85;
    px += Math.sin(P.bobPhase) * P.bobAmp * 0.5 * bk;
    py += -Math.abs(Math.cos(P.bobPhase)) * P.bobAmp * 0.4 * bk;
    rz += Math.sin(P.bobPhase) * P.bobAmp * 0.8 * bk;
    // Breathing.
    const br = (1 - a * 0.7) * (P.stamina < 40 ? 2.2 : 1);
    py += Math.sin(G.realTime * 1.4) * 0.0014 * br; rx += Math.sin(G.realTime * 1.4 - 0.5) * 0.004 * br;
    // Sway lags behind the look.
    this.swayX.target = clamp(-Input.mdx * 0.00028, -0.03, 0.03) * (1 - a * 0.6);
    this.swayY.target = clamp(Input.mdy * 0.00028, -0.03, 0.03) * (1 - a * 0.6);
    this.swayR.target = clamp(-Input.mdx * 0.0012, -0.12, 0.12) * (1 - a * 0.5);
    this.swayX.update(rdt); this.swayY.update(rdt); this.swayR.update(rdt);
    px += this.swayX.x; py += this.swayY.x; rz += this.swayR.x; ry += this.swayX.x * 1.5;
    // Strafe lean.
    const lateral = P.vel.x * Math.cos(P.yaw) - P.vel.z * Math.sin(P.yaw);
    this.strafeRoll = damp(this.strafeRoll || 0, -lateral * 0.018, 8, dt);
    rz += this.strafeRoll;
    // Recoil springs.
    this.kz.update(rdt); this.krx.update(rdt); this.krz.update(rdt); this.ky.update(rdt); this.jolt.update(rdt);
    pz += this.kz.x; rx += this.krx.x; rz += this.krz.x; py += this.ky.x + this.jolt.x * 0.01; rx += this.jolt.x * 0.03;
    // Action offsets.
    const off = this.actionOffsets();
    px += off[0]; py += off[1]; pz += off[2]; rx += off[3]; ry += off[4]; rz += off[5];
    // Healing lowers the gun out of view.
    this.healBlend = damp(this.healBlend || 0, P.healing > 0 ? 1 : 0, 10, dt);
    py -= this.healBlend * 0.3; rx -= this.healBlend * 0.6;
    // Grabbed: gun pushed aside.
    this.grabBlend = damp(this.grabBlend || 0, P.state === 'grabbed' ? 1 : 0, 12, dt);
    px += this.grabBlend * 0.05; py -= this.grabBlend * 0.06; rz -= this.grabBlend * 0.4; rx += this.grabBlend * 0.2;
    if (P.state === 'dead') py -= 0.5;
    this.gun.position.set(px, py, pz);
    this.gun.rotation.set(rx, ry, rz);
    // Part animation: slide, hammer, pump.
    const A = this.ammo.pistol;
    // Slide cycles after each shot and locks back on an empty chamber: the gun itself shows it is empty.
    const locked = this.current === 'pistol' && !A.chamber;
    this.slideOff = locked ? Math.max(0.026, damp(this.slideOff, 0.026, 60, dt)) : damp(this.slideOff, 0, 32, dt);
    if (this.action === 'reload' && this.current === 'pistol' && this.adata.empty && this.actionT / this.actionDur > ANIM.pistolEmpty.slideGrab && !this.events.has('rel')) this.slideOff = 0.032;
    this.slide.position.z = this.slideOff;
    let pumpZ = 0;
    if (this.action === 'pump') { const t = this.actionT / this.actionDur; pumpZ = t < 0.36 ? smooth(t / 0.36) * 0.085 : t < 0.72 ? (1 - smooth((t - 0.36) / 0.36)) * 0.085 : 0; }
    this.pump.position.z = -0.27 + pumpZ;
    // Left hand follows reload animation.
    if (this.current === 'pistol') {
      if (this.action === 'reload') { const h = track(this.adata.anim.hand, this.actionT / this.actionDur, [0, 0, 0]); this.pistolLeft.position.set(h[0], h[1], h[2]); }
      else this.pistolLeft.position.copy(this.pistolLeftBase);
    } else {
      if (this.action === 'reload' && this.adata.phase === 'shell') { const h = track(ANIM.shotgunShell.hand, this.actionT / this.actionDur, [0, 0, 0]); this.shotgunLeft.position.set(h[0], h[1], h[2]); this.shotgunLeft.rotation.set(0.5, 0.2, -0.6); }
      else if (this.action === 'reload') { const k = this.adata.phase === 'start' ? smooth(clamp01(this.actionT / this.actionDur)) : 1 - smooth(clamp01(this.actionT / this.actionDur)); this.shotgunLeft.position.set(lerp(this.shotgunLeftBase.x, 0, k), lerp(this.shotgunLeftBase.y, -0.05, k), lerp(this.shotgunLeftBase.z + pumpZ, -0.05, k)); this.shotgunLeft.rotation.set(lerp(-0.2, 0.5, k), lerp(0.15, 0.2, k), lerp(-0.9, -0.6, k)); }
      else { this.shotgunLeft.position.set(this.shotgunLeftBase.x, this.shotgunLeftBase.y, this.shotgunLeftBase.z + pumpZ); this.shotgunLeft.rotation.set(-0.2, 0.15, -0.9); }
    }
    // Arms.
    this.gun.updateMatrixWorld(true);
    this.vmFlash.position.set(px + d.muzzle[0], py + d.muzzle[1], pz + d.muzzle[2]);
    const rh = this.current === 'pistol' ? this.pistolRight : this.shotgunRight;
    const lh = this.current === 'pistol' ? this.pistolLeft : this.shotgunLeft;
    rh.getWorldPosition(_v3); _v3.z += 0.03; this.placeArm(this.armR, _v3, _v4.set(0.36, -0.72, 0.02));
    lh.getWorldPosition(_v3); _v3.z += 0.02; this.placeArm(this.armL, _v3, _v4.set(-0.3, -0.75, 0.0));
    const lowered = P.state === 'dead' || this.healBlend > 0.9;
    this.gun.visible = !lowered; this.armR.visible = this.armL.visible = !lowered;
    // Kick boot.
    if (this.action === 'kick') {
      const t = this.actionT / this.actionDur;
      const k = t < 0.28 ? easeOut3(t / 0.28) : t < 0.5 ? 1 : 1 - smooth((t - 0.5) / 0.5);
      this.boot.position.set(0.02 + 0.03 * k, -0.95 + k * 0.62, -0.25 - k * 0.45);
      this.boot.rotation.set(-1.2 + k * 0.55, 0.05, 0);
      this.kickDip = -k * 0.05;
    } else { this.boot.visible = false; this.kickDip = damp(this.kickDip, 0, 12, dt); }
    // Muzzle flash sprite and viewmodel light.
    this.flashT -= rdt;
    const fOn = this.flashT > 0 && TUNE.fx.muzzleLight;
    this.flash.visible = this.flashT > 0;
    this.vmFlash.intensity = fOn ? (this.current === 'pistol' ? 3 : 6) : 0;
    this.updateVmLighting(dt);
    // FOV of the viewmodel camera.
    const vmFov = lerp(52, 44, a);
    if (Math.abs(this.camera.fov - vmFov) > 0.01) { this.camera.fov = vmFov; this.camera.updateProjectionMatrix(); }
  }
  actionOffsets() {
    if (!this.action) return ZERO6;
    const t = clamp01(this.actionT / this.actionDur), out = [0, 0, 0, 0, 0, 0];
    switch (this.action) {
      case 'reload':
        if (this.current === 'pistol') return track(this.adata.anim.gun, t, out);
        if (this.adata.phase === 'start') return track(ANIM.shotgunStart.gun, t, out);
        if (this.adata.phase === 'shell') return track(ANIM.shotgunShell.gun, t, out);
        return track(ANIM.shotgunEnd.gun, t, out);
      case 'pump': return track(ANIM.pump.gun, t, out);
      case 'kick': return track(ANIM.kick.gun, t, out);
      case 'equip': return track(ANIM.equip.gun, t, out);
      case 'unequip': return track(ANIM.unequip.gun, t, out);
    }
    return ZERO6;
  }
  // Light the viewmodel from the dominant nearby lamp, flashlight bounce, muzzle flash.
  updateVmLighting(dt) {
    const P = this.player, cam = P.camera;
    let best = null, bestI = 0;
    for (const s of G.level.pool) {
      if (!s.lamp || s.light.intensity <= 0) continue;
      const d2 = s.light.position.distanceToSquared(cam.position);
      const I = s.light.intensity / (d2 + 0.5);
      if (I > bestI) { bestI = I; best = s; }
    }
    const sw = G.level.swing; if (sw.light.intensity > 0) { const d2 = sw.light.position.distanceToSquared(cam.position); const I = sw.light.intensity * 0.5 / (d2 + 0.5); if (I > bestI) { bestI = I; best = { light: sw.light }; } }
    if (best) {
      _v1.copy(best.light.position); cam.worldToLocal(_v1); _v1.normalize();
      this.vmKey.position.copy(_v1).multiplyScalar(2);
      this.vmKey.color.copy(best.light.color);
    }
    this.vmKey.intensity = damp(this.vmKey.intensity, clamp(0.3 + bestI * 2.2, 0, 3), 10, dt);
    // Flashlight bounce off the surface ahead.
    this.bounceT = (this.bounceT || 0) - dt;
    if (this.bounceT <= 0) { this.bounceT = 0.1; const h = G.level.raycast(cam.position, P.flashDir, 8); this.bounceDist = h ? h.t : 8; }
    const bounce = P.flashlightOn ? clamp(2.5 / (this.bounceDist * this.bounceDist + 0.5), 0.15, 2.2) : 0;
    this.vmBounce.intensity = damp(this.vmBounce.intensity, bounce * P.flashlight.intensity / P.flashBase, 12, dt);
    this.vmHemi.intensity = 0.3 + clamp(bestI * 0.8, 0, 0.7) + G.fx.flash * 2;
    this.vmFill.intensity = P.flashlightOn ? 0.6 : 0.25;
  }
}
