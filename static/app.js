// Athena AI — front-end app
import { renderMarkdown, toSpeech } from './markdown.js';
import { Mic, transcribe, browserRecognize, Speaker, voicesReady, listVoices } from './voice.js';
import { VoiceOrb } from './orb.js';

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
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
};

// Curated picks from the Ollama library. VRAM guidance is approximate (default 4-bit quantization).
const RECOMMENDED = [
  { name: 'gpt-oss:20b', role: 'Assistant', desc: "OpenAI's open-weight reasoning model. Excellent all-rounder with tool use. ~14 GB · 16 GB VRAM" },
  { name: 'qwen3:14b', role: 'Assistant', desc: 'Very smart, great tool use, thinks before answering. ~9 GB · 12 GB VRAM' },
  { name: 'qwen3:8b', role: 'Assistant', desc: 'Best pick for 8 GB graphics cards. ~5 GB' },
  { name: 'qwen3-coder:30b', role: 'Code', desc: 'Top local coding model (fast MoE). ~19 GB · 24 GB VRAM, or 32 GB system RAM' },
  { name: 'qwen2.5-coder:14b', role: 'Code', desc: 'Strong coder for 12–16 GB cards. ~9 GB' },
  { name: 'qwen2.5-coder:7b', role: 'Code', desc: 'Good coder for 8 GB cards. ~4.7 GB' },
  { name: 'qwen3:4b', role: 'Voice', desc: 'Quick, snappy replies for voice chat, supports tasks. ~2.5 GB' },
  { name: 'llama3.2:3b', role: 'Voice', desc: 'Very fast and light. ~2 GB' },
  { name: 'gemma3:12b', role: 'Vision', desc: 'Understands images you attach. ~8 GB · 12 GB VRAM' },
  // Community versions with the refusal behaviour removed. Slightly less polished than the originals.
  { name: 'huihui_ai/qwen3-abliterated:14b', role: 'Fewer refusals', desc: 'Community Qwen3 14B with refusals removed. ~9 GB · 12 GB VRAM' },
  { name: 'huihui_ai/qwen3-abliterated:8b', role: 'Fewer refusals', desc: 'Community Qwen3 8B with refusals removed. ~5 GB · 8 GB VRAM' },
  { name: 'dolphin3', role: 'Fewer refusals', desc: 'Dolphin 3 (Llama 3.1 8B), tuned to follow instructions without refusing. ~4.9 GB' },
];

// Preference order used when you haven't chosen a default model yet.
const PREFERENCE = {
  assistant: ['gpt-oss', 'qwen3:', 'qwen3', 'gemma3', 'llama3.1', 'mistral', 'llama3'],
  code: ['qwen3-coder', 'devstral', 'qwen2.5-coder', 'deepseek-coder', 'codestral', 'codellama', 'gpt-oss', 'qwen3'],
  voice: ['qwen3:4b', 'llama3.2', 'gemma3:4b', 'qwen3:1.7b', 'phi4-mini', 'qwen3:8b', 'gemma3', 'llama3.1', 'qwen3'],
};

const SUGGESTIONS = {
  assistant: [
    ['Plan my day', 'Help me plan a productive day and add the tasks to my list'],
    ["What's on my list?", 'What tasks do I still have to do?'],
    ['Explain like I’m 12', 'Explain how a CPU works like I’m 12 years old'],
    ['Write an email', 'Write a polite email asking my landlord to fix the heating'],
  ],
  code: [
    ['Build a website', 'Create a responsive landing page with HTML, CSS and a little JavaScript'],
    ['Write a Python script', 'Write a Python script that renames all photos in a folder by the date they were taken'],
    ['Explain this error', 'Explain what "TypeError: Cannot read properties of undefined" means and how to fix it'],
    ['Review my code', 'I will paste some code — review it for bugs, performance and readability'],
  ],
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
const speaker = new Speaker(() => ({ settings: state.settings, kokoro: !!state.status.kokoro }));

// ------------------------------------------------------------------- api
async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } };
  const res = await fetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
