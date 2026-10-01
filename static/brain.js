// Athena's Brain: a holographic, Jarvis-style 3D map of her mind.
// A rotating sphere of glowing nodes: her core in the middle, and around it what she knows about you, her lessons,
// her library, her nightly reflections and her skills. Related things are linked. It lights up live while she
// thinks, uses a skill or pulls something from her library. Drag to turn, scroll to zoom, hover to read, click to
// open (and delete) a node. The timeline slider shows how her mind grew.

const CLUSTERS = {
  about: { label: 'About you', color: [255, 186, 72], dir: [0, 0.75, 0.65] },
  lessons: { label: 'Lessons', color: [184, 140, 255], dir: [-0.95, 0.15, 0.05] },
  library: { label: 'Library', color: [64, 214, 255], dir: [0.95, 0.05, 0.1] },
  reflections: { label: 'Reflections', color: [225, 250, 255], dir: [0.1, -0.9, 0.35] },
  skills: { label: 'Skills', color: [80, 140, 255], dir: [0, 0.05, -1] },
};
const KEY_OF = { memories: 'about', lessons: 'lessons', library: 'library', reflections: 'reflections', skills: 'skills' };
const STOP = new Set('about after again also because before being could every from have here into just like make more most much need only other over same should some still such than that their them then there these they thing this those through very want what when where which while will with would your yours you\'re user users always never'.split(' '));

let ui = null;

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function keywords(text) {
  return new Set((String(text).toLowerCase().match(/[a-z][a-z0-9]{4,}/g) || []).filter((w) => !STOP.has(w)));
}

/** Spread n points in a cap around a direction (golden-angle spiral), at radius r. */
function capPoints(dir, n, r) {
  const d = norm(dir);
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, up)), v = cross(d, u);
  const spread = Math.min(1.1, 0.25 + 0.09 * Math.sqrt(n));
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

