// Athena's Brain in real 3D (three.js, bundled in static/vendor so it works offline).
// A living nebula of thousands of particles around her glowing core; her real memories, lessons, library entries,
// reflections and skills are the bright stars inside it, linked where they're related. Real bloom, depth and a
// slowly drifting camera. Same panels, styles, timeline and live activity as before; if this PC can't do WebGL the
// app falls back to the flat version (brain.js).

import * as THREE from './vendor/three/three.module.min.js';
import { EffectComposer } from './vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/postprocessing/OutputPass.js';
import { THEMES, CLUSTERS, build, template, rgba, esc } from './brain.js';

let ui = null;
const col3 = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);

function spriteTexture(kind = 'dot') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (kind === 'dot') {
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  } else { // her memory stars: a crisp bright point with only a small halo
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.1, 'rgba(255,255,255,.95)');
    g.addColorStop(0.22, 'rgba(255,255,255,.35)'); g.addColorStop(0.45, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  if (kind === 'star') { // a four-point twinkle
    for (const [w, h] of [[128, 5], [5, 128]]) {
      const s = x.createLinearGradient(64 - w / 2, 64 - h / 2, 64 + w / 2, 64 + h / 2);
      s.addColorStop(0, 'rgba(255,255,255,0)'); s.addColorStop(0.5, 'rgba(255,255,255,.9)'); s.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = s; x.fillRect(64 - w / 2, 64 - h / 2, w, h);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft glowing particles that twinkle, with per-particle size, color and visibility
function pointsMaterial(map, { size = 1, twinkle = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: map }, time: { value: 0 }, scale: { value: size }, grow: { value: 1 }, twinkle: { value: twinkle } },
    vertexShader: `
      attribute float size; attribute vec3 color; attribute float seed; attribute float show;
      uniform float time, scale, grow, twinkle; varying vec3 vColor; varying float vAlpha;
      void main() {
        vec3 p = position * grow;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 1.0 - twinkle * 0.45 * (0.5 + 0.5 * sin(time * (1.0 + seed * 2.0) + seed * 40.0));
        gl_PointSize = size * scale * tw * (60.0 / -mv.z) * (0.55 + 0.45 * clamp(2.2 - (-mv.z) / 5.5, 0.0, 1.0)) * show;
        vColor = color; vAlpha = clamp(2.2 - (-mv.z) / 5.5, 0.18, 1.0) * show;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
      void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha); }`,
  });
}