const json = (method, body) => ({ method, body: JSON.stringify(body) });

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'alarm' ? 15000 : 4500);
  el.onclick = () => el.remove();
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const t = state.settings.theme || 'dark';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// --------------------------------------------------------------- status
async function refreshStatus() {
  try { state.status = await api('/api/status'); } catch { state.status = { ollama: false }; }
  const el = $('#status');
  el.classList.toggle('ok', !!state.status.ollama);
  el.classList.toggle('bad', !state.status.ollama);
  $('#statusText').textContent = state.status.ollama ? `Ollama ${state.status.ollama_version || ''} · offline & private` : 'Ollama not running';
  const banner = $('#banner');
  if (!state.status.ollama) {
    banner.innerHTML = `<b>Can't reach Ollama.</b> Start the Ollama app (or run <code>ollama serve</code>), then this will connect automatically. Looking at <code>${escapeHtml(state.status.ollama_url || 'http://127.0.0.1:11434')}</code>.`;
    banner.hidden = false;
  } else banner.hidden = true;
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

// ---------------------------------------------------------- model picker
function currentModel() {
  if (!state.chat.model || !modelNames().includes(state.chat.model)) state.chat.model = pickDefaultModel(state.mode);
  return state.chat.model;
}

function renderModelButton() {
  if (!state.chat) return;
  $('#modelName').textContent = currentModel() || (state.models.length ? 'Select a model' : 'No models installed');
}

function openModelMenu() {
  const menu = $('#modelMenu');
  const cur = currentModel();
  menu.innerHTML = state.models.length
    ? state.models.map((m) => `
      <button class="opt" data-model="${escapeHtml(m.name)}">
        <div><div>${escapeHtml(m.name)}</div><div class="meta">${escapeHtml([m.parameters, m.family, fmtSize(m.size)].filter(Boolean).join(' · '))}</div></div>
        ${m.name === cur ? `<span class="check">${ICONS.check}</span>` : ''}
      </button>`).join('') + '<div class="hint">Download more in Settings → Models</div>'
    : '<div class="hint">No models yet. Open Settings → Models to download one.</div>';
  menu.hidden = false;
}

$('#modelBtn').onclick = (e) => { e.stopPropagation(); $('#modelMenu').hidden ? openModelMenu() : ($('#modelMenu').hidden = true); };
$('#modelMenu').onclick = (e) => {
  const opt = e.target.closest('[data-model]');
  if (!opt) return;
  state.chat.model = opt.dataset.model;
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
  $('#input').placeholder = mode === 'code' ? 'Ask Athena to write, explain or fix code' : 'Message Athena';
  renderModelButton();
  if (state.chat && !state.chat.messages.length) renderMessages();
}
$('#modeSwitch').onclick = (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode, { keepModel: false });
};

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

function renderSidebar() {
  const q = $('#searchChats').value.trim().toLowerCase();
  const list = $('#chatList');
  list.innerHTML = '';
  let group = '';
  for (const c of state.chats) {
    if (q && !(c.title || '').toLowerCase().includes(q)) continue;
    const g = groupLabel(c.updated || c.created || Date.now() / 1000);
    if (g !== group) { group = g; list.insertAdjacentHTML('beforeend', `<div class="chat-group">${g}</div>`); }
    const item = document.createElement('div');
    item.className = 'chat-item' + (state.chat?.id === c.id ? ' active' : '');
    item.dataset.id = c.id;
    item.innerHTML = `${c.mode === 'code' ? '<span class="mode-tag">&lt;/&gt;</span>' : ''}<span class="title">${escapeHtml(c.title || 'New chat')}</span>
      <span class="actions"><button data-act="rename" title="Rename">${ICONS.edit}</button><button data-act="delete" title="Delete">${ICONS.trash}</button></span>`;
    list.append(item);
  }
  if (!list.children.length) list.innerHTML = `<div class="chat-group">${q ? 'No matches' : 'Your chats will appear here'}</div>`;
}

