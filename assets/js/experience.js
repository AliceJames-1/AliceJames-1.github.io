/*
  The bay: a flight over a coastal bay with a lighthouse at its heart. The drone cruises on
  autopilot until a visitor takes the controls. Six boats are out on the water; hold one inside
  the drone's sensor ring until the lock fills and it opens a chapter from "The work". Every
  target acquired sends a teammate drone to join the swarm. Keep an eye out for the whale.

  Needs WebGL. Without it, or with reduced motion, the page shows a still scene and the six
  targets as plain buttons.
*/
import * as THREE from '/assets/vendor/three/three.module.min.js';
import { Sound } from '/assets/js/sound.js';

const root = document.getElementById('experience');
const canvas = document.getElementById('xp-canvas');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

/* ---------- Shared: the target list and the side panel ---------- */

let sideTimer = null;
function showSide(btn, countText) {
  const side = document.getElementById('xp-side');
  if (!side || !btn) return;
  document.getElementById('xp-side-count').textContent = countText || '';
  document.getElementById('xp-side-name').textContent = btn.dataset.name;
  document.getElementById('xp-side-headline').textContent = btn.dataset.headline || '';
  document.getElementById('xp-side-summary').textContent = btn.dataset.summary || '';
  document.getElementById('xp-side-more').setAttribute('href', '#mind-' + btn.dataset.id);
  side.hidden = false;
  side.classList.remove('is-in'); void side.offsetWidth; side.classList.add('is-in');
  clearTimeout(sideTimer);
  sideTimer = setTimeout(() => { side.hidden = true; }, 9000);
}
(function () {
  const close = document.getElementById('xp-side-close');
  if (close) close.addEventListener('click', () => { document.getElementById('xp-side').hidden = true; });
})();

function setupStaticSignals() {
  document.querySelectorAll('.xp-signal').forEach((btn) => {
    btn.addEventListener('click', () => showSide(btn));
  });
}

/* ---------- Noise for the islands ---------- */

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return v;
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/* Islets: small rocky islands inside the bay, clear of the boat routes */
const ISLETS = [
  { x: 0, z: 0, r: 13, h: 9 },       // the lighthouse rock
  { x: -158, z: 62, r: 16, h: 11 },
  { x: 132, z: -118, r: 14, h: 8 },
  { x: -40, z: -150, r: 11, h: 6 }
];
/* Terrain height. Below 0 is under water. The bay is open in the middle and ringed by hills. */
function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  const ring = smoothstep(150, 215, d + (fbm(x * 0.008 + 7, z * 0.008) - 0.5) * 90);
  let h = -9 + ring * (14 + (fbm(x * 0.013, z * 0.013) - 0.4) * 55);
  for (const s of ISLETS) {
    const k = Math.exp(-Math.pow(Math.hypot(x - s.x, z - s.z) / s.r, 2));
    h = Math.max(h, -9 + k * (s.h + 9) * (0.85 + fbm(x * 0.09, z * 0.09) * 0.3));
  }
  return h;
}

/* Waves: the same sum of sines runs in the water shader and here, so boats ride the swell */
const WAVES = [
  [0.060, 0.000, 0.36, 0.9],
  [0.041, 0.031, 0.28, 0.7],
  [-0.022, 0.071, 0.20, 1.1],
  [0.110, -0.090, 0.08, 1.7]
];
function waveHeight(x, z, t) {
  let h = 0;
  for (const [kx, kz, a, w] of WAVES) h += Math.sin(x * kx + z * kz + t * w) * a;
  return h;
}

/* ---------- Random with a fixed seed so the bay is the same for everyone ---------- */
let seed = 20261119;
function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }

/* ---------- Palettes for night (dark theme) and golden hour (light theme) ---------- */
const PALETTES = {
  dark: {
    skyTop: 0x030a18, skyBottom: 0x16335a, fog: 0x0e2038, fogDensity: 0.0040,
    deep: 0x07223d, shallow: 0x17507c, sparkle: 1, sparkleColor: 0x7cf3ff,
    sun: 0xc9dcff, sunI: 0.55, sunDisc: 0.9, hemiSky: 0x7f9cc8, hemiGround: 0x0e1828, hemi: 0.75,
    sand: 0x5e584c, grass: 0x23432f, rock: 0x3c4450, leaf: 0x183a27,
    beacon: 0x7cc8ff, stars: 1, beam: 1, exposure: 1.05, hull: 0xd8dee6, wake: 0.55
  },
  light: {
    skyTop: 0x5f97cf, skyBottom: 0xf5d9bb, fog: 0xd9e2e6, fogDensity: 0.0030,
    deep: 0x2a77a6, shallow: 0x58b0cf, sparkle: 0, sparkleColor: 0xffffff,
    sun: 0xfff0d6, sunI: 1.25, sunDisc: 1.2, hemiSky: 0xffffff, hemiGround: 0x5a6a50, hemi: 1.0,
    sand: 0xdcc89a, grass: 0x6b955a, rock: 0x8c8781, leaf: 0x3f6e3e,
    beacon: 0x1f6fd1, stars: 0, beam: 0.18, exposure: 1.0, hull: 0xffffff, wake: 0.8
  }
};

const LOCK_R = 11;       // sensor footprint radius on the water, metres
const LOCK_TIME = 2.2;   // seconds of continuous tracking to acquire a target
const LOCK_ALT = 34;     // the sensor cannot resolve a boat from higher than this
const RANGE = 235;       // edge of the test range

