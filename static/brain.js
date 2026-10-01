// Athena's Brain: a holographic, Jarvis-style 3D map of her mind.
// A rotating sphere of glowing nodes: her core in the middle, and around it what she knows about you, her lessons,
// her library, her nightly reflections and her skills. Related things are linked. It lights up live while she
// thinks, uses a skill or pulls something from her library. Drag to turn, scroll to zoom, hover to read, click to
// open (and delete) a node. The timeline slider shows how her mind grew.

export const CLUSTERS = {
  about: { label: 'About you', color: [255, 186, 72], dir: [0, 0.75, 0.65] },
  lessons: { label: 'Lessons', color: [184, 140, 255], dir: [-0.95, 0.15, 0.05] },
  library: { label: 'Library', color: [64, 214, 255], dir: [0.95, 0.05, 0.1] },
  reflections: { label: 'Reflections', color: [225, 250, 255], dir: [0.1, -0.9, 0.35] },
  skills: { label: 'Skills', color: [80, 140, 255], dir: [0, 0.05, -1] },
};
// Looks to choose from (the switch at the top of the view). Hologram is Jarvis cyan; Constellation and Armillary use
// Athena's own night-sky blue and gold.
export const THEMES = {
  athena: { name: 'Athena', jarvis: true, spiral: true, orange: [150, 190, 255], hud: [245, 197, 66], text: '#fff4d6', accent: '#f5c542',
    wire: [245, 197, 66], link: [245, 205, 110], flow: [255, 226, 150], dust: [255, 238, 200],
    core: [[240, 160, 40], [255, 205, 90], [255, 140, 90], [255, 250, 230]],
    clusters: { about: [255, 200, 90], lessons: [255, 160, 130], library: [250, 228, 160], reflections: [235, 240, 255], skills: [150, 190, 255] },
    globe: false, rings: 'none', stars: true, node: 'star', bg: 'radial-gradient(ellipse at 50% 42%, rgba(60,55,90,.45), rgba(11,14,26,.98) 60%), #0b0e1a' },
  holo: { name: 'Jarvis', jarvis: true, orange: [255, 150, 50], hud: [70, 215, 255], text: '#e6fbff', accent: '#4fd8ff', wire: [80, 200, 255], link: [120, 230, 255],
    flow: [150, 240, 255], dust: [150, 230, 255], core: [[40, 160, 255], [60, 220, 255], [120, 90, 255], [235, 252, 255]],
    clusters: { about: [255, 160, 60], lessons: [130, 235, 255], library: [40, 200, 255], reflections: [235, 250, 255], skills: [70, 140, 255] },
    globe: true, rings: 'hud', floor: true, stars: false, node: 'dot', bg: 'radial-gradient(ellipse at 50% 42%, rgba(10,60,90,.55), rgba(2,8,16,.97) 62%), #01060d' },
  constellation: { name: 'Constellation', hud: [245, 197, 66], text: '#fff4d6', accent: '#f5c542', wire: [245, 197, 66], link: [245, 205, 110],
    flow: [255, 226, 150], dust: [255, 238, 200], core: [[240, 160, 40], [255, 205, 90], [255, 140, 90], [255, 250, 230]],
    clusters: { about: [255, 200, 90], lessons: [255, 160, 130], library: [250, 228, 160], reflections: [235, 240, 255], skills: [150, 190, 255] },
    globe: false, rings: 'thin', floor: false, stars: true, node: 'star', bg: 'radial-gradient(ellipse at 50% 42%, rgba(60,55,90,.45), rgba(11,14,26,.98) 60%), #0b0e1a' },
  armillary: { name: 'Armillary', hud: [230, 185, 80], text: '#fff4d6', accent: '#e9b950', wire: [230, 185, 80], link: [235, 200, 120],
    flow: [255, 226, 150], dust: [255, 238, 200], core: [[230, 150, 40], [255, 200, 80], [200, 120, 60], [255, 248, 220]],
    clusters: { about: [255, 196, 80], lessons: [240, 150, 120], library: [245, 225, 160], reflections: [230, 236, 250], skills: [140, 180, 245] },
    globe: false, rings: 'armillary', floor: false, stars: true, node: 'bead', bg: 'radial-gradient(ellipse at 50% 42%, rgba(70,55,40,.4), rgba(12,13,22,.98) 60%), #0c0d16' },
};

