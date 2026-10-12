'use strict';
// Procedural textures. Everything the level, enemies and weapons show is painted here at load time.

const TEX = {};
const CANVAS = {};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: false }); }
function toTex(canvas, o = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = o.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = (o.repeat === false || o.clampV) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = o.aniso || 8;
  if (o.nearest) { t.magFilter = THREE.NearestFilter; }
  t.needsUpdate = true;
  return t;
}
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Tileable value-noise fbm, values in [0,1].
function tileNoise(w, h, freq, octaves, seed = 1, persistence = 0.5) {
  const out = new Float32Array(w * h);
  const R = seeded(seed * 7919 + 17);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const fx = freq << o, fy = Math.max(1, Math.round(freq * h / w)) << o;
    const lat = new Float32Array(fx * fy);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    for (let y = 0; y < h; y++) {
      const gy = y / h * fy, iy = Math.floor(gy), ty = gy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % fy) * fx, y1 = ((iy + 1) % fy) * fx;
      for (let x = 0; x < w; x++) {
        const gx = x / w * fx, ix = Math.floor(gx), tx = gx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % fx, x1 = (ix + 1) % fx;
        const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[y * w + x] += amp * (top + (bot - top) * sy);
      }
    }
    total += amp; amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
// Height field (Float32 0..1) -> tangent-space normal map canvas.
function normalCanvas(hf, w, h, strength) {
  const c = makeCanvas(w, h), x = ctx2d(c), img = x.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w, yd = ((y + 1) % h) * w;
    for (let xx = 0; xx < w; xx++) {
      const xl = (xx - 1 + w) % w, xr = (xx + 1) % w;
      const dx = (hf[y * w + xr] - hf[y * w + xl]) * strength;
      const dy = (hf[yd + xx] - hf[yu + xx]) * strength;
      const nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + xx) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (nz / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
// Read a canvas back into a height field (luminance).
function heightFromCanvas(c) {
  const w = c.width, h = c.height, d = ctx2d(c).getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return out;
}
function fillField(x, w, h, fn) {
  const img = x.createImageData(w, h), d = img.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) { const c = fn(i, i % w, (i / w) | 0); d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = c[3] === undefined ? 255 : c[3]; }
  x.putImageData(img, 0, 0);
}
// Draw fn at (px,py) plus wrapped copies so blobs near edges tile.
function wrapDraw(w, h, px, py, r, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const X = px + ox * w, Y = py + oy * h;
    if (X + r < 0 || X - r > w || Y + r < 0 || Y - r > h) continue;
    fn(X, Y);
  }
}
function blob(x, px, py, r, color, alpha) {
  const g = x.createRadialGradient(px, py, 0, px, py, r);
  g.addColorStop(0, color.replace('A', alpha)); g.addColorStop(1, color.replace('A', 0));
  x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
}
function crackPath(x, R, sx, sy, len, width, color, branch = 2) {
  x.strokeStyle = color; x.lineWidth = width; x.lineCap = 'round';
  let px = sx, py = sy, a = R() * TAU;
  x.beginPath(); x.moveTo(px, py);
  for (let i = 0; i < len; i++) {
    a += (R() - 0.5) * 0.9; px += Math.cos(a) * 6; py += Math.sin(a) * 6; x.lineTo(px, py);
    if (branch > 0 && R() < 0.04) { x.stroke(); crackPath(x, R, px, py, len * 0.4, width * 0.7, color, branch - 1); x.strokeStyle = color; x.lineWidth = width; x.beginPath(); x.moveTo(px, py); }
  }
  x.stroke();
}

