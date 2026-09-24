import { palette } from './palette.js';

// Faint, slowly drifting and twinkling stars behind the chat (dark theme only).

/** What the sky should show right now. getOptions() returns { shooting, seasonal } from settings. */
export function startStars(canvas, getOptions = () => ({ shooting: true, seasonal: true })) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], w = 0, h = 0, last = 0;
  let meteors = [], nextMeteor = performance.now() + 6000 + Math.random() * 10000;
  let flakes = [], sparks = [], nextBurst = 0, seasonKey = '';

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(140, (w * h) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() < 0.12 ? 1.1 + Math.random() * 0.6 : 0.4 + Math.random() * 0.6,
      gold: Math.random() < 0.55,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.2,
      drift: 2 + Math.random() * 5, // px per second
    }));
    seasonKey = '';
    draw(performance.now());
  }

  // ---- seasons: snow in December, leaves in autumn, fireworks at New Year and on the Fourth of July
  function season() {
    const d = new Date(), m = d.getMonth() + 1, day = d.getDate(), hr = d.getHours();
    if ((m === 12 && day === 31 && hr >= 18) || (m === 1 && day === 1) || (m === 7 && day === 4 && hr >= 19)) return 'fireworks';
    if (m === 12 || (m === 1 && day <= 6)) return 'snow';
    if (m === 10 || m === 11) return 'leaves';
    return '';
  }
  function makeFlake(kind, top) {
    const leaf = kind === 'leaves';
    return {
      x: Math.random() * w, y: top ? -10 - Math.random() * h * 0.2 : Math.random() * h,
      r: leaf ? 5 + Math.random() * 4 : 0.8 + Math.random() * 1.8,
      vy: leaf ? 18 + Math.random() * 18 : 12 + Math.random() * 22,
      sway: Math.random() * Math.PI * 2, swaySpeed: 0.6 + Math.random() * 1.2,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 2,
      color: leaf ? ['#e0672b', '#c9432a', '#e9a23b', '#b8612c'][Math.floor(Math.random() * 4)] : null,
    };
  }
  function setupSeason(kind) {
    const count = kind === 'snow' ? Math.round(Math.min(90, w / 14)) : kind === 'leaves' ? Math.round(Math.min(16, w / 90)) : 0;
    flakes = Array.from({ length: count }, () => makeFlake(kind, false));
    sparks = [];
  }
  function burst() {
    const x = w * (0.15 + Math.random() * 0.7), y = h * (0.12 + Math.random() * 0.35);
    const hue = [45, 330, 200, 120, 280, 15][Math.floor(Math.random() * 6)];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2, v = 60 + Math.random() * 70;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + Math.random() * 20 });
    }
  }

  function drawExtras() {
    // Shooting stars: a gold streak with a fading tail
    for (const m of meteors) {
      const k = m.age / m.dur, fade = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const tx = m.x - m.vx * 0.09, ty = m.y - m.vy * 0.09;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(${palette().star.join(', ')}, ${0.85 * fade})`);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    for (const f of flakes) {
      if (f.color) { // leaf
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.fillStyle = f.color;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.ellipse(0, 0, f.r, f.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(235, 242, 255, ${0.35 + f.r * 0.15})`;
        ctx.fill();
      }
    }
    for (const p of sparks) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.life})`;
      ctx.fill();
    }
  }

  function stepExtras(now, dt) {
    const opt = getOptions();
    // shooting stars
    if (opt.shooting && now > nextMeteor) {
      const left = Math.random() < 0.5;
      const speed = 650 + Math.random() * 350;
      const angle = (left ? 0.72 : Math.PI - 0.72) + (Math.random() - 0.5) * 0.3;
      meteors.push({ x: w * (left ? 0.05 + Math.random() * 0.5 : 0.45 + Math.random() * 0.5), y: h * Math.random() * 0.35,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0, dur: 0.7 + Math.random() * 0.5 });
      nextMeteor = now + 14000 + Math.random() * 26000;
    }
    meteors = meteors.filter((m) => {
      m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      return m.age < m.dur;
    });
    // seasons
    const kind = opt.seasonal ? season() : '';
    if (kind !== seasonKey) { seasonKey = kind; setupSeason(kind); }
    for (const f of flakes) {
      f.sway += dt * f.swaySpeed;
      f.y += f.vy * dt;
      f.x += Math.sin(f.sway) * (f.color ? 26 : 12) * dt;
      f.rot += f.spin * dt;
      if (f.y > h + 12) Object.assign(f, makeFlake(seasonKey, true));
    }
    if (kind === 'fireworks' && now > nextBurst) { burst(); nextBurst = now + 1800 + Math.random() * 2500; }
    sparks = sparks.filter((p) => {
      p.vy += 55 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.life -= dt * 0.55;
      return p.life > 0;
    });
  }

  function draw(now) {
    const t = now / 1000;
    const G = palette().star.join(', ');
    ctx.clearRect(0, 0, w, h);
    if (document.documentElement.dataset.theme !== 'dark') return;
    for (const s of stars) {
      const alpha = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.gold ? `rgba(${G}, ${alpha})` : `rgba(210, 222, 255, ${alpha * 0.8})`;
      ctx.fill();
      if (s.r > 1.1) { // soft glow on the few bigger stars
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${G}, ${alpha * 0.12})`;
        ctx.fill();
      }
    }
    drawExtras();
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (document.hidden || now - last < 33) return; // ~30 fps is plenty
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (const s of stars) {
      s.y -= s.drift * dt * 0.35;
      s.x -= s.drift * dt * 0.15;
      if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; }
      if (s.x < -4) s.x = w + 4;
    }
    stepExtras(now, dt);
    draw(now);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (!still) requestAnimationFrame(tick);
  return { redraw: () => draw(performance.now()) };
}
