// Marble theme: white marble with soft grey clouds and thin gold veins, drawn once on this PC (no image files).

let cached = '';

function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const val = (x, y) => perm[perm[x & 255] + (y & 255)] / 255;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(noise, x, y, octaves) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/** Returns a data URL of a marble slab (drawn at low resolution; it's scaled up softly as a background). */
export function marbleTexture(width = 720, height = 450) {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const n1 = makeNoise(7), n2 = makeNoise(42);
  const gold = [214, 184, 118]; // pale gold, so the veins stay in the background
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / 220, ny = y / 220;
      // Soft grey clouds in the stone
      const cloud = fbm(n2, nx * 1.2, ny * 1.2, 5);
      // Veins: long diagonal bands, gently bent by turbulence; thin gold where the band crosses zero
      const turb = fbm(n1, nx, ny, 5);
      const vein = Math.abs(Math.sin((x * 0.8 + y * 0.5) / 120 + turb * 3.2));
      const fine = Math.abs(Math.sin((x * 0.3 - y * 0.9) / 80 + fbm(n1, nx * 1.6 + 9, ny * 1.6, 5) * 4));
      const goldAmt = Math.pow(Math.max(0, 1 - vein / 0.03), 1.5) * 0.45 + Math.pow(Math.max(0, 1 - fine / 0.018), 1.5) * 0.15;
      const greyAmt = Math.max(0, 1 - vein / 0.22) * 0.06 + Math.max(0, 1 - fine / 0.1) * 0.02 + (cloud - 0.5) * 0.07;
      let r = 250 - greyAmt * 85, g = 248 - greyAmt * 84, b = 244 - greyAmt * 78;
      const k = Math.min(1, goldAmt);
      r += (gold[0] - r) * k; g += (gold[1] - g) * k; b += (gold[2] - b) * k;
      const i = (y * width + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cached = canvas.toDataURL('image/jpeg', 0.9);
  return cached;
}
