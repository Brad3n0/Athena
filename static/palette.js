// Accent colours. Everything gold (buttons, logo, orb, stars) follows the chosen accent.

export const ACCENTS = {
  gold: {
    name: 'Gold', accent: '#f5c542', accent2: '#ffd970', deep: '#c28a12', rgb: [245, 197, 66], light: [255, 217, 112],
    logo: ['#ffd970', '#d49b17'], orb: [[255, 205, 90], [240, 140, 20], [255, 236, 170]], base: '#6b4210', star: [255, 222, 150],
  },
  rose: {
    name: 'Rose gold', accent: '#eaa597', accent2: '#f7c9bf', deep: '#b8685a', rgb: [234, 165, 151], light: [247, 201, 191],
    logo: ['#f9d3ca', '#c9786a'], orb: [[247, 190, 175], [214, 120, 105], [255, 228, 220]], base: '#5a2a24', star: [255, 212, 202],
  },
  silver: {
    name: 'Silver', accent: '#d6dbe4', accent2: '#f1f4f9', deep: '#6b7486', rgb: [214, 219, 228], light: [236, 240, 246],
    logo: ['#ffffff', '#9aa3b2'], orb: [[225, 230, 240], [150, 160, 180], [255, 255, 255]], base: '#2e3440', star: [222, 230, 246],
  },
  cyan: {
    name: 'Cyan', accent: '#22d3ee', accent2: '#67e8f9', deep: '#0e7f9c', rgb: [34, 211, 238], light: [103, 232, 249],
    logo: ['#a5f3fc', '#0891b2'], orb: [[103, 232, 249], [14, 165, 233], [207, 250, 254]], base: '#0e3a50', star: [170, 235, 250],
  },
  emerald: {
    name: 'Emerald', accent: '#34d399', accent2: '#6ee7b7', deep: '#047857', rgb: [52, 211, 153], light: [110, 231, 183],
    logo: ['#a7f3d0', '#059669'], orb: [[110, 231, 183], [16, 185, 129], [209, 250, 229]], base: '#0b3b2c', star: [170, 240, 210],
  },
};

let current = ACCENTS.gold;
export const palette = () => current;

export function applyAccent(name) {
  current = ACCENTS[name] || ACCENTS.gold;
  const root = document.documentElement;
  const light = root.dataset.theme === 'light';
  const set = (k, v) => root.style.setProperty(k, v);
  set('--accent', light ? current.deep : current.accent);
  set('--accent-2', light ? current.deep : current.accent2);
  set('--accent-rgb', current.rgb.join(', '));
  set('--logo-1', current.logo[0]);
  set('--logo-2', current.logo[1]);
  root.dataset.accent = name in ACCENTS ? name : 'gold';
}

let uid = 0;
/** The spearhead A + spark logo as inline SVG, so it can follow the accent colour. */
export function logoSvg(cls = '') {
  const id = `lg${++uid}`;
  return `<svg class="logo-mark ${cls}" viewBox="10 9 44 44" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" style="stop-color:var(--logo-1)"/><stop offset="1" style="stop-color:var(--logo-2)"/></linearGradient></defs>` +
    `<path d="M17 49 L32 13 L47 49" fill="none" stroke="url(#${id})" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M32 31 Q33 37 38 38 Q33 39 32 45 Q31 39 26 38 Q31 37 32 31 Z" style="fill:var(--logo-1)"/></svg>`;
}
