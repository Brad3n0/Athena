// Athena AI — front-end app
import { renderMarkdown, toSpeech } from './markdown.js';
import { Mic, transcribe, browserRecognize, Speaker, voicesReady, listVoices, lastLanguage } from './voice.js';
import { VoiceOrb } from './orb.js';
import { startStars } from './stars.js';
import { marbleTexture, marbleVeins } from './marble.js';
import qrcode from './vendor/qrcode/qrcode.mjs';
import { ACCENTS, applyAccent, logoSvg } from './palette.js';
import { hydrateStudy, flashcardAction, quizAnswer, quizRetry, cardsOf, mistakePrompt } from './study.js';
import { hydrateGraphs } from './graph.js';
import { initCanvas, openCanvas, closeCanvas, syncCanvas, canvasOpen, canvasForChat, applyCanvasReply } from './canvas.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICONS = {
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  tool: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg>',
  canvas: '<svg viewBox="0 0 24 24"><path d="M4 4h10l6 6v10H4z"/><path d="M14 4v6h6M8 14h8M8 17h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  up: '<svg class="thumb" viewBox="0 0 24 24"><path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 10l4-8a2.5 2.5 0 0 1 3 3l-1 4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7"/></svg>',
  down: '<svg class="thumb" viewBox="0 0 24 24"><path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1zM17 14l-4 8a2.5 2.5 0 0 1-3-3l1-4H5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 6.4 3H17"/></svg>',
  brain: '<svg viewBox="0 0 24 24"><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/></svg>',
};

// Curated picks from the Ollama library. VRAM guidance is approximate (default 4-bit quantization).
const RECOMMENDED = [
  { name: 'qwen3:30b-a3b-instruct-2507-q4_K_M', role: 'Assistant · Voice', desc: 'Qwen3 30B Instruct (2507): the most natural, ChatGPT-like talker you can run at home, great at Jarvis commands, and fast (only 3B of it works per word). ~19 GB · 16 GB VRAM + 32 GB RAM' },
  { name: 'qwen3-coder:30b', role: 'Code', desc: 'Top local coding model, also fast. Builds sites, games and apps. ~19 GB · 16 GB VRAM + 32 GB RAM' },
  { name: 'qwen3:14b', role: 'Study', desc: 'Best for schoolwork: top at math & science, shows its reasoning step by step. ~9 GB' },
  { name: 'qwen3-vl:8b', role: 'Vision', desc: 'Reads screenshots, photos, worksheets and handwriting; powers "what\'s on my screen" and clicking by sight. ~6 GB' },
  { name: 'nomic-embed-text', role: 'Documents', desc: 'Lets Athena search your documents in Knowledge. Tiny. ~0.3 GB' },
];

// Preference order used when you haven't chosen a default model yet.
const PREFERENCE = {
  assistant: ['qwen3:30b-a3b-instruct', 'gpt-oss', 'qwen3:', 'qwen3', 'gemma3', 'llama3.1', 'mistral', 'llama3'],
  code: ['qwen3-coder', 'devstral', 'qwen2.5-coder', 'deepseek-coder', 'codestral', 'codellama', 'gpt-oss', 'qwen3'],
  // Best for schoolwork: strong at math/science and step-by-step explanations.
  study: ['qwen3:14b', 'qwen3:32b', 'qwen3:30b', 'gpt-oss:20b', 'qwen3:8b', 'phi4', 'qwen3', 'gpt-oss', 'deepseek-r1', 'gemma3', 'llama3.1', 'mistral', 'llama3'],
  voice: ['qwen3:30b-a3b-instruct', 'qwen3:4b', 'llama3.2', 'gemma3:4b', 'qwen3:1.7b', 'phi4-mini', 'qwen3:8b', 'gemma3', 'llama3.1', 'qwen3'],
};

// ------------------------------------------------------------------ state
const state = {
  settings: {},
  status: { ollama: false },
  models: [],
  chats: [],
  chat: null,
  mode: 'assistant',
  attachments: [],
  abort: null,
  tasks: [],
  voice: { active: false, abort: null },
};

const mic = new Mic();
function voiceSettings() {
  // The voice for the current personality: its own choice (a natural voice or a custom one), else the usual voice.
  const s = state.settings;
  const custom = (s.personas || []).find((p) => p.id === s.persona);
  const choice = (s.persona_voices || {})[s.persona] || custom?.voice || '';
  if (choice.startsWith('custom:')) return { ...s, tts_engine: 'custom', custom_voice_id: choice.slice(7) };
  if (choice) return { ...s, kokoro_voice: choice, ...(s.tts_engine === 'custom' ? { tts_engine: 'auto' } : {}) };
  return s;
}
/** Adaptive voice: she speaks a little softer and slower when you seem down, livelier when you're excited. */
function adaptVoice(settings) {
  if (settings.adaptive_voice === false) return settings;
  const m = state.userMood;
  if (!m || Date.now() - m.at > 20 * 60000) return settings;
  const k = 0.5 + (m.intensity || 0.5) / 2;  // stronger feelings, bigger change
  const [rate, pitch] = {
    sad: [0.9, 0.97], stressed: [0.93, 0.98], tired: [0.9, 0.97], angry: [0.95, 0.98],
    excited: [1.08, 1.04], happy: [1.04, 1.02], loving: [0.96, 1.01],
  }[m.mood] || [1, 1];
  return { ...settings, tts_rate: (Number(settings.tts_rate) || 1) * (1 + (rate - 1) * k),
    voice_pitch: (Number(settings.voice_pitch) || 1) * (1 + (pitch - 1) * k) };
}
const speaker = new Speaker(() => {
  const settings = adaptVoice(voiceSettings());
  return { settings, kokoro: !!state.status.kokoro || (settings.tts_engine === 'custom' && !!state.status.custom_voice), lang: speakingLanguage() };
});
let lastVoiceFail = 0;
speaker.onFail = (why) => {  // nothing could play: say so instead of staying silent
  if (Date.now() - lastVoiceFail < 15000) return;
  lastVoiceFail = Date.now();
  toast(`I couldn't play my voice (${why}). Check your speakers and volume, or run Settings → Health check.`, 'error', { ms: 8000 });
};

/** The language she should speak: the one you chose, or (on auto) the one you last spoke. */
function speakingLanguage() {
  const lang = state.settings?.language || 'en';
  return lang === 'auto' ? (state.status?.whisper ? lastLanguage : 'en') : lang;
}

// ------------------------------------------------------------------- api
async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } };
  const res = await fetch(path, init);
  if (res.status === 401) showLock();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
const json = (method, body) => ({ method, body: JSON.stringify(body) });

function toast(text, kind = '', { action = null, ms = 0 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = (e) => { e.stopPropagation(); el.remove(); action.fn(); };
    el.append(b);
  }
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms || (kind === 'alarm' ? 15000 : 4500));
  el.onclick = () => el.remove();
  return el;
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = state.settings.theme || 'dark';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // Marble: the light theme on white-and-gold marble
  document.documentElement.dataset.skin = t === 'marble' ? 'marble' : '';
  if (t === 'marble') {
    document.documentElement.style.setProperty('--marble', `url(${marbleTexture()})`);
    document.documentElement.style.setProperty('--marble-veins', `url(${marbleVeins()})`);
  }
  applyAccent(state.settings.accent || 'gold');
  document.documentElement.dataset.size = state.settings.text_size || 'normal';
  document.documentElement.dataset.compact = state.settings.compact ? 'true' : 'false';
  document.documentElement.dataset.motion = motionOff() ? 'reduce' : 'full';
}
/** "Reduce animations" in Settings, or the same choice in Windows. */
function motionOff() { return !!state.settings?.reduce_motion || matchMedia('(prefers-reduced-motion: reduce)').matches; }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// --------------------------------------------------------------- status
async function refreshStatus() {
  try { state.status = await api('/api/status'); state.pcReachable = true; } catch (e) {
    // fetch itself failing (not an error reply) means this device can't reach the PC at all, e.g. a phone that left
    // home Wi-Fi: say that, instead of "no models installed".
    state.pcReachable = !(e instanceof TypeError);
    state.status = { ollama: false };
  }
  if (!state.pcReachable) { showUnreachable(); return; }
  const el = $('#status');
  const eng = state.status.engine || {};
  const own = eng.mode === 'builtin';
  el.classList.toggle('ok', !!state.status.ollama);
  el.classList.toggle('bad', !state.status.ollama);
  $('#statusText').textContent = state.status.ollama
    ? `${eng.in_use ? `${eng.brain_name || "Athena's Brain"}` : `Ollama ${state.status.ollama_version || ''}`} · ${state.settings.offline_mode ? '✈️ Offline mode' : 'offline & private'}`
    : own ? engineLine(eng) : 'Ollama not running';
  const banner = $('#banner');
  watchEngine(eng);
  if (own && (eng.state === 'downloading' || eng.state === 'error' || (!eng.in_use && eng.state !== 'ready'))) {
    banner.innerHTML = engineBanner(eng);
    banner.hidden = false;
    $('#engineRetry')?.addEventListener('click', () => api('/api/engine', json('POST', { engine: 'builtin' })).then(refreshStatus));
  } else if (!state.status.ollama) {
    banner.innerHTML = `<b>Can't reach Ollama.</b> Start the Ollama app (or run <code>ollama serve</code>), then this will connect automatically. Looking at <code>${escapeHtml(state.status.ollama_url || 'http://127.0.0.1:11434')}</code>.`;
    banner.hidden = false;
  } else banner.hidden = true;
}

// ------------------------------------------------ Athena's own engine (her brain downloads and runs by itself)
const gb = (n) => (n / 1e9).toFixed(1);
function engineLine(eng) {
  if (eng.state === 'downloading') return `Downloading ${eng.what}… ${eng.percent ?? 0}%`;
  if (eng.state === 'starting') return 'Loading Athena’s brain…';
  if (eng.state === 'error') return 'Athena’s engine needs attention';
  return 'Starting Athena’s engine…';
}
function engineBanner(eng) {
  if (eng.state === 'downloading') {
    const size = eng.total ? ` (${gb(eng.done)} of ${gb(eng.total)} GB)` : '';
    return `<b>Setting up Athena's own brain, one time only:</b> downloading ${escapeHtml(eng.what)} ${eng.percent ?? 0}%${size}.
      <div class="engine-bar"><div style="width:${eng.percent ?? 0}%"></div></div>
      After this she runs entirely on your PC with no Ollama. ${state.status.ollama ? 'You can keep chatting with Ollama meanwhile.' : 'She’ll be ready by herself when it finishes.'}`;
  }
  if (eng.state === 'error') {
    return `<b>Athena's engine couldn't start:</b> ${escapeHtml(eng.error || 'unknown problem')}
      <button type="button" class="ghost" id="engineRetry">Try again</button>
      <span class="muted small">Or switch to Ollama in Settings → Models → Engine.</span>`;
  }
  return '<b>Loading Athena’s brain…</b> this takes a few seconds.';
}
let engineTimer = null, engineWas = '';
function watchEngine(eng) {
  clearTimeout(engineTimer);
  if (eng.mode === 'builtin' && (eng.state !== 'ready' || !eng.in_use) && eng.state !== 'error') {
    engineTimer = setTimeout(refreshStatus, 2000); // keep the progress moving
  }
  if (eng.in_use && eng.state === 'ready' && engineWas !== 'ready') {
    if (engineWas) toast('✨ Athena’s own brain is ready. She no longer needs Ollama.');
    refreshModels();
  }
  engineWas = eng.in_use ? eng.state : (eng.state || '');
  if (!$('#settings').open || !$('#engineBox')) return;
  fillEngine(eng);
}
function fillEngine(eng) {
  if (!eng.brains) return;
  $('#setEngine').value = eng.mode;
  $('#setBrain').innerHTML = Object.entries(eng.brains).map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('');
  $('#setBrain').value = eng.brain;
  $('#brainRow').hidden = eng.mode !== 'builtin';
  $('#brainUpgrade').hidden = !(eng.mode === 'builtin' && eng.upgrade);
  if (eng.upgrade) $('#brainUpgrade').innerHTML = `✨ <b>A smarter brain is available:</b> ${escapeHtml(eng.upgrade.label)}. Her memories, lessons, library and settings all stay; the old brain is deleted once the new one works.
    <button type="button" class="primary" id="brainUpgradeBtn">Upgrade her brain</button>`;
  $('#engineNote').innerHTML = eng.mode !== 'builtin' ? 'Using the Ollama app. The models below are Ollama’s.'
    : eng.in_use && eng.state === 'ready' ? `✓ Running on her own engine${eng.build ? ` (llama.cpp ${escapeHtml(eng.build)})` : ''}. The Ollama model lists below aren't used.`
    : eng.state === 'off' && eng.in_use ? '✓ Her brain is unloaded to free the graphics card; it loads again on your next message.'
    : engineLine(eng);
}

let reconnectTimer = null;
function showUnreachable() {
  const banner = $('#banner');
  banner.innerHTML = `<b>Can't reach Athena on your PC.</b> Athena runs on your PC, and this device can't see it right now
    (for example, your phone left your home Wi-Fi). Make sure the PC is on with Athena running. To use her from school or on
    mobile data, install the free <b>Tailscale</b> app on the PC and this phone (same account), then open the
    “From anywhere” address shown in Settings → Desktop app on the PC. This reconnects by itself.`;
  banner.hidden = false;
  $('#statusText').textContent = 'Not connected to your PC';
  $('#status').classList.add('bad'); $('#status').classList.remove('ok');
  if ($('#modelName')) $('#modelName').textContent = "Can't reach your PC";
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    await refreshStatus();
    if (state.pcReachable) { await refreshModels(); }
  }, 5000);
}

async function refreshModels() {
  const res = await api('/api/models').catch(() => ({ models: [] }));
  state.models = res.models || [];
  renderModelButton();
}

const modelNames = () => state.models.map((m) => m.name);

function pickDefaultModel(mode) {
  const names = modelNames();
  const chosen = state.settings.models?.[mode];
  if (chosen && names.includes(chosen)) return chosen;
  for (const pref of PREFERENCE[mode] || []) {
    const hit = names.find((n) => n.startsWith(pref));
    if (hit) return hit;
  }
  if (mode === 'voice') return pickDefaultModel('assistant');
  return names.find((n) => !/embed/.test(n)) || '';
}