// ------------------------------------------------------------------ surfaces
function genTerrazzo() {
  const S = 1024, c = makeCanvas(S), x = ctx2d(c), R = seeded(11);
  const n = tileNoise(S, S, 6, 5, 3), n2 = tileNoise(S, S, 3, 3, 8);
  fillField(x, S, S, (i) => { const v = 118 + (n[i] - 0.5) * 34 - (n2[i] - 0.5) * 30; return [v + 10, v + 6, v - 2]; });
  const cols = ['#e9e5da', '#d4cdbb', '#34322e', '#5e322b', '#6c7a68', '#a0947c', '#23231f', '#bdb29a', '#7e8b86'];
  for (let i = 0; i < 16000; i++) {
    const px = R() * S, py = R() * S, r = 1 + Math.pow(R(), 3) * 7.5, col = cols[(R() * cols.length) | 0], k = 5 + ((R() * 3) | 0);
    const pts = []; for (let j = 0; j < k; j++) { const a = j / k * TAU + R() * 0.6, rr = r * (0.55 + R() * 0.7); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    x.globalAlpha = 0.55 + R() * 0.4; x.fillStyle = col;
    wrapDraw(S, S, px, py, r, (X, Y) => { x.beginPath(); pts.forEach((p, j) => (j ? x.lineTo(X + p[0], Y + p[1]) : x.moveTo(X + p[0], Y + p[1]))); x.fill(); });
  }
  x.globalAlpha = 1;
  // Grime pooled in worn paths.
  for (let i = 0; i < 26; i++) { const px = R() * S, py = R() * S, r = 60 + R() * 200; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(40,34,26,A)', 0.12 + R() * 0.1)); }
  // Brass divider strips on a 1 m grid.
  x.fillStyle = '#7a6a45'; [0, 512].forEach((p) => { x.fillRect(p - 2, 0, 4, S); x.fillRect(0, p - 2, S, 4); });
  x.fillStyle = 'rgba(255,230,160,.25)'; [0, 512].forEach((p) => { x.fillRect(p - 1, 0, 1, S); x.fillRect(0, p - 1, S, 1); });
  CANVAS.terrazzo = c;
  TEX.terrazzo = toTex(c);
  const hf = heightFromCanvas(c);
  TEX.terrazzoN = toTex(normalCanvas(hf, S, S, 1.2), { srgb: false });
}

function genConcrete() {
  const S = 1024, c = makeCanvas(S), x = ctx2d(c), R = seeded(21);
  const n = tileNoise(S, S, 4, 6, 5), n2 = tileNoise(S, S, 16, 3, 6), n3 = tileNoise(S, S, 2, 3, 9);
  fillField(x, S, S, (i) => { const v = 92 + (n[i] - 0.5) * 50 + (n2[i] - 0.5) * 26 - (n3[i] - 0.5) * 40; return [v + 2, v + 2, v - 1]; });
  // Oil stains and grime.
  for (let i = 0; i < 40; i++) { const px = R() * S, py = R() * S, r = 20 + R() * 130; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(18,15,12,A)', 0.18 + R() * 0.3)); }
  for (let i = 0; i < 16; i++) { const px = R() * S, py = R() * S, r = 10 + R() * 40; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(8,8,6,A)', 0.55)); }
  // Speckle.
  for (let i = 0; i < 9000; i++) { x.fillStyle = R() < 0.5 ? 'rgba(170,165,150,.25)' : 'rgba(20,20,18,.3)'; x.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); }
  // Cracks.
  for (let i = 0; i < 7; i++) crackPath(x, R, R() * S, R() * S, 40 + R() * 60, 1.4, 'rgba(12,10,8,.75)');
  // Saw-cut joints at the tile boundary (4 m).
  x.fillStyle = 'rgba(10,9,8,.85)'; x.fillRect(0, 0, 3, S); x.fillRect(0, 0, S, 3);
  CANVAS.concrete = c;
  TEX.concrete = toTex(c);
  // Roughness: oil darkens and polishes.
  const rc = makeCanvas(512), rx = ctx2d(rc);
  rx.drawImage(c, 0, 0, 512, 512);
  const rd = rx.getImageData(0, 0, 512, 512), d = rd.data;
  for (let i = 0; i < d.length; i += 4) { const l = d[i] / 255; const r = clamp(0.55 + l * 0.9, 0.35, 1); d[i] = d[i + 1] = d[i + 2] = r * 255; }
  rx.putImageData(rd, 0, 0);
  TEX.concreteR = toTex(rc, { srgb: false });
  TEX.concreteN = toTex(normalCanvas(n2.map((v, i) => v * 0.6 + n[i] * 0.4), S, S, 2.2), { srgb: false });
}

// Institutional wall: cream plaster above a green painted dado. Maps 2 m wide x 3 m tall.
function genDadoWall() {
  const W = 512, H = 768, c = makeCanvas(W, H), x = ctx2d(c), R = seeded(31), PX = 256; // px per metre
  const n = tileNoise(W, H, 4, 5, 12), n2 = tileNoise(W, H, 12, 3, 13);
  const dadoY = H - 1.2 * PX, skirtY = H - 0.12 * PX;
  fillField(x, W, H, (i, px, py) => {
    const g = (n[i] - 0.5) * 26 + (n2[i] - 0.5) * 12;
    if (py < dadoY) { const top = py / H; return [196 + g - top * 10, 188 + g - top * 8, 164 + g - 4]; }
    if (py < skirtY) return [72 + g * 0.8, 96 + g * 0.8, 80 + g * 0.8];
    return [40 + g * 0.5, 34 + g * 0.5, 30 + g * 0.5];
  });
  // Water stains running down from the ceiling: few, uneven, soft.
  x.filter = 'blur(3px)';
  for (let i = 0; i < 4; i++) {
    const px = R() * W, w = 6 + R() * 26, len = 40 + R() * 260, a = 0.08 + R() * 0.14;
    const g = x.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(110,88,48,${a})`); g.addColorStop(1, 'rgba(110,88,48,0)');
    x.fillStyle = g; wrapDraw(W, 1e6, px, 0, w, (X) => { x.beginPath(); x.moveTo(X - w / 2, 0); x.lineTo(X + w / 2, 0); x.lineTo(X + w * 0.15, len); x.lineTo(X - w * 0.2, len * 0.8); x.fill(); });
  }
  x.filter = 'none';
  for (let i = 0; i < 18; i++) { const px = R() * W, py = R() * dadoY, r = 20 + R() * 90; wrapDraw(W, 1e6, px, py, r, (X) => blob(x, X, py, r, 'rgba(90,76,48,A)', 0.1)); }
  // Chipped paint on the dado shows plaster.
  for (let i = 0; i < 22; i++) {
    const px = R() * W, py = dadoY + R() * (skirtY - dadoY), r = 1.5 + Math.pow(R(), 3) * 9;
    x.fillStyle = 'rgba(190,182,158,.85)';
    wrapDraw(W, 1e6, px, py, r, (X) => { x.beginPath(); for (let j = 0; j < 7; j++) { const a = j / 7 * TAU, rr = r * (0.5 + R() * 0.6); j ? x.lineTo(X + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.7) : x.moveTo(X + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.7); } x.fill(); });
  }
  // Scuffs from carts and boots.
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(20,20,18,${0.15 + R() * 0.3})`; const px = R() * W, py = skirtY - R() * 0.5 * PX; x.fillRect(px, py, 10 + R() * 60, 1 + R() * 3); }
  // Dado line.
  x.fillStyle = '#2e3a30'; x.fillRect(0, dadoY - 3, W, 5);
  // Grime gradient at floor level.
  const fg = x.createLinearGradient(0, H - 0.5 * PX, 0, H); fg.addColorStop(0, 'rgba(15,12,10,0)'); fg.addColorStop(1, 'rgba(15,12,10,.5)');
  x.fillStyle = fg; x.fillRect(0, H - 0.5 * PX, W, 0.5 * PX);
  // Cracks in the plaster.
  for (let i = 0; i < 2; i++) crackPath(x, R, R() * W, R() * dadoY * 0.9, 14 + R() * 24, 0.8, 'rgba(70,58,44,.35)', 1);
  CANVAS.dado = c;
  TEX.dado = toTex(c, { clampV: true });
  TEX.dadoN = toTex(normalCanvas(n2, W, H, 1.5), { srgb: false, clampV: true });
}

// Workshop wall: 4 m wide x 8 m tall.
function genWorkshopWall() {
  const W = 512, H = 1024, c = makeCanvas(W, H), x = ctx2d(c), R = seeded(41), PX = 128;
  const n = tileNoise(W, H, 4, 5, 14), n2 = tileNoise(W, H, 16, 3, 15);
  const paintY = H - 1.8 * PX;
  fillField(x, W, H, (i, px, py) => {
    const g = (n[i] - 0.5) * 30 + (n2[i] - 0.5) * 16;
    if (py < paintY) { const soot = Math.max(0, 1 - py / (H * 0.45)); return [168 + g - soot * 90, 164 + g - soot * 90, 150 + g - soot * 86]; }
    return [70 + g * 0.7, 84 + g * 0.7, 80 + g * 0.7];
  });
  // Brick courses faintly visible through whitewash.
  x.strokeStyle = 'rgba(60,52,44,.10)'; x.lineWidth = 1;
  for (let y = 0; y < paintY; y += 8) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); const off = ((y / 8) % 2) * 16; for (let bx = off; bx < W; bx += 32) { x.beginPath(); x.moveTo(bx, y); x.lineTo(bx, y + 8); x.stroke(); } }
  for (let i = 0; i < 14; i++) {
    const px = R() * W, w = 8 + R() * 30, top = R() * 200, len = 200 + R() * 500;
    const g = x.createLinearGradient(0, top, 0, top + len); g.addColorStop(0, 'rgba(40,34,26,.35)'); g.addColorStop(1, 'rgba(40,34,26,0)');
    x.fillStyle = g; wrapDraw(W, 1e6, px, top, w, (X) => x.fillRect(X - w / 2, top, w, len));
  }
  x.fillStyle = '#26302b'; x.fillRect(0, paintY - 3, W, 4);
  for (let i = 0; i < 50; i++) { x.fillStyle = `rgba(15,15,14,${0.2 + R() * 0.3})`; x.fillRect(R() * W, H - R() * 1.2 * PX, 10 + R() * 70, 1 + R() * 3); }
  CANVAS.wsWall = c;
  TEX.wsWall = toTex(c, { clampV: true });
  TEX.wsWallN = toTex(normalCanvas(n2, W, H, 1.6), { srgb: false, clampV: true });
}

function genCeiling() {
  const S = 512, c = makeCanvas(S), x = ctx2d(c), R = seeded(51);
  const n = tileNoise(S, S, 4, 5, 21);
  fillField(x, S, S, (i) => { const v = 120 + (n[i] - 0.5) * 50; return [v, v - 2, v - 8]; });
  x.filter = 'blur(2px)';
  for (let i = 0; i < 4; i++) { const px = R() * S, py = R() * S, r = 30 + R() * 110; wrapDraw(S, S, px, py, r, (X, Y) => { x.strokeStyle = 'rgba(110,84,40,.14)'; x.lineWidth = 2; x.beginPath(); x.ellipse(X, Y, r, r * (0.6 + R() * 0.4), R() * 3, 0, TAU); x.stroke(); blob(x, X, Y, r, 'rgba(120,92,50,A)', 0.14); }); }
  x.filter = 'none';
  TEX.ceiling = toTex(c);
}

function genTiles() {
  // Wall tiles: 15 cm glazed squares, texture spans 1.2 m.
  const S = 512, c = makeCanvas(S), x = ctx2d(c), R = seeded(61), T = 64;
  x.fillStyle = '#6f6a60'; x.fillRect(0, 0, S, S);
  const rc = makeCanvas(S), rx = ctx2d(rc); rx.fillStyle = '#e6e6e6'; rx.fillRect(0, 0, S, S);
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
    const v = 214 + (R() - 0.5) * 18, px = tx * T + 2, py = ty * T + 2;
    const g = x.createLinearGradient(px, py, px + T, py + T);
    g.addColorStop(0, `rgb(${v + 6},${v + 6},${v - 4})`); g.addColorStop(1, `rgb(${v - 10},${v - 10},${v - 18})`);
    x.fillStyle = g; x.fillRect(px, py, T - 4, T - 4);
    rx.fillStyle = '#404040'; rx.fillRect(px, py, T - 4, T - 4);
    if (R() < 0.07) { crackPath(x, R, px + R() * T, py + R() * T, 8, 1, 'rgba(40,36,30,.8)', 1); }
    if (R() < 0.025) { x.fillStyle = '#4b463d'; x.fillRect(px, py, T - 4, T - 4); rx.fillStyle = '#f0f0f0'; rx.fillRect(px, py, T - 4, T - 4); }
  }
  for (let i = 0; i < 20; i++) { const px = R() * S, py = R() * S, r = 20 + R() * 80; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(96,78,50,A)', 0.2)); }
  TEX.tileWall = toTex(c); TEX.tileWallR = toTex(rc, { srgb: false });
  // Floor mosaic: 2.5 cm tiles, texture spans 1 m.
  const f = makeCanvas(S), fx = ctx2d(f), t = 12.8;
  fx.fillStyle = '#4a4740'; fx.fillRect(0, 0, S, S);
  for (let ty = 0; ty < 40; ty++) for (let tx = 0; tx < 40; tx++) {
    const k = R(); const v = k < 0.12 ? 150 : 196 + (R() - 0.5) * 20;
    fx.fillStyle = k < 0.12 ? `rgb(${v - 30},${v - 20},${v - 10})` : `rgb(${v},${v - 2},${v - 10})`;
    fx.fillRect(tx * t + 1, ty * t + 1, t - 2, t - 2);
  }
  for (let i = 0; i < 30; i++) { const px = R() * S, py = R() * S, r = 20 + R() * 90; wrapDraw(S, S, px, py, r, (X, Y) => blob(fx, X, Y, r, 'rgba(60,48,30,A)', 0.25)); }
  TEX.mosaic = toTex(f);
}

function genPaintedMetal(name, base, seed, opts = {}) {
  const S = 512, c = makeCanvas(S), x = ctx2d(c), R = seeded(seed);
  const n = tileNoise(S, S, 4, 5, seed), n2 = tileNoise(S, S, 24, 2, seed + 1);
  fillField(x, S, S, (i) => { const g = (n[i] - 0.5) * 36 + (n2[i] - 0.5) * 8; return [base[0] + g, base[1] + g, base[2] + g]; });
  for (let i = 0; i < 24; i++) { const px = R() * S, py = R() * S, r = 20 + R() * 120; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(20,18,14,A)', 0.2 + R() * 0.2)); }
  // Scratches to bare metal.
  for (let i = 0; i < (opts.scratches || 90); i++) {
    const px = R() * S, py = R() * S, a = R() * TAU, l = 6 + R() * 50;
    x.strokeStyle = `rgba(${170 + R() * 40},${170 + R() * 40},${165 + R() * 30},${0.3 + R() * 0.4})`; x.lineWidth = 0.6 + R();
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  // Rust blooms.
  for (let i = 0; i < (opts.rust || 14); i++) { const px = R() * S, py = R() * S, r = 3 + R() * 18; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(110,52,22,A)', 0.55)); }
  TEX[name] = toTex(c);
  TEX[name + 'N'] = toTex(normalCanvas(n2.map((v, i) => v * 0.3 + n[i] * 0.2), S, S, 1.5), { srgb: false });
}

function genWood() {
  const S = 512, c = makeCanvas(S), x = ctx2d(c), R = seeded(71);
  const n = tileNoise(S, S, 2, 4, 33);
  fillField(x, S, S, (i, px, py) => {
    const w = Math.sin((px * 0.09 + n[i] * 14) + Math.sin(py * 0.01) * 2) * 0.5 + 0.5;
    const v = 62 + w * 22 + (n[i] - 0.5) * 26;
    return [v * 1.05, v * 0.8, v * 0.62];
  });
  for (let i = 0; i < 5; i++) { x.fillStyle = 'rgba(20,10,5,.5)'; x.fillRect(((i + 1) * S / 5) | 0, 0, 2, S); }
  for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(230,200,160,${0.08 + R() * 0.12})`; const px = R() * S, py = R() * S; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 60, py + (R() - 0.5) * 10); x.stroke(); }
  TEX.wood = toTex(c);
  TEX.woodN = toTex(normalCanvas(n, S, S, 2), { srgb: false });
}

function genFabric() {
  const S = 256, c = makeCanvas(S), x = ctx2d(c), R = seeded(81);
  const n = tileNoise(S, S, 4, 4, 41);
  const hf = new Float32Array(S * S);
  // Soft twill: a smooth diagonal ridge instead of a hard pixel checker (no moire up close).
  fillField(x, S, S, (i, px, py) => {
    const weave = 0.5 + 0.5 * Math.sin((px + py) * TAU / 6);
    hf[i] = weave * 0.35 + n[i] * 0.65;
    const f = (n[i] - 0.5) * 34 + weave * 4;
    return [56 + f, 72 + f, 92 + f];
  });
  for (let i = 0; i < 14; i++) { const px = R() * S, py = R() * S, r = 10 + R() * 50; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(30,26,20,A)', 0.25)); }
  for (let i = 0; i < 10; i++) { const px = R() * S, py = R() * S, r = 8 + R() * 30; wrapDraw(S, S, px, py, r, (X, Y) => blob(x, X, Y, r, 'rgba(150,160,170,A)', 0.12)); }
  CANVAS.fabric = c;
  TEX.fabric = toTex(c);
  TEX.fabricN = toTex(normalCanvas(hf, S, S, 2.5), { srgb: false });
}

// Porcelain face. Planar-projected onto the head sphere (u,v = 0.5 at the face centre).
function genFace() {
  const S = 256, c = makeCanvas(S), x = ctx2d(c);
  const g = x.createRadialGradient(S * 0.5, S * 0.46, 10, S * 0.5, S * 0.5, S * 0.62);
  g.addColorStop(0, '#f4f1ea'); g.addColorStop(0.7, '#e9e4d8'); g.addColorStop(1, '#cfc8b8');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // Cheeks.
  blob(x, S * 0.33, S * 0.64, 22, 'rgba(210,120,110,A)', 0.28);
  blob(x, S * 0.67, S * 0.64, 22, 'rgba(210,120,110,A)', 0.28);
  // Brows.
  x.strokeStyle = 'rgba(30,26,24,.85)'; x.lineWidth = 2.2; x.lineCap = 'round';
  x.beginPath(); x.moveTo(S * 0.26, S * 0.37); x.quadraticCurveTo(S * 0.34, S * 0.33, S * 0.43, S * 0.37); x.stroke();
  x.beginPath(); x.moveTo(S * 0.57, S * 0.37); x.quadraticCurveTo(S * 0.66, S * 0.33, S * 0.74, S * 0.37); x.stroke();
  // Closed eyes: serene downward arcs.
  x.lineWidth = 2.6;
  x.beginPath(); x.moveTo(S * 0.28, S * 0.45); x.quadraticCurveTo(S * 0.35, S * 0.50, S * 0.42, S * 0.45); x.stroke();
  x.beginPath(); x.moveTo(S * 0.58, S * 0.45); x.quadraticCurveTo(S * 0.65, S * 0.50, S * 0.72, S * 0.45); x.stroke();
  // Small painted mouth.
  x.fillStyle = '#9c2a26';
  x.beginPath(); x.moveTo(S * 0.44, S * 0.72); x.quadraticCurveTo(S * 0.5, S * 0.69, S * 0.56, S * 0.72); x.quadraticCurveTo(S * 0.5, S * 0.77, S * 0.44, S * 0.72); x.fill();
  CANVAS.face = c;
}

// ------------------------------------------------------------------ documents
function wrapText(x, text, maxW) {
  const lines = []; let line = '';
  for (const ch of text) { if (ch === '\n') { lines.push(line); line = ''; continue; } const t = line + ch; if (x.measureText(t).width > maxW && line) { lines.push(line); line = ch; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
function paperBase(x, w, h, seed, tone = [222, 214, 192]) {
  const R = seeded(seed), n = tileNoise(w, h, 4, 4, seed);
  fillField(x, w, h, (i, px, py) => { const e = Math.min(px, py, w - px, h - py) / Math.min(w, h); const age = Math.max(0, 0.12 - e) * 180; const g = (n[i] - 0.5) * 18; return [tone[0] + g - age, tone[1] + g - age * 1.1, tone[2] + g - age * 1.5]; });
  for (let i = 0; i < 10; i++) { const px = R() * w, py = R() * h, r = 20 + R() * 70; blob(x, px, py, r, 'rgba(150,120,70,A)', 0.12); }
}
function stamp(x, cx, cy, r, text, rot = -0.25) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.globalAlpha = 0.75;
  x.strokeStyle = '#a3302a'; x.fillStyle = '#a3302a'; x.lineWidth = r * 0.06;
  x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke();
  x.font = `900 ${r * 0.34}px "Noto Serif SC", serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('★', 0, -r * 0.45);
  text.split('\n').forEach((t, i, arr) => x.fillText(t, 0, r * 0.12 + (i - (arr.length - 1) / 2) * r * 0.38));
  x.restore();
}

const RULES = [
  '夜班自零时开始，至考勤钟敲响六下结束。考勤钟不会敲响六下。',
  '车间广播只播放厂歌。若旋律走调，立即关闭一切照明，停止作业，不要奔跑，直到厂歌恢复。',
  '仍在工位上的工友不需要你的帮助。不要让他们看见你的脸。',
  '倒下的工友只是在休息。确认其面部完全破碎之前，不要从其身边经过。',
  '若在无人的地方听见有人哼唱厂歌，说明有工友正在向你走来。',
  '考勤钟只在报时的时候看你。',
];

function genRulesPoster() {
  const W = 600, H = 860, c = makeCanvas(W, H), x = ctx2d(c);
  paperBase(x, W, H, 91);
  x.fillStyle = '#a3302a'; x.textAlign = 'center';
  x.font = '900 58px "Noto Serif SC", serif'; x.fillText('夜 班 守 则', W / 2, 110);
  x.fillStyle = '#3b332a'; x.font = '600 20px "Noto Serif SC", serif'; x.fillText('星火机械厂 三号车间 · 一九八三年十一月修订', W / 2, 152);
  x.fillStyle = '#a3302a'; x.fillRect(60, 172, W - 120, 3);
  x.textAlign = 'left'; x.fillStyle = '#26211b'; x.font = '500 24px "Noto Serif SC", serif';
  let y = 222;
  RULES.forEach((r, i) => {
    const lines = wrapText(x, r, W - 150);
    x.fillText(['一', '二', '三', '四', '五', '六'][i] + '、', 58, y);
    lines.forEach((l) => { x.fillText(l, 104, y); y += 36; });
    y += 12;
  });
  x.font = '500 18px "Noto Serif SC", serif'; x.fillStyle = '#4a4036'; x.textAlign = 'right';
  x.fillText('厂保卫科  三车间工段', W - 60, H - 62);
  stamp(x, W - 150, H - 120, 62, '星火机械厂\n保卫科');
  // Tape.
  x.fillStyle = 'rgba(230,220,180,.55)';
  [[20, 16, -0.4], [W - 90, 16, 0.4]].forEach(([tx, ty, a]) => { x.save(); x.translate(tx + 35, ty + 10); x.rotate(a); x.fillRect(-40, -12, 80, 24); x.restore(); });
  TEX.rulesPoster = toTex(c, { repeat: false });
}

function genSafetyPoster() {
  const W = 400, H = 560, c = makeCanvas(W, H), x = ctx2d(c);
  paperBase(x, W, H, 93, [226, 216, 186]);
  x.fillStyle = '#b8322a'; x.fillRect(0, 0, W, 120);
  x.fillStyle = '#f2e6c8'; x.textAlign = 'center'; x.font = '900 64px "Noto Serif SC", serif'; x.fillText('安全生产', W / 2, 86);
  x.strokeStyle = '#2a241e'; x.lineWidth = 6;
  x.beginPath(); x.arc(W / 2, 290, 110, 0, TAU); x.stroke();
  x.fillStyle = '#2a241e'; x.beginPath(); x.moveTo(W / 2, 200); x.lineTo(W / 2 + 70, 330); x.lineTo(W / 2 - 70, 330); x.closePath(); x.fill();
  x.fillStyle = '#e8c33c'; x.font = '900 90px "Noto Sans SC", sans-serif'; x.fillText('!', W / 2, 322);
  x.fillStyle = '#2a241e'; x.font = '700 34px "Noto Serif SC", serif'; x.fillText('人人有责', W / 2, 460);
  x.font = '500 18px "Noto Serif SC", serif'; x.fillText('星火机械厂安全科 宣', W / 2, 510);
  TEX.safetyPoster = toTex(c, { repeat: false });
}

function genSlogan(key, text, opts = {}) {
  const W = 1024, H = 180, c = makeCanvas(W, H), x = ctx2d(c), R = seeded(text.length * 131 + 7);
  x.font = `900 ${opts.size || 130}px "Noto Serif SC", serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = opts.color || '#9e2d24';
  x.fillText(text, W / 2, H / 2 + 4, W - 40);
  // Weather it: punch holes into the paint.
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { x.globalAlpha = R() * 0.9; x.fillRect(R() * W, R() * H, 1 + R() * 4, 1 + R() * 3); }
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  if (opts.drips) {
    const d = x.getImageData(0, 0, W, H).data;
    x.fillStyle = opts.color || '#9e2d24';
    for (let i = 0; i < 70; i++) {
      const px = (R() * W) | 0; let py = H - 1;
      for (; py > 0; py--) if (d[(py * W + px) * 4 + 3] > 120) break;
      if (py <= 0) continue;
      const len = 10 + R() * 60; x.fillRect(px, py, 2 + R() * 3, len); x.beginPath(); x.arc(px + 2, py + len, 3, 0, TAU); x.fill();
    }
  }
  TEX[key] = toTex(c, { repeat: false });
}

function genLogSheet() {
  const W = 400, H = 520, c = makeCanvas(W, H), x = ctx2d(c);
  paperBase(x, W, H, 97, [214, 208, 186]);
  x.strokeStyle = 'rgba(80,110,160,.35)';
  for (let y = 70; y < H - 20; y += 26) { x.beginPath(); x.moveTo(20, y); x.lineTo(W - 20, y); x.stroke(); }
  x.fillStyle = '#2a2520'; x.font = '900 28px "Noto Serif SC", serif'; x.textAlign = 'center'; x.fillText('保卫科值班记录', W / 2, 50);
  x.textAlign = 'left'; x.fillStyle = '#23385e'; x.font = 'italic 17px "Noto Sans SC", sans-serif';
  ['十一月六日 夜 无异常', '十一月七日 零时 车间广播响', '放的不是厂歌', '老周说是巡夜的来了', '关灯 别动 别开枪', '我数到了一百四十下'].forEach((t, i) => x.fillText(t, 30, 92 + i * 26));
  TEX.logSheet = toTex(c, { repeat: false });
}

function genPunchCard() {
  const W = 256, H = 128, c = makeCanvas(W, H), x = ctx2d(c);
  paperBase(x, W, H, 99, [224, 212, 170]);
  x.fillStyle = '#7a2a22'; x.font = '700 18px "Noto Serif SC", serif'; x.fillText('考勤卡', 12, 26);
  x.strokeStyle = 'rgba(122,42,34,.6)'; for (let y = 38; y < H; y += 14) { x.beginPath(); x.moveTo(8, y); x.lineTo(W - 8, y); x.stroke(); }
  x.fillStyle = '#333'; x.font = '12px "Barlow Condensed", sans-serif';
  for (let i = 0; i < 6; i++) x.fillText('00:00', 20, 50 + i * 14);
  TEX.punchCard = toTex(c, { repeat: false });
}

function genLabels() {
  const mk = (key, bg, lines, fg = '#1d1a16', W = 256, H = 128) => {
    const c = makeCanvas(W, H), x = ctx2d(c);
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const n = tileNoise(W, H, 4, 3, key.length * 5);
    const d = x.getImageData(0, 0, W, H); for (let i = 0; i < W * H; i++) { const g = (n[i] - 0.5) * 30; d.data[i * 4] += g; d.data[i * 4 + 1] += g; d.data[i * 4 + 2] += g; } x.putImageData(d, 0, 0);
    x.fillStyle = fg; x.textAlign = 'center';
    lines.forEach(([t, size, y, weight]) => { x.font = `${weight || 900} ${size}px "Noto Sans SC", sans-serif`; x.fillText(t, W / 2, y); });
    TEX[key] = toTex(c, { repeat: false });
  };
  mk('lblAmmo', '#8b6a43', [['7.62 手枪弹', 34, 56], ['五一式 · 八发', 22, 96, 500]]);
  mk('lblShell', '#5d6b48', [['12号 霰弹', 36, 58], ['猎用 · 六发', 22, 98, 500]], '#e7dcc0');
  mk('lblAid', '#e6e2d8', [['✚', 58, 70], ['急 救', 26, 112]], '#b3261e');
}

function genHazard() {
  const S = 128, c = makeCanvas(S), x = ctx2d(c);
  x.fillStyle = '#1b1a17'; x.fillRect(0, 0, S, S);
  x.fillStyle = '#c9a227';
  for (let i = -2; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64 + 32, 0); x.lineTo(i * 64 + 32 + S, S); x.lineTo(i * 64 + S, S); x.closePath(); x.fill(); }
  const R = seeded(5); x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(70,60,50,${R() * 0.5})`; x.fillRect(R() * S, R() * S, 2 + R() * 6, 1 + R() * 3); }
  x.globalCompositeOperation = 'source-over';
  TEX.hazard = toTex(c);
}

function genWindow() {
  const W = 256, H = 256, c = makeCanvas(W, H), x = ctx2d(c), R = seeded(101);
  x.fillStyle = '#0b0d10'; x.fillRect(0, 0, W, H);
  const cols = 4, rows = 5;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const px = 8 + q * (W - 16) / cols, py = 8 + r * (H - 16) / rows, w = (W - 16) / cols - 8, h = (H - 16) / rows - 8;
    const broken = R() < 0.12, lum = broken ? 0.9 : 0.25 + R() * 0.25;
    const g = x.createLinearGradient(px, py, px + w, py + h);
    g.addColorStop(0, `rgba(${60 * lum},${80 * lum},${120 * lum},1)`); g.addColorStop(1, `rgba(${30 * lum},${40 * lum},${70 * lum},1)`);
    x.fillStyle = g; x.fillRect(px, py, w, h);
    if (broken) { x.fillStyle = '#0b0d10'; x.beginPath(); x.moveTo(px, py + h); x.lineTo(px + w * R(), py + h * R()); x.lineTo(px + w, py + h); x.fill(); }
  }
  TEX.window = toTex(c, { repeat: false });
}

// ------------------------------------------------------------------ decals & particles
function genDecals() {
  const mk = (key, S, fn) => { const c = makeCanvas(S), x = ctx2d(c); fn(x, S); TEX[key] = toTex(c, { repeat: false }); };
  mk('holeConcrete', 64, (x, S) => {
    const R = seeded(3);
    x.fillStyle = 'rgba(170,165,150,.55)'; x.beginPath();
    for (let j = 0; j < 12; j++) { const a = j / 12 * TAU, r = 12 + R() * 9; j ? x.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r) : x.moveTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); }
    x.fill();
    blob(x, S / 2, S / 2, 13, 'rgba(10,9,8,A)', 0.95);
    x.fillStyle = '#050404'; x.beginPath(); x.arc(S / 2, S / 2, 4.5, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(20,18,15,.6)'; x.lineWidth = 1;
    for (let j = 0; j < 5; j++) { const a = R() * TAU; x.beginPath(); x.moveTo(S / 2, S / 2); x.lineTo(S / 2 + Math.cos(a) * (14 + R() * 14), S / 2 + Math.sin(a) * (14 + R() * 14)); x.stroke(); }
  });
  mk('holeMetal', 64, (x, S) => {
    blob(x, S / 2, S / 2, 14, 'rgba(210,205,190,A)', 0.8);
    blob(x, S / 2, S / 2, 8, 'rgba(20,20,20,A)', 1);
    x.fillStyle = '#060606'; x.beginPath(); x.arc(S / 2, S / 2, 3.5, 0, TAU); x.fill();
  });
  mk('holeWood', 64, (x, S) => {
    const R = seeded(9); x.strokeStyle = 'rgba(200,160,110,.8)'; x.lineWidth = 2;
    for (let j = 0; j < 9; j++) { const a = R() * TAU; x.beginPath(); x.moveTo(S / 2, S / 2); x.lineTo(S / 2 + Math.cos(a) * (8 + R() * 12), S / 2 + Math.sin(a) * (8 + R() * 12)); x.stroke(); }
    blob(x, S / 2, S / 2, 10, 'rgba(15,8,4,A)', 1);
  });
  for (let k = 0; k < 3; k++) {
    mk('blood' + k, 128, (x, S) => {
      const R = seeded(200 + k * 17);
      x.fillStyle = 'rgba(38,6,5,.95)';
      const main = 14 + R() * 12;
      x.beginPath(); for (let j = 0; j < 16; j++) { const a = j / 16 * TAU, r = main * (0.6 + R() * 0.7); j ? x.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r) : x.moveTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } x.fill();
      for (let j = 0; j < 40; j++) {
        const a = (k === 2 ? -0.3 + R() * 0.6 : R() * TAU), d = main + Math.pow(R(), 0.7) * (S / 2 - main - 4), r = 1 + R() * 4 * (1 - d / S);
        x.beginPath(); x.ellipse(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, r * (k === 2 ? 2.4 : 1), r, a, 0, TAU); x.fill();
      }
      x.fillStyle = 'rgba(90,20,14,.35)'; x.beginPath(); x.arc(S / 2 - 4, S / 2 - 4, main * 0.5, 0, TAU); x.fill();
    });
  }
  mk('glassCrack', 128, (x, S) => {
    const R = seeded(44); x.strokeStyle = 'rgba(235,240,245,.85)'; x.lineWidth = 1.2;
    for (let j = 0; j < 9; j++) { let px = S / 2, py = S / 2, a = j / 9 * TAU + R() * 0.4; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 8; s++) { a += (R() - 0.5) * 0.4; px += Math.cos(a) * 7; py += Math.sin(a) * 7; x.lineTo(px, py); } x.stroke(); }
    x.beginPath(); x.arc(S / 2, S / 2, 14, 0, TAU); x.stroke(); x.beginPath(); x.arc(S / 2, S / 2, 30, 0.4, 2.2); x.stroke();
    blob(x, S / 2, S / 2, 8, 'rgba(255,255,255,A)', 0.8);
  });
  mk('pool', 128, (x, S) => {
    const R = seeded(77); x.fillStyle = 'rgba(30,5,4,.92)';
    x.beginPath(); for (let j = 0; j < 24; j++) { const a = j / 24 * TAU, r = S * 0.34 * (0.75 + R() * 0.3); j ? x.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r) : x.moveTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r); } x.fill();
  });
  // Soft particle sprites.
  mk('softDot', 64, (x, S) => blob(x, S / 2, S / 2, S / 2, 'rgba(255,255,255,A)', 1));
  mk('smoke', 128, (x, S) => {
    const R = seeded(55);
    for (let i = 0; i < 26; i++) { const a = R() * TAU, d = R() * S * 0.22; blob(x, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.14 + R() * 0.16), 'rgba(255,255,255,A)', 0.18); }
  });
  mk('muzzle', 256, (x, S) => {
    const cx = S / 2, cy = S / 2, R = seeded(66);
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + R() * 0.3, len = S * (0.28 + R() * 0.2), wd = S * 0.05;
      const g = x.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,170,70,.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      x.fillStyle = g; x.beginPath(); x.moveTo(cx + Math.cos(a + 1.57) * wd, cy + Math.sin(a + 1.57) * wd); x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); x.lineTo(cx + Math.cos(a - 1.57) * wd, cy + Math.sin(a - 1.57) * wd); x.fill();
    }
    blob(x, cx, cy, S * 0.2, 'rgba(255,230,180,A)', 1);
    blob(x, cx, cy, S * 0.45, 'rgba(255,140,40,A)', 0.35);
  });
  // Flashlight cookie (linear): moderate hotspot, reflector ring, wide soft spill.
  {
    const S = 256, c = makeCanvas(S), x = ctx2d(c), h = S / 2, n = tileNoise(S, S, 8, 3, 3);
    fillField(x, S, S, (i, px, py) => {
      const r = Math.hypot(px - h, py - h) / h;
      let v = Math.exp(-r * r * 11) * 0.55 + Math.exp(-Math.pow((r - 0.3) / 0.06, 2)) * 0.08 + 0.45 * Math.pow(clamp01(1 - r), 1.6);
      v *= 0.93 + n[i] * 0.14;
      const b = clamp(v, 0, 1) * 255;
      return [b, b * 0.97, b * 0.92];
    });
    TEX.cookie = toTex(c, { repeat: false, srgb: false });
  }
}

