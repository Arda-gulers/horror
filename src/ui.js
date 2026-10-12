'use strict';
// HUD, screens, notes and the live tuning panel.

const $ = (id) => document.getElementById(id);

const TUNE_SCHEMA = [
  { h: '镜头与输入' },
  { k: 'sens', l: '鼠标灵敏度', min: 0.3, max: 2.5, step: 0.05 },
  { k: 'adsSens', l: '瞄准时灵敏度倍率', min: 0.4, max: 1, step: 0.02 },
  { k: 'fov', l: '视野（度）', min: 60, max: 95, step: 1 },
  { k: 'invertY', l: '反转纵轴', type: 'bool' },
  { h: '手感强度' },
  { k: 'recoil', l: '后坐力', min: 0, max: 2, step: 0.05, d: '同时缩放瞄准后坐与视觉冲击' },
  { k: 'shake', l: '屏幕震动', min: 0, max: 2, step: 0.05 },
  { k: 'hitstop', l: '命中停顿', min: 0, max: 2.5, step: 0.05, d: '顿帧只作用于世界，不作用于镜头转动和输入' },
  { k: 'focusSpeed', l: '准星聚焦速度', min: 0.4, max: 2.5, step: 0.05 },
  { k: 'tokens', l: '同时进攻的敌人上限', min: 1, max: 6, step: 1 },
  { k: 'brightness', l: '灯光亮度', min: 0.5, max: 2, step: 0.05 },
  { h: '反馈层　逐层关闭，对照手感差异' },
  { f: 'muzzleLight', l: '枪口焰照明', d: '每一枪都照亮房间，也把你自己暴露出来' },
  { f: 'aimRecoil', l: '瞄准后坐', d: '真正改变弹着点的后坐，约八成自动回正' },
  { f: 'viewPunch', l: '视觉冲击', d: '只动镜头、不动弹着点的短促冲击' },
  { f: 'gunKick', l: '枪模后坐', d: '枪的后移、上跳和回弹' },
  { f: 'shake', l: '屏幕震动' },
  { f: 'hitstop', l: '命中停顿与慢动作' },
  { f: 'fovPunch', l: '视场冲击' },
  { f: 'hitReact', l: '受击形变', d: '按命中部位与子弹方向驱动的弹簧形变' },
  { f: 'audioLayers', l: '分层枪声', d: '关闭后只剩一层噪声' },
  { f: 'shells', l: '弹壳' },
  { f: 'decals', l: '弹孔与血迹' },
  { f: 'reticle', l: '准星命中反馈' },
  { f: 'gore', l: '血液' },
  { h: '系统' },
  { f: 'focus', l: '聚焦机制', d: '关闭后瞄准散布固定在中间值，爆头不再有暴击' },
  { f: 'tokens', l: '攻击令牌', d: '关闭后所有敌人可以同时扑上来' },
  { f: 'lurch', l: '工友跳帧前进' },
  { f: 'dynamicSupply', l: '动态补给', d: '弹药见底时尸体上会掉落少量子弹' },
];
const JUICE = ['muzzleLight', 'viewPunch', 'gunKick', 'shake', 'hitstop', 'fovPunch', 'hitReact', 'audioLayers', 'shells', 'decals', 'reticle', 'gore'];