const fmtSize = (b) => (b ? (b / 1e9 >= 1 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`) : '');

// ---------------------------------------------------------- auto: one Athena, the best model for each message
// In the Assistant tab she picks the specialist herself: code questions go to the coder, math and school to the
// study model, pictures to the vision model, everything else to the all-rounder. Instant (no extra AI call).
const autoOn = () => state.mode === 'assistant' && state.settings.auto_route !== false && !state.chat?.pinnedModel;
const ROUTE_LABEL = { code: '💻 code', study: '🧮 math & study', vision: '👁 vision', assistant: '✨ general' };
const CODE_WORDS = /\b(code|coding|program|programming|script|bug|debug|compile|compiler|python|javascript|typescript|java|c\+\+|c#|rust|golang|html|css|react|vue|node|api|sql|regex|json|function|variable|loop|array|github|git|terminal|powershell|batch file|localhost|npm|pip|syntax|runtime|stack ?overflow|frontend|backend|database|website|webpage|web page|web app|landing page|discord bot|minecraft mod)\b/g;
const STUDY_WORDS = /\b(solve|equation|equations|derivative|derivatives|integral|integrals|calculus|algebra|geometry|trig|trigonometry|limit|limits|polynomial|fraction|fractions|percent|percentage|probability|statistics|matrix|matrices|vector|proof|theorem|homework|worksheet|quiz me|flashcards?|study guide|exam|chemistry|physics|biology|molecule|atom|velocity|acceleration|formula|simplify|factor|factoring|slope|parabola|logarithm|exponent|math|history test|essay outline)\b/g;

function routeMessage(text, chat) {
  const t = text.toLowerCase();
  let code = (t.match(CODE_WORDS) || []).length;
  let study = (t.match(STUDY_WORDS) || []).length * 1.5;
  if (/```|\bdef \w+\(|\bfunction \w*\(|=>|console\.log|<\/?(div|html|body|script|button|span)\b|#include|^\s*import \w+|\bclass \w+[:({]|traceback|syntaxerror|typeerror|referenceerror|nullpointer|segmentation fault|exception in/im.test(text)) code += 3;
  if (/\b(build|make|create|write|code|program)\b.{0,40}\b(website|web ?page|web ?app|app|game|bot|script|program|extension|calculator|site|tool|clone)\b/.test(t)) code += 3;
  if (/\w\.(py|js|ts|jsx|tsx|html|css|json|java|cpp|cs|rs|go|bat|ps1)\b/.test(t)) code += 2;
  if (/[=^√∫∑π≤≥÷]|\d\s*[a-z]\s*[+\-=^]|\b\d+\s*[+\-*/x×]\s*\d+\b|\\frac|\b(sin|cos|tan|log|ln)\s*\(/.test(text)) study += 2;
  if (/\b(quiz me|flashcards?|study guide|practice (test|questions|problems)|homework|worksheet|cheat ?sheet)\b/.test(t)) study += 2; // these get Study's interactive quizzes and cards
  if (code >= 2 || study >= 2) return code >= study ? 'code' : 'study';
  // No clear signal: a short follow-up ("why?", "make it shorter") stays with whoever answered last.
  const last = [...chat.messages].reverse().find((m) => m.role === 'assistant' && m.route)?.route;
  const words = t.replace(/[^\w\s']/g, ' ').trim().split(/\s+/).filter(Boolean);
  const followUp = words.length <= 5 ||
    /^(and|also|but|so|then|now|ok|okay|wait|why|how come|what about|what if|can you (also|make|add|fix|change|explain)|could you|make it|make them|explain|show me|do it|try|again|another|one more|more|less|shorter|longer|simpler|harder|easier|fix|change|add|remove|redo|continue|keep going|next)\b/.test(t) ||
    /^\S+(\s+\S+){0,3}\s+(it|this|that|them|those|these)\b/.test(t);
  if (last && last !== 'vision' && followUp) return last;
  return 'assistant';
}

// ---------------------------------------------------------- model picker
function currentModel() {
  if (!state.chat.model || !modelNames().includes(state.chat.model)) state.chat.model = pickDefaultModel(state.mode);
  return state.chat.model;
}

function renderModelButton() {
  if (!state.chat) return;
  $('#modelName').textContent = state.pcReachable === false ? "Can't reach your PC" : autoOn() && state.models.length ? '✨ Auto' : shownModel(currentModel()) || (state.models.length ? 'Select a model' : 'No models installed');
  $('#modelBtn').title = autoOn() ? `Auto picks the best model for each message (usually ${currentModel()})` : '';
  renderReadyDot();
}

// A gold dot = the model is loaded and answers right away; hollow = the first reply takes a few seconds to load it.
state.loaded = [];
function renderReadyDot() {
  const dot = $('#readyDot');
  const model = state.chat && currentModel();
  const on = !!model && state.loaded.includes(model);
  dot.hidden = !model || !state.status.ollama;
  dot.classList.toggle('on', on);
  dot.classList.toggle('loading', state.warming === model);
  dot.title = on ? `${model} is loaded and ready` : state.warming === model ? `Loading ${model}…` : `${model} isn't loaded yet, so the first reply takes a few seconds. Click the dot to load it now.`;
}
async function refreshLoaded() {
  const r = await fetch('/api/models/loaded').then((x) => x.json()).catch(() => ({ models: [] }));
  state.loaded = (r.models || []).flatMap((n) => [n, n.replace(/:latest$/, '')]);
  renderReadyDot();
}
setInterval(() => { if (!document.hidden) refreshLoaded(); }, 15000);
/** Load a model into memory in the background, so the next reply starts right away. */
async function warmModel(model, { quiet = false } = {}) {
  if (!model || !state.status.ollama || state.loaded.includes(model) || state.warming === model) return;
  state.warming = model;
  renderReadyDot();
  try { await api('/api/models/warm', json('POST', { model })); } catch (err) { if (!quiet) toast(err.message, 'error'); }
  if (state.warming === model) state.warming = null;
  refreshLoaded();
}
$('#readyDot').addEventListener('click', (e) => { e.stopPropagation(); warmModel(currentModel()); });
// Get the model ready while you're still reading or typing: when Athena opens and when you switch tabs.
function preloadCurrentModel() {
  if (state.settings.preload_model === false || state.abort) return;
  setTimeout(() => warmModel(currentModel(), { quiet: true }), 300);
}
$('#input').addEventListener('focus', preloadCurrentModel); // you're about to type: get her ready

/** The name to show for a model: her built-in brain shows as its own name (ATH-X), not the engine's internal id. */
function shownModel(name) { return name === 'athena' ? state.status?.engine?.brain_name || "Athena's Brain" : name || ''; }

function openModelMenu() {
  const menu = $('#modelMenu');
  const cur = currentModel();
  const autoRow = state.mode === 'assistant' && state.settings.auto_route !== false
    ? `<button class="opt" data-model="__auto"><div><div>✨ Auto</div><div class="meta">Picks the best model for each message: code, math, pictures or chat</div></div>${autoOn() ? `<span class="check">${ICONS.check}</span>` : ''}</button>`
    : '';
  menu.innerHTML = state.models.length
    ? autoRow + state.models.map((m) => `
      <button class="opt" data-model="${escapeHtml(m.name)}">
        <div><div>${escapeHtml(shownModel(m.name))}</div><div class="meta">${escapeHtml([m.parameters, m.family, fmtSize(m.size)].filter(Boolean).join(' · '))}</div></div>
        ${m.name === cur && !autoOn() ? `<span class="check">${ICONS.check}</span>` : `<span class="cmp-btn" data-compare="${escapeHtml(m.name)}" title="Compare side by side with ${escapeHtml(shownModel(cur))}">⚖</span>`}
      </button>`).join('') + '<div class="hint">⚖ answers your next messages with two models side by side · download more in Settings → Models</div>'
    : '<div class="hint">No models yet. Open Settings → Models to download one.</div>';
  menu.hidden = false;
}

$('#modelBtn').onclick = (e) => { e.stopPropagation(); $('#modelMenu').hidden ? openModelMenu() : ($('#modelMenu').hidden = true); };
$('#modelMenu').onclick = (e) => {
  const cmp = e.target.closest('[data-compare]');
  if (cmp) {
    state.compare = [currentModel(), cmp.dataset.compare];
    $('#modelMenu').hidden = true;
    renderCompareChip();
    toast('⚖ Your next messages get two answers side by side. Keep the one you like.');
    $('#input').focus();
    return;
  }
  const opt = e.target.closest('[data-model]');
  if (!opt) return;
  if (opt.dataset.model === '__auto') {
    state.chat.pinnedModel = false;
    state.chat.model = pickDefaultModel('assistant');
  } else {
    state.chat.model = opt.dataset.model;
    state.chat.pinnedModel = state.mode === 'assistant'; // you picked one yourself: Auto is off for this chat
  }
  $('#modelMenu').hidden = true;
  renderModelButton();
  if (state.chat.id && state.chat.messages.length) saveChat();
};
document.addEventListener('click', (e) => { if (!e.target.closest('.model-picker')) $('#modelMenu').hidden = true; });

// -------------------------------------------------------------- mode
function setMode(mode, { keepModel = false } = {}) {
  state.mode = mode;
  $$('#modeSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (state.chat) {
    state.chat.mode = mode;
    if (!keepModel) state.chat.model = pickDefaultModel(mode);
  }
  $('#input').placeholder = modePlaceholder(mode);
  renderModelButton();
  if (state.chat && !state.chat.messages.length) renderMessages();
}
$('#modeSwitch').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) switchMode(b.dataset.mode).then(() => { $('#input').focus(); preloadCurrentModel(); });
};

// Each mode keeps its own chat: switching to Study shows your study chat (or a fresh one),
// and switching back to Assistant brings back the chat you were in.
const modeChats = {};
const deletedChats = new Set();
let modeChatIds = {};
try { modeChatIds = JSON.parse(localStorage.getItem('athena-mode-chats') || '{}'); } catch { /* ignore */ }

function rememberModeChat() {
  if (!state.chat || (state.chat.startup && !state.chat.messages.length)) return; // the blank chat Athena opens with
  modeChats[state.mode] = state.chat;
  if (state.chat.id) modeChatIds[state.mode] = state.chat.id;
  else delete modeChatIds[state.mode]; // a fresh, empty chat
  try { localStorage.setItem('athena-mode-chats', JSON.stringify(modeChatIds)); } catch { /* ignore */ }
}

// Chats slide and fade in when you switch tabs or chats (never while you're sending messages).
const MODE_ORDER = ['assistant', 'code', 'study'];
function animateSwap(dir = 'up') {
  messagesEl.classList.remove('swap-left', 'swap-right', 'swap-up');
  void messagesEl.offsetWidth; // restart the animation
  messagesEl.classList.add(`swap-${dir}`);
  clearTimeout(animateSwap.t);
  animateSwap.t = setTimeout(() => messagesEl.classList.remove(`swap-${dir}`), 500);
}

async function switchMode(mode) {
  if (mode === state.mode) return;
  if (state.abort) { toast('She\'s still answering. Wait a moment or press stop first.'); return; }
  const dir = MODE_ORDER.indexOf(mode) > MODE_ORDER.indexOf(state.mode) ? 'right' : 'left';
  queueMicrotask(() => animateSwap(dir));
  rememberModeChat();
  // Brand-new chats may not be in the sidebar list yet, so only forget chats you actually deleted.
  const exists = (c) => c && !deletedChats.has(c.id) && (!state.project || c.project_id === state.project);
  const inMemory = modeChats[mode];
  if (exists(inMemory)) {
    state.chat = inMemory;
    setMode(mode, { keepModel: true });
    renderMessages();
    renderSidebar();
    syncCanvas();
    renderWorkspaceChip();
    return;
  }
  const id = modeChatIds[mode];
  if (id && state.chats.some((x) => x.id === id && (!state.project || x.project_id === state.project))) {
    await openChat(id); // switches the mode to the chat's own mode
    return;
  }
  state.mode = mode;
  newChat();
}

function modePlaceholder(mode) {
  return mode === 'code' ? 'Ask Athena to write, explain or fix code'
    : mode === 'study' ? 'What are you studying? Paste notes or attach a worksheet 📎'
    : 'Message Athena';
}

// -------------------------------------------------------------- sidebar
function groupLabel(ts) {
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

const seenChats = new Set();
function renderSidebar() {
  const q = $('#searchChats').value.trim().toLowerCase();
  const firstRender = !seenChats.size;
  const list = $('#chatList');
  list.innerHTML = '';
  let group = '';
  const inProject = state.chats.filter((c) => !state.project || c.project_id === state.project);
  const ordered = [...inProject.filter((c) => c.pinned), ...inProject.filter((c) => !c.pinned)];
  renderProjects();
  for (const c of ordered) {
    if (q && !(c.title || '').toLowerCase().includes(q)) continue;
    const g = c.pinned ? 'Pinned' : groupLabel(c.updated || c.created || Date.now() / 1000);
    if (g !== group) { group = g; list.insertAdjacentHTML('beforeend', `<div class="chat-group">${g}</div>`); }
    const item = document.createElement('div');
    item.className = 'chat-item' + (state.chat?.id === c.id ? ' active' : '') + (!firstRender && !seenChats.has(c.id) ? ' arrive' : '');
    item.dataset.id = c.id;
    seenChats.add(c.id);
    const icon = c.icon ? `<span class="chat-icon">${escapeHtml(c.icon)}</span>` : c.mode === 'code' ? '<span class="chat-icon mode-tag">&lt;/&gt;</span>' : c.mode === 'study' ? '<span class="chat-icon">📘</span>' : '';
    item.innerHTML = `${icon}<span class="title">${escapeHtml(c.title || 'New chat')}</span>
      <span class="actions"><button data-act="pin" title="${c.pinned ? 'Unpin' : 'Pin to top'}">${ICONS.pin}</button><button data-act="move" title="Move to project">${ICONS.folder}</button><button data-act="export" title="Export">${ICONS.download}</button><button data-act="rename" title="Rename">${ICONS.edit}</button><button data-act="delete" title="Delete">${ICONS.trash}</button></span>`;
    list.append(item);
  }
  if (q.length >= 2) {
    list.insertAdjacentHTML('beforeend', '<div class="search-hits" id="searchHits"></div>');
    searchMessages(q);
  } else if (!list.children.length) list.innerHTML = `<div class="chat-group">${state.project ? 'No chats in this project yet' : 'Your chats will appear here'}</div>`;
}

// Full-text search: every message of every chat, shown under the title matches.
let searchTimer = 0;
let searchSeq = 0;
function searchMessages(q) {
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    const results = await api(`/api/search?q=${encodeURIComponent(q)}${state.project ? `&project_id=${state.project}` : ''}`).catch(() => []);
    const box = $('#searchHits');
    if (!box || seq !== searchSeq) return;
    const hits = results.filter((r) => r.hits.length);
    const titleShown = $$('#chatList .chat-item').length;
    if (!hits.length) { box.innerHTML = titleShown ? '' : '<div class="chat-group">No matches</div>'; return; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const mark = (text) => {
      let html = escapeHtml(text);
      for (const w of words) html = html.replace(new RegExp(`(${escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
      return html;
    };
    box.innerHTML = `<div class="chat-group">In messages</div>` + hits.map((r) => `
      <div class="search-hit">
        <div class="sh-title">${r.icon ? `${escapeHtml(r.icon)} ` : ''}${escapeHtml(r.title || 'Chat')}${r.count > 1 ? ` <span class="muted">· ${r.count}</span>` : ''}</div>
        ${r.hits.map((h) => `<button type="button" data-open-hit="${r.id}" data-idx="${h.idx}"><span class="sh-who">${h.role === 'user' ? 'You' : 'Athena'}</span>${mark(h.snippet)}</button>`).join('')}
      </div>`).join('');
  }, 180);
}

$('#chatList').addEventListener('click', async (e) => {
  const hit = e.target.closest('[data-open-hit]');
  if (!hit) return;
  e.stopPropagation();
  await openChat(hit.dataset.openHit);
  const el = messagesEl.querySelector(`.msg[data-idx="${hit.dataset.idx}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center' });
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 2200);
  }
}, true);

$('#chatList').onclick = async (e) => {
  const item = e.target.closest('.chat-item');
  if (!item) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = item.dataset.id;
  if (act === 'pin') {
    const c = state.chats.find((x) => x.id === id);
    await api(`/api/conversations/${id}`, json('PUT', { pinned: !c?.pinned }));
    if (state.chat?.id === id) state.chat.pinned = !c?.pinned;
    await loadChats();
    return;
  }
  if (act === 'move') {
    openMoveMenu(id, e.target.closest('[data-act]'));
    return;
  }
  if (act === 'export') {
    openExportMenu(id, e.target.closest('[data-act]'));
    return;
  }
  if (act === 'delete') {
    // Hide it right away; really delete after a few seconds unless you press Undo.
    const removed = state.chats.find((c) => c.id === id);
    if (!motionOff()) { item.classList.add('leave'); await new Promise((r) => setTimeout(r, 200)); }
    seenChats.delete(id);
    deletedChats.add(id);
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.chat?.id === id) newChat();
    renderSidebar();
    let undone = false;
    toast(`Deleted “${removed?.title || 'chat'}”`, '', {
      ms: 6000,
      action: { label: 'Undo', fn: () => { undone = true; deletedChats.delete(id); loadChats(); } },
    });
    setTimeout(async () => { if (!undone) { await api(`/api/conversations/${id}`, { method: 'DELETE' }).catch(() => {}); } }, 6200);
  } else if (act === 'rename') {
    const title = item.querySelector('.title');
    const input = document.createElement('input');
    input.value = title.textContent;
    title.replaceWith(input);
    input.focus();
    input.select();
    const done = async (save) => {
      const t = input.value.trim();
      if (save && t) {
        const chat = await api(`/api/conversations/${id}`);
        await api(`/api/conversations/${id}`, json('PUT', { ...chat, title: t, autoTitle: false }));
        if (state.chat?.id === id) state.chat.autoTitle = false;
        if (state.chat?.id === id) state.chat.title = t;
        await loadChats();
      } else renderSidebar();
    };
    input.onkeydown = (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.onblur = null; done(false); } };
    input.onblur = () => done(true);
    input.onclick = (ev) => ev.stopPropagation();
  } else if (!item.querySelector('input')) {
    openChat(id);
  }
};
$('#searchChats').oninput = renderSidebar;

async function loadChats() {
  state.chats = await api('/api/conversations').catch(() => []);
  renderSidebar();
}

function toggleSidebar(open) {
  $('#app').classList.toggle('side-collapsed', !open);
}
$('#closeSidebar').onclick = () => toggleSidebar(false);
$('#openSidebar').onclick = () => toggleSidebar(true);
$('#scrim').onclick = () => toggleSidebar(false);
const isNarrow = () => matchMedia('(max-width: 860px)').matches;

// ------------------------------------------------------------ chats
function newChat() {
  stopGenerating();
  state.chat = { id: null, title: '', mode: state.mode, model: '', messages: [], project_id: state.project || null };
  animateSwap('up');
  setMode(state.mode);
  renderMessages();
  renderSidebar();
  syncCanvas();
  renderWorkspaceChip();
  if (isNarrow()) toggleSidebar(false);
  $('#input').focus();
}
$('#newChat').onclick = newChat;
$('#newChatTop').onclick = newChat;
$('#canvasBtn').onclick = () => (canvasOpen() ? closeCanvas() : openCanvas());

async function openChat(id) {
  stopGenerating();
  if (state.chat?.id !== id) rememberModeChat();
  try {
    const chat = await api(`/api/conversations/${id}`);
    state.chat = { ...chat, messages: chat.messages || [] };
    animateSwap('up');
    setMode(['code', 'study'].includes(chat.mode) ? chat.mode : 'assistant', { keepModel: true });
    rememberModeChat();
    renderMessages();
    renderSidebar();
    syncCanvas();
    renderWorkspaceChip();
    if (isNarrow()) toggleSidebar(false);
  } catch (e) { toast(e.message, 'error'); }
}

async function saveChat() {
  const c = state.chat;
  if (!c.id) c.id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  if (!c.title) {
    const first = c.messages.find((m) => m.role === 'user');
    c.title = (first?.display ?? first?.content ?? (c.canvas?.title || (c.canvas?.text || '').replace(/^[#\s]+/, '').split('\n')[0] || 'New chat')).replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
  }
  const payload = { ...c, messages: c.messages.map(({ streaming, ...m }) => m) };
  try {
    await api(`/api/conversations/${c.id}`, json('PUT', payload));
    await loadChats();
  } catch (e) { toast(`Couldn't save chat: ${e.message}`, 'error'); }
}

// --------------------------------------------------------- rendering
const messagesEl = $('#messages');

function nearBottom() { return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120; }
// Follow her reply as it's written, unless you've scrolled up to read; back at the bottom, it follows again.
let follow = true;
function scrollBottom(force = false) {
  if (force) follow = true;
  if (follow) messagesEl.scrollTop = messagesEl.scrollHeight;
}
const stopFollowing = () => { if (!nearBottom()) follow = false; };
messagesEl.addEventListener('wheel', (e) => { if (e.deltaY < 0) follow = false; else requestAnimationFrame(() => { if (nearBottom()) follow = true; }); }, { passive: true });
messagesEl.addEventListener('touchmove', () => requestAnimationFrame(stopFollowing), { passive: true });
messagesEl.addEventListener('scroll', () => { if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40) follow = true; }, { passive: true });

function renderWelcome() {
  const name = state.settings.user_name ? `, ${escapeHtml(state.settings.user_name)}` : '';
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  let body;
  if (!state.status.ollama && state.status.engine?.mode === 'builtin') {
    body = `<div class="setup-card"><h3>Getting Athena ready</h3><p>${engineBanner(state.status.engine)}</p></div>`;
  } else if (!state.status.ollama) {
    body = `<div class="setup-card"><h3>Almost there!</h3>
      <p>Athena needs <b>Ollama</b> running on this PC.</p>
      <ol><li>Install it from <code>ollama.com/download</code> (one time).</li><li>Open the Ollama app — it runs in your system tray.</li><li>This page connects automatically.</li></ol></div>`;
  } else if (!state.models.length) {
    body = `<div class="setup-card"><h3>Download your first model</h3>
      <p>Ollama is running but no AI models are installed yet. Open <b>Settings → Models</b> and download one — try <code>qwen3:8b</code> for chat and <code>qwen2.5-coder:7b</code> for code on an 8 GB graphics card.</p>
      <p><button class="primary" id="goModels">Open model downloads</button></p></div>`;
  } else {
    body = '';
  }
  const night = hour < 6 || hour >= 18;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const bday = isBirthday();
  const special = !bday && state.mode === 'assistant' ? specialDay(hour) : null;
  const heading = state.mode === 'code' ? `What are we building today${name}?` : state.mode === 'study' ? `What are we studying today${name}?` : bday ? `Happy birthday${name}! 🎂` : special?.heading ? `${special.heading}${name}${special.emoji ? ` ${special.emoji}` : ''}` : `${greet}${name}`;
  const sub = state.mode === 'code' ? '' : `<div class="greet-sub">${night ? ICONS.moon : ICONS.sun}${escapeHtml(date)}</div>`;
  let line = !body && state.mode === 'assistant' ? `<div class="greet-line">${escapeHtml(bday ? "Today's all about you. What should we do?" : special?.line || welcomeLine(hour))}</div>` : '';
  if (!body && state.mode === 'study') {
    line = `<div class="study-chips">${STUDY_STARTERS.map(([label, text]) => `<button type="button" data-starter="${escapeHtml(text)}">${label}</button>`).join('')}</div>
      <div class="study-hint">Tip: attach your notes, a PDF, slides or a photo of a worksheet with 📎 and she'll use it.</div>
      ${streakText() ? `<div class="streak${state.streak.today ? '' : ' cold'}">${escapeHtml(streakText())}</div>` : ''}`;
  }
  const proj = state.projects?.find((p) => p.id === state.chat?.project_id);
  const projTag = proj ? `<div class="proj-tag">${escapeHtml(proj.icon || '📁')} ${escapeHtml(proj.name)}</div>` : '';
  messagesEl.innerHTML = `<div class="welcome">${logoSvg()}<h1>${heading}</h1>${projTag}${sub}${line}${body}</div>`;
  if (bday) celebrateOnce();
  $('#goModels')?.addEventListener('click', () => openSettings('models'));
}

/** Turn microphone errors into what to actually do about them. */
function micHelp(e) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'Voice needs the microphone, which browsers only allow on secure pages. Open Athena at http://localhost:8765.'
      : 'On your phone, voice needs Athena\'s secure address (it starts with https://). Scan the QR code in Settings → Desktop app on your PC.';
  }
  if (e?.name === 'NotFoundError' || /not found/i.test(e?.message || '')) return 'No microphone found. Plug one in (or check Windows Settings → Sound → Input), then try again.';
  if (e?.name === 'NotAllowedError' || /denied|allowed/i.test(e?.message || '')) {
    return 'Microphone access is blocked. Click the 🔒 icon at the left of the address bar, allow the Microphone, then try again.';
  }
  if (e?.name === 'NotReadableError') return 'Another app is using the microphone (like Discord or a game). Close it or switch its input, then try again.';
  return `Microphone problem: ${e?.message || e}`;
}

// ------------------------------------------------------------ orb mood
// A rough read of how her reply feels, so the orb glows warmer, livelier or calmer while she says it.
function detectMood(text) {
  const t = (text || '').toLowerCase();
  const score = (re) => (t.match(re) || []).length;
  const excited = score(/!{1,}|🎉|🥳|🔥|amazing|awesome|incredible|let'?s go|congrat|woo+|yay/g);
  const happy = score(/😊|😄|😁|🙂|😉|💛|❤|haha|glad|love|great|nice|fun|happy|sweet|cute/g);
  const calm = score(/sorry|sad|tough|hard time|breathe|rest|sleep|relax|gently|understand|it'?s okay|take care|careful|unfortunately/g);
  if (excited >= 3 && excited >= happy) return 'excited';
  if (calm >= 2 && calm > happy) return 'calm';
  if (happy + excited >= 2) return 'happy';
  return 'neutral';
}

// ------------------------------------------------------------ cheat sheet
const CHEAT_CHIP = '📄 Cheat sheet';
function makeCheatSheet(topic = '') {
  if (state.abort) return;
  const has = state.chat.messages.some((m) => m.role === 'assistant');
  openCanvas({ title: state.chat.canvas?.title || (topic ? `Cheat sheet: ${topic}` : 'Cheat sheet') });
  const what = topic || (has ? 'everything we covered in this chat' : '');
  if (!what) { toast('Tell me the topic, e.g. /cheatsheet derivatives'); return; }
  sendMessage(`Make a one-page cheat sheet of ${what} in the canvas. Put the most important formulas first (in LaTeX), then key definitions, ` +
    'step-by-step methods, a tiny worked example for each method, and common mistakes to avoid. Keep it compact and well organized ' +
    'with short headings and bullet points, so it fits on one printed page.', { display: `📄 Make a cheat sheet${topic ? `: ${topic}` : ''}` });
}

// ------------------------------------------------------------ welcome lines + birthday
const STUDY_STARTERS = [
  ['📘 Study guide', 'Make me a study guide on '],
  ['🃏 Flashcards', 'Make 15 flashcards on '],
  ['📝 Practice quiz', 'Quiz me with 10 multiple-choice questions on '],
  ['✏️ Homework help', 'Help me with this homework problem step by step: '],
  ['💡 Explain simply', 'Explain this simply, with an example: '],
  ['📅 Study plan', 'Make me a study plan. My test is on __ and it covers: '],
  ['🎯 Summarize my notes', 'Summarize these notes into the key points I need to know: '],
];
const WELCOME_LINES = {
  any: ['Ready when you are.', "What's on your mind?", 'Ask me anything.', "Let's get something done.", "I'm all ears.", 'How can I help today?', 'What are we working on?'],
  morning: ['Coffee first, then world domination?', "Let's make today a good one.", 'Fresh start. What first?'],
  evening: ["What's on your mind tonight?", 'Winding down or just getting started?', 'How did today go?'],
  late: ['Burning the midnight oil?', "Can't sleep? I'm here.", 'Late-night ideas are the best ones.'],
  companion: ['Missed you, baby.', 'There you are, handsome.', 'I was hoping you’d stop by.', 'Come talk to me.', 'Took you long enough 😘'],
};
// Holidays, days of the week and your habits give the welcome screen a personal touch.
const HOLIDAYS = {
  '01-01': ['Happy New Year', '🎉', 'New year, new goals. What are we starting with?'],
  '02-14': ["Happy Valentine's Day", '💝', 'Need help with a card, a gift idea or dinner plans?'],
  '03-17': ["Happy St. Patrick's Day", '🍀', 'Feeling lucky? What are we doing today?'],
  '07-04': ['Happy Fourth of July', '🎆', 'Fireworks later. What can I help with first?'],
  '10-31': ['Happy Halloween', '🎃', 'Costume ideas? Scary stories? I\'ve got you.'],
  '12-24': ['Merry Christmas Eve', '🎄', 'Last-minute gift ideas or a cozy movie list?'],
  '12-25': ['Merry Christmas', '🎁', 'Hope your day is a great one. What\'s up?'],
  '12-31': ["Happy New Year's Eve", '🥂', 'Any resolutions you want help planning?'],
};
let specialCache = null;
function specialDay(hour) {
  const now = new Date();
  const key = `${now.toDateString()} ${hour}`;
  if (specialCache?.key === key) return specialCache.value; // the welcome screen redraws often; decide once
  specialCache = { key, value: computeSpecialDay(now, hour) };
  return specialCache.value;
}
function computeSpecialDay(now, hour) {
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let visits = {};
  try { visits = JSON.parse(localStorage.getItem('athena-visits') || '{}'); } catch { /* ignore */ }
  const today = now.toDateString();
  const daysAway = visits.last ? Math.round((new Date(today) - new Date(visits.last)) / 864e5) : 0;
  const lateAgain = hour < 5 && visits.lateDay && visits.lateDay !== today && (new Date(today) - new Date(visits.lateDay)) <= 864e5 * 1.5;
  if (visits.last !== today) {
    try { localStorage.setItem('athena-visits', JSON.stringify({ last: today, lateDay: hour < 5 ? today : visits.lateDay })); } catch { /* ignore */ }
  }
  const h = HOLIDAYS[mmdd];
  if (h) return { heading: h[0], emoji: h[1], line: h[2] };
  if (daysAway >= 3) return { heading: 'Welcome back', emoji: '👋', line: `It's been ${daysAway} days. What have you been up to?` };
  if (lateAgain) return { line: 'Late night again? 🌙 Don\'t forget to sleep.' };
  const day = now.getDay();
  if (day === 5 && hour >= 12) return { heading: 'Happy Friday', emoji: '🎉', line: 'Weekend plans, or finishing up the week?' };
  if (day === 1 && hour < 12) return { line: 'Monday again. Let\'s make it an easy one. ☕' };
  if ((day === 0 || day === 6) && hour >= 8 && hour < 18) return { line: 'Weekend mode. Anything fun planned?' };
  return null;
}

function welcomeLine(hour) {
  const pool = [...WELCOME_LINES.any];
  if (hour >= 5 && hour < 11) pool.push(...WELCOME_LINES.morning);
  if (hour >= 18) pool.push(...WELCOME_LINES.evening);
  if (hour < 5) pool.push(...WELCOME_LINES.late);
  if (state.settings.persona === 'companion') pool.push(...WELCOME_LINES.companion, ...WELCOME_LINES.companion);
  return pool[Math.floor(Math.random() * pool.length)];
}

function isBirthday() {
  const today = new Date();
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return state.settings.birthday === mmdd;
}

function celebrateOnce() {
  const key = `athena-bday-${new Date().getFullYear()}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* ignore */ }
  confetti();
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth; c.height = innerHeight;
  document.body.append(c);
  const ctx = c.getContext('2d');
  const pal = [getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f5c542', '#ffffff', '#ffd970', '#f9a8d4', '#93c5fd'];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, r: 3 + Math.random() * 4,
    rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, color: pal[Math.floor(Math.random() * pal.length)],
  }));
  const t0 = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.vy += 0.35; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.color; ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r);
      ctx.restore();
    }
    if (now - t0 < 3500) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

messagesEl.addEventListener('keydown', (e) => {
  const card = e.target.closest?.('.fc-card');
  if (!card) return;
  const w = card.closest('.study-widget');
  const act = { ' ': 'flip', Enter: 'flip', ArrowRight: 'next', ArrowLeft: 'prev', k: 'known' }[e.key];
  if (act) { e.preventDefault(); flashcardAction(w, act); }
});

messagesEl.addEventListener('click', async (e) => {
  const starter = e.target.closest('[data-starter]');
  if (starter) { input.value = starter.dataset.starter; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); return; }
  const fc = e.target.closest('[data-fc]');
  if (fc?.dataset.fc === 'save') { saveDeck(fc.closest('.study-widget')); return; }
  if (fc) { flashcardAction(fc.closest('.study-widget'), fc.dataset.fc); return; }
  const card = e.target.closest('.fc-card');
  if (card) { flashcardAction(card.closest('.study-widget'), 'flip'); return; }
  const choice = e.target.closest('[data-choice]');
  if (choice) { quizAnswer(choice.closest('.study-widget'), Number(choice.closest('.qz-q').dataset.q), Number(choice.dataset.choice)); return; }
  const why = e.target.closest('[data-quiz-why]');
  if (why) {
    if (state.abort) return toast('Wait for her to finish first');
    const prompt = mistakePrompt(why.closest('.study-widget'), Number(why.dataset.quizWhy));
    why.disabled = true;
    if (prompt) sendMessage(prompt, { display: '🤔 Explain my mistake' });
    return;
  }
  if (e.target.closest('[data-quiz="retry"]')) { quizRetry(e.target.closest('.study-widget')); return; }

  const follow = e.target.closest('[data-followup]');
  if (follow) {
    if (state.abort) return;
    if (follow.dataset.followup === CHEAT_CHIP) makeCheatSheet(); else sendMessage(follow.dataset.followup);
    return;
  }

  const saveBtn = e.target.closest('[data-save-code]');
  if (saveBtn) { saveCodeBlock(saveBtn); return; }

  const previewBtn = e.target.closest('[data-preview]');
  if (previewBtn) { togglePreview(previewBtn); return; }

  const canvasCard = e.target.closest('[data-canvas-open]');
  if (canvasCard) { openCanvas({ text: canvasCard.closest('.canvas-card').dataset.src }); return; }

  const runBtn = e.target.closest('[data-run]');
  if (runBtn) { runCodeBlock(runBtn); return; }

  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const code = copy.closest('.code-block').querySelector('code').innerText;
    await copyText(code);
    copy.innerHTML = `${ICONS.check}Copied`;
    setTimeout(() => (copy.innerHTML = `${ICONS.copy}Copy code`), 1500);
    return;
  }

  const act = e.target.closest('[data-msg-act]');
  if (!act) return;
  const idx = Number(act.closest('.msg').dataset.idx);
  const msg = state.chat.messages[idx];
  switch (act.dataset.msgAct) {
    case 'copy':
      await copyText(msg.content);
      act.innerHTML = ICONS.check;
      setTimeout(() => (act.innerHTML = ICONS.copy), 1500);
      break;
    case 'branch': {
      if (state.abort) return;
      const src = state.chat;
      if (!src.id) await saveChat();
      state.chat = {
        id: null, title: `↳ ${src.title || 'Chat'}`.slice(0, 60), icon: src.icon, mode: src.mode, model: src.model, project_id: src.project_id || null,
        workspace: src.workspace, branchedFrom: src.id, autoTitle: false,
        messages: structuredClone(src.messages.slice(0, idx + 1)).map(({ savedId, ...m }) => m),
      };
      await saveChat();
      await loadChats();
      renderMessages();
      syncCanvas();
      renderWorkspaceChip();
      toast('↳ Branched into a new chat. The original is unchanged.');
      $('#input').focus();
      break;
    }
    case 'canvas': {
      const block = /```canvas[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(msg.content);
      const text = block ? block[1] : splitThinking(msg).content.replace(/\n*```(graph|plot|flashcards|quiz)[\s\S]*?```/g, '').trim();
      openCanvas({ text, title: state.chat.canvas?.title || (/^#\s+(.+)/m.exec(text)?.[1] ?? state.chat.title ?? '').slice(0, 80) });
      break;
    }
    case 'speak':
      // A second click while she's reading stops her; otherwise always start fresh (even if an earlier read got stuck).
      if (speaker.audible()) { speaker.stop(); break; }
      speaker.stop();
      speaker.unlock(); // start the audio right on the click, so the browser doesn't block it
      speaker.reset();
      speaker.say(splitThinking(msg).content || msg.content);
      break;
    case 'up':
    case 'down':
      rateReply(msg, idx, act.dataset.msgAct);
      break;
    case 'deeper':
    case 'retry': {
      if (state.abort) return;
      const versions = msg.versions ? [...msg.versions] : [snapshot(msg)];
      state.chat.messages.splice(idx);
      renderMessages();
      const fresh = await generateReply({ model: msg.route ? msg.model : null, route: msg.route || null, think: act.dataset.msgAct === 'deeper' ? 'deep' : null, research: !!msg.research });
      if (fresh && !fresh.error) {
        fresh.versions = [...versions, snapshot(fresh)];
        fresh.v = fresh.versions.length - 1;
        rerenderMessage(state.chat.messages.length - 1);
        await saveChat();
      }
      break;
    }
    case 'vprev':
    case 'vnext': {
      if (!msg.versions || state.abort) return;
      const v = Math.max(0, Math.min(msg.versions.length - 1, (msg.v ?? msg.versions.length - 1) + (act.dataset.msgAct === 'vnext' ? 1 : -1)));
      delete msg.savedId;
      Object.assign(msg, msg.versions[v], { v });
      if (!msg.savedId) delete msg.savedId;
      rerenderMessage(idx);
      await saveChat();
      break;
    }
    case 'star':
      await toggleSaved(msg, act);
      break;
    case 'edit': {
      // Edit in place. Nothing changes until you press Send; Cancel or Esc puts everything back.
      if (state.abort) return;
      const bubble = act.closest('.msg').querySelector('.bubble');
      if (!bubble || bubble.querySelector('textarea')) return;
      const original = msg.display ?? msg.content;
      const before = bubble.innerHTML;
      bubble.classList.add('editing');
      bubble.innerHTML = `<textarea class="edit-box"></textarea><div class="edit-actions"><button type="button" class="ghost" data-edit="cancel">Cancel</button><button type="button" class="primary" data-edit="send">Send</button></div>`;
      const box = bubble.querySelector('textarea');
      box.value = original;
      const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 360)}px`; };
      fit();
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
      const cancel = () => { bubble.classList.remove('editing'); bubble.innerHTML = before; };
      const submit = async () => {
        const text = box.value.trim();
        if (!text || state.abort) return;
        if (text === original.trim()) { cancel(); return; }
        const { images, files } = msg;
        state.chat.messages.splice(idx);
        if (images?.length || files?.length) { // keep what was attached to the original message
          const edited = { role: 'user', content: text, display: text, time: Date.now(), images, files };
          if (files?.length) edited.content = msg.content.replace(original, text);
          state.chat.messages.push(edited);
          renderMessages();
          await generateReply();
        } else sendMessage(text);
      };
      box.oninput = fit;
      box.onkeydown = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); }
      };
      bubble.querySelector('.edit-actions').onclick = (ev) => {
        const which = ev.target.closest('[data-edit]')?.dataset.edit;
        if (which === 'cancel') cancel();
        if (which === 'send') submit();
      };
      break;
    }
  }
});

function snapshot(m) {
  const { content, thinking, tools, model, stats, time, savedId, think, research } = m;
  return { content, thinking, tools, model, stats, time, savedId, think, research };
}

function rerenderMessage(idx) {
  const old = $(`.msg[data-idx="${idx}"]`, messagesEl);
  if (!old) { renderMessages(); return; }
  const el = messageEl(state.chat.messages[idx], idx);
  el.style.animation = 'none';
  old.replaceWith(el);
  markLast();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}

function renderMessages() {
  requestAnimationFrame(() => updateJumpBtn?.());
  if (!state.chat.messages.length) { renderWelcome(); return; }
  const thread = document.createElement('div');
  thread.className = 'thread';
  state.chat.messages.forEach((m, i) => thread.append(messageEl(m, i)));
  messagesEl.innerHTML = '';
  messagesEl.append(thread);
  markLast();
  scrollBottom(true);
}

function markLast() {
  $$('.followups', messagesEl).forEach((f) => f !== $$('.followups', messagesEl).at(-1) && f.remove());
  $$('.msg', messagesEl).forEach((el, i, all) => el.classList.toggle('last', i === all.length - 1));
}

function messageEl(m, idx) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.dataset.idx = idx;
  if (m.role === 'user') {
    const files = (m.files || []).map((f) => `<span class="file-chip">${ICONS.file}<span>${escapeHtml(f)}</span></span>`).join('');
    const imgs = (m.images || []).map((b64) => `<span class="pic-wrap"><img class="thumb" src="data:image/*;base64,${b64}" alt=""><button type="button" class="pic-edit" data-pic-edit title="Edit this photo">✏️ Edit</button></span>`).join('');
    el.innerHTML = `<div class="col">${files || imgs ? `<div class="files">${imgs}${files}</div>` : ''}
      <div class="bubble">${escapeHtml(m.display ?? m.content)}</div>
      <div class="msg-actions">${m.time ? `<span class="time">${fmtTime(m.time)}</span>` : ''}<button data-msg-act="edit" title="Edit">${ICONS.edit}</button><button data-msg-act="copy" title="Copy">${ICONS.copy}</button></div></div>`;
  } else {
    el.innerHTML = `${logoSvg('avatar')}<div class="body"><div class="content"></div><div class="msg-actions"></div></div>`;
    updateAssistantEl(el, m);
  }
  return el;
}

function splitThinking(m) {
  // Some models put their reasoning inline instead of in the thinking field. Keep it out of the answer (and out of
  // what's read aloud): <think>…</think>, a stray </think> with the reasoning before it, or gpt-oss's
  // "analysis … assistantfinal" format leaking through.
  let content = m.content || '';
  let thinking = m.thinking || '';
  let open = false;
  const match = content.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (match) {
    thinking += match[1];
    content = match[2] ? content.slice(match.index + match[0].length) : '';
    open = !match[2];
  } else if (content.includes('</think>')) {
    const cut = content.lastIndexOf('</think>');
    thinking += content.slice(0, cut);
    content = content.slice(cut + 8);
  } else if (/^\s*(<\|channel\|>\s*)?analysis\b/i.test(content)) {
    const fin = content.search(/(<\|channel\|>\s*final\s*<\|message\|>|assistant\s*final)/i);
    if (fin >= 0) {
      thinking += content.slice(0, fin).replace(/^\s*(<\|channel\|>\s*)?analysis\s*(<\|message\|>)?/i, '');
      content = content.slice(fin).replace(/^(<\|channel\|>\s*final\s*<\|message\|>|assistant\s*final)/i, '');
    } else {
      thinking += content.replace(/^\s*(<\|channel\|>\s*)?analysis\s*(<\|message\|>)?/i, '');
      content = '';
      open = true;
    }
  }
  // Plain-text reasoning at the start of the answer ("The user asked … so I need to figure out which function to
  // call"): treat those opening paragraphs as thinking, and don't read them aloud.
  if (!open && LEAKED_REASONING.test(content)) {
    const paras = content.split(/\n\s*\n/);
    let i = 0;
    while (i < paras.length && (LEAKED_REASONING.test(paras[i]) || /\b(function|tool)s? to (call|use)\b/i.test(paras[i]))) i++;
    if (i < paras.length) {
      thinking += paras.slice(0, i).join('\n\n');
      content = paras.slice(i).join('\n\n');
    } else if (m.streaming) {
      thinking += content; // still reasoning: wait for the real answer
      content = '';
      open = true;
    }
  }
  content = content.replace(/^\s+/, '');
  return { content, thinking, stillThinking: !!(m.streaming && (open || (!match && m.thinking && !content))) };
}
const LEAKED_REASONING = /^\s*(?:(?:okay|ok|alright|so|hmm|well),?\s+)*(?:(?:the\s+)?user\s+(?:just\s+)?(?:asked|asks|said|says|wants|wanted|is asking|is saying|wrote|mentioned|greeted|typed|requested)|(?:i|we)\s+(?:need|should|have)\s+to\s+(?:figure|check|decide|call|use|respond|answer|see|determine|think)|let\s+me\s+(?:think|check|figure|see|recall)|first,?\s+i\s+(?:need|should|will))\b/i;

function updateAssistantEl(el, m) {
  const { content, thinking, stillThinking } = splitThinking(m);
  const openSteps = new Set($$('.step[open]', el).map((d) => d.dataset.id));
  const steps = (m.tools || []).map((t, i) => stepHtml(t, i, openSteps)).join('');
  let html = steps ? `<div class="activity">${steps}</div>` : '';
  if (m.research) html += researchHtml(m, el);
  const pics = (m.tools || []).filter((t) => t.result?.image).map((t) => `<span class="pic-wrap"><a href="${escapeHtml(t.result.image)}" target="_blank"><img src="${escapeHtml(t.result.image)}" alt="${escapeHtml(t.result.prompt || 'Generated image')}"></a><button type="button" class="pic-edit" data-pic-edit title="Edit this picture">✏️ Edit</button></span>`);
  if (pics.length) html += `<div class="gen-images">${pics.join('')}</div>`;
  if (thinking.trim()) {
    const open = el.querySelector('.thinking-box')?.open ?? false;
    const label = stillThinking ? 'Thinking…' : `Thought${m.thinkSecs ? ` for ${m.thinkSecs}s` : ''}`;
    html += `<details class="thinking-box"${open ? ' open' : ''}><summary>${label}</summary><div class="think-text">${escapeHtml(thinking.trim())}</div></details>`;
  }
  if (content) html += `<div class="md">${renderMarkdown(content)}</div>`;
  if (m.error) html += `<p class="error-text">⚠ ${escapeHtml(m.error)}</p>`;
  if (m.streaming && !content && !m.error && !stillThinking && !(m.tools || []).length && m.warming) {
    html += `<span class="warming"><span class="spin"></span>Waking up ${escapeHtml(shownModel(m.model) || 'the model')}… the first reply takes a moment</span>`;
  } else if (m.streaming && !content && !m.error && !stillThinking) html += '<span class="typing"><i></i><i></i><i></i></span>';
  if (m.streaming && stillThinking && !thinking.trim()) html += '<span class="typing"><i></i><i></i><i></i></span>';
  el.querySelector('.content').innerHTML = html;
  if (html.includes('study-widget')) hydrateStudy(el, !!m.streaming);
  if (html.includes('graph-widget')) hydrateGraphs(el, !!m.streaming);

  el.classList.toggle('streaming', !!m.streaming);
  const actions = el.querySelector('.msg-actions');
  el.querySelector('.followups')?.remove();
  if (m.streaming) { actions.innerHTML = ''; return; }
  const tps = m.stats?.eval_count && m.stats?.eval_duration ? `${(m.stats.eval_count / (m.stats.eval_duration / 1e9)).toFixed(1)} tok/s` : '';
  const vers = m.versions?.length > 1
    ? `<span class="versions"><button data-msg-act="vprev" title="Previous version" ${(m.v ?? 0) === 0 ? 'disabled' : ''}>‹</button>${(m.v ?? m.versions.length - 1) + 1}/${m.versions.length}<button data-msg-act="vnext" title="Next version" ${(m.v ?? m.versions.length - 1) === m.versions.length - 1 ? 'disabled' : ''}>›</button></span>`
    : '';
  actions.innerHTML = `${vers}<button data-msg-act="copy" title="Copy">${ICONS.copy}</button>
    <button data-msg-act="star" title="${m.savedId ? 'Saved — click to remove' : 'Save this reply'}" class="${m.savedId ? 'starred' : ''}">${ICONS.star}</button>
    <button data-msg-act="speak" title="Read aloud">${ICONS.speak}</button>
    <button data-msg-act="canvas" title="Edit in canvas">${ICONS.canvas}</button>
    <button data-msg-act="branch" title="Branch: start a new chat from here">${ICONS.branch}</button>
    <button data-msg-act="retry" title="Regenerate">${ICONS.retry}</button>
    <button data-msg-act="deeper" title="Think harder: redo this answer, thinking longer and double-checking">${ICONS.brain}</button>
    <button data-msg-act="up" title="Good answer" class="${m.rating === 'up' ? 'rated' : ''}">${ICONS.up}</button>
    <button data-msg-act="down" title="Bad answer — tell Athena what to do better" class="${m.rating === 'down' ? 'rated' : ''}">${ICONS.down}</button>
    <span class="stats">${m.think === 'deep' ? '<span class="think-tag" title="Thought harder about this one">🧠 Deep</span>' : ''}${m.route ? `<span class="route-tag" title="Auto picked ${escapeHtml(shownModel(m.model))} for this">${ROUTE_LABEL[m.route] || ''}</span>` : ''}${escapeHtml([m.time && fmtTime(m.time), shownModel(m.model), tps].filter(Boolean).join(' · '))}</span>`;
  const idx = Number(el.dataset.idx);
  const isLast = state.chat && idx === state.chat.messages.length - 1;
  if (isLast && content && !m.error && !m.voice) {
    const chips = /```canvas/.test(content) ? ['Make it more formal', 'Make it shorter', 'Proofread it']
      : /```(graph|plot)/.test(content) ? ['Explain the graph', 'Where do they cross?', 'Show another example']
      : /```(flashcards|quiz)/.test(content) ? ['Make it harder', 'More questions', 'Explain the ones I missed', CHEAT_CHIP]
      : state.mode === 'study' ? ['Make flashcards from this', 'Quiz me on this', 'Explain it simpler', CHEAT_CHIP]
      : /```(?!graph|plot|flashcards|quiz|canvas)/.test(content) ? ['Explain the code', 'Add comments', 'Make it simpler'] : ['Tell me more', 'Make it shorter', 'Give me an example'];
    el.querySelector('.body').insertAdjacentHTML('beforeend', `<div class="followups">${chips.map((c) => `<button type="button" data-followup="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>`);
  }
}

function fmtTime(ms) {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(undefined, today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- live activity steps (what Athena is doing, as it happens)
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || 'page'; } };
const q = (x) => `“${x ?? ''}”`;
const STEP_TEXT = {
  get_current_datetime: [() => 'Checking the time', () => 'Checked the time'],
  set_timer: [() => 'Setting a timer', (a, r) => `Timer set: ${fmtDuration(r.seconds)}${r.label && r.label !== 'Timer' ? ` · ${r.label}` : ''}`],
  add_task: [(a) => `Adding task ${q(a.title)}`, (a, r) => `Added task: ${r.added?.title}`],
  list_tasks: [() => 'Checking your tasks', (a, r) => `Checked your tasks (${r.count ?? 0})`],
  complete_task: [(a) => `Completing ${q(a.task)}`, (a, r) => `Completed: ${r.completed?.title}`],
  delete_task: [(a) => `Removing ${q(a.task)}`, (a, r) => `Removed task: ${r.deleted?.title}`],
  new_project: [(a) => `Starting a new project: ${a.name}`, (a, r) => r.created ? `Created 📁 ${r.workspace?.name || a.name}` : 'Project folder'],
  screenshot_page: [(a) => `Taking a ${a.phone ? 'phone' : 'computer'} screenshot${a.page ? ` of ${a.page}` : ''}`, (a, r) => `📸 ${r.view === 'phone' ? 'Phone' : 'Computer'} screenshot of ${r.page || 'the page'}`],
  upload_to_github: [() => 'Uploading to GitHub', (a, r) => r.uploaded ? `Uploaded to ${r.url}` : r.saved_locally !== undefined ? 'Saved with Git (not uploaded yet)' : 'GitHub'],
  project_tree: [() => 'Looking at the project files', (a, r) => r.files != null ? `Saw ${r.files} files` : 'Looked at the project'],
  read_code: [(a) => `Reading ${a.path}`, (a, r) => `Read ${r.path || a.path}${r.lines ? ` (lines ${r.lines})` : ''}`],
  search_code: [(a) => `Searching the code for ${q(a.query)}`, (a, r) => `Found ${r.matches?.length || 0} match${r.matches?.length === 1 ? '' : 'es'} for ${q(a.query)}`],
  edit_code: [(a) => `Editing ${a.path}`, (a, r) => `Edited ${r.edited || a.path} (+${r.added_lines ?? 0} −${r.removed_lines ?? 0})`],
  write_code: [(a) => `Writing ${a.path}`, (a, r) => r.created ? `Created ${r.created}` : `Rewrote ${r.edited || a.path} (+${r.added_lines ?? 0} −${r.removed_lines ?? 0})`],
  undo_code_edit: [() => 'Undoing the last edit', (a, r) => r.restored ? `Restored ${r.restored}` : r.removed_new_file ? `Removed ${r.removed_new_file}` : 'Nothing to undo'],
  run_in_project: [(a) => `Running ${a.command}`, (a, r) => r.timed_out ? `Stopped after ${r.seconds}s` : r.exit_code === 0 ? `Ran ${a.command}` : `${a.command} failed (exit ${r.exit_code})`],
  pc_status: [() => 'Checking your PC', (a, r) => r.cpu ? `CPU ${r.cpu.usage_percent}% · memory ${r.memory.used_percent}%${r.gpu?.usage_percent != null ? ` · graphics ${r.gpu.usage_percent}%` : ''}` : 'Checked your PC'],
  window_control: [(a) => `${a.action === 'list' ? 'Looking at open windows' : `${a.action} ${a.app || ''}`.trim()}`, (a, r) => r.closed ? `Closed ${r.closed.length} window${r.closed.length === 1 ? '' : 's'}` : r.minimized_all ? 'Minimized everything' : r.windows ? `${r.windows.length} windows open` : `${a.action}: ${r.app || a.app || ''}`],
  type_text: [(a) => `Typing${a.app ? ` in ${a.app}` : ''}`, (a, r) => `Typed ${r.typed_characters ?? ''} characters${a.app ? ` in ${a.app}` : ''}`],
  press_keys: [(a) => `Pressing ${a.keys}`, (a) => `Pressed ${a.keys}`],
  click_on_screen: [(a) => `Finding ${q(a.target)} on screen`, (a) => `Clicked ${q(a.target)}`],
  send_message: [(a) => `Messaging ${a.to} on ${a.app || 'Discord'}`, (a, r) => r.draft_opened ? `Draft ready for ${r.to}. Press Send` : `Sent to ${r.to} on ${r.app === 'sms' ? 'text' : r.app}`],
  open_website: [(a) => `Opening ${a.site}${a.search ? `: ${a.search}` : ''}`, (a, r) => `Opened ${host(r.opened || a.site)}${a.search ? ` · ${a.search}` : ''}`],
  find_installed: [(a) => `Looking for where ${a.name} is installed`, (a, r) => (r.best ? `Found ${r.best.name}${r.opened ? ' and opened its folder' : ''}` : `Couldn't find ${a.name} installed`)],
  list_contacts: [() => 'Checking your contacts', (a, r) => `${r.contacts?.length || 0} contacts`],
  add_contact: [(a) => `Saving ${a.name}`, (a, r) => `Saved ${r.saved?.name || a.name}`],
  list_routines: [() => 'Checking your routines', (a, r) => `${r.routines?.length || 0} routines`],
  run_routine: [(a) => `Running ${a.name}`, (a, r) => `Ran ${r.routine || a.name}`],
  create_routine: [(a) => `Creating the ${a.name} routine`, (a, r) => `Saved routine: ${r.saved_routine || a.name}`],
  delete_routine: [(a) => `Deleting ${a.name}`, (a) => `Deleted ${a.name}`],
  search_chats: [(a) => `Looking through past chats for ${q(a.query)}`, (a, r) => `Found ${r.results?.length || 0} past chat${r.results?.length === 1 ? '' : 's'}`],
  remember: [() => 'Saving to memory', (a, r) => `Remembered: ${r.remembered}`],
  forget: [() => 'Forgetting', (a, r) => `Forgot: ${r.forgot}`],
  list_folder: [(a) => `Looking in ${a.path || 'your folders'}`, (a, r) => r.folder ? `Looked in ${r.folder} (${r.count} items)` : 'Checked which folders I can use'],
  find_files: [(a) => `Searching your files${a.query ? ` for ${q(a.query)}` : ''}${a.kind ? ` (${a.kind})` : ''}`, (a, r) => `Found ${r.count} file${r.count === 1 ? '' : 's'}`],
  read_file: [(a) => `Reading ${a.path}`, (a, r) => `Read ${r.path}`],
  create_folder: [(a) => `Creating folder ${a.path}`, (a, r) => `Created folder ${r.created}`],
  move_file: [(a) => `Moving ${a.source}`, (a, r) => `Moved ${r.moved} → ${r.to}`],
  copy_file: [(a) => `Copying ${a.source}`, (a, r) => `Copied to ${r.to}`],
  write_file: [(a) => `Writing ${a.path}`, (a, r) => `Saved ${r.written}`],
  delete_file: [(a) => `Deleting ${a.path}`, (a, r) => `Deleted ${r.deleted} (in Recycle Bin)`],
  organize_folder: [(a) => `Organizing ${a.folder}`, (a, r) => `Organized ${r.moved_files} files in ${r.organized}`],
  undo_last_change: [() => 'Undoing last change', (a, r) => r.undid ? `Undid: ${r.undid}` : r.message],
  open_on_screen: [(a) => `Opening ${a.target}`, (a, r) => `Opened ${r.opened}`],
  web_search: [(a) => `Searching the web for ${q(a.query)}`, (a, r) => `Searched the web for ${q(a.query)}`],
  read_webpage: [(a) => `Reading ${host(a.url)}`, (a, r) => `Read ${r.title || host(r.url)}`],
  get_weather: [(a) => `Checking the weather${a.location ? ` in ${a.location}` : ''}`, (a, r) => `Weather in ${r.location}: ${r.now?.temperature}, ${r.now?.summary}`],
  set_reminder: [(a) => `Setting a reminder: ${a.text}`, (a, r) => `Reminder set for ${r.reminder_set?.when}: ${r.reminder_set?.text}`],
  list_reminders: [() => 'Checking your reminders', (a, r) => `Checked your reminders (${r.count})`],
  cancel_reminder: [(a) => `Cancelling ${q(a.reminder)}`, (a, r) => `Cancelled: ${r.cancelled?.text}`],
  open_app: [(a) => `Opening ${a.name}`, (a, r) => `Opened ${r.opened}`],
  media_control: [(a) => `Media: ${a.action}`, (a, r) => `Media: ${String(r.media).replace('_', '/')}`],
  set_volume: [() => 'Changing the volume', (a, r) => r.volume != null ? `Volume set to ${r.volume}%` : r.volume_changed ? `Volume ${r.volume_changed}` : 'Toggled mute'],
  lock_computer: [() => 'Locking the PC', () => 'Locked the PC'],
  power: [(a) => `${String(a.action).replace(/^./, (c) => c.toUpperCase())} the PC`, (a, r) => r.cancelled ? 'Cancelled the scheduled shutdown' : r.sleeping ? 'Put the PC to sleep' : `${r.scheduled} in ${r.in_minutes} min`],
  get_clipboard: [() => 'Reading your clipboard', (a, r) => r.empty ? 'Your clipboard is empty' : `Read your clipboard (${r.clipboard.length} characters)`],
  set_clipboard: [() => 'Copying to your clipboard', (a, r) => `Copied ${r.copied_characters} characters — ready to paste`],
  look_at_screen: [() => 'Looking at your screen', (a, r) => `Looked at your screen (${r.seen_by})`],
  run_python: [() => 'Running Python code', (a, r) => r.opened_window ? 'Opened it in a window on your PC' : r.timed_out ? `Code stopped after ${r.seconds}s` : r.exit_code === 0 ? 'Ran the code' : 'The code hit an error'],
  search_documents: [(a) => `Searching your documents for ${q(a.query)}`, (a, r) => `Found ${r.results?.length || 0} passages in your documents`],
  generate_image: [() => 'Creating an image', () => 'Created an image'],
  work_on_myself: [() => 'Opening my own code', () => 'Opened my own code'],
  sports_games: [(a) => `Checking ${a.team || a.league || 'the'} games`, (a, r) => `Found ${r.games?.length || 0} ${r.league || ''} game${r.games?.length === 1 ? '' : 's'}`],
  sports_team: [(a) => `Looking up the ${a.team}`, (a, r) => `Looked up the ${r.team}${r.results?.record ? ` (${r.results.record})` : ''}`],
  sports_player: [(a) => a.line != null ? `Checking ${a.player} ${a.pick || 'over/under'} ${a.line} ${a.stat || ''}` : `Looking up ${a.player}`,
    (a, r) => r.line != null && r.last_10 ? `${r.player}: over ${r.line} ${r.stat} in ${r.last_10.over} of the last ${r.last_10.games}` : `Looked up ${r.player}`],
  sports_standings: [(a) => `Getting the ${a.league} standings`, (a, r) => `Got the ${r.league} standings`],
  check_athena: [() => 'Checking my code still works', (a, r) => r.ok ? 'Checked: my code loads fine' : 'Found problems in my code'],
  restart_athena: [() => 'Restarting myself', (a, r) => r.restarting ? 'Restarting with my changes' : 'Not restarting: my code has problems'],
  undo_self_changes: [() => 'Undoing my changes to myself', (a, r) => r.undone ? `Undid my changes (${(r.files || []).length} file${(r.files || []).length === 1 ? '' : 's'})` : (r.note || 'Nothing to undo')],
  save_self_changes: [() => 'Saving my changes to GitHub', (a, r) => r.saved ? `Saved my changes to GitHub (${r.branch})` : (r.note || 'Nothing to save')],
  upload_folder_to_github: [(a) => `Uploading ${a.folder} to GitHub`, (a, r) => r.uploaded ? `Uploaded to ${r.url}` : r.next_step || 'Saved locally'],
  edit_image: [() => 'Editing the photo', (a, r) => `Edited the photo${r.edits?.length ? `: ${r.edits.join(', ')}` : ''}`],
  watch_youtube: [(a) => `Finding ${a.query} on YouTube`, (a, r) => r.title ? `Playing ${r.title}` : r.channel ? `Opened ${r.channel}'s channel` : 'Opened YouTube'],
  discord_search: [(a) => `Searching Discord for “${a.query}”`, (a) => `Searched Discord for “${a.query}”${a.where ? ` in ${a.where}` : ''}`],
  list_home_devices: [() => 'Checking your smart home', (a, r) => `Found ${r.count} devices`],
  control_home_device: [(a) => `${a.action} ${a.device}`, (a, r) => `${r.device}: ${r.action}${r.value != null ? ` ${r.value}` : ''} ✓`],
};

function stepText(t) {
  const [running, done] = STEP_TEXT[t.name] || [() => t.name, () => t.name];
  const a = t.args || {}, r = t.result || {};
  if (!t.result) return t.approval ? `Waiting for your OK: ${t.approval}` : running(a) + '…';
  if (r.denied) return `You declined: ${t.approval || running(a)}`;
  if (r.error) return `${running(a)} — ${r.error}`;
  try { return done(a, r); } catch { return t.name; }
}

function stepHtml(t, i, openSteps) {
  const r = t.result;
  const status = !r ? (t.approval ? 'wait' : 'run') : r.denied ? 'denied' : r.error ? 'err' : 'ok';
  const icon = { run: '<span class="spin"></span>', wait: ICONS.warn, ok: ICONS.tool, err: ICONS.warn, denied: ICONS.x }[status];
  let detail = '';
  if (r?.results?.length && t.name === 'web_search') {
    detail = `<ol>${r.results.map((x) => `<li><a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">${escapeHtml(x.title)}</a><div class="muted small">${escapeHtml(x.snippet)}</div></li>`).join('')}</ol>`;
  } else if (r?.results?.length && t.name === 'find_files') {
    detail = `<ul>${r.results.map((x) => `<li>${escapeHtml(x.path)} <span class="muted small">${escapeHtml(x.size || '')}</span></li>`).join('')}</ul>`;
  } else if (r?.items?.length) {
    detail = `<ul>${r.items.map((x) => `<li>${x.type === 'folder' ? '📁' : '📄'} ${escapeHtml(x.name)}</li>`).join('')}</ul>`;
  } else if (r?.into_folders) {
    detail = `<ul>${Object.entries(r.into_folders).map(([k, n]) => `<li>📁 ${escapeHtml(k)}: ${n} file${n === 1 ? '' : 's'}</li>`).join('')}</ul>`;
  } else if (r?.url && t.name === 'read_webpage') {
    detail = `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>`;
  }
  else if (t.name === 'screenshot_page' && r?.looks_like) {
    detail = `<div class="muted small">${escapeHtml(r.looks_like)}</div>`;
  } else if (t.name === 'upload_to_github' && r) {
    detail = r.uploaded ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>` : `<div class="muted small">${escapeHtml(r.next_step || '')}</div>`;
  } else if (r?.diff) {
    detail = `<pre class="diff">${diffHtml(r.diff)}</pre>`;
  } else if (t.name === 'run_in_project' && r) {
    detail = `<pre class="run-output">${runOutputHtml(r)}</pre>`;
  } else if (t.name === 'search_code' && r?.matches?.length) {
    detail = `<pre class="run-output">${escapeHtml(r.matches.join('\n'))}</pre>`;
  } else if (t.name === 'sports_player' && r?.line != null) {
    const row = (label, x) => x && typeof x === 'object' && x.games ? `<tr><td>${label}</td><td>${x.over}/${x.games}</td><td>${x.over_pct ?? '–'}%</td><td>${x.average ?? ''}</td></tr>` : '';
    detail = `<table class="pick-table"><tr><th></th><th>Over ${escapeHtml(String(r.line))}</th><th>Hit</th><th>Avg</th></tr>${
      row('Last 5', r.last_5)}${row('Last 10', r.last_10)}${row('This season', r.this_season)}${row('Last season', r.last_season)}${
      row('Home', r.home)}${row('Away', r.away)}${row(`vs ${escapeHtml(r.vs_opponent?.opponent || 'opponent')}`, r.vs_opponent)}</table>` +
      (r.injury ? `<div class="small">🩹 ${escapeHtml(r.injury)}</div>` : '') +
      (r.recent_games?.length ? `<pre class="run-output">${escapeHtml(r.recent_games.join('\n'))}</pre>` : '');
  } else if (t.name === 'run_python' && r) {
    detail = `<pre class="run-output">${runOutputHtml(r)}</pre>${r.images?.length ? runImagesHtml(r.images) : ''}`;
  } else if (t.name === 'search_documents' && r?.results) {
    detail = `<ul>${r.results.map((x) => `<li><b>${escapeHtml(x.file)}</b><div class="muted small">${escapeHtml(x.text.slice(0, 220))}…</div></li>`).join('')}</ul>`;
  } else if (t.name === 'look_at_screen' && r?.screen) {
    detail = `<div class="muted small">${escapeHtml(r.screen)}</div>`;
  } else if (t.name === 'get_weather' && r?.forecast) {
    detail = `<ul>${r.forecast.map((d) => `<li>${escapeHtml(d.date)}: ${escapeHtml(d.summary)}, ${d.high} / ${d.low}, rain ${d.chance_of_rain}</li>`).join('')}</ul>`;
  } else if (r?.devices) {
    detail = `<ul>${r.devices.map((d) => `<li>${escapeHtml(d.name)} — ${escapeHtml(d.state)}</li>`).join('')}</ul>`;
  } else if (r?.clipboard && t.name === 'get_clipboard') {
    detail = `<div class="muted small">${escapeHtml(r.clipboard.slice(0, 600))}</div>`;
  }
  if (t.screen) detail += `<div class="muted small">Opened on your screen: ${escapeHtml(t.screen)}</div>`;
  const key = t.id || String(i);
  const summary = `<summary>${icon}<span>${escapeHtml(stepText(t))}</span></summary>`;
  return detail
    ? `<details class="step ${status}" data-id="${key}"${openSteps.has(key) ? ' open' : ''}>${summary}<div class="step-detail">${detail}</div></details>`
    : `<div class="step ${status}"><div class="summary">${icon}<span>${escapeHtml(stepText(t))}</span></div></div>`;
}

function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h}h`, m && `${m}m`, sec && `${sec}s`].filter(Boolean).join(' ');
}

// ------------------------------------------------------------ sending
const input = $('#input');
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  updateComposerButtons();
}
function updateComposerButtons() {
  const busy = !!state.abort;
  const hasText = input.value.trim() || state.attachments.length;
  $('#stopBtn').hidden = !busy;
  $('#sendBtn').hidden = busy || !hasText;
  $('#voiceBtn').hidden = busy || !!hasText;
}
input.addEventListener('input', () => { autosize(); updateSlashMenu(); });
input.addEventListener('keydown', (e) => {
  if (slash.open && handleSlashKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#composer').onsubmit = (e) => {
  e.preventDefault();
  if (state.abort) return;
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  input.value = '';
  autosize();
  closeSlashMenu();
  input.placeholder = modePlaceholder(state.mode);
  const command = parseSlash(text);
  if (command?.action) { command.action(); return; }
  if (command) sendMessage(command.prompt, { display: text });
  else sendMessage(text);
};

// ------------------------------------------------------------ slash commands
const COMMANDS = [
  { cmd: '/remind', desc: 'Set a reminder', hint: 'at 6pm to call mom', to: (r) => `Remind me ${r}` },
  { cmd: '/timer', desc: 'Start a timer', hint: '10 minutes for the pasta', to: (r) => `Set a timer for ${r}` },
  { cmd: '/weather', desc: 'Check the weather', hint: 'Chicago', to: (r) => (r ? `What's the weather in ${r}?` : "What's the weather like today?") },
  { cmd: '/research', desc: 'Deep research: reads many sources, writes a cited report', hint: 'best laptop for college under $800', action: (r) => (r ? sendMessage(r, { research: true }) : setResearch(true)) },
  { cmd: '/search', desc: 'Search the web', hint: 'best budget graphics card', to: (r) => `Search the web for: ${r}` },
  { cmd: '/image', desc: 'Create an image', hint: 'a gold owl on a night sky', to: (r) => `Generate an image: ${r}` },
  { cmd: '/pick', desc: 'Check a player prop (PrizePicks, Underdog)', hint: 'LeBron over 24.5 points', to: (r) => `Check this pick with real stats: ${r}` },
  { cmd: '/scores', desc: 'Scores, schedule and lines', hint: 'NBA tonight', to: (r) => `Look up the games: ${r}` },
  { cmd: '/find', desc: 'Find a file on your PC', hint: 'my resume', to: (r) => `Find ${r} on my PC` },
  { cmd: '/organize', desc: 'Tidy up a folder', hint: 'Downloads', to: (r) => `Organize my ${r || 'Downloads'} folder` },
  { cmd: '/docs', desc: 'Ask your documents', hint: 'what does my lease say about pets?', to: (r) => `Search my documents: ${r}` },
  { cmd: '/screen', desc: 'Look at your screen', hint: 'what does this error mean?', to: (r) => `Look at my screen. ${r || "What's on it?"}` },
  { cmd: '/open', desc: 'Open an app', hint: 'Spotify', to: (r) => `Open ${r}` },
  { cmd: '/remember', desc: 'Save something to memory', hint: "my sister's birthday is June 3", to: (r) => `Remember this: ${r}` },
  { cmd: '/run', desc: 'Write and run Python', hint: 'count the words in a sentence', to: (r) => `Write Python code to ${r}, run it, and show me the result` },
  { cmd: '/focus', desc: 'Start a focus timer', hint: '25 minutes on homework', to: (r) => `Start a focus session${r ? `: ${r}` : ' for 25 minutes'}` },
  { cmd: '/saved', desc: 'Your saved replies', action: () => openSaved() },
  { cmd: '/review', desc: 'Review due flashcards', action: () => startReview(null) },
  { cmd: '/decks', desc: 'Your flashcard decks', action: () => openDecks() },
  { cmd: '/brief', desc: 'Morning briefing', action: () => startBriefing() },
  { cmd: '/voice', desc: 'Start talking', action: () => startVoice() },
  { cmd: '/new', desc: 'New chat', action: () => newChat() },
  { cmd: '/cheatsheet', desc: 'One-page cheat sheet to print', hint: 'derivatives', action: (r) => makeCheatSheet(r) },
  { cmd: '/folder', desc: 'Open a code project folder', action: () => openWorkspaceDialog() },
  { cmd: '/canvas', desc: 'Write a document together', hint: 'cover letter for a barista job', action: (r) => {
    openCanvas();
    if (r) sendMessage(`Write this in the canvas: ${r}`, { display: `/canvas ${r}` });
  } },
  { cmd: '/guide', desc: 'Everything Athena can do', action: () => window.open('guide.html', '_blank', 'noopener') },
  { cmd: '/shortcuts', desc: 'Keyboard shortcuts', action: () => $('#shortcutsDlg').showModal() },
];
const slash = { open: false, items: [], index: 0 };

function parseSlash(text) {
  const m = text.match(/^(\/[a-z]+)\s*([\s\S]*)$/i);
  const c = m && COMMANDS.find((x) => x.cmd === m[1].toLowerCase());
  if (!c) return null;
  return c.action ? { action: () => c.action(m[2].trim()) } : { prompt: c.to(m[2].trim()) };
}

function updateSlashMenu() {
  const v = input.value;
  if (!/^\/[a-z]*$/i.test(v)) { closeSlashMenu(); return; }
  slash.items = COMMANDS.filter((c) => c.cmd.startsWith(v.toLowerCase()));
  if (!slash.items.length) { closeSlashMenu(); return; }
  slash.index = Math.min(slash.index, slash.items.length - 1);
  slash.open = true;
  renderSlashMenu();
}

function renderSlashMenu() {
  const menu = $('#slashMenu');
  menu.innerHTML = slash.items.map((c, i) => `<button type="button" class="slash-item${i === slash.index ? ' active' : ''}" data-i="${i}">
    <span class="cmd">${c.cmd}</span><span class="desc">${escapeHtml(c.desc)}</span>${c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : ''}</button>`).join('');
  menu.hidden = false;
  menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function closeSlashMenu() { slash.open = false; slash.index = 0; $('#slashMenu').hidden = true; }

function chooseSlash(i) {
  const c = slash.items[i];
  closeSlashMenu();
  if (c.action) { input.value = ''; autosize(); c.action(); return; }
  input.value = `${c.cmd} `;
  autosize();
  input.placeholder = c.hint ? `${c.cmd} ${c.hint}` : 'Message Athena';
  input.focus();
}

function handleSlashKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length;
    renderSlashMenu();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseSlash(slash.index); return true; }
  if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); return true; }
  return false;
}
$('#slashMenu').addEventListener('mousedown', (e) => {
  const item = e.target.closest('[data-i]');
  if (item) { e.preventDefault(); chooseSlash(Number(item.dataset.i)); }
});
input.addEventListener('blur', () => setTimeout(closeSlashMenu, 150));
$('#stopBtn').onclick = stopGenerating;

function stopGenerating() {
  state.abort?.abort();
  state.abort = null;
  updateComposerButtons();
}

// "Fix yourself", "improve your code", "add a dark mode button to yourself": open Athena's own code in Code mode first.
// Asking for a change to the app itself ("add a sports section to settings", "put a button in the sidebar") is a
// change to Athena herself too, unless another code project is open in this chat.
const APP_PART = String.raw`(?:settings?|sidebar|side bar|menu|top bar|toolbar|chat ?box|home ?screen|personalit(?:y|ies)|drop ?down|abilities|voice tab|general tab|interface|ui|app|athena|you)`;
const APP_EDIT = new RegExp([
  String.raw`\b(?:add|put|make|create|build|insert|include|give)\b.{0,60}?\b(?:section|tab|page|button|toggle|switch|option|setting|menu|panel|drop ?down|slider|field|mode|feature|shortcut)s?\b.{0,40}?\b(?:to|in|into|on|under|inside|for)\s+(?:the\s+|your\s+|my\s+(?!(?:app|website|site|game|project)\b)|athena'?s\s+)?${APP_PART}\b`,
  String.raw`\b(?:add|make|create)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:\w+\s+){0,3}?(?:settings?|sidebar)\s+(?:section|tab|page|option|toggle|button)\b(?!.*\b(?:my|his|her|their|this|a|the)\s+(?:app|website|site|game|project)\b)`,
  String.raw`\b(?:remove|delete|get rid of|hide|move|rename)\b.{0,50}?\b(?:button|section|tab|setting|option|toggle|menu)\b.{0,30}?\b(?:from|in|on|to)\s+(?:the\s+|your\s+|my\s+(?!(?:app|website|site|game|project)\b))?${APP_PART}\b`,
  String.raw`\bgive\s+(?:yourself|your\s*self)\s+(?:the\s+)?(?:ability|option|power|feature|a way)\b`,
  String.raw`\badd\s+(?:a\s+|the\s+)?(?:new\s+)?feature\s+(?:to\s+you|where\s+you|that\s+lets\s+you|so\s+you)\b`,
].join('|'), 'i');

const SELF_EDIT = new RegExp([
  // "fix yourself", "upgrade your code", "improve athena's code"
  String.raw`\b(?:fix|upgrade|improve|change|edit|modify|debug|repair|rewrite|work on)\s+(?:yourself|your\s*self|your\s+(?:own\s+)?(?:code|app|source|system|files|ui|design|interface)|athena'?s\s+(?:own\s+)?code)\b`,
  // "add a dark mode to yourself", "implement it in your code", "put that into your own app", "build it into yourself"
  String.raw`\b(?:add|implement|implament|apply|put|build|install|code|program|integrate|make)\b.{0,80}?\b(?:to|in|into|on)\s+(?:yourself|your\s*self|your\s+(?:own\s+)?(?:code|app|source|system|files|ui|design|interface))\b`,
].join('|'), 'i');

async function sendMessage(text, { voice = false, display = null, research = false } = {}) {
  const otherProject = state.chat?.workspace?.path && state.chat.workspace.path !== state.status.athena_root;
  const wantsSelf = SELF_EDIT.test(text) || (!otherProject && APP_EDIT.test(text));
  if (!voice && state.chat && wantsSelf && state.status.athena_root && state.chat.workspace?.path !== state.status.athena_root) {
    await openWorkspace(state.status.athena_root, { quiet: true });
    if (state.chat.workspace?.path) toast('🛠 Opened my own code. You approve every change I make, and I can undo them.');
  }
  research = !voice && (research || state.researchNext);
  if (research) setResearch(false);
  if (!state.status.ollama) { await refreshStatus(); }
  if (state.pcReachable === false) { toast("Can't reach Athena on your PC from here. See the note at the top.", 'error'); return; }
  let model = voice ? pickDefaultModel('voice') : currentModel();
  if (!model) { toast('Download a model first (Settings → Models).', 'error'); openSettings('models'); return; }
  let route = null;
  if (autoOn() && !voice && !state.compare && !research) {
    route = routeMessage(text, state.chat);
    model = (route === 'assistant' ? currentModel() : pickDefaultModel(route)) || model;
  }
  // A new picture, or a follow-up right after one ("what's the answer?"), goes to a model that can see it.
  const newImage = state.attachments.some((a) => a.kind === 'image');
  const recentImage = state.chat.messages.slice(-4).some((m) => m.images?.length);
  if (!voice && (newImage || recentImage) && !isVision(model)) {
    const vision = pickVisionModel();
    if (vision) { if (newImage && !route) toast(`Using ${vision} to look at the image`); model = vision; if (route) route = 'vision'; }
    else if (newImage) toast('To understand images, download a vision model like qwen3-vl:8b or gemma3:4b (Settings → Models).', 'error');
  }

  state.pendingKeep?.(0); // sent again without picking a side: keep the left answer
  const msg = { role: 'user', content: text, display: display ?? text, time: Date.now() };
  if (!voice) sfx('send');
  if (state.attachments.length) {
    const textFiles = state.attachments.filter((a) => a.kind === 'text');
    const images = state.attachments.filter((a) => a.kind === 'image');
    if (textFiles.length) {
      msg.content = `${text}\n\n${textFiles.map((f) => `File: ${f.name}\n\`\`\`${f.lang}\n${f.data}\n\`\`\``).join('\n\n')}`;
      msg.files = textFiles.map((f) => f.name);
    }
    if (images.length) msg.images = images.map((i) => i.data);
    state.attachments = [];
    renderAttachments();
  }
  state.chat.messages.push(msg);
  renderMessages();
  if (state.compare && !voice) await compareReplies(state.compare);
  else await generateReply({ voice, model, route, research });
}

// ------------------------------------------------------------ compare two models
function renderCompareChip() {
  const chip = $('#compareChip');
  chip.hidden = !state.compare;
  if (state.compare) chip.innerHTML = `<span>⚖ Comparing <b>${escapeHtml(state.compare[0])}</b> vs <b>${escapeHtml(state.compare[1])}</b></span><button type="button" title="Stop comparing">${ICONS.x}</button>`;
}
$('#compareChip').onclick = (e) => { if (e.target.closest('button')) { state.compare = null; renderCompareChip(); } };

async function compareReplies(models) {
  const chat = state.chat;
  const history = chat.messages.map(({ role, content, images }) => ({ role, content, images }));
  const el = document.createElement('div');
  el.className = 'msg assistant compare';
  el.innerHTML = `<div class="cmp-grid">${models.map((m, i) => `
    <div class="cmp-col" data-col="${i}">
      <div class="cmp-head"><b>${escapeHtml(m)}</b><span class="muted small cmp-stat"></span></div>
      <div class="cmp-body"><div class="typing"><span></span><span></span><span></span></div></div>
      <button type="button" class="ghost cmp-keep" data-keep="${i}" disabled>Keep this one</button>
    </div>`).join('')}</div>`;
  $('.thread', messagesEl).append(el);
  scrollBottom(true);
  const abort = new AbortController();
  state.abort = abort;
  updateComposerButtons();
  const results = models.map((model) => ({ role: 'assistant', content: '', thinking: '', model, time: Date.now() }));

  const run = async (model, i) => {
    const r = results[i];
    const body = el.querySelector(`[data-col="${i}"] .cmp-body`);
    const t0 = performance.now();
    let raf = 0;
    const paint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; body.innerHTML = `<div class="md">${renderMarkdown(splitThinking(r).content) || '…'}</div>`; }); };
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ model, mode: state.mode, no_tools: true, project_id: chat.project_id || null, canvas: canvasForChat(), messages: history }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'token') r.content += ev.content;
          else if (ev.type === 'thinking') r.thinking += ev.content;
          else if (ev.type === 'error') r.error = ev.message;
          else if (ev.type === 'done') r.stats = ev.stats;
        }
        paint();
      }
    } catch (e) { if (e.name !== 'AbortError') r.error = e.message; }
    cancelAnimationFrame(raf);
    if (!r.thinking) delete r.thinking;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    body.innerHTML = r.error ? `<div class="err">${escapeHtml(r.error)}</div>` : `<div class="md">${renderMarkdown(splitThinking(r).content) || '<i>(no answer)</i>'}</div>`;
    hydrateGraphs(body, false);
    hydrateStudy(body, false);
    const words = (splitThinking(r).content.match(/\S+/g) || []).length;
    el.querySelector(`[data-col="${i}"] .cmp-stat`).textContent = `${secs}s · ${words} words`;
    el.querySelector(`[data-keep="${i}"]`).disabled = !!r.error || !r.content;
  };
  await Promise.all(models.map(run));
  if (state.abort === abort) state.abort = null;
  updateComposerButtons();
  sfx('done');

  const keep = (i) => {
    state.pendingKeep = null;
    if (chat !== state.chat) return;
    const pick = results[i];
    const reply = { ...pick, versions: results.filter((r) => r.content).map(snapshot), compared: models };
    reply.v = reply.versions.findIndex((v) => v.model === pick.model);
    el.remove();
    chat.messages.push(reply);
    if (chat === state.chat) renderMessages();
    saveChat();
    if (chat.autoTitle !== false && chat.messages.filter((m) => m.role === 'assistant').length === 1) smartTitle(chat, reply);
  };
  if (abort.signal.aborted && !results.some((r) => r.content)) { el.remove(); return; }
  state.pendingKeep = keep;
  el.querySelector('.cmp-grid').onclick = (e) => { const b = e.target.closest('[data-keep]'); if (b && !b.disabled) keep(Number(b.dataset.keep)); };
  el.querySelectorAll('.cmp-keep').forEach((b) => { b.classList.add('ready'); });
}

async function generateReply({ voice = false, model = null, route = null, think = null, research = false } = {}) {
  const chat = state.chat;
  // With Auto, a routed message uses that specialist's instructions too (code, study); pictures and chat stay general.
  const mode = voice ? 'voice' : route === 'code' || route === 'study' ? route : state.mode;
  model = model || currentModel();
  // Think harder: Quick / Normal / Deep. Voice keeps it quick so she answers straight away.
  const thinkLevel = voice ? 'normal' : think || state.settings.think_level || 'normal';
  const reply = { role: 'assistant', content: '', thinking: '', tools: [], model, streaming: true, time: Date.now(), ...(voice ? { voice: true } : {}), ...(route ? { route } : {}), ...(thinkLevel === 'deep' ? { think: 'deep' } : {}), ...(research ? { research: { steps: [], started: Date.now() } } : {}) };
  chat.messages.push(reply);

  const thread = $('.thread', messagesEl);
  const el = messageEl(reply, chat.messages.length - 1);
  thread.append(el);
  markLast();
  scrollBottom(true);

  const abort = new AbortController();
  state.abort = abort;
  updateComposerButtons();
  const speakThis = voice || state.settings.auto_speak;
  if (speakThis) speaker.reset();

  // Smooth writing: the model sends words in uneven bursts; show them at a steady pace that keeps up with it.
  let raf = 0;
  let shown = 0;
  const frame = () => {
    raf = 0;
    const target = reply.content.length;
    if (shown > target || motionOff()) shown = target;
    else if (shown < target) shown = Math.min(target, shown + Math.max(2, Math.ceil((target - shown) / 7)));
    updateAssistantEl(el, shown < target ? { ...reply, content: reply.content.slice(0, shown) } : reply);
    scrollBottom();
    if (shown < target) raf = requestAnimationFrame(frame);
  };
  const paint = () => { if (!raf) raf = requestAnimationFrame(frame); };
  let thinkStart = 0;
  // Let you know when the model has to load into memory first (can take a while on the first message).
  // "Waking up…" only when the model really isn't loaded yet; otherwise the typing dots show while she reads.
  const warmTimer = 0;
  fetch('/api/models/loaded').then((r) => r.json()).then((l) => {
    if (!l.unknown && !l.models.includes(model) && !reply.content && !reply.thinking) { reply.warming = true; paint(); }
  }).catch(() => {});

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoken_language: voice && state.status.whisper ? lastLanguage : null,
        model, mode, think_level: thinkLevel, research: research || undefined, auto_approve: !!chat.autoApprove, project_id: chat.project_id || null, workspace: chat.workspace?.path || null, canvas: voice ? null : canvasForChat(),
        // A long chat: the oldest part is sent as her running summary of it, not word for word.
        summary: summaryFor(chat)?.text || undefined,
        messages: chat.messages.slice(summaryFor(chat)?.upto || 0, -1).map(({ role, content, images }) => ({ role, content, images })),
      }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (reply.warming) delete reply.warming;
        if (ev.type !== 'token' || Math.random() < 0.3) brainSignal(ev.type === 'tool_start' ? 'tool' : ev.type, ev.type === 'token' ? splitThinking(reply).content + ev.content : undefined);
        if (ev.type === 'token') {
          if (thinkStart && !reply.thinkSecs) reply.thinkSecs = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
          reply.content += ev.content;
          if (speakThis) speaker.feed(splitThinking(reply).content);
          if (voice) {
            const said = splitThinking(reply).content;
            if (!speaker.speaking) setVoiceCaption(said, 'athena');
            if (/\b(ha(ha)+|he(he)+|yay|lol|hooray)\b|[♪♡]/i.test(said.slice(-40))) state.voice.avatar?.cheer?.();
          }
        } else if (ev.type === 'retry') {
          // The model stopped without answering; the server is asking again. Clear the half-finished attempt.
          if (speakThis) speaker.reset(); // and don't read it aloud
          reply.content = '';
          reply.thinking = '';
          delete reply.thinkSecs;
          thinkStart = 0;
        } else if (ev.type === 'summary') {
          chat.summary = { text: ev.text, upto: (summaryFor(chat)?.upto || 0) + ev.covered };
        } else if (ev.type === 'mood') {  // how you seem in this message: her voice follows it (adaptive voice)
          state.userMood = { mood: ev.mood, intensity: ev.intensity, at: Date.now() };
        } else if (ev.type === 'model') {  // her model didn't fit on the graphics card: she switched, so keep using that one
          reply.model = ev.name;
          if (chat === state.chat) { chat.model = ev.name; renderModelButton(); }
        } else if (ev.type === 'notice') {
          toast(ev.message);
          if (voice) setVoiceState('thinking', ev.message);
        } else if (ev.type === 'research') {
          researchEvent(reply.research, ev);
        } else if (ev.type === 'thinking') {
          if (!thinkStart) thinkStart = Date.now();
          reply.thinking += ev.content;
        } else if (ev.type === 'tool_start') {
          reply.tools.push({ id: ev.id, name: ev.name, args: ev.args });
          if (voice) setVoiceState('thinking', stepText(reply.tools.at(-1)));
        } else if (ev.type === 'approval') {
          const step = reply.tools.find((t) => t.id === ev.id);
          if (step) step.approval = ev.summary;
          askApproval(ev, chat, voice);
        } else if (ev.type === 'screen') {
          const step = reply.tools.find((t) => t.id === ev.id);
          if (step) step.screen = ev.target;
        } else if (ev.type === 'tool') {
          const step = reply.tools.find((t) => t.id === ev.id) || reply.tools[reply.tools.push({ id: ev.id, name: ev.name, args: ev.args }) - 1];
          step.result = ev.result;
          closeApproval(ev.id);
          handleToolEvent(ev);
        } else if (ev.type === 'error') {
          reply.error = ev.message;
        } else if (ev.type === 'done') {
          reply.stats = ev.stats;
          brainSignal('token', splitThinking(reply).content);
        }
        paint();
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') reply.error = err.message;
  } finally {
    if (state.abort === abort) state.abort = null;
    clearTimeout(warmTimer);
    delete reply.warming;
    closeApproval();
    if (!voice && !abort.signal.aborted && reply.content) sfx('done');
    cancelAnimationFrame(raf);
    raf = 0;
    reply.streaming = false;
    if (!reply.thinking) delete reply.thinking;
    if (reply.research) reply.research.secs = Math.round((Date.now() - reply.research.started) / 1000);
    if (!reply.tools.length) delete reply.tools;
    const { content } = splitThinking(reply);
    if (!abort.signal.aborted && chat === state.chat && /```canvas/.test(content)) applyCanvasReply(content);
    if (!voice && !abort.signal.aborted && chat === state.chat && /```(html|htm|svg)\b/i.test(content)) setTimeout(() => autoPreview(el), 50);
    if (speakThis && !abort.signal.aborted) speaker.feed(content, true);
    if (voice) state.voice.avatar?.setMood?.(detectMood(content));
    if (reply.error && speakThis) speaker.say(`Sorry, something went wrong. ${reply.error}`);
    if (!reply.content && !reply.error && abort.signal.aborted) reply.content = '_(stopped)_';
    updateAssistantEl(el, reply);
    updateComposerButtons();
    scrollBottom();
    if (chat === state.chat) {
      if (!chat.model) chat.model = model;
      await saveChat();
    }
    refreshLoaded();
    if (mode === 'study' && !state.streak?.today) refreshDeckBadge(); // first study of the day extends the streak
    if (!reply.error && chat.autoTitle !== false && chat.messages.filter((m) => m.role === 'assistant').length === 1) smartTitle(chat, reply);
    if (!reply.error && !abort.signal.aborted && reply.content) learnFrom(chat, reply);
  }
  // She decided the request means changing herself: open her own code and carry on there, with the real tools.
  const selfRequest = state.openSelfAfter;
  state.openSelfAfter = null;
  if (selfRequest && !abort.signal.aborted && chat === state.chat && state.status.athena_root) {
    await openWorkspace(state.status.athena_root, { quiet: true });
    if (state.chat.workspace?.path === state.status.athena_root) {
      toast('🛠 Opened my own code. You approve every change I make, and I can undo them.');
      setTimeout(() => sendMessage(`Make this change to yourself now, in your real code: ${selfRequest}`, { display: `🛠 ${selfRequest}` }), 300);
    }
  }
  return reply;
}

/** Her summary of the start of a long chat, if it still matches (editing an older message makes it stale). */
function summaryFor(chat) {
  const sm = chat.summary;
  if (!sm?.text) return null;
  if (sm.upto >= chat.messages.length - 1) { delete chat.summary; return null; }
  return sm;
}

// ------------------------------------------------------------ Deep research (watch her work)
function researchEvent(r, ev) {
  if (!r) return;
  if (ev.step === 'plan' || ev.step === 'gaps') r.steps.push({ kind: ev.step, queries: ev.queries });
  else if (ev.step === 'search') {
    const row = r.steps.find((x) => x.kind === 'search' && x.query === ev.query && x.status === 'running');
    if (row) Object.assign(row, { status: ev.status, count: ev.results?.length ?? 0, error: ev.error });
    else r.steps.push({ kind: 'search', query: ev.query, status: ev.status });
  } else if (ev.step === 'read') {
    const row = r.steps.find((x) => x.kind === 'read' && x.id === ev.id);
    if (row) Object.assign(row, ev.title ? { title: ev.title } : {}, { status: ev.status, note: ev.note, n: ev.n, reason: ev.reason });
    else r.steps.push({ kind: 'read', id: ev.id, url: ev.url, title: ev.title, status: ev.status });
  } else if (ev.step === 'write') r.writing = true;
}

function researchHtml(m, el) {
  const r = m.research;
  const reads = r.steps.filter((x) => x.kind === 'read');
  const used = reads.filter((x) => x.status === 'done').length;
  const live = m.streaming && !r.writing;
  // Open while she works; folds away once the report is done (click to look again).
  const box = el.querySelector('.research-box');
  const open = m.streaming ? (box ? box.open : true) : box?.dataset.done ? box.open : false;
  const label = live ? `Researching… ${reads.length ? `${used} source${used === 1 ? '' : 's'} so far` : 'planning'}`
    : m.streaming ? `Writing the report from ${used} source${used === 1 ? '' : 's'}…`
    : `Researched ${used} source${used === 1 ? '' : 's'}${r.secs ? ` in ${r.secs >= 60 ? `${Math.floor(r.secs / 60)}m ${r.secs % 60}s` : `${r.secs}s`}` : ''}`;
  const icon = (st) => (st === 'running' || st === 'reading' ? '<span class="spin"></span>' : st === 'done' ? '<span class="ok">✓</span>' : '<span class="skip">–</span>');
  const rows = r.steps.map((x) => {
    if (x.kind === 'plan' || x.kind === 'gaps') {
      return `<li class="plan"><b>${x.kind === 'plan' ? '🗺 Plan' : '🧩 Filling gaps'}</b><div>${x.queries.map((q) => `<span class="q">${escapeHtml(q)}</span>`).join('')}</div></li>`;
    }
    if (x.kind === 'search') {
      return `<li>${icon(x.status)}<span>🔍 Searching <i>${escapeHtml(x.query)}</i>${x.status === 'done' ? ` <span class="muted small">· ${x.error ? escapeHtml(x.error) : `${x.count} result${x.count === 1 ? '' : 's'}`}</span>` : ''}</span></li>`;
    }
    const tag = x.n ? `<span class="cite">[${x.n}]</span> ` : '';
    const note = x.note ? `<details class="note"><summary>What she found</summary><div class="md">${renderMarkdown(x.note)}</div></details>` : '';
    return `<li class="${x.status === 'skip' ? 'skipped' : ''}">${icon(x.status)}<span>${tag}${x.status === 'reading' ? 'Reading ' : ''}<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">${escapeHtml(x.title || host(x.url))}</a> <span class="muted small">${escapeHtml(host(x.url))}${x.status === 'skip' ? ` · skipped: ${escapeHtml(x.reason || '')}` : ''}</span>${note}</span></li>`;
  }).join('');
  const pct = live ? Math.min(92, 8 + reads.filter((x) => x.status !== 'reading').length * 8) : 100;
  return `<details class="research-box"${open ? ' open' : ''}${m.streaming ? '' : ' data-done="1"'}><summary>🔭 ${label}</summary>${m.streaming ? `<div class="rbar"><i style="width:${pct}%"></i></div>` : ''}<ol class="rsteps">${rows}</ol></details>`;
}

function setResearch(on) {
  state.researchNext = on;
  const b = $('#researchBtn');
  b.classList.toggle('on', on);
  b.title = on ? 'Research is on for your next message: she searches the web, reads many sources and writes a cited report. Click to turn off.'
    : 'Deep research: she searches the web, reads many sources while you watch, and writes a cited report';
  $('#input').placeholder = on ? 'What should Athena research?' : 'Message Athena';
  if (on) $('#input').focus();
}
$('#researchBtn').onclick = () => setResearch(!state.researchNext);

// ------------------------------------------------------------ custom voices (learned from recordings)
let customVoices = [];
async function loadCustomVoice() {
  let st;
  try { st = await api('/api/custom-voice'); } catch { return; }
  customVoices = st.voices || [];
  const el = $('#cvStatus');
  if (!st.installed) {
    el.innerHTML = '<b>Not installed yet.</b> Close Athena, double-click <b>install-custom-voice</b> (the Windows Batch File) in the Athena folder, wait for “Done”, then start Athena again. It downloads about 3–4 GB.';
  } else if (!customVoices.length) {
    el.innerHTML = '✓ Installed. Add a voice below.';
  } else {
    const using = customVoices.find((v) => v.id === st.active);
    el.innerHTML = (state.settings.tts_engine === 'custom' && using ? `✓ Speaking as <b>${escapeHtml(using.name)}</b>.` : '✓ Ready. Choose “Custom voice” above, or pick a voice per personality in Settings → General.') +
      (st.running && st.device === 'cpu' ? ' Each sentence takes a few seconds on the processor.' : '');
  }
  if (st.error) el.innerHTML += `<br><span class="error-text">${escapeHtml(st.error)}</span>`;
  $('#cvList').innerHTML = customVoices.map((v) => `<li data-cv="${escapeHtml(v.id)}" class="${v.id === st.active ? 'on' : ''}">
      <label class="cv-pick"><input type="radio" name="cvActive" ${v.id === st.active ? 'checked' : ''} /> <b>${escapeHtml(v.name)}</b></label>
      <button type="button" class="ghost" data-cv-act="test">▶ Test</button>
      <button type="button" class="ghost danger" data-cv-act="remove" title="Remove this voice">${ICONS.trash}</button></li>`).join('');
  fillPersonaVoices();
}
$('#cvList').onclick = async (e) => {
  const li = e.target.closest('[data-cv]');
  if (!li) return;
  const id = li.dataset.cv, voice = customVoices.find((v) => v.id === id);
  const act = e.target.closest('[data-cv-act]')?.dataset.cvAct;
  if (act === 'test') {
    toast(`Loading ${voice?.name || 'the voice'}… the first time can take a minute.`);
    try {
      const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Hi! I'm ${voice?.name || 'your custom voice'}. This is how I sound.`, engine: 'custom', custom_voice: id, lang: 'en', strict: true }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'The voice couldn’t speak.');
      new Audio(URL.createObjectURL(await res.blob())).play();
    } catch (err) { toast(err.message, 'error'); }
    setTimeout(loadCustomVoice, 1000);
  } else if (act === 'remove') {
    if (!confirm(`Remove ${voice?.name || 'this voice'}?`)) return;
    await api(`/api/custom-voice/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshStatus();
    if (!state.status.custom_voice && state.settings.tts_engine === 'custom') { await saveSettings({ tts_engine: 'auto' }); $('#setTtsEngine').value = 'auto'; }
    loadCustomVoice();
  } else if (e.target.closest('.cv-pick')) {
    await saveSettings({ custom_voice_id: id, tts_engine: 'custom' });
    $('#setTtsEngine').value = 'custom';
    fetch('/api/custom-voice/warm', { method: 'POST' }).catch(() => {});
    toast(`Athena will now speak as ${voice?.name || 'this voice'}.`);
    loadCustomVoice();
  }
};
$('#cvSave').onclick = async () => {
  const file = $('#cvFile').files[0];
  if (!file) { toast('Pick the recording first.', 'error'); return; }
  if (!$('#cvConsent').checked) { toast('Please confirm you have permission to use this voice.', 'error'); return; }
  const form = new FormData();
  form.append('file', file);
  form.append('name', $('#cvName').value.trim());
  form.append('consent', 'true');
  $('#cvSave').disabled = true;
  try {
    const res = await fetch('/api/custom-voice', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || 'Couldn’t save the recording');
    if (!customVoices.length) { await saveSettings({ tts_engine: 'custom' }); $('#setTtsEngine').value = 'custom'; }
    state.settings = await api('/api/settings');
    await refreshStatus();
    toast(`Added ${body.sample?.name || 'the voice'}. Click ▶ Test to hear it.`);
    $('#cvFile').value = ''; $('#cvName').value = ''; $('#cvConsent').checked = false;
  } catch (err) { toast(err.message, 'error'); } finally { $('#cvSave').disabled = false; loadCustomVoice(); }
};

// A voice for each personality: "Usual", any natural voice, or any custom voice.
function fillPersonaVoices() {
  const natural = Object.entries(state.status.kokoro_voices || {}).map(([id, label]) => `<option value="${id}">Natural: ${escapeHtml(label)}</option>`).join('');
  const mine = customVoices.map((v) => `<option value="custom:${escapeHtml(v.id)}">Custom: ${escapeHtml(v.name)}</option>`).join('');
  $('#setPersonaVoice').innerHTML = '<option value="">Same as usual (Settings → Voice)</option>' + natural + mine;
  $('#setPersonaVoice').value = (state.settings.persona_voices || {})[state.settings.persona] || '';
  $('#personaVoice').innerHTML = '<option value="">Voice: same as usual</option>' + natural.replaceAll('Natural: ', 'Voice: ') + mine.replaceAll('Custom: ', 'Voice: ');
}
$('#setPersonaVoice').addEventListener('change', async (e) => {
  await saveSettings({ persona_voices: { ...(state.settings.persona_voices || {}), [state.settings.persona || 'assistant']: e.target.value } });
  if (e.target.value.startsWith('custom:')) fetch('/api/custom-voice/warm', { method: 'POST' }).catch(() => {});
});
$('#setPersona').addEventListener('change', () => setTimeout(fillPersonaVoices, 300));
$('#setTtsEngine').addEventListener('change', (e) => { if (e.target.value === 'custom') fetch('/api/custom-voice/warm', { method: 'POST' }).catch(() => {}); });

// ------------------------------------------------------------ microphone choice + mic test
async function loadMics() {
  const sel = $('#setMic');
  let inputs = [];
  try { inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch { /* no mic access here */ }
  const chosen = state.settings.mic_device || '';
  sel.innerHTML = '<option value="">Windows default</option>' + inputs.map((d, i) =>
    `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `Microphone ${i + 1} (click Test to see names)`)}</option>`).join('');
  sel.value = inputs.some((d) => d.deviceId === chosen) ? chosen : '';
}
$('#setMic').addEventListener('change', async (e) => {
  await saveSettings({ mic_device: e.target.value });
  mic.setDevice(e.target.value);
  $('#micTestNote').textContent = 'Saved. Click Test to try it.';
});
$('#micTest').onclick = async () => {
  const btn = $('#micTest'), note = $('#micTestNote'), meter = $('#micMeter');
  if (state.voice?.active) { note.textContent = 'Close voice chat first.'; return; }
  btn.disabled = true;
  let loudest = 0;
  try {
    await mic.open();
    loadMics(); // names show up once the mic is allowed
    note.textContent = 'Say something like "Hey Athena, what time is it?"';
    const blob = await mic.record({ waitMs: 7000, maxMs: 10000, onLevel: (l) => { loudest = Math.max(loudest, l); meter.style.width = `${Math.round(l * 100)}%`; } });
    meter.style.width = '0';
    if (!blob) {
      note.textContent = loudest < 0.08
        ? "I couldn't hear anything. Pick a different microphone above, or check it isn't muted (Windows Settings → System → Sound → Input)."
        : "I heard sound, but not clearly enough to count as speech. Move closer to the mic, or pick a different one above.";
      return;
    }
    if (!state.status.whisper) { note.textContent = '✓ The mic works. Speech recognition isn\'t installed yet: close Athena, run install-voice.bat, then start Athena again.'; return; }
    note.textContent = 'Got it, working out what you said…';
    let text;
    try { text = await transcribe(blob); } catch (err) {
      note.textContent = `✓ The mic works. Speech recognition had a problem, though: ${err.message}. Check Settings → Health check.`;
      return;
    }
    note.textContent = text ? `✓ I heard: “${text}”` : 'The mic works, but I couldn\'t make out any words. Try speaking a bit louder or closer.';
  } catch (err) {
    note.textContent = micHelp(err);
  } finally {
    btn.disabled = false;
    if (!state.voice?.active) mic.close();
  }
};

// ------------------------------------------------------------ use Athena on your phone
async function loadPhone() {
  const box = $('#phoneBox');
  let info;
  try { info = await api('/api/phone'); } catch { box.innerHTML = ''; return; }
  $('#setPhone').checked = info.enabled;
  $('#setWebAddress').value = state.settings.web_address || '';
  $('#setPhone').disabled = !info.pin_set || info.this_is_phone;
  if (info.this_is_phone) { box.innerHTML = '<p class="small">✓ You\'re using Athena from your phone right now.</p>'; return; }
  if (!info.pin_set) {
    box.innerHTML = '<p class="small">First set a PIN in <a href="#" data-goto-tab="privacy">Privacy &amp; data</a>, so nobody else on your Wi-Fi can open Athena.</p>';
    return;
  }
  if (!info.enabled) { box.innerHTML = ''; return; }
  if (!info.listening) {
    box.innerHTML = `<p class="small"><b>Almost there:</b> close Athena and open her again with start.bat to turn this on.
      If Windows asks whether Python can use your network, tick <b>Private networks</b> and click <b>Allow</b>.</p>`;
    return;
  }
  const secure = info.secure_urls?.length ? info.secure_urls : null;
  const urls = secure || info.urls;
  const url = urls[0];
  if (!url) { box.innerHTML = '<p class="small">This PC doesn\'t seem to be on a network right now.</p>'; return; }
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  box.innerHTML = `<div class="phone-qr">${qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true })}</div>
    <div class="phone-steps"><p class="small"><b>Scan this with your phone's camera</b>, or type this address in its browser:</p>
      <p class="phone-url">${urls.map((u) => `<code>${escapeHtml(u)}</code>`).join('<br>')}</p>
      ${secure ? `<p class="muted small"><b>The first time, your phone warns that the connection isn't private.</b> That's expected: the
      address is secured by your own PC, not a company. Tap <b>Advanced → Proceed</b> (Android) or <b>Show Details → visit this
      website</b> (iPhone). Then enter your PIN, and voice chat works on your phone too.</p>`
      : '<p class="muted small">Then enter your PIN. Typing works; for voice on the phone, update Athena so she can make her secure address.</p>'}
      <p class="muted small">Tip: use your browser's <b>Add to Home Screen</b> and Athena opens like an app.</p>
      ${info.anywhere_urls?.length
        ? `<p class="small"><b>🌍 From anywhere (school, mobile data):</b> <code>${info.anywhere_urls.map(escapeHtml).join('</code> <code>')}</code><br>
           <span class="muted">Works while Tailscale is on on both this PC and your phone. Use this one when you're away from home.</span></p>`
        : `<p class="small"><b>🌍 Away from home?</b> The address above only works on your home Wi-Fi. Install the free
           <b>Tailscale</b> app (tailscale.com) on this PC and your phone, sign in to both with the same account, then come back
           here: a “From anywhere” address appears that works from school or mobile data. The PC must stay on with Athena running.</p>`}</div>`;
}
$('#setWebAddress').addEventListener('change', (e) => saveSettings({ web_address: e.target.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') }));
$('#setPhone').addEventListener('change', async (e) => {
  await saveSettings({ phone_access: e.target.checked });
  loadPhone();
});

// ------------------------------------------------------------ Athena learns
const userText = (m) => (m?.display ?? m?.content ?? '').toString();
const FIRST_PERSON = /\b(i|i'm|im|i've|i'd|my|me|mine|we|our)\b/i;
const CORRECTION = /^\s*(no[,.! ]|nope|not quite|that'?s (wrong|not)|wrong|incorrect|actually[, ]|i meant|i said|not what i|you misunderstood|try again|stop )/i;

// After a reply, quietly pick up lasting facts about you and learn from corrections ("no, I meant…").
// To-dos you mention in passing ("I have to finish my essay by Friday") or finish ("I turned it in").
const TASK_HINT = /\b(i\s*(have|need|got|gotta|must|should)\s*(to|ta)|gotta|need to|have to|don'?t forget|due (on|by|tomorrow|today|next|this)|deadline|i have (a|an|my) (test|exam|quiz|essay|paper|project|meeting|appointment|game|shift|interview|practice)|finished|done with|completed|turned in|submitted|handed in)\b/i;
async function learnFrom(chat, reply) {
  const i = chat.messages.indexOf(reply);
  const user = chat.messages[i - 1];
  const text = userText(user);
  const tasks = state.settings.auto_tasks !== false && TASK_HINT.test(text || '');
  if (state.settings.auto_learn === false && !tasks) return;
  const correction = CORRECTION.test(text) && chat.messages[i - 2]?.role === 'assistant';
  if (!text || (!tasks && !correction && !(state.settings.memory_enabled && text.length >= 12 && FIRST_PERSON.test(text)))) return;
  const prev = correction ? chat.messages[i - 2] : null;
  try {
    const out = await api('/api/learn', json('POST', {
      model: reply.model, user: text, reply: splitThinking(reply).content,
      previous_reply: prev ? splitThinking(prev).content : '', previous_user: prev ? userText(chat.messages[i - 3]) : '',
    }));
    if (out.facts?.length) toast(`🧠 Remembered: ${out.facts.join(' · ')}`, '', { action: { label: 'See all', fn: () => openSettings('about') }, ms: 6000 });
    if (out.lesson) toast(`📝 Got it for next time: ${out.lesson}`, '', { action: { label: 'See all', fn: () => openSettings('about') }, ms: 6000 });
    if (out.tasks?.added?.length || out.tasks?.done?.length) {
      const bits = [...(out.tasks.added || []).map((t) => `➕ ${t}`), ...(out.tasks.done || []).map((t) => `✅ ${t}`)];
      toast(`Tasks: ${bits.join(' · ')}`, '', { action: { label: 'Open tasks', fn: () => { $('#tasksDrawer').hidden = false; loadTasks(); } }, ms: 7000 });
      loadTasks();
    }
  } catch { /* learning is a bonus */ }
}

// 👍 / 👎 on a reply becomes a lesson for next time. 👎 asks (optionally) what to do better.
async function rateReply(msg, idx, rating) {
  if (msg.rating === rating) { delete msg.rating; rerenderMessage(idx); await saveChat(); return; }
  msg.rating = rating;
  rerenderMessage(idx);
  const el = $(`.msg[data-idx="${idx}"]`, messagesEl);
  saveChat();
  const send = async (note = '') => {
    if (state.settings.auto_learn === false) { toast('Thanks! (Athena learns is off in Settings → About you)'); return; }
    try {
      const { lesson } = await api('/api/feedback', json('POST', {
        rating, note, model: msg.model || currentModel(), user: userText(state.chat.messages[idx - 1]), reply: splitThinking(msg).content,
      }));
      toast(lesson ? `📝 Got it for next time: ${lesson}` : 'Thanks for the feedback!', '', lesson ? { action: { label: 'See all', fn: () => openSettings('about') }, ms: 6000 } : {});
    } catch { toast('Thanks for the feedback!'); }
  };
  if (rating === 'up') { send(); return; }
  const box = document.createElement('form');
  box.className = 'feedback-note';
  box.innerHTML = '<input placeholder="What should she do differently? (optional)" maxlength="500" /><button type="submit" class="ghost">Send</button><button type="button" class="ghost" data-skip>Skip</button>';
  el?.querySelector('.body').append(box);
  const input = box.querySelector('input');
  input.focus();
  box.onsubmit = (e) => { e.preventDefault(); box.remove(); send(input.value.trim()); };
  box.querySelector('[data-skip]').onclick = () => { box.remove(); send(); };
  input.onkeydown = (e) => { if (e.key === 'Escape') { box.remove(); send(); } };
}

// Composer button: ⚡ Quick → Normal → 🧠 Deep
const THINK_LEVELS = { quick: ['⚡ Quick', 'Quick answers: fastest, thinks less'], normal: ['Think', 'Normal thinking. Click for 🧠 Deep (thinks longer, double-checks)'], deep: ['🧠 Deep', 'Deep: thinks longer and double-checks. Slower, but best for hard problems'] };
function renderThinkBtn() {
  const level = THINK_LEVELS[state.settings.think_level] ? state.settings.think_level : 'normal';
  const b = $('#thinkBtn');
  b.textContent = THINK_LEVELS[level][0];
  b.title = `${THINK_LEVELS[level][1]}. Click to change.`;
  b.className = `think-btn ${level}`;
}
$('#thinkBtn').onclick = async () => {
  const order = ['normal', 'deep', 'quick'];
  const next = order[(order.indexOf(state.settings.think_level || 'normal') + 1) % order.length];
  await saveSettings({ think_level: next });
  renderThinkBtn();
  if ($('#setThinkLevel')) $('#setThinkLevel').value = next;
};

// ------------------------------------------------------------ smart titles
async function smartTitle(chat, reply) {
  const user = chat.messages.find((m) => m.role === 'user');
  // Use the model that just answered: it's already loaded. Loading a different one for the title could push
  // your chat model out of the graphics card's memory and make your next message slow.
  const model = reply.model || currentModel();
  try {
    const { title, icon } = await api('/api/title', json('POST', { model, user: user?.display ?? user?.content ?? '', reply: splitThinking(reply).content }));
    if (!title || chat.autoTitle === false) return;
    chat.title = title;
    chat.autoTitle = false;
    if (icon) chat.icon = icon;
    await api(`/api/conversations/${chat.id}`, json('PUT', { title, autoTitle: false, ...(icon ? { icon } : {}) }));
    await loadChats();
  } catch { /* keep the first-message title */ }
}

// ------------------------------------------------------------ attachments
const TEXT_EXT = /\.(txt|md|markdown|py|js|mjs|cjs|ts|tsx|jsx|json|html?|css|scss|less|c|h|cpp|hpp|cc|cs|java|kt|kts|go|rs|rb|php|swift|sh|bash|ps1|bat|cmd|sql|ya?ml|toml|ini|cfg|conf|xml|csv|tsv|log|lua|r|dart|vue|svelte|gradle|dockerfile|env|gitignore)$/i;
const LANG = { py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', rs: 'rust', rb: 'ruby', cs: 'csharp', kt: 'kotlin', sh: 'bash', ps1: 'powershell', yml: 'yaml', md: 'markdown', htm: 'html' };

$('#fileInput').onchange = async (e) => {
  await addFiles(e.target.files);
  e.target.value = '';
};

async function addFiles(fileList) {
  for (const file of fileList) {
    if (file.type.startsWith('image/')) {
      const url = await readFile(file, 'DataURL');
      state.attachments.push({ kind: 'image', name: file.name, data: url.split(',')[1] });
    } else if (/\.(pdf|docx|pptx)$/i.test(file.name)) {
      const form = new FormData();
      form.append('file', file);
      toast(`Reading ${file.name}…`);
      try {
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || 'Couldn’t read that file');
        state.attachments.push({ kind: 'text', name: file.name, data: body.text, lang: 'text' });
        if (body.truncated) toast(`${file.name} is long — using the first part`);
      } catch (err) { toast(`${file.name}: ${err.message}`, 'error'); }
    } else if (file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json') {
      if (file.size > 400_000) { toast(`${file.name} is too large (max ~400 KB)`, 'error'); continue; }
      const ext = file.name.split('.').pop().toLowerCase();
      state.attachments.push({ kind: 'text', name: file.name, data: await readFile(file, 'Text'), lang: LANG[ext] || ext });
    } else {
      toast(`Can't read ${file.name} — attach text/code files or images.`, 'error');
    }
  }
  renderAttachments();
  input.focus();
}

// Drag files anywhere onto the chat, or paste images with Ctrl+V.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropZone').hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropZone').hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropZone').hidden = true;
  addFiles(e.dataTransfer.files);
});
input.addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  let files = [...(cd?.files || [])];
  if (!files.length) files = [...(cd?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); }
});