$('#chatList').onclick = async (e) => {
  const item = e.target.closest('.chat-item');
  if (!item) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  const id = item.dataset.id;
  if (act === 'delete') {
    if (!confirm('Delete this chat?')) return;
    await api(`/api/conversations/${id}`, { method: 'DELETE' });
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.chat?.id === id) newChat();
    renderSidebar();
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
        await api(`/api/conversations/${id}`, json('PUT', { ...chat, title: t }));
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
  state.chat = { id: null, title: '', mode: state.mode, model: '', messages: [] };
  setMode(state.mode);
  renderMessages();
  renderSidebar();
  if (isNarrow()) toggleSidebar(false);
  $('#input').focus();
}
$('#newChat').onclick = newChat;
$('#newChatTop').onclick = newChat;

async function openChat(id) {
  stopGenerating();
  try {
    const chat = await api(`/api/conversations/${id}`);
    state.chat = { ...chat, messages: chat.messages || [] };
    setMode(chat.mode === 'code' ? 'code' : 'assistant', { keepModel: true });
    renderMessages();
    renderSidebar();
    if (isNarrow()) toggleSidebar(false);
  } catch (e) { toast(e.message, 'error'); }
}

async function saveChat() {
  const c = state.chat;
  if (!c.id) c.id = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  if (!c.title) {
    const first = c.messages.find((m) => m.role === 'user');
    c.title = (first?.display ?? first?.content ?? 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
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
function scrollBottom(force = false) { if (force || nearBottom()) messagesEl.scrollTop = messagesEl.scrollHeight; }

function renderWelcome() {
  const name = state.settings.user_name ? `, ${escapeHtml(state.settings.user_name)}` : '';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  let body;
  if (!state.status.ollama) {
    body = `<div class="setup-card"><h3>Almost there!</h3>
      <p>Athena needs <b>Ollama</b> running on this PC.</p>
      <ol><li>Install it from <code>ollama.com/download</code> (one time).</li><li>Open the Ollama app — it runs in your system tray.</li><li>This page connects automatically.</li></ol></div>`;
  } else if (!state.models.length) {
    body = `<div class="setup-card"><h3>Download your first model</h3>
      <p>Ollama is running but no AI models are installed yet. Open <b>Settings → Models</b> and download one — try <code>qwen3:8b</code> for chat and <code>qwen2.5-coder:7b</code> for code on an 8 GB graphics card.</p>
      <p><button class="primary" id="goModels">Open model downloads</button></p></div>`;
  } else {
    body = `<div class="suggestions">${SUGGESTIONS[state.mode === 'code' ? 'code' : 'assistant']
      .map(([t, p]) => `<button class="suggestion" data-prompt="${escapeHtml(p)}"><b>${escapeHtml(t)}</b>${escapeHtml(p)}</button>`).join('')}</div>`;
  }
  messagesEl.innerHTML = `<div class="welcome"><img src="logo.svg" alt=""><h1>${state.mode === 'code' ? `What are we building today${name}?` : `${greet}${name}`}</h1>${body}</div>`;
  $('#goModels')?.addEventListener('click', () => openSettings('models'));
}

messagesEl.addEventListener('click', async (e) => {
  const sug = e.target.closest('.suggestion');
  if (sug) { $('#input').value = sug.dataset.prompt; autosize(); $('#input').focus(); return; }

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
    case 'speak':
      if (speaker.speaking) speaker.stop();
      else { speaker.reset(); speaker.say(msg.content); }
      break;
    case 'retry':
      if (state.abort) return;
      state.chat.messages.splice(idx);
      renderMessages();
      await generateReply();
      break;
    case 'edit': {
      if (state.abort) return;
      $('#input').value = msg.display ?? msg.content;
      state.chat.messages.splice(idx);
      renderMessages();
      autosize();
      $('#input').focus();
      break;
    }
  }
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}

function renderMessages() {
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
  $$('.msg', messagesEl).forEach((el, i, all) => el.classList.toggle('last', i === all.length - 1));
}

function messageEl(m, idx) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.dataset.idx = idx;
  if (m.role === 'user') {
    const files = (m.files || []).map((f) => `<span class="file-chip">${ICONS.file}<span>${escapeHtml(f)}</span></span>`).join('');
    const imgs = (m.images || []).map((b64) => `<img class="thumb" src="data:image/*;base64,${b64}" alt="">`).join('');
    el.innerHTML = `<div class="col">${files || imgs ? `<div class="files">${imgs}${files}</div>` : ''}
      <div class="bubble">${escapeHtml(m.display ?? m.content)}</div>
      <div class="msg-actions"><button data-msg-act="edit" title="Edit">${ICONS.edit}</button><button data-msg-act="copy" title="Copy">${ICONS.copy}</button></div></div>`;
  } else {
    el.innerHTML = `<img class="avatar" src="logo.svg" alt=""><div class="body"><div class="content"></div><div class="msg-actions"></div></div>`;
    updateAssistantEl(el, m);
  }
  return el;
}

function splitThinking(m) {
  // Some models put their reasoning inline in <think> tags instead of the thinking field.
  let content = m.content || '';
  let thinking = m.thinking || '';
  const match = content.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (match) {
    thinking += match[1];
    content = match[2] ? content.slice(match.index + match[0].length) : '';
  }
  return { content, thinking, stillThinking: !!(m.streaming && (match ? !match[2] : m.thinking && !content)) };
}

function updateAssistantEl(el, m) {
  const { content, thinking, stillThinking } = splitThinking(m);
  const openSteps = new Set($$('.step[open]', el).map((d) => d.dataset.id));
  const steps = (m.tools || []).map((t, i) => stepHtml(t, i, openSteps)).join('');
  let html = steps ? `<div class="activity">${steps}</div>` : '';
  if (thinking.trim()) {
    const open = el.querySelector('.thinking-box')?.open ?? false;
    const label = stillThinking ? 'Thinking…' : `Thought${m.thinkSecs ? ` for ${m.thinkSecs}s` : ''}`;
    html += `<details class="thinking-box"${open ? ' open' : ''}><summary>${label}</summary><div class="think-text">${escapeHtml(thinking.trim())}</div></details>`;
  }
  if (content) html += `<div class="md">${renderMarkdown(content)}</div>`;
  if (m.error) html += `<p class="error-text">⚠ ${escapeHtml(m.error)}</p>`;
  if (m.streaming && !content && !m.error && !stillThinking) html += '<span class="typing"></span>';
  if (m.streaming && stillThinking && !thinking.trim()) html += '<span class="typing"></span>';
  el.querySelector('.content').innerHTML = html;

  const actions = el.querySelector('.msg-actions');
  if (m.streaming) { actions.innerHTML = ''; return; }
  const tps = m.stats?.eval_count && m.stats?.eval_duration ? `${(m.stats.eval_count / (m.stats.eval_duration / 1e9)).toFixed(1)} tok/s` : '';
  actions.innerHTML = `<button data-msg-act="copy" title="Copy">${ICONS.copy}</button>
    <button data-msg-act="speak" title="Read aloud">${ICONS.speak}</button>
    <button data-msg-act="retry" title="Regenerate">${ICONS.retry}</button>
    <span class="stats">${escapeHtml([m.model, tps].filter(Boolean).join(' · '))}</span>`;
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
  } else if (r?.results?.length) {
    detail = `<ul>${r.results.map((x) => `<li>${escapeHtml(x.path)} <span class="muted small">${escapeHtml(x.size || '')}</span></li>`).join('')}</ul>`;
  } else if (r?.items?.length) {
    detail = `<ul>${r.items.map((x) => `<li>${x.type === 'folder' ? '📁' : '📄'} ${escapeHtml(x.name)}</li>`).join('')}</ul>`;
  } else if (r?.into_folders) {
    detail = `<ul>${Object.entries(r.into_folders).map(([k, n]) => `<li>📁 ${escapeHtml(k)}: ${n} file${n === 1 ? '' : 's'}</li>`).join('')}</ul>`;
  } else if (r?.url && t.name === 'read_webpage') {
    detail = `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>`;
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
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#composer').onsubmit = (e) => {
  e.preventDefault();
  if (state.abort) return;
  const text = input.value.trim();
  if (!text && !state.attachments.length) return;
  input.value = '';
  autosize();
  sendMessage(text);
};
$('#stopBtn').onclick = stopGenerating;

function stopGenerating() {
  state.abort?.abort();
  state.abort = null;
  updateComposerButtons();
}

async function sendMessage(text, { voice = false } = {}) {
  if (!state.status.ollama) { await refreshStatus(); }
  const model = voice ? pickDefaultModel('voice') : currentModel();
  if (!model) { toast('Download a model first (Settings → Models).', 'error'); openSettings('models'); return; }

  const msg = { role: 'user', content: text, display: text };
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
  await generateReply({ voice, model });
}

async function generateReply({ voice = false, model = null } = {}) {
  const chat = state.chat;
  const mode = voice ? 'voice' : state.mode;
  model = model || currentModel();
  const reply = { role: 'assistant', content: '', thinking: '', tools: [], model, streaming: true };
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

  let raf = 0;
  const paint = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateAssistantEl(el, reply); scrollBottom(); });
  };
  const t0 = Date.now();
  let thinkStart = 0;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, mode, auto_approve: !!chat.autoApprove,
        messages: chat.messages.slice(0, -1).map(({ role, content, images }) => ({ role, content, images })),
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
        if (ev.type === 'token') {
          if (thinkStart && !reply.thinkSecs) reply.thinkSecs = Math.max(1, Math.round((Date.now() - thinkStart) / 1000));
          reply.content += ev.content;
          if (speakThis) speaker.feed(splitThinking(reply).content);
          if (voice) {
            const said = splitThinking(reply).content;
            setVoiceCaption(said, 'athena');
            if (/\b(ha(ha)+|he(he)+|yay|lol|hooray)\b|[♪♡]/i.test(said.slice(-40))) state.voice.avatar?.cheer?.();
          }
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
        }
        paint();
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') reply.error = err.message;
  } finally {
    if (state.abort === abort) state.abort = null;
    closeApproval();
    cancelAnimationFrame(raf);
    raf = 0;
    reply.streaming = false;
    if (!reply.thinking) delete reply.thinking;
    if (!reply.tools.length) delete reply.tools;
    const { content } = splitThinking(reply);
    if (speakThis && !abort.signal.aborted) speaker.feed(content, true);
    if (reply.error && speakThis) speaker.say(`Sorry, something went wrong. ${reply.error}`);
    if (!reply.content && !reply.error && abort.signal.aborted) reply.content = '_(stopped)_';
    updateAssistantEl(el, reply);
    updateComposerButtons();
    scrollBottom();
    if (chat === state.chat) {
      if (!chat.model) chat.model = model;
      await saveChat();
    }
  }
  return reply;
}

