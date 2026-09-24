// Interactive function graphs for ```graph blocks, e.g.
//   y = x^2 - 4
//   y = 2x + 1
//   x: -10..10
//   point: (2, 0) root
// Drag to move, scroll/pinch to zoom, hover to read values. Expressions are parsed safely (no eval).

// ------------------------------------------------------------ expression parser
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, cbrt: Math.cbrt, sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
};
const CONSTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const s = src.replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi')
    .replace(/\\left|\\right|\\cdot/g, (m) => (m === '\\cdot' ? '*' : '')).replace(/\\(sqrt|sin|cos|tan|ln|log|pi)/g, '$1');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
    if (num) { out.push({ t: 'num', v: parseFloat(num[1]) }); i += num[1].length; continue; }
    const word = s.slice(i).match(/^[a-zA-Z]+/);
    if (word) {
      let w = word[1] ?? word[0];
      // split things like "xsin" or "2pi" sensibly: known names first, then single letters
      let j = 0;
      while (j < w.length) {
        const rest = w.slice(j);
        const name = Object.keys({ ...FUNCS, ...CONSTS }).sort((a, b) => b.length - a.length).find((n) => rest.startsWith(n));
        if (name) { out.push({ t: FUNCS[name] ? 'fn' : 'const', v: name }); j += name.length; }
        else if (rest[0] === 'x') { out.push({ t: 'x' }); j++; }
        else throw new Error(`Unknown name "${rest}"`);
      }
      i += w.length;
      continue;
    }
    if ('+-*/^(),{}[]|'.includes(c)) { out.push({ t: 'op', v: c === '{' || c === '[' ? '(' : c === '}' || c === ']' ? ')' : c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  // implicit multiplication: 2x, 3(x+1), x(x+1), )(, 2sin(x), x pi
  const res = [];
  for (const tok of out) {
    const prev = res[res.length - 1];
    const prevEnds = prev && (prev.t === 'num' || prev.t === 'x' || prev.t === 'const' || (prev.t === 'op' && prev.v === ')'));
    const curStarts = tok.t === 'num' || tok.t === 'x' || tok.t === 'const' || tok.t === 'fn' || (tok.t === 'op' && tok.v === '(');
    if (prevEnds && curStarts) res.push({ t: 'op', v: '*' });
    res.push(tok);
  }
  return res;
}

/** Compile "x^2 - 4" into a function of x. */
export function compile(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { const t = toks[p]; if (!t || (v && t.v !== v)) throw new Error(`Expected ${v || 'more'}`); p++; return t; };
  // grammar: expr = term (('+'|'-') term)* ; term = unary (('*'|'/') unary)* ; unary = '-' unary | power ; power = atom ('^' unary)?
  function expr() { let f = term(); while (peek()?.t === 'op' && '+-'.includes(peek().v)) { const op = eat().v, a = f, b = term(); f = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x); } return f; }
  function term() { let f = unary(); while (peek()?.t === 'op' && '*/'.includes(peek().v)) { const op = eat().v, a = f, b = unary(); f = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x); } return f; }
  function unary() { if (peek()?.t === 'op' && (peek().v === '-' || peek().v === '+')) { const neg = eat().v === '-'; const a = unary(); return neg ? (x) => -a(x) : a; } return power(); }
  function power() { const base = atom(); if (peek()?.t === 'op' && peek().v === '^') { eat(); const ex = unary(); return (x) => Math.pow(base(x), ex(x)); } return base; }
  function atom() {
    const t = eat();
    if (t.t === 'num') return () => t.v;
    if (t.t === 'x') return (x) => x;
    if (t.t === 'const') return () => CONSTS[t.v];
    if (t.t === 'fn') {
      const fn = FUNCS[t.v];
      let arg;
      if (peek()?.v === '(') { eat('('); arg = expr(); eat(')'); } else arg = power(); // sin x, sqrt 2x
      return (x) => fn(arg(x));
    }
    if (t.v === '(') { const f = expr(); eat(')'); return f; }
    if (t.v === '|') { const f = expr(); eat('|'); return (x) => Math.abs(f(x)); }
    throw new Error(`Unexpected "${t.v}"`);
  }
  const f = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v ?? toks[p].t}"`);
  return f;
}

