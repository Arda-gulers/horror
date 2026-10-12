'use strict';
// Shared scope for every src/*.js file (classic scripts share top-level bindings).

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => clamp01((v - a) / (b - a));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const angleTo = (from, to) => wrapAngle(to - from);
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
// Gaussian-ish sample in [-1, 1], weighted to the middle.
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// Damped spring, integrated semi-implicitly. freq in Hz, zeta = damping ratio.
class Spring {
  constructor(freq = 6, zeta = 0.5) { this.x = 0; this.v = 0; this.target = 0; this.set(freq, zeta); }
  set(freq, zeta) { const w = TAU * freq; this.k = w * w; this.c = 2 * zeta * w; return this; }
  kick(v) { this.v += v; }
  update(dt) {
    const steps = dt > 1 / 90 ? Math.ceil(dt * 120) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -this.k * (this.x - this.target) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

// Smooth 1D value noise for camera shake and flicker.
const Noise1 = (() => {
  const P = new Float32Array(512);
  for (let i = 0; i < 512; i++) P[i] = Math.random() * 2 - 1;
  return (x) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(P[i & 511], P[(i + 1) & 511], u);
  };
})();

// ---------------------------------------------------------------------------
// Tuning: every feel parameter lives here so the in-game panel can edit it live.
const TUNE = {
  sens: 1.0,          // mouse sensitivity multiplier (base 0.0021 rad per px)
  adsSens: 0.72,      // sensitivity multiplier while aiming
  invertY: false,
  fov: 74,
  recoil: 1.0,        // multiplier on all recoil
  shake: 1.0,         // multiplier on camera shake
  hitstop: 1.0,       // multiplier on hit-stop durations
  focusSpeed: 1.0,    // multiplier on reticle focus rate
  tokens: 2,          // max simultaneous attackers
  aimAssist: 0,       // not used on mouse; kept at 0 deliberately
  brightness: 1.0,
  fx: {
    muzzleLight: true, aimRecoil: true, viewPunch: true, gunKick: true, shake: true,
    hitstop: true, fovPunch: true, hitReact: true, audioLayers: true, shells: true,
    decals: true, reticle: true, gore: true, lurch: true, focus: true, dynamicSupply: true,
  },
};
const TUNE_DEFAULT = JSON.parse(JSON.stringify(TUNE));

// ---------------------------------------------------------------------------
// Global game state.
const G = {
  time: 0, realTime: 0, dt: 0, rdt: 0,
  timeScale: 1, hitstopT: 0, hitstopScale: 1, slowT: 0, slowScale: 1,
  paused: true, started: false, over: false, inNote: false,
  scene: null, camera: null, renderer: null, vmScene: null, vmCamera: null,
  level: null, player: null, weapons: null, fx: null, audio: null, director: null, ui: null, post: null,
  enemies: [], watchman: null, clock: null,
  noises: [],        // recent noise events { x, y, z, r, t, kind }
  debug: /[?&]debug/.test(location.search),
  frame: 0,
};

// World time freeze / slow-motion. Player input and camera look are never scaled.
function hitstop(seconds, scale = 0.05) {
  if (!TUNE.fx.hitstop) return;
  seconds *= TUNE.hitstop;
  if (seconds <= 0) return;
  G.hitstopScale = G.hitstopT > 0 ? Math.min(G.hitstopScale, scale) : scale;
  G.hitstopT = Math.max(G.hitstopT, seconds);
}
function slowmo(seconds, scale) {
  if (!TUNE.fx.hitstop) return;
  G.slowT = Math.max(G.slowT, seconds * TUNE.hitstop);
  G.slowScale = scale;
}
function updateTimeScale(rdt) {
  let s = 1;
  if (G.hitstopT > 0) { G.hitstopT -= rdt; s = Math.min(s, G.hitstopScale); if (G.hitstopT <= 0) G.hitstopScale = 1; }
  if (G.slowT > 0) { G.slowT -= rdt; s = Math.min(s, G.slowScale); }
  G.timeScale = s;
}

// Noise events drive enemy hearing and the watchman.
function emitNoise(x, y, z, radius, kind) {
  G.noises.push({ x, y, z, r: radius, t: G.time, kind });
  if (G.noises.length > 32) G.noises.shift();
}

// ---------------------------------------------------------------------------
// Input.
const Input = {
  down: new Set(), pressed: new Set(), released: new Set(),
  mdx: 0, mdy: 0, lmb: false, rmb: false, lmbP: false, rmbP: false, mmbP: false, wheel: 0,
  locked: false,
  init(canvas) {
    const block = new Set(['Tab', 'Space', 'KeyQ', 'KeyF']);
    addEventListener('keydown', (e) => {
      if (block.has(e.code) && G.started) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => { this.down.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.down.clear(); this.lmb = this.rmb = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked || G.debug) { this.mdx += e.movementX || 0; this.mdy += e.movementY || 0; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.lmb = true; this.lmbP = true; }
      if (e.button === 2) { this.rmb = true; this.rmbP = true; }
      if (e.button === 1) { this.mmbP = true; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.lmb = this.rmb = false; this.down.clear(); }
    });
  },
  key(code) { return this.down.has(code); },
  hit(code) { return this.pressed.has(code); },
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mdx = 0; this.mdy = 0; this.lmbP = false; this.rmbP = false; this.mmbP = false; this.wheel = 0;
  },
};

// Reusable temporaries (never hold references across calls).
const _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();

// Geometric helpers ---------------------------------------------------------
// Ray-sphere: returns t or -1. rd must be normalized.
function raySphere(ro, rd, c, r) {
  const ox = ro.x - c.x, oy = ro.y - c.y, oz = ro.z - c.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (cc < 0 ? 0 : -1);
}
// Ray-capsule (Inigo Quilez). Returns t or -1.
function rayCapsule(ro, rd, pa, pb, ra) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - ra * ra * baba;
  let h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
    let ocx, ocy, ocz;
    if (y <= 0) { ocx = oax; ocy = oay; ocz = oaz; } else { ocx = ro.x - pb.x; ocy = ro.y - pb.y; ocz = ro.z - pb.z; }
    b = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    c = ocx * ocx + ocy * ocy + ocz * ocz - ra * ra;
    h = b * b - c;
    if (h > 0) { const t2 = -b - Math.sqrt(h); if (t2 >= 0) return t2; }
  }
  return -1;
}
// Closest distance from point p to segment ab (3D).
function distPointSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const t = clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}
// Random direction inside a cone around dir (half-angle in radians), uniform over the disk.
function coneDir(dir, halfAngle, out) {
  const r = Math.tan(halfAngle) * Math.sqrt(Math.random());
  const th = Math.random() * TAU;
  // Build an orthonormal basis around dir.
  const up = Math.abs(dir.y) < 0.99 ? _v3.set(0, 1, 0) : _v3.set(1, 0, 0);
  const u = _v4.crossVectors(up, dir).normalize();
  const w = new V3().crossVectors(dir, u);
  out.copy(dir).addScaledVector(u, Math.cos(th) * r).addScaledVector(w, Math.sin(th) * r).normalize();
  return out;
}