function genClockFace() {
  const S = 512, c = makeCanvas(S), x = ctx2d(c), cx = S / 2;
  const g = x.createRadialGradient(cx, cx, 20, cx, cx, cx); g.addColorStop(0, '#eee6cf'); g.addColorStop(0.85, '#d8cdb0'); g.addColorStop(1, '#8c7d60');
  x.fillStyle = '#2a1a10'; x.fillRect(0, 0, S, S);
  x.fillStyle = g; x.beginPath(); x.arc(cx, cx, cx - 6, 0, TAU); x.fill();
  x.strokeStyle = '#2a241c'; x.fillStyle = '#2a241c';
  for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, r0 = cx - (i % 5 ? 30 : 44), r1 = cx - 22; x.lineWidth = i % 5 ? 2 : 6; x.beginPath(); x.moveTo(cx + Math.sin(a) * r0, cx - Math.cos(a) * r0); x.lineTo(cx + Math.sin(a) * r1, cx - Math.cos(a) * r1); x.stroke(); }
  x.font = '600 50px "Noto Serif SC", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU, r = cx - 86; x.fillText(String(i), cx + Math.sin(a) * r, cx - Math.cos(a) * r + 2); }
  x.fillStyle = '#a3302a'; x.font = '900 34px "Noto Serif SC", serif'; x.fillText('星 火', cx, cx - 72);
  x.fillStyle = '#3a3128'; x.font = '500 20px "Noto Serif SC", serif'; x.fillText('考 勤 钟', cx, cx + 80);
  const R = seeded(8); for (let i = 0; i < 3; i++) crackPath(x, R, cx + (R() - 0.5) * 200, cx + (R() - 0.5) * 200, 20, 1, 'rgba(40,30,20,.5)');
  TEX.clockFace = toTex(c, { repeat: false });
}