export function openBrain({ api, onAsk, toast, style = 'athena', onStyle } = {}) {
  if (ui) { ui.el.hidden = false; ui.setStyle(style); ui.start(); ui.reload(); return true; }
  const el = document.createElement('div');
  el.className = 'brain-view brain-3d';
  el.innerHTML = template();
  const canvas = el.querySelector('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch { return false; } // no WebGL here: the app uses the flat version
  document.body.appendChild(el);
  const $b = (k) => el.querySelector(`[data-b="${k}"]`);
  const small = Math.min(innerWidth, innerHeight) < 700;
  renderer.setPixelRatio(Math.min(small ? 1.5 : 2, devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.5, 0.22);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerWidth < innerHeight ? 68 : 50; // phones: see the whole brain
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const dotTex = spriteTexture('dot'), starTex = spriteTexture('star'), nodeTex = spriteTexture('node');
  const view = { yaw: 0.5, pitch: 0.18, dist: 11, targetDist: 8.6, focus: new THREE.Vector3(), focusTo: new THREE.Vector3(),
    drag: null, energy: 0.2, hidden: new Set(), cutoff: Infinity, boot: 0 };
  let theme = THEMES[style] || THEMES.athena;
  let data = null, map = { nodes: [], hubs: {}, links: [], t0: 0 };
  let world = new THREE.Group(); scene.add(world);
  let nodePoints = null, pulses = [], hover = null, pinned = null;
  const R = 2.3; // how far her memories sit from the core

  // ---------------------------------------------------------- scene building (redone when the style changes)
  function rebuild() {
    scene.remove(world);
    world.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    world = new THREE.Group(); scene.add(world);
    scene.background = col3(theme.spiral ? [8, 10, 20] : theme.node === 'dot' ? [2, 7, 14] : [9, 11, 22]);
    scene.fog = new THREE.FogExp2(scene.background, theme.spiral ? 0.075 : 0.035); // far lines fade into the dark: depth
    const cl = theme.clusters;
    const palette = Object.values(cl).map(col3);

    // far background stars (not in the Athena style: a clean background)
    if (!theme.spiral) {
      const n = 2600, pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), seed = new Float32Array(n), show = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 40;
        pos.set([Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r, Math.sqrt(1 - u * u) * Math.sin(a) * r], i * 3);
        size[i] = 0.6 + Math.random() * 1.6; seed[i] = Math.random();
        const c = theme.stars ? new THREE.Color().setHSL(0.11 + Math.random() * 0.05, 0.5, 0.75 + Math.random() * 0.2) : new THREE.Color().setHSL(0.55, 0.5, 0.7);
        color.set([c.r, c.g, c.b], i * 3);
      }
      const g = new THREE.BufferGeometry();
      for (const [k, arr, d] of [['position', pos, 3], ['size', size, 1], ['color', color, 3], ['seed', seed, 1], ['show', show, 1]]) g.setAttribute(k, new THREE.BufferAttribute(arr, d));
      const m = pointsMaterial(dotTex, { size: 0.9 });
      world.add(new THREE.Points(g, m)).userData.kind = 'sky';
    }

    if (theme.jarvis) buildJarvis();
    // the nebula: thousands of particles around her core, so her mind always looks full
    // (a galaxy spiral in the Athena style, a soft round cloud otherwise)
    if (!theme.jarvis) {
      const n = small ? 5000 : 11000, pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), seed = new Float32Array(n), show = new Float32Array(n).fill(1);
      const tmp = new THREE.Color();
      for (let i = 0; i < n; i++) {
        let p;
        if (false) { // (spiral arms: removed)
          const arm = i % 5, t = Math.pow(Math.random(), 0.7), a = arm * (Math.PI * 2 / 5) + t * 3.6 + (Math.random() - 0.5) * 0.5;
          const r = 0.35 + t * 3.4;
          p = [Math.cos(a) * r, (Math.random() - 0.5) * 0.35 * (1.2 - t), Math.sin(a) * r];
          tmp.copy(palette[arm]).lerp(new THREE.Color(1, 1, 1), 0.15 * (1 - t));
        } else { // a soft round cloud of light around her core
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 0.4 + Math.pow(Math.random(), 1.4) * (theme.spiral ? 2.6 : 3.4);
          p = [Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r * 0.85, Math.sqrt(1 - u * u) * Math.sin(a) * r];
          tmp.copy(palette[Math.floor(Math.random() * palette.length)]).lerp(new THREE.Color(1, 1, 1), 0.15).multiplyScalar(theme.spiral ? 0.5 : 0.7);
        }
        pos.set(p, i * 3);
        size[i] = 0.25 + Math.random() * 0.9; seed[i] = Math.random();
        tmp.multiplyScalar(0.4); color.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
      const g = new THREE.BufferGeometry();
      for (const [k, arr, d] of [['position', pos, 3], ['size', size, 1], ['color', color, 3], ['seed', seed, 1], ['show', show, 1]]) g.setAttribute(k, new THREE.BufferAttribute(arr, d));
      const nebula = new THREE.Points(g, pointsMaterial(dotTex, { size: 0.55, twinkle: 0.6 }));
      nebula.rotation.x = theme.spiral ? 0.42 : 0.35; nebula.userData.kind = 'nebula';
      world.add(nebula);
    }

    // her core: a white-hot center, a soft shell and spinning rings
    const coreCol = col3(theme.core[1]);
    const core = new THREE.Mesh(new THREE.SphereGeometry(theme.spiral ? 0.075 : theme.jarvis ? 0.22 : 0.16, 48, 48), new THREE.MeshBasicMaterial({ color: col3(theme.core[3]).multiplyScalar(theme.spiral ? 1.6 : theme.jarvis ? 2.2 : 1.3) }));
    core.userData.kind = 'core'; world.add(core);
    if (theme.spiral) buildEnergyCore(coreCol);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.42, 48, 48), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { c: { value: coreCol }, e: { value: 0.3 }, k: { value: theme.spiral ? 0.3 : 1 } },
      vertexShader: 'varying vec3 n; varying vec3 v; void main(){ n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); v = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; uniform float e, k; varying vec3 n; varying vec3 v; void main(){ float f = pow(1.0-abs(dot(n,v)), 2.5); gl_FragColor = vec4(c*(1.2+e*2.0), f*(0.8+e)*k); }',
    }));
    shell.userData.kind = 'shell'; world.add(shell);
    for (let i = 0; i < (theme.jarvis ? 0 : 3); i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.13, 0.006, 8, 160), new THREE.MeshBasicMaterial({ color: coreCol.clone().multiplyScalar(1.6), transparent: true, opacity: 0.7 }));
      ring.rotation.set(Math.random() * 3, Math.random() * 3, 0); ring.userData = { kind: 'coreRing', spin: (i % 2 ? -1 : 1) * (0.4 + i * 0.25) };
      world.add(ring);
    }

    // style extras
    const hud = col3(theme.hud);
    if (theme.globe && !theme.jarvis) { // a wireframe globe and big HUD rings
      const globe = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 1.12, 3)), new THREE.LineBasicMaterial({ color: hud, transparent: true, opacity: 0.06 }));
      globe.userData.kind = 'globe'; world.add(globe);
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * (1.35 + i * 0.12), 0.004 + i * 0.002, 6, 256, Math.PI * (1.2 + i * 0.3)), new THREE.MeshBasicMaterial({ color: hud, transparent: true, opacity: 0.35 - i * 0.08 }));
        ring.rotation.x = Math.PI / 2 + 0.25; ring.userData = { kind: 'hudRing', spin: 0.05 * (i % 2 ? -1 : 1) * (i + 1) };
        world.add(ring);
      }
    }
    if (theme.rings === 'armillary') { // golden armillary rings
      for (const [rx, rz, r, w, spin] of [[Math.PI / 2, 0, 1.25, 0.012, 0.12], [Math.PI / 2 - 0.41, 0.2, 1.18, 0.02, -0.08], [0, 0, 1.3, 0.008, 0], [0, Math.PI / 2, 1.3, 0.006, 0]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * r, w * 0.6, 10, 220), new THREE.MeshBasicMaterial({ color: hud.clone().multiplyScalar(0.8), transparent: true, opacity: 0.55 }));
        ring.rotation.set(rx, 0, rz); ring.userData = { kind: 'armRing', spin };
        world.add(ring);
      }
    }
    if (theme.rings === 'thin') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.45, 0.004, 6, 256), new THREE.MeshBasicMaterial({ color: hud, transparent: true, opacity: 0.3 }));
      ring.rotation.x = Math.PI / 2 + 0.3; ring.userData = { kind: 'hudRing', spin: 0.02 };
      world.add(ring);
    }

    // her real memories as bright stars, hubs, and the links between related things
    buildNodes();
  }

  // Athena's core: a see-through ball of gold energy with layers turning different ways, so it has real depth
  // instead of being one flat glowing blob
  function buildEnergyCore(coreCol) {
    const gold = col3(theme.hud);
    const plasma = new THREE.Mesh(new THREE.SphereGeometry(0.3, 64, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { c: { value: coreCol }, time: { value: 0 }, e: { value: 0.3 } },
      vertexShader: 'varying vec3 p; varying vec3 n; varying vec3 v; void main(){ p = position; n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); v = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: `uniform vec3 c; uniform float time, e; varying vec3 p; varying vec3 n; varying vec3 v;
        void main(){
          vec3 q = p * 9.0;
          float w = sin(q.x + time * 1.3 + sin(q.y * 1.7 - time)) + sin(q.y * 1.3 - time * 0.9 + sin(q.z * 1.5 + time * 0.7)) + sin(q.z * 1.1 + time * 1.1 + sin(q.x * 1.9));
          float bands = pow(1.0 - abs(w) / 3.0, 6.0);
          float rim = pow(1.0 - abs(dot(n, v)), 2.0);
          gl_FragColor = vec4(c * (0.9 + e), (bands * 0.4 + rim * 0.12) * (0.55 + e * 0.6));
        }`,
    }));
    plasma.userData.kind = 'plasma'; world.add(plasma);
    for (const [geo, op, spin] of [[new THREE.IcosahedronGeometry(0.2, 1), 0.5, [0.35, 0.5]], [new THREE.IcosahedronGeometry(0.36, 0), 0.32, [-0.22, -0.3]], [new THREE.OctahedronGeometry(0.5, 0), 0.16, [0.12, -0.18]]]) {
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: gold.clone().multiplyScalar(1.3), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      wire.userData = { kind: 'coreWire', spin }; world.add(wire);
    }
    // three thin orbits around the core at different tilts (real 3D circles, not a flat badge)
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46 + i * 0.09, 0.0035, 6, 160), new THREE.MeshBasicMaterial({ color: gold.clone().multiplyScalar(1.4), transparent: true, opacity: 0.6 - i * 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.set(0.6 + i * 0.9, i * 1.3, 0.3 * i); ring.userData = { kind: 'coreRing', spin: (i % 2 ? -1 : 1) * (0.35 + i * 0.2) };
      world.add(ring);
    }
  }

  // Jarvis: a holographic globe of latitude/longitude lines, a cloud of data points on its surface, segmented
  // rings orbiting at different tilts, and an arc-reactor core
  function buildJarvis() {
    const cyan = col3(theme.hud), orange = col3(theme.orange);
    const line = (pts, color, opacity) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    };
    const globe = new THREE.Group(); globe.userData.kind = 'globe'; globe.visible = !theme.spiral; // Athena: the galaxy instead of a wire globe
    const gr = R * 1.12;
    for (let i = 1; i < 12; i++) { // latitudes
      const lat = -Math.PI / 2 + (i * Math.PI) / 12, pts = [];
      for (let k = 0; k <= 96; k++) { const a = (k / 96) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(a) * gr, Math.sin(lat) * gr, Math.cos(lat) * Math.sin(a) * gr)); }
      globe.add(line(pts, cyan, i === 6 ? 0.45 : 0.13));
    }
    for (let i = 0; i < 16; i++) { // longitudes
      const lon = (i / 16) * Math.PI * 2, pts = [];
      for (let k = 0; k <= 64; k++) { const a = -Math.PI / 2 + (k / 64) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * Math.cos(lon) * gr, Math.sin(a) * gr, Math.cos(a) * Math.sin(lon) * gr)); }
      globe.add(line(pts, cyan, i % 4 ? 0.1 : 0.22));
    }
    const ico = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 0.78, 2)), new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
    globe.add(ico);
    world.add(globe);
    // data points scattered over the globe's surface and inside it
    if (!theme.spiral) {
      const n = small ? 1800 : 3600, pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), seed = new Float32Array(n), show = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = i % 3 ? gr * (0.99 + Math.random() * 0.03) : gr * Math.pow(Math.random(), 0.5) * 0.95;
        pos.set([Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r, Math.sqrt(1 - u * u) * Math.sin(a) * r], i * 3);
        size[i] = 0.25 + Math.random() * 0.6; seed[i] = Math.random();
        const c = Math.random() < 0.08 ? orange : cyan;
        color.set([c.r * 0.45, c.g * 0.45, c.b * 0.45], i * 3);
      }
      const g = new THREE.BufferGeometry();
      for (const [k, arr, d] of [['position', pos, 3], ['size', size, 1], ['color', color, 3], ['seed', seed, 1], ['show', show, 1]]) g.setAttribute(k, new THREE.BufferAttribute(arr, d));
      const dust = new THREE.Points(g, pointsMaterial(dotTex, { size: 0.5, twinkle: 0.8 }));
      dust.userData.kind = 'dust'; world.add(dust);
    }
    // segmented rings orbiting at different tilts (orange accents)
    for (const [r, tube, segs, tiltX, tiltZ, spin, color, op] of [
      [1.32, 0.012, 5, 1.2, 0.3, 0.25, cyan, 0.75], [1.42, 0.006, 9, 1.75, -0.4, -0.18, cyan, 0.55],
      [1.5, 0.018, 2, 0.5, 0.9, 0.35, orange, 0.9], [1.25, 0.004, 1, 1.57, 0, 0.1, cyan, 0.4]]
      .filter((r) => !(theme.spiral && (r[6] === orange || r[1] > 0.01)))
      .map((r) => (theme.spiral ? [r[0], 0.0028, r[2], r[3], r[4], r[5], r[6], r[7] * 0.55] : r))) {
      const grp = new THREE.Group(); grp.rotation.set(tiltX, 0, tiltZ);
      for (let s = 0; s < segs; s++) {
        const arc = segs === 1 ? Math.PI * 2 : (Math.PI * 2 / segs) * (0.55 + 0.25 * ((s * 7) % 3) / 2);
        const m = new THREE.Mesh(new THREE.TorusGeometry(R * r, tube, 6, 160, arc), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(theme.spiral ? 1.1 : 1.4), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.rotation.z = (s / segs) * Math.PI * 2;
        grp.add(m);
      }
      const holder = new THREE.Group(); holder.add(grp); holder.userData = { kind: 'jRing', spin, grp };
      world.add(holder);
    }
    // the arc-reactor core: rings and three glowing segments, always facing you (Athena has her 3D energy core instead)
    if (theme.spiral) return;
    const reactor = new THREE.Group(); reactor.userData.kind = 'reactor';
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    reactor.add(new THREE.Mesh(new THREE.RingGeometry(0.34, 0.36, 96), mat(cyan.clone().multiplyScalar(2), 0.9)));
    reactor.add(new THREE.Mesh(new THREE.RingGeometry(0.42, 0.425, 96), mat(cyan, 0.6)));
    for (let i = 0; i < 3; i++) reactor.add(new THREE.Mesh(new THREE.RingGeometry(0.24, 0.31, 32, 1, i * (Math.PI * 2 / 3) + 0.15, Math.PI * 2 / 3 - 0.3), mat(cyan.clone().multiplyScalar(1.6), 0.85)));
    for (let i = 0; i < 10; i++) reactor.add(new THREE.Mesh(new THREE.RingGeometry(0.37, 0.4, 4, 1, i * (Math.PI / 5), Math.PI / 5 - 0.12), mat(cyan, 0.5)));
    world.add(reactor);
  }

  // ---------------------------------------------------------- the Jarvis heads-up display, drawn crisp on top
  const hudCanvas = el.querySelector('.brain-hud');
  const hx = hudCanvas.getContext('2d');
  const bars = Array.from({ length: 18 }, () => Math.random());
  function sizeHud() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    hudCanvas.width = innerWidth * dpr; hudCanvas.height = innerHeight * dpr;
    hx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeHud();
  addEventListener('resize', sizeHud);
  let hexPattern = null;
  function drawHud(t, boot) {
    hx.clearRect(0, 0, innerWidth, innerHeight);
    if (!theme.jarvis) return;
    const C = theme.hud, O = theme.orange, a = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
    if (!hexPattern) { // faint hexagon grid behind everything
      const p = document.createElement('canvas'); p.width = 52; p.height = 90;
      const q = p.getContext('2d'); q.strokeStyle = `rgba(${theme.hud.join(',')},0.05)`; q.lineWidth = 1;
      const hex = (cx2, cy2, r) => { q.beginPath(); for (let k = 0; k < 6; k++) { const an = Math.PI / 6 + k * Math.PI / 3; q.lineTo(cx2 + Math.cos(an) * r, cy2 + Math.sin(an) * r); } q.closePath(); q.stroke(); };
      hex(26, 15, 15); hex(0, 60, 15); hex(52, 60, 15);
      hexPattern = hx.createPattern(p, 'repeat');
    }
    if (!theme.spiral) { hx.fillStyle = hexPattern; hx.fillRect(0, 0, innerWidth, innerHeight); }
    // where her globe is on screen
    const c = new THREE.Vector3(0, 0, 0).project(camera), edge = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(R * 1.12).add(view.focus).project(camera);
    const cx = (c.x + 1) / 2 * innerWidth, cy = (1 - c.y) / 2 * innerHeight;
    const Rp = Math.abs((edge.x - c.x) / 2 * innerWidth) || 200;
    hx.save(); hx.translate(cx, cy);
    const e = view.energy;
    // 1. degree ring with ticks and numbers (classic Jarvis only)
    if (!theme.spiral) {
    hx.save(); hx.rotate(t * 0.03);
    hx.strokeStyle = a(C, 0.5 * boot); hx.lineWidth = 1; hx.beginPath(); hx.arc(0, 0, Rp * 1.18, 0, Math.PI * 2 * boot); hx.stroke();
    hx.font = '600 9px "Segoe UI", system-ui, sans-serif'; hx.textAlign = 'center'; hx.fillStyle = a(C, 0.7 * boot);
    for (let i = 0; i < 180; i++) {
      const an = (i / 180) * Math.PI * 2, long = i % 5 === 0, r1 = Rp * 1.18, r2 = r1 + (long ? 9 : 4);
      hx.strokeStyle = a(C, (long ? 0.6 : 0.25) * boot); hx.beginPath(); hx.moveTo(Math.cos(an) * r1, Math.sin(an) * r1); hx.lineTo(Math.cos(an) * r2, Math.sin(an) * r2); hx.stroke();
      if (i % 15 === 0) { hx.save(); hx.rotate(an + Math.PI / 2); hx.fillText(String(i * 2).padStart(3, '0'), 0, -r1 - 14); hx.restore(); }
    }
    hx.restore();
    }
    // 2. thick segmented arcs (classic Jarvis only)
    if (!theme.spiral) {
    hx.save(); hx.rotate(-t * 0.08);
    hx.lineWidth = 6; hx.lineCap = 'butt';
    for (let s = 0; s < 7; s++) { const s0 = (s / 7) * Math.PI * 2; hx.strokeStyle = a(C, (0.35 + 0.2 * (s % 2)) * boot); hx.beginPath(); hx.arc(0, 0, Rp * 1.32, s0, s0 + 0.62 * boot); hx.stroke(); }
    hx.restore();
    }
    // 3. orange accent arcs and markers (classic Jarvis only)
    if (!theme.spiral) {
    hx.save(); hx.rotate(t * (0.25 + e * 0.6));
    hx.lineWidth = 3; hx.strokeStyle = a(O, 0.9 * boot);
    for (const s0 of [0.3, 3.4]) { hx.beginPath(); hx.arc(0, 0, Rp * 1.4, s0, s0 + 0.5); hx.stroke(); }
    hx.fillStyle = a(O, 0.9 * boot);
    for (const s0 of [0.3, 3.4]) { hx.save(); hx.rotate(s0); hx.beginPath(); hx.moveTo(Rp * 1.45, 0); hx.lineTo(Rp * 1.45 + 8, -4); hx.lineTo(Rp * 1.45 + 8, 4); hx.fill(); hx.restore(); }
    hx.restore();
    }
    // 4. outer dashed ring with labels riding on it (classic Jarvis only)
    if (!theme.spiral) {
    hx.save(); hx.rotate(-t * 0.015);
    hx.setLineDash([2, 6]); hx.strokeStyle = a(C, 0.35 * boot); hx.lineWidth = 1; hx.beginPath(); hx.arc(0, 0, Rp * 1.55, 0, Math.PI * 2); hx.stroke(); hx.setLineDash([]);
    hx.font = '600 9px "Segoe UI", system-ui, sans-serif'; hx.fillStyle = a(C, 0.75 * boot);
    const counts = data ? [data.memories?.length || 0, data.lessons?.length || 0, data.library?.length || 0] : [0, 0, 0];
    [['NEURAL LINK', 0.4], [`MEM.BANK ${String(counts[0]).padStart(3, '0')}`, 1.9], [`LIB ${String(counts[2]).padStart(4, '0')}`, 3.3], [`SYNC ${Math.round(98 + e * 2)}%`, 4.6]].forEach(([txt, an]) => {
      hx.save(); hx.rotate(an); hx.translate(Rp * 1.55, 0); hx.rotate(Math.PI / 2); hx.fillText(txt, 0, -6); hx.restore();
    });
    hx.restore();
    }
    // 5. radar sweep inside the globe (classic Jarvis only)
    if (hx.createConicGradient && !theme.spiral) {
      const sg = hx.createConicGradient((t * 0.8) % (Math.PI * 2), 0, 0);
      sg.addColorStop(0, a(C, 0.16 * boot)); sg.addColorStop(0.07, a(C, 0)); sg.addColorStop(1, a(C, 0));
      hx.fillStyle = sg; hx.beginPath(); hx.arc(0, 0, Rp * 1.12, 0, Math.PI * 2); hx.fill();
    }
    // 6. crosshair brackets
    hx.strokeStyle = a(C, 0.6 * boot); hx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      if (k % 2 && innerWidth < innerHeight) continue; // phones: the top and bottom ticks would cross the title and timeline
      hx.save(); hx.rotate(k * Math.PI / 2); hx.beginPath(); hx.moveTo(Rp * 1.66, 0); hx.lineTo(Rp * 1.82, 0); hx.moveTo(Rp * 1.66, -6); hx.lineTo(Rp * 1.66, 6); hx.stroke(); hx.restore(); }
    hx.restore();
    // 7. neural activity bars (left)
    const bx = 34, by = innerHeight - 250;
    if (innerWidth > 760) {
      hx.font = '600 9.5px "Segoe UI", system-ui, sans-serif'; hx.textAlign = 'left'; hx.fillStyle = a(C, 0.8);
      hx.fillText('NEURAL ACTIVITY', bx, by - 10);
      bars.forEach((v, i) => {
        bars[i] = Math.max(0.05, Math.min(1, v + (Math.random() - 0.5) * (0.08 + e * 0.3)));
        const h = bars[i] * 46 * (0.4 + e * 0.6 + 0.2);
        hx.fillStyle = i % 6 === 0 ? a(O, 0.85) : a(C, 0.65); hx.fillRect(bx + i * 8, by + 50 - h, 5, h);
      });
      hx.strokeStyle = a(C, 0.35); hx.strokeRect(bx - 4, by - 2, 18 * 8 + 6, 56);
      // 8. her voice waveform
      const wy = by + 92;
      hx.fillStyle = a(C, 0.8); hx.fillText('VOICE', bx, wy - 22);
      for (const [amp, sp, col, w] of [[1, 3, C, 1.6], [0.6, 5.3, O, 1]]) {
        hx.beginPath();
        for (let k = 0; k <= 150; k++) { const xx = bx + k; const yy = wy + Math.sin(k * 0.12 + t * sp) * Math.sin(k * 0.031 + t) * (4 + 16 * e) * amp; k ? hx.lineTo(xx, yy) : hx.moveTo(xx, yy); }
        hx.strokeStyle = a(col, 0.8); hx.lineWidth = w; hx.stroke();
      }
    }
    // 9. boot sequence text
    if (view.boot < 1) {
      const bootY = Math.max(innerHeight * 0.55, el.querySelector('.brain-foot').getBoundingClientRect().top - 4 * 16 - 10); // just above the timeline
      const lines = ['INITIALIZING NEURAL MAP', 'LOADING MEMORY BANKS', 'LINKING KNOWLEDGE GRAPH', 'ATHENA ONLINE'];
      hx.font = '600 11px "Segoe UI", system-ui, sans-serif'; hx.textAlign = 'center';
      lines.forEach((ln, i) => {
        const p = view.boot * 5 - i;
        if (p <= 0) return;
        hx.fillStyle = i === lines.length - 1 ? a(O, Math.min(1, p) * (1 - view.boot * 0.6)) : a(C, Math.min(1, p) * (1 - view.boot));
        hx.fillText(ln.slice(0, Math.floor(ln.length * Math.min(1, p))) + (p < 1 ? '▌' : ''), innerWidth / 2, bootY + i * 16);
      });
    }
  }

  function buildNodes() {
    if (!data) return;
    map = build(data, theme);
    const nodes = map.nodes;
    const n = nodes.length;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), seed = new Float32Array(n), show = new Float32Array(n);
    nodes.forEach((nd, i) => {
      const depth = 0.72 + ((i * 7919) % 97) / 97 * 0.55; // different distances from her core, so they don't bunch up
      nd.p3 = new THREE.Vector3(...nd.pos).multiplyScalar(R * depth);
      pos.set([nd.p3.x, nd.p3.y, nd.p3.z], i * 3);
      size[i] = nd.size * 0.9; seed[i] = Math.random();
      const c = col3(nd.color).multiplyScalar(1.05); color.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    for (const [k, arr, d] of [['position', pos, 3], ['size', size, 1], ['color', color, 3], ['seed', seed, 1], ['show', show, 1]]) g.setAttribute(k, new THREE.BufferAttribute(arr, d));
    nodePoints = new THREE.Points(g, pointsMaterial(theme.node === 'star' ? starTex : nodeTex, { size: theme.spiral ? 1.15 : 0.85, twinkle: 0.25 }));
    nodePoints.userData.kind = 'nodes';
    world.add(nodePoints);
    // hubs
    for (const hub of Object.values(map.hubs)) {
      hub.p3 = new THREE.Vector3(...hub.pos).multiplyScalar(R);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshBasicMaterial({ color: col3(hub.color).multiplyScalar(2.5) }));
      s.position.copy(hub.p3); s.userData = { kind: 'hub', key: hub.key }; world.add(s);
    }
    // lines: core → hub → node (faint), and curved links between related memories
    const lp = [], lc = [];
    const push = (a, b, c, alpha, c2 = c) => { lp.push(a.x, a.y, a.z, b.x, b.y, b.z); lc.push(c.r * alpha, c.g * alpha, c.b * alpha, c2.r * alpha, c2.g * alpha, c2.b * alpha); };
    const zero = new THREE.Vector3();
    // the Athena style tints every line in its section's color (a little richer, so they don't all add up to white)
    const tint = (c) => (theme.spiral ? col3(c).offsetHSL(0, 0.25, -0.12) : col3(c));
    for (const hub of Object.values(map.hubs)) push(zero, hub.p3, tint(hub.color), 0.55);
    for (const nd of nodes) push(map.hubs[nd.cluster].p3, nd.p3, tint(nd.color), theme.spiral ? 0.4 : 0.16);
    map.curves = [];
    for (const [a, b] of map.links) {
      const mid = a.p3.clone().add(b.p3).multiplyScalar(0.32);
      const curve = new THREE.QuadraticBezierCurve3(a.p3, mid, b.p3);
      map.curves.push({ curve, a, b });
      const pts = curve.getPoints(16), ca = tint(a.color), cb = tint(b.color);
      for (let i = 0; i < pts.length - 1; i++) {
        if (!theme.spiral) { push(pts[i], pts[i + 1], col3(theme.flow), 0.22); continue; }
        push(pts[i], pts[i + 1], ca.clone().lerp(cb, i / 16), 0.42, ca.clone().lerp(cb, (i + 1) / 16));
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.userData.kind = 'lines'; world.add(lines);
    applyVisibility();
  }

  function applyVisibility() {
    if (!nodePoints) return;
    const show = nodePoints.geometry.getAttribute('show');
    map.nodes.forEach((nd, i) => { show.array[i] = !view.hidden.has(nd.cluster) && (!nd.time || nd.time <= view.cutoff) ? 1 : 0; });
    show.needsUpdate = true;
  }

  // ---------------------------------------------------------- panels (same as the flat version)
  function setStyle(key) {
    theme = THEMES[key] || THEMES.athena;
    view.targetDist = theme.spiral ? 6.4 : 8.6; // Athena: closer, so her mind fills the screen
    el.dataset.style = THEMES[key] ? key : 'athena';
    el.style.setProperty('--hud', theme.hud.join(','));
    el.style.setProperty('--hud-text', theme.text);
    el.style.setProperty('--hud-accent', theme.accent);
    el.style.background = '#000';
    el.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === el.dataset.style));
    hexPattern = null; // redrawn in this style's color
    rebuild();
    if (data) paintPanels();
  }
  async function reload() {
    try { data = await api('/api/brain'); } catch (e) { $b('sub').textContent = `OFFLINE: ${e.message}`; return; }
    rebuild();
    paintPanels();
  }
  function paintPanels() {
    const c = data.core;
    $b('sub').textContent = `${c.brain.toUpperCase()} · ${c.engine.toUpperCase()} · ${c.state === 'ready' || c.engine === 'Ollama' ? 'ONLINE' : c.state.toUpperCase()}`;
    const count = (k) => (data[k] || []).length;
    $b('stats').innerHTML = '<button type="button" class="bs-head" title="Show or hide">VITALS <i>▾</i></button>' + [['MEMORIES', count('memories'), 'about'], ['LESSONS', count('lessons'), 'lessons'],
      ['LIBRARY', count('library'), 'library'], ['REFLECTIONS', count('reflections'), 'reflections'],
      ['SKILLS', count('skills'), 'skills'], ['LINKS', map.links.length, null]]
      .map(([k, n, cl]) => `<div class="bs-row"${cl ? ` style="--c:${rgba(theme.clusters[cl], 1)}"` : ''}><span>${k}</span><b>${n}</b></div>`).join('') +
      `<div class="bs-row"><span>PERSONALITY</span><b>${esc(c.persona.toUpperCase())}</b></div>`;
    $b('legend').innerHTML = Object.entries(CLUSTERS).map(([k, cl]) =>
      `<button type="button" data-cl="${k}" class="${view.hidden.has(k) ? 'off' : ''}" style="--c:${rgba(theme.clusters[k], 1)}">${cl.label}</button>`).join('');
    updateTime();
  }
  function updateTime() {
    const v = +$b('time').value;
    if (v >= 1000) { view.cutoff = Infinity; $b('when').textContent = 'NOW'; }
    else {
      view.cutoff = map.t0 + (Date.now() / 1000 - map.t0) * (v / 1000);
      $b('when').textContent = new Date(view.cutoff * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
    applyVisibility();
  }

  function showCard(nd) {
    pinned = nd;
    const card = $b('card');
    if (!nd) { card.hidden = true; view.focusTo.set(0, 0, 0); view.targetDist = theme.spiral ? 6.4 : 8.6; return; }
    view.focusTo.copy(nd.p3).multiplyScalar(0.55); view.targetDist = 6; // glide toward it
    const deletable = { memories: (id) => `/api/memories/${id}`, lessons: (id) => `/api/lessons/${id}`, library: (id) => `/api/library/${id}` }[nd.kind];
    const when = nd.time ? new Date(nd.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const related = map.links.filter(([a, b]) => a === nd || b === nd).map(([a, b, w]) => ({ other: a === nd ? b : a, w })).slice(0, 5);
    card.style.setProperty('--c', rgba(nd.color, 1));
    card.innerHTML = `<div class="bc-head"><span>${esc(CLUSTERS[nd.cluster].label.toUpperCase())}${nd.for ? ` · ${esc(String(nd.for).toUpperCase())}` : ''}</span><button type="button" data-x>✕</button></div>
      <p>${esc(nd.text)}</p>
      ${nd.lessons?.length ? `<p class="bc-sub">Learned: ${nd.lessons.map(esc).join(' · ')}</p>` : ''}
      ${related.length ? `<div class="bc-sub">LINKED TO ${related.map((r) => `<em>${esc(r.other.text.slice(0, 40))}</em> <span>(${esc(r.w)})</span>`).join(', ')}</div>` : ''}
      <div class="bc-foot"><span>${esc(when)}</span>${deletable ? '<button type="button" data-del>DELETE</button>' : ''}</div>`;
    card.hidden = false;
    card.querySelector('[data-x]').onclick = () => showCard(null);
    const del = card.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      try { await api(deletable(nd.id), { method: 'DELETE' }); toast?.('Deleted from her mind'); showCard(null); reload(); }
      catch (e) { toast?.(e.message, 'error'); }
    };
  }

  // ---------------------------------------------------------- live signals
  function fire(cluster, count = 6) {
    const hub = map.hubs[cluster];
    if (!hub?.p3) return;
    const pool = map.nodes.filter((nd) => nd.cluster === cluster);
    for (let i = 0; i < Math.min(count, Math.max(1, pool.length)); i++) {
      const target = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: col3(hub.color).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      m.scale.setScalar(0.22);
      scene.add(m);
      pulses.push({ m, via: hub.p3, to: target?.p3 || hub.p3, t: 0, speed: 0.6 + Math.random() * 0.5, target });
    }
  }

  // a soft spark drifting along a random link (or out to a memory) even when she's idle
  function idleSpark() {
    const useLink = map.curves?.length && Math.random() < 0.6;
    if (!useLink && !map.nodes.length) return;
    const pick = useLink ? map.curves[Math.floor(Math.random() * map.curves.length)] : null;
    const nd = pick ? (Math.random() < 0.5 ? pick.a : pick.b) : map.nodes[Math.floor(Math.random() * map.nodes.length)];
    if (!pick && !map.hubs[nd.cluster]?.p3) return;
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: col3(nd.color).multiplyScalar(1.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    m.scale.setScalar(0.13);
    scene.add(m);
    pulses.push({ m, curve: pick?.curve, back: pick && nd === pick.a, via: map.hubs[nd.cluster]?.p3, to: nd.p3, t: pick ? 0 : 0.5, speed: 0.35 + Math.random() * 0.3 });
  }

  // ---------------------------------------------------------- input
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.12;
  const mouse = new THREE.Vector2(9, 9);
  canvas.addEventListener('pointerdown', (e) => { view.drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    view.mouseXY = [e.clientX, e.clientY];
    if (!view.drag) return;
    const dx = e.clientX - view.drag.x, dy = e.clientY - view.drag.y;
    view.drag.moved += Math.abs(dx) + Math.abs(dy);
    view.yaw -= dx * 0.005; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + dy * 0.005));
    view.drag.x = e.clientX; view.drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', () => { if (view.drag && view.drag.moved < 6) showCard(hover || null); view.drag = null; });
  canvas.addEventListener('pointerleave', () => mouse.set(9, 9));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.targetDist = Math.max(2.4, Math.min(14, view.targetDist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  $b('time').addEventListener('input', updateTime);
  // the stats panel folds away so it doesn't cover her brain (remembered on this device)
  try { $b('stats').classList.toggle('min', localStorage.getItem('athena.brainStats') === 'min'); } catch { /* no storage here */ }
  $b('stats').addEventListener('click', (e) => {
    if (!e.target.closest('.bs-head')) return;
    const min = $b('stats').classList.toggle('min');
    try { localStorage.setItem('athena.brainStats', min ? 'min' : ''); } catch { /* fine */ }
  });
  $b('legend').addEventListener('click', (e) => {
    const k = e.target.closest('[data-cl]')?.dataset.cl;
    if (!k) return;
    view.hidden.has(k) ? view.hidden.delete(k) : view.hidden.add(k);
    e.target.closest('[data-cl]').classList.toggle('off');
    applyVisibility();
  });
  $b('styles').addEventListener('click', (e) => {
    const k = e.target.closest('[data-style]')?.dataset.style;
    if (!k) return;
    setStyle(k); view.boot = 0; view.dist = 12; onStyle?.(k);
  });
  $b('ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $b('ask').querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    $b('feed').innerHTML = `<div class="bf-you">&gt; ${esc(text)}</div><div class="bf-her" data-b="her">…</div>`;
    view.energy = 1; fire('about', 3); fire('lessons', 3);
    onAsk?.(text);
  });
  const close = () => { el.hidden = true; };
  el.querySelector('.brain-close').onclick = close;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) { if (pinned) showCard(null); else close(); } });

  // ---------------------------------------------------------- the loop
  const clock = new THREE.Clock();
  let raf = 0;
  // switched to another window (a game, say) or minimized: stop drawing completely, so she uses no graphics power
  const asleep = () => document.hidden || !document.hasFocus();
  const wake = () => { if (!el.hidden && !raf && !asleep()) { clock.getDelta(); raf = requestAnimationFrame(frame); } };
  addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  function frame() {
    if (el.hidden || asleep()) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    view.boot = Math.min(1, view.boot + dt / 2.2);
    const boot = 1 - Math.pow(1 - view.boot, 3);
    view.energy = Math.max(0.15, view.energy - dt * 0.6);
    if (!view.drag) view.yaw += dt * (theme.spiral ? 0.14 : 0.05);
    view.dist += (view.targetDist - view.dist) * Math.min(1, dt * 2.5);
    if (innerWidth < innerHeight) view.targetDist = Math.max(view.targetDist, theme.spiral ? 8.5 : 10.5); // phones: the globe and its rings fit
    view.focus.lerp(view.focusTo, Math.min(1, dt * 2.5));
    const bob = Math.sin(t * 0.3) * (theme.spiral ? 0.22 : 0.08); // a slow cinematic drift
    camera.position.set(
      view.focus.x + Math.cos(view.pitch + bob) * Math.sin(view.yaw) * view.dist,
      view.focus.y + Math.sin(view.pitch + bob) * view.dist,
      view.focus.z + Math.cos(view.pitch + bob) * Math.cos(view.yaw) * view.dist);
    camera.lookAt(view.focus);
    bloom.strength = (theme.spiral ? 0.6 : theme.jarvis ? 0.75 : 0.45) + view.energy * (theme.spiral ? 0.5 : theme.jarvis ? 0.7 : 0.4);
    bloom.threshold = theme.spiral ? 0.28 : 0.22;
    renderer.toneMappingExposure = theme.spiral ? 1.05 : theme.jarvis ? 1.1 : 0.85;
    world.traverse((o) => {
      const k = o.userData?.kind;
      if (o.material?.uniforms?.time) o.material.uniforms.time.value = t;
      if (k === 'nebula') { o.rotation.y = t * 0.03; o.material.uniforms.grow.value = 0.3 + 0.7 * boot; }
      else if (k === 'nodes') o.material.uniforms.grow.value = boot;
      else if (k === 'lines') o.scale.setScalar(Math.max(0.001, boot));
      else if (k === 'hub') o.position.copy(map.hubs[o.userData.key].p3).multiplyScalar(boot);
      else if (k === 'coreRing') { o.rotation.y += dt * o.userData.spin * (1 + view.energy * 2); o.rotation.x += dt * o.userData.spin * 0.3; }
      else if (k === 'hudRing' || k === 'armRing') o.rotation.z += dt * o.userData.spin;
      else if (k === 'globe') { o.rotation.y = -t * 0.04; o.scale.setScalar(0.4 + 0.6 * boot); }
      else if (k === 'dust') { o.rotation.y = -t * 0.04; o.material.uniforms.grow.value = 0.4 + 0.6 * boot; }
      else if (k === 'jRing') { o.userData.grp.rotation.z += dt * o.userData.spin * (1 + view.energy * 1.5); o.scale.setScalar(0.5 + 0.5 * boot); }
      else if (k === 'reactor') { o.quaternion.copy(camera.quaternion); o.children.forEach((m, i) => { if (i >= 2 && i < 5) m.rotation.z = t * (0.8 + view.energy * 3); if (i >= 5) m.rotation.z = -t * 0.3; }); o.scale.setScalar((0.6 + 0.4 * boot) * (1 + view.energy * 0.15)); }
      else if (k === 'plasma') { o.material.uniforms.e.value = view.energy; o.rotation.y = t * 0.2; o.scale.setScalar((0.3 + 0.7 * boot) * (1 + view.energy * 0.12)); }
      else if (k === 'coreWire') { o.rotation.x += dt * o.userData.spin[0] * (1 + view.energy * 2); o.rotation.y += dt * o.userData.spin[1] * (1 + view.energy * 2); o.scale.setScalar(0.3 + 0.7 * boot); }
      else if (k === 'core') o.scale.setScalar((1 + Math.sin(t * 3) * 0.05 * (1 + view.energy * 3)) * (0.3 + 0.7 * boot));
      else if (k === 'shell') { o.material.uniforms.e.value = view.energy; o.scale.setScalar(1 + Math.sin(t * 2) * 0.04 + view.energy * 0.15); }
    });
    // pulses: core → hub → memory
    view.spark = (view.spark || 0) - dt;
    if (theme.spiral && view.spark <= 0 && view.boot >= 1 && pulses.length < 24) { idleSpark(); view.spark = 0.25 + Math.random() * 0.5; }
    pulses = pulses.filter((q) => {
      q.t += dt * q.speed;
      if (q.curve) {
        q.curve.getPoint(Math.min(1, q.back ? 1 - q.t : q.t), q.m.position);
        q.m.material.opacity = Math.sin(Math.min(1, q.t) * Math.PI); // fade in and out along the way
      } else {
        const p = q.t < 0.5 ? new THREE.Vector3().lerpVectors(new THREE.Vector3(), q.via, q.t * 2) : new THREE.Vector3().lerpVectors(q.via, q.to, (q.t - 0.5) * 2);
        q.m.position.copy(p);
      }
      if (q.t >= 1) { scene.remove(q.m); q.m.material.dispose(); return false; }
      return true;
    });
    // hover
    if (nodePoints && !view.drag) {
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObject(nodePoints)[0];
      const nd = hit && nodePoints.geometry.getAttribute('show').array[hit.index] ? map.nodes[hit.index] : null;
      hover = nd;
      const tip = $b('tip');
      if (nd && nd !== pinned && view.mouseXY) {
        tip.hidden = false;
        tip.style.left = `${Math.min(innerWidth - 280, view.mouseXY[0] + 16)}px`;
        tip.style.top = `${Math.max(70, view.mouseXY[1] - 20)}px`;
        tip.style.setProperty('--c', rgba(nd.color, 1));
        tip.innerHTML = `<small>${esc(CLUSTERS[nd.cluster].label.toUpperCase())}</small>${esc(nd.text.slice(0, 160))}${nd.text.length > 160 ? '…' : ''}`;
        canvas.style.cursor = 'pointer';
      } else { tip.hidden = true; canvas.style.cursor = view.drag ? 'grabbing' : 'grab'; }
    }
    composer.render();
    drawHud(t, 1 - Math.pow(1 - view.boot, 3));
  }
  const start = () => { view.boot = 0; view.dist = 13; if (!raf) { clock.getDelta(); raf = requestAnimationFrame(frame); } };

  ui = { el, reload, fire, view, start, setStyle, feed: $b('feed') };
  setStyle(style);
  reload();
  start();
  return true;
}

/** Called by the app as Athena works, so her brain lights up live. */
export function brainSignal(kind, text) {
  if (!ui || ui.el.hidden) return;
  if (kind === 'token') {
    ui.view.energy = Math.min(1, ui.view.energy + 0.08);
    if (Math.random() < 0.08) ui.fire(Math.random() < 0.5 ? 'lessons' : 'about', 1);
    const her = ui.feed.querySelector('[data-b="her"]');
    if (her && text != null) her.textContent = text.length > 280 ? `…${text.slice(-280)}` : text;
  } else if (kind === 'thinking') {
    ui.view.energy = Math.min(1, ui.view.energy + 0.05);
  } else if (kind === 'tool') {
    ui.view.energy = 1; ui.fire('skills', 4);
  } else if (kind === 'recall') {
    ui.view.energy = 1; ui.fire('library', 8);
  } else if (kind === 'mood') {
    ui.fire('about', 3);
  } else if (kind === 'done') {
    ui.reload();
  }
}

export const brainOpen = () => !!ui && !ui.el.hidden;