export const KEY_OF = { memories: 'about', lessons: 'lessons', library: 'library', reflections: 'reflections', skills: 'skills' };
const STOP = new Set('about after again also because before being could every from have here into just like make more most much need only other over same should some still such than that their them then there these they thing this those through very want what when where which while will with would your yours you\'re user users always never'.split(' '));

let ui = null;

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function keywords(text) {
  return new Set((String(text).toLowerCase().match(/[a-z][a-z0-9]{4,}/g) || []).filter((w) => !STOP.has(w)));
}

/** Spread n points in a cap around a direction (golden-angle spiral), at radius r. */
function capPoints(dir, n, r) {
  const d = norm(dir);
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, up)), v = cross(d, u);
  const spread = Math.min(1.4, 0.45 + 0.12 * Math.sqrt(n)); // wide caps, so stars don't bunch up
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : Math.sqrt((i + 0.5) / n) * spread;
    const a = i * 2.39996;
    const ox = Math.sin(t) * Math.cos(a), oy = Math.sin(t) * Math.sin(a), oz = Math.cos(t);
    const p = [0, 1, 2].map((k) => (d[k] * oz + u[k] * ox + v[k] * oy));
    const rr = r * (0.88 + 0.12 * ((i * 7919) % 13) / 13);
    pts.push(p.map((x) => x * rr));
  }
  return pts;
}

export function build(data, theme) {
  const nodes = [];
  const hubs = {};
  const colorOf = (key) => theme.clusters[key] || CLUSTERS[key].color;
  for (const [key, c] of Object.entries(CLUSTERS)) hubs[key] = { key, pos: norm(c.dir).map((x) => x * 0.55), color: colorOf(key), label: c.label };
  for (const [field, key] of Object.entries(KEY_OF)) {
    const items = data[field] || [];
    const pts = capPoints(CLUSTERS[key].dir, items.length, 1);
    items.forEach((it, i) => nodes.push({ ...it, kind: field, cluster: key, pos: pts[i], color: colorOf(key),
      words: keywords(it.text), glow: 0, size: field === 'skills' ? 3.2 : field === 'reflections' ? 2.6 : 2.2 }));
  }
  // Related things across her mind: share a meaningful word ("Lakers" in a memory and in her library)
  const links = [];
  for (let i = 0; i < nodes.length && links.length < 140; i++) {
    for (let j = i + 1; j < nodes.length && links.length < 140; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.cluster === b.cluster || a.kind === 'skills' || b.kind === 'skills') continue;
      for (const w of a.words) if (b.words.has(w)) { links.push([a, b, w]); break; }
    }
  }
  const times = nodes.map((n) => n.time).filter(Boolean);
  return { nodes, hubs, links, t0: times.length ? Math.min(...times) : Date.now() / 1000 };
}

export function template() {
  return `
  <canvas class="brain-canvas"></canvas>
  <canvas class="brain-hud"></canvas>
  <div class="brain-scan"></div>
  <div class="brain-corner tl"></div><div class="brain-corner tr"></div><div class="brain-corner bl"></div><div class="brain-corner br"></div>
  <header class="brain-head">
    <div class="brain-title">ATHENA <span>// NEURAL MAP</span></div>
    <div class="brain-sub" data-b="sub">LINKING…</div>
    <div class="brain-styles" data-b="styles">${Object.entries(THEMES).map(([k, t]) => `<button type="button" data-style="${k}">${t.name}</button>`).join('')}</div>
  </header>
  <button type="button" class="brain-close" title="Close (Esc)">✕</button>
  <aside class="brain-stats" data-b="stats"></aside>
  <div class="brain-legend" data-b="legend"></div>
  <div class="brain-card" data-b="card" hidden></div>
  <div class="brain-tip" data-b="tip" hidden></div>
  <footer class="brain-foot">
    <div class="brain-time"><span>TIMELINE</span><input type="range" min="0" max="1000" value="1000" data-b="time"><b data-b="when">NOW</b></div>
    <div class="brain-feed" data-b="feed"></div>
    <form class="brain-ask" data-b="ask"><span>&gt;</span><input placeholder="Talk to Athena… watch her brain light up" autocomplete="off"><button>SEND</button></form>
  </footer>`;
}