function genEye() {
  const S = 256, c = makeCanvas(S), x = ctx2d(c), R = seeded(13);
  x.fillStyle = '#e8dccb'; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(150,20,20,.6)';
  for (let i = 0; i < 40; i++) { let px = R() * S, py = R() < 0.5 ? 0 : S; x.lineWidth = 0.6 + R(); x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 12; s++) { px += (R() - 0.5) * 24; py += (py < S / 2 ? 1 : -1) * 9; x.lineTo(px, py); } x.stroke(); }
  // Iris sits at u=0.25 (the sphere's +Z) — drawn at x = S*0.25.
  const ix = S * 0.25, iy = S * 0.5, ir = S * 0.16;
  const g = x.createRadialGradient(ix, iy, 2, ix, iy, ir); g.addColorStop(0, '#2a0a02'); g.addColorStop(0.35, '#a0521a'); g.addColorStop(0.8, '#6b2a0a'); g.addColorStop(1, '#1a0602');
  x.fillStyle = g; x.beginPath(); x.ellipse(ix, iy, ir, ir * 1.3, 0, 0, TAU); x.fill();
  x.strokeStyle = 'rgba(255,190,90,.35)'; for (let i = 0; i < 50; i++) { const a = R() * TAU; x.lineWidth = 1; x.beginPath(); x.moveTo(ix + Math.cos(a) * ir * 0.35, iy + Math.sin(a) * ir * 0.45); x.lineTo(ix + Math.cos(a) * ir * 0.9, iy + Math.sin(a) * ir * 1.15); x.stroke(); }
  x.fillStyle = '#050201'; x.beginPath(); x.ellipse(ix, iy, ir * 0.22, ir * 0.75, 0, 0, TAU); x.fill();
  TEX.eye = toTex(c, { repeat: false });
}