// ------------------------------------------------------------ attachments
const TEXT_EXT = /\.(txt|md|markdown|py|js|mjs|cjs|ts|tsx|jsx|json|html?|css|scss|less|c|h|cpp|hpp|cc|cs|java|kt|kts|go|rs|rb|php|swift|sh|bash|ps1|bat|cmd|sql|ya?ml|toml|ini|cfg|conf|xml|csv|tsv|log|lua|r|dart|vue|svelte|gradle|dockerfile|env|gitignore)$/i;
const LANG = { py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', rs: 'rust', rb: 'ruby', cs: 'csharp', kt: 'kotlin', sh: 'bash', ps1: 'powershell', yml: 'yaml', md: 'markdown', htm: 'html' };

$('#fileInput').onchange = async (e) => {
  for (const file of e.target.files) {
    if (file.type.startsWith('image/')) {
      const url = await readFile(file, 'dataURL');
      state.attachments.push({ kind: 'image', name: file.name, data: url.split(',')[1] });
    } else if (file.type.startsWith('text/') || TEXT_EXT.test(file.name) || file.type === 'application/json') {
      if (file.size > 400_000) { toast(`${file.name} is too large (max ~400 KB)`, 'error'); continue; }
      const ext = file.name.split('.').pop().toLowerCase();
      state.attachments.push({ kind: 'text', name: file.name, data: await readFile(file, 'Text'), lang: LANG[ext] || ext });
    } else {
      toast(`Can't read ${file.name} — attach text/code files or images.`, 'error');
    }
  }
  e.target.value = '';
  renderAttachments();
};

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
  $('#approvalAlways').checked = false;
  $('#approval').hidden = false;
  $('#approvalAllow').focus();
  if (voice) { speaker.reset(); speaker.say('I need your OK on screen first.'); }
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
  if (['add_task', 'complete_task', 'delete_task'].includes(ev.name)) loadTasks();
  if (ev.name === 'set_timer' && ev.result?.timer_set) startTimer(ev.result.seconds, ev.result.label);
}