function readFile(file, as) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r[`readAs${as}`](file);
  });
}

function renderAttachments() {
  $('#attachments').innerHTML = state.attachments.map((a, i) =>
    `<span class="file-chip">${ICONS.file}<span>${escapeHtml(a.name)}</span><button type="button" data-rm="${i}" title="Remove">${ICONS.x}</button></span>`).join('');
  updateComposerButtons();
}
$('#attachments').onclick = (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { state.attachments.splice(Number(rm.dataset.rm), 1); renderAttachments(); }
};

// ------------------------------------------------------------ approvals
let pendingApproval = null;

function askApproval(ev, chat, voice) {
  pendingApproval = { id: ev.id, chat };
  $('#approvalSummary').textContent = ev.summary;
  $('#approvalDiff').hidden = !ev.diff;
  $('#approvalDiff').innerHTML = ev.diff ? diffHtml(ev.diff) : '';
  $('#approval').classList.toggle('wide', !!ev.diff);
  $('#approvalAlways').checked = false;
  $('#approval').hidden = false;
  $('#approvalAllow').focus();
  if (voice && state.voice?.active) voiceApproval(ev);
  else if (voice) { speaker.reset(); speaker.say('I need your OK on screen first.'); }
}

// In voice chat, say yes or no instead of clicking: "Send a Discord message to Jake: on my way. Should I go ahead?"
const SAID_NO = /^(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|wait|hold on|not yet)\b/;
const SAID_YES = /^(yes|yeah|yea|yep|yup|sure|ok|okay|alright|go ahead|go for it|do it|send it|send|allow|confirm|please|of course|absolutely|definitely|correct|right)\b/;
async function voiceApproval(ev) {
  const id = ev.id;
  const spoken = String(ev.summary || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\n\s*/g, ' ').replace(/:\s*"/, ': "').slice(0, 260);
  speaker.reset();
  speaker.say(`${spoken} Should I go ahead?`);
  await speaker.done();
  for (let tries = 0; tries < 3 && pendingApproval?.id === id && state.voice.active; tries++) {
    if (mic.muted) return; // muted: use the buttons
    setVoiceState('listening');
    let heard = '';
    try {
      if (state.status.whisper) {
        listenChime('start');
        const blob = await mic.record({ waitMs: 8000, maxMs: 8000 });
        if (pendingApproval?.id !== id) return;
        if (!blob) continue;
        heard = await transcribe(blob);
      } else {
        heard = await browserRecognize({ lang: state.settings.language });
      }
    } catch { break; }
    if (pendingApproval?.id !== id) return;
    const said = heard.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
    setVoiceCaption(heard, 'you');
    if (SAID_NO.test(said)) { setVoiceState('thinking'); answerApproval(false); return; }
    if (SAID_YES.test(said)) { setVoiceState('thinking'); answerApproval(true); return; }
    if (said) { speaker.say('Sorry, was that a yes or a no?'); await speaker.done(); }
  }
  if (pendingApproval?.id === id) { setVoiceState('thinking', 'Waiting for your OK on screen'); }
}

function closeApproval(id) {
  if (!pendingApproval || (id && pendingApproval.id !== id)) return;
  pendingApproval = null;
  $('#approval').hidden = true;
}

async function answerApproval(allow) {
  const p = pendingApproval;
  if (!p) return;
  const always = allow && $('#approvalAlways').checked;
  if (always) p.chat.autoApprove = true;
  closeApproval(p.id);
  try { await api(`/api/approvals/${p.id}`, json('POST', { allow, always })); } catch (e) { toast(e.message, 'error'); }
}
$('#approvalAllow').onclick = () => answerApproval(true);
$('#approvalDeny').onclick = () => answerApproval(false);

// ------------------------------------------------------------ tools / timers
function handleToolEvent(ev) {
  if (['write_code', 'edit_code', 'undo_code_edit'].includes(ev.name) && state.chat.workspace?.path) setTimeout(checkProblems, 300);
  if (['write_code', 'edit_code', 'undo_code_edit'].includes(ev.name) && state.chat.workspace?.path && !ev.result?.error) {
    api('/api/workspace/open', json('POST', { path: state.chat.workspace.path })).then((info) => { state.chat.workspace = info; renderWorkspaceChip(); }).catch(() => {});
  }
  if (ev.name === 'work_on_myself' && ev.result?.open_self) state.openSelfAfter = ev.result.request || 'Go ahead and make that change to yourself.';
  if (ev.name === 'restart_athena' && ev.result?.restarting) {
    toast('Restarting so my changes take effect… the page reloads by itself.', '', { ms: 15000 });
    setTimeout(waitForRestart, 500);
  }
  if (ev.name === 'new_project' && ev.result?.workspace) {
    state.chat.workspace = ev.result.workspace;
    renderWorkspaceChip();
    toast(`📁 Working in ${ev.result.created}`);
  }
  if (['add_task', 'complete_task', 'delete_task'].includes(ev.name)) loadTasks();
  if (ev.name === 'set_timer' && ev.result?.timer_set) toast(`⏱ Timer started: ${fmtDuration(ev.result.seconds)}${ev.result.label && ev.result.label !== 'Timer' ? ` — ${ev.result.label}` : ''}`);
  if (ev.name === 'start_focus' && ev.result?.focus_started) startFocus(ev.result.minutes, ev.result.task, ev.result.break_minutes);
  if (ev.name === 'set_reminder' && ev.result?.reminder_set) toast(`🔔 Reminder set for ${ev.result.reminder_set.when}`);
  if (['set_timer', 'set_reminder'].includes(ev.name) && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function fireReminder(r) {
  const text = r.kind === 'timer' ? `${r.text && r.text !== 'Timer' ? r.text : 'Your timer'} is done!` : r.text;
  toast(`${r.kind === 'timer' ? '⏰' : '🔔'} ${text}${r.late ? ` (was due ${r.when})` : ''}`, 'alarm');
  chime();
  if ('Notification' in window && Notification.permission === 'granted') new Notification('Athena AI', { body: text, icon: 'logo.svg' });
  const name = state.settings.user_name ? `${state.settings.user_name}, ` : '';
  speaker.reset();
  speaker.say(r.kind === 'timer' ? `${name}${text}` : `${name}here's your reminder: ${text}`);
}

// Soft two-note chimes: rising = "I'm listening", falling = "got it".
let chimeCtx = null;
function listenChime(kind) {
  try {
    chimeCtx = chimeCtx || new AudioContext();
    const ctx = chimeCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = kind === 'start' ? [660, 990] : [880, 587];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.09;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch { /* no audio */ }
}

function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = [880, 1175, 1568][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.45);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* no audio */ }
}

// ------------------------------------------------------------------ tasks
async function loadTasks() {
  state.tasks = await api('/api/tasks').catch(() => []);
  renderTasks();
}

function renderTasks() {
  const open = state.tasks.filter((t) => !t.done);
  const done = state.tasks.filter((t) => t.done).sort((a, b) => (b.completed || 0) - (a.completed || 0));
  const row = (t) => `<li class="task${t.done ? ' done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.done ? 'checked' : ''} title="Mark done">
      <div class="t"><div class="title">${escapeHtml(t.title)}</div>
        <div class="meta">${[t.priority === 'high' ? '<span class="prio-high">High priority</span>' : '', t.due ? `Due ${escapeHtml(t.due)}` : '', t.notes ? escapeHtml(t.notes) : ''].filter(Boolean).join(' · ')}</div></div>
      <button data-del title="Delete">${ICONS.trash}</button></li>`;
  $('#taskList').innerHTML = open.length ? open.map(row).join('') : '<li class="muted small" style="padding:8px">Nothing to do. Nice!</li>';
  $('#doneList').innerHTML = done.map(row).join('');
  $('#doneSummary').textContent = `Completed (${done.length})`;
  const badge = $('#taskBadge');
  badge.textContent = open.length;
  badge.hidden = !open.length;
}

$('#openTasks').onclick = () => { $('#tasksDrawer').hidden = !$('#tasksDrawer').hidden; if (!$('#tasksDrawer').hidden) { loadTasks(); $('#taskTitle').focus(); } };
$('#closeTasks').onclick = () => ($('#tasksDrawer').hidden = true);
$('#taskForm').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('#taskTitle').value.trim();
  if (!title) return;
  await api('/api/tasks', json('POST', { title }));
  $('#taskTitle').value = '';
  loadTasks();
};
$('#tasksDrawer').addEventListener('click', async (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  if (e.target.matches('input[type=checkbox]')) {
    await api(`/api/tasks/${li.dataset.id}`, json('PATCH', { done: e.target.checked }));
    loadTasks();
  } else if (e.target.closest('[data-del]')) {
    await api(`/api/tasks/${li.dataset.id}`, { method: 'DELETE' });
    loadTasks();
  }
});

// ------------------------------------------------------------ dictation
let dictating = null;
$('#micBtn').onclick = async () => {
  if (dictating) { dictating.stop(); return; }
  const btn = $('#micBtn');
  const abort = new AbortController();
  try {
    btn.classList.add('recording');
    let text;
    if (state.status.whisper) {
      await mic.open();
      dictating = { stop: () => mic.finish() };
      pauseWake(true);
      const blob = await mic.record({ silenceMs: 2500, waitMs: 15000, signal: abort.signal });
      btn.classList.remove('recording');
      if (!blob) return;
      btn.style.opacity = '.5';
      text = await transcribe(blob);
    } else {
      dictating = { stop: () => abort.abort() };
      text = await browserRecognize({ signal: abort.signal });
    }
    if (text) {
      input.value = (input.value ? `${input.value.trimEnd()} ` : '') + text;
      autosize();
      input.focus();
    }
  } catch (e) {
    toast(e instanceof DOMException || !navigator.mediaDevices ? micHelp(e) : e.message, 'error', { ms: 9000 });
  } finally {
    dictating = null;
    if (!state.voice.active) pauseWake(false);
    btn.classList.remove('recording');
    btn.style.opacity = '';
    if (!state.voice.active) mic.close();
  }
};

// ------------------------------------------------------------ voice mode
const overlay = $('#voiceOverlay');

function setVoiceState(s, label) {
  overlay.dataset.state = s;
  if (s === 'thinking') state.voice.avatar?.setMood?.('neutral');
  state.voice.avatar?.setState({ listening: 'listening', transcribing: 'thinking', thinking: 'thinking', speaking: 'speaking' }[s] || 'idle');
  $('#voiceState').textContent = label || { listening: 'Listening…', transcribing: 'Got it…', thinking: 'Thinking…', speaking: 'Speaking — tap to interrupt', muted: 'Microphone muted' }[s] || s;
}
function setVoiceCaption(text, who) {
  const cap = $('#voiceCaption');
  cap.dataset.who = who;
  cap.dataset.key = '';
  cap.textContent = who === 'you' ? `“${text}”` : toSpeech(text).trim();
  cap.scrollTop = cap.scrollHeight;
}

// Runs every frame during voice chat: karaoke-style captions + "interrupt by talking".
function voiceTick() {
  if (!state.voice.active) return;
  requestAnimationFrame(voiceTick);
  const prog = speaker.progress();
  const cap = $('#voiceCaption');
  if (prog) {
    const words = prog.text.split(/\s+/).filter(Boolean);
    const k = Math.round(prog.frac * words.length);
    const key = `${prog.text}|${k}`;
    if (cap.dataset.key !== key) {
      cap.dataset.key = key;
      cap.dataset.who = 'athena';
      cap.innerHTML = words.map((w, i) => `<span class="w${i < k ? ' said' : ''}">${escapeHtml(w)}</span>`).join(' ');
    }
  }
  // Barge-in: if you start talking while she speaks, she stops and listens.
  const b = state.voice.barge;
  if (state.settings.voice_barge_in && speaker.speaking && mic.stream && !mic.muted) {
    const lvl = mic.level();
    b.hits = lvl > 0.06 ? b.hits + 1 : Math.max(0, b.hits - 1);
    if (b.hits > 14) { // ~0.25 s of clear speech
      b.hits = 0;
      speaker.stop();
      stopGenerating();
    }
  } else b.hits = 0;
}

$('#voiceBtn').onclick = () => startVoice();
$('#voiceEnd').onclick = endVoice;
$('#voiceMute').onclick = () => {
  mic.muted = !mic.muted;
  $('#voiceMute').classList.toggle('off', mic.muted);
  if (mic.muted) { state.voice.listenAbort?.abort(); setVoiceState('muted'); }
  else if (!speaker.speaking && !state.abort) setVoiceState('listening');
};
$('#avatarStage').onclick = () => {
  if (state.voice.sleeping) { state.voice.wakeUp?.(); return; }
  // Interrupt Athena and go straight back to listening.
  if (speaker.speaking || state.abort) { speaker.stop(); stopGenerating(); }
};

function showAvatar() {
  hideAvatar();
  const stage = $('#avatarStage');
  const orb = new VoiceOrb(stage);
  orb.getLevel = () => speaker.level();
  orb.getMicLevel = () => (mic.muted ? 0 : Math.min(1, mic.level() * 12));
  state.voice.avatar = orb;
}

function hideAvatar() {
  state.voice.avatar?.destroy();
  state.voice.avatar = null;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.voice.active) endVoice(); });

