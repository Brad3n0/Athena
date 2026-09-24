// Athena's voice orb: a liquid-gold sphere drawn on a canvas.
// It ripples with her voice, reacts to your mic while listening, swirls while thinking.

import { palette } from './palette.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// Colour blobs that swirl inside the orb (screen-blended).
const BLOBS = [
  { c: [255, 205, 90], r: 0.85, speed: 0.31, orbit: 0.34, phase: 0.0, a: 0.85 },
  { c: [240, 140, 20], r: 0.80, speed: -0.23, orbit: 0.40, phase: 2.1, a: 0.8 },
  { c: [255, 236, 170], r: 0.50, speed: 0.47, orbit: 0.26, phase: 3.6, a: 0.7 },
  { c: [30, 64, 175], r: 0.60, speed: -0.19, orbit: 0.52, phase: 4.8, a: 0.55 },
];

export class VoiceOrb {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'orb-canvas';
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.state = 'idle';
    this.level = 0;
    this.mic = 0;
    this.spin = 0;
    this.think = 0;
    this.getLevel = () => 0;
    this.getMicLevel = () => 0;
    this.sparks = Array.from({ length: 34 }, () => this._spark(true));
    this._resize = new ResizeObserver(() => this._fit());
    this._resize.observe(container);
    this._fit();
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  setState(state) { this.state = state; }
  cheer() { this.flash = 1; }

  _spark(initial = false) {
    return {
      a: Math.random() * TAU,
      d: initial ? 0.55 + Math.random() * 0.5 : 0.5,
      v: 0.02 + Math.random() * 0.05,
      s: 0.6 + Math.random() * 1.6,
      life: initial ? Math.random() : 0,
      drift: (Math.random() - 0.5) * 0.4,
    };
  }