function genGunTextures() {
  const S = 256, c = makeCanvas(S), x = ctx2d(c), n = tileNoise(S, S, 8, 4, 91);
  fillField(x, S, S, (i) => { const g = (n[i] - 0.5) * 16; return [70 + g, 72 + g, 77 + g]; });
  const R = seeded(92); for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(160,165,170,${0.08 + R() * 0.2})`; x.lineWidth = 0.7; const px = R() * S, py = R() * S; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 30, py + (R() - 0.5) * 4); x.stroke(); }
  TEX.gunMetal = toTex(c);
  const b = makeCanvas(128), bx = ctx2d(b);
  bx.fillStyle = '#3a2317'; bx.fillRect(0, 0, 128, 128);
  bx.strokeStyle = 'rgba(0,0,0,.4)'; bx.lineWidth = 1;
  for (let i = -128; i < 256; i += 6) { bx.beginPath(); bx.moveTo(i, 0); bx.lineTo(i + 128, 128); bx.stroke(); bx.beginPath(); bx.moveTo(i + 128, 0); bx.lineTo(i, 128); bx.stroke(); }
  bx.fillStyle = '#2a170e'; bx.beginPath(); bx.arc(64, 44, 22, 0, TAU); bx.fill();
  bx.fillStyle = '#5a3a26'; bx.font = '900 30px serif'; bx.textAlign = 'center'; bx.textBaseline = 'middle'; bx.fillText('★', 64, 45);
  TEX.bakelite = toTex(b);
  const gl = makeCanvas(128), gx = ctx2d(gl), gn = tileNoise(128, 128, 8, 4, 95);
  fillField(gx, 128, 128, (i) => { const g = (gn[i] - 0.5) * 20; return [92 + g, 76 + g, 64 + g]; });
  TEX.glove = toTex(gl);
  TEX.gloveN = toTex(normalCanvas(gn, 128, 128, 3), { srgb: false });
}

async function generateTextures(progress) {
  const chars = RULES.join('') + '夜班守则星火机械厂三号车间一九八三年十一月修订厂保卫科工段安全生产人人有责宣质量是企业的生命准时上班永不下班预防为主第值记录六日夜无异常七零时广播响放不是歌老周说巡的来了关灯别动开枪我数到一百四十下考勤卡手弹五式八发号霰猎用急救钟外专';
  try {
    await Promise.race([
      Promise.all(['900 48px "Noto Serif SC"', '600 24px "Noto Serif SC"', '500 24px "Noto Serif SC"', '700 24px "Noto Sans SC"', '900 24px "Noto Sans SC"', '500 24px "Noto Sans SC"', 'italic 17px "Noto Sans SC"', '600 16px "Barlow Condensed"'].map((f) => document.fonts.load(f, chars))),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch (e) { /* fall back to system fonts */ }
  const steps = [genTerrazzo, genConcrete, genDadoWall, genWorkshopWall, genCeiling, genTiles,
    () => genPaintedMetal('machineGreen', [118, 146, 126], 301), () => genPaintedMetal('lockerGrey', [96, 108, 106], 302, { rust: 6 }),
    () => genPaintedMetal('steelDark', [52, 54, 56], 303, { scratches: 160, rust: 30 }), () => genPaintedMetal('paintRed', [120, 38, 30], 304, { rust: 20 }),
    genWood, genFabric, genFace, genRulesPoster, genSafetyPoster, genLogSheet, genPunchCard, genLabels, genHazard, genWindow, genDecals, genClockFace, genEye, genGunTextures,
    () => { genSlogan('slogan1', '安全第一  预防为主'); genSlogan('slogan2', '质量是企业的生命'); genSlogan('slogan3', '准时上班  永不下班', { drips: true, color: '#8a1f18' }); }];
  for (let i = 0; i < steps.length; i++) {
    steps[i]();
    progress && progress((i + 1) / steps.length);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
}