// ------------------------------------------------------------ spec parsing
export function parseGraph(src) {
  const spec = { fns: [], points: [], x: null, y: null, title: '' };
  for (let raw of (src || '').split('\n')) {
    const line = raw.trim().replace(/^[-*]\s+/, '').replace(/\$/g, '');
    if (!line || line.startsWith('#')) continue;
    let m;
    if ((m = line.match(/^title\s*[:=]\s*(.+)$/i))) { spec.title = m[1]; continue; }
    if ((m = line.match(/^([xy])\s*(?:range)?\s*[:=]\s*\[?\s*(-?[\d.]+)\s*(?:\.\.|,|to)\s*(-?[\d.]+)\s*\]?$/i))) { spec[m[1].toLowerCase()] = [parseFloat(m[2]), parseFloat(m[3])]; continue; }
    if ((m = line.match(/^points?\s*[:=]\s*\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?\s*(.*)$/i))) { spec.points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), label: m[3] || '' }); continue; }
    if ((m = line.match(/^(?:([a-zA-Z]\w*)\s*\(\s*x\s*\)|y)\s*=\s*(.+)$/))) {
      const label = m[1] ? `${m[1]}(x) = ${m[2]}` : `y = ${m[2]}`;
      spec.fns.push({ label, fn: compile(m[2]) });
      continue;
    }
    if (/x/.test(line) && !/[:=]/.test(line)) { spec.fns.push({ label: `y = ${line}`, fn: compile(line) }); continue; }
  }
  if (!spec.fns.length && !spec.points.length) throw new Error('No functions to draw');
  return spec;
}