  _fit() {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r?.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = Math.min(r.width, r.height);
    this.canvas.width = this.canvas.height = Math.round(this.size * dpr);
    this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _tick(now) {
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    const t = now / 1000;
    const { ctx, size } = this;
    const pal = palette();
    const A = pal.rgb.join(', '), L = pal.light.join(', ');
    pal.orb.forEach((c, i) => { BLOBS[i].c = c; });
    if (!size) { this._raf = requestAnimationFrame((tt) => this._tick(tt)); return; }

    // Inputs, smoothed
    const voice = this.getLevel();
    const mic = this.state === 'listening' ? this.getMicLevel() : 0;
    this.level = lerp(this.level, voice, voice > this.level ? 0.5 : 0.12);
    this.mic = lerp(this.mic, mic, mic > this.mic ? 0.4 : 0.1);
    this.think = lerp(this.think, this.state === 'thinking' ? 1 : 0, 0.06);
    this.flash = Math.max(0, (this.flash || 0) - dt * 1.5);
    const energy = Math.min(1, this.level + this.mic * 0.7);
    this.spin += dt * (0.35 + this.think * 2.2 + energy * 1.2);

    const cx = size / 2, cy = size / 2;
    const breathe = 1 + Math.sin(t * 1.4) * 0.015;
    const R = size * 0.28 * breathe * (1 + energy * 0.1);
    ctx.clearRect(0, 0, size, size);

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, size * 0.5);
    glow.addColorStop(0, `rgba(${A}, ${0.28 + energy * 0.35 + this.flash * 0.3})`);
    glow.addColorStop(0.45, `rgba(${pal.orb[1].join(', ')}, ${0.08 + energy * 0.12})`);
    glow.addColorStop(1, `rgba(${pal.orb[1].join(', ')}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    // Listening: soft ripple rings expanding with your voice
    if (this.state === 'listening') {
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.6 + i / 3) % 1);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.05 + k * 0.55 + this.mic * 0.25), 0, TAU);
        ctx.strokeStyle = `rgba(${L}, ${(1 - k) * (0.12 + this.mic * 0.5)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Liquid edge: radius wobbles with her voice
    const edge = (a) => R * (1
      + Math.sin(a * 3 + t * 2.1) * (0.006 + this.level * 0.016)
      + Math.sin(a * 5 - t * 3.3) * (0.004 + this.level * 0.012)
      + Math.sin(a * 8 + t * 5.1) * this.level * 0.008
      + Math.sin(a * 2 - t * 1.3) * this.mic * 0.02);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      const r = edge(a);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.clip();

    // Deep base
    const base = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.1);
    base.addColorStop(0, pal.base);
    base.addColorStop(0.55, '#2a1c20');
    base.addColorStop(1, '#0b1224');
    ctx.fillStyle = base;
    ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);

    // Swirling colour blobs
    ctx.globalCompositeOperation = 'screen';
    for (const b of BLOBS) {
      const a = b.phase + this.spin * b.speed * 3;
      const orbit = R * b.orbit * (1 + Math.sin(t * 0.9 + b.phase) * 0.25);
      const x = cx + Math.cos(a) * orbit, y = cy + Math.sin(a * 1.3) * orbit;
      const br = R * b.r * (1 + energy * 0.35);
      const g = ctx.createRadialGradient(x, y, 0, x, y, br);
      g.addColorStop(0, `rgba(${b.c}, ${b.a})`);
      g.addColorStop(0.55, `rgba(${b.c}, ${b.a * 0.45})`);
      g.addColorStop(1, `rgba(${b.c}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - br, y - br, br * 2, br * 2);
    }
    // Light filaments swirling through the liquid
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = this.spin * (0.8 + i * 0.35) * (i % 2 ? -1 : 1) + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * (0.55 + i * 0.13), R * (0.22 + i * 0.08), a0, 0, Math.PI * (0.9 + energy * 0.5));
      ctx.strokeStyle = `rgba(255, 240, 200, ${0.16 + energy * 0.3})`;
      ctx.lineWidth = 1.4 + energy * 1.5;
      ctx.stroke();
    }
    // White-hot core that flares when she speaks
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.35 + this.level * 0.35));
    core.addColorStop(0, `rgba(255, 250, 230, ${0.35 + this.level * 0.6 + this.flash * 0.3})`);
    core.addColorStop(1, 'rgba(255, 250, 230, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    // Glassy rim + highlight
    const rim = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.02);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(8, 12, 28, 0.55)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, size, size);
    const hl = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.45, 0, cx - R * 0.38, cy - R * 0.45, R * 0.45);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // Thin gold outline
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      const r = edge(a);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${L}, ${0.35 + energy * 0.4})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Thinking: orbiting arcs
    if (this.think > 0.01) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const a0 = this.spin * (i ? -1.6 : 2.1) + i * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.18 + i * 0.12), a0, a0 + 1.1 + i * 0.5);
        ctx.strokeStyle = `rgba(${L}, ${this.think * (0.75 - i * 0.3)})`;
        ctx.lineWidth = 2.2 - i * 0.8;
        ctx.stroke();
      }
    }

    // Gold dust drifting outward
    for (let i = 0; i < this.sparks.length; i++) {
      const p = this.sparks[i];
      p.life += dt * (0.18 + energy * 0.5);
      p.d += dt * p.v * (1 + energy * 3);
      p.a += dt * (p.drift + this.think * 0.8);
      if (p.life >= 1 || p.d > 1.25) { this.sparks[i] = this._spark(); continue; }
      const x = cx + Math.cos(p.a) * p.d * size * 0.5;
      const y = cy + Math.sin(p.a) * p.d * size * 0.5;
      const alpha = Math.sin(p.life * Math.PI) * (0.35 + energy * 0.65);
      ctx.beginPath();
      ctx.arc(x, y, p.s * (1 + energy * 0.6), 0, TAU);
      ctx.fillStyle = `rgba(${L}, ${alpha})`;
      ctx.fill();
    }

    this._raf = requestAnimationFrame((tt) => this._tick(tt));
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._resize.disconnect();
    this.canvas.remove();
  }
}