export function openBrain({ api, onAsk, toast, style = 'athena', onStyle } = {}) {
  if (ui) { ui.el.hidden = false; ui.setStyle(style); ui.start(); ui.reload(); return; }
  const el = document.createElement('div');
  el.className = 'brain-view';
  el.innerHTML = template();
  document.body.appendChild(el);
  const $b = (k) => el.querySelector(`[data-b="${k}"]`);
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = { yaw: 0.6, pitch: -0.25, zoom: 1, drag: null, mouse: null, energy: 0.2, hidden: new Set(), cutoff: Infinity };
  let map = { nodes: [], hubs: {}, links: [], t0: 0 };
  let theme = THEMES[style] || THEMES.holo;
  function setStyle(key) {
    theme = THEMES[key] || THEMES.holo;
    el.dataset.style = THEMES[key] ? key : 'holo';
    el.style.setProperty('--hud', theme.hud.join(','));
    el.style.setProperty('--hud-text', theme.text);
    el.style.setProperty('--hud-accent', theme.accent);
    el.style.background = theme.bg;
    el.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === el.dataset.style));
    if (data) { map = build(data, theme); paintPanels(); }
  }
  let data = null, hover = null, pinned = null, particles = [], last = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  async function reload() {
    try { data = await api('/api/brain'); } catch (e) { $b('sub').textContent = `OFFLINE: ${e.message}`; return; }
    map = build(data, theme);
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
    if (v >= 1000) { view.cutoff = Infinity; $b('when').textContent = 'NOW'; return; }
    const now = Date.now() / 1000;
    view.cutoff = map.t0 + (now - map.t0) * (v / 1000);
    $b('when').textContent = new Date(view.cutoff * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  }

  // ------------------------------------------------------------ 3D
  function project(p) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
    const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
    const R = Math.min(innerWidth, innerHeight * 0.92) * 0.28 * view.zoom;
    const f = 3.2, s = f / (f + z2);
    return { x: innerWidth / 2 + x1 * R * s, y: innerHeight * 0.41 - y2 * R * s, s, z: z2 };
  }
  const visible = (n) => !view.hidden.has(n.cluster) && (!n.time || n.time <= view.cutoff);

  function fire(cluster, count = 6) {
    const hub = map.hubs[cluster];
    if (!hub) return;
    const pool = map.nodes.filter((n) => n.cluster === cluster && visible(n));
    for (let i = 0; i < Math.min(count, pool.length || 1); i++) {
      const target = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      particles.push({ from: [0, 0, 0], via: hub.pos, to: target?.pos || hub.pos, t: 0, speed: 0.012 + Math.random() * 0.01, color: hub.color, target });
    }
  }

  // floating dust in the space around her (fixed seed so it doesn't jump between opens)
  const dust = Array.from({ length: 170 }, (_, i) => {
    const a = i * 2.39996, y = 1 - (i / 169) * 2, r = Math.sqrt(1 - y * y) * (1.15 + ((i * 37) % 23) / 23 * 0.6);
    return { p: [Math.cos(a) * r, y * (1.2 + ((i * 13) % 7) / 14), Math.sin(a) * r], tw: (i * 0.37) % 6.28 };
  });
  // a night sky behind (Constellation and Armillary)
  const sky = Array.from({ length: 320 }, (_, i) => ({ x: ((i * 7919) % 1000) / 1000, y: ((i * 104729) % 997) / 997,
    r: 0.4 + ((i * 31) % 10) / 12, tw: (i * 0.77) % 6.28 }));
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function glowDot(x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a)); g.addColorStop(0.35, rgba(color, a * 0.35)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function ring3d(tiltX, tiltZ, spin, radius, color, alpha, width, ticks = 0) {
    // a great circle in 3D (for the armillary sphere), drawn through the same camera as her nodes
    const pts = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2 + spin;
      let x = Math.cos(a) * radius, y = 0, z = Math.sin(a) * radius;
      [y, z] = [y * Math.cos(tiltX) - z * Math.sin(tiltX), y * Math.sin(tiltX) + z * Math.cos(tiltX)];
      [x, y] = [x * Math.cos(tiltZ) - y * Math.sin(tiltZ), x * Math.sin(tiltZ) + y * Math.cos(tiltZ)];
      pts.push(project([x, y, z]));
    }
    ctx.lineWidth = width;
    for (let k = 0; k < 96; k++) { // brighter in front, dimmer behind
      const a = alpha * (0.35 + 0.65 * (1 - (pts[k].z + 1.4) / 2.8));
      ctx.beginPath(); ctx.moveTo(pts[k].x, pts[k].y); ctx.lineTo(pts[k + 1].x, pts[k + 1].y);
      ctx.strokeStyle = rgba(color, a); ctx.stroke();
      if (ticks && k % ticks === 0) {
        const dx = pts[k + 1].x - pts[k].x, dy = pts[k + 1].y - pts[k].y, l = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(pts[k].x - dy / l * 5, pts[k].y + dx / l * 5); ctx.lineTo(pts[k].x + dy / l * 5, pts[k].y - dx / l * 5); ctx.stroke();
      }
    }
  }

  function draw(now) {
    if (el.hidden) { raf = 0; return; } // closed: stop drawing until it opens again
    const dt = Math.min(50, now - last); last = now;
    if (!view.drag && !reduce) view.yaw += dt * 0.00012;
    view.energy = Math.max(0.15, view.energy * 0.985);
    view.boot = Math.min(1, (view.boot ?? 0) + dt / 1700); // her mind assembles itself when the view opens
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const c = project([0, 0, 0]);
    const R = Math.min(innerWidth, innerHeight * 0.92) * 0.28 * view.zoom;
    const t = now / 1000;
    const boot = ease(view.boot);
    const H = theme.hud;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // ---- a night sky (gold looks)
    if (theme.stars) {
      for (const st of sky) {
        const a = (0.25 + 0.35 * Math.sin(t * 0.8 + st.tw) ** 2) * boot;
        ctx.fillStyle = `rgba(255,245,225,${a})`;
        ctx.beginPath(); ctx.arc(st.x * innerWidth, st.y * innerHeight, st.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- a perspective light floor under her (Hologram): fades into the dark, no hard edges
    if (theme.floor) {
      const fy = c.y + R * 1.25, vy = c.y + R * 0.15;
      for (let i = -6; i <= 6; i++) {
        const x2 = c.x + i * R * 0.42;
        const g = ctx.createLinearGradient(0, fy, 0, fy + R * 0.9);
        g.addColorStop(0, rgba(H, 0.14 * boot)); g.addColorStop(1, rgba(H, 0));
        ctx.strokeStyle = g; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(c.x + (x2 - c.x) * ((fy - vy) / (fy + R * 0.9 - vy)) , fy); ctx.lineTo(x2, fy + R * 0.9); ctx.stroke();
      }
      for (let k = 0; k < 7; k++) {
        const y = fy + R * 0.9 * (k / 7) ** 1.7;
        const half = Math.min(R * 2.6, (y - vy) * 1.6);
        const g = ctx.createLinearGradient(c.x - half, 0, c.x + half, 0);
        g.addColorStop(0, rgba(H, 0)); g.addColorStop(0.5, rgba(H, (0.16 - k * 0.018) * boot)); g.addColorStop(1, rgba(H, 0));
        ctx.strokeStyle = g; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(c.x - half, y); ctx.lineTo(c.x + half, y); ctx.stroke();
      }
      glowDot(c.x, fy + R * 0.05, R * 0.9, H, 0.08 * boot); // her light falling on the floor
    }

    // ---- rings around her
    if (theme.rings === 'hud') {
      ctx.translate(c.x, c.y);
      for (const [r, w, speed, segs, a] of [[1.3, 1.2, 0.11, 6, 0.55], [1.4, 2.4, -0.06, 3, 0.4], [1.52, 1, 0.035, 12, 0.3], [1.6, 4, -0.025, 2, 0.22]]) {
        ctx.save(); ctx.rotate(t * speed);
        ctx.lineWidth = w; ctx.strokeStyle = rgba(H, a * boot);
        for (let i = 0; i < segs; i++) {
          const s0 = (i / segs) * Math.PI * 2, len = (Math.PI * 2 / segs) * (0.55 + 0.3 * ((i * 7) % 3) / 2);
          ctx.beginPath(); ctx.arc(0, 0, R * r, s0, s0 + len * boot); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.save(); ctx.rotate(-t * 0.02);
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * Math.PI * 2, long = i % 10 === 0, r1 = R * 1.7, r2 = r1 + (long ? 10 : 4);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.strokeStyle = rgba(H, (long ? 0.45 : 0.18) * boot); ctx.lineWidth = long ? 1.4 : 1; ctx.stroke();
      }
      ctx.restore();
      if (ctx.createConicGradient) {
        const sg = ctx.createConicGradient((t * 0.6) % (Math.PI * 2), 0, 0);
        sg.addColorStop(0, rgba(H, 0.07 * boot)); sg.addColorStop(0.08, rgba(H, 0)); sg.addColorStop(1, rgba(H, 0));
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, R * 1.62, 0, Math.PI * 2); ctx.fill();
      }
      ctx.translate(-c.x, -c.y);
    } else if (theme.rings === 'thin') {
      ctx.translate(c.x, c.y);
      ctx.setLineDash([1, 9]); ctx.lineDashOffset = -t * 6;
      ctx.strokeStyle = rgba(H, 0.35 * boot); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2 * boot); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(H, 0.12 * boot); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.55, 0, Math.PI * 2); ctx.stroke();
      ctx.translate(-c.x, -c.y);
    } else if (theme.rings === 'armillary') {
      const gold = H;
      ring3d(Math.PI / 2, 0, t * 0.15, 1.25, gold, 0.75 * boot, 2.2, 4);   // the equator, with markings
      ring3d(Math.PI / 2 - 0.41, 0.2, -t * 0.1, 1.18, gold, 0.55 * boot, 3);  // the ecliptic band
      ring3d(0, 0, 0, 1.3, gold, 0.45 * boot, 1.4);                         // meridian
      ring3d(0, Math.PI / 2, 0, 1.3, gold, 0.3 * boot, 1);                  // colure
      ring3d(Math.PI / 2, 0, 0, 0.85, gold, 0.25 * boot, 1);                // tropic
      ctx.translate(c.x, c.y);
      ctx.strokeStyle = rgba(gold, 0.22 * boot); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.62, 0, Math.PI * 2); ctx.stroke();
      ctx.translate(-c.x, -c.y);
    }

    // ---- wireframe globe (Hologram)
    if (theme.globe) {
      ctx.lineWidth = 0.6;
      const wire = (pts, a) => { ctx.beginPath(); pts.forEach((q, k) => { const p = project(q); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.strokeStyle = rgba(theme.wire, a * boot); ctx.stroke(); };
      for (let i = 1; i < 6; i++) {
        const lat = -Math.PI / 2 + (i * Math.PI) / 6;
        wire(Array.from({ length: 49 }, (_, k) => { const lon = (k / 48) * Math.PI * 2; return [Math.cos(lat) * Math.cos(lon) * 1.05, Math.sin(lat) * 1.05, Math.cos(lat) * Math.sin(lon) * 1.05]; }), 0.07);
      }
      for (let i = 0; i < 8; i++) {
        const lon = (i / 8) * Math.PI;
        wire(Array.from({ length: 49 }, (_, k) => { const lat = (k / 48) * Math.PI * 2; return [Math.cos(lat) * Math.cos(lon) * 1.05, Math.sin(lat) * 1.05, Math.cos(lat) * Math.sin(lon) * 1.05]; }), 0.05);
      }
    }

    // ---- floating dust
    for (const d of dust) {
      const p = project(d.p.map((v) => v * (0.6 + 0.4 * boot)));
      const a = (0.25 + 0.25 * Math.sin(t * 1.3 + d.tw)) * (1 - (p.z + 1.6) / 3.2) * boot;
      ctx.fillStyle = rgba(theme.dust, Math.max(0, a));
      ctx.fillRect(p.x, p.y, 1.3, 1.3);
    }

    // ---- links: core → hubs → nodes (flowing signals), and between related nodes
    const P = new Map();
    map.nodes.forEach((n, i) => {
      const k = ease(view.boot * 1.6 - (i % 25) / 40); // nodes fly out from the core one after another
      P.set(n, project(n.pos.map((v) => v * k)));
    });
    for (const hub of Object.values(map.hubs)) {
      if (view.hidden.has(hub.key)) continue;
      const h = project(hub.pos.map((v) => v * boot));
      hub.p = h;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(h.x, h.y);
      ctx.strokeStyle = rgba(hub.color, 0.25 + view.energy * 0.25); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([3, 12]); ctx.lineDashOffset = -t * (30 + view.energy * 60);
      ctx.strokeStyle = rgba(hub.color, 0.8); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.lineWidth = 0.6;
    for (const n of map.nodes) {
      if (!visible(n)) continue;
      const p = P.get(n), h = map.hubs[n.cluster].p;
      ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = rgba(n.color, 0.05 + 0.09 * (1 - (p.z + 1) / 2) + n.glow * 0.4); ctx.stroke();
    }
    for (const [a, b] of map.links) {
      if (!visible(a) || !visible(b)) continue;
      const pa = P.get(a), pb = P.get(b);
      const lit = hover === a || hover === b || pinned === a || pinned === b;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
      ctx.quadraticCurveTo(c.x + (pa.x + pb.x - 2 * c.x) * 0.25, c.y + (pa.y + pb.y - 2 * c.y) * 0.25, pb.x, pb.y);
      ctx.strokeStyle = lit ? 'rgba(255,255,255,0.75)' : rgba(theme.link, theme.node === 'star' ? 0.16 : 0.07); ctx.lineWidth = lit ? 1.3 : 0.7; ctx.stroke();
      ctx.setLineDash([2, 18]); ctx.lineDashOffset = -t * 22;
      ctx.strokeStyle = lit ? 'rgba(255,255,255,0.9)' : rgba(theme.flow, 0.35); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
    }

    // ---- nodes, far ones first (far ones softer, like a camera's depth of field)
    const order = map.nodes.filter(visible).sort((a, b) => P.get(b).z - P.get(a).z);
    let best = null, bestD = 14;
    for (const n of order) {
      const p = P.get(n);
      n.glow *= 0.96;
      const depth = 0.3 + 0.7 * (1 - (p.z + 1.2) / 2.4);
      const focus = hover === n || pinned === n;
      const r = n.size * p.s * view.zoom * (1 + n.glow * 1.6) * (focus ? 1.8 : 1);
      glowDot(p.x, p.y, r * (5 + (1 - depth) * 3), n.color, Math.min(1, 0.5 * depth + n.glow));
      if (theme.node === 'star') { // a four-point twinkling star
        const L = r * (3.2 + Math.sin(t * 2 + p.x) * 0.8) * (0.6 + depth * 0.6);
        ctx.strokeStyle = rgba(n.color, 0.75 * depth + n.glow); ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(p.x - L, p.y); ctx.lineTo(p.x + L, p.y); ctx.moveTo(p.x, p.y - L); ctx.lineTo(p.x, p.y + L); ctx.stroke();
      } else if (theme.node === 'bead') { // a polished gold bead
        ctx.fillStyle = rgba(n.color, 0.85 * depth + n.glow);
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2, r * 1.1), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = `rgba(255,255,255,${0.45 * depth + n.glow})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.7, r * 0.5), 0, Math.PI * 2); ctx.fill();
      if (focus) { // a targeting reticle on the node you're looking at
        ctx.strokeStyle = rgba(n.color, 0.9); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, t * 2, t * 2 + 1.2); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, t * 2 + Math.PI, t * 2 + Math.PI + 1.2); ctx.stroke();
      }
      if (view.mouse) {
        const d = Math.hypot(view.mouse.x - p.x, view.mouse.y - p.y);
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    if (!view.drag) hover = best;

    // ---- cluster hubs
    for (const hub of Object.values(map.hubs)) {
      if (view.hidden.has(hub.key) || !hub.p) continue;
      const h = hub.p;
      glowDot(h.x, h.y, 16, hub.color, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(h.x, h.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(hub.color, 0.7); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(h.x, h.y, 10 + Math.sin(t * 2 + h.x) * 1.5, t, t + Math.PI * 1.4); ctx.stroke();
    }

    // ---- signals travelling through her mind
    particles = particles.filter((q) => q.t < 1);
    for (const q of particles) {
      q.t += q.speed * (dt / 16);
      const seg = q.t < 0.5 ? [q.from, q.via, q.t * 2] : [q.via, q.to, (q.t - 0.5) * 2];
      const pos = seg[0].map((v, k) => v + (seg[1][k] - v) * seg[2]);
      const p = project(pos);
      glowDot(p.x, p.y, 12, q.color, 0.95);
      if (q.t >= 1 && q.target) q.target.glow = 1;
    }

    // ---- her core: swirling plasma, a white-hot center, energy rings and a lens flare
    const pulse = 1 + Math.sin(t * 3) * 0.04 * (1 + view.energy * 3);
    const cr = R * 0.16 * pulse * (0.3 + 0.7 * boot);
    const [cDeep, cMain, cAlt, cHot] = theme.core;
    glowDot(c.x, c.y, cr * 3.2, cDeep, 0.5 + view.energy * 0.3);
    if (theme.node === 'star') { // a little sun: slow rays
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(t * 0.08);
      for (let i = 0; i < 16; i++) {
        ctx.rotate(Math.PI / 8);
        const g = ctx.createLinearGradient(0, 0, cr * (i % 2 ? 2.2 : 3.2), 0);
        g.addColorStop(0, rgba(cMain, 0.5)); g.addColorStop(1, rgba(cMain, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -cr * 0.08); ctx.lineTo(cr * (i % 2 ? 2.2 : 3.2), 0); ctx.lineTo(0, cr * 0.08); ctx.fill();
      }
      ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
      const a = t * (0.9 + i * 0.4) * (i % 2 ? -1 : 1) + i * 1.6;
      glowDot(c.x + Math.cos(a) * cr * 0.45, c.y + Math.sin(a * 1.3) * cr * 0.35, cr * 1.3, i % 2 ? cAlt : cMain, 0.45 + view.energy * 0.3);
    }
    glowDot(c.x, c.y, cr * 1.1, cHot, 0.95);
    ctx.save(); ctx.translate(c.x, c.y);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1) * (1 + view.energy));
      ctx.beginPath(); ctx.ellipse(0, 0, cr * 1.6, cr * (0.32 + i * 0.13), 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(theme.flow, 0.3 + view.energy * 0.45); ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
    const flare = ctx.createLinearGradient(c.x - R * 1.4, 0, c.x + R * 1.4, 0);
    flare.addColorStop(0, rgba(H, 0)); flare.addColorStop(0.5, rgba(cHot, 0.3 + view.energy * 0.3)); flare.addColorStop(1, rgba(H, 0));
    ctx.fillStyle = flare; ctx.fillRect(c.x - R * 1.4, c.y - 1, R * 2.8, 2);
    glowDot(c.x + R * 0.55, c.y + R * 0.22, R * 0.06, cMain, 0.16); // flare ghosts
    glowDot(c.x - R * 0.35, c.y - R * 0.14, R * 0.035, cAlt, 0.14);
    ctx.restore(); // back to normal blending

    // hover tooltip
    const tip = $b('tip');
    if (hover && hover !== pinned) {
      const p = P.get(hover);
      tip.hidden = false;
      tip.style.left = `${Math.min(innerWidth - 280, p.x + 16)}px`;
      tip.style.top = `${Math.max(70, p.y - 20)}px`;
      tip.style.setProperty('--c', rgba(hover.color, 1));
      tip.innerHTML = `<small>${esc(CLUSTERS[hover.cluster].label.toUpperCase())}</small>${esc(hover.text.slice(0, 160))}${hover.text.length > 160 ? '…' : ''}`;
      canvas.style.cursor = 'pointer';
    } else { tip.hidden = true; canvas.style.cursor = view.drag ? 'grabbing' : 'grab'; }
    raf = requestAnimationFrame(draw);
  }
  let raf = requestAnimationFrame(draw);

  // ------------------------------------------------------------ cards
  function showCard(n) {
    pinned = n;
    const card = $b('card');
    if (!n) { card.hidden = true; return; }
    const deletable = { memories: (id) => `/api/memories/${id}`, lessons: (id) => `/api/lessons/${id}`, library: (id) => `/api/library/${id}` }[n.kind];
    const when = n.time ? new Date(n.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const related = map.links.filter(([a, b]) => a === n || b === n).map(([a, b, w]) => ({ other: a === n ? b : a, w })).slice(0, 5);
    card.style.setProperty('--c', rgba(n.color, 1));
    card.innerHTML = `<div class="bc-head"><span>${esc(CLUSTERS[n.cluster].label.toUpperCase())}${n.for ? ` · ${esc(String(n.for).toUpperCase())}` : ''}</span><button type="button" data-x>✕</button></div>
      <p>${esc(n.text)}</p>
      ${n.lessons?.length ? `<p class="bc-sub">Learned: ${n.lessons.map(esc).join(' · ')}</p>` : ''}
      ${related.length ? `<div class="bc-sub">LINKED TO ${related.map((r) => `<em>${esc(r.other.text.slice(0, 40))}</em> <span>(${esc(r.w)})</span>`).join(', ')}</div>` : ''}
      <div class="bc-foot"><span>${esc(when)}</span>${deletable ? '<button type="button" data-del>DELETE</button>' : ''}</div>`;
    card.hidden = false;
    card.querySelector('[data-x]').onclick = () => showCard(null);
    const del = card.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      try { await api(deletable(n.id), { method: 'DELETE' }); toast?.('Deleted from her mind'); showCard(null); reload(); }
      catch (e) { toast?.(e.message, 'error'); }
    };
  }

  // ------------------------------------------------------------ input
  canvas.addEventListener('pointerdown', (e) => { view.drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    view.mouse = { x: e.clientX, y: e.clientY };
    if (!view.drag) return;
    const dx = e.clientX - view.drag.x, dy = e.clientY - view.drag.y;
    view.drag.moved += Math.abs(dx) + Math.abs(dy);
    view.yaw += dx * 0.006; view.pitch = Math.max(-1.3, Math.min(1.3, view.pitch + dy * 0.006));
    view.drag.x = e.clientX; view.drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    if (view.drag && view.drag.moved < 6) showCard(hover || null);
    view.drag = null;
  });
  canvas.addEventListener('pointerleave', () => { view.mouse = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.max(0.5, Math.min(2.6, view.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { passive: false });
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

  $b('styles').addEventListener('click', (e) => {
    const k = e.target.closest('[data-style]')?.dataset.style;
    if (!k) return;
    setStyle(k); view.boot = 0; onStyle?.(k);
  });
  setStyle(style);
  const start = () => { view.boot = 0; if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
  ui = { el, reload, fire, view, start, setStyle, feed: $b('feed') };
  reload();
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