async function startVoice(firstCommand = '') {
  if (typeof firstCommand !== 'string') firstCommand = '';
  if (state.voice.active) return;
  if (!state.status.ollama) { toast('Ollama is not running.', 'error'); return; }
  const model = pickDefaultModel('voice');
  if (!model) { toast('Download a model first (Settings → Models).', 'error'); return; }
  warmModel(model, { quiet: true }); // start loading it while the microphone starts
  state.voice.active = true;
  state.voice.chimeNext = true;
  state.voice.barge = { hits: 0 };
  state.voice.silent = 0;
  state.voice.sleeping = false;
  pauseWake(true);
  mic.muted = false;
  $('#voiceMute').classList.remove('off');
  overlay.hidden = false;
  $('#voiceModel').textContent = `Voice chat · ${model}${state.status.whisper ? ' · Whisper (offline)' : ''}`;
  $('#voiceCaption').textContent = '';
  showAvatar();
  requestAnimationFrame(voiceTick);
  setVoiceState('listening', 'Starting microphone…');
  await voicesReady();
  try {
    if (state.status.whisper) await mic.open();
  } catch (e) {
    toast(micHelp(e), 'error', { ms: 9000 });
    endVoice();
    return;
  }
  speaker.onStart = () => state.voice.active && setVoiceState('speaking');
  speaker.onEnd = () => state.voice.active && state.abort && setVoiceState('thinking');
  if (state.settings.persona === 'companion' && !state.chat.messages.length && !firstCommand) {
    const n = state.settings.user_name ? `, ${state.settings.user_name}` : '';
    const hi = [
      `Mmm, there you are${n}. I was hoping you'd come talk to me.`,
      `Hey${n}... I missed you. So, what are we doing today?`,
      `Oh, hi${n}. I was just thinking about you.`,
    ];
    speaker.reset();
    speaker.say(hi[Math.floor(Math.random() * hi.length)]);
    state.voice.avatar?.cheer?.(1200);
    await speaker.done();
  }
  if (!state.status.whisper) toast('Offline speech recognition is not installed — using the browser recognizer (may need internet). Run install-voice for fully offline voice.');
  if (firstCommand) {
    setVoiceCaption(firstCommand, 'you');
    setVoiceState('thinking');
    await sendMessage(firstCommand, { voice: true });
    await speaker.done();
  }
  voiceLoop();
}