// ------------------------------------------------------------ drawing
const COLORS = () => {
  const cs = getComputedStyle(document.documentElement);
  return [cs.getPropertyValue('--accent').trim() || '#f5c542', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c'];
};

function niceStep(range) {
  const raw = range / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}
const fmt = (v) => (Math.abs(v) < 1e-10 ? '0' : Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3 ? v.toExponential(1) : String(+v.toFixed(4)));

function autoY(spec, x0, x1) {
  const ys = [];
  for (const { fn } of spec.fns) {
    for (let i = 0; i <= 200; i++) {
      const y = fn(x0 + ((x1 - x0) * i) / 200);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  spec.points.forEach((pt) => ys.push(pt.y));
  if (!ys.length) return [-10, 10];
  ys.sort((a, b) => a - b);
  let lo = ys[Math.floor(ys.length * 0.06)], hi = ys[Math.ceil(ys.length * 0.94) - 1];
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15;
  return [Math.min(lo - pad, 0 < lo ? -pad : lo - pad), Math.max(hi + pad, hi < 0 ? pad : hi + pad)];
}

export function renderGraph(el, src) {
  let spec;
  try { spec = parseGraph(src); } catch (e) {
    el.innerHTML = `<div class="study-building">Couldn't draw this graph: ${String(e.message).replace(/[<>&]/g, '')}</div>`;
    return;
  }
  const x = spec.x || [-10, 10];
  const view = { x0: x[0], x1: x[1] };
  [view.y0, view.y1] = spec.y || autoY(spec, x[0], x[1]);
  const home = { ...view };
  const colors = COLORS();
  el.innerHTML = `<div class="graph">
    ${spec.title ? `<div class="fc-top"><span class="fc-title">📈 ${spec.title.replace(/[<>&]/g, '')}</span></div>` : ''}
    <div class="graph-canvas"><canvas></canvas><div class="graph-tip" hidden></div>
      <div class="graph-btns"><button type="button" data-g="in" title="Zoom in">+</button><button type="button" data-g="out" title="Zoom out">−</button><button type="button" data-g="home" title="Reset view">⌂</button></div></div>
    <div class="graph-legend">${spec.fns.map((f, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${f.label.replace(/[<>&]/g, '')}</span>`).join('')}</div>
  </div>`;
  const canvas = el.querySelector('canvas');
  const tip = el.querySelector('.graph-tip');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  const toPx = (vx, vy) => [((vx - view.x0) / (view.x1 - view.x0)) * W, H - ((vy - view.y0) / (view.y1 - view.y0)) * H];
  const toVal = (px, py) => [view.x0 + (px / W) * (view.x1 - view.x0), view.y0 + ((H - py) / H) * (view.y1 - view.y0)];

  function draw() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const grid = cs.getPropertyValue('--border').trim(), text = cs.getPropertyValue('--text-3').trim(), axis = cs.getPropertyValue('--text-2').trim();
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    // grid + labels
    const sx = niceStep(view.x1 - view.x0), sy = niceStep(view.y1 - view.y0);
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = text;
    const [ox, oy] = toPx(0, 0);
    const labelY = Math.min(Math.max(oy + 13, 12), H - 4), labelX = Math.min(Math.max(ox + 4, 4), W - 30);
    for (let v = Math.ceil(view.x0 / sx) * sx; v <= view.x1; v += sx) {
      const [px] = toPx(v, 0);
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); ctx.globalAlpha = 1;
      if (Math.abs(v) > sx / 2) ctx.fillText(fmt(v), px + 3, labelY);
    }
    for (let v = Math.ceil(view.y0 / sy) * sy; v <= view.y1; v += sy) {
      const [, py] = toPx(0, v);
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke(); ctx.globalAlpha = 1;
      if (Math.abs(v) > sy / 2) ctx.fillText(fmt(v), labelX, py - 3);
    }
    // axes
    ctx.strokeStyle = axis; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
    // curves
    spec.fns.forEach(({ fn }, i) => {
      ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false, lastPy = 0;
      for (let px = 0; px <= W; px += 1) {
        const [vx] = toVal(px, 0);
        const vy = fn(vx);
        if (!Number.isFinite(vy)) { pen = false; continue; }
        const [, py] = toPx(vx, vy);
        if (pen && Math.abs(py - lastPy) > H * 1.5) pen = false; // asymptote: don't join
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        pen = true; lastPy = py;
      }
      ctx.stroke();
    });
    // points
    spec.points.forEach((pt) => {
      const [px, py] = toPx(pt.x, pt.y);
      ctx.fillStyle = colors[0]; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = axis; ctx.fillText(`${pt.label ? pt.label + ' ' : ''}(${fmt(pt.x)}, ${fmt(pt.y)})`, px + 7, py - 7);
    });
  }

  function zoom(factor, cx = W / 2, cy = H / 2) {
    const [vx, vy] = toVal(cx, cy);
    view.x0 = vx + (view.x0 - vx) * factor; view.x1 = vx + (view.x1 - vx) * factor;
    view.y0 = vy + (view.y0 - vy) * factor; view.y1 = vy + (view.y1 - vy) * factor;
    draw();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, v: { ...view } }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) {
      const dx = ((e.clientX - drag.x) / W) * (drag.v.x1 - drag.v.x0), dy = ((e.clientY - drag.y) / H) * (drag.v.y1 - drag.v.y0);
      Object.assign(view, { x0: drag.v.x0 - dx, x1: drag.v.x1 - dx, y0: drag.v.y0 + dy, y1: drag.v.y1 + dy });
      draw();
      tip.hidden = true;
      return;
    }
    const [vx] = toVal(e.clientX - r.left, 0);
    const vals = spec.fns.map((f) => f.fn(vx)).map((v) => (Number.isFinite(v) ? fmt(v) : '—'));
    tip.hidden = false;
    tip.textContent = `x = ${fmt(vx)}   ${vals.map((v, i) => (spec.fns.length > 1 ? `y${i + 1} = ${v}` : `y = ${v}`)).join('   ')}`;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  el.querySelector('.graph-btns').addEventListener('click', (e) => {
    const g = e.target.closest('[data-g]')?.dataset.g;
    if (g === 'in') zoom(1 / 1.4);
    if (g === 'out') zoom(1.4);
    if (g === 'home') { Object.assign(view, home); draw(); }
  });
  new ResizeObserver(draw).observe(canvas);
  draw();
}

export function hydrateGraphs(root, streaming = false) {
  root.querySelectorAll('.graph-widget:not([data-ready])').forEach((w) => {
    if (streaming) { w.innerHTML = '<div class="study-building"><span class="spin"></span>Drawing the graph…</div>'; return; }
    w.dataset.ready = '1';
    renderGraph(w, w.dataset.src);
  });
}