function build(data) {
  const nodes = [];
  const hubs = {};
  for (const [key, c] of Object.entries(CLUSTERS)) hubs[key] = { key, pos: norm(c.dir).map((x) => x * 0.55), color: c.color, label: c.label };
  for (const [field, key] of Object.entries(KEY_OF)) {
    const items = data[field] || [];
    const pts = capPoints(CLUSTERS[key].dir, items.length, 1);
    items.forEach((it, i) => nodes.push({ ...it, kind: field, cluster: key, pos: pts[i], color: CLUSTERS[key].color,
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

function template() {
  return `
  <canvas class="brain-canvas"></canvas>
  <div class="brain-scan"></div>
  <div class="brain-corner tl"></div><div class="brain-corner tr"></div><div class="brain-corner bl"></div><div class="brain-corner br"></div>
  <header class="brain-head">
    <div class="brain-title">ATHENA <span>// NEURAL MAP</span></div>
    <div class="brain-sub" data-b="sub">LINKING…</div>
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

export function openBrain({ api, onAsk, toast } = {}) {
  if (ui) { ui.el.hidden = false; ui.start(); ui.reload(); return; }
  const el = document.createElement('div');
  el.className = 'brain-view';
  el.innerHTML = template();
  document.body.appendChild(el);
  const $b = (k) => el.querySelector(`[data-b="${k}"]`);
  const canvas = el.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = { yaw: 0.6, pitch: -0.25, zoom: 1, drag: null, mouse: null, energy: 0.2, hidden: new Set(), cutoff: Infinity };
  let map = { nodes: [], hubs: {}, links: [], t0: 0 };
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
    map = build(data);
    const c = data.core;
    $b('sub').textContent = `${c.brain.toUpperCase()} · ${c.engine.toUpperCase()} · ${c.state === 'ready' || c.engine === 'Ollama' ? 'ONLINE' : c.state.toUpperCase()}`;
    const count = (k) => (data[k] || []).length;
    $b('stats').innerHTML = [['MEMORIES', count('memories'), 'about'], ['LESSONS', count('lessons'), 'lessons'],
      ['LIBRARY', count('library'), 'library'], ['REFLECTIONS', count('reflections'), 'reflections'],
      ['SKILLS', count('skills'), 'skills'], ['LINKS', map.links.length, null]]
      .map(([k, n, cl]) => `<div class="bs-row"${cl ? ` style="--c:${rgba(CLUSTERS[cl].color, 1)}"` : ''}><span>${k}</span><b>${n}</b></div>`).join('') +
      `<div class="bs-row"><span>PERSONALITY</span><b>${esc(c.persona.toUpperCase())}</b></div>`;
    $b('legend').innerHTML = Object.entries(CLUSTERS).map(([k, cl]) =>
      `<button type="button" data-cl="${k}" class="${view.hidden.has(k) ? 'off' : ''}" style="--c:${rgba(cl.color, 1)}">${cl.label}</button>`).join('');
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
    const R = Math.min(innerWidth, innerHeight) * 0.33 * view.zoom;
    const f = 3.2, s = f / (f + z2);
    return { x: innerWidth / 2 + x1 * R * s, y: innerHeight * 0.47 - y2 * R * s, s, z: z2 };
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

  function draw(now) {
    if (el.hidden) { raf = 0; return; } // closed: stop drawing until it opens again
    const dt = Math.min(50, now - last); last = now;
    if (!view.drag && !reduce) view.yaw += dt * 0.00012;
    view.energy = Math.max(0.15, view.energy * 0.985);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const c = project([0, 0, 0]);
    const R = Math.min(innerWidth, innerHeight) * 0.33 * view.zoom;
    const t = now / 1000;

    // HUD rings around the sphere
    ctx.save();
    ctx.translate(c.x, c.y);
    for (const [r, w, speed, dash, a] of [[1.32, 1, 0.08, [2, 10], 0.35], [1.42, 2, -0.05, [40, 18], 0.22], [1.5, 1, 0.03, [], 0.12], [1.58, 6, -0.02, [1, 7], 0.18]]) {
      ctx.rotate(t * speed);
      ctx.beginPath(); ctx.setLineDash(dash); ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(80,210,255,${a})`;
      ctx.arc(0, 0, R * r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // a faint wireframe globe
    ctx.lineWidth = 0.6;
    for (let i = 1; i < 6; i++) {
      const lat = -Math.PI / 2 + (i * Math.PI) / 6;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const lon = (k / 48) * Math.PI * 2;
        const p = project([Math.cos(lat) * Math.cos(lon) * 1.05, Math.sin(lat) * 1.05, Math.cos(lat) * Math.sin(lon) * 1.05]);
        k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(80,200,255,0.06)'; ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const lon = (i / 8) * Math.PI;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const lat = (k / 48) * Math.PI * 2;
        const p = project([Math.cos(lat) * Math.cos(lon) * 1.05, Math.sin(lat) * 1.05, Math.cos(lat) * Math.sin(lon) * 1.05]);
        k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(80,200,255,0.045)'; ctx.stroke();
    }

    // links: core → hubs → nodes, and between related nodes
    const P = new Map();
    for (const n of map.nodes) P.set(n, project(n.pos));
    for (const hub of Object.values(map.hubs)) {
      if (view.hidden.has(hub.key)) continue;
      const h = project(hub.pos);
      hub.p = h;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(h.x, h.y);
      ctx.strokeStyle = rgba(hub.color, 0.35 + view.energy * 0.3); ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.lineWidth = 0.6;
    for (const n of map.nodes) {
      if (!visible(n)) continue;
      const p = P.get(n), h = map.hubs[n.cluster].p;
      ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = rgba(n.color, 0.06 + 0.1 * (1 - (p.z + 1) / 2) + n.glow * 0.4); ctx.stroke();
    }
    for (const [a, b] of map.links) {
      if (!visible(a) || !visible(b)) continue;
      const pa = P.get(a), pb = P.get(b);
      const lit = hover === a || hover === b || pinned === a || pinned === b;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y);
      ctx.quadraticCurveTo(c.x + (pa.x + pb.x - 2 * c.x) * 0.25, c.y + (pa.y + pb.y - 2 * c.y) * 0.25, pb.x, pb.y);
      ctx.strokeStyle = lit ? 'rgba(255,255,255,0.7)' : 'rgba(120,230,255,0.10)'; ctx.lineWidth = lit ? 1.2 : 0.7; ctx.stroke();
    }

    // nodes, far ones first
    const order = map.nodes.filter(visible).sort((a, b) => P.get(b).z - P.get(a).z);
    let best = null, bestD = 14;
    for (const n of order) {
      const p = P.get(n);
      n.glow *= 0.96;
      const depth = 0.35 + 0.65 * (1 - (p.z + 1.2) / 2.4);
      const r = n.size * p.s * view.zoom * (1 + n.glow * 1.6) * (hover === n || pinned === n ? 1.8 : 1);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
      g.addColorStop(0, rgba(n.color, Math.min(1, 0.55 * depth + n.glow)));
      g.addColorStop(1, rgba(n.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.5 * depth + n.glow})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.8, r * 0.55), 0, Math.PI * 2); ctx.fill();
      if (view.mouse) {
        const d = Math.hypot(view.mouse.x - p.x, view.mouse.y - p.y);
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    if (!view.drag) hover = best;

    // cluster hubs
    for (const hub of Object.values(map.hubs)) {
      if (view.hidden.has(hub.key) || !hub.p) continue;
      const h = hub.p;
      ctx.fillStyle = rgba(hub.color, 0.9);
      ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(hub.color, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(h.x, h.y, 9 + Math.sin(t * 2 + h.x) * 1.5, 0, Math.PI * 2); ctx.stroke();
    }

    // signals travelling through her mind
    particles = particles.filter((q) => q.t < 1);
    for (const q of particles) {
      q.t += q.speed * (dt / 16);
      const seg = q.t < 0.5 ? [q.from, q.via, q.t * 2] : [q.via, q.to, (q.t - 0.5) * 2];
      const pos = seg[0].map((v, k) => v + (seg[1][k] - v) * seg[2]);
      const p = project(pos);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
      g.addColorStop(0, rgba(q.color, 0.95)); g.addColorStop(1, rgba(q.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
      if (q.t >= 1 && q.target) q.target.glow = 1;
    }

    // her core
    const pulse = 1 + Math.sin(t * 3) * 0.04 * (1 + view.energy * 3);
    const cr = R * 0.17 * pulse;
    const core = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, cr * 2.6);
    core.addColorStop(0, `rgba(230,252,255,${0.9})`);
    core.addColorStop(0.25, `rgba(90,220,255,${0.55 + view.energy * 0.4})`);
    core.addColorStop(1, 'rgba(40,160,255,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(c.x, c.y, cr * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(c.x, c.y);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1) * (1 + view.energy));
      ctx.beginPath(); ctx.ellipse(0, 0, cr * 1.5, cr * (0.35 + i * 0.12), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(140,235,255,${0.35 + view.energy * 0.4})`; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();

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

  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };
  ui = { el, reload, fire, view, start, feed: $b('feed') };
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