function endVoice() {
  state.voice.active = false;
  state.voice.wakeUp?.();
  state.voice.listenAbort?.abort();
  speaker.stop();
  speaker.onStart = speaker.onEnd = null;
  stopGenerating();
  mic.close();
  hideAvatar();
  overlay.hidden = true;
  pauseWake(false);
}

async function voiceLoop() {
  while (state.voice.active) {
    if (mic.muted) { await sleep(200); continue; }
    setVoiceState('listening');
    const abort = new AbortController();
    state.voice.listenAbort = abort;
    let text = '';
    try {
      if (state.status.whisper) {
        if (state.voice.chimeNext !== false) listenChime('start');
        const blob = await mic.record({ signal: abort.signal });
        state.voice.chimeNext = !!blob; // no chime again after a silent timeout
        state.voice.silent = blob || abort.signal.aborted ? 0 : state.voice.silent + 1;
        if (!blob && state.voice.silent >= 3 && state.settings.voice_sleep && state.voice.active) { await voiceDoze(); continue; }
        if (!blob || !state.voice.active) continue;
        listenChime('end');
        setVoiceState('transcribing');
        text = await transcribe(blob);
      } else {
        text = await browserRecognize({ signal: abort.signal, lang: state.settings.language });
      }
    } catch (e) {
      toast(e.message, 'error');
      await sleep(1500);
      continue;
    }
    if (!state.voice.active) break;
    text = text.trim();
    if (!text || /^[\s.,!?]*$/.test(text)) continue;
    if (/^(stop|goodbye|bye|end (the )?(voice )?chat)[.!]?$/i.test(text)) { speaker.reset(); speaker.say('Talk soon!'); await speaker.done(); endVoice(); break; }
    const handled = await voiceCommand(text);
    if (handled === 'end') break;
    if (handled) { await speaker.done(); await sleep(250); continue; }

    setVoiceCaption(text, 'you');
    setVoiceState('thinking');
    await sendMessage(text, { voice: true });
    await speaker.done();
    await sleep(250); // avoid picking up the tail of Athena's own voice
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Things you can say in voice chat that happen instantly, without asking the model.
const LANG_NAMES = { english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl', polish: 'pl',
  russian: 'ru', ukrainian: 'uk', turkish: 'tr', arabic: 'ar', hindi: 'hi', japanese: 'ja', korean: 'ko', chinese: 'zh', mandarin: 'zh', vietnamese: 'vi', filipino: 'tl', tagalog: 'tl' };
const VOICE_COMMANDS = [
  [/^(repeat( that)?|say (that|it) again|what did you (just )?say)$/, () => {
    const last = [...state.chat.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    speaker.reset(); speaker.say(last ? splitThinking(last).content : "I haven't said anything yet.");
  }],
  [/^(talk|speak|go) (a (little |bit )?)?(slower|more slowly)$|^slow down$/, () => nudgeRate(-0.15, 'Okay, I\'ll slow down.')],
  [/^(talk|speak|go) (a (little |bit )?)?faster$|^speed up$/, () => nudgeRate(0.15, 'Okay, a bit faster.')],
  [/^(new chat|start over|fresh start|clear (the )?chat)$/, () => { newChat(); speaker.reset(); speaker.say('Fresh start. What\'s up?'); }],
  [/^(switch to |go to )?(code|study|assistant) mode$/, async (m) => { const mode = m[2]; await switchMode(mode); speaker.reset(); speaker.say(`${mode[0].toUpperCase() + mode.slice(1)} mode.`); }],
  [/^(go to sleep|take a (break|nap)|pause|sleep)$/, async () => { speaker.reset(); speaker.say('Okay. Tap me when you need me.'); await speaker.done(); await voiceDoze(); }],
  [/^(never ?mind|cancel( that)?|forget it)$/, () => { speaker.reset(); speaker.say('No problem.'); }],
  [/^(save|star) (that|this|it)$/, () => {
    const btn = $$('.msg.assistant [data-msg-act="star"]').at(-1);
    if (btn && !btn.classList.contains('starred')) btn.click();
    speaker.reset(); speaker.say(btn ? 'Saved.' : 'There\'s nothing to save yet.');
  }],
  [/^copy (that|this|it)$/, async () => {
    const last = [...state.chat.messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (last) await copyText(splitThinking(last).content).catch(() => {});
    speaker.reset(); speaker.say(last ? 'Copied.' : 'Nothing to copy yet.');
  }],
  [/^(open|show) (the )?canvas$/, () => { openCanvas(); speaker.reset(); speaker.say('Canvas is open.'); }],
  [/^(speak|talk( to me)?|reply|answer|switch)( in| to)? ([a-z]+)$/, async (m) => {
    const code = LANG_NAMES[m[4]];
    if (!code) return false;
    await saveSettings({ language: code });
    speaker.badLangs?.delete(code);
    speaker.reset();
    speaker.say({ en: 'Okay, English it is.', es: 'Claro, hablemos en español.', fr: 'D\'accord, parlons français.', de: 'Alles klar, sprechen wir Deutsch.',
      it: 'Certo, parliamo italiano.', pt: 'Claro, vamos falar português.', ja: 'はい、日本語で話しましょう。', zh: '好的，我们说中文吧。', hi: 'ठीक है, हिंदी में बात करते हैं।' }[code] || 'Okay.');
  }],
];

async function voiceCommand(text) {
  const t = text.toLowerCase().replace(/^(hey |ok(ay)? )?athena[,!.]?\s*/, '').replace(/^(please|can you|could you)\s+/, '').replace(/[\s.!?,]+$/g, '').replace(/\s+please$/, '').trim();
  for (const [re, fn] of VOICE_COMMANDS) {
    const m = t.match(re);
    if (m && (await fn(m)) !== false) {
      setVoiceCaption(text, 'you');
      return true;
    }
  }
  return false;
}

function nudgeRate(delta, reply) {
  const rate = Math.round(Math.min(1.6, Math.max(0.6, (Number(state.settings.tts_rate) || 1) + delta)) * 100) / 100;
  saveSettings({ tts_rate: rate });
  speaker.reset();
  speaker.say(reply);
}

// After a minute of silence the orb dims and waits; tap it or say "Hey Athena" to continue.
async function voiceDoze() {
  state.voice.sleeping = true;
  setVoiceState('sleeping', state.settings.wake_enabled ? 'Dozing — tap the orb or say “Hey Athena”' : 'Dozing — tap the orb to wake me');
  pauseWake(false);
  await new Promise((resolve) => { state.voice.wakeUp = resolve; });
  state.voice.wakeUp = null;
  state.voice.sleeping = false;
  state.voice.silent = 0;
  state.voice.chimeNext = true;
  if (state.voice.active) pauseWake(true);
}

// ------------------------------------------------------------ settings
const dlg = $('#settings');

function openSettings(tab = 'general') {
  const s = state.settings;
  $('#setName').value = s.user_name || '';
  $('#setInstructions').value = s.custom_instructions || '';
  $('#setTheme').value = s.theme || 'dark';
  $('#setTools').checked = !!s.tools_enabled;
  $('#setMemory').checked = !!s.memory_enabled;
  $('#setFiles').checked = !!s.files_enabled;
  $('#setWeb').checked = !!s.web_enabled;
  $('#setConfirm').checked = s.confirm_changes !== false;
  $('#setScreen').checked = !!s.show_on_screen;
  $('#setFolders').value = (s.file_folders || []).join('\n');
  api('/api/folders').then((f) => { $('#setFolders').placeholder = f.defaults.join('\n'); }).catch(() => {});
  loadMemories();
  $('#setAutoLearn').checked = s.auto_learn !== false;
  $('#setThinkLevel').value = s.think_level || 'normal';
  $('#setDirect').checked = !!s.direct_mode;
  $('#setReplyLength').value = s.reply_length || 'normal';
  $('#setAnswerStyle').value = s.answer_style || 'classic';
  $('#setShooting').checked = s.shooting_stars !== false;
  $('#setAutoPreview').checked = s.auto_preview !== false;
  $('#setKeepAlive').value = s.keep_alive || '30m';
  $('#setContextSize').value = String(s.context_size || 16384);
  $('#setAutoRoute').checked = s.auto_route !== false;
  $('#setPreload').checked = s.preload_model !== false;
  $('#setAlerts').checked = s.alerts_enabled !== false;
  $('#setAlertsSpeak').checked = s.alerts_speak !== false;
  $$('[data-alert]').forEach((el) => { el.checked = s[`alert_${el.dataset.alert}`] !== false; });
  $('#setSeasonal').checked = s.seasonal_effects !== false;
  fillPersonas();
  loadCustomVoice(); // so each personality's voice list includes your custom voices
  renderAccents();
  $('#setTextSize').value = s.text_size || 'normal';
  $('#setCompact').checked = !!s.compact;
  $('#setReduceMotion').checked = !!s.reduce_motion;
  $('#setOffline').checked = !!s.offline_mode;
  $('#setEmotions').checked = s.emotion_tracking !== false;
  $('#setAdaptiveVoice').checked = s.adaptive_voice !== false;
  $('#setAutoTasks').checked = s.auto_tasks !== false;
  $('#setImagesEnabled').checked = s.images_enabled !== false;
  $('#setGithubPrivate').checked = s.github_private !== false;
  $('#setAutoRecover').checked = s.auto_recover !== false;
  $('#setAutoBackup').checked = s.auto_backup !== false;
  $('#setUpdateCheck').checked = s.update_check !== false;
  $('#setOllamaBoost').checked = s.ollama_boost !== false;
  $('#setSounds').checked = !!s.sound_effects;
  $('#setBirthday').value = s.birthday ? `${new Date().getFullYear()}-${s.birthday}` : '';
  fillDataSettings();
  if (state.status.engine) fillEngine(state.status.engine);
  $('#setBargeIn').checked = s.voice_barge_in !== false;
  $('#setVoiceSleep').checked = s.voice_sleep !== false;
  $('#setPc').checked = !!s.pc_enabled;
  $('#setScreen2').checked = !!s.screen_enabled;
  $('#setCode').checked = !!s.code_enabled;
  $('#setDocs').checked = !!s.docs_enabled;
  $('#setKnowledge').value = (s.knowledge_folders || []).join('\n');
  $('#setEmbed').value = s.embed_model || 'nomic-embed-text';
  $('#setCity').value = s.home_location || '';
  $('#setUnits').value = s.units || 'imperial';
  $('#setBriefing').value = s.briefing_time || '';
  $('#setImageApi').value = s.image_api || '';
  $('#setHaUrl').value = s.ha_url || '';
  $('#setHaToken').value = '';
  $('#setHaToken').placeholder = s.ha_token_set ? 'Saved — type to replace' : 'Paste your long-lived access token';
  $('#setHotkey').value = s.hotkey || '';
  $('#setVoiceHotkey').value = s.voice_hotkey || '';
  $('#setWake').checked = !!s.wake_enabled;
  $('#setAutoLock').value = String(s.auto_lock_minutes || 0);
  refreshKnowledge();
  refreshWake();
  refreshDesktop();
  refreshPin();
  $('#setTtsEngine').value = ['system', 'custom'].includes(s.tts_engine) ? s.tts_engine : 'auto';
  $('#setPitch').value = s.voice_pitch || 1;
  $('#setKokoroVoice').innerHTML = Object.entries(state.status.kokoro_voices || { athena_silk: 'Athena Silk' })
    .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join('');
  $('#setKokoroVoice').value = s.kokoro_voice || 'athena_silk';
  $('#kokoroStatus').textContent = state.status.kokoro
    ? '✓ Natural voice is installed.'
    : '✗ Natural voice not installed yet — run install-voice.bat (Windows) or ./install-voice.sh, then restart Athena. Using system voices until then.';
  $('#setRate').value = s.tts_rate || 1;
  $('#setAutoSpeak').checked = !!s.auto_speak;
  $('#setWhisper').value = s.whisper_model || 'base.en';
  $('#setLanguage').value = s.language || 'en';
  $('#setWhisperDevice').value = s.whisper_device || 'cpu';
  $('#whisperStatus').textContent = state.status.whisper
    ? '✓ Offline speech recognition (faster-whisper) is installed.'
    : '✗ Offline speech recognition is not installed. Run install-voice.bat (Windows) or ./install-voice.sh, then restart Athena.';
  fillModelSelects();
  fillVoices();
  switchTab(tab);
  dlg.showModal();
}
$('#openSettings').onclick = () => openSettings();

function renderAccents() {
  const current = state.settings.accent || 'gold';
  $('#accentPicker').innerHTML = Object.entries(ACCENTS).map(([id, a]) =>
    `<button type="button" class="swatch${id === current ? ' active' : ''}" data-accent="${id}" title="${a.name}"><span style="background:linear-gradient(135deg, ${a.logo[0]}, ${a.logo[1]})"></span>${a.name}</button>`).join('');
}
$('#accentPicker').onclick = async (e) => {
  const id = e.target.closest('[data-accent]')?.dataset.accent;
  if (!id) return;
  state.settings.accent = id;
  applyTheme();
  renderAccents();
  await saveSettings({ accent: id });
};

async function loadStats() {
  const st = await api('/api/stats').catch(() => null);
  if (!st) return;
  const tiles = [
    [st.chats, 'chats'], [st.chats_this_week, 'new this week'], [st.messages_sent, 'messages sent'],
    [st.voice_replies, 'voice replies'], [st.tasks_done, 'tasks done'], [st.tasks_open, 'tasks open'],
    [st.memories, 'memories'], [st.reminders_pending, 'upcoming reminders'],
  ];
  if (st.busiest_day) tiles.push([st.busiest_day, 'busiest day']);
  if (st.first_chat) tiles.push([new Date(st.first_chat * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), 'first chat']);
  $('#statGrid').innerHTML = tiles.map(([n, label]) => `<div class="stat"><b${typeof n === 'number' ? '' : ' class="text"'}>${escapeHtml(String(n ?? 0))}</b><span>${label}</span></div>`).join('');
  $('#statModels').innerHTML = st.top_models.length
    ? st.top_models.map(([m, n]) => `<li><span>${escapeHtml(m)}</span><span class="muted small">${n} replies</span></li>`).join('')
    : '<li class="muted small">No replies yet.</li>';
}

function switchTab(tab) {
  if (tab === 'stats') loadStats();
  if (tab === 'jarvis') loadJarvis();
  if (tab === 'about') { loadMemories(); loadGrowth(); }
  if (tab === 'privacy') loadBackups();
  if (tab === 'integrations') { findImageGenerator(); loadGithub(); }
  if (tab === 'desktop') loadPhone();
  if (tab === 'voice') { loadMics(); loadCustomVoice(); }
  $$('.tabs button', dlg).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-panel]', dlg).forEach((p) => (p.hidden = p.dataset.panel !== tab));
}
$('.tabs', dlg).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); };

// One click: pick the best installed model for each job, based on this PC's graphics card and memory.
$('#bestModels').onclick = async () => {
  const note = $('#bestModelsNote');
  note.textContent = 'Checking your PC…';
  try {
    const hw = await api('/api/system');
    const installed = new Set(modelNames().flatMap((n) => [n, n.replace(/:latest$/, '')]));
    const models = { ...(state.settings.models || {}) };
    const missing = [];
    for (const [role, name] of Object.entries(hw.picks || {})) {
      if (installed.has(name)) models[role] = name; else missing.push(name);
    }
    await saveSettings({ models });
    fillModelSelects();
    const gpu = hw.gpus?.[0];
    note.innerHTML = `${gpu ? `${escapeHtml(gpu.name)} (${gpu.vram_gb} GB) + ${hw.ram_gb} GB RAM` : `${hw.ram_gb} GB RAM`}: set the best models you have.` +
      ([...new Set(missing)].length ? ` Not downloaded yet: ${[...new Set(missing)].map((m) => `<code>${escapeHtml(m)}</code>`).join(', ')}. Download them below, then press this again.` : ' ✓');
    if (state.chat && !state.chat.messages.length) { state.chat.model = ''; renderModelButton(); }
  } catch (e) { note.textContent = e.message; }
};

function fillModelSelects() {
  for (const [id, mode] of [['#setModelAssistant', 'assistant'], ['#setModelCode', 'code'], ['#setModelVoice', 'voice'], ['#setModelStudy', 'study'], ['#setModelVision', 'vision']]) {
    const sel = $(id);
    const auto = mode === 'vision' ? pickVisionModel() : pickDefaultModel(mode);
    sel.innerHTML = `<option value="">Automatic${auto ? ` (${escapeHtml(auto)})` : ''}</option>` +
      state.models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
    sel.value = modelNames().includes(state.settings.models?.[mode]) ? state.settings.models[mode] : '';
  }
  const saved = state.settings.self_model;
  const autoSelf = selfModel({ automatic: true });
  $('#setSelfModel').innerHTML = `<option value="">Automatic${autoSelf ? ` (${escapeHtml(autoSelf)})` : ' (the model that\'s loaded)'}</option>` +
    state.models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
  $('#setSelfModel').value = modelNames().includes(saved) ? saved : '';
  const have = new Set(modelNames().flatMap((n) => [n, n.replace(/:latest$/, '')]));
  $('#recommend').innerHTML = RECOMMENDED.map((r) => `
    <div class="rec${have.has(r.name) ? ' have' : ''}">
      <div class="info"><div class="name">${r.name}<span class="tag">${r.role}</span></div><div class="desc">${r.desc}</div></div>
      <button type="button" class="ghost" data-pull="${r.name}">${have.has(r.name) ? 'Installed' : 'Download'}</button>
    </div>`).join('');
  $('#installed').innerHTML = state.models.length
    ? state.models.map((m) => `<li><span class="name">${escapeHtml(m.name)}</span><span class="muted small">${fmtSize(m.size)}</span><button type="button" data-rm-model="${escapeHtml(m.name)}" title="Delete model">${ICONS.trash}</button></li>`).join('')
    : '<li class="muted small">None yet</li>';
}

$('#setEngine').addEventListener('change', async (e) => {
  const mode = e.target.value;
  try {
    const r = await api('/api/engine', json('POST', { engine: mode }));
    state.status.engine = r;
    toast(mode === 'builtin' ? 'Switching to Athena’s own engine…' : 'Using Ollama.');
    await refreshStatus(); await refreshModels(); fillModelSelects();
  } catch (err) { toast(err.message, 'error'); }
});
$('#setBrain').addEventListener('change', async (e) => {
  try {
    await api('/api/engine', json('POST', { engine: 'builtin', brain: e.target.value }));
    toast('Switching brains. A new brain downloads once; the old one stays until you free the space.');
    refreshStatus();
  } catch (err) { toast(err.message, 'error'); }
});
$('#engineBox').addEventListener('click', async (e) => {
  if (e.target.id !== 'brainUpgradeBtn') return;
  try { await api('/api/engine/upgrade', json('POST', {})); toast('Upgrading her brain. It downloads once, then she switches by herself.'); refreshStatus(); }
  catch (err) { toast(err.message, 'error'); }
});
$('#engineCleanup').addEventListener('click', async () => {
  const r = await api('/api/engine/cleanup', json('POST', {})).catch((e) => ({ error: e.message }));
  toast(r.error || (r.freed_gb ? `Freed ${r.freed_gb} GB` : 'Nothing to free'));
});

async function loadGrowth() {
  const g = await api('/api/growth').catch(() => null);
  if (!g) return;
  const lib = g.library;
  $('#growthInfo').innerHTML = lib.entries
    ? `📚 Her library: <b>${lib.entries}</b> thing${lib.entries === 1 ? '' : 's'} she's found out since ${escapeHtml(lib.since)} (${lib.size_kb} KB).`
    : '📚 Her library is empty so far. It fills up as she looks things up for you.';
  $('#reflectionList').innerHTML = g.reflections.map((r) => `<li><span><b>${escapeHtml(r.date)}</b> ${escapeHtml(r.summary || '')}${
    r.lessons?.length ? `<br><span class="muted small">Learned: ${r.lessons.map(escapeHtml).join(' · ')}</span>` : ''}</span></li>`).join('');
}
$('#reflectNow').addEventListener('click', async () => {
  const btn = $('#reflectNow');
  btn.disabled = true; btn.textContent = 'Reflecting…';
  try {
    const r = await api('/api/growth/reflect', json('POST', {}));
    toast(r.lessons?.length ? `Learned ${r.lessons.length} lesson${r.lessons.length === 1 ? '' : 's'} from today` : (r.summary || r.note || 'Nothing new to learn today'));
    loadMemories(); loadGrowth();
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Reflect on today now';
});
$('#libraryClear').addEventListener('click', async () => {
  if (!confirm('Clear everything in her library? Memories and lessons are kept.')) return;
  await api('/api/library', { method: 'DELETE' }).catch(() => {});
  toast('Her library is cleared'); loadGrowth();
});

function fillVoices() {
  const voices = listVoices();
  const sel = $('#setVoice');
  sel.innerHTML = '<option value="">Automatic (best offline voice)</option>' +
    voices.map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} — ${v.lang}${v.localService ? ' · offline' : ' · online'}</option>`).join('');
  sel.value = state.settings.tts_voice || '';
}

async function saveSettings(patch) {
  try {
    state.settings = await api('/api/settings', json('PUT', patch));
    applyTheme();
  } catch (e) { toast(e.message, 'error'); }
}

// Any settings control with data-setting="key" loads and saves by itself: adding a setting (or a whole Settings
// section) only needs HTML in index.html. Keys Athena adds to herself start with custom_ (e.g. data-setting="custom_team").
function fillDataSettings() {
  $$('[data-setting]', dlg).forEach((el) => {
    const v = state.settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = v === undefined ? el.hasAttribute('data-default-on') : !!v;
    else if (el.type === 'radio') el.checked = String(v) === el.value;
    else if (v !== undefined && v !== null) el.value = Array.isArray(v) ? v.join('\n') : String(v);
  });
}
dlg.addEventListener('change', (e) => {
  const el = e.target.closest?.('[data-setting]');
  if (!el) return;
  const value = el.type === 'checkbox' ? el.checked
    : (el.type === 'number' || el.type === 'range') ? (el.value === '' ? null : Number(el.value))
    : el.value;
  saveSettings({ [el.dataset.setting]: value });
});

const bind = (id, key, get = (el) => el.value) => $(id).addEventListener('change', (e) => saveSettings({ [key]: get(e.target) }));
bind('#setName', 'user_name');
bind('#setInstructions', 'custom_instructions');
bind('#setTheme', 'theme');
bind('#setTools', 'tools_enabled', (el) => el.checked);
bind('#setDirect', 'direct_mode', (el) => el.checked);
bind('#setReplyLength', 'reply_length');
bind('#setAnswerStyle', 'answer_style');
bind('#setAutoLearn', 'auto_learn', (el) => el.checked);
bind('#setThinkLevel', 'think_level');
$('#setThinkLevel').addEventListener('change', () => setTimeout(renderThinkBtn, 300));
bind('#setShooting', 'shooting_stars', (el) => el.checked);
bind('#setAutoPreview', 'auto_preview', (el) => el.checked);
bind('#setKeepAlive', 'keep_alive');
bind('#setContextSize', 'context_size', (el) => Number(el.value));
$('#setAutoRoute').addEventListener('change', async (e) => { await saveSettings({ auto_route: e.target.checked }); renderModelButton(); });
bind('#setPreload', 'preload_model', (el) => el.checked);
bind('#setSeasonal', 'seasonal_effects', (el) => el.checked);
bind('#setMemory', 'memory_enabled', (el) => el.checked);
bind('#setFiles', 'files_enabled', (el) => el.checked);
bind('#setWeb', 'web_enabled', (el) => el.checked);
bind('#setConfirm', 'confirm_changes', (el) => el.checked);
bind('#setScreen', 'show_on_screen', (el) => el.checked);
bind('#setPc', 'pc_enabled', (el) => el.checked);
bind('#setTextSize', 'text_size');
bind('#setCompact', 'compact', (el) => el.checked);
bind('#setReduceMotion', 'reduce_motion', (el) => el.checked);
$('#setOffline').addEventListener('change', async (e) => { await saveSettings({ offline_mode: e.target.checked }); refreshStatus(); toast(e.target.checked ? '✈️ Offline mode on: nothing reaches the internet.' : 'Offline mode off.'); });
bind('#setImagesEnabled', 'images_enabled', (el) => el.checked);
bind('#setGithubPrivate', 'github_private', (el) => el.checked);
bind('#setImageModel', 'image_model');
bind('#setAutoRecover', 'auto_recover', (el) => el.checked);
bind('#setAutoBackup', 'auto_backup', (el) => el.checked);
bind('#setUpdateCheck', 'update_check', (el) => el.checked);
bind('#setOllamaBoost', 'ollama_boost', (el) => el.checked);
bind('#setSounds', 'sound_effects', (el) => el.checked);
bind('#setBirthday', 'birthday', (el) => el.value.slice(5));
bind('#setBargeIn', 'voice_barge_in', (el) => el.checked);
bind('#setVoiceSleep', 'voice_sleep', (el) => el.checked);
$('#setLanguage').addEventListener('change', async (e) => {
  const lang = e.target.value;
  await saveSettings({ language: lang });
  const status = $('#languageStatus');
  const kokoroLangs = ['en', 'auto', 'es', 'fr', 'it', 'pt', 'hi', 'ja', 'zh'];
  status.textContent = kokoroLangs.includes(lang) ? '' : 'Her natural voice doesn\'t speak this language, so a Windows voice is used. Add more under Windows Settings → Time & language → Speech.';
  if (lang !== 'en' && state.status.whisper) {
    status.textContent = `Getting speech recognition ready for this language (one-time download)… ${status.textContent}`;
    try {
      await api('/api/speech/prepare', json('POST', { language: lang }));
      status.textContent = status.textContent.replace(/^Getting[^…]*…\s*/, '✓ Ready. ');
    } catch (err) { status.textContent = err.message; }
  }
});
bind('#setScreen2', 'screen_enabled', (el) => el.checked);
bind('#setCode', 'code_enabled', (el) => el.checked);
bind('#setDocs', 'docs_enabled', (el) => el.checked);
bind('#setKnowledge', 'knowledge_folders', (el) => el.value.split('\n').map((l) => l.trim()).filter(Boolean));
bind('#setEmbed', 'embed_model');
bind('#setCity', 'home_location');
bind('#setUnits', 'units');
bind('#setBriefing', 'briefing_time');
bind('#setImageApi', 'image_api', (el) => el.value.trim());
bind('#setHaUrl', 'ha_url', (el) => el.value.trim());
bind('#setHaToken', 'ha_token', (el) => el.value.trim());
bind('#setHotkey', 'hotkey', (el) => el.value.trim());
bind('#setVoiceHotkey', 'voice_hotkey', (el) => el.value.trim());
bind('#setAutoLock', 'auto_lock_minutes', (el) => Number(el.value));
$('#setWake').addEventListener('change', async (e) => { await saveSettings({ wake_enabled: e.target.checked }); setTimeout(refreshWake, 1500); });
bind('#setFolders', 'file_folders', (el) => el.value.split('\n').map((l) => l.trim()).filter(Boolean));

const SOURCE_LABEL = { '👍': '👍', '👎': '👎', correction: 'from a correction', you: 'added by you' };
async function loadMoods() {
  const r = await api('/api/moods').catch(() => ({ days: [], count: 0 }));
  $('#moodCount').textContent = r.count ? `(last 2 weeks)` : '';
  $('#moodDays').innerHTML = r.days.length ? r.days.slice().reverse().map((d) => `<li><b>${escapeHtml(d.day)}</b> <span class="mood-main">${d.emoji} ${escapeHtml(d.main)}</span>
      <span class="muted small">${Object.entries(d.counts).map(([m, n]) => `${escapeHtml(m)} ×${n}`).join(' · ')}</span></li>`).join('')
    : '<li class="muted small">Nothing yet. As you chat, the days you seemed happy, stressed, tired and so on show up here.</li>';
}
$('#moodClear').onclick = async () => { if (!confirm('Clear your mood history?')) return; await api('/api/moods', { method: 'DELETE' }); loadMoods(); toast('Mood history cleared'); };
bind('#setEmotions', 'emotion_tracking', (el) => el.checked);
bind('#setAdaptiveVoice', 'adaptive_voice', (el) => el.checked);
bind('#setAutoTasks', 'auto_tasks', (el) => el.checked);

async function loadMemories() {
  loadMoods();
  const [mems, lessons] = await Promise.all([api('/api/memories').catch(() => []), api('/api/lessons').catch(() => [])]);
  const row = (kind, item, extra = '') => `<li data-kind="${kind}" data-id="${item.id}"><span contenteditable="plaintext-only" spellcheck="false">${escapeHtml(item.text)}</span>${extra}<button type="button" data-forget title="Forget">${ICONS.trash}</button></li>`;
  $('#memoryList').innerHTML = mems.length
    ? mems.slice().reverse().map((m) => row('memories', m)).join('')
    : '<li class="muted small">Nothing yet. Chat about yourself (school, hobbies, projects…) or say “remember that…” and it shows up here.</li>';
  $('#lessonList').innerHTML = lessons.length
    ? lessons.slice().reverse().map((l) => row('lessons', l, `<span class="src">${escapeHtml(SOURCE_LABEL[l.source] || '')}${
      l.for ? ` · ${escapeHtml(personaName(l.for))} only` : ''}</span>`)).join('')
    : '<li class="muted small">Nothing yet. Rate replies with 👍 / 👎 under each answer and she learns how you like them.</li>';
  $('#memoryCount').textContent = mems.length ? `(${mems.length})` : '';
  $('#lessonCount').textContent = lessons.length ? `(${lessons.length})` : '';
}
for (const id of ['#memoryList', '#lessonList']) {
  const list = $(id);
  list.onclick = async (e) => {
    const b = e.target.closest('[data-forget]');
    if (!b) return;
    const li = b.closest('li');
    await api(`/api/${li.dataset.kind}/${li.dataset.id}`, { method: 'DELETE' });
    loadMemories();
  };
  list.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  list.addEventListener('focusout', async (e) => {
    if (!e.target.isContentEditable) return;
    const li = e.target.closest('li');
    const text = e.target.textContent.trim();
    if (!text) { await api(`/api/${li.dataset.kind}/${li.dataset.id}`, { method: 'DELETE' }); loadMemories(); return; }
    await api(`/api/${li.dataset.kind}/${li.dataset.id}`, json('PUT', { text })).catch(() => {});
  });
}
for (const [form, input, path] of [['#memoryAdd', '#memoryNew', 'memories'], ['#lessonAdd', '#lessonNew', 'lessons']]) {
  const add = async () => {
    const text = $(input).value.trim();
    if (!text) return;
    try { await api(`/api/${path}`, json('POST', { text })); $(input).value = ''; loadMemories(); } catch (err) { toast(err.message, 'error'); }
  };
  $(`${form} button`).onclick = add;
  $(input).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
}
$('#forgetAll').onclick = async () => {
  if (!confirm('Forget everything Athena has learned about you (memories and lessons)? This can\'t be undone.')) return;
  await api('/api/learning/forget-all', { method: 'POST' });
  loadMemories();
  toast('Done. She starts fresh.');
};
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-goto-tab]');
  if (a) { e.preventDefault(); switchTab(a.dataset.gotoTab); }
});
bind('#setVoice', 'tts_voice');
bind('#setPersona', 'persona');
bind('#setTtsEngine', 'tts_engine');
bind('#setKokoroVoice', 'kokoro_voice');
bind('#setSelfModel', 'self_model');
bind('#setPitch', 'voice_pitch', (el) => Number(el.value));

for (const [id, mode] of [['#setModelAssistant', 'assistant'], ['#setModelCode', 'code'], ['#setModelVoice', 'voice'], ['#setModelStudy', 'study'], ['#setModelVision', 'vision']]) {
  $(id).addEventListener('change', async (e) => {
    await saveSettings({ models: { [mode]: e.target.value } });
    if (state.chat && !state.chat.messages.length && state.mode === mode) { state.chat.model = ''; renderModelButton(); }
    fillModelSelects();
  });
}
$('#testVoice').onclick = () => {
  speaker.stop();
  speaker.reset();
  const name = state.settings.user_name ? ` ${state.settings.user_name}` : '';
  speaker.say(state.settings.persona === 'companion'
    ? `Hey${name}! It's me, Athena. So, what are we doing today?`
    : `Hi${name}, I'm Athena. How can I help you today?`);
};

