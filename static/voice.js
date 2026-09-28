// Voice input (microphone + local Whisper) and voice output (offline system voices).

import { toSpeech } from './markdown.js';

// ------------------------------------------------------------------ input
export class Mic {
  constructor() { this.stream = null; this.ctx = null; this.analyser = null; this.muted = false; this.deviceId = ''; }

  /** Use a specific microphone ('' = the Windows default). Takes effect the next time it opens. */
  setDevice(id) {
    if ((id || '') === this.deviceId) return;
    this.deviceId = id || '';
    if (this.stream) this.close();
  }

  async open() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone needs a secure page. Open Athena at http://localhost:8765 on this PC.');
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.deviceId ? { ...audio, deviceId: { exact: this.deviceId } } : audio });
    } catch (e) {
      if (!this.deviceId || e.name !== 'OverconstrainedError') throw e;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio }); // the chosen mic was unplugged: use the default
    }
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
        // Background noise = the quietest moments of the first third of a second. (Using the average meant that
        // talking straight away was mistaken for noise, and then nothing quieter than a shout counted as speech.)
        if (calib.length) { noise = Math.min(0.02, Math.max(0.004, Math.min(...calib))); calib = []; }
        const threshold = Math.min(0.045, Math.max(0.011, noise * 2.4));
        if (lvl > threshold) { spoke = true; lastVoice = now; }
        if ((spoke && now - lastVoice > silenceMs) || now - t0 > maxMs || (!spoke && now - t0 > waitMs)) stop();
      }, 50);
    });
  }

  /** Force the current recording to finish now (e.g. user pressed the mic button again). */
  finish() { this._stop?.(); }
}

/** Language Whisper heard in the last transcription ("en", "es"…). */
export let lastLanguage = 'en';

export async function transcribe(blob) {
  const form = new FormData();
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('audio', blob, `speech.${ext}`);
  const res = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Transcription failed');
  const out = await res.json();
  if (out.language) lastLanguage = out.language;
  return out.text || '';
}

/** Fallback when Whisper isn't installed: the browser's recognizer (Chrome/Edge need internet for this). */
export function browserRecognize({ signal, lang } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.reject(new Error('No speech recognition available. Run install-voice to enable offline Whisper.'));
  return new Promise((resolve, reject) => {
    const r = new SR();
    r.lang = (lang && lang !== 'auto' ? lang : '') || navigator.language || 'en-US';
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
  return (window.speechSynthesis?.getVoices() || []).slice().sort((a, b) => (b.localService - a.localService) || a.name.localeCompare(b.name));
}

export function voicesReady() {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve([]);
    if (speechSynthesis.getVoices().length) return resolve(listVoices());
    speechSynthesis.addEventListener('voiceschanged', () => resolve(listVoices()), { once: true });
    setTimeout(() => resolve(listVoices()), 1500);
  });
}

function pickVoice(name, speakLang) {
  const voices = listVoices();
  if (speakLang && speakLang !== 'en') { // another language: the chosen (English) voice would mangle it
    const match = voices.filter((v) => v.lang.toLowerCase().startsWith(speakLang));
    if (match.length) return match.find((v) => v.localService) || match[0];
  }
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  const lang = (navigator.language || 'en').slice(0, 2);
  const local = voices.filter((v) => v.localService && v.lang.startsWith(lang));
  return local.find((v) => /natural|aria|jenny|zira|samantha|female/i.test(v.name)) || local[0] || voices.find((v) => v.localService) || voices[0] || null;
}

/**
 * Speaks streamed text sentence-by-sentence so Athena starts talking before the reply is finished.
 * Uses the natural Kokoro voice from the server when available, otherwise the system voices.
 * `level()` reports how loud she is right now (0..1), which drives the avatar's lip-sync.
 */