function startTimer(seconds, label) {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  toast(`⏱ Timer started: ${fmtDuration(seconds)}${label ? ` — ${label}` : ''}`);
  setTimeout(() => {
    const text = `${label && label !== 'Timer' ? label : 'Your timer'} is done!`;
    toast(`⏰ ${text}`, 'alarm');
    chime();
    if ('Notification' in window && Notification.permission === 'granted') new Notification('Athena AI', { body: text, icon: 'logo.svg' });
    speaker.reset();
    speaker.say(`${state.settings.user_name ? `${state.settings.user_name}, ` : ''}${text}`);
  }, seconds * 1000);
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
    toast(e.message, 'error');
  } finally {
    dictating = null;
    btn.classList.remove('recording');
    btn.style.opacity = '';
    if (!state.voice.active) mic.close();
  }
};

// ------------------------------------------------------------ voice mode
const overlay = $('#voiceOverlay');

function setVoiceState(s, label) {
  overlay.dataset.state = s;
  state.voice.avatar?.setState({ listening: 'listening', transcribing: 'thinking', thinking: 'thinking', speaking: 'speaking' }[s] || 'idle');
  $('#voiceState').textContent = label || { listening: 'Listening…', transcribing: 'Got it…', thinking: 'Thinking…', speaking: 'Speaking — tap to interrupt', muted: 'Microphone muted' }[s] || s;
}
function setVoiceCaption(text, who) {
  const cap = $('#voiceCaption');
  cap.textContent = who === 'you' ? `“${text}”` : toSpeech(text).trim();
  cap.scrollTop = cap.scrollHeight;
}

