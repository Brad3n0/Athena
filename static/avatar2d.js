// Athena's built-in 2D anime companion: an original SVG character with blinking,
// breathing, swaying twin-tails, eye tracking and lip-sync driven by voice loudness.

const SVG = `
<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" class="anime-svg">
  <defs>
    <linearGradient id="av-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe7a3"/>
      <stop offset=".45" stop-color="#f7cf62"/>
      <stop offset="1" stop-color="#d9a032"/>
    </linearGradient>
    <linearGradient id="av-hair-dark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9b94a"/>
      <stop offset="1" stop-color="#b98221"/>
    </linearGradient>
    <linearGradient id="av-skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6d2bf"/>
      <stop offset=".35" stop-color="#ffe9dc"/>
      <stop offset="1" stop-color="#fde3d3"/>
    </linearGradient>
    <radialGradient id="av-iris" cx=".5" cy=".38" r=".62">
      <stop offset="0" stop-color="#ffe9a0"/>
      <stop offset=".45" stop-color="#f5b52e"/>
      <stop offset="1" stop-color="#9a4f0a"/>
    </radialGradient>
    <linearGradient id="av-cloth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#253760"/>
      <stop offset="1" stop-color="#121c36"/>
    </linearGradient>
    <clipPath id="av-eye-l"><path d="M138 214 C143 191 180 188 188 205 C186 224 150 232 138 214 Z"/></clipPath>
    <clipPath id="av-eye-r"><path d="M262 214 C257 191 220 188 212 205 C214 224 250 232 262 214 Z"/></clipPath>
  </defs>

  <!-- twin-tails (behind everything) -->
  <g class="av-tail-l" style="transform-origin:128px 112px">
    <path d="M132 100 C72 112 40 196 50 292 C57 362 34 424 58 482 C88 428 104 364 98 292 C93 222 110 162 146 124 Z" fill="url(#av-hair)"/>
    <path d="M110 140 C80 190 70 260 78 330 C82 380 70 420 64 450" fill="none" stroke="#d9a032" stroke-width="3" opacity=".55"/>
  </g>
  <g class="av-tail-r" style="transform-origin:272px 112px">
    <path d="M268 100 C328 112 360 196 350 292 C343 362 366 424 342 482 C312 428 296 364 302 292 C307 222 290 162 254 124 Z" fill="url(#av-hair)"/>
    <path d="M290 140 C320 190 330 260 322 330 C318 380 330 420 336 450" fill="none" stroke="#d9a032" stroke-width="3" opacity=".55"/>
  </g>

  <g class="av-body">
    <!-- torso -->
    <path d="M84 500 C88 420 132 372 180 350 L220 350 C268 372 312 420 316 500 Z" fill="url(#av-cloth)"/>
    <path d="M180 350 L200 398 L220 350 Z" fill="#fde3d3"/>
    <path d="M176 348 L200 402 L224 348" fill="none" stroke="#f5c542" stroke-width="5" stroke-linejoin="round"/>
    <path d="M118 402 C140 380 160 368 176 360 M282 402 C260 380 240 368 224 360" stroke="#f5c542" stroke-width="3" fill="none" opacity=".8"/>
    <!-- neck + choker -->
    <path d="M177 284 L177 352 C188 362 212 362 223 352 L223 284 Z" fill="#f7d6c4"/>
    <path d="M177 290 Q200 316 223 290 L223 304 Q200 324 177 304 Z" fill="#e7b39d" opacity=".55"/>
    <rect x="175" y="326" width="50" height="9" rx="4" fill="#161a26"/>
    <path d="M200 334 Q201 340 205 341 Q201 342 200 348 Q199 342 195 341 Q199 340 200 334 Z" fill="#f5c542"/>
  </g>

  <g class="av-head" style="transform-origin:200px 300px">
    <!-- back hair -->
    <path d="M108 176 C96 92 148 44 200 44 C252 44 304 92 292 176 L300 336 C282 348 262 330 258 306 L142 306 C138 330 118 348 100 336 Z" fill="url(#av-hair-dark)"/>
    <!-- face -->
    <path d="M128 160 C126 236 158 286 200 306 C242 286 274 236 272 160 C272 100 128 100 128 160 Z" fill="url(#av-skin)"/>
    <!-- blush -->
    <ellipse class="av-blush" cx="150" cy="250" rx="17" ry="7" fill="#ff8fa3" opacity=".32"/>
    <ellipse class="av-blush" cx="250" cy="250" rx="17" ry="7" fill="#ff8fa3" opacity=".32"/>

    <!-- eyes -->
    <g class="av-eye" style="transform-origin:164px 210px">
      <path d="M138 214 C143 191 180 188 188 205 C186 224 150 232 138 214 Z" fill="#fff"/>
      <g clip-path="url(#av-eye-l)"><g class="av-iris">
        <ellipse cx="164" cy="211" rx="16" ry="20" fill="url(#av-iris)"/>
        <ellipse cx="164" cy="213" rx="7" ry="10" fill="#3a1d06"/>
        <circle cx="157" cy="202" r="5.5" fill="#fff"/>
        <circle cx="170" cy="219" r="2.6" fill="#fff" opacity=".9"/>
      </g></g>
      <path d="M131 212 C139 184 183 180 191 203 L186 205 C177 190 146 193 137 215 Z" fill="#2b1d14"/>
      <path d="M135 207 L125 199" stroke="#2b1d14" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M152 228 C163 231 175 228 182 221" fill="none" stroke="#6b4a36" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>
    </g>
    <g class="av-eye" style="transform-origin:236px 210px">
      <path d="M262 214 C257 191 220 188 212 205 C214 224 250 232 262 214 Z" fill="#fff"/>
      <g clip-path="url(#av-eye-r)"><g class="av-iris">
        <ellipse cx="236" cy="211" rx="16" ry="20" fill="url(#av-iris)"/>
        <ellipse cx="236" cy="213" rx="7" ry="10" fill="#3a1d06"/>
        <circle cx="229" cy="202" r="5.5" fill="#fff"/>
        <circle cx="242" cy="219" r="2.6" fill="#fff" opacity=".9"/>
      </g></g>
      <path d="M269 212 C261 184 217 180 209 203 L214 205 C223 190 254 193 263 215 Z" fill="#2b1d14"/>
      <path d="M265 207 L275 199" stroke="#2b1d14" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M248 228 C237 231 225 228 218 221" fill="none" stroke="#6b4a36" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>
    </g>
    <!-- happy closed eyes (^ ^), shown while laughing -->
    <g class="av-happy-eyes" opacity="0">
      <path d="M142 214 Q164 194 186 214" fill="none" stroke="#2b1d14" stroke-width="5" stroke-linecap="round"/>
      <path d="M214 214 Q236 194 258 214" fill="none" stroke="#2b1d14" stroke-width="5" stroke-linecap="round"/>
    </g>

    <!-- brows -->
    <g class="av-brows">
      <path d="M146 176 Q166 166 188 174" fill="none" stroke="#b07c22" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M254 176 Q234 166 212 174" fill="none" stroke="#b07c22" stroke-width="3.5" stroke-linecap="round"/>
    </g>
    <!-- nose -->
    <path d="M201 240 L198 248 L203 249" fill="none" stroke="#dba592" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- mouth -->
    <path class="av-smile" d="M187 266 Q200 276 213 266" fill="none" stroke="#b4524a" stroke-width="3" stroke-linecap="round"/>
    <g class="av-mouth" style="transform-origin:200px 264px" opacity="0">
      <path d="M186 264 Q200 260 214 264 Q211 284 200 286 Q189 284 186 264 Z" fill="#7a2430"/>
      <ellipse cx="200" cy="279" rx="7.5" ry="4.5" fill="#e27380"/>
      <path d="M188 264 Q200 262 212 264 L211 268 Q200 266 189 268 Z" fill="#fff" opacity=".9"/>
    </g>

    <!-- front hair: bangs + side locks -->
    <path d="M114 180 C108 98 150 56 200 56 C250 56 292 98 286 180 L270 150 L260 176 L246 132 L231 160 L215 118 L200 152 L185 118 L169 160 L154 132 L140 176 L130 150 Z" fill="url(#av-hair)"/>
    <path d="M128 146 C114 204 116 262 134 312 C142 262 144 212 152 168 Z" fill="url(#av-hair)"/>
    <path d="M272 146 C286 204 284 262 266 312 C258 262 256 212 248 168 Z" fill="url(#av-hair)"/>
    <path d="M170 70 C160 90 156 110 158 128 M232 70 C244 92 248 112 246 130" stroke="#fff4cf" stroke-width="4" stroke-linecap="round" fill="none" opacity=".6"/>

    <!-- hair ties + sparkle clip -->
    <path d="M128 110 L110 97 Q106 110 111 124 Z M128 110 L146 97 Q150 110 145 124 Z" fill="#161a26"/><circle cx="128" cy="110" r="5" fill="#f5c542"/>
    <path d="M272 110 L254 97 Q250 110 255 124 Z M272 110 L290 97 Q294 110 289 124 Z" fill="#161a26"/><circle cx="272" cy="110" r="5" fill="#f5c542"/>
    <path d="M258 92 Q260 103 270 105 Q260 107 258 118 Q256 107 246 105 Q256 103 258 92 Z" fill="#f5c542" stroke="#b98221" stroke-width="1"/>
  </g>
</svg>`;