export class Speaker {
  constructor(getConfig) {
    this.getConfig = getConfig; // () => ({ settings, kokoro })
    this.pending = 0;
    this.queue = [];
    this.playing = null;
    this.gen = 0;
    this._waiters = [];
    this._pulse = 0;
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

  _useKokoro() {
    const { settings, kokoro, lang } = this.getConfig();
    return kokoro && settings.tts_engine !== 'system' && !this.badLangs?.has(lang);
  }

  _say(chunk) {
    chunk = chunk.replace(/\s+/g, ' ').trim();
    if (!chunk || !/[\p{L}\p{N}]/u.test(chunk)) return;
    this.pending++;
    if (this._useKokoro()) this._queueKokoro(chunk);
    else this._speakSystem(chunk);
  }

  // ---- natural voice (Kokoro on the server) ----
  _ctx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _queueKokoro(text) {
    const { settings, lang } = this.getConfig();
    const pitch = Number(settings.voice_pitch) || 1;
    const rate = Number(settings.tts_rate) || 1;
    const gen = this.gen;
    // Start synthesizing right away so the next sentence is ready when this one ends.
    const audio = fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: settings.kokoro_voice, speed: rate / pitch, lang }),
    }).then((r) => {
      if (r.status === 422) (this.badLangs ||= new Set()).add(lang); // natural voice can't speak it: system voices from now on
      return r.ok ? r.arrayBuffer() : Promise.reject(new Error('tts failed'));
    })
      .then((b) => this._ctx().decodeAudioData(b));
    this.queue.push({ text, audio, pitch, gen });
    if (!this.playing) this._playNext();
  }

  async _playNext() {
    const item = this.queue.shift();
    if (!item) { this.playing = null; return; }
    this.playing = item;
    let buffer;
    try { buffer = await item.audio; } catch { buffer = null; }
    if (item.gen !== this.gen) return; // stopped meanwhile
    if (!buffer) { // fall back to the system voice for this sentence
      this.playing = null;
      this.pending--;
      this._say(item.text);
      if (!this.playing) this._playNext();
      return;
    }
    const src = this._ctx().createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = item.pitch;
    src.connect(this.analyser);
    item.src = src;
    this.current = { text: item.text, start: this.ctx.currentTime, duration: buffer.duration / item.pitch };
    src.onended = () => {
      if (item.gen !== this.gen) return;
      this._finishOne();
      this._playNext();
    };
    this.onStart?.();
    src.start();
  }

  // ---- system voices (Windows / browser, offline voices only if chosen) ----
  _speakSystem(text) {
    if (!window.speechSynthesis) { this._finishOne(); return; }
    const { settings, lang } = this.getConfig();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(settings.tts_voice, lang);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(settings.tts_rate) || 1;
    u.pitch = Math.min(2, Number(settings.voice_pitch) || 1);
    u.onstart = () => { this.current = { text, charIndex: 0 }; this.onStart?.(); };
    u.onboundary = (e) => { this._pulse = performance.now(); if (this.current) this.current.charIndex = e.charIndex; };
    u.onend = u.onerror = () => this._finishOne();
    this.sysSpeaking = true;
    speechSynthesis.speak(u);
  }

  _finishOne() {
    this.pending = Math.max(0, this.pending - 1);
    if (!this.pending) { this.sysSpeaking = false; this.onEnd?.(); this._resolveWaiters(); }
  }

  /** What she's saying right now and how far through it she is (0..1), for live captions. */
  progress() {
    const c = this.current;
    if (!c || !this.speaking) return null;
    if (c.duration) return { text: c.text, frac: Math.min(1, (this.ctx.currentTime - c.start) / c.duration) };
    return { text: c.text, frac: Math.min(1, (c.charIndex || 0) / Math.max(1, c.text.length)) };
  }

  /** Current loudness 0..1 for lip-sync. */
  level() {
    if (this.playing?.src && this.analyser) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (const x of this.buf) sum += x * x;
      return Math.min(1, Math.sqrt(sum / this.buf.length) * 5);
    }
    if (this.sysSpeaking && window.speechSynthesis?.speaking) {
      // System voices don't expose audio, so fake a natural talking rhythm.
      const t = performance.now();
      const burst = Math.max(0, 1 - (t - this._pulse) / 260);
      return 0.25 + 0.35 * Math.abs(Math.sin(t / 70)) * (0.5 + 0.5 * Math.sin(t / 310)) + 0.3 * burst;
    }
    return 0;
  }

  stop() {
    this.gen++;
    this.queue = [];
    try { this.playing?.src?.stop(); } catch { /* already stopped */ }
    this.playing = null;
    this.current = null;
    window.speechSynthesis?.cancel();
    this.sysSpeaking = false;
    this.pending = 0;
    this._resolveWaiters();
  }

  done() {
    return this.pending ? new Promise((r) => this._waiters.push(r)) : Promise.resolve();
  }

  _resolveWaiters() { const w = this._waiters; this._waiters = []; w.forEach((r) => r()); }
}