$('#voiceBtn').onclick = startVoice;
$('#voiceEnd').onclick = endVoice;
$('#voiceMute').onclick = () => {
  mic.muted = !mic.muted;
  $('#voiceMute').classList.toggle('off', mic.muted);
  if (mic.muted) { state.voice.listenAbort?.abort(); setVoiceState('muted'); }
  else if (!speaker.speaking && !state.abort) setVoiceState('listening');
};
$('#avatarStage').onclick = () => {
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

async function startVoice() {
  if (!state.status.ollama) { toast('Ollama is not running.', 'error'); return; }
  const model = pickDefaultModel('voice');
  if (!model) { toast('Download a model first (Settings → Models).', 'error'); return; }
  state.voice.active = true;
  mic.muted = false;
  $('#voiceMute').classList.remove('off');
  overlay.hidden = false;
  $('#voiceModel').textContent = `Voice chat · ${model}${state.status.whisper ? ' · Whisper (offline)' : ''}`;
  $('#voiceCaption').textContent = '';
  showAvatar();
  setVoiceState('listening', 'Starting microphone…');
  await voicesReady();
  try {
    if (state.status.whisper) await mic.open();
  } catch (e) {
    toast(`Microphone error: ${e.message}`, 'error');
    endVoice();
    return;
  }
  speaker.onStart = () => state.voice.active && setVoiceState('speaking');
  speaker.onEnd = () => state.voice.active && state.abort && setVoiceState('thinking');
  if (state.settings.persona === 'companion' && !state.chat.messages.length) {
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
  voiceLoop();
}

function endVoice() {
  state.voice.active = false;
  state.voice.listenAbort?.abort();
  speaker.stop();
  speaker.onStart = speaker.onEnd = null;
  stopGenerating();
  mic.close();
  hideAvatar();
  overlay.hidden = true;
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
        const blob = await mic.record({ signal: abort.signal });
        if (!blob || !state.voice.active) continue;
        setVoiceState('transcribing');
        text = await transcribe(blob);
      } else {
        text = await browserRecognize({ signal: abort.signal });
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

    setVoiceCaption(text, 'you');
    setVoiceState('thinking');
    await sendMessage(text, { voice: true });
    await speaker.done();
    await sleep(250); // avoid picking up the tail of Athena's own voice
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  $('#setDirect').checked = !!s.direct_mode;
  $('#setPersona').value = s.persona || 'assistant';
  $('#setTtsEngine').value = s.tts_engine === 'system' ? 'system' : 'auto';
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

function switchTab(tab) {
  $$('.tabs button', dlg).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('[data-panel]', dlg).forEach((p) => (p.hidden = p.dataset.panel !== tab));
}
$('.tabs', dlg).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); };

function fillModelSelects() {
  for (const [id, mode] of [['#setModelAssistant', 'assistant'], ['#setModelCode', 'code'], ['#setModelVoice', 'voice']]) {
    const sel = $(id);
    const auto = pickDefaultModel(mode);
    sel.innerHTML = `<option value="">Automatic${auto ? ` (${escapeHtml(auto)})` : ''}</option>` +
      state.models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
    sel.value = modelNames().includes(state.settings.models?.[mode]) ? state.settings.models[mode] : '';
  }
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

const bind = (id, key, get = (el) => el.value) => $(id).addEventListener('change', (e) => saveSettings({ [key]: get(e.target) }));
bind('#setName', 'user_name');
bind('#setInstructions', 'custom_instructions');
bind('#setTheme', 'theme');
bind('#setTools', 'tools_enabled', (el) => el.checked);
bind('#setDirect', 'direct_mode', (el) => el.checked);
bind('#setMemory', 'memory_enabled', (el) => el.checked);
bind('#setFiles', 'files_enabled', (el) => el.checked);
bind('#setWeb', 'web_enabled', (el) => el.checked);
bind('#setConfirm', 'confirm_changes', (el) => el.checked);
bind('#setScreen', 'show_on_screen', (el) => el.checked);
bind('#setFolders', 'file_folders', (el) => el.value.split('\n').map((l) => l.trim()).filter(Boolean));

async function loadMemories() {
  const list = await api('/api/memories').catch(() => []);
  $('#memoryList').innerHTML = list.length
    ? list.slice().reverse().map((m) => `<li><span>${escapeHtml(m.text)}</span><button type="button" data-forget="${m.id}" title="Forget">${ICONS.trash}</button></li>`).join('')
    : '<li class="muted small">Nothing yet. Tell her “remember that…” and it shows up here.</li>';
}
$('#memoryList').onclick = async (e) => {
  const b = e.target.closest('[data-forget]');
  if (!b) return;
  await api(`/api/memories/${b.dataset.forget}`, { method: 'DELETE' });
  loadMemories();
};
bind('#setVoice', 'tts_voice');
bind('#setPersona', 'persona');
bind('#setTtsEngine', 'tts_engine');
bind('#setKokoroVoice', 'kokoro_voice');
bind('#setPitch', 'voice_pitch', (el) => Number(el.value));

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
async function pullModel(name) {
  if (pulling) { toast('A download is already running.'); return; }
  pulling = true;
  const box = $('#pullProgress'), bar = $('.bar', box), label = $('span', box);
  box.hidden = false;
  bar.style.width = '0';
  label.textContent = `Starting ${name}…`;
  $('#pullBtn').disabled = true;
  try {
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
        if (ev.total && ev.completed != null) {
          const pct = (ev.completed / ev.total) * 100;
          bar.style.width = `${pct}%`;
          label.textContent = `${name}: ${pct.toFixed(0)}% of ${fmtSize(ev.total)}`;
        } else label.textContent = `${name}: ${ev.status}`;
      }
    }
    if (failed) throw new Error(failed);
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
  if (e.key === 'Escape' && state.abort && !state.voice.active) stopGenerating();
});

// ------------------------------------------------------------ boot
async function init() {
  state.settings = await api('/api/settings').catch(() => ({}));
  applyTheme();
  if (isNarrow()) toggleSidebar(false);
  await refreshStatus();
  await refreshModels();
  newChat();
  loadChats();
  loadTasks();
  voicesReady();

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
