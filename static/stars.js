// Faint, slowly drifting and twinkling stars behind the chat (dark theme only).

export function startStars(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], w = 0, h = 0, last = 0;

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
    draw(performance.now());
  }

  function draw(now) {
    const t = now / 1000;
    ctx.clearRect(0, 0, w, h);
    if (document.documentElement.dataset.theme !== 'dark') return;
    for (const s of stars) {
      const alpha = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.gold ? `rgba(255, 222, 150, ${alpha})` : `rgba(210, 222, 255, ${alpha * 0.8})`;
      ctx.fill();
      if (s.r > 1.1) { // soft glow on the few bigger stars
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 222, 150, ${alpha * 0.12})`;
        ctx.fill();
      }
    }
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
    draw(now);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (!still) requestAnimationFrame(tick);
  return { redraw: () => draw(performance.now()) };
}