function start() {
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a182c, 0.0042);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1400);
  const sunDir = new THREE.Vector3(-0.45, 0.32, 0.83).normalize();

  /* Sky dome: vertical gradient with a sun (or moon) and its glow */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
      sunDir: { value: sunDir }, sunCol: { value: new THREE.Color() }, sunAmt: { value: 1 }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vP;
      void main(){
        float h = smoothstep(-0.05, 0.6, vP.y);
        vec3 c = mix(bottom, top, h);
        float s = max(dot(normalize(vP), sunDir), 0.0);
        c += sunCol * (smoothstep(0.9985, 0.9993, s) * 1.4 + pow(s, 12.0) * 0.28) * sunAmt;
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
  scene.add(sky);

  /* Stars */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const th = rand() * Math.PI * 2, ph = Math.acos(0.12 + rand() * 0.88);
    const r = 950;
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = r * Math.cos(ph);
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xdfe9ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* Lights */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.copy(sunDir).multiplyScalar(300);
  scene.add(sun);

  /* Islands */
  const SIZE = 760, SEG = 150;
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const heights = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i++) { const h = terrainHeight(gp.getX(i), gp.getZ(i)); heights[i] = h; gp.setY(i, h); }
  groundGeo.computeVertexNormals();
  const groundCol = new Float32Array(gp.count * 3);
  groundGeo.setAttribute('color', new THREE.BufferAttribute(groundCol, 3));
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  scene.add(new THREE.Mesh(groundGeo, groundMat));

  /* Trees on the higher ground */
  const trees = [];
  let tries = 0;
  const TREE_COUNT = isTouch ? 380 : 650;
  while (trees.length < TREE_COUNT && tries < 30000) {
    tries++;
    const x = (rand() - 0.5) * SIZE * 0.9, z = (rand() - 0.5) * SIZE * 0.9;
    const h = terrainHeight(x, z);
    if (h < 2.5 || h > 30) continue;
    if (Math.hypot(x, z) < 20) continue;
    if (fbm(x * 0.03 + 11, z * 0.03) < 0.42) continue;
    trees.push({ x, z, y: h, s: 3 + rand() * 4 });
  }
  const leafGeo = new THREE.ConeGeometry(1, 1, 6);
  leafGeo.translate(0, 0.5, 0);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, trees.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  trees.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m4.compose(v3.set(t.x, t.y - 0.4, t.z), q, sc.set(t.s * 0.38, t.s * 1.5, t.s * 0.38));
    leaves.setMatrixAt(i, m4);
  });
  scene.add(leaves);

  /* Water: a swell of sines, fresnel sky reflection, a sun glint and, at night, bioluminescence */
  const waveUniform = WAVES.map((w) => new THREE.Vector4(w[0], w[1], w[2], w[3]));
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }, waves: { value: waveUniform },
      deep: { value: new THREE.Color() }, shallow: { value: new THREE.Color() }, skyCol: { value: new THREE.Color() },
      sunDir: { value: sunDir }, sunCol: { value: new THREE.Color() },
      fogCol: { value: new THREE.Color() }, fogDensity: { value: 0.004 },
      sparkle: { value: 0 }, sparkleCol: { value: new THREE.Color() }
    },
    vertexShader: `
      uniform float time; uniform vec4 waves[4];
      varying vec3 vW; varying vec3 vN;
      float wave(vec2 p){ float h = 0.0; for (int i = 0; i < 4; i++) { h += sin(p.x*waves[i].x + p.y*waves[i].y + time*waves[i].w) * waves[i].z; } return h; }
      void main(){
        vec3 p = position;
        vec4 w = modelMatrix * vec4(p, 1.0);
        float h = wave(w.xz);
        float hx = wave(w.xz + vec2(0.6, 0.0)), hz = wave(w.xz + vec2(0.0, 0.6));
        vN = normalize(vec3(h - hx, 0.6, h - hz));
        w.y += h;
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyCol; uniform vec3 sunDir; uniform vec3 sunCol;
      uniform vec3 fogCol; uniform float fogDensity; uniform float sparkle; uniform vec3 sparkleCol;
      varying vec3 vW; varying vec3 vN;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 c = mix(deep, shallow, clamp(0.35 + 2.5 * N.x, 0.0, 1.0));
        c = mix(c, skyCol, clamp(fres * 0.9, 0.0, 0.85));
        vec3 R = reflect(-sunDir, N);
        c += sunCol * pow(max(dot(R, V), 0.0), 140.0) * 1.6;
        if (sparkle > 0.0) {
          vec2 g = vW.xz * 0.9;
          vec2 cell = floor(g);
          float n = hash(cell);
          vec2 o = vec2(hash(cell + 7.1), hash(cell + 3.7)) * 0.6 + 0.2;
          float glint = smoothstep(0.09, 0.0, length(fract(g) - o));
          float tw = pow(0.5 + 0.5 * sin(time * (0.8 + n * 1.6) + n * 40.0), 6.0);
          c += sparkleCol * step(0.8, n) * glint * tw * 0.8 * sparkle * (1.0 - smoothstep(60.0, 160.0, length(cameraPosition - vW)));
        }
        float d = length(cameraPosition - vW);
        float f = 1.0 - exp(-fogDensity * fogDensity * d * d);
        gl_FragColor = vec4(mix(c, fogCol, f), 1.0);
      }`
  });
  const waterGeo = new THREE.PlaneGeometry(1600, 1600, isTouch ? 120 : 170, isTouch ? 120 : 170);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  scene.add(water);

  /* The lighthouse on its rock, with a turning beam */
  const lighthouse = new THREE.Group();
  const lhBase = terrainHeight(0, 0);
  lighthouse.position.set(0, lhBase - 0.5, 0);
  const lhWhite = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6 });
  const lhRed = new THREE.MeshStandardMaterial({ color: 0xc8372d, roughness: 0.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 18, 18), lhWhite);
  tower.position.y = 9;
  const band1 = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.42, 3, 18), lhRed); band1.position.y = 5;
  const band2 = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.12, 3, 18), lhRed); band2.position.y = 12;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 18), new THREE.MeshStandardMaterial({ color: 0x23272d }));
  gallery.position.y = 18.2;
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c2 });
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 14), lampMat);
  lamp.position.y = 19.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.2, 14), lhRed);
  cap.position.y = 21.7;
  lighthouse.add(tower, band1, band2, gallery, lamp, cap);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { strength: { value: 1 } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float strength; varying float vY; void main(){ gl_FragColor = vec4(1.0, 0.93, 0.72, pow(vY, 2.2) * 0.38 * strength); }'
  });
  const beamGeo = new THREE.CylinderGeometry(0.6, 9, 120, 20, 1, true);
  beamGeo.translate(0, -60, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 19.5;
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat); beamB.rotation.y = Math.PI;
  beamPivot.add(beamA, beamB);
  lighthouse.add(beamPivot);
  const lampLight = new THREE.PointLight(0xffe6a8, 8, 50, 2);
  lampLight.position.y = 19.5;
  lighthouse.add(lampLight);
  scene.add(lighthouse);

  /* Drones */
  function mat(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.45, metalness: 0.2 }, opts || {})); }
  function glowMat(color, opacity) { return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity: opacity == null ? 1 : opacity, side: THREE.DoubleSide, depthWrite: opacity == null || opacity >= 1 }); }
  function buildMulti(arms, scale, led, shellColor) {
    const d = new THREE.Group();
    const dark = mat(0x1b2328, { metalness: 0.4, roughness: 0.55 });
    const shell = mat(shellColor, { emissive: 0x2a3a4c, metalness: 0.15, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.5, arms), shell);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, arms), dark);
    top.position.y = 0.38;
    d.add(body, top);
    const props = [];
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 2.2), dark);
      arm.position.set(Math.sin(a) * 1.1, 0.05, Math.cos(a) * 1.1); arm.rotation.y = a;
      const mx = Math.sin(a) * 2.15, mz = Math.cos(a) * 2.15;
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10), dark);
      motor.position.set(mx, 0.2, mz);
      const prop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 0.14), glowMat(0x9aa7ad, 0.55));
      prop.position.set(mx, 0.38, mz);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), glowMat(0xbfd0d6, 0.12));
      disc.rotation.x = -Math.PI / 2; disc.position.copy(prop.position);
      const ledM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat(led));
      ledM.position.set(mx, 0.0, mz);
      d.add(arm, motor, prop, disc, ledM);
      props.push(prop);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.06), glowMat(led));
    strip.position.set(0, 0.05, 1.02);
    const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), dark);
    gimbal.position.set(0, -0.38, 0.55);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), glowMat(led));
    lens.position.set(0, -0.38, 0.84);
    d.add(strip, gimbal, lens);
    d.scale.setScalar(scale);
    return { group: d, animate: (dt) => props.forEach((p, i) => { p.rotation.y += dt * (i % 2 ? -42 : 42); }) };
  }

  const LEADER_LED = 0x7cc8ff;
  const leader = buildMulti(4, 1, LEADER_LED, 0xe6ebf0);
  const frame = new THREE.Group(); // position + yaw
  const tilt = new THREE.Group(); // pitch + roll
  tilt.add(leader.group);
  frame.add(tilt);
  const spot = new THREE.SpotLight(0xd8ecff, 40, 70, 0.6, 0.6, 1.4);
  spot.position.set(0, -0.3, 0.4);
  spot.target.position.set(0, -10, 2);
  frame.add(spot, spot.target);
  const glow = new THREE.PointLight(LEADER_LED, 5, 14, 2);
  glow.position.set(0, 0.6, 0);
  frame.add(glow);
  scene.add(frame);

  /* Sensor footprint: a cone from the drone down to the water */
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color() }, alpha: { value: 0.3 }, time: { value: 0 } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 color; uniform float alpha; uniform float time; varying float vY; void main(){ float bands = 0.75 + 0.25*sin(vY*28.0 - time*5.0); gl_FragColor = vec4(color, pow(1.0 - vY, 1.6) * alpha * bands); }'
  });
  const coneGeo = new THREE.ConeGeometry(1, 1, 40, 1, true);
  coneGeo.translate(0, -0.5, 0); // tip at the drone, base on the water
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.visible = false;
  scene.add(cone);

  /* Targets: six boats, each on its own loop around the bay */
  const ROUTES = [
    (t) => [Math.cos(t) * 55, Math.sin(t) * 45],
    (t) => [20 + Math.cos(t) * 95, -10 + Math.sin(t) * 75],
    (t) => [-10 + Math.cos(t) * 128, 15 + Math.sin(t) * 108],
    (t) => [Math.sin(t) * 100, 75 + Math.sin(t * 2) * 48],
    (t) => [-62 + Math.cos(t) * 44, -62 + Math.sin(t) * 34],
    (t) => [72 + Math.cos(t) * 38, 48 + Math.sin(t) * 52]
  ];
  const SPEEDS = [0.05, -0.034, 0.024, 0.03, 0.062, -0.05];
  const lockRingMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color() }, done: { value: new THREE.Color() }, progress: { value: 0 }, time: { value: 0 }, alpha: { value: 1 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 color; uniform vec3 done; uniform float progress; uniform float time; uniform float alpha; varying vec2 vP;
      void main(){
        float a = atan(vP.y, vP.x) / 6.28318 + 0.5;
        float filled = step(a, progress);
        float dash = step(0.5, fract(a * 36.0 + time * 0.4));
        float al = mix(0.45 * dash, 0.95, filled) * alpha;
        gl_FragColor = vec4(mix(color, done, filled), al);
      }`
  });
  const ringGeo = new THREE.RingGeometry(LOCK_R - 0.55, LOCK_R, 96, 1);
  const wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 1.2, -4.5, 0, -14, 4.5, 0, -14]), 3));
  wakeGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.5, 1, 0, 0, 1, 0]), 2));
  const wakeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { strength: { value: 0.7 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float strength; varying vec2 vU; void main(){ float edge = 1.0 - abs(vU.x - 0.5) * 2.0; float a = vU.y * (0.35 + 0.65 * smoothstep(0.55, 1.0, 1.0 - edge)) * strength; gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.55); }'
  });
  const hullMat = mat(0xffffff, { roughness: 0.5 });
  const deckMat = mat(0x8a6a4a, { roughness: 0.8 });
  const darkMat = mat(0x22282e);
  function buildBoat(kind) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 0.9, 7, 6, 1), hullMat);
    hull.rotation.x = Math.PI / 2; hull.scale.set(1, 1, 0.55); hull.position.y = 0.3;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.4, 6), hullMat);
    bow.rotation.x = Math.PI / 2; bow.position.set(0, 0.3, 4.6); bow.scale.set(1, 1, 0.55);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.15, 6.4), deckMat); deck.position.y = 1.0;
    b.add(hull, bow, deck);
    if (kind % 3 === 0) {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2.2), hullMat); cabin.position.set(0, 1.7, -0.6);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.4, 1.4), darkMat); glass.position.set(0, 2.0, -0.2);
      b.add(cabin, glass);
    } else if (kind % 3 === 1) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 8, 6), darkMat); mast.position.set(0, 5, 0.6);
      const sailGeo = new THREE.BufferGeometry();
      sailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1.3, 0.5, 0, 8.8, 0.7, 0, 1.3, -3.2]), 3));
      sailGeo.computeVertexNormals();
      const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({ color: 0xf6f2e8, side: THREE.DoubleSide, roughness: 0.9 }));
      b.add(mast, sail);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 1.8), mat(0xe2a33a)); box.position.set(0, 1.5, -1.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), darkMat); pole.position.set(0, 2.5, 1.4);
      b.add(box, pole);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    beacon.position.set(0, kind % 3 === 1 ? 9.1 : 4.1, kind % 3 === 1 ? 0.7 : (kind % 3 === 0 ? -0.6 : 1.4));
    b.add(beacon);
    const wake = new THREE.Mesh(wakeGeo, wakeMat);
    wake.position.set(0, 0.05, -3);
    b.add(wake);
    return { group: b, beacon };
  }

  const signalButtons = Array.from(document.querySelectorAll('.xp-signal'));
  const signals = signalButtons.map((btn, i) => {
    const boat = buildBoat(i);
    scene.add(boat.group);
    const ring = new THREE.Mesh(ringGeo, lockRingMat.clone());
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    const t0 = rand() * Math.PI * 2;
    return { id: btn.dataset.id, name: btn.dataset.name, btn, route: ROUTES[i % ROUTES.length], w: SPEEDS[i % SPEEDS.length], t: t0, x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: 0, lock: 0, found: false, boat, ring };
  });
  function placeBoats(time, dt) {
    signals.forEach((s) => {
      s.t += s.w * dt;
      const [x, z] = s.route(s.t);
      const [x2, z2] = s.route(s.t + Math.sign(s.w) * 0.01);
      if (dt > 0) { s.vx = (x - s.x) / dt; s.vz = (z - s.z) / dt; }
      s.x = x; s.z = z;
      s.heading = Math.atan2(x2 - x, z2 - z);
      s.y = waveHeight(x, z, time);
      const g = s.boat.group;
      g.position.set(x, s.y, z);
      g.rotation.set((waveHeight(x, z + 3, time) - waveHeight(x, z - 3, time)) * -0.12, s.heading, (waveHeight(x + 1.5, z, time) - waveHeight(x - 1.5, z, time)) * 0.12, 'YXZ');
      s.ring.position.set(x, s.y + 0.35, z);
    });
  }
  placeBoats(0, 0);

  /* Teammates: one more drone joins the swarm for every target acquired */
  const FORMATION = [[-7, 1.2, 1], [7, 1.2, 1], [-13, 2.4, -3], [13, 2.4, -3], [0, 5, 4], [0, 8, -2]];
  const MATE_LEDS = [0xff8f6b, 0x6fe3b5, 0xffc65c, 0xc58bff, 0xff6fa8, 0xa3dbff];
  const mates = [];
  function addMate() {
    const i = mates.length;
    if (i >= FORMATION.length) return;
    const m = buildMulti(i % 2 ? 6 : 4, 0.62, MATE_LEDS[i], 0xf2f0ea);
    const off = FORMATION[i];
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    m.group.position.set(frame.position.x - fz * off[0] * 4 + fx * -40, frame.position.y + 30, frame.position.z + fx * off[0] * 4 + fz * -40);
    scene.add(m.group);
    mates.push(m);
  }
  function clearMates() { mates.forEach((m) => scene.remove(m.group)); mates.length = 0; }

  /* Gulls circling the headlands */
  const gulls = [];
  const gullMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide, fog: true });
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const wings = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.45), gullMat);
      w.rotation.x = -Math.PI / 2; w.position.x = s * 0.8;
      pivot.add(w); pivot.userData.s = s; g.add(pivot); return pivot;
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), gullMat); body.scale.set(1, 1, 2.4);
    g.add(body);
    const c = ISLETS[i % ISLETS.length];
    gulls.push({ g, wings, cx: c.x + (rand() - 0.5) * 30, cz: c.z + (rand() - 0.5) * 30, r: 12 + rand() * 18, y: 22 + rand() * 16, w: (0.25 + rand() * 0.3) * (rand() < 0.5 ? -1 : 1), p: rand() * 10 });
    scene.add(g);
  }

  /* The whale: surfaces now and then, blows, and dives */
  const whale = new THREE.Group();
  const whaleMat = mat(0x2a3542, { roughness: 0.7 });
  const whaleBelly = mat(0xc7ccd2, { roughness: 0.8 });
  const wBody = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), whaleMat); wBody.scale.set(2.2, 1.6, 7.5);
  const wBellyM = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), whaleBelly); wBellyM.scale.set(2, 1.2, 6.5); wBellyM.position.y = -0.6;
  const flukePivot = new THREE.Group(); flukePivot.position.z = -7;
  const fluke = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 1.8), whaleMat); fluke.position.z = -1.2;
  flukePivot.add(fluke);
  whale.add(wBody, wBellyM, flukePivot);
  whale.visible = false;
  scene.add(whale);

  /* ---------- Sparks: bursts when a target is acquired, fireworks when all six are ---------- */
  const SPARKS = 1800;
  const spGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(SPARKS * 3), spCol = new Float32Array(SPARKS * 3), spLife = new Float32Array(SPARKS);
  const spVel = new Float32Array(SPARKS * 3);
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  spGeo.setAttribute('life', new THREE.BufferAttribute(spLife, 1));
  const spMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { scale: { value: 1 } },
    vertexShader: `
      attribute vec3 color; attribute float life; uniform float scale; varying vec3 vC; varying float vL;
      void main(){ vC = color; vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = life > 0.0 ? min(9.0, max(1.5, scale * 0.45 * (0.4 + life) / -mv.z)) : 0.0;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      varying vec3 vC; varying float vL;
      void main(){ if (vL <= 0.0) discard; float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d);
        gl_FragColor = vec4(vC, a * min(1.0, vL * 1.6)); }`
  });
  const sparks = new THREE.Points(spGeo, spMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let spNext = 0;
  const burstColour = new THREE.Color();
  function burst(x, y, z, count, speed, hexes, up, gravity) {
    for (let k = 0; k < count; k++) {
      const i = spNext; spNext = (spNext + 1) % SPARKS;
      spPos[i * 3] = x; spPos[i * 3 + 1] = y; spPos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.55 + Math.random() * 0.45);
      spVel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      spVel[i * 3 + 1] = Math.cos(ph) * s + (up || 0);
      spVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      burstColour.setHex(hexes[k % hexes.length]);
      spCol[i * 3] = burstColour.r; spCol[i * 3 + 1] = burstColour.g; spCol[i * 3 + 2] = burstColour.b;
      spLife[i] = 1 + Math.random() * 0.6;
    }
  }
  function updateSparks(dt) {
    const drag = Math.pow(0.4, dt);
    for (let i = 0; i < SPARKS; i++) {
      if (spLife[i] <= 0) continue;
      spLife[i] -= dt * 0.55;
      spVel[i * 3 + 1] -= 6 * dt;
      spVel[i * 3] *= drag; spVel[i * 3 + 1] *= drag; spVel[i * 3 + 2] *= drag;
      spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
    }
    spGeo.attributes.position.needsUpdate = true;
    spGeo.attributes.life.needsUpdate = true;
    spGeo.attributes.color.needsUpdate = true;
  }

  /* ---------- Theme ---------- */
  function applyPalette() {
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const p = PALETTES[theme];
    skyMat.uniforms.top.value.setHex(p.skyTop);
    skyMat.uniforms.bottom.value.setHex(p.skyBottom);
    skyMat.uniforms.sunCol.value.setHex(p.sun);
    skyMat.uniforms.sunAmt.value = p.sunDisc;
    scene.fog.color.setHex(p.fog);
    scene.fog.density = p.fogDensity;
    renderer.setClearColor(p.fog);
    const sand = new THREE.Color(p.sand), grass = new THREE.Color(p.grass), rock = new THREE.Color(p.rock), c = new THREE.Color();
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      if (h < 1.2) c.copy(sand).lerp(rock, smoothstep(-3, -8, h) * 0.6);
      else if (h < 3) c.copy(sand).lerp(grass, smoothstep(1.2, 3, h));
      else c.copy(grass).lerp(rock, smoothstep(10, 26, h));
      groundCol[i * 3] = c.r; groundCol[i * 3 + 1] = c.g; groundCol[i * 3 + 2] = c.b;
    }
    groundGeo.attributes.color.needsUpdate = true;
    leafMat.color.setHex(p.leaf);
    hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = p.hemi;
    sun.color.setHex(p.sun); sun.intensity = p.sunI;
    waterMat.uniforms.deep.value.setHex(p.deep);
    waterMat.uniforms.shallow.value.setHex(p.shallow);
    waterMat.uniforms.skyCol.value.setHex(p.skyBottom);
    waterMat.uniforms.sunCol.value.setHex(p.sun);
    waterMat.uniforms.fogCol.value.setHex(p.fog);
    waterMat.uniforms.fogDensity.value = p.fogDensity;
    waterMat.uniforms.sparkle.value = p.sparkle;
    waterMat.uniforms.sparkleCol.value.setHex(p.sparkleColor);
    starMat.opacity = p.stars;
    stars.visible = p.stars > 0;
    beamMat.uniforms.strength.value = p.beam;
    lampLight.intensity = theme === 'dark' ? 8 : 0;
    hullMat.color.setHex(p.hull);
    wakeMat.uniforms.strength.value = p.wake;
    coneMat.uniforms.color.value.setHex(p.beacon);
    signals.forEach((s) => {
      const col = won ? 0xffc65c : s.found ? (theme === 'dark' ? 0xffffff : 0x0f2238) : p.beacon;
      s.boat.beacon.material.color.setHex(won ? 0xffc65c : s.found ? 0xffffff : p.beacon);
      s.ring.material.uniforms.color.value.setHex(col);
      s.ring.material.uniforms.done.value.setHex(won ? 0xffc65c : theme === 'dark' ? 0xff8f6b : 0xd9532f);
    });
    renderer.toneMappingExposure = p.exposure;
    spot.intensity = theme === 'dark' ? 40 : 6;
    glow.intensity = theme === 'dark' ? 5 : 1.2;
    gullMat.color.setHex(theme === 'dark' ? 0x9aa6b4 : 0xf7f7f2);
    palette = p;
  }
  let palette = PALETTES.dark;
  let won = false;
  applyPalette();
  new MutationObserver(applyPalette).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- Flight state ---------- */
  const state = {
    x: 10, z: -70, alt: 20, yaw: 0, vx: 0, vz: 0, vy: 0, yawRate: 0,
    mode: 'intro', bump: 0, target: null, lastInput: 0,
    clock: 0, timing: false, celebrate: 0, locking: null, slipWarn: 0, rangeHint: false,
    whale: null, whaleNext: 14, whaleSeen: false
  };
  const keys = new Set();
  const touch = { fwd: 0, turn: 0, up: 0 };

  /* Autopilot: a slow loop around the bay, high over the water */
  const route = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 92 + Math.sin(i * 1.9) * 22;
    route.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(route, true, 'catmullrom', 0.5);
  let routeT = 0.75;

  /* ---------- DOM: HUD ---------- */
  const hud = {
    alt: document.getElementById('hud-alt'), spd: document.getElementById('hud-spd'),
    lock: document.getElementById('hud-lock'), lockBar: document.getElementById('hud-lock-bar'),
    found: document.getElementById('hud-found'), mode: document.getElementById('hud-mode'),
    toast: document.getElementById('xp-toast'), radar: document.getElementById('xp-radar'),
    markers: document.getElementById('xp-markers'), clock: document.getElementById('hud-time'),
    swarm: document.getElementById('hud-swarm')
  };
  const radarCtx = hud.radar ? hud.radar.getContext('2d') : null;
  const markers = signals.map(() => {
    const el = document.createElement('div');
    el.className = 'xp-marker';
    el.innerHTML = '<span class="xp-marker-dot"></span><span class="xp-marker-text"></span>';
    hud.markers.appendChild(el);
    return el;
  });

  let toastTimer = null;
  function toast(text, ms) {
    if (!hud.toast) return;
    hud.toast.textContent = text;
    hud.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hud.toast.classList.remove('is-on'), ms || 3200);
  }

  function updateFound() {
    const n = signals.filter((s) => s.found).length;
    if (hud.found) hud.found.textContent = n + ' of ' + signals.length;
    if (hud.swarm) hud.swarm.textContent = String(1 + mates.length);
    root.classList.toggle('xp-complete', n === signals.length);
    return n;
  }

  function setMode(mode) {
    state.mode = mode;
    root.dataset.mode = mode;
    if (hud.mode) hud.mode.textContent = mode === 'pilot' ? 'Manual' : mode === 'seek' ? 'Autopilot: tracking target' : 'Autopilot';
  }
  setMode('intro');

  /* Sound: off until the visitor asks for it or takes the controls */
  const sound = new Sound();
  const soundBtns = Array.from(document.querySelectorAll('.xp-sound'));
  let soundPref = null;
  try { soundPref = localStorage.getItem('sound'); } catch (e) {}
  function setSound(on, remember) {
    const ok = sound.set(on);
    soundBtns.forEach((b) => {
      b.setAttribute('aria-pressed', ok ? 'true' : 'false');
      b.setAttribute('aria-label', ok ? 'Turn music off' : 'Turn music on');
      b.classList.toggle('is-on', !!ok);
    });
    if (remember) { soundPref = on ? 'on' : 'off'; try { localStorage.setItem('sound', soundPref); } catch (e) {} }
  }
  soundBtns.forEach((b) => b.addEventListener('click', () => setSound(!sound.on, true)));
  function startTiming() { if (!state.timing && !won) { state.timing = true; } }

  /* Buttons */
  const takeBtn = document.getElementById('xp-take');
  const exitBtn = document.getElementById('xp-exit');
  if (takeBtn) takeBtn.addEventListener('click', () => {
    setMode('pilot');
    state.lastInput = performance.now();
    startTiming();
    if (soundPref !== 'off' && !sound.on) setSound(true, false);
    root.focus({ preventScroll: true });
    toast(isTouch ? 'Left stick to fly, right buttons to climb. Hover over a boat until the lock fills.' : 'W A S D to fly, Space and Shift to climb and descend. Hover over a boat until the lock fills.', 5600);
  });
  if (exitBtn) exitBtn.addEventListener('click', () => { setMode('intro'); keys.clear(); });

  signals.forEach((s) => {
    s.btn.addEventListener('click', () => {
      if (s.found || reduceMotion) { showSide(s.btn, s.found ? 'Acquired' : ''); return; }
      state.target = s;
      startTiming();
      if (soundPref !== 'off' && !sound.on) setSound(true, false);
      setMode('seek');
      toast('Autopilot: tracking the ' + s.name.toLowerCase() + ' boat.', 2600);
    });
  });

  /* Keyboard */
  const FLIGHT_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE'];
  window.addEventListener('keydown', (e) => {
    if (state.mode !== 'pilot' && state.mode !== 'seek') return;
    if (!FLIGHT_KEYS.includes(e.code)) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!inView) return;
    e.preventDefault();
    if (state.mode === 'seek') { setMode('pilot'); state.target = null; }
    keys.add(e.code);
    state.lastInput = performance.now();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state.mode === 'pilot' || state.mode === 'seek')) { setMode('intro'); keys.clear(); state.target = null; }
  });
  window.addEventListener('blur', () => keys.clear());

  /* Touch: joystick on the left, climb and descend on the right */
  const stick = document.getElementById('xp-stick');
  const knob = document.getElementById('xp-knob');
  if (stick && knob) {
    let pid = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
      touch.turn = -dx; touch.fwd = -dy;
      knob.style.transform = 'translate(' + dx * 30 + 'px,' + dy * 30 + 'px)';
      state.lastInput = performance.now();
      if (state.mode === 'seek') { setMode('pilot'); state.target = null; }
    };
    stick.addEventListener('pointerdown', (e) => { pid = e.pointerId; stick.setPointerCapture(pid); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = () => { pid = null; touch.turn = 0; touch.fwd = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  }
  document.querySelectorAll('[data-climb]').forEach((b) => {
    const v = parseFloat(b.dataset.climb);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.up = v; state.lastInput = performance.now(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => { touch.up = 0; }));
  });

  /* ---------- Size and visibility ---------- */
  let inView = true, pageVisible = !document.hidden;
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 72 : 60;
    camera.updateProjectionMatrix();
    spMat.uniforms.scale.value = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  }
  resize();
  window.addEventListener('resize', () => { resize(); renderedStill = false; });
  new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; sound.setDuck(inView ? 1 : 0.3); }, { threshold: 0.05 }).observe(root);
  document.addEventListener('visibilitychange', () => { pageVisible = !document.hidden; sound.suspend(document.hidden); });

  /* ---------- Ground and lighthouse clearance ---------- */
  function floorAt(x, z) { return Math.max(terrainHeight(x, z), 0); }
  function lighthouseCollide() {
    const d = Math.hypot(state.x, state.z);
    const top = lhBase + 23 - floorAt(state.x, state.z);
    if (d < 4.2 && state.alt < top && d > 0.001) {
      state.x = state.x / d * 4.2; state.z = state.z / d * 4.2;
      const speed = Math.hypot(state.vx, state.vz);
      state.vx *= -0.3; state.vz *= -0.3;
      if (speed > 3 && state.bump <= 0) { state.bump = 0.35; sound.bump(); toast('That is a lighthouse. It was here first.', 2200); }
    }
  }

  /* ---------- Acquiring targets ---------- */
  function acquire(s) {
    s.found = true;
    s.lock = 1;
    s.btn.classList.add('is-found');
    s.btn.setAttribute('aria-label', s.name + ' target, acquired. Open it.');
    state.locking = null;
    addMate();
    applyPalette();
    const n = updateFound();
    sound.chime(n);
    burst(s.x, s.y + 6, s.z, 160, 14, [palette.beacon, 0xffffff, 0xff8f6b, palette.beacon], 4);
    burst(s.x, s.y + 1, s.z, 90, 8, [0xffffff, palette.beacon], 5);
    if (hud.found) { hud.found.classList.remove('is-pop'); void hud.found.offsetWidth; hud.found.classList.add('is-pop'); }
    if (state.target === s) { state.target = null; if (state.mode === 'seek') setMode('pilot'); }
    setTimeout(() => sound.whoosh(), 500);
    showSide(s.btn, 'Target ' + n + ' of ' + signals.length + ' acquired.' + (n < signals.length ? ' A teammate drone joins your swarm.' : ''));
    if (n === signals.length) setTimeout(celebrate, reduceMotion ? 0 : 1600);
  }

  /* ---------- The whale ---------- */
  function startWhale() {
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    for (let k = 0; k < 8; k++) {
      const dist = 40 + Math.random() * 30, side = (Math.random() - 0.5) * 50;
      const x = state.x + fx * dist + fz * side, z = state.z + fz * dist - fx * side;
      if (terrainHeight(x, z) < -4 && Math.hypot(x, z) > 25 && Math.hypot(x, z) < RANGE) {
        state.whale = { t: 0, x, z, yaw: Math.random() * Math.PI * 2, blown: false };
        whale.visible = true;
        return;
      }
    }
    state.whaleNext = 10;
  }
  function updateWhale(dt, time) {
    const w = state.whale; w.t += dt;
    const T = w.t;
    const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
    w.x += fx * dt * 2.2; w.z += fz * dt * 2.2;
    let y, pitch;
    if (T < 2) { y = -5 + smoothstep(0, 2, T) * 4.6; pitch = -0.08; }
    else if (T < 4.5) { y = -0.4 + Math.sin(T * 1.4) * 0.15; pitch = 0; }
    else if (T < 7) { const k = smoothstep(4.5, 7, T); y = -0.4 - k * 6; pitch = 0.35 * Math.sin(k * Math.PI) + k * 0.5; }
    else { whale.visible = false; state.whale = null; state.whaleNext = 38 + Math.random() * 30; return; }
    whale.position.set(w.x, y + waveHeight(w.x, w.z, time) * 0.5, w.z);
    whale.rotation.set(pitch, w.yaw, 0, 'YXZ');
    flukePivot.rotation.x = T > 4.5 ? smoothstep(4.5, 6.2, T) * 1.1 : Math.sin(T * 2) * 0.15;
    if (!w.blown && T > 2.4) {
      w.blown = true;
      const bx = w.x + fx * 4, bz = w.z + fz * 4;
      burst(bx, 1.2, bz, 110, 4, [0xffffff, 0xdff3ff, 0xbfe6ff], 9);
      sound.splash();
      if (!state.whaleSeen && state.mode !== 'intro') { state.whaleSeen = true; toast('Whale off the bow. Marine monitoring has its perks.', 3600); }
    }
  }

  /* ---------- All six acquired ---------- */
  const winEl = document.getElementById('xp-win');
  function fmtTime(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + String(s).padStart(2, '0'); }
  function celebrate() {
    won = true;
    state.timing = false;
    state.celebrate = 12;
    applyPalette();
    sound.win();
    signals.forEach((s, i) => setTimeout(() => burst(s.x, s.y + 24, s.z, 220, 20, [0xffc65c, 0xffffff, palette.beacon, 0xff8f6b], 6), i * 160));
    let best = null;
    try { best = parseFloat(localStorage.getItem('xp-bay-best')); } catch (e) {}
    const isBest = !best || state.clock < best;
    if (isBest) { try { localStorage.setItem('xp-bay-best', String(state.clock)); } catch (e) {} }
    const timeEl = document.getElementById('xp-win-time');
    if (timeEl) timeEl.textContent = fmtTime(state.clock) + (isBest ? ', your best yet' : ', your best is ' + fmtTime(best));
    if (winEl) setTimeout(() => {
      winEl.hidden = false;
      root.classList.add('xp-won');
      const first = winEl.querySelector('a, button');
      if (first) first.focus({ preventScroll: true });
    }, 1400);
  }
  function resetGame() {
    won = false;
    signals.forEach((s) => { s.found = false; s.lock = 0; s.btn.classList.remove('is-found'); s.btn.setAttribute('aria-label', s.name + ' target. Track it.'); });
    clearMates();
    state.clock = 0; state.timing = true; state.celebrate = 0; state.locking = null;
    if (winEl) winEl.hidden = true;
    root.classList.remove('xp-won');
    applyPalette();
    updateFound();
    setMode('pilot');
    root.focus({ preventScroll: true });
    toast('New run. The clock is ticking.', 2400);
  }
  const againBtn = document.getElementById('xp-again');
  if (againBtn) againBtn.addEventListener('click', resetGame);
  const closeWin = document.getElementById('xp-win-close');
  if (closeWin) closeWin.addEventListener('click', () => { winEl.hidden = true; root.classList.remove('xp-won'); root.focus({ preventScroll: true }); });

  /* ---------- Loop ---------- */
  let last = performance.now(), time = 0, renderedStill = false;
  const camPos = new THREE.Vector3(60, 40, -150), camLook = new THREE.Vector3();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  let fpsAvg = 60, lowered = false;

  function step(now) {
    requestAnimationFrame(step);
    if (!inView || !pageVisible) { last = now; return; }
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (reduceMotion) dt = 0;
    if (reduceMotion && renderedStill) return;
    time += dt;

    if (dt > 0) {
      fpsAvg = fpsAvg * 0.97 + (1 / Math.max(dt, 0.001)) * 0.03;
      if (!lowered && time > 4 && fpsAvg < 32) { lowered = true; renderer.setPixelRatio(1); resize(); }
    }

    placeBoats(time, dt);

    /* Inputs */
    let fwdIn = 0, turnIn = 0, upIn = 0;
    if (state.mode === 'pilot') {
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwdIn += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) fwdIn -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) turnIn += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) turnIn -= 1;
      if (keys.has('Space') || keys.has('KeyE')) upIn += 1;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyQ')) upIn -= 1;
      fwdIn += touch.fwd; turnIn += touch.turn; upIn += touch.up;
    }

    /* Autopilot: cruise the bay, or chase and hold over a chosen boat */
    if (state.mode === 'intro' || state.mode === 'seek') {
      let goal, goalAlt, seekDist = 0;
      if (state.mode === 'seek' && state.target) {
        const s = state.target;
        goal = tmp.set(s.x + s.vx * 1.2, 0, s.z + s.vz * 1.2);
        seekDist = Math.hypot(goal.x - state.x, goal.z - state.z);
        goalAlt = seekDist < 35 ? 16 : 24;
      } else {
        routeT = (routeT + dt * 0.011) % 1;
        goal = curve.getPointAt((routeT + 0.02) % 1, tmp);
        goalAlt = 26;
      }
      const want = Math.atan2(goal.x - state.x, goal.z - state.z);
      let diff = want - state.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      turnIn = Math.max(-1, Math.min(1, diff * 2.2));
      if (state.mode === 'seek') fwdIn = Math.abs(diff) < 0.6 ? Math.min(1.6, 0.12 + seekDist / 18) : (seekDist < 6 ? 0.1 : 0);
      else fwdIn = 0.55;
      upIn = Math.max(-1, Math.min(1, (goalAlt - state.alt) * 0.25));
    }

    /* Physics */
    const maxSpeed = state.mode === 'intro' ? 9 : state.mode === 'seek' ? 22 : 15;
    state.yawRate += (turnIn * 1.5 - state.yawRate) * Math.min(1, dt * 4);
    state.yaw += state.yawRate * dt;
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    state.vx += fx * fwdIn * 14 * dt; state.vz += fz * fwdIn * 14 * dt;
    const drag = Math.pow(0.35, dt);
    state.vx *= drag; state.vz *= drag;
    const sp = Math.hypot(state.vx, state.vz);
    if (sp > maxSpeed) { state.vx *= maxSpeed / sp; state.vz *= maxSpeed / sp; }
    state.vy += (upIn * 7 - state.vy) * Math.min(1, dt * 3);
    state.x += state.vx * dt; state.z += state.vz * dt; state.alt += state.vy * dt;
    state.alt = Math.max(2.5, Math.min(70, state.alt));
    const dist = Math.hypot(state.x, state.z);
    if (dist > RANGE) {
      state.x *= RANGE / dist; state.z *= RANGE / dist; state.vx *= 0.5; state.vz *= 0.5;
      if (state.mode === 'pilot') toast('Edge of the test range. The boats are back in the bay.', 2400);
    }
    if (dt > 0) lighthouseCollide();
    state.bump = Math.max(0, state.bump - dt);

    const floor = floorAt(state.x, state.z);
    frame.position.set(state.x, floor + state.alt + Math.sin(time * 2.1) * 0.08, state.z);
    frame.rotation.y = state.yaw;
    const forwardSpeed = state.vx * fx + state.vz * fz;
    tilt.rotation.x += ((forwardSpeed / maxSpeed) * 0.28 - tilt.rotation.x) * Math.min(1, dt * 5);
    tilt.rotation.z += (-state.yawRate * 0.18 - tilt.rotation.z) * Math.min(1, dt * 5);
    leader.animate(dt);

    /* Teammates hold formation behind and to the sides */
    mates.forEach((m, i) => {
      const off = FORMATION[i];
      const k = won && state.celebrate > 0 ? 1 : 0;
      const ang = time * 0.8 + (i / Math.max(1, mates.length)) * Math.PI * 2;
      const ox = k ? Math.cos(ang) * 9 : off[0], oz = k ? Math.sin(ang) * 9 : off[2], oy = k ? 3 + Math.sin(ang * 2) : off[1];
      tmp2.set(frame.position.x + fz * ox + fx * oz, frame.position.y + oy, frame.position.z - fx * ox + fz * oz);
      m.group.position.lerp(tmp2, Math.min(1, dt * 2.2));
      m.group.rotation.y += (state.yaw - m.group.rotation.y) * Math.min(1, dt * 3);
      m.group.rotation.x = tilt.rotation.x; m.group.rotation.z = tilt.rotation.z;
      m.animate(dt);
    });

    /* Sensor cone and the lock */
    const flying = state.mode !== 'intro';
    const waterY = waveHeight(state.x, state.z, time);
    const coneH = Math.max(0.5, frame.position.y - 0.4 - Math.max(waterY, terrainHeight(state.x, state.z)));
    cone.visible = flying && !reduceMotion;
    cone.position.set(state.x, frame.position.y - 0.4, state.z);
    const coneR = LOCK_R * Math.min(1, 0.45 + coneH / 30);
    cone.scale.set(coneR, coneH, coneR);
    coneMat.uniforms.time.value = time;

    let best = null, bestD = Infinity;
    if (flying && state.alt < LOCK_ALT + 6) {
      signals.forEach((s) => {
        if (s.found) return;
        const d = Math.hypot(s.x - state.x, s.z - state.z);
        if (d < LOCK_R && d < bestD) { best = s; bestD = d; }
      });
    }
    if (best && state.alt > LOCK_ALT) {
      if (state.slipWarn <= 0 && state.mode === 'pilot') { toast('Too high for the sensor. Drop below ' + LOCK_ALT + ' m.', 2200); state.slipWarn = 4; }
      best = null;
    }
    signals.forEach((s) => {
      if (s.found) return;
      if (s === best) {
        if (s.lock === 0) sound.ping();
        s.lock = Math.min(1, s.lock + dt / LOCK_TIME);
        if (!state.rangeHint && state.mode === 'pilot') { state.rangeHint = true; toast('Locking on. Keep the boat inside your sensor ring.', 2600); }
        if (s.lock >= 1) acquire(s);
      } else if (s.lock > 0) {
        if (state.locking === s && s.lock > 0.35 && state.slipWarn <= 0 && state.mode === 'pilot') { toast('Target slipping. Stay over it.', 1800); state.slipWarn = 3; }
        s.lock = Math.max(0, s.lock - dt * 0.5);
      }
    });
    state.locking = best;
    state.slipWarn = Math.max(0, state.slipWarn - dt);
    coneMat.uniforms.alpha.value = best ? 0.3 : 0.12;
    coneMat.uniforms.color.value.setHex(best ? (palette === PALETTES.dark ? 0xff8f6b : 0xd9532f) : palette.beacon);

    signals.forEach((s) => {
      s.ring.material.uniforms.progress.value = s.found ? 1 : s.lock;
      s.ring.material.uniforms.time.value = time;
      s.ring.material.uniforms.alpha.value = s.found ? 0.35 : 1;
      const pulse = s.found ? 1 : 1 + Math.sin(time * 3 + s.t) * 0.25;
      s.boat.beacon.scale.setScalar(pulse);
    });

    /* Lighthouse, gulls, whale */
    beamPivot.rotation.y = time * 0.55;
    gulls.forEach((g) => {
      const a = time * g.w + g.p;
      g.g.position.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(time * 0.7 + g.p) * 1.5, g.cz + Math.sin(a) * g.r);
      g.g.rotation.y = a + (g.w > 0 ? Math.PI : 0);
      g.g.rotation.z = g.w > 0 ? 0.25 : -0.25;
      const f = Math.sin(time * 6 + g.p) * 0.5;
      g.wings.forEach((w) => { w.rotation.z = w.userData.s * f; });
    });
    if (dt > 0) {
      if (state.whale) updateWhale(dt, time);
      else { state.whaleNext -= dt; if (state.whaleNext <= 0) startWhale(); }
    }

    if (state.timing && dt > 0) state.clock += dt;
    if (state.celebrate > 0 && dt > 0) {
      state.celebrate -= dt;
      if (Math.random() < dt * 3.2) {
        const a = Math.random() * Math.PI * 2, r = 15 + Math.random() * 40;
        burst(frame.position.x + Math.cos(a) * r, frame.position.y + 18 + Math.random() * 22, frame.position.z + Math.sin(a) * r, 140, 18,
          [[0xffc65c, 0xffffff], [0x7cc8ff, 0xffffff], [0xff8f6b, 0xffd27a], [0x6fe3b5, 0xffffff]][Math.floor(Math.random() * 4)]);
        sound.firework();
      }
    }
    if (dt > 0) updateSparks(dt);
    waterMat.uniforms.time.value = time;

    /* Camera: cinematic orbit in the intro, chase camera when flying */
    const shake = state.bump > 0 ? (Math.random() - 0.5) * state.bump * 1.2 : 0;
    if (state.mode === 'intro') {
      const a = time * 0.05;
      tmp.set(frame.position.x - Math.sin(state.yaw + 0.9 + Math.sin(a) * 0.4) * 24, frame.position.y + 8, frame.position.z - Math.cos(state.yaw + 0.9 + Math.sin(a) * 0.4) * 24);
    } else {
      tmp.set(frame.position.x - fx * 15, frame.position.y + 6.5, frame.position.z - fz * 15);
    }
    const camFloor = Math.max(floorAt(tmp.x, tmp.z), 0.8) + 2;
    if (tmp.y < camFloor) tmp.y = camFloor;
    camPos.lerp(tmp, Math.min(1, dt * 2.4) || 1);
    camLook.lerp(tmp2.set(frame.position.x + fx * 6, frame.position.y - 1, frame.position.z + fz * 6), Math.min(1, dt * 4) || 1);
    camera.position.copy(camPos); camera.position.y += shake;
    camera.lookAt(camLook);
    sky.position.copy(camera.position); stars.position.copy(camera.position);

    renderer.render(scene, camera);
    drawHud();
    if (reduceMotion) renderedStill = true;
  }

  /* ---------- HUD ---------- */
  function drawHud() {
    const speed = Math.hypot(state.vx, state.vz);
    if (hud.alt) hud.alt.textContent = state.alt.toFixed(1);
    if (hud.spd) hud.spd.textContent = speed.toFixed(1);
    if (hud.clock) hud.clock.textContent = fmtTime(state.clock);
    const lock = state.locking ? state.locking.lock : 0;
    if (hud.lock) hud.lock.textContent = Math.round(lock * 100);
    if (hud.lockBar) {
      hud.lockBar.style.transform = 'scaleX(' + lock.toFixed(3) + ')';
      hud.lockBar.classList.toggle('is-low', !!state.locking);
    }
    const w = root.clientWidth, h = root.clientHeight;
    signals.forEach((s, i) => {
      const el = markers[i];
      v3.set(s.x, s.y + 12, s.z).project(camera);
      const behind = v3.z > 1;
      const d = Math.hypot(s.x - state.x, s.z - state.z);
      if (behind || d > 260) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.style.transform = 'translate(' + ((v3.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v3.y * 0.5 + 0.5) * h).toFixed(1) + 'px)';
      el.classList.toggle('is-found', s.found);
      el.lastChild.textContent = s.found ? s.name : s.lock > 0 ? 'Lock ' + Math.round(s.lock * 100) + '%' : Math.round(d) + ' m';
    });
    if (radarCtx) {
      const c = radarCtx, R = hud.radar.width / 2;
      c.clearRect(0, 0, R * 2, R * 2);
      const styles = getComputedStyle(root);
      const ink = styles.getPropertyValue('--xp-ink').trim() || '#e8f0fa';
      const acc = styles.getPropertyValue('--xp-accent').trim() || '#7cc8ff';
      c.strokeStyle = ink; c.globalAlpha = 0.25; c.lineWidth = 1.5;
      [1, 0.66, 0.33].forEach((k) => { c.beginPath(); c.arc(R, R, (R - 3) * k, 0, Math.PI * 2); c.stroke(); });
      c.beginPath(); c.moveTo(R, 3); c.lineTo(R, R * 2 - 3); c.moveTo(3, R); c.lineTo(R * 2 - 3, R); c.stroke();
      const sweep = (time * 1.4) % (Math.PI * 2);
      c.globalAlpha = 0.18; c.fillStyle = acc; c.beginPath(); c.moveTo(R, R); c.arc(R, R, R - 3, sweep - 0.6, sweep); c.closePath(); c.fill();
      c.globalAlpha = 1;
      const scale = (R - 8) / 240;
      const plot = (x, z, col, rad, alpha) => {
        const dx = x - state.x, dz = z - state.z;
        const rx = dx * Math.cos(-state.yaw) - dz * Math.sin(-state.yaw);
        const rz = dx * Math.sin(-state.yaw) + dz * Math.cos(-state.yaw);
        let px = -rx * scale, py = -rz * scale;
        const len = Math.hypot(px, py); if (len > R - 8) { px *= (R - 8) / len; py *= (R - 8) / len; }
        c.fillStyle = col; c.globalAlpha = alpha;
        c.beginPath(); c.arc(R + px, R + py, rad, 0, Math.PI * 2); c.fill();
      };
      plot(0, 0, ink, 2.5, 0.6); // the lighthouse
      signals.forEach((s) => plot(s.x, s.z, s.found ? ink : acc, s.found ? 3 : 4.5, s.found ? 0.5 : 1));
      c.globalAlpha = 1; c.fillStyle = ink;
      c.beginPath(); c.moveTo(R, R - 7); c.lineTo(R + 5, R + 5); c.lineTo(R, R + 2); c.lineTo(R - 5, R + 5); c.closePath(); c.fill();
    }
  }

  updateFound();
  root.classList.add('xp-ready');
  if (reduceMotion) {
    /* One still frame from a good angle; the targets work as plain buttons. */
    root.classList.add('xp-still');
    camPos.set(70, 34, -120);
  }
  requestAnimationFrame((t) => { last = t; step(t); });
}

if (root && canvas) {
  if (!webglAvailable()) {
    root.classList.add('xp-static');
    setupStaticSignals();
  } else {
    try { start(); } catch (e) { root.classList.add('xp-static'); setupStaticSignals(); }
  }
}