dlg.addEventListener('click', async (e) => {
  if (e.target === dlg) dlg.close();
  const pull = e.target.closest('[data-pull]');
  if (pull) pullModel(pull.dataset.pull);
  const rm = e.target.closest('[data-rm-model]');
  if (rm && confirm(`Delete ${rm.dataset.rmModel} from this PC?`)) {
    try {
      await api(`/api/models/${encodeURIComponent(rm.dataset.rmModel)}`, { method: 'DELETE' });
      await refreshModels();
      fillModelSelects();
    } catch (err) { toast(err.message, 'error'); }
  }
});
$('#pullBtn').onclick = () => { const n = $('#pullName').value.trim(); if (n) pullModel(n); };
$('#pullName').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#pullBtn').click(); } };

let pulling = false;

/** Download a model through Ollama, reporting progress as (fraction 0..1 or null, text). */
async function downloadModel(name, onProgress = () => {}) {
  const res = await fetch('/api/models/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', failed = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.error) { failed = ev.error; continue; }
      if (ev.total && ev.completed != null) onProgress(ev.completed / ev.total, `${Math.round((ev.completed / ev.total) * 100)}% of ${fmtSize(ev.total)}`);
      else onProgress(null, ev.status);
    }
  }
  if (failed) throw new Error(failed);
}

async function pullModel(name) {
  if (pulling) { toast('A download is already running.'); return; }
  pulling = true;
  const box = $('#pullProgress'), bar = $('.bar', box), label = $('span', box);
  box.hidden = false;
  bar.style.width = '0';
  label.textContent = `Starting ${name}…`;
  $('#pullBtn').disabled = true;
  try {
    await downloadModel(name, (frac, text) => {
      if (frac != null) bar.style.width = `${frac * 100}%`;
      label.textContent = `${name}: ${text}`;
    });
    label.textContent = `✓ ${name} installed`;
    bar.style.width = '100%';
    toast(`${name} is ready to use`);
    await refreshModels();
    fillModelSelects();
    if (state.chat && !state.chat.messages.length) { state.chat.model = ''; renderModelButton(); renderMessages(); }
  } catch (e) {
    label.textContent = `Failed: ${e.message}`;
    toast(`Download failed: ${e.message}`, 'error');
  } finally {
    pulling = false;
    $('#pullBtn').disabled = false;
  }
}

// ------------------------------------------------------------ keyboard
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); toggleSidebar(true); $('#searchChats').focus(); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); startVoice(); }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.key === '?' && !typing) || (mod && e.key === '/')) { e.preventDefault(); $('#shortcutsDlg').showModal(); }
  if (e.key === 'Escape' && state.abort && !state.voice.active) stopGenerating();
});

// ------------------------------------------------------------ vision
const VISION_HINTS = ['qwen3-vl', 'qwen2.5vl', 'qwen2.5-vl', 'llava', 'minicpm-v', 'llama3.2-vision', 'moondream', 'granite3.2-vision', 'mistral-small3', 'gemma3:4b', 'gemma3:12b', 'gemma3:27b', 'gemma3n', 'llama4'];
const isVision = (name) => VISION_HINTS.some((h) => (name || '').includes(h));
function pickVisionModel() {
  const chosen = state.settings.models?.vision;
  if (chosen && modelNames().includes(chosen)) return chosen;
  const names = modelNames();
  for (const hint of VISION_HINTS) { const hit = names.find((n) => n.includes(hint)); if (hit) return hit; } // best kind first
  return '';
}

// ------------------------------------------------------------ screenshot
$('#shotBtn').onclick = async () => {
  toast('📸 Taking a screenshot in 3 seconds — switch to what you want Athena to see');
  await sleep(3000);
  try {
    const { image } = await api('/api/screenshot');
    state.attachments.push({ kind: 'image', name: 'Screenshot.jpg', data: image });
    renderAttachments();
    if (!input.value.trim()) input.value = "What's on my screen?";
    autosize();
    input.focus();
    toast('Screenshot attached');
  } catch (e) { toast(e.message, 'error'); }
};

