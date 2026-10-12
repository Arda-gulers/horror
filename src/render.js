'use strict';
// Rendering: HDR scene target (MSAA), viewmodel on its own depth, quarter-res bloom, composite grade.

const FS_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BRIGHT_FS = `
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(max(c.r, c.g), c.b);
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 1.2, l), 1.0);
}`;
const BLUR_FS = `
uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
  c += texture2D(tDiffuse, vUv + uDir * 1.385).rgb * 0.316; c += texture2D(tDiffuse, vUv - uDir * 1.385).rgb * 0.316;
  c += texture2D(tDiffuse, vUv + uDir * 3.231).rgb * 0.07; c += texture2D(tDiffuse, vUv - uDir * 3.231).rgb * 0.07;
  gl_FragColor = vec4(c, 1.0);
}`;
const COMP_FS = `
uniform sampler2D tScene, tBloom;
uniform vec2 uRes; uniform float uTime, uExposure, uBloom, uVignette, uGrain, uCA, uDamage, uDesat, uGlitch, uAnomaly, uFade, uFlash, uGaze;
varying vec2 vUv;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  if (uGlitch > 0.0) {
    float line = floor(uv.y * 80.0);
    float n = hash(vec2(line, floor(uTime * 24.0)));
    if (n > 1.0 - uGlitch * 0.4) uv.x += (hash(vec2(line, floor(uTime * 60.0))) - 0.5) * 0.08 * uGlitch;
  }
  uv.x += sin(uv.y * 38.0 + uTime * 5.0) * 0.0009 * uAnomaly;
  vec2 dc = uv - 0.5; float r2 = dot(dc, dc);
  float ca = (0.002 + uCA * 0.02 + uAnomaly * 0.006 + uGaze * 0.008) * r2 * 4.0;
  vec3 col;
  col.r = texture2D(tScene, uv + dc * ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - dc * ca).b;
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure * (1.0 + uFlash);
  col = aces(col);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), uDesat);
  float vig = smoothstep(0.2, 0.95, sqrt(r2) * 1.45);
  col = mix(col, col * vec3(1.0, 0.3, 0.25) + vec3(0.22, 0.0, 0.0) * vig, clamp(uDamage, 0.0, 1.0) * vig);
  col *= 1.0 - uVignette * vig;
  col = mix(col, col * vec3(1.05, 0.9, 0.85), uGaze * 0.5);
  col = toSRGB(col);
  float g = hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
  col += g * uGrain;
  col *= 1.0 - uAnomaly * 0.07 * (0.5 + 0.5 * sin(uv.y * uRes.y * 1.3));
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.bA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.bB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.brightMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 } }, vertexShader: FS_VS, fragmentShader: BRIGHT_FS, depthTest: false, depthWrite: false });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FS_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false });
    this.u = {
      tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2() }, uTime: { value: 0 }, uExposure: { value: 1.2 }, uBloom: { value: 0.85 },
      uVignette: { value: 0.45 }, uGrain: { value: 0.055 }, uCA: { value: 0 }, uDamage: { value: 0 }, uDesat: { value: 0 }, uGlitch: { value: 0 }, uAnomaly: { value: 0 }, uFade: { value: 1 }, uFlash: { value: 0 }, uGaze: { value: 0 },
    };
    this.compMat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: FS_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false });
    this.glitch = 0; this.anomaly = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = innerWidth, h = innerHeight, pr = this.r.getPixelRatio();
    this.r.setSize(w, h, false);
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.rt.setSize(W, H);
    this.bA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2)); this.bB.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.u.uRes.value.set(W, H);
    this.brightMat.uniforms.uTexel.value.set(1 / W, 1 / H);
    if (G.camera) { G.camera.aspect = w / h; G.camera.updateProjectionMatrix(); }
    if (G.weapons) { G.weapons.camera.aspect = w / h; G.weapons.camera.updateProjectionMatrix(); }
    if (G.fx) G.fx.setScale(H / (2 * Math.tan((G.camera ? G.camera.fov : 74) * DEG / 2)));
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.quadScene, this.quadCam); }
  render(scene, camera, vmScene, vmCamera) {
    const r = this.r;
    r.setRenderTarget(this.rt);
    r.autoClear = true; r.render(scene, camera);
    if (vmScene) { r.autoClear = false; r.clearDepth(); r.render(vmScene, vmCamera); r.autoClear = true; }
    // Bloom at quarter resolution.
    this.brightMat.uniforms.tDiffuse.value = this.rt.texture; this.pass(this.brightMat, this.bA);
    const bw = this.bA.width, bh = this.bA.height;
    for (let i = 0; i < 2; i++) {
      this.blurMat.uniforms.tDiffuse.value = this.bA.texture; this.blurMat.uniforms.uDir.value.set((1 + i) / bw, 0); this.pass(this.blurMat, this.bB);
      this.blurMat.uniforms.tDiffuse.value = this.bB.texture; this.blurMat.uniforms.uDir.value.set(0, (1 + i) / bh); this.pass(this.blurMat, this.bA);
    }
    this.u.tScene.value = this.rt.texture; this.u.tBloom.value = this.bA.texture;
    this.pass(this.compMat, null);
  }
}
