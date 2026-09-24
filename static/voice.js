// Voice input (microphone + local Whisper) and voice output (offline system voices).

import { toSpeech } from './markdown.js';

// ------------------------------------------------------------------ input
export class Mic {
  constructor() { this.stream = null; this.ctx = null; this.analyser = null; this.muted = false; }

  async open() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone needs a secure page. Open Athena at http://localhost:8765 on this PC.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.analyser = null;
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  /**
   * Record one utterance. Stops automatically after a pause in speech.
   * Resolves to a Blob, or null if nothing was said / it was cancelled.
   */
  record({ onLevel, silenceMs = 1100, maxMs = 45000, waitMs = 20000, signal } = {}) {
    return new Promise((resolve) => {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const t0 = performance.now();
      let spoke = false, lastVoice = t0, noise = 0.01, calib = [], timer, cancelled = false;

      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearInterval(timer);
        onLevel?.(0);
        resolve(spoke && !cancelled && chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null);
      };
      const stop = () => rec.state !== 'inactive' && rec.stop();
      this._stop = stop;
      signal?.addEventListener('abort', () => { cancelled = true; stop(); }, { once: true });

      rec.start(250);
      timer = setInterval(() => {
        const now = performance.now();
        const lvl = this.muted ? 0 : this.level();
        onLevel?.(Math.min(1, lvl * 12));
        if (now - t0 < 350) { calib.push(lvl); return; }
        if (calib.length) { noise = Math.max(0.006, calib.reduce((a, b) => a + b, 0) / calib.length); calib = []; }
        const threshold = Math.max(0.018, noise * 2.6);
        if (lvl > threshold) { spoke = true; lastVoice = now; }
        if ((spoke && now - lastVoice > silenceMs) || now - t0 > maxMs || (!spoke && now - t0 > waitMs)) stop();
      }, 50);
    });
  }

  /** Force the current recording to finish now (e.g. user pressed the mic button again). */
  finish() { this._stop?.(); }
}

export async function transcribe(blob) {
  const form = new FormData();
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('audio', blob, `speech.${ext}`);
  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Transcription failed');
  return (await res.json()).text || '';
}

/** Fallback when Whisper isn't installed: the browser's recognizer (Chrome/Edge need internet for this). */
export function browserRecognize({ signal } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error('No speech recognition available. Run install-voice to enable offline Whisper.'));
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    let text = '';
    r.onresult = (e) => { text = Array.from(e.results).map((x) => x[0].transcript).join(' '); };
    r.onerror = (e) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(`Speech recognition: ${e.error}`)));
    r.onend = () => resolve(text);
    signal?.addEventListener('abort', () => r.abort(), { once: true });
    r.start();
  });
}

// ----------------------------------------------------------------- output
export function listVoices() {
  return (speechSynthesis?.getVoices() || []).slice().sort((a, b) => (b.localService - a.localService) || a.name.localeCompare(b.name));
}

export function voicesReady() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve([]);
    if (speechSynthesis.getVoices().length) return resolve(listVoices());
    speechSynthesis.addEventListener('voiceschanged', () => resolve(listVoices()), { once: true });
    setTimeout(() => resolve(listVoices()), 1500);
  });
}

function pickVoice(name) {
  const voices = listVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  const lang = (navigator.language || 'en').slice(0, 2);
  const local = voices.filter((v) => v.localService && v.lang.startsWith(lang));
  return local.find((v) => /natural|aria|jenny|zira|samantha|female/i.test(v.name)) || local[0] || voices.find((v) => v.localService) || voices[0] || null;
}

/** Speaks streamed text sentence-by-sentence so Athena starts talking before the reply is finished. */
export class Speaker {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.pending = 0;
    this._waiters = [];
    this.onStart = this.onEnd = null;
    this.reset();
  }

  /** Start tracking a new piece of text (call before feeding a new reply). */
  reset() { this.spokenUpTo = 0; }

  get speaking() { return this.pending > 0; }

  /** Feed the full text so far; complete sentences get queued. */
  feed(fullText, final = false) {
    const text = toSpeech(fullText);
    const upto = this.spokenUpTo;
    if (final) {
      this._say(text.slice(upto));
      this.spokenUpTo = text.length;
    } else {
      // Speak up to the last finished sentence (punctuation followed by whitespace).
      const rest = text.slice(upto);
      const re = /[.!?;:\n]+\s+/g;
      let m, end = 0;
      while ((m = re.exec(rest))) end = m.index + m[0].length;
      if (end && rest.slice(0, end).trim().length > 1) { this._say(rest.slice(0, end)); this.spokenUpTo = upto + end; }
    }
    if (final && !this.pending) this._resolveWaiters();
  }

  say(text) { this.feed(text, true); }

  _say(chunk) {
    chunk = chunk.replace(/\s+/g, ' ').trim();
    if (!chunk || !/[\p{L}\p{N}]/u.test(chunk) || !window.speechSynthesis) return;
    const s = this.getSettings();
    const u = new SpeechSynthesisUtterance(chunk);
    const v = pickVoice(s.tts_voice);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(s.tts_rate) || 1;
    this.pending++;
    u.onstart = () => this.onStart?.();
    u.onend = u.onerror = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (!this.pending) { this.onEnd?.(); this._resolveWaiters(); }
    };
    speechSynthesis.speak(u);
  }

  stop() {
    window.speechSynthesis?.cancel();
    this.pending = 0;
    this._resolveWaiters();
  }

  done() {
    return this.pending ? new Promise((r) => this._waiters.push(r)) : Promise.resolve();
  }

  _resolveWaiters() { const w = this._waiters; this._waiters = []; w.forEach((r) => r()); }
}