class UI {
  constructor() {
    this.el = {};
    ['hud', 'reticle', 'tkT', 'tkB', 'tkL', 'tkR', 'hitx', 'dmgdir', 'objTxt', 'obj', 'toasts', 'sub', 'prompt', 'grab', 'grabFill', 'grabShot', 'heal', 'healFill',
      'vitals', 'ecg', 'vstate', 'vitems', 'stam', 'stamFill', 'ammo', 'wname', 'amag', 'achamber', 'ares', 'apips', 'ahint', 'title', 'pause', 'death', 'results', 'note', 'notePaper', 'tune', 'clickToResume', 'loading', 'doc']
      .forEach((id) => (this.el[id] = $(id)));
    this.ecgCtx = this.el.ecg.getContext('2d');
    this.ecgBuf = new Float32Array(220); this.ecgPhase = 0; this.ecgX = 0;
    this.hitT = 0; this.hitKind = ''; this.subT = 0; this.subQueue = [];
    this.ammoShowT = 0; this.vitShowT = 0; this.objT = 0;
    this._ammoDirty = true;
    this.loadTune();
    this.buildTune();
    this.bind();
  }
  // ------------------------------------------------------------------ binding
  bind() {
    const canvas = $('game');
    $('btnStart').onclick = () => G.start();
    $('btnTune').onclick = () => this.toggleTune(true);
    $('btnTune2').onclick = () => this.toggleTune(true);
    $('btnDesign').onclick = () => this.openDoc();
    $('btnDesign2').onclick = () => this.openDoc();
    $('docClose').onclick = () => this.closeDoc();
    $('btnResume').onclick = () => this.lock();
    $('btnRetry').onclick = () => { this.hide('pause'); G.director.respawn(); this.lock(); };
    $('btnContinue').onclick = () => { this.hide('death'); G.director.respawn(); this.lock(); };
    $('btnAgain').onclick = () => location.reload();
    this.el.clickToResume.onclick = () => this.lock();
    canvas.addEventListener('click', () => { if (G.started && !G.over && !Input.locked && !G.inNote && this.el.death.hidden) this.lock(); });
    document.addEventListener('pointerlockchange', () => {
      if (!G.started || G.over) return;
      if (Input.locked) { this.hide('pause'); this.hide('clickToResume'); if (!G.inNote) G.paused = false; }
      else if (G.inNote) { this.closeNote(true); }
      else if (G.player.state !== 'dead' && this.el.death.hidden) { G.paused = true; this.show('pause'); }
    });
    addEventListener('keydown', (e) => {
      if (G.inNote && (e.code === 'KeyE' || e.code === 'Escape')) { e.preventDefault(); this.closeNote(false); }
      if (!this.el.doc.hidden && e.code === 'Escape') { e.preventDefault(); this.closeDoc(); }
      if (e.code === 'Tab' && G.started) this.objT = 3;
    });
  }
  lock() {
    const c = $('game');
    try {
      const p = c.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = c.requestPointerLock(); if (q && q.catch) q.catch(() => this.noLock()); } catch (e) { this.noLock(); } });
    } catch (e) { this.noLock(); }
  }
  noLock() {
    // Without pointer lock the cursor still reports movement inside the canvas.
    G.debug = true; G.paused = false; this.hide('pause'); this.hide('clickToResume');
    this.toast('当前环境不允许锁定鼠标：请在独立的浏览器标签页中打开以获得完整操作', 6);
  }
  openDoc() { this.show('doc'); this.el.doc.scrollTop = 0; $('docClose').focus(); }
  closeDoc() { this.hide('doc'); }
  show(id) { this.el[id].hidden = false; }
  hide(id) { this.el[id].hidden = true; }

  // ------------------------------------------------------------------ HUD api
  ammoDirty() { this._ammoDirty = true; this.ammoShowT = 3; }
  prompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    this.el.prompt.innerHTML = text ? `<b>E</b>${text}` : '';
    this.el.prompt.style.opacity = text ? 1 : 0;
  }
  toast(text, dur = 3.2) {
    const d = document.createElement('div'); d.textContent = text; d.style.animationDuration = dur + 's';
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), dur * 1000);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }
  subtitle(who, text, dur = 3.5) {
    this.el.sub.innerHTML = `<span class="who">[${who}]</span>${text}`;
    this.el.sub.style.opacity = 1; this.subT = dur;
  }
  objective(text) { this.el.objTxt.textContent = text; this.objT = 6; }
  hitMarker(kind) {
    if (!TUNE.fx.reticle) return;
    this.hitT = kind === 'kill' ? 0.3 : kind === 'head' ? 0.16 : 0.1; this.hitKind = kind;
    const hx = this.el.hitx; hx.className = kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : '';
  }
  damageDir(rel) {
    const a = document.createElement('div'); a.className = 'arc';
    a.style.transform = `rotate(${-rel}rad)`; a.style.opacity = 1;
    this.el.dmgdir.appendChild(a);
    requestAnimationFrame(() => { a.style.transition = 'opacity 1.3s'; a.style.opacity = 0; });
    setTimeout(() => a.remove(), 1400);
  }

  // ------------------------------------------------------------------ frame update
  update(dt) {
    const P = G.player, W = G.weapons;
    // Ammo.
    if (this._ammoDirty) { this._ammoDirty = false; this.renderAmmo(); }
    this.ammoShowT -= dt;
    const showAmmo = this.ammoShowT > 0 || W.ads > 0.1 || W.action === 'reload' || W.roundsInGun() <= 2;
    this.el.ammo.style.opacity = showAmmo ? 1 : 0.28;
    // Vitals.
    const hpf = P.hp / P.maxHp;
    this.vitShowT -= dt; if (P.hurtT > 0 || hpf < 0.7 || P.stamina < 99) this.vitShowT = 2.5;
    this.el.vitals.style.opacity = this.vitShowT > 0 ? 1 : 0.35;
    this.renderECG(dt, hpf);
    const st = this.el.stam;
    st.style.opacity = P.stamina < 99.5 ? 1 : 0;
    this.el.stamFill.style.transform = `scaleX(${P.stamina / 100})`;
    st.classList.toggle('exhausted', P.exhausted);
    const items = [`急救 ${P.inv.aid}`];
    if (P.inv.hasShotgun) items.push(`霰弹 ${P.inv.shells}`);
    const it = items.join('　'); if (it !== this._items) { this._items = it; this.el.vitems.textContent = it; }
    // Objective shows briefly on change or on Tab.
    this.objT -= dt; this.el.obj.style.opacity = this.objT > 0 ? 1 : 0;
    // Subtitles.
    this.subT -= dt; if (this.subT <= 0) this.el.sub.style.opacity = 0;
    // Grab struggle.
    const grabbed = P.state === 'grabbed';
    this.el.grab.style.opacity = grabbed ? 1 : 0;
    if (grabbed) {
      this.el.grabFill.style.width = `${Math.min(1, P.grab.escape) * 100}%`;
      const loaded = W.current === 'pistol' ? W.ammo.pistol.chamber > 0 : W.ammo.shotgun.n > 0 && W.ammo.shotgun.ready;
      this.el.grabShot.className = loaded ? '' : 'off';
    }
    // Healing.
    this.el.heal.style.opacity = P.healing > 0 ? 1 : 0;
    if (P.healing > 0) this.el.healFill.style.width = `${(1 - P.healing / P.healDur) * 100}%`;
    this.updateReticle(dt);
  }
  renderAmmo() {
    const W = G.weapons, P = G.player, isP = W.current === 'pistol';
    this.el.wname.textContent = W.def.name;
    const inGun = W.roundsInGun();
    this.el.amag.textContent = inGun;
    this.el.achamber.textContent = isP && W.ammo.pistol.chamber && W.ammo.pistol.mag === 8 ? '+1' : '';
    this.el.ares.textContent = `/ ${isP ? P.inv.pistol : P.inv.shells}`;
    this.el.ammo.classList.toggle('low', inGun <= (isP ? 2 : 1));
    const cap = isP ? 9 : 5;
    let html = '';
    for (let i = 0; i < cap; i++) html += `<i class="${isP ? '' : 'shell'} ${i < inGun ? '' : 'empty'}"${isP && i === 8 ? ' style="margin-left:4px"' : ''}></i>`;
    this.el.apips.innerHTML = html;
    const reserve = isP ? P.inv.pistol : P.inv.shells;
    this.el.ahint.textContent = inGun === 0 ? (reserve > 0 ? '空仓　按 R 装填' : '没有子弹') : (isP && !W.ammo.pistol.chamber ? '空仓' : '');
  }
  renderECG(dt, hpf) {
    const P = G.player, c = this.ecgCtx, Wd = 440, Hd = 108;
    const stress = (P.state === 'grabbed' ? 40 : 0) + (P.sprinting ? 20 : 0) + (G.director.bc ? 15 : 0);
    const bpm = (hpf > 0.6 ? 68 : hpf > 0.3 ? 92 : 124) + stress;
    const color = hpf > 0.6 ? '#86a88f' : hpf > 0.3 ? '#d8b24a' : '#cf4632';
    const label = hpf > 0.6 ? '良好' : hpf > 0.3 ? '注意' : '危险';
    if (label !== this._vlabel) { this._vlabel = label; this.el.vstate.textContent = label; this.el.vstate.style.color = color; }
    if (P.state === 'dead') { this.el.vstate.textContent = '——'; }
    const speed = 120; // px per second on the 440 canvas
    let n = Math.max(1, Math.round(speed * dt));
    for (let k = 0; k < n; k++) {
      this.ecgPhase += (bpm / 60) / speed;
      const ph = this.ecgPhase % 1;
      let v = 0;
      if (P.state !== 'dead') {
        v += Math.exp(-Math.pow((ph - 0.12) / 0.025, 2)) * 0.12;
        v += Math.exp(-Math.pow((ph - 0.2) / 0.008, 2)) * 1.0 - Math.exp(-Math.pow((ph - 0.215) / 0.008, 2)) * 0.35 - Math.exp(-Math.pow((ph - 0.185) / 0.007, 2)) * 0.18;
        v += Math.exp(-Math.pow((ph - 0.42) / 0.05, 2)) * 0.22;
      }
      this.ecgX = (this.ecgX + 2) % Wd;
      const y = Hd * 0.62 - v * Hd * 0.5 + (Math.random() - 0.5) * 1.5;
      c.fillStyle = 'rgba(0,0,0,1)'; c.globalCompositeOperation = 'destination-out'; c.fillRect(this.ecgX, 0, 12, Hd); c.globalCompositeOperation = 'source-over';
      c.strokeStyle = color; c.lineWidth = 2.4; c.beginPath();
      c.moveTo(this.ecgX - 2, this.lastY ?? y); c.lineTo(this.ecgX, y); c.stroke();
      this.lastY = y;
      if (this.ecgX < 2) this.lastY = y;
    }
  }
  updateReticle(dt) {
    const W = G.weapons, P = G.player, R = this.el.reticle;
    const fovRad = P.camera.fov * DEG;
    const px = Math.tan(W.spreadDeg * DEG) / Math.tan(fovRad / 2) * (innerHeight / 2);
    const r = clamp(px, 4, 150);
    this.el.tkT.style.transform = `translate(0, ${-r - 9}px)`; this.el.tkB.style.transform = `translate(0, ${r}px)`;
    this.el.tkL.style.transform = `translate(${-r - 9}px, 0)`; this.el.tkR.style.transform = `translate(${r}px, 0)`;
    const busy = W.action === 'reload' || W.action === 'kick' || P.sprintBlend > 0.4 || P.healing > 0 || P.state !== 'normal';
    const op = busy ? 0.12 : lerp(0.4, 1, W.ads);
    R.style.opacity = TUNE.fx.reticle || W.ads > 0.5 ? op : op * 0.6;
    R.classList.toggle('focused', W.focusFull && TUNE.fx.focus);
    this.hitT -= dt;
    const on = this.hitT > 0;
    this.el.hitx.style.opacity = on ? 1 : 0;
    R.classList.toggle('hit', on && this.hitKind !== 'kill');
    R.classList.toggle('kill', on && this.hitKind === 'kill');
    if (on) this.el.hitx.style.transform = `scale(${1 + (this.hitKind === 'kill' ? (0.3 - this.hitT) * 1.5 : 0)})`;
  }

  // ------------------------------------------------------------------ screens
  showNote(note) {
    G.inNote = true; G.paused = true;
    this.el.notePaper.innerHTML = `<h3>${note.title}</h3><div class="meta">${note.meta}</div>${note.body}`;
    this.show('note');
    G.audio.pickup('paper');
  }
  closeNote(lostLock) {
    if (!G.inNote) return;
    G.inNote = false; this.hide('note');
    if (lostLock || !Input.locked) { this.show('clickToResume'); G.paused = true; }
    else G.paused = false;
  }
  showDeath(kind) {
    const T = {
      grab: ['你已被登记为在岗人员。', '工号自动分配。夜班将继续。'],
      bite: ['你已被登记为在岗人员。', '被抓住时，枪里有子弹就开枪；没有就一直踢。'],
      watchman: ['巡夜人找到了光。', '守则第二条：旋律走调时，关闭一切照明，停止作业，不要奔跑。'],
      charge: ['车间主任记下了你的工号。', '冲撞之前它会停下来吼叫。侧身，让它撞上机床。'],
      hit: ['车间主任记下了你的工号。', '面罩打掉之前，打头没有用。'],
    }[kind] || ['你没能下班。', '夜班将继续。'];
    $('deathTitle').textContent = T[0]; $('deathText').textContent = T[1];
    document.exitPointerLock && document.exitPointerLock();
    this.show('death');
  }
  showResults(r) {
    G.over = true;
    document.exitPointerLock && document.exitPointerLock();
    $('rank').textContent = r.rank;
    $('resText').textContent = r.text;
    $('resTable').innerHTML = r.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    this.hide('hud');
    this.show('results');
  }

  // ------------------------------------------------------------------ tuning panel
  loadTune() {
    try {
      const s = JSON.parse(localStorage.getItem('sckb-tune') || 'null');
      if (s) { for (const k in s) if (k !== 'fx' && k in TUNE) TUNE[k] = s[k]; if (s.fx) for (const k in s.fx) if (k in TUNE.fx) TUNE.fx[k] = s.fx[k]; }
    } catch (e) { /* storage unavailable */ }
  }
  saveTune() { try { localStorage.setItem('sckb-tune', JSON.stringify(TUNE)); } catch (e) { /* storage unavailable */ } }
  buildTune() {
    const t = this.el.tune;
    let html = '<h3>手感调试</h3><div class="sub">所有参数实时生效。反馈层可以逐个关闭，用来对照每一层对打击感的贡献。</div>';
    for (const s of TUNE_SCHEMA) {
      if (s.h) { html += `<h4>${s.h}</h4>`; continue; }
      if (s.f) { html += `<label for="tf_${s.f}"><span>${s.l}</span><input type="checkbox" id="tf_${s.f}" data-f="${s.f}">${s.d ? `<small>${s.d}</small>` : ''}</label>`; continue; }
      if (s.type === 'bool') { html += `<label for="tk_${s.k}"><span>${s.l}</span><input type="checkbox" id="tk_${s.k}" data-k="${s.k}"></label>`; continue; }
      html += `<label for="tk_${s.k}"><span>${s.l}</span><span class="val" id="tv_${s.k}"></span><input type="range" id="tk_${s.k}" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}">${s.d ? `<small>${s.d}</small>` : ''}</label>`;
    }
    html += '<div class="row2"><button class="btn" type="button" id="tuneJuiceOff">关闭全部反馈层</button><button class="btn" type="button" id="tuneJuiceOn">打开全部反馈层</button><button class="btn" type="button" id="tuneReset">恢复默认</button><button class="btn primary" type="button" id="tuneClose">关闭</button></div>';
    t.innerHTML = html;
    t.addEventListener('input', (e) => {
      const el = e.target;
      if (el.dataset.f) TUNE.fx[el.dataset.f] = el.checked;
      else if (el.dataset.k) TUNE[el.dataset.k] = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      this.syncTune(); this.saveTune();
    });
    $('tuneJuiceOff').onclick = () => { JUICE.forEach((k) => (TUNE.fx[k] = false)); this.syncTune(); this.saveTune(); };
    $('tuneJuiceOn').onclick = () => { JUICE.forEach((k) => (TUNE.fx[k] = true)); this.syncTune(); this.saveTune(); };
    $('tuneReset').onclick = () => { const d = JSON.parse(JSON.stringify(TUNE_DEFAULT)); Object.assign(TUNE, d); TUNE.fx = d.fx; this.syncTune(); this.saveTune(); };
    $('tuneClose').onclick = () => this.toggleTune(false);
    this.syncTune();
  }
  syncTune() {
    for (const s of TUNE_SCHEMA) {
      if (s.f) { const el = $('tf_' + s.f); if (el) el.checked = !!TUNE.fx[s.f]; }
      else if (s.k) { const el = $('tk_' + s.k); if (!el) continue; if (el.type === 'checkbox') el.checked = !!TUNE[s.k]; else { el.value = TUNE[s.k]; const v = $('tv_' + s.k); if (v) v.textContent = Number(TUNE[s.k]).toFixed(s.step < 1 ? 2 : 0); } }
    }
  }
  toggleTune(on) { this.el.tune.hidden = !on; }
}