const lerp = (a, b, t) => a + (b - a) * t;

export class AnimeAvatar {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'anime-avatar';
    this.el.innerHTML = SVG;
    container.append(this.el);
    const q = (s) => this.el.querySelector(s);
    const qa = (s) => [...this.el.querySelectorAll(s)];
    this.parts = {
      head: q('.av-head'), body: q('.av-body'), tailL: q('.av-tail-l'), tailR: q('.av-tail-r'),
      eyes: qa('.av-eye'), irises: qa('.av-iris'), brows: q('.av-brows'), smile: q('.av-smile'),
      mouth: q('.av-mouth'), blush: qa('.av-blush'), happy: q('.av-happy-eyes'),
    };
    this.state = 'idle';
    this.mouth = 0;
    this.look = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.nextBlink = performance.now() + 1500;
    this.blinkT = -1;
    this.joy = 0;
    this.getLevel = () => 0;
    this._onMove = (e) => {
      const r = this.el.getBoundingClientRect();
      this.target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 1.2)));
      this.target.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.42)) / (r.height * 1.2)));
    };
    window.addEventListener('pointermove', this._onMove);
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  /** idle | listening | thinking | speaking */
  setState(state) { this.state = state; }

  /** A short burst of happiness (^ ^ eyes + blush), e.g. when she laughs. */
  cheer(ms = 1400) { this.joyUntil = performance.now() + ms; }

  _tick(t) {
    const p = this.parts;
    const s = t / 1000;
    const level = this.getLevel();

    // lip-sync with a little smoothing
    this.mouth = lerp(this.mouth, level, level > this.mouth ? 0.55 : 0.25);
    const open = this.mouth > 0.06;
    p.mouth.setAttribute('opacity', open ? 1 : 0);
    p.smile.setAttribute('opacity', open ? 0 : 1);
    p.mouth.style.transform = `scale(${0.8 + this.mouth * 0.35}, ${0.25 + this.mouth * 1.05})`;

    // head + body motion per state
    let tilt = Math.sin(s * 0.7) * 2, nod = 0, lookUp = 0;
    if (this.state === 'thinking') { tilt = 7 + Math.sin(s * 1.5) * 1.5; lookUp = -0.8; }
    else if (this.state === 'listening') { tilt = -4 + Math.sin(s * 1.1) * 1.2; }
    else if (this.state === 'speaking') { tilt = Math.sin(s * 1.9) * 3; nod = Math.sin(s * 5.2) * this.mouth * 3; }
    p.head.style.transform = `translateY(${Math.sin(s * 1.6) * 2 + nod}px) rotate(${tilt}deg)`;
    p.body.style.transform = `translateY(${Math.sin(s * 1.6) * 1.5}px) scaleY(${1 + Math.sin(s * 1.6) * 0.006})`;
    const sway = Math.sin(s * 1.3) * 3 + tilt * 0.4;
    p.tailL.style.transform = `rotate(${sway}deg)`;
    p.tailR.style.transform = `rotate(${sway * 0.9 - Math.sin(s * 1.1)}deg)`;

    // eyes follow the pointer (or glance up while thinking)
    const tx = this.state === 'thinking' ? 0.6 : this.target.x;
    const ty = this.state === 'thinking' ? lookUp : this.target.y;
    this.look.x = lerp(this.look.x, tx, 0.08);
    this.look.y = lerp(this.look.y, ty, 0.08);
    for (const iris of p.irises) iris.style.transform = `translate(${this.look.x * 7}px, ${this.look.y * 5}px)`;
    p.brows.style.transform = `translateY(${this.state === 'listening' ? -4 : this.state === 'thinking' ? -2 : 0}px)`;

    // blinking
    if (t > this.nextBlink && this.blinkT < 0) this.blinkT = t;
    let lid = 1;
    if (this.blinkT >= 0) {
      const k = (t - this.blinkT) / 160;
      lid = k < 0.5 ? 1 - k * 2 * 0.92 : 0.08 + (k - 0.5) * 2 * 0.92;
      if (k >= 1) { this.blinkT = -1; lid = 1; this.nextBlink = t + 2200 + Math.random() * 3200 + (Math.random() < 0.15 ? -1800 : 0); }
    }

    // joy: ^ ^ eyes and extra blush
    const joyTarget = t < (this.joyUntil || 0) ? 1 : 0;
    this.joy = lerp(this.joy, joyTarget, 0.15);
    for (const eye of p.eyes) { eye.style.transform = `scaleY(${Math.max(0.05, lid * (1 - this.joy))})`; }
    p.happy.setAttribute('opacity', this.joy.toFixed(2));
    const blush = 0.28 + this.joy * 0.35 + (this.state === 'speaking' ? 0.06 : 0);
    for (const b of p.blush) b.setAttribute('opacity', blush.toFixed(2));

    this._raf = requestAnimationFrame((tt) => this._tick(tt));
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onMove);
    this.el.remove();
  }
}
