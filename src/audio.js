'use strict';
// Web Audio synthesis: layered weapon sounds, positional enemy cues, reverb zones, the factory PA.

const SONG = [
  // [midi, beats]; 0 = rest. Original march in C major pentatonic, 32 beats.
  [67, 1], [67, 0.5], [69, 0.5], [67, 1], [64, 1], [62, 1], [60, 1], [62, 1], [0, 1],
  [64, 1], [67, 1], [69, 0.5], [72, 0.5], [69, 1], [67, 3], [0, 1],
  [72, 1], [72, 0.5], [74, 0.5], [72, 1], [69, 1], [67, 1], [69, 0.5], [67, 0.5], [64, 2],
  [62, 1], [64, 1], [67, 1], [64, 0.5], [62, 0.5], [60, 3], [0, 1],
];
const SONG_BASS = [48, 43, 48, 48, 41, 48, 43, 48]; // chord root per bar
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const WRONG = (m) => { if (!m) return 0; const pc = m % 12; if (pc === 4 || pc === 9) m -= 1; return m - 3; };

class AudioEngine {
  constructor() { this.ctx = null; this.ready = false; this.lpos = new V3(); this.zoneWet = { small: 0.3, mid: 0, hall: 0 }; this.hum = []; this.loops = []; this.timers = []; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.4;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 10; this.comp.ratio.value = 5; this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
    this.master.connect(this.muffle); this.muffle.connect(this.comp); this.comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 1; this.amb.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.9; this.music.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.7; this.ui.connect(this.comp);
    // Shared noise.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // Soft clipper shared by the guns.
    this.clip = (amount) => { const ws = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); } ws.curve = c; ws.oversample = '2x'; return ws; };
    // Reverbs: small room, corridor, hall.
    this.revIn = ctx.createGain();
    this.revs = {};
    for (const [name, dur, decay, bright] of [['small', 0.9, 3.2, 0.55], ['mid', 1.7, 2.6, 0.45], ['hall', 3.6, 2.2, 0.35]]) {
      const cv = ctx.createConvolver(); cv.buffer = this.makeIR(dur, decay, bright);
      const out = ctx.createGain(); out.gain.value = 0;
      this.revIn.connect(cv); cv.connect(out); out.connect(this.master);
      this.revs[name] = out;
    }
    this.ready = true;
    this.startAmbience();
    this.startSongScheduler();
    for (let i = 0; i < 6; i++) this.hum.push(this.makeHumVoice());
  }
  makeIR(dur, decay, bright) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * dur), buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate, k = bright * (1 - 0.8 * t / dur);
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.pow(1 - t / dur, decay) * (t < 0.004 ? t / 0.004 : 1);
      }
      for (let r = 0; r < 6; r++) { const i = Math.floor(rate * (0.008 + Math.random() * 0.05)); if (i < len) d[i] += (Math.random() - 0.5) * 0.9; }
    }
    return buf;
  }

  // ------------------------------------------------------------------ primitives
  get now() { return this.ctx.currentTime; }
  // One-shots are skipped while suspended, so nothing queues up and bursts out on resume.
  get ok() { return this.ready && this.ctx.state === 'running'; }
  env(p, t, a, d, peak) { p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(Math.max(peak, 0.0002), t + a); p.exponentialRampToValueAtTime(0.0001, t + a + d); }
  noiseSrc(t, dur, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = rate; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05); return s; }
  burst(dest, t, o) {
    const a = o.a ?? 0.002, src = this.noiseSrc(t, a + o.d, o.rate || 1);
    let node = src;
    if (o.type) {
      const f = this.ctx.createBiquadFilter(); f.type = o.type; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q ?? 0.7;
      if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + o.d);
      src.connect(f); node = f;
    }
    const g = this.ctx.createGain(); this.env(g.gain, t, a, o.d, o.g); node.connect(g); g.connect(dest);
    return g;
  }
  tone(dest, t, o) {
    const a = o.a ?? 0.002, osc = this.ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t); if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.slide || a + o.d));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.ctx.createGain(); this.env(g.gain, t, a, o.d, o.g); osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + a + o.d + 0.05);
    return osc;
  }
  // Positional destination with occlusion and reverb send.
  at(pos, o = {}) {
    const ctx = this.ctx, p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 1.6; p.rolloffFactor = o.roll || 1.1; p.maxDistance = 80;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    let input = p;
    if (o.occlude !== false && G.level && !G.level.los(this.lpos, pos, false)) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.occF || 650;
      const g = ctx.createGain(); g.gain.value = 0.55; f.connect(g); g.connect(p); input = f;
    }
    p.connect(this.sfx);
    const send = ctx.createGain(); send.gain.value = o.wet ?? 0.4; p.connect(send); send.connect(this.revIn);
    return input;
  }
  // Non-positional destination (the player's own sounds).
  local(wet = 0.5, gain = 1) {
    const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.sfx);
    const s = this.ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.revIn);
    return g;
  }
  duck(amount, time) {
    if (!this.ok) return;
    const t = this.now, g = this.amb.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1 - amount, t + 0.01); g.linearRampToValueAtTime(1, t + time);
  }

  // ------------------------------------------------------------------ frame update
  // Set an AudioParam only when the value really changes. Scheduling every frame piles up
  // automation events, and while the context is suspended they are never pruned.
  glide(param, v, tc = 0.1, eps = 0.002) {
    if (param._last !== undefined && Math.abs(param._last - v) < eps) return;
    param._last = v;
    param.cancelScheduledValues(this.now);
    param.setTargetAtTime(v, this.now, tc);
  }
  update(dt, cam, roomId) {
    if (!this.ready || this.ctx.state !== 'running') { if (this.ready) this.lpos.copy(cam.position); return; }
    const L = this.ctx.listener;
    this.lpos.copy(cam.position);
    const f = _v1.set(0, 0, -1).applyQuaternion(cam.quaternion), u = _v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    // Reverb follows the room the player stands in.
    const zone = { locker: 'small', security: 'small', vestibule: 'small', store: 'small', washroom: 'small', corridor: 'mid', workshop: 'hall' }[roomId] || this.lastZone || 'small';
    this.lastZone = zone;
    const wet = { small: zone === 'small' ? (roomId === 'washroom' ? 0.75 : 0.45) : 0, mid: zone === 'mid' ? 0.6 : 0, hall: zone === 'hall' ? 0.8 : 0 };
    for (const k in this.revs) this.glide(this.revs[k].gain, wet[k], 0.25);
    if (this.ambHum) this.glide(this.ambHum.gain, roomId === 'workshop' ? 0.05 : 0.022, 0.5);
    // Ambient one-shots.
    this.nextClank = (this.nextClank ?? 6) - dt;
    if (this.nextClank <= 0) { this.nextClank = rand(7, 18); this.distantClank(); }
    this.updateHum(dt);
    for (const lp of this.loops) lp.update && lp.update(dt);
  }

  // ------------------------------------------------------------------ weapons
  pistolShot() {
    if (!this.ok) return;
    const t = this.now, out = this.local(0.9, 1), c = this.clip(2.2); c.connect(out);
    if (!TUNE.fx.audioLayers) { this.burst(out, t, { type: 'lowpass', f: 3000, d: 0.12, g: 0.7 }); return; }
    this.burst(c, t, { type: 'highpass', f: 1800, d: 0.035, g: 0.95, a: 0.0005 });
    this.burst(c, t, { type: 'bandpass', f: 1100, f2: 380, q: 0.8, d: 0.13, g: 1.1 });
    this.tone(c, t, { f: 150, f2: 42, d: 0.18, g: 1.15 });
    this.tone(out, t, { f: 58, d: 0.32, g: 0.45, a: 0.004 });
    this.burst(out, t + 0.018, { type: 'bandpass', f: 3600, q: 3, d: 0.018, g: 0.28 });
    this.burst(out, t + 0.05, { type: 'bandpass', f: 2800, q: 2, d: 0.02, g: 0.16 });
    this.duck(0.55, 0.5);
  }
  shotgunShot() {
    if (!this.ok) return;
    const t = this.now, out = this.local(1.0, 1), c = this.clip(3); c.connect(out);
    if (!TUNE.fx.audioLayers) { this.burst(out, t, { type: 'lowpass', f: 2500, d: 0.2, g: 0.9 }); return; }
    this.burst(c, t, { type: 'highpass', f: 1400, d: 0.05, g: 1.0, a: 0.0005 });
    this.burst(c, t, { type: 'bandpass', f: 700, f2: 220, q: 0.7, d: 0.25, g: 1.3 });
    this.tone(c, t, { f: 115, f2: 34, d: 0.32, g: 1.35 });
    this.tone(out, t, { f: 44, d: 0.55, g: 0.6, a: 0.006 });
    this.burst(out, t + 0.03, { type: 'lowpass', f: 900, d: 0.4, g: 0.25 });
    this.duck(0.75, 0.9);
    // Ringing ears in small rooms.
    if (this.lastZone !== 'hall') this.tinnitus(0.9);
  }
  tinnitus(strength) {
    const t = this.now, out = this.local(0, 1);
    this.tone(out, t + 0.05, { f: 3900 + rand(-200, 200), d: 1.8 * strength, g: 0.028 * strength, a: 0.06 });
    const m = this.muffle.frequency; m.cancelScheduledValues(t); m.setValueAtTime(1800, t + 0.02); m.exponentialRampToValueAtTime(20000, t + 1.4 * strength);
  }
  dryFire() { if (!this.ok) return; const t = this.now, o = this.local(0.2, 0.9); this.burst(o, t, { type: 'highpass', f: 3200, d: 0.012, g: 0.6 }); this.tone(o, t, { f: 2300, d: 0.03, g: 0.08 }); }
  click(gain = 0.4, f = 3000) { if (!this.ok) return; const o = this.local(0.15); this.burst(o, this.now, { type: 'bandpass', f, q: 2.5, d: 0.015, g: gain }); }
  magOut() { if (!this.ok) return; const t = this.now, o = this.local(0.2); this.burst(o, t, { type: 'bandpass', f: 2500, q: 3, d: 0.02, g: 0.4 }); this.burst(o, t + 0.04, { type: 'bandpass', f: 900, q: 1.5, d: 0.06, g: 0.3 }); }
  magDrop(pos) { if (!this.ok) return; const t = this.now + 0.35, o = this.at(pos, { wet: 0.3 }); this.burst(o, t, { type: 'bandpass', f: 1300, q: 2, d: 0.07, g: 0.5 }); this.tone(o, t, { f: 1900, d: 0.08, g: 0.08 }); this.burst(o, t + 0.12, { type: 'bandpass', f: 1500, q: 2, d: 0.04, g: 0.2 }); }
  magIn() { if (!this.ok) return; const t = this.now, o = this.local(0.2); this.burst(o, t, { type: 'bandpass', f: 1800, q: 2, d: 0.03, g: 0.55 }); this.tone(o, t, { f: 180, f2: 90, d: 0.07, g: 0.35 }); this.burst(o, t + 0.012, { type: 'highpass', f: 4000, d: 0.01, g: 0.3 }); }
  slideRack() { if (!this.ok) return; const t = this.now, o = this.local(0.25); this.burst(o, t, { type: 'bandpass', f: 2200, q: 2, d: 0.05, g: 0.45 }); this.burst(o, t + 0.11, { type: 'bandpass', f: 3000, q: 2.5, d: 0.035, g: 0.6 }); this.tone(o, t + 0.11, { f: 220, f2: 120, d: 0.05, g: 0.25 }); }
  slideRelease() { if (!this.ok) return; const t = this.now, o = this.local(0.25); this.burst(o, t, { type: 'bandpass', f: 2800, q: 2, d: 0.04, g: 0.65 }); this.tone(o, t, { f: 260, f2: 140, d: 0.05, g: 0.3 }); }
  shellInsert() { if (!this.ok) return; const t = this.now, o = this.local(0.2); this.burst(o, t, { type: 'bandpass', f: 1500, q: 1.5, d: 0.035, g: 0.45 }); this.tone(o, t + 0.01, { f: 330, f2: 200, d: 0.04, g: 0.2 }); this.burst(o, t + 0.05, { type: 'bandpass', f: 3200, q: 3, d: 0.015, g: 0.3 }); }
  pump() { if (!this.ok) return; const t = this.now, o = this.local(0.35); this.burst(o, t, { type: 'bandpass', f: 1900, q: 2, d: 0.06, g: 0.55 }); this.tone(o, t, { f: 170, f2: 110, d: 0.07, g: 0.35 }); this.burst(o, t + 0.17, { type: 'bandpass', f: 2600, q: 2.5, d: 0.045, g: 0.7 }); this.tone(o, t + 0.17, { f: 240, f2: 150, d: 0.06, g: 0.3 }); }
  casing(pos, shell) {
    if (!this.ok || !TUNE.fx.shells) return;
    const o = this.at(pos, { wet: 0.25, ref: 1.2 });
    let t = this.now, g = shell ? 0.22 : 0.3;
    for (let b = 0; b < 3; b++) {
      if (shell) { this.burst(o, t, { type: 'bandpass', f: 900 + rand(0, 400), q: 3, d: 0.05, g: g * 1.2 }); this.tone(o, t, { f: 1700 + rand(0, 300), d: 0.05, g: g * 0.3 }); }
      else for (let k = 0; k < 3; k++) this.tone(o, t, { f: rand(3200, 6800), d: rand(0.05, 0.13), g: g * 0.35 });
      this.burst(o, t, { type: 'highpass', f: 4000, d: 0.006, g: g * 0.6 });
      t += rand(0.08, 0.14) * (1 - b * 0.25); g *= 0.45;
    }
  }
  // ------------------------------------------------------------------ impacts
  impact(pos, surf) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.45 });
    if (surf === 'metal') {
      this.burst(o, t, { type: 'bandpass', f: 3000, q: 1, d: 0.03, g: 0.5 });
      [2400, 3700, 5200].forEach((f) => this.tone(o, t, { f: f * rand(0.9, 1.1), d: rand(0.12, 0.3), g: 0.12 }));
      if (chance(0.25)) this.tone(o, t + 0.01, { f: 3400, f2: 1300, d: 0.28, g: 0.07, slide: 0.28 });
    } else if (surf === 'wood') {
      this.burst(o, t, { type: 'bandpass', f: 700, q: 1.5, d: 0.08, g: 0.7 }); this.tone(o, t, { f: 220, f2: 140, d: 0.06, g: 0.3 });
    } else if (surf === 'tile' || surf === 'glass') {
      this.burst(o, t, { type: 'highpass', f: 2400, d: 0.035, g: 0.6 }); this.tone(o, t, { f: 3100, d: 0.07, g: 0.12 }); this.tone(o, t, { f: 4700, d: 0.05, g: 0.08 });
      if (surf === 'glass') this.tone(o, t, { f: 6100, d: 0.25, g: 0.1 });
    } else {
      this.burst(o, t, { type: 'lowpass', f: 1600, d: 0.06, g: 0.7 }); this.burst(o, t, { type: 'highpass', f: 2500, d: 0.012, g: 0.35 });
      if (chance(0.5)) this.burst(o, t + rand(0.05, 0.12), { type: 'bandpass', f: 2000, q: 1, d: 0.05, g: 0.12 });
    }
  }
  fleshHit(pos, big) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.3 });
    this.tone(o, t, { f: big ? 95 : 120, f2: 55, d: 0.1, g: big ? 0.9 : 0.6 });
    this.burst(o, t, { type: 'bandpass', f: 380, q: 1.1, d: big ? 0.16 : 0.1, g: big ? 0.9 : 0.6 });
    this.burst(o, t, { type: 'highpass', f: 1500, d: 0.02, g: 0.25 });
  }
  // The headshot confirm: a porcelain crack that must read over everything.
  porcelainCrack(pos, big) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.35, ref: 3, occlude: false });
    const n = big ? 12 : 7;
    for (let i = 0; i < n; i++) this.burst(o, t + i * rand(0.002, 0.007), { type: 'highpass', f: rand(2800, 5000), d: rand(0.003, 0.008), g: rand(0.3, 0.7) });
    [3100, 4700, 6900].forEach((f, i) => this.tone(o, t, { f: f * rand(0.97, 1.03), d: big ? 0.3 : 0.18, g: 0.2 - i * 0.04 }));
    this.tone(o, t, { f: 180, f2: 90, d: 0.06, g: 0.35 });
  }
  headShatter(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.5, ref: 3, occlude: false });
    this.burst(o, t, { type: 'highpass', f: 1800, d: 0.22, g: 0.9 });
    for (let i = 0; i < 20; i++) this.burst(o, t + rand(0, 0.25), { type: 'highpass', f: rand(2500, 6000), d: rand(0.003, 0.01), g: rand(0.2, 0.5) });
    for (let i = 0; i < 12; i++) this.tone(o, t + 0.25 + rand(0, 0.6), { f: rand(3000, 8000), d: rand(0.04, 0.12), g: rand(0.04, 0.1) });
    this.tone(o, t, { f: 90, f2: 40, d: 0.25, g: 0.7 });
    this.burst(o, t + 0.05, { type: 'lowpass', f: 420, f2: 120, d: 0.9, g: 0.35, a: 0.15 });
  }
  thud(pos, g = 0.8) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.4 });
    this.tone(o, t, { f: 75, f2: 38, d: 0.3, g }); this.burst(o, t, { type: 'lowpass', f: 700, d: 0.22, g: g * 0.8 });
    for (let i = 0; i < 3; i++) this.tone(o, t + rand(0.02, 0.2), { f: rand(2500, 5000), d: 0.05, g: 0.05 });
  }
  // ------------------------------------------------------------------ bodies
  footstep(pos, surf, loud, player) {
    if (!this.ok) return;
    const t = this.now, o = player ? this.local(0.25, 0.7) : this.at(pos, { wet: 0.3, ref: 1.2 });
    const g = (loud ? 0.42 : 0.24) * (player ? 1 : 1.2);
    if (surf === 'tile') { this.burst(o, t, { type: 'highpass', f: 1800, d: 0.03, g: g * 0.8 }); this.burst(o, t, { type: 'lowpass', f: 900, d: 0.05, g }); }
    else { this.burst(o, t, { type: 'lowpass', f: rand(700, 1300), d: 0.07, g }); this.burst(o, t, { type: 'highpass', f: 3000, d: 0.008, g: g * 0.35 }); }
    this.tone(o, t, { f: 85, d: 0.06, g: g * 0.6 });
  }
  drag(pos) { if (!this.ok) return; const o = this.at(pos, { wet: 0.3, ref: 1.2 }); this.burst(o, this.now, { type: 'bandpass', f: 600, q: 0.8, d: 0.35, g: 0.22, a: 0.08 }); }
  creak(pos, g = 0.4) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.4 });
    for (let i = 0; i < 5; i++) this.burst(o, t + i * rand(0.05, 0.11), { type: 'bandpass', f: rand(2200, 4200), q: 6, d: 0.02, g: g * rand(0.5, 1) });
  }
  notice(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.4, ref: 2.5 });
    this.creak(pos, 0.5);
    this.burst(o, t + 0.1, { type: 'bandpass', f: 900, f2: 500, q: 5, d: 0.45, g: 0.35, a: 0.25 });
    this.tone(o, t + 0.1, { type: 'triangle', f: 196, f2: 185, d: 0.5, g: 0.07, a: 0.2 });
  }
  windup(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.35, ref: 2.5, occlude: false });
    this.burst(o, t, { type: 'bandpass', f: 1500, f2: 550, q: 3, d: 0.3, g: 0.55, a: 0.3 });
    for (let i = 0; i < 6; i++) this.burst(o, t + i * 0.07, { type: 'highpass', f: rand(3000, 5000), d: 0.01, g: 0.25 });
  }
  lunge(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.35, ref: 2.5, occlude: false });
    this.tone(o, t, { type: 'sawtooth', f: 230, f2: 120, d: 0.28, g: 0.18, a: 0.01 });
    this.burst(o, t, { type: 'bandpass', f: 1300, q: 2, d: 0.25, g: 0.4 });
  }
  scream(g = 1) {
    if (!this.ok) return;
    const t = this.now, o = this.local(0.5, g), c = this.clip(4); c.connect(o);
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 850; f1.Q.value = 3; f1.connect(c);
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1350; f2.Q.value = 4; f2.connect(c);
    for (const d of [0, 17, -23]) { const s = this.tone(f1, t, { type: 'sawtooth', f: 210, f2: 160, d: 1.1, g: 0.35, a: 0.03, detune: d }); const s2 = this.tone(f2, t, { type: 'sawtooth', f: 215, f2: 150, d: 1.0, g: 0.25, a: 0.03, detune: -d }); }
    this.burst(c, t, { type: 'bandpass', f: 2200, q: 1, d: 0.9, g: 0.3, a: 0.02 });
  }
  bite() {
    if (!this.ok) return;
    const t = this.now, o = this.local(0.3, 1);
    this.burst(o, t, { type: 'bandpass', f: 500, q: 1, d: 0.15, g: 1 });
    for (let i = 0; i < 6; i++) this.burst(o, t + rand(0, 0.12), { type: 'highpass', f: 2500, d: 0.008, g: 0.4 });
    this.tone(o, t, { f: 120, f2: 60, d: 0.12, g: 0.8 });
  }
  glitch(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.2, ref: 2.5 });
    for (let i = 0; i < 4; i++) this.burst(o, t + i * 0.025, { type: 'highpass', f: rand(500, 4000), d: 0.012, g: 0.4, rate: rand(0.3, 3) });
    this.tone(o, t, { type: 'square', f: 900, f2: 60, d: 0.1, g: 0.05, slide: 0.1 });
  }
  whoosh() { if (!this.ok) return; const o = this.local(0.1, 0.8); this.burst(o, this.now, { type: 'bandpass', f: 350, f2: 1400, q: 1.2, d: 0.14, g: 0.35, a: 0.03 }); }
  kickHit(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.3 });
    this.tone(o, t, { f: 110, f2: 50, d: 0.12, g: 1.0 }); this.burst(o, t, { type: 'lowpass', f: 1100, d: 0.09, g: 0.9 });
    this.burst(o, t, { type: 'highpass', f: 2800, d: 0.01, g: 0.4 });
  }
  hurt(big) {
    if (!this.ok) return;
    const t = this.now, o = this.local(0.2, 1);
    this.tone(o, t, { f: 70, f2: 40, d: 0.2, g: big ? 1 : 0.6 }); this.burst(o, t, { type: 'lowpass', f: 600, d: 0.15, g: big ? 0.8 : 0.5 });
    if (big) this.tinnitus(0.6);
  }
  heartbeat(g = 0.5) { if (!this.ok) return; const t = this.now, o = this.local(0, 1); this.tone(o, t, { f: 58, f2: 40, d: 0.13, g }); this.tone(o, t + 0.19, { f: 52, f2: 38, d: 0.12, g: g * 0.7 }); }
  breath(g = 0.25) { if (!this.ok) return; const t = this.now, o = this.local(0.1, 1); this.burst(o, t, { type: 'bandpass', f: 1100, q: 0.8, d: 0.35, g, a: 0.2 }); this.burst(o, t + 0.6, { type: 'bandpass', f: 800, q: 0.8, d: 0.4, g: g * 0.8, a: 0.15 }); }
  flashlight(on) { if (!this.ok) return; const t = this.now, o = this.local(0.1, 0.8); this.burst(o, t, { type: 'bandpass', f: on ? 3300 : 2600, q: 3, d: 0.015, g: 0.5 }); this.burst(o, t + 0.03, { type: 'bandpass', f: 1800, q: 2, d: 0.02, g: 0.25 }); }
  pickup(kind) {
    if (!this.ok) return;
    const t = this.now, o = this.local(0.1, 0.8);
    if (kind === 'paper') { this.burst(o, t, { type: 'bandpass', f: 3500, q: 0.6, d: 0.25, g: 0.25, a: 0.05 }); this.burst(o, t + 0.2, { type: 'bandpass', f: 2800, q: 0.6, d: 0.15, g: 0.18, a: 0.03 }); return; }
    for (let i = 0; i < 4; i++) this.burst(o, t + i * rand(0.03, 0.06), { type: 'bandpass', f: rand(2000, 3500), q: 3, d: 0.02, g: 0.3 });
    if (kind === 'weapon') { this.slideRack(); }
  }
  uiTick(f = 1800, g = 0.2) { if (!this.ok) return; const o = this.ctx.createGain(); o.gain.value = 1; o.connect(this.ui); this.tone(o, this.now, { f, d: 0.05, g }); }
  focusReady() { if (!this.ok) return; const o = this.ctx.createGain(); o.connect(this.ui); this.tone(o, this.now, { f: 2400, d: 0.05, g: 0.05 }); }
  hitTick(head) { if (!this.ok || !TUNE.fx.reticle) return; const o = this.ctx.createGain(); o.connect(this.ui); this.tone(o, this.now, { f: head ? 2600 : 1500, d: 0.03, g: head ? 0.06 : 0.035 }); }
  doorBang(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.6, ref: 3, occlude: false });
    this.burst(o, t, { type: 'lowpass', f: 2200, d: 0.35, g: 1.1 }); this.tone(o, t, { f: 70, f2: 35, d: 0.45, g: 1 });
    this.burst(o, t, { type: 'bandpass', f: 1500, q: 1, d: 0.1, g: 0.6 }); this.tone(o, t + 0.05, { type: 'sawtooth', f: 520, f2: 760, d: 0.35, g: 0.05 });
  }
  metalSlam(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 1, ref: 5, occlude: false });
    this.burst(o, t, { type: 'lowpass', f: 1200, d: 0.7, g: 1 }); this.tone(o, t, { f: 52, f2: 30, d: 0.9, g: 1 });
    [183, 412, 688, 1150, 1730].forEach((f, i) => this.tone(o, t, { f, d: 2.2 - i * 0.3, g: 0.12 }));
  }
  rumble(pos, dur) { if (!this.ok) return; const o = this.at(pos, { wet: 0.8, ref: 4, occlude: false }); this.burst(o, this.now, { type: 'lowpass', f: 260, d: dur, g: 0.6, a: 0.2 }); }
  bell(pos, strikes, gap = 1.6) {
    if (!this.ok) return;
    const o = this.at(pos, { wet: 1.2, ref: 8, roll: 0.6, occlude: false });
    const f0 = 196, parts = [[0.5, 4.5, 0.35], [1, 3.5, 0.5], [1.19, 2.8, 0.25], [1.5, 2.2, 0.2], [2, 1.8, 0.2], [2.52, 1.2, 0.12], [3.01, 1.0, 0.1], [4.2, 0.6, 0.06]];
    for (let s = 0; s < strikes; s++) {
      const t = this.now + s * gap;
      this.burst(o, t, { type: 'bandpass', f: 2200, q: 1, d: 0.03, g: 0.5 });
      for (const [r, d, g] of parts) this.tone(o, t, { f: f0 * r * rand(0.998, 1.002), d, g });
    }
  }
  tick(pos, tock) { if (!this.ok) return; const o = this.at(pos, { wet: 0.9, ref: 5, occlude: false }); this.burst(o, this.now, { type: 'bandpass', f: tock ? 1400 : 2100, q: 5, d: 0.03, g: 0.35 }); this.tone(o, this.now, { f: tock ? 330 : 440, d: 0.05, g: 0.08 }); }
  punchCard(pos) { if (!this.ok) return; const t = this.now, o = this.at(pos, { wet: 0.8, ref: 3, occlude: false }); this.burst(o, t, { type: 'bandpass', f: 1800, q: 2, d: 0.04, g: 0.7 }); this.tone(o, t, { f: 160, f2: 90, d: 0.07, g: 0.6 }); this.burst(o, t + 0.13, { type: 'bandpass', f: 3200, q: 3, d: 0.02, g: 0.5 }); }
  eyeHurt(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 1, ref: 6, occlude: false });
    this.burst(o, t, { type: 'bandpass', f: 400, q: 1, d: 0.4, g: 0.9 });
    this.tone(o, t, { type: 'sawtooth', f: 70, f2: 42, d: 1.2, g: 0.25, a: 0.05 });
    this.tone(o, t, { type: 'sawtooth', f: 74, f2: 45, d: 1.2, g: 0.2, a: 0.05 });
  }
  staticBurst(dur = 0.6, g = 0.3) { if (!this.ok) return; const o = this.ctx.createGain(); o.connect(this.music); this.burst(o, this.now, { type: 'bandpass', f: 2200, q: 0.5, d: dur, g, a: 0.02 }); }
  paChime() {
    if (!this.ok) return;
    const t = this.now, o = this.paOut();
    this.tone(o, t, { type: 'triangle', f: 880, d: 1.2, g: 0.35 }); this.tone(o, t + 0.5, { type: 'triangle', f: 698.5, d: 1.5, g: 0.35 });
  }
  screech(pos) {
    if (!this.ok) return;
    const t = this.now, o = this.at(pos, { wet: 0.8, ref: 4, occlude: false }), c = this.clip(5); c.connect(o);
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), mg = this.ctx.createGain();
    car.frequency.value = 720; mod.frequency.value = 233; mg.gain.setValueAtTime(100, t); mg.gain.linearRampToValueAtTime(1400, t + 0.8);
    mod.connect(mg); mg.connect(car.frequency);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
    const g = this.ctx.createGain(); this.env(g.gain, t, 0.05, 1.1, 0.5);
    car.connect(bp); bp.connect(g); g.connect(c);
    car.start(t); mod.start(t); car.stop(t + 1.3); mod.stop(t + 1.3);
  }
  distantClank() {
    if (!this.ok) return;
    const a = rand(0, TAU), p = _v3.set(this.lpos.x + Math.cos(a) * 25, 4, this.lpos.z + Math.sin(a) * 25);
    const o = this.at(p, { wet: 1.4, ref: 6, occlude: false, roll: 0.5 });
    const t = this.now;
    this.burst(o, t, { type: 'bandpass', f: rand(250, 500), q: 1.5, d: 0.3, g: 0.25 });
    [rand(300, 400), rand(700, 900), rand(1300, 1700)].forEach((f) => this.tone(o, t, { f, d: rand(0.8, 1.8), g: 0.03 }));
  }

  // ------------------------------------------------------------------ ambience
  startAmbience() {
    const ctx = this.ctx;
    // Mains hum (50 Hz family).
    const hum = ctx.createGain(); hum.gain.value = 0.02; hum.connect(this.amb); this.ambHum = hum;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(hum);
    [[50, 1], [100, 0.7], [150, 0.35], [200, 0.2]].forEach(([f, g]) => { const o = ctx.createOscillator(); o.frequency.value = f; const gg = ctx.createGain(); gg.gain.value = g; o.connect(gg); gg.connect(lp); o.start(); });
    // Low drone.
    const dr = ctx.createGain(); dr.gain.value = 0.055; dr.connect(this.amb);
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 110; dlp.Q.value = 2; dlp.connect(dr);
    [36.7, 36.95, 55.1].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(dlp); o.start(); });
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.05; lg.gain.value = 45; lfo.connect(lg); lg.connect(dlp.frequency); lfo.start();
    // Air tone.
    const air = ctx.createBufferSource(); air.buffer = this.noiseBuf; air.loop = true;
    const af = ctx.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 320; af.Q.value = 0.4;
    const ag = ctx.createGain(); ag.gain.value = 0.02; air.connect(af); af.connect(ag); ag.connect(this.amb); air.start();
  }
  // Looping positional source (tube buzz, faucet, clock mechanism). update() may modulate it.
  loop(pos, build, o = {}) {
    if (!this.ready) return null;
    const ctx = this.ctx, p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 1.5; p.rolloffFactor = o.roll || 1.3; p.maxDistance = 60;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(p); p.connect(this.amb);
    const send = ctx.createGain(); send.gain.value = o.wet ?? 0.3; p.connect(send); send.connect(this.revIn);
    const nodes = build(g);
    const self = this;
    const L = { panner: p, gain: g, nodes, level: o.level ?? 0.1, update: null, set(v) { self.glide(g.gain, v, 0.02, 0.0005); } };
    L.set(L.level);
    this.loops.push(L);
    return L;
  }
  tubeBuzz(pos) {
    return this.loop(pos, (g) => {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2;
      o.connect(bp); bp.connect(g); o.start(); return [o];
    }, { level: 0.012, ref: 1.2, roll: 1.6 });
  }
  faucet(pos) {
    return this.loop(pos, (g) => {
      const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.6;
      s.connect(bp); bp.connect(g); s.start(); return [s];
    }, { level: 0.05, ref: 1.0 });
  }

  // ------------------------------------------------------------------ factory PA
  paOut() {
    if (!this.paNode) {
      const ctx = this.ctx;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const c = this.clip(1.8);
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 9; p.rolloffFactor = 1; p.maxDistance = 80;
      p.positionX.value = 41; p.positionY.value = 5; p.positionZ.value = 28;
      this.paOcc = ctx.createBiquadFilter(); this.paOcc.type = 'lowpass'; this.paOcc.frequency.value = 20000;
      hp.connect(lp); lp.connect(c); c.connect(this.paOcc); this.paOcc.connect(p); p.connect(this.music);
      const s = ctx.createGain(); s.gain.value = 0.9; p.connect(s); s.connect(this.revIn);
      this.paNode = hp;
    }
    return this.paNode;
  }
  setSong(mode) { this.songMode = mode; this.songBeat = 0; this.songNext = this.ready ? this.now + 0.3 : 0; this.songIdx = 0; }
  startSongScheduler() {
    this.songMode = this.songMode || 'off'; this.songIdx = 0; this.songNext = this.now + 0.5; this.songBeat = 0;
    this.timers.push(setInterval(() => this.scheduleSong(), 60));
  }
  scheduleSong() {
    if (!this.ready || this.songMode === 'off' || this.ctx.state !== 'running') return;
    const wrong = this.songMode === 'wrong';
    const bpm = wrong ? 62 : 100, beat = 60 / bpm, out = this.paOut();
    // Occlusion from walls between the player and the workshop.
    const inside = G.level && G.level.roomAt(this.lpos.x, this.lpos.z) === ROOMS[5];
    this.glide(this.paOcc.frequency, inside ? 20000 : 900, 0.3, 1);
    // After a long suspension, resume from now instead of replaying the backlog.
    if (this.songNext < this.now - 1) this.songNext = this.now + 0.1;
    while (this.songNext < this.now + 0.35) {
      const seq = SONG;
      const idx = wrong ? (seq.length - 1 - this.songIdx) : this.songIdx;
      const [m, beats] = seq[idx];
      const t = this.songNext, dur = beats * beat;
      if (m) {
        const midi = wrong ? WRONG(m) : m;
        this.paNote(out, t, mtof(midi), dur, wrong);
        if (wrong && chance(0.5)) this.paNote(out, t, mtof(midi + 6), dur, true, 0.08);
      }
      // Oom-pah bass on each beat.
      const bar = Math.floor(this.songBeat / 4) % 8, root = SONG_BASS[bar] - (wrong ? 3 : 0);
      for (let b = 0; b < beats; b += 1) {
        const bt = t + b * beat, onBeat = Math.floor(this.songBeat + b) % 2 === 0;
        this.paNote(out, bt, mtof(onBeat ? root : root + 7), beat * 0.45, wrong, 0.14, 'bass');
      }
      this.songBeat += beats;
      this.songNext += dur;
      this.songIdx = (this.songIdx + 1) % seq.length;
      if (this.songIdx === 0) this.songNext += beat * 2;
    }
  }
  paNote(out, t, f, dur, wrong, gain = 0.2, kind) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = kind === 'bass' ? 'square' : 'square';
    o.frequency.setValueAtTime(f, t);
    if (wrong) { o.detune.setValueAtTime(rand(-30, 30), t); o.detune.linearRampToValueAtTime(rand(-60, 60), t + dur); }
    else o.detune.value = Math.sin(t * 0.7) * 6;
    const a = wrong ? dur * 0.75 : 0.015, rel = wrong ? 0.02 : Math.min(0.25, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setValueAtTime(gain * (wrong ? 1 : 0.7), t + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'bass' ? 700 : 2400;
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ hummed song (enemies)
  makeHumVoice() {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 130;
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2; vg.gain.value = 3; vib.connect(vg); vg.connect(o.frequency); vib.start();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 480; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.4; p.rolloffFactor = 1.25; p.maxDistance = 50;
    const occ = ctx.createBiquadFilter(); occ.type = 'lowpass'; occ.frequency.value = 20000;
    o.connect(lp); lp.connect(bp); bp.connect(g); g.connect(occ); occ.connect(p); p.connect(this.sfx);
    const s = ctx.createGain(); s.gain.value = 0.35; p.connect(s); s.connect(this.revIn);
    o.start();
    return { o, g, p, occ, owner: null, idx: 0, next: 0, level: 0, occT: 0 };
  }
  // Enemies call this every frame with how loudly they hum (0 = silent).
  updateHum(dt) {
    const want = G.enemies.filter((e) => e.humLevel > 0.01 && e.alive).sort((a, b) => a.distToPlayer - b.distToPlayer).slice(0, this.hum.length);
    const t = this.now;
    for (const v of this.hum) if (v.owner && !want.includes(v.owner)) { v.owner.humVoice = null; v.owner = null; v.g.gain.setTargetAtTime(0, t, 0.08); }
    for (const e of want) {
      if (e.humVoice) continue;
      const v = this.hum.find((q) => !q.owner); if (!v) break;
      v.owner = e; e.humVoice = v; v.idx = Math.floor(Math.random() * SONG.length); v.next = t;
    }
    for (const v of this.hum) {
      const e = v.owner; if (!e) continue;
      const hp = e.headPos || e.pos;
      v.p.positionX.value = hp.x; v.p.positionY.value = hp.y; v.p.positionZ.value = hp.z;
      v.occT -= dt;
      if (v.occT <= 0) { v.occT = 0.25; const blocked = G.level && !G.level.los(this.lpos, hp, false); this.glide(v.occ.frequency, blocked ? 500 : 20000, 0.1, 1); }
      if (t >= v.next - 0.05) {
        const [m, beats] = SONG[v.idx]; v.idx = (v.idx + 1) % SONG.length;
        const beat = 60 / (e.humTempo || 70), dur = beats * beat;
        if (m) {
          v.o.frequency.setTargetAtTime(mtof(m - 12 + (e.humPitch || 0)), v.next, 0.04);
          v.g.gain.cancelScheduledValues(v.next);
          v.g.gain.setTargetAtTime(0.11 * e.humLevel, v.next, 0.05);
          v.g.gain.setTargetAtTime(0.02 * e.humLevel, v.next + dur * 0.8, 0.08);
        } else v.g.gain.setTargetAtTime(0, v.next, 0.1);
        v.next += dur;
        if (v.next < t) v.next = t;
      }
    }
  }
  silenceHum(e) { if (e.humVoice && this.ready) { e.humVoice.g.gain.cancelScheduledValues(this.now); e.humVoice.g.gain.setTargetAtTime(0, this.now, 0.03); e.humVoice.next = this.now + 0.8; } }

  setMuffle(freq, time = 0.2) { if (!this.ok) return; this.glide(this.muffle.frequency, freq, time, 50); }
}