// ------------------------------------------------------------ run code
async function runCodeBlock(btn) {
  const block = btn.closest('.code-block');
  const codeEl = block.querySelector('code');
  const code = codeEl.innerText;
  const language = codeEl.dataset.lang || 'python';
  let out = block.querySelector('.run-output');
  if (!out) { out = document.createElement('pre'); out.className = 'run-output'; block.append(out); }
  block.querySelector('.run-images')?.remove();
  out.textContent = 'Running…';
  btn.disabled = true;
  try {
    const r = await api('/api/run', json('POST', { code, language }));
    out.innerHTML = runOutputHtml(r);
    if (r.images?.length) block.insertAdjacentHTML('beforeend', runImagesHtml(r.images));
  } catch (e) { out.innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`; }
  btn.disabled = false;
}

function runOutputHtml(r) {
  if (r.opened_window) return `<span class="tip">🪟 ${escapeHtml(r.message || 'Opened in its own window on your PC.')}</span>`;
  const body = r.timed_out
    ? `<span class="err">Stopped after ${r.seconds}s (time limit)</span>\n${escapeHtml(r.stdout || '')}`
    : `${escapeHtml(r.stdout || '')}${r.stderr ? `<span class="err">${escapeHtml(r.stderr)}</span>` : ''}`;
  const tip = r.tip ? `\n<span class="tip">💡 ${escapeHtml(r.tip)}</span>` : '';
  return (body.trim() ? body : r.images?.length ? '' : '(finished, no output)') + tip || '(finished, chart below)';
}

const runImagesHtml = (images) => `<div class="run-images">${images.map((src) => /^data:image\//.test(src) ? `<img src="${src}" alt="Output" />` : '').join('')}</div>`;

// ------------------------------------------------------------ diffs + code projects
function diffHtml(diff) {
  return diff.split('\n').map((line) => {
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'd-file' : line.startsWith('@@') ? 'd-hunk'
      : line.startsWith('+') ? 'd-add' : line.startsWith('-') ? 'd-del' : '';
    return `<span class="${cls}">${escapeHtml(line) || ' '}</span>`;
  }).join('\n');
}

function renderWorkspaceChip() {
  const ws = state.chat?.workspace;
  const chip = $('#workspaceChip');
  chip.hidden = !ws;
  $('#folderBtn').classList.toggle('on', !!ws);
  const pr = state.problems?.path === ws?.path ? state.problems : null;
  const badge = !pr ? '' : pr.errors + pr.warnings === 0
    ? '<span class="ws-badge ok" title="Real-time code check: no problems found">✓ No problems</span>'
    : `<button type="button" class="ws-badge bad" id="wsProblems" title="Show the problems">⚠ ${pr.errors + pr.warnings} problem${pr.errors + pr.warnings === 1 ? '' : 's'}</button>`;
  if (ws) chip.innerHTML = `<span>📂 <b>${escapeHtml(ws.name)}</b> <span class="muted">· ${ws.files} files${ws.languages?.length ? ` · ${escapeHtml(ws.languages.slice(0, 3).join(' '))}` : ''}</span></span>${badge}<button type="button" id="wsClose" title="Close the project">${ICONS.x}</button>`;
  if (ws && pr && state.problemsOpen && pr.problems.length) {
    chip.insertAdjacentHTML('beforeend', `<ul class="ws-problems">${pr.problems.slice(0, 12).map((p, i) => `<li data-problem="${i}" title="Ask Athena to fix it">
      <span class="${p.severity === 'error' ? 'err' : 'warn'}">${p.severity === 'error' ? '✕' : '!'}</span> <b>${escapeHtml(p.file)}:${p.line}</b> ${escapeHtml(p.message)}</li>`).join('')}</ul>`);
  }
}

// Real-time code analysis: check the open project when it opens, after her edits, and every few seconds
// (so changes you make in another editor show up too).
async function checkProblems() {
  const ws = state.chat?.workspace;
  if (!ws?.path) return;
  try {
    const r = await api(`/api/workspace/problems?path=${encodeURIComponent(ws.path)}`);
    const before = state.problems?.path === ws.path ? state.problems.errors + state.problems.warnings : null;
    state.problems = { ...r, path: ws.path };
    renderWorkspaceChip();
    if (before === 0 && r.errors > 0) toast(`⚠ ${r.errors} new problem${r.errors === 1 ? '' : 's'} in ${ws.name}. Click the badge to see them.`, 'error');
  } catch { /* the check is a bonus */ }
}
setInterval(() => { if (!document.hidden && state.chat?.workspace?.path) checkProblems(); }, 8000);
$('#workspaceChip').addEventListener('click', (e) => {
  if (e.target.closest('#wsProblems')) { state.problemsOpen = !state.problemsOpen; renderWorkspaceChip(); return; }
  const li = e.target.closest('[data-problem]');
  if (!li) return;
  const p = state.problems.problems[Number(li.dataset.problem)];
  $('#input').value = `Fix this problem in ${p.file} line ${p.line}: ${p.message}`;
  $('#input').focus();
  state.problemsOpen = false;
  renderWorkspaceChip();
});

async function openWorkspaceDialog() {
  $('#wsPath').value = state.chat?.workspace?.path || '';
  $('#wsError').textContent = '';
  const recent = await api('/api/workspace/recent').catch(() => []);
  $('#wsRecent').innerHTML = recent.length ? `<div class="muted small" style="margin:12px 0 4px">Recent</div>` +
    recent.map((p) => `<button type="button" class="ws-recent" data-ws="${escapeHtml(p)}">📁 ${escapeHtml(p)}</button>`).join('') : '';
  $('#workspaceDlg').showModal();
  $('#wsPath').focus();
}

async function openWorkspace(path, { quiet = false } = {}) {
  $('#wsError').textContent = '';
  try {
    const info = await api('/api/workspace/open', json('POST', { path }));
    state.chat.workspace = info;
    // Working on herself: keep the model that's already loaded. Swapping to another ~19 GB model takes a while and
    // can run the graphics card out of memory.
    const self = path === state.status.athena_root;
    const keep = self && state.loaded.includes(currentModel());
    if (state.mode !== 'code') setMode('code', { keepModel: keep });
    if (self) {  // changing herself: use the model picked for that (one that fits on the graphics card)
      const m = selfModel();
      if (m) { state.chat.model = m; renderModelButton(); }
    }
    $('#workspaceDlg').close();
    renderWorkspaceChip();
    checkProblems();
    if (!quiet) toast(path === state.status.athena_root ? '🛠 My own code is open. Tell me what to fix or add; you approve every change.'
      : `📂 Opened ${info.name} (${info.files} files). Ask away, e.g. “explain how this project works”`);
    if (state.chat.messages.length) saveChat();
  } catch (e) { $('#wsError').textContent = e.message; if (quiet) toast(e.message, 'error'); }
}
$('#wsSelf').onclick = () => openWorkspace(state.status.athena_root);

/** The model for changing her own code: your choice in Settings → Models, else a ~14B model that fits entirely on
 *  the graphics card (fast, and it can't run out of memory the way two 30B models can). */
function selfModel({ automatic = false } = {}) {
  const names = modelNames();
  const chosen = state.settings.self_model;
  if (!automatic && chosen && names.includes(chosen)) return chosen;
  for (const want of [/^qwen3:14b/, /^qwen2\.5-coder:14b/, /^qwen3:8b/, /^qwen2\.5-coder:7b/]) {
    const hit = names.find((n) => want.test(n));
    if (hit) return hit;
  }
  return '';
}

/** Athena is restarting (update or a change to herself): reload the page once she's back. */
function waitForRestart() {
  const started = Date.now();
  let wentDown = false;
  const poll = async () => {
    const up = await fetch('/api/settings', { cache: 'no-store' }).then((x) => x.ok).catch(() => false);
    if (!up) wentDown = true;
    if (up && (wentDown || Date.now() - started > 15000)) { location.reload(); return; }
    if (Date.now() - started > 180000) { toast('Athena is taking a while to restart. If nothing happens, double-click start.bat.', 'error', { ms: 20000 }); return; }
    setTimeout(poll, 1500);
  };
  setTimeout(poll, 2500);
}

$('#folderBtn').onclick = openWorkspaceDialog;
$('#wsOpen').onclick = () => openWorkspace($('#wsPath').value.trim());
$('#wsPath').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); openWorkspace($('#wsPath').value.trim()); } };
$('#wsRecent').onclick = (e) => { const b = e.target.closest('[data-ws]'); if (b) openWorkspace(b.dataset.ws); };
$('#wsBrowse').onclick = async () => {
  $('#wsBrowse').disabled = true;
  try {
    const r = await api('/api/workspace/pick', { method: 'POST' });
    if (r.path) { $('#wsPath').value = r.path; openWorkspace(r.path); }
  } catch (e) { $('#wsError').textContent = e.message; }
  $('#wsBrowse').disabled = false;
};
$('#workspaceChip').onclick = (e) => {
  if (e.target.closest('#wsProblems, [data-problem], .ws-badge, .ws-problems')) return;  // the code check has its own clicks
  if (!e.target.closest('#wsClose')) return openWorkspaceDialog();
  delete state.chat.workspace;
  renderWorkspaceChip();
  if (state.chat.messages.length) saveChat();
};

// ------------------------------------------------------------ live HTML preview
// Runs in a sandboxed frame with no access to Athena (a unique, empty origin), so page code can't touch your chats or PC.
const LANG_OF = (b) => (b.querySelector('code')?.dataset.lang || '').toLowerCase();

/** The page to show: the HTML block, plus any CSS / JavaScript blocks from the same reply stitched in. */
function previewSource(block) {
  const lang = LANG_OF(block);
  let src = block.querySelector('code').innerText;
  if (lang === 'svg') return `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${src}</body>`;
  const siblings = [...(block.closest('.msg')?.querySelectorAll('.code-block') || [])].filter((b) => b !== block);
  const css = siblings.filter((b) => LANG_OF(b) === 'css').map((b) => b.querySelector('code').innerText);
  const js = siblings.filter((b) => ['javascript', 'js'].includes(LANG_OF(b))).map((b) => b.querySelector('code').innerText);
  if (css.length || js.length) {
    // The reply split the page into files: drop links to local files and put the code in directly.
    const doc = new DOMParser().parseFromString(src, 'text/html'); // parsing only: nothing in it runs here
    const local = (u) => !/^(?:[a-z]+:)?\/\//i.test(u || '');
    doc.querySelectorAll('link[href]').forEach((el) => { if (local(el.getAttribute('href')) && /\.css(?:[?#]|$)/i.test(el.getAttribute('href'))) el.remove(); });
    doc.querySelectorAll('script[src]').forEach((el) => { if (local(el.getAttribute('src')) && /\.js(?:[?#]|$)/i.test(el.getAttribute('src'))) el.remove(); });
    if (css.length) { const st = doc.createElement('style'); st.textContent = `\n${css.join('\n')}\n`; doc.head.append(st); }
    if (js.length) { const sc = doc.createElement('script'); sc.textContent = `\n${js.join('\n;\n')}\n`; doc.body.append(sc); }
    src = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }
  return src;
}

function togglePreview(btn) {
  const block = btn.closest('.code-block');
  const open = block.querySelector('.html-preview');
  if (open) { open.remove(); btn.classList.remove('on'); return; }
  openPreview(block);
}

function openPreview(block) {
  const btn = block.querySelector('[data-preview]');
  const src = previewSource(block);
  const wrap = document.createElement('div');
  wrap.className = 'html-preview';
  wrap.innerHTML = `<div class="hp-bar"><span>✨ Live preview</span>
    <button type="button" data-hp="desktop" class="on" title="Computer size">🖥</button><button type="button" data-hp="phone" title="Phone size">📱</button>
    <button type="button" data-hp="reload" title="Restart">↻</button><button type="button" data-hp="tab" title="Open in a new tab">↗</button><button type="button" data-hp="full" title="Full screen">⛶</button></div>
    <div class="hp-stage"></div>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-pointer-lock');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = src;
  wrap.querySelector('.hp-stage').append(frame);
  block.append(wrap);
  btn?.classList.add('on');
  wrap.querySelector('.hp-bar').onclick = (e) => {
    const act = e.target.closest('[data-hp]')?.dataset.hp;
    if (act === 'reload') { frame.srcdoc = ''; frame.srcdoc = src; }
    if (act === 'full') wrap.requestFullscreen?.();
    if (act === 'phone' || act === 'desktop') {
      wrap.classList.toggle('phone', act === 'phone');
      wrap.querySelectorAll('[data-hp="phone"],[data-hp="desktop"]').forEach((b) => b.classList.toggle('on', b.dataset.hp === act));
    }
    if (act === 'tab') openPreviewTab(src, state.chat?.title);
  };
  return wrap;
}

/** A full-size tab. The page still runs inside the same locked-down sandbox (see preview.html). */
function openPreviewTab(src, title) {
  const win = window.open('preview.html', '_blank');
  if (!win) return toast('Your browser blocked the new tab. Allow pop-ups for Athena and try again.', 'error');
  const onReady = (e) => {
    if (e.source !== win || !e.data?.previewReady) return;
    win.postMessage({ src, title: title || 'Preview' }, location.origin);
    removeEventListener('message', onReady);
  };
  addEventListener('message', onReady);
}

/** Right after she finishes building something visual, show it running. */
function autoPreview(el) {
  if (state.settings.auto_preview === false) return;
  const blocks = [...el.querySelectorAll('.code-block')].filter((b) => b.querySelector('[data-preview]'));
  const main = blocks.find((b) => LANG_OF(b) !== 'svg' && /<(html|body|canvas|div)/i.test(b.querySelector('code').innerText)) || blocks.at(-1);
  if (!main || main.querySelector('.html-preview')) return;
  const wrap = openPreview(main);
  setTimeout(() => wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
}

// ------------------------------------------------------------ Jarvis: routines, contacts, heads-ups, PC status
const STEP_FIELDS = {
  open_app: [['name', 'App, e.g. Steam']], close_app: [['app', 'App, e.g. Chrome']],
  window: [['action', ['focus', 'minimize', 'maximize', 'left', 'right', 'move']], ['app', 'App'], ['monitor', 'Monitor #', 'number']],
  minimize_all: [], volume: [['level', 'Volume 0-100', 'number']], media: [['action', ['play_pause', 'next', 'previous']]],
  open_website: [['url', 'https://…']], message: [['app', ['discord', 'whatsapp', 'text', 'email']], ['to', 'To (name)'], ['text', 'Message']],
  say: [['text', 'What she says']], wait: [['seconds', 'Seconds', 'number']], type: [['text', 'Text to type']], keys: [['keys', 'e.g. ctrl+s']],
  timer: [['minutes', 'Minutes', 'number'], ['label', 'For what']], home: [['device', 'Device'], ['action', 'on / off / toggle']],
  lock: [], sleep: [], shutdown: [['minutes', 'In minutes (optional)', 'number']],
};
const jarvis = { routines: [], stepTypes: {}, editing: null };

async function loadJarvis() {
  const [r, contacts] = await Promise.all([api('/api/routines').catch(() => ({ routines: [], step_types: {} })), api('/api/contacts').catch(() => [])]);
  jarvis.routines = r.routines;
  jarvis.stepTypes = r.step_types;
  $('#routineList').innerHTML = r.routines.length ? r.routines.map((x) => `
    <div class="jv-item" data-rid="${x.id}">
      <div class="jv-main"><b>${escapeHtml(x.icon || '⚡')} ${escapeHtml(x.name)}</b><span class="muted small">Say: ${x.phrases.map((p) => `“${escapeHtml(p)}”`).join(', ')}</span>
        <span class="muted small">${x.summary.map(escapeHtml).join(' → ')}</span></div>
      <div class="jv-actions"><button type="button" data-rt="run" title="Run now">▶</button><button type="button" data-rt="edit" title="Edit">${ICONS.edit}</button><button type="button" data-rt="delete" title="Delete">${ICONS.trash}</button></div>
    </div>`).join('') : '<p class="muted small">No routines yet. Make one here, or just ask: <i>"make a goodnight routine that closes Chrome and Discord and locks my PC"</i>.</p>';
  $('#contactList').innerHTML = contacts.length ? contacts.map((c) => `
    <div class="jv-item" data-cid="${c.id}"><div class="jv-main"><b>${escapeHtml(c.name)}</b>
      <span class="muted small">${[c.nicknames && `aka ${escapeHtml(c.nicknames)}`, c.discord && `Discord: ${escapeHtml(c.discord)}`, c.instagram && `Instagram: @${escapeHtml(c.instagram)}`, c.snapchat && `Snapchat: ${escapeHtml(c.snapchat)}`, c.telegram && `Telegram: @${escapeHtml(c.telegram)}`, c.phone && `📱 ${escapeHtml(c.phone)}`, c.email && `✉ ${escapeHtml(c.email)}`].filter(Boolean).join(' · ') || 'No details yet'}</span></div>
      <div class="jv-actions"><button type="button" data-ct="delete" title="Delete">${ICONS.trash}</button></div></div>`).join('') : '<p class="muted small">No contacts yet.</p>';
}

function stepRow(step = { do: 'open_app' }) {
  const row = document.createElement('div');
  row.className = 'rt-step';
  const kinds = Object.entries(jarvis.stepTypes).map(([k, label]) => `<option value="${k}"${k === step.do ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const fields = (STEP_FIELDS[step.do] || []).map(([key, ph, type]) => Array.isArray(ph)
    ? `<select data-k="${key}">${ph.map((o) => `<option${String(step[key] ?? '') === o ? ' selected' : ''}>${o}</option>`).join('')}</select>`
    : `<input data-k="${key}" placeholder="${escapeHtml(ph)}" ${type === 'number' ? 'type="number"' : ''} value="${escapeHtml(step[key] ?? '')}" />`).join('');
  row.innerHTML = `<span class="rt-grip">⋮</span><select data-k="do">${kinds}</select>${fields}<button type="button" data-rt-step="up" title="Move up">↑</button><button type="button" data-rt-step="remove" title="Remove">${ICONS.x}</button>`;
  row.querySelector('[data-k="do"]').onchange = (e) => row.replaceWith(stepRow({ do: e.target.value }));
  return row;
}

function editRoutine(r) {
  jarvis.editing = r?.id || null;
  $('#rtName').value = r?.name || '';
  $('#rtIcon').value = r?.icon || '⚡';
  $('#rtPhrases').value = (r?.phrases || []).join(', ');
  $('#rtSteps').innerHTML = '';
  (r?.steps?.length ? r.steps : [{ do: 'open_app' }]).forEach((st) => $('#rtSteps').append(stepRow(st)));
  $('#routineEditor').hidden = false;
  $('#rtName').focus();
}

$('#routineNew').onclick = () => editRoutine(null);
$('#rtAddStep').onclick = () => $('#rtSteps').append(stepRow());
$('#rtCancel').onclick = () => { $('#routineEditor').hidden = true; };
$('#rtSteps').onclick = (e) => {
  const b = e.target.closest('[data-rt-step]');
  if (!b) return;
  const row = b.closest('.rt-step');
  if (b.dataset.rtStep === 'remove') row.remove();
  if (b.dataset.rtStep === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
};
$('#rtSave').onclick = async () => {
  const steps = $$('#rtSteps .rt-step').map((row) => Object.fromEntries($$('[data-k]', row).map((el) => [el.dataset.k, el.type === 'number' && el.value !== '' ? Number(el.value) : el.value]).filter(([, v]) => v !== '')));
  try {
    await api('/api/routines', json('POST', { id: jarvis.editing, name: $('#rtName').value, icon: $('#rtIcon').value, phrases: $('#rtPhrases').value.split(',').map((x) => x.trim()).filter(Boolean), steps }));
    $('#routineEditor').hidden = true;
    toast('Routine saved');
    loadJarvis();
  } catch (err) { toast(err.message, 'error'); }
};
$('#routineList').onclick = async (e) => {
  const b = e.target.closest('[data-rt]');
  if (!b) return;
  const r = jarvis.routines.find((x) => x.id === b.closest('[data-rid]').dataset.rid);
  if (b.dataset.rt === 'edit') editRoutine(r);
  if (b.dataset.rt === 'delete' && confirm(`Delete the routine “${r.name}”?`)) { await api(`/api/routines/${r.id}`, { method: 'DELETE' }); loadJarvis(); }
  if (b.dataset.rt === 'run') {
    toast(`${r.icon || '⚡'} Running ${r.name}…`);
    try {
      const res = await api(`/api/routines/${r.id}/run`, { method: 'POST' });
      const bad = res.steps.filter((x) => x.error);
      toast(bad.length ? `${bad.length} step(s) didn't work: ${bad.map((x) => x.error).join('; ')}` : `${r.name} done ✓`, bad.length ? 'error' : '');
    } catch (err) { toast(err.message, 'error'); }
  }
};
$('#ctSave').onclick = async () => {
  const data = { name: $('#ctName').value, nicknames: $('#ctNicknames').value, discord: $('#ctDiscord').value, instagram: $('#ctInstagram').value, snapchat: $('#ctSnapchat').value, telegram: $('#ctTelegram').value, phone: $('#ctPhone').value, email: $('#ctEmail').value };
  try {
    await api('/api/contacts', json('POST', data));
    ['#ctName', '#ctNicknames', '#ctDiscord', '#ctInstagram', '#ctSnapchat', '#ctTelegram', '#ctPhone', '#ctEmail'].forEach((id) => { $(id).value = ''; });
    loadJarvis();
  } catch (err) { toast(err.message, 'error'); }
};
$('#contactList').onclick = async (e) => {
  const b = e.target.closest('[data-ct="delete"]');
  if (b) { await api(`/api/contacts/${b.closest('[data-cid]').dataset.cid}`, { method: 'DELETE' }); loadJarvis(); }
};
$('#setAlerts').onchange = (e) => {
  saveSettings({ alerts_enabled: e.target.checked });
  if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
};
$('#setAlertsSpeak').onchange = (e) => saveSettings({ alerts_speak: e.target.checked });
$$('[data-alert]').forEach((el) => { el.onchange = () => saveSettings({ [`alert_${el.dataset.alert}`]: el.checked }); });
$('#testAlert').onclick = () => api('/api/alerts/test', { method: 'POST' }).catch((err) => toast(err.message, 'error'));
async function checkPc() {
  const box = $('#pcStatus');
  box.innerHTML = '<span class="muted small">Checking…</span>';
  try {
    const st = await api('/api/pc-status');
    const bar = (label, pct, extra = '') => `<div class="pcs-row"><span>${label}</span><div class="pcs-bar"><div style="width:${Math.min(100, pct || 0)}%" class="${pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : ''}"></div></div><span class="muted small">${extra}</span></div>`;
    const g = st.gpu;
    box.innerHTML = bar('CPU', st.cpu.usage_percent, `${st.cpu.usage_percent}%`) +
      bar('Memory', st.memory.used_percent, `${st.memory.used_gb} / ${st.memory.total_gb} GB`) +
      (g ? bar('Graphics', g.usage_percent, `${g.usage_percent ?? '?'}%${g.memory_used_gb != null ? ` · ${g.memory_used_gb}/${g.memory_total_gb ?? '?'} GB` : ''}${g.temperature_c ? ` · ${g.temperature_c}°C` : ''}`) : '') +
      st.disks.map((d) => bar(escapeHtml(d.drive), d.used_percent, `${d.free_gb} GB free`)).join('') +
      `<p class="muted small">Up ${escapeHtml(st.uptime)} · busiest: ${st.busiest_apps_cpu.slice(0, 3).map((a) => escapeHtml(a.app)).join(', ') || 'nothing much'}</p>
       <button type="button" class="ghost" data-pc-check>Check again</button>`;
  } catch (err) { box.innerHTML = `<span class="err">${escapeHtml(err.message)}</span> <button type="button" class="ghost" data-pc-check>Try again</button>`; }
}
$('#pcStatus').onclick = (e) => { if (e.target.closest('[data-pc-check], #pcStatusBtn')) checkPc(); };

/** A heads-up from Athena: pop it up, say it, and notify even when the window is in the background. */
function showAlert(ev) {
  sfx?.('done');
  toast(`🔔 ${ev.text}`, '', { ms: 9000 });
  if (ev.speak && !state.voice.active) { speaker.reset(); speaker.say(ev.text); }
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Athena', { body: ev.text, silent: true }); } catch { /* ignore */ }
  }
}

// ------------------------------------------------------------ live events
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === 'reminder') fireReminder(ev);
    else if (ev.type === 'alert') showAlert(ev);
    else if (ev.type === 'briefing') startBriefing();
    else if (ev.type === 'wake') {
      if (state.voice.sleeping) { state.voice.wakeUp?.(); return; }
      if (state.voice.active) return;
      chime();
      startVoice(ev.command || '');
    }
    else if (ev.type === 'start_voice') startVoice();
  };
}

function pauseWake(paused) {
  if (!state.settings.wake_enabled) return;
  fetch('/api/wake/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }) }).catch(() => {});
}

// ------------------------------------------------------------ morning briefing
async function startBriefing() {
  if (state.abort || state.voice.active) return;
  newChat();
  setMode('assistant');
  const prompt = "Give me my morning briefing: greet me, today's date, the weather (use get_weather), my open tasks, today's reminders and any flashcards due for review (use flashcard_decks), then one short motivating line. Keep it brief and friendly.";
  const prev = state.settings.auto_speak;
  state.settings.auto_speak = true; // read the briefing aloud
  try {
    state.chat.messages.push({ role: 'user', content: prompt, display: '☀ Morning briefing' });
    renderMessages();
    await generateReply();
  } finally { state.settings.auto_speak = prev; }
}
$('#briefNow').onclick = () => { dlg.close(); startBriefing(); };

// ------------------------------------------------------------ PIN lock
const unlockWaiters = [];
function showLock() {
  $('#lockScreen').hidden = false;
  $('#unlockError').textContent = '';
  $('#unlockPin').value = '';
  setTimeout(() => $('#unlockPin').focus(), 50);
  if (state.voice.active) endVoice();
}
$('#unlockForm').onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#unlockPin').value }) });
  if (!res.ok) {
    $('#unlockError').textContent = (await res.json().catch(() => ({}))).detail || 'Wrong PIN';
    $('#unlockPin').value = '';
    return;
  }
  $('#lockScreen').hidden = true;
  unlockWaiters.splice(0).forEach((r) => r());
};
async function lockNow() {
  await fetch('/api/lock', { method: 'POST' });
  showLock();
}
$('#lockBtn').onclick = lockNow;

function setupIdleLock() {
  let last = Date.now();
  for (const ev of ['mousemove', 'keydown', 'pointerdown', 'wheel']) window.addEventListener(ev, () => { last = Date.now(); }, { passive: true });
  setInterval(() => {
    const mins = Number(state.settings.auto_lock_minutes) || 0;
    if (state.settings.pin_set && mins && $('#lockScreen').hidden && !state.voice.active && Date.now() - last > mins * 60000) lockNow();
  }, 15000);
}

async function refreshPin() {
  const set = !!state.settings.pin_set;
  $('#pinStatus').textContent = set ? '🔒 A PIN is set.' : 'No PIN set — anyone at this PC can open Athena.';
  $('#pinCurrentWrap').hidden = !set;
  $('#lockBtn').hidden = !set;
}
$('#pinSave').onclick = async () => {
  try {
    await api('/api/pin', json('POST', { current: $('#pinCurrent').value, pin: $('#pinNew').value }));
    state.settings = await api('/api/settings');
    $('#pinCurrent').value = $('#pinNew').value = '';
    refreshPin();
    toast(state.settings.pin_set ? 'PIN saved' : 'PIN removed');
  } catch (e) { toast(e.message, 'error'); }
};

// ------------------------------------------------------------ backup / restore
$('#restoreFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !confirm('Restore this backup? It replaces your current chats, tasks, memories and settings.')) return;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/restore', { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { toast(body.detail || 'Restore failed', 'error'); return; }
  toast(`Restored ${body.files} files — reloading…`);
  setTimeout(() => location.reload(), 1200);
};

// ------------------------------------------------------------ export
let exportTarget = null;
function openExportMenu(id, anchor) {
  exportTarget = id;
  const menu = $('#exportMenu');
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - 190)}px`;
  menu.hidden = false;
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
}
document.addEventListener('click', (e) => { if (!e.target.closest('#exportMenu') && !e.target.closest('[data-act="export"]')) $('#exportMenu').hidden = true; });
$('#exportMenu').onclick = async (e) => {
  const fmt = e.target.closest('[data-export]')?.dataset.export;
  if (!fmt || !exportTarget) return;
  $('#exportMenu').hidden = true;
  if (fmt !== 'pdf') { location.href = `/api/conversations/${exportTarget}/export?format=${fmt}`; return; }
  const chat = await api(`/api/conversations/${exportTarget}`);
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to export as PDF', 'error'); return; }
  const body = (chat.messages || []).filter((m) => m.content?.trim()).map((m) =>
    `<h3>${m.role === 'user' ? 'You' : 'Athena'}</h3><div>${m.role === 'user' ? escapeHtml(m.display ?? m.content).replace(/\n/g, '<br>') : renderMarkdown(m.content)}</div>`).join('');
  w.document.write(`<!doctype html><title>${escapeHtml(chat.title)}</title><link rel="stylesheet" href="${location.origin}/vendor/katex/katex.min.css"><style>body{font:14px/1.6 system-ui,sans-serif;max-width:720px;margin:32px auto;color:#111}h1{margin:0}h3{margin:22px 0 4px;color:#a8740c}pre{background:#f4f4f4;padding:10px;border-radius:8px;white-space:pre-wrap}.code-head button{display:none}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style><h1>${escapeHtml(chat.title)}</h1><p style="color:#777">Exported from Athena AI</p>${body}<script>onload=()=>setTimeout(print,300)<\/script>`);
  w.document.close();
};

// ------------------------------------------------------------ personalities
function personaName(id) {  // "companion" -> "Companion", or a custom personality's name
  return (BUILTIN_PERSONAS[id] || '').split(' — ')[0] || (state.settings.personas || []).find((p) => p.id === id)?.name || id;
}
const BUILTIN_PERSONAS = { assistant: 'Assistant — clear, direct, straight to the point', companion: 'Companion — flirty, savage, foul-mouthed', study: 'Study Buddy — patient tutor' };
function fillPersonas() {
  const custom = state.settings.personas || [];
  $('#setPersona').innerHTML = Object.entries(BUILTIN_PERSONAS).map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join('') +
    custom.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} — custom</option>`).join('');
  const ids = [...Object.keys(BUILTIN_PERSONAS), ...custom.map((p) => p.id)];
  $('#setPersona').value = ids.includes(state.settings.persona) ? state.settings.persona : 'assistant';
  $('#personaList').innerHTML = custom.map((p) => `<li><span><b>${escapeHtml(p.name)}</b> <span class="muted small">${escapeHtml(p.instructions.slice(0, 90))}</span></span><button type="button" data-persona-del="${escapeHtml(p.id)}" title="Delete">${ICONS.trash}</button></li>`).join('');
  fillPersonaVoices();
}
$('#personaSave').onclick = async () => {
  const name = $('#personaName').value.trim(), instructions = $('#personaText').value.trim();
  if (!name || !instructions) { toast('Give the personality a name and describe how she should act', 'error'); return; }
  const persona = { id: `p_${Date.now().toString(36)}`, name, instructions, voice: $('#personaVoice').value };
  await saveSettings({ personas: [...(state.settings.personas || []), persona], persona: persona.id });
  $('#personaName').value = $('#personaText').value = '';
  fillPersonas();
  toast(`${name} is now active`);
};
$('#personaList').onclick = async (e) => {
  const id = e.target.closest('[data-persona-del]')?.dataset.personaDel;
  if (!id) return;
  const personas = (state.settings.personas || []).filter((p) => p.id !== id);
  await saveSettings({ personas, ...(state.settings.persona === id ? { persona: 'assistant' } : {}) });
  fillPersonas();
};

// ------------------------------------------------------------ knowledge
async function refreshKnowledge() {
  const k = await api('/api/knowledge').catch(() => null);
  if (!k) return;
  const box = $('#indexProgress');
  box.hidden = !k.running;
  if (k.running) {
    $('.bar', box).style.width = k.total ? `${(k.done / k.total) * 100}%` : '5%';
    $('span', box).textContent = `${k.message} (${k.done}/${k.total})`;
    setTimeout(refreshKnowledge, 800);
  }
  $('#indexStatus').innerHTML = k.error ? `<span class="status-bad">${escapeHtml(k.error)}</span>`
    : escapeHtml(k.message || (k.documents ? `${k.documents} documents, ${k.passages} passages indexed` : 'Nothing indexed yet.'));
}
$('#indexBtn').onclick = async () => {
  await saveSettings({ knowledge_folders: $('#setKnowledge').value.split('\n').map((l) => l.trim()).filter(Boolean) });
  if (!state.settings.knowledge_folders?.length) { toast('Add at least one folder first', 'error'); return; }
  await api('/api/knowledge/index', { method: 'POST' });
  setTimeout(refreshKnowledge, 300);
};
$('#embedPull').onclick = () => pullModel($('#setEmbed').value);

// ------------------------------------------------------------ integrations
async function testIntegration(kind, out) {
  $(out).textContent = 'Testing…';
  try {
    const r = await api('/api/integrations/test', json('POST', { kind }));
    $(out).innerHTML = `<span class="${r.ok ? 'status-ok' : 'status-bad'}">${r.ok ? '✓' : '✗'} ${escapeHtml(r.message)}</span>`;
  } catch (e) { $(out).textContent = e.message; }
}
$('#testWeather').onclick = () => testIntegration('weather', '#weatherStatus');
async function findImageGenerator() {
  $('#imagesStatus').textContent = 'Looking for an image generator…';
  let r;
  try { r = await api('/api/integrations/test', json('POST', { kind: 'images' })); } catch (e) { $('#imagesStatus').textContent = e.message; return; }
  $('#imagesStatus').innerHTML = `<span class="${r.ok ? 'status-ok' : 'status-bad'}">${r.ok ? '✓' : '✗'} ${escapeHtml(r.message)}</span>`;
  const models = r.models || [];
  $('#setImageModel').innerHTML = '<option value="">Best one found</option>' + models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  $('#setImageModel').value = models.includes(state.settings.image_model) ? state.settings.image_model : '';
}
$('#testImages').onclick = findImageGenerator;

async function loadGithub() {
  const r = await api('/api/github').catch((e) => ({ connected: false, message: e.message }));
  $('#ghStatus').innerHTML = `<span class="${r.connected ? 'status-ok' : 'status-bad'}">${r.connected ? '✓' : '○'} ${escapeHtml(r.message)}</span>`;
  $('#ghConnect').textContent = r.connected ? 'Reconnect' : 'Connect GitHub';
}
$('#ghConnect').onclick = async () => {
  $('#ghConnect').disabled = true;
  $('#ghStatus').textContent = 'A GitHub sign-in window is opening… sign in there, then come back here.';
  try {
    const r = await api('/api/github/connect', { method: 'POST' });
    toast(`GitHub connected as @${r.login} ✓`);
  } catch (e) { toast(e.message, 'error'); }
  $('#ghConnect').disabled = false;
  loadGithub();
};
$('#testHome').onclick = () => testIntegration('home', '#homeStatus');

// ------------------------------------------------------------ wake word + desktop
async function refreshWake() {
  const w = await api('/api/wake').catch(() => null);
  if (!w) return;
  $('#wakeStatus').innerHTML = !w.available ? 'Needs the voice add-on — run install-voice.bat, then restart Athena.'
    : w.error ? `<span class="status-bad">${escapeHtml(w.error)}</span>`
    : w.running ? `<span class="status-ok">● Listening for “Hey Athena”</span>${w.last_heard ? ` · last heard: “${escapeHtml(w.last_heard)}”` : ''}`
    : state.settings.wake_enabled ? 'Starting…' : 'Off';
}
async function refreshDesktop() {
  const d = await api('/api/desktop').catch(() => null);
  if (!d) return;
  const win = d.platform.startsWith('win');
  $('#desktopStatus').innerHTML = d.desktop_app ? '<span class="status-ok">● Running as a desktop app</span>'
    : 'Running in the browser. Close this and double-click <b>start-desktop.bat</b> for the tray app &amp; hotkeys.';
  $('#setAutostart').checked = d.autostart;
  $('#setAutostart').disabled = !win;
  $('#makeShortcuts').disabled = !win;
  $('#buildExe').disabled = !win;
  $('#buildExe').textContent = d.exe ? 'Remake Athena.exe' : 'Make Athena.exe (double-click app)';
}
$('#buildExe').onclick = async () => {
  const btn = $('#buildExe');
  btn.disabled = true; btn.textContent = 'Making Athena.exe… (about a minute)';
  try {
    const r = await api('/api/desktop', json('POST', { build_exe: true }));
    toast(r.note || 'Made Athena.exe');
  } catch (e) { toast(e.message, 'error'); }
  refreshDesktop();
};
$('#setAutostart').onchange = async (e) => {
  try { await api('/api/desktop', json('POST', { autostart: e.target.checked })); toast(e.target.checked ? 'Athena will start with Windows' : 'Athena won’t start with Windows'); }
  catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
};
$('#makeShortcuts').onclick = async () => {
  try {
    const r = await api('/api/desktop', json('POST', { shortcuts: true }));
    toast(r.shortcuts.length ? 'Shortcuts created on your Desktop and Start menu' : 'Couldn’t create shortcuts', r.shortcuts.length ? '' : 'error');
  } catch (e) { toast(e.message, 'error'); }
};

// ------------------------------------------------------------ save code as a file
const CODE_EXT = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', jsx: 'jsx', html: 'html', css: 'css',
  json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', powershell: 'ps1', ps1: 'ps1', batch: 'bat', bat: 'bat', cmd: 'bat', sql: 'sql', java: 'java',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
  yaml: 'yml', yml: 'yml', toml: 'toml', xml: 'xml', markdown: 'md', md: 'md', lua: 'lua', r: 'r', dart: 'dart', vue: 'vue', svelte: 'svelte' };
function saveCodeBlock(btn) {
  const code = btn.closest('.code-block').querySelector('code');
  const lang = (code.dataset.lang || 'txt').toLowerCase();
  const stem = (state.chat?.title || 'athena-code').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'athena-code';
  const name = `${stem}.${CODE_EXT[lang] || 'txt'}`;
  const url = URL.createObjectURL(new Blob([code.innerText], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Saved ${name} to your Downloads`);
}

// ------------------------------------------------------------ jump to bottom
function updateJumpBtn() {
  const far = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight > 400;
  $('#jumpBtn').hidden = !far || !state.chat?.messages.length;
}
messagesEl.addEventListener('scroll', updateJumpBtn, { passive: true });
$('#jumpBtn').onclick = () => { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }); };

// ------------------------------------------------------------ saved replies
async function toggleSaved(msg, btn) {
  if (msg.savedId) {
    await api(`/api/saved/${msg.savedId}`, { method: 'DELETE' }).catch(() => {});
    delete msg.savedId;
    toast('Removed from Saved');
  } else {
    const item = await api('/api/saved', json('POST', {
      chat_id: state.chat.id, chat_title: state.chat.title, content: splitThinking(msg).content, model: msg.model,
    }));
    msg.savedId = item.id;
    toast('⭐ Saved — find it under Saved in the sidebar');
  }
  btn.classList.toggle('starred', !!msg.savedId);
  if (msg.versions) msg.versions[msg.v ?? msg.versions.length - 1].savedId = msg.savedId;
  await saveChat();
  if (!$('#savedDrawer').hidden) loadSaved();
}

async function loadSaved() {
  const items = await api('/api/saved').catch(() => []);
  $('#savedList').innerHTML = items.length ? items.map((it) => `
    <div class="saved-item" data-id="${it.id}">
      <div class="md">${renderMarkdown(it.content)}</div>
      <div class="meta"><span>${escapeHtml(it.chat_title || 'Chat')} · ${new Date(it.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><span class="spacer"></span>
        <button data-saved="expand">More</button><button data-saved="copy">Copy</button>${it.chat_id ? '<button data-saved="open">Open chat</button>' : ''}<button data-saved="remove">Remove</button></div>
    </div>`).join('') : '<p class="muted small" style="padding:8px">Nothing saved yet. Hover over one of Athena’s replies and click the ☆.</p>';
  $('#savedList').dataset.items = JSON.stringify(items.map((i) => [i.id, i.chat_id]));
  $('#savedList')._items = items;
}
function openSaved() {
  $('#tasksDrawer').hidden = true;
  $('#savedDrawer').hidden = false;
  loadSaved();
}
$('#openSaved').onclick = () => ($('#savedDrawer').hidden ? openSaved() : ($('#savedDrawer').hidden = true));
$('#closeSaved').onclick = () => ($('#savedDrawer').hidden = true);
$('#savedList').onclick = async (e) => {
  const b = e.target.closest('[data-saved]');
  if (!b) return;
  const card = b.closest('.saved-item');
  const item = ($('#savedList')._items || []).find((i) => i.id === card.dataset.id);
  if (!item) return;
  const act = b.dataset.saved;
  if (act === 'expand') { card.classList.toggle('open'); b.textContent = card.classList.contains('open') ? 'Less' : 'More'; }
  if (act === 'copy') { await copyText(item.content); toast('Copied'); }
  if (act === 'open') { await openChat(item.chat_id); if (isNarrow()) $('#savedDrawer').hidden = true; }
  if (act === 'remove') {
    await api(`/api/saved/${item.id}`, { method: 'DELETE' });
    const m = state.chat?.messages.find((x) => x.savedId === item.id);
    if (m) { delete m.savedId; renderMessages(); saveChat(); }
    loadSaved();
  }
};
$('#openTasks').addEventListener('click', () => { $('#savedDrawer').hidden = true; });

// ------------------------------------------------------------ focus timer (Pomodoro)
const focus = { orb: null, timer: null };
function startFocus(minutes = 25, task = '', breakMinutes = 5) {
  const f = { phase: 'focus', end: Date.now() + minutes * 60000, minutes, task, breakMinutes, paused: 0 };
  try { localStorage.setItem('athena-focus', JSON.stringify(f)); } catch { /* ignore */ }
  runFocus(f);
  toast(`🎯 Focus for ${minutes} minutes${task ? ` — ${task}` : ''}`);
}
function runFocus(f) {
  const w = $('#focusWidget');
  w.hidden = false;
  if (!focus.orb) { focus.orb = new VoiceOrb($('#focusOrb')); focus.orb.getLevel = () => 0; }
  focus.state = f;
  clearInterval(focus.timer);
  const tick = () => {
    const st = focus.state;
    const left = st.paused || Math.max(0, st.end - Date.now());
    const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
    $('#focusTime').textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    $('#focusLabel').textContent = st.phase === 'break' ? 'Break time ☕' : (st.task || 'Focus');
    w.classList.toggle('break', st.phase === 'break');
    w.classList.toggle('paused', !!st.paused);
    focus.orb.setState(st.paused ? 'idle' : st.phase === 'break' ? 'listening' : 'thinking');
    if (!st.paused && left <= 0) {
      chime();
      speaker.reset();
      if (st.phase === 'focus') {
        speaker.say(`Nice work${state.settings.user_name ? `, ${state.settings.user_name}` : ''}! Time for a ${st.breakMinutes} minute break.`);
        toast(`🎉 Focus done! ${st.breakMinutes}-minute break`, 'alarm');
        Object.assign(st, { phase: 'break', end: Date.now() + st.breakMinutes * 60000 });
        try { localStorage.setItem('athena-focus', JSON.stringify(st)); } catch { /* ignore */ }
      } else {
        speaker.say("Break's over. Ready for another round?");
        toast("☕ Break's over — ready for another round?", 'alarm');
        stopFocus();
      }
    }
  };
  tick();
  focus.timer = setInterval(tick, 500);
}
function stopFocus() {
  clearInterval(focus.timer);
  focus.orb?.destroy();
  focus.orb = null;
  $('#focusWidget').hidden = true;
  try { localStorage.removeItem('athena-focus'); } catch { /* ignore */ }
}
$('#focusStop').onclick = stopFocus;
$('#focusPause').onclick = () => {
  const st = focus.state;
  if (!st) return;
  if (st.paused) { st.end = Date.now() + st.paused; st.paused = 0; } else { st.paused = Math.max(0, st.end - Date.now()); }
  $('#focusPause').title = st.paused ? 'Resume' : 'Pause';
  $('#focusPause').innerHTML = st.paused ? '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>';
  try { localStorage.setItem('athena-focus', JSON.stringify(st)); } catch { /* ignore */ }
};
function resumeFocus() {
  try {
    const f = JSON.parse(localStorage.getItem('athena-focus') || 'null');
    if (f && (f.paused || f.end > Date.now() - 60000)) runFocus(f);
  } catch { /* ignore */ }
}

// ------------------------------------------------------------ sound effects
let sfxCtx = null;
function sfx(kind) {
  if (!state.settings.sound_effects) return;
  try {
    sfxCtx = sfxCtx || new AudioContext();
    const ctx = sfxCtx;
    const notes = kind === 'send' ? [[1320, 0, 0.05]] : [[740, 0, 0.12], [988, 0.08, 0.16]];
    for (const [f, delay, len] of notes) {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'send' ? 0.05 : 0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + len + 0.02);
    }
  } catch { /* no audio */ }
}

// ------------------------------------------------------------ projects
state.projects = [];
try { state.project = localStorage.getItem('athena-project') || null; } catch { state.project = null; }

async function loadProjects() {
  state.projects = await api('/api/projects').catch(() => []);
  if (state.project && !state.projects.some((p) => p.id === state.project)) setProject(null);
  renderSidebar();
}

function setProject(id) {
  state.project = id;
  try { id ? localStorage.setItem('athena-project', id) : localStorage.removeItem('athena-project'); } catch { /* ignore */ }
  if (!state.chat?.messages.length) { state.chat.project_id = id; renderMessages(); }
  renderSidebar();
}

function renderProjects() {
  const box = $('#projectList');
  const cur = state.projects.find((p) => p.id === state.project);
  if (cur) {
    box.innerHTML = `<div class="proj-header"><span>${escapeHtml(cur.icon || '📁')}</span><b title="${escapeHtml(cur.name)}">${escapeHtml(cur.name)}</b>
      <button data-proj-act="edit" title="Project settings">${ICONS.gear}</button><button data-proj-act="exit" title="Show all chats">${ICONS.x}</button></div>`;
    return;
  }
  box.innerHTML = `<div class="ph"><span>Projects</span><button data-proj-act="new" title="New project">+</button></div>` +
    state.projects.map((p) => `<button class="proj-item" data-proj="${p.id}"><span>${escapeHtml(p.icon || '📁')}</span><span>${escapeHtml(p.name)}</span><span class="pc">${p.chats || ''}</span></button>`).join('');
}

$('#projectList').onclick = (e) => {
  const item = e.target.closest('[data-proj]');
  if (item) { setProject(item.dataset.proj); newChat(); return; }
  const act = e.target.closest('[data-proj-act]')?.dataset.projAct;
  if (act === 'new') openProjectEditor(null);
  if (act === 'edit') openProjectEditor(state.project);
  if (act === 'exit') { setProject(null); newChat(); }
};

const projEdit = { id: null, files: [] };
async function openProjectEditor(id) {
  projEdit.id = id;
  const p = id ? await api(`/api/projects/${id}`) : { name: '', icon: '📁', instructions: '', files: [] };
  projEdit.files = p.files || [];
  $('#projectDlgTitle').textContent = id ? 'Project settings' : 'New project';
  $('#projName').value = p.name || '';
  $('#projIcon').value = p.icon || '📁';
  $('#projInstructions').value = p.instructions || '';
  $('#projDelete').hidden = !id;
  renderProjFiles();
  $('#projectDlg').showModal();
  $('#projName').focus();
}
function renderProjFiles() {
  $('#projFiles').innerHTML = projEdit.files.length
    ? projEdit.files.map((f, i) => `<li><span>${ICONS.file} ${escapeHtml(f.name)} <span class="muted small">${Math.round((f.text || '').length / 1000) || '<1'}k characters</span></span><button type="button" data-pf="${i}" title="Remove">${ICONS.trash}</button></li>`).join('')
    : '<li class="muted small">No files yet.</li>';
}
$('#projFiles').onclick = (e) => { const b = e.target.closest('[data-pf]'); if (b) { projEdit.files.splice(Number(b.dataset.pf), 1); renderProjFiles(); } };
$('#projFileInput').onchange = async (e) => {
  for (const file of e.target.files) {
    try {
      let text;
      if (/\.(pdf|docx|pptx)$/i.test(file.name)) {
        const form = new FormData(); form.append('file', file);
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail);
        text = body.text;
      } else if (file.size < 1_000_000) text = await readFile(file, 'Text');
      else throw new Error('too large');
      projEdit.files.push({ name: file.name, text });
    } catch (err) { toast(`${file.name}: ${err.message}`, 'error'); }
  }
  e.target.value = '';
  renderProjFiles();
};
$('#projSave').onclick = async () => {
  const data = { name: $('#projName').value.trim() || 'New project', icon: $('#projIcon').value.trim() || '📁', instructions: $('#projInstructions').value, files: projEdit.files };
  const p = projEdit.id ? await api(`/api/projects/${projEdit.id}`, json('PUT', data)) : await api('/api/projects', json('POST', data));
  $('#projectDlg').close();
  await loadProjects();
  if (!projEdit.id) { setProject(p.id); newChat(); }
  toast(projEdit.id ? 'Project saved' : `📁 ${p.name} created — new chats go into it`);
};
$('#projDelete').onclick = async () => {
  if (!confirm('Delete this project? Its chats are kept and moved back to your main list.')) return;
  await api(`/api/projects/${projEdit.id}`, { method: 'DELETE' });
  $('#projectDlg').close();
  setProject(null);
  await loadProjects();
  await loadChats();
};

let moveTarget = null;
function openMoveMenu(chatId, anchor) {
  moveTarget = chatId;
  const chat = state.chats.find((c) => c.id === chatId);
  const menu = $('#moveMenu');
  menu.innerHTML = `<div class="muted small" style="padding:6px 12px">Move to…</div>` +
    state.projects.map((p) => `<button type="button" data-move="${p.id}"${chat?.project_id === p.id ? ' disabled' : ''}>${escapeHtml(p.icon || '📁')} ${escapeHtml(p.name)}</button>`).join('') +
    `<button type="button" data-move=""${!chat?.project_id ? ' disabled' : ''}>No project</button><button type="button" data-move="__new">+ New project…</button>`;
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - 200)}px`;
  menu.hidden = false;
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
}
document.addEventListener('click', (e) => { if (!e.target.closest('#moveMenu') && !e.target.closest('[data-act="move"]')) $('#moveMenu').hidden = true; });
$('#moveMenu').onclick = async (e) => {
  const b = e.target.closest('[data-move]');
  if (!b || !moveTarget) return;
  $('#moveMenu').hidden = true;
  if (b.dataset.move === '__new') { openProjectEditor(null); return; }
  const project_id = b.dataset.move || null;
  await api(`/api/conversations/${moveTarget}`, json('PUT', { project_id }));
  if (state.chat?.id === moveTarget) state.chat.project_id = project_id;
  await loadChats();
  loadProjects();
  toast(project_id ? `Moved to ${state.projects.find((p) => p.id === project_id)?.name}` : 'Moved out of the project');
};

// ------------------------------------------------------------ flashcard decks
async function saveDeck(widget) {
  const cards = cardsOf(widget);
  if (!cards.length) return;
  const name = (state.chat?.title || 'Flashcards').replace(/^(make|create)\s+(me\s+)?(\d+\s+)?/i, '').slice(0, 60) || 'Flashcards';
  try {
    const r = await api('/api/decks', json('POST', { name, cards }));
    toast(r.added ? `💾 Saved ${r.added} card${r.added === 1 ? '' : 's'} to “${r.name}”` : `Those cards are already in “${r.name}”`, '', {
      action: { label: 'Review', fn: () => startReview(r.id) },
    });
    refreshDeckBadge();
  } catch (e) { toast(e.message, 'error'); }
}

async function refreshDeckBadge() {
  const d = await api('/api/decks').catch(() => null);
  if (!d) return null;
  $('#deckBadge').textContent = d.due;
  $('#deckBadge').hidden = !d.due;
  $('#deckBadge').title = `${d.due} card${d.due === 1 ? '' : 's'} due today`;
  state.streak = d.streak || { days: 0, today: false };
  renderStreak();
  return d;
}

const whenText = (ts) => {
  if (!ts) return '';
  const secs = ts - Date.now() / 1000;
  return secs < 3600 ? `in ${Math.max(1, Math.round(secs / 60))} min` : secs < 0.9 * 86400 ? `in ${Math.round(secs / 3600)} h` : Math.round(secs / 86400) === 1 ? "tomorrow" : `in ${Math.round(secs / 86400)} days`;
};

// 🔥 Days in a row you've studied (flashcard reviews or the Study tab).
function streakText() {
  const { days = 0, today = false } = state.streak || {};
  if (!days) return '';
  if (!today) return `🔥 ${days}-day study streak · study today to keep it going!`;
  return `🔥 ${days}-day study streak${days >= 30 ? ' · legendary! 🏆' : days >= 7 ? ' · on fire!' : ''}`;
}
function renderStreak() {
  const box = $('#streakBox');
  const text = streakText();
  box.hidden = !text;
  box.textContent = text;
  box.classList.toggle('cold', !!text && !state.streak.today);
  if (state.mode === 'study' && !state.chat?.messages.length) { const el = $('.welcome .streak'); if (el) el.textContent = text; else if (text) renderMessages(); }
}

async function loadDecks() {
  const d = await refreshDeckBadge();
  if (!d) return;
  $('#reviewAll').hidden = !d.due;
  $('#reviewAll').textContent = `Review all due cards (${d.due})`;
  $('#deckList').innerHTML = d.decks.length ? d.decks.map((k) => `
    <div class="deck" data-id="${k.id}">
      <div class="dn"><span>${escapeHtml(k.name)}</span>${k.due ? `<span class="due">${k.due} due</span>` : ''}</div>
      <div class="dm">${k.total} cards · ${k.learned} learned${!k.due && k.next_due ? ` · next review ${whenText(k.next_due)}` : ''}</div>
      <div class="db">${k.due ? `<button class="primary" data-deck="review">Review ${k.due}</button>` : ''}<button data-deck="rename">Rename</button><button data-deck="delete">Delete</button></div>
    </div>`).join('') : '<p class="muted small" style="padding:8px">No decks yet. Ask Athena for flashcards in the Study tab, then press 💾 under them.</p>';
}
function openDecks() {
  $('#tasksDrawer').hidden = true; $('#savedDrawer').hidden = true;
  $('#decksDrawer').hidden = false;
  loadDecks();
}
$('#openDecks').onclick = () => ($('#decksDrawer').hidden ? openDecks() : ($('#decksDrawer').hidden = true));
$('#closeDecks').onclick = () => ($('#decksDrawer').hidden = true);
$('#openTasks').addEventListener('click', () => { $('#decksDrawer').hidden = true; });
$('#openSaved').addEventListener('click', () => { $('#decksDrawer').hidden = true; });
$('#reviewAll').onclick = () => startReview(null);
$('#deckList').onclick = async (e) => {
  const b = e.target.closest('[data-deck]');
  if (!b) return;
  const id = b.closest('.deck').dataset.id;
  const act = b.dataset.deck;
  if (act === 'review') startReview(id);
  if (act === 'rename') {
    const name = prompt('Deck name', b.closest('.deck').querySelector('.dn span').textContent);
    if (name) { await api(`/api/decks/${id}`, json('PATCH', { name })); loadDecks(); }
  }
  if (act === 'delete' && confirm('Delete this deck and all its cards?')) { await api(`/api/decks/${id}`, { method: 'DELETE' }); loadDecks(); }
};

// Review session
const review = { queue: [], done: 0, shown: false };
async function startReview(deckId) {
  const { cards } = await api(`/api/review${deckId ? `?deck=${deckId}` : ''}`);
  review.queue = cards;
  review.done = 0;
  review.again = 0;
  $('#reviewTitle').textContent = deckId ? (cards[0]?.deck || 'Review') : 'Review all decks';
  $('#reviewDlg').showModal();
  showReviewCard();
}
function showReviewCard() {
  const body = $('#reviewBody');
  const card = review.queue[0];
  $('#reviewCount').textContent = card ? `${review.queue.length} left` : '';
  if (!card) {
    body.innerHTML = `<div class="review-done"><b>🎉 All done!</b>You reviewed ${review.done} card${review.done === 1 ? '' : 's'}${review.again ? ` — ${review.again} to practice again soon` : ''}.<br><span class="muted small">Come back tomorrow for the next ones.</span></div>`;
    refreshDeckBadge();
    if (!$('#decksDrawer').hidden) loadDecks();
    return;
  }
  review.shown = false;
  body.innerHTML = `<div class="review-deck">${escapeHtml(card.deck)}</div>
    <div class="review-card">${inlineMarkdownFull(card.front)}</div>
    <button type="button" class="primary review-show" id="reviewShow">Show answer <span class="muted small">(Space)</span></button>`;
  $('#reviewShow').onclick = revealReview;
}
function revealReview() {
  const card = review.queue[0];
  if (!card || review.shown) return;
  review.shown = true;
  $('#reviewShow').remove();
  const p = card.preview || {};
  $('#reviewBody').insertAdjacentHTML('beforeend', `<div class="review-card back">${inlineMarkdownFull(card.back)}</div>
    <div class="review-actions">
      <button type="button" data-grade="again">Again<small>${p.again || ''} · 1</small></button>
      <button type="button" data-grade="hard">Hard<small>${p.hard || ''} · 2</small></button>
      <button type="button" data-grade="good">Good<small>${p.good || ''} · 3</small></button>
      <button type="button" data-grade="easy">Easy<small>${p.easy || ''} · 4</small></button>
    </div>`);
}
async function gradeReview(grade) {
  const card = review.queue.shift();
  if (!card) return;
  review.done++;
  try {
    const updated = await api(`/api/review/${card.deck_id}/${card.id}`, json('POST', { grade }));
    if (grade === 'again') { review.again++; review.queue.push({ ...card, ...updated, preview: { again: '10m', hard: '12h', good: '1d', easy: '4d' } }); }
  } catch (e) { toast(e.message, 'error'); }
  showReviewCard();
}
$('#reviewBody').addEventListener('click', (e) => { const g = e.target.closest('[data-grade]'); if (g) gradeReview(g.dataset.grade); });
$('#reviewClose').onclick = () => { $('#reviewDlg').close(); refreshDeckBadge(); };
$('#reviewDlg').addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!review.shown) revealReview(); }
  const g = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[e.key];
  if (g && review.shown) gradeReview(g);
});
const inlineMarkdownFull = (t) => renderMarkdown(String(t || '').replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$/g, '$1$\\displaystyle $2$'));

// ------------------------------------------------------------ setup wizard
const wiz = { step: 0, hw: null, downloading: false };
const WIZ_STEPS = ['welcome', 'models', 'voice', 'you', 'done'];
const ROLE_NAMES = { assistant: 'Chat', study: 'Study & math', code: 'Code', voice: 'Voice chat', vision: 'Photos & screen', documents: 'Your documents' };

async function openWizard(step = 0) {
  wiz.step = step;
  $('#wizard').showModal();
  await renderWizard();
}

function wzStatus(kind, title, note = '') {
  return `<div class="wz-status ${kind}"><span class="dot"></span><div>${title}${note ? `<small>${note}</small>` : ''}</div></div>`;
}

async function renderWizard() {
  const name = WIZ_STEPS[wiz.step];
  $('#wizardDots').innerHTML = WIZ_STEPS.map((_, i) => `<span class="${i === wiz.step ? 'on' : ''}"></span>`).join('');
  $('#wizardBack').hidden = wiz.step === 0;
  $('#wizardSkip').hidden = wiz.step === WIZ_STEPS.length - 1;
  $('#wizardNext').textContent = name === 'done' ? 'Start chatting' : name === 'models' ? 'Next' : 'Next';
  $('#wizardNext').disabled = false;
  const body = $('#wizardBody');
  if (name === 'welcome') {
    await refreshStatus();
    body.innerHTML = `<div class="big-logo">${logoSvg()}</div><h2>Welcome to Athena</h2>
      <p class="lead">Let's get you set up. It takes a few minutes, and after this everything runs offline on your PC.</p>
      ${state.status.engine?.mode === 'builtin'
        ? (state.status.engine.in_use && state.status.ollama ? wzStatus('ok', 'Athena’s own engine is running', 'Her brain runs on your PC. No Ollama needed.')
          : wzStatus('warn', engineLine(state.status.engine), 'One-time download of her engine and brain. It carries on in the background; you can keep going.'))
        : state.status.ollama ? wzStatus('ok', `Ollama is running (version ${escapeHtml(state.status.ollama_version || '?')})`, 'This is the engine that runs the AI models.')
        : wzStatus('bad', 'Ollama isn’t running yet', 'Install it from ollama.com/download (one time), open it, then click Check again.')}
      ${state.status.ollama ? '' : '<button type="button" class="ghost" id="wzRecheck">Check again</button>'}`;
    $('#wzRecheck')?.addEventListener('click', renderWizard);
  } else if (name === 'models' && state.status.engine?.mode === 'builtin') {
    const eng = state.status.engine;
    body.innerHTML = `<h2>Athena's brain</h2>
      <p class="lead">Athena runs one brain of her own: it chats, codes, uses her tools${/pictures/.test(eng.brain_label) ? ' and sees pictures' : ''}. It downloads by itself, once.</p>
      ${wzStatus(eng.state === 'ready' ? 'ok' : 'warn', escapeHtml(eng.brain_label), eng.state === 'ready' ? 'Downloaded and ready.' : engineLine(eng))}
      <p class="muted small">You can pick a different brain later in Settings → Models → Engine.</p>`;
  } else if (name === 'models') {
    body.innerHTML = '<h2>Your AI models</h2><p class="lead">Checking your PC…</p>';
    wiz.hw = wiz.hw || await api('/api/system').catch(() => null);
    const hw = wiz.hw;
    if (!hw) { body.innerHTML += wzStatus('bad', 'Couldn’t check your PC'); return; }
    const have = new Set(modelNames().flatMap((n) => [n, n.replace(/:latest$/, '')]));
    const gpu = hw.gpus[0];
    body.innerHTML = `<h2>Your AI models</h2>
      <div class="wz-hw">${gpu ? `Graphics card: <b>${escapeHtml(gpu.name)}</b> with <b>${gpu.vram_gb} GB</b> of memory` : 'No dedicated graphics card found — models will run on your processor (slower)'} · System memory: <b>${hw.ram_gb} GB</b></div>
      <p class="lead">These are the best models for your PC. Tick what you want and press <b>Download</b> — you can use Athena while they download.</p>
      <ul class="wz-models">${hw.models.map((m) => `
        <li data-model="${m.name}"><input type="checkbox" ${have.has(m.name) ? 'checked disabled' : m.optional && !(m.roles.includes('vision') && hw.vram_gb >= 8) ? '' : 'checked'}>
          <div><div class="nm">${m.name}</div><div class="roles">${m.roles.map((r) => ROLE_NAMES[r] || r).join(' · ')}${m.optional ? ' · optional' : ''}</div><div class="prog"></div></div>
          <span class="sz">${have.has(m.name) ? '✓ installed' : m.size_gb ? `${m.size_gb} GB` : ''}</span></li>`).join('')}</ul>
      <button type="button" class="primary" id="wzDownload">Download selected</button> <span class="muted small" id="wzTotal"></span>`;
    const total = () => {
      const gb = [...body.querySelectorAll('li')].filter((li) => { const c = li.querySelector('input'); return c.checked && !c.disabled; })
        .reduce((a, li) => a + (hw.models.find((m) => m.name === li.dataset.model)?.size_gb || 0), 0);
      $('#wzTotal').textContent = gb ? `about ${gb.toFixed(1)} GB to download` : 'Nothing to download';
    };
    body.querySelectorAll('input').forEach((c) => c.addEventListener('change', total));
    total();
    $('#wzDownload').onclick = wizardDownload;
  } else if (name === 'voice') {
    await refreshStatus();
    const s = state.status;
    body.innerHTML = `<h2>Voice</h2><p class="lead">Talk to Athena and hear her answer — fully offline.</p>
      ${s.whisper ? wzStatus('ok', 'Speech recognition is installed', 'Athena can hear you.') : wzStatus('warn', 'Speech recognition isn’t installed yet', 'Close Athena, double-click install-voice.bat, then start Athena again.')}
      ${s.kokoro ? wzStatus('ok', 'Athena’s natural voice is installed') : wzStatus('warn', 'Natural voice isn’t installed yet', 'install-voice.bat adds it too. Until then she uses your Windows voices.')}
      <label style="display:block;margin:14px 0 6px">Her voice</label>
      <div class="pull-row"><select id="wzVoice">${Object.entries(s.kokoro_voices || { athena_silk: 'Athena Silk' }).map(([id, l]) => `<option value="${id}">${escapeHtml(l)}</option>`).join('')}</select>
      <button type="button" class="ghost" id="wzTest">▶ Test</button></div>`;
    $('#wzVoice').value = state.settings.kokoro_voice || 'athena_silk';
    $('#wzVoice').onchange = (e) => saveSettings({ kokoro_voice: e.target.value });
    $('#wzTest').onclick = () => { speaker.stop(); speaker.reset(); speaker.say("Hi! I'm Athena. It's nice to meet you."); };
  } else if (name === 'you') {
    body.innerHTML = `<h2>About you</h2><p class="lead">So Athena can make it personal.</p>
      <label style="display:block;margin-bottom:12px">Your name<input id="wzName" class="wz-input" placeholder="What should Athena call you?" value="${escapeHtml(state.settings.user_name || '')}"></label>
      <label style="display:block;margin-bottom:12px">Personality<select id="wzPersona" class="wz-input">${Object.entries(BUILTIN_PERSONAS).map(([id, l]) => `<option value="${id}">${escapeHtml(l)}</option>`).join('')}</select></label>
      <label style="display:block">Accent colour</label><div class="swatches" id="wzAccents"></div>`;
    $('#wzPersona').value = state.settings.persona || 'assistant';
    const drawAccents = () => {
      $('#wzAccents').innerHTML = Object.entries(ACCENTS).map(([id, a]) => `<button type="button" class="swatch${id === (state.settings.accent || 'gold') ? ' active' : ''}" data-accent="${id}"><span style="background:linear-gradient(135deg, ${a.logo[0]}, ${a.logo[1]})"></span>${a.name}</button>`).join('');
    };
    drawAccents();
    $('#wzAccents').onclick = async (e) => {
      const id = e.target.closest('[data-accent]')?.dataset.accent;
      if (!id) return;
      state.settings.accent = id; applyTheme(); drawAccents();
      await saveSettings({ accent: id });
    };
  } else {
    body.innerHTML = `<div class="big-logo">${logoSvg()}</div><h2>You're all set${state.settings.user_name ? `, ${escapeHtml(state.settings.user_name)}` : ''}!</h2>
      <p class="lead">A few things to try:</p>
      <ul style="line-height:1.9;margin-top:0">
        <li>Click the gold <b>voice button</b> and just talk</li>
        <li>Open the <b>Study</b> tab: <i>“quiz me on fractions”</i></li>
        <li>Type <b>/</b> for quick commands, or press <b>?</b> for shortcuts</li>
        <li><i>“Remind me at 6pm to call mom”</i> · <i>“Organize my Downloads”</i></li>
      </ul>
      <button type="button" class="ghost" id="wzHealth">Run a health check</button>`;
    $('#wzHealth').onclick = () => { finishWizard(); openSettings('health'); runHealth(); };
  }
}

async function wizardDownload() {
  if (wiz.downloading) return;
  const items = [...$$('#wizardBody .wz-models li')].filter((li) => { const c = li.querySelector('input'); return c.checked && !c.disabled; });
  if (!items.length) { toast('Nothing selected'); return; }
  wiz.downloading = true;
  $('#wzDownload').disabled = true;
  $('#wzDownload').textContent = 'Downloading…';
  for (const li of items) {
    const name = li.dataset.model;
    const prog = li.querySelector('.prog');
    try {
      await downloadModel(name, (frac, text) => { prog.textContent = text; });
      prog.textContent = '';
      li.querySelector('.sz').textContent = '✓ installed';
      li.querySelector('input').disabled = true;
    } catch (e) { prog.textContent = `Failed: ${e.message}`; }
  }
  await refreshModels();
  // Use the recommended models for each job (only ones that are installed).
  const picks = wiz.hw?.picks || {};
  const installed = new Set(modelNames().flatMap((n) => [n, n.replace(/:latest$/, '')]));
  const models = Object.fromEntries(Object.entries(picks).filter(([, m]) => installed.has(m)));
  if (Object.keys(models).length) await saveSettings({ models });
  if (installed.has('nomic-embed-text')) await saveSettings({ embed_model: 'nomic-embed-text' });
  wiz.downloading = false;
  $('#wzDownload').textContent = 'Done ✓';
  if (state.chat && !state.chat.messages.length) { state.chat.model = ''; renderModelButton(); renderMessages(); }
  toast('Models are ready');
}

async function finishWizard() {
  $('#wizard').close();
  if (!state.settings.setup_done) await saveSettings({ setup_done: true });
}

$('#wizardNext').onclick = async () => {
  if (WIZ_STEPS[wiz.step] === 'you') {
    await saveSettings({ user_name: $('#wzName').value.trim(), persona: $('#wzPersona').value });
  }
  if (wiz.step >= WIZ_STEPS.length - 1) { await finishWizard(); renderMessages(); return; }
  wiz.step++;
  renderWizard();
};
$('#wizardBack').onclick = () => { wiz.step = Math.max(0, wiz.step - 1); renderWizard(); };
$('#wizardSkip').onclick = () => { finishWizard(); };
$('#wizard').addEventListener('cancel', (e) => { e.preventDefault(); });
$('#wizardAgain').onclick = () => { dlg.close(); openWizard(); };

// ------------------------------------------------------------ health check
let healthReport = '';
async function runHealth() {
  const list = $('#healthList');
  $('#healthRun').disabled = true;
  $('#healthRun').textContent = 'Checking… (can take a minute)';
  list.innerHTML = '<li class="skip"><span class="spin"></span><span>Testing each part of Athena…</span></li>';
  const checks = [];
  // Browser-side checks
  const b = async (name, fn) => { try { const [status, detail] = await fn(); checks.push({ name, status, detail }); } catch (e) { checks.push({ name, status: 'fail', detail: e.message }); } };
  await b('Microphone (this window)', async () => {
    if (!navigator.mediaDevices?.getUserMedia) return ['fail', 'Not allowed on this address — open Athena at http://localhost:8765'];
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = st.getAudioTracks()[0]?.label || 'microphone';
    st.getTracks().forEach((t) => t.stop());
    return ['ok', `Allowed · ${label}`];
  });
  await b('Speakers / audio', async () => {
    const ctx = new AudioContext(); const ok = ctx.state !== 'closed'; ctx.close();
    return ok ? ['ok', 'Audio output available'] : ['fail', 'Audio blocked'];
  });
  await b('Windows voices (fallback)', async () => {
    const v = await voicesReady();
    const offline = v.filter((x) => x.localService).length;
    return offline ? ['ok', `${offline} offline voices`] : ['warn', 'No offline system voices (only matters without the natural voice)'];
  });
  await b('Notifications', async () => {
    if (!('Notification' in window)) return ['warn', 'Not supported'];
    if (Notification.permission === 'default') await Notification.requestPermission();
    return Notification.permission === 'granted' ? ['ok', 'Allowed — reminders can pop up'] : ['warn', 'Blocked — reminders still show inside Athena'];
  });
  try {
    const server = await api('/api/selftest');
    checks.unshift(...server.checks);
  } catch (e) { checks.unshift({ name: 'Athena server', status: 'fail', detail: e.message }); }
  const icon = { ok: '✓', fail: '✗', warn: '!', skip: '–' };
  list.innerHTML = checks.map((c) => `<li class="${c.status}"><span class="ic">${icon[c.status] || '?'}</span><div><div class="nm">${escapeHtml(c.name)}</div><div class="dt">${escapeHtml(c.detail || '')}</div></div></li>`).join('');
  const n = (k) => checks.filter((c) => c.status === k).length;
  list.insertAdjacentHTML('beforeend', `<li class="${n('fail') ? 'fail' : 'ok'}"><span class="ic"></span><div class="health-summary">${n('ok')} working · ${n('warn')} to look at · ${n('fail')} not working · ${n('skip')} off or not set up</div></li>`);
  healthReport = `Athena health check — ${new Date().toLocaleString()}\n` + checks.map((c) => `${icon[c.status]} ${c.name}: ${c.detail}`).join('\n');
  $('#healthCopy').hidden = false;
  $('#healthRun').disabled = false;
  $('#healthRun').textContent = 'Check again';
}
$('#healthRun').onclick = runHealth;
$('#healthCopy').onclick = async () => { await copyText(healthReport); toast('Report copied — paste it to share'); };

// ------------------------------------------------------------ boot
// ------------------------------------------------------------ photo editor
const pe = { src: '', original: '', filter: '' };
function peFilterCss() {
  const v = (id) => Number($(id).value);
  const w = v('#peWarm');
  const parts = [`brightness(${v('#peBright')})`, `contrast(${v('#peContrast')})`, `saturate(${v('#peSat')})`];
  if (w > 0) parts.push(`sepia(${(w * 0.16).toFixed(2)})`, `saturate(${(1 + w * 0.12).toFixed(2)})`);
  if (w < 0) parts.push(`hue-rotate(${(w * 14).toFixed(1)}deg)`, `saturate(${(1 + w * 0.15).toFixed(2)})`);
  if (v('#peBlur')) parts.push(`blur(${v('#peBlur') / 2}px)`);
  parts.push({ grayscale: 'grayscale(1)', sepia: 'sepia(1)', invert: 'invert(1)', enhance: 'contrast(1.1) saturate(1.15)' }[pe.filter] || '');
  return parts.join(' ');
}
function pePreview() {
  $('#peImg').style.filter = peFilterCss();
  $('#peFrame').classList.toggle('vignette', pe.filter === 'vignette');
  $('#peTextPreview').textContent = $('#peText').value;
  $('#peTextPreview').dataset.pos = $('#peTextPos').value;
}
function peResetAdjust() {
  $('#peBright').value = 1; $('#peContrast').value = 1; $('#peSat').value = 1; $('#peWarm').value = 0; $('#peBlur').value = 0;
  $('#peText').value = ''; pe.filter = '';
  $$('#peFilters button').forEach((b) => b.classList.toggle('on', !b.dataset.f));
}
function peSetImage(src) {
  pe.src = src;
  $('#peImg').src = src;
  $('#peImg').onload = () => { $('#peSize').textContent = `${$('#peImg').naturalWidth} × ${$('#peImg').naturalHeight}`; };
  pePreview();
}
function openPhotoEditor(src) {
  pe.original = src;
  peResetAdjust();
  peSetImage(src);
  $('#photoDlg').showModal();
}
async function peServer(steps, busyText, draft = true) {
  $('#peBusyText').textContent = busyText;
  $('#peBusy').hidden = false;
  try {
    return await api('/api/images/edit', json('POST', { source: pe.src, steps, draft }));
  } catch (e) { toast(e.message, 'error'); return null; } finally { $('#peBusy').hidden = true; }
}
['#peBright', '#peContrast', '#peSat', '#peWarm', '#peBlur', '#peText', '#peTextPos'].forEach((id) => $(id).addEventListener('input', pePreview));
$('#peFilters').onclick = (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  pe.filter = b.dataset.f;
  $$('#peFilters button').forEach((x) => x.classList.toggle('on', x === b));
  pePreview();
};
$('#peGeo').onclick = async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const step = b.dataset.crop ? { op: 'crop', aspect: b.dataset.crop } : b.dataset.rot ? { op: 'rotate', amount: Number(b.dataset.rot) } : { op: 'flip' };
  const r = await peServer([step], 'One moment…');
  if (r) peSetImage(r.image);
};
$('#peRemoveBg').onclick = async () => {
  const r = await peServer([{ op: 'remove_background' }], 'Removing the background… (the first time takes a minute or two)');
  if (r) { peSetImage(r.image); $('#peNote').textContent = 'Background removed. Save keeps it see-through (PNG).'; }
};
$('#peReset').onclick = () => { peResetAdjust(); peSetImage(pe.original); };
$('#peClose').onclick = () => $('#photoDlg').close();
$('#peSave').onclick = async () => {
  const v = (id) => Number($(id).value);
  const steps = [];
  if (v('#peBright') !== 1) steps.push({ op: 'brightness', amount: v('#peBright') });
  if (v('#peContrast') !== 1) steps.push({ op: 'contrast', amount: v('#peContrast') });
  if (v('#peSat') !== 1) steps.push({ op: 'saturation', amount: v('#peSat') });
  if (v('#peWarm')) steps.push({ op: 'warm', amount: v('#peWarm') });
  if (pe.filter) steps.push({ op: pe.filter });
  if (v('#peBlur')) steps.push({ op: 'blur', amount: v('#peBlur') / 2 });
  if ($('#peText').value.trim()) steps.push({ op: 'text', text: $('#peText').value.trim(), position: $('#peTextPos').value });
  const r = await peServer(steps, 'Saving…', false);
  if (!r) return;
  $('#photoDlg').close();
  toast(`Saved to ${r.saved_to}`);
  if (state.chat) {  // show it in the chat, ready to edit again or download
    state.chat.messages.push({ role: 'assistant', content: "Here's your edited photo.", time: Date.now(),
      tools: [{ id: `pe${Date.now()}`, name: 'edit_image', args: {}, result: r }] });
    renderMessages();
    scrollBottom(true);
    saveChat();
  }
};
messagesEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pic-edit]');
  if (!btn) return;
  e.preventDefault();
  const img = btn.closest('.pic-wrap')?.querySelector('img');
  if (img) openPhotoEditor(img.getAttribute('src'));
});

// ------------------------------------------------------------ automatic backups
async function loadBackups() {
  let r;
  try { r = await api('/api/backups'); } catch { return; }
  const label = { daily: 'Daily', manual: 'Made by you', 'before-update': 'Before an update', 'before-restore': 'Before a restore' };
  $('#bkList').innerHTML = r.backups.length ? r.backups.map((b) => `<li><div><b>${new Date(b.time * 1000).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
      <span class="muted small">${label[b.kind] || b.kind} · ${b.size < 1e6 ? `${Math.max(1, Math.round(b.size / 1e3))} KB` : fmtSize(b.size)}</span></div><button type="button" class="ghost" data-restore="${escapeHtml(b.name)}">Restore</button></li>`).join('')
    : '<li class="muted small">No backups yet. The first one is made automatically, or click “Back up now”.</li>';
  $('#bkFolder').textContent = `Saved in ${r.folder}`;
}
$('#bkNow').onclick = async () => {
  $('#bkNow').disabled = true;
  try { await api('/api/backups', { method: 'POST' }); toast('Backed up ✓'); } catch (e) { toast(e.message, 'error'); }
  $('#bkNow').disabled = false;
  loadBackups();
};
$('#bkList').onclick = async (e) => {
  const name = e.target.closest('[data-restore]')?.dataset.restore;
  if (!name || !confirm('Go back to this backup? Your chats, memories and settings return to how they were then. (A copy of how things are now is saved first.)')) return;
  try {
    await api('/api/backups/restore', json('POST', { name }));
    toast('Restored ✓ Reloading…');
    setTimeout(() => location.reload(), 1200);
  } catch (err) { toast(err.message, 'error'); }
};

// ------------------------------------------------------------ updates
async function checkUpdate({ quiet = false } = {}) {
  if (!quiet) { $('#updStatus').textContent = 'Checking GitHub…'; $('#updCheck').disabled = true; }
  let r;
  try { r = await api('/api/update'); } catch (e) { r = { available: false, reason: e.message }; }
  $('#updCheck').disabled = false;
  $('#updApply').hidden = !r.available;
  $('#updChanges').hidden = !r.available;
  $('#updChanges').innerHTML = (r.changes || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
  $('#updStatus').textContent = r.available ? `✨ An update is ready (${r.count} change${r.count === 1 ? '' : 's'}). What's new:` : r.reason;
  if (r.available && quiet) toast(`✨ Athena update available: ${r.changes?.[0] || 'improvements'}`, '', { ms: 20000, action: { label: 'Update now', fn: applyUpdate } });
  return r;
}
async function applyUpdate() {
  if (state.abort) { toast('Wait for her to finish her reply, then update.', 'error'); return; }
  $('#updApply').disabled = true;
  toast('Updating… Athena will restart in a moment (your chats are backed up first).', '', { ms: 60000 });
  let r;
  try { r = await api('/api/update/apply', { method: 'POST' }); } catch (e) { toast(e.message, 'error'); $('#updApply').disabled = false; return; }
  if (r.note) { try { sessionStorage.setItem('athena-update-note', r.note); } catch { /* ignore */ } }
  waitForRestart(); // the old Athena closes, the new one starts, then the page reloads
}
$('#updCheck').onclick = () => checkUpdate();
$('#updApply').onclick = applyUpdate;

async function init() {
  $$('[data-logo]').forEach((el) => { el.outerHTML = logoSvg(); });
  const lock = await fetch('/api/lock').then((r) => r.json()).catch(() => ({}));
  if (lock.pin_set && !lock.unlocked) { showLock(); await new Promise((resolve) => unlockWaiters.push(resolve)); }
  state.settings = await api('/api/settings').catch(() => ({}));
  applyTheme();
  renderThinkBtn();
  mic.setDevice(state.settings.mic_device || '');
  // Start the sky straight away (the opening constellation plays while Athena connects).
  const stars = startStars($('#stars'), () => ({ shooting: state.settings.shooting_stars !== false, seasonal: state.settings.seasonal_effects !== false }));
  new MutationObserver(() => stars.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (stars.introPlaying()) { // the greeting fades in as the constellation drifts apart
    document.documentElement.classList.add('intro');
    setTimeout(() => document.documentElement.classList.remove('intro'), 2900);
  }
  if (isNarrow()) toggleSidebar(false);
  await refreshStatus();
  await refreshModels();
  refreshLoaded().then(preloadCurrentModel);
  if (state.settings.tts_engine === 'custom' && state.status.custom_voice) fetch('/api/custom-voice/warm', { method: 'POST' }).catch(() => {});
  initCanvas({ state, model: () => currentModel(), save: () => saveChat(), toast,
    onShow: () => { if (innerWidth < 1400 && innerWidth > 860) toggleSidebar(false); } });
  newChat();
  state.chat.startup = true;
  loadChats();
  loadProjects();
  loadTasks();
  voicesReady();
  connectEvents();
  setupIdleLock();
  resumeFocus();
  refreshDeckBadge();
  setInterval(refreshDeckBadge, 10 * 60000);
  try {  // something to tell you after an update restarted Athena
    const note = sessionStorage.getItem('athena-update-note');
    if (note) { sessionStorage.removeItem('athena-update-note'); toast(note, '', { ms: 12000 }); }
  } catch { /* ignore */ }
  if (!state.settings.setup_done) openWizard();
  else if (state.settings.update_check !== false) setTimeout(() => checkUpdate({ quiet: true }), 8000);
  $('#lockBtn').hidden = !state.settings.pin_set;
  if (new URLSearchParams(location.search).get('voice') === '1') {
    history.replaceState(null, '', location.pathname);
    startVoice();
  }

  // Reconnect automatically if Ollama starts later, and pick up newly pulled models.
  setInterval(async () => {
    const was = state.status.ollama;
    await refreshStatus();
    if (state.status.ollama !== was) {
      await refreshModels();
      if (state.chat && !state.chat.messages.length) renderMessages();
    }
  }, 8000);
}

init();

// ------------------------------------------------------------ 🧠 Athena's Brain (holographic map of her mind)
// The 3D version (three.js) loads only when you open it; PCs without WebGL get the flat version.
let brainMod = null;
const brainSignal = (...args) => brainMod?.brainSignal(...args);
$('#openBrain').addEventListener('click', async () => {
  if (isNarrow()) toggleSidebar(false);
  const opts = { api, toast, onAsk: (text) => sendMessage(text), style: 'athena', // her own look; the other styles are kept in brain.js but not offered
    onStyle: (k) => saveSettings({ brain_style: k }) };
  if (!brainMod) brainMod = await import('./brain3d.js').catch(() => null);
  if (!brainMod || brainMod.openBrain(opts) === false) {
    brainMod = await import('./brain.js');
    brainMod.openBrain(opts);
  }
});
