// Writing canvas: a document editor next to the chat. Highlight text for quick AI edits
// (improve, shorten, change tone…), or ask for changes in the chat and she rewrites the document.
import { renderMarkdown } from './markdown.js';

const $ = (s) => document.querySelector(s);

export const QUICK = [
  ['Improve', 'Improve the writing: clearer, smoother and more engaging, same meaning.'],
  ['Shorter', 'Make it about half as long, keeping the key points.'],
  ['Longer', 'Expand it with more detail and examples, about 50% longer.'],
  ['Simpler', 'Rewrite it in simpler words that a 12-year-old would understand.'],
  ['Fix grammar', 'Fix spelling, grammar and punctuation only. Change nothing else.'],
];
const TONES = ['Formal', 'Casual', 'Friendly', 'Confident', 'Persuasive', 'Funny'];

let deps; // { state, model(), save(), toast() }
const ui = {};
const undo = [];
const redo = [];
let busy = null; // AbortController while she's rewriting
let saveTimer = 0;

export function initCanvas(d) {
  deps = d;
  Object.assign(ui, {
    root: $('#canvas'), title: $('#canvasTitle'), text: $('#canvasText'), preview: $('#canvasPreview'),
    words: $('#canvasWords'), bar: $('#canvasBar'), barLabel: $('#canvasBarLabel'), ask: $('#canvasAsk'), askInput: $('#canvasAskInput'),
  });
  ui.bar.insertAdjacentHTML('beforeend', QUICK.map(([label], i) => `<button type="button" data-cq="${i}">${label}</button>`).join('') +
    `<select id="canvasTone" title="Change the tone"><option value="">Tone…</option>${TONES.map((t) => `<option>${t}</option>`).join('')}</select>`);
  ui.bar.onclick = (e) => { const b = e.target.closest('[data-cq]'); if (b) edit(QUICK[b.dataset.cq][1]); };
  $('#canvasTone').onchange = (e) => { if (e.target.value) edit(`Rewrite it in a ${e.target.value.toLowerCase()} tone.`); e.target.value = ''; };
  ui.text.addEventListener('input', () => { changed(); });
  ui.text.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && undo.length) { e.preventDefault(); undoEdit(); }
    if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && redo.length) { e.preventDefault(); redoEdit(); }
  });
  // Snapshot for undo at the start of each typing burst.
  let typing = 0;
  ui.text.addEventListener('beforeinput', () => { if (!typing) snapshot(); clearTimeout(typing); typing = setTimeout(() => (typing = 0), 1200); });
  ['select', 'keyup', 'mouseup'].forEach((ev) => ui.text.addEventListener(ev, updateBarLabel));
  ui.title.addEventListener('input', changed);
  ui.ask.onsubmit = (e) => { e.preventDefault(); const v = ui.askInput.value.trim(); if (v) { ui.askInput.value = ''; edit(v); } };
  $('#canvasHead').onclick = (e) => {
    const act = e.target.closest('[data-cv]')?.dataset.cv;
    if (act === 'close') closeCanvas();
    if (act === 'preview') togglePreview();
    if (act === 'undo') undoEdit();
    if (act === 'copy') { navigator.clipboard?.writeText(ui.text.value).then(() => deps.toast('Copied the document')); }
    if (act === 'download') download();
    if (act === 'print') printDoc();
    if (act === 'stop') busy?.abort();
  };
}

export const canvasOpen = () => !!deps?.state.chat?.canvas?.open;

/** What the chat sends so she can see (and rewrite) the document. */
export function canvasForChat() {
  const c = deps?.state.chat?.canvas;
  return c?.open ? { open: true, title: c.title, text: c.text } : null;
}

export function openCanvas({ text, title } = {}) {
  const chat = deps.state.chat;
  const had = chat.canvas;
  chat.canvas = { open: true, title: title ?? had?.title ?? '', text: text ?? had?.text ?? '' };
  if (had?.text && text != null && text !== had.text) undo.push({ text: had.text });
  show();
  ui.text.focus();
  changed();
}

export function closeCanvas() {
  if (deps.state.chat?.canvas) deps.state.chat.canvas.open = false;
  ui.root.hidden = true;
  document.body.classList.remove('canvas-on');
  changed();
}

/** Call after switching chats: shows that chat's canvas, or hides the panel. */
export function syncCanvas() {
  if (!deps) return; // app still starting up
  undo.length = 0;
  redo.length = 0;
  busy?.abort();
  if (deps.state.chat?.canvas?.open) show(); else { ui.root.hidden = true; document.body.classList.remove('canvas-on'); }
}

function show() {
  const c = deps.state.chat.canvas;
  ui.title.value = c.title || '';
  ui.text.value = c.text || '';
  if (ui.root.hidden) deps.onShow?.();
  ui.root.hidden = false;
  document.body.classList.add('canvas-on');
  setPreview(false);
  updateBarLabel();
  countWords();
}

/** A reply with a ```canvas block replaces the document. */
export function applyCanvasReply(content) {
  const m = /```canvas[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(content || '');
  if (!m) return false;
  const text = m[1].replace(/\s+$/, '');
  const title = deps.state.chat.canvas?.title || (/^#\s+(.+)/m.exec(text)?.[1] ?? '').slice(0, 80);
  openCanvas({ text, title });
  flash();
  return true;
}

function changed() {
  const c = deps.state.chat?.canvas;
  if (c && !ui.root.hidden) { c.text = ui.text.value; c.title = ui.title.value; }
  countWords();
  if (ui.preview && !ui.preview.hidden) ui.preview.innerHTML = renderMarkdown(ui.text.value);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (deps.state.chat?.canvas && (deps.state.chat.id || ui.text.value.trim())) deps.save(); }, 800);
}

function countWords() {
  const n = (ui.text.value.match(/\S+/g) || []).length;
  ui.words.textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
}

function selection() {
  const { selectionStart: a, selectionEnd: b, value } = ui.text;
  return b - a > 1 ? { a, b, text: value.slice(a, b) } : null;
}

function updateBarLabel() {
  const sel = selection();
  const n = sel ? (sel.text.match(/\S+/g) || []).length : 0;
  ui.barLabel.textContent = sel ? `Selection (${n} word${n === 1 ? '' : 's'}):` : ui.text.value.trim() ? 'Whole document:' : 'Empty:';
}

function snapshot() {
  undo.push({ text: ui.text.value });
  if (undo.length > 100) undo.shift();
  redo.length = 0;
}
function undoEdit() {
  const prev = undo.pop();
  if (!prev) return deps.toast('Nothing to undo');
  redo.push({ text: ui.text.value });
  ui.text.value = prev.text;
  changed();
}
function redoEdit() {
  const next = redo.pop();
  if (!next) return;
  undo.push({ text: ui.text.value });
  ui.text.value = next.text;
  changed();
}

function setBusy(on) {
  ui.root.classList.toggle('busy', on);
  ui.text.readOnly = on;
  $('#canvasHead [data-cv="stop"]').hidden = !on;
}

/** Rewrite the selection (or the whole document, or write one from scratch) and stream it into place. */
async function edit(instruction) {
  if (busy) return;
  const model = deps.model();
  if (!model) return deps.toast('Download a model first (Settings → Models)', 'error');
  const doc = ui.text.value;
  const sel = selection();
  const target = sel || { a: 0, b: doc.length, text: doc };
  const before = doc.slice(0, target.a);
  const after = doc.slice(target.b);
  snapshot();
  setPreview(false);
  busy = new AbortController();
  setBusy(true);
  let out = '';
  try {
    const res = await fetch('/api/rewrite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: busy.signal,
      body: JSON.stringify({ model, instruction, text: target.text, document: sel ? doc : '' }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
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
        if (ev.error) throw new Error(ev.error);
        out += ev.t || '';
        ui.text.value = before + tidy(out, !!sel) + after;
      }
    }
    ui.text.value = before + tidy(out, !!sel, true) + after;
    if (!out.trim()) throw new Error('She returned nothing. Try again or pick another model.');
    ui.text.setSelectionRange(before.length, before.length + tidy(out, !!sel, true).length);
    flash();
  } catch (e) {
    if (e.name !== 'AbortError') { ui.text.value = doc; undo.pop(); deps.toast(e.message, 'error'); }
  } finally {
    busy = null;
    setBusy(false);
    changed();
    updateBarLabel();
  }
}

// Drop wrappers models sometimes add ("Here is the rewritten text:", ``` fences, <<< >>> markers).
function tidy(s, partial, final = false) {
  let t = s.replace(/^\s*(here(?:'s| is)[^\n]*:\s*\n)/i, '').replace(/^\s*<<<\s*\n?/, '').replace(/\n?>>>\s*$/, '');
  if (/^\s*```\w*\n/.test(t)) t = t.replace(/^\s*```\w*\n/, '').replace(/\n```\s*$/, '');
  if (final) t = partial ? t.trim() : t.trim() + '\n';
  return t;
}

function flash() {
  ui.text.classList.remove('flash');
  void ui.text.offsetWidth;
  ui.text.classList.add('flash');
}

function setPreview(on) {
  ui.preview.hidden = !on;
  ui.text.hidden = on;
  $('#canvasHead [data-cv="preview"]').classList.toggle('on', on);
  if (on) ui.preview.innerHTML = renderMarkdown(ui.text.value) || '<p class="muted">Nothing here yet.</p>';
}
function togglePreview() { setPreview(ui.preview.hidden); }

/** Print the formatted document (math included) on clean white pages. "Save as PDF" works from the same dialog. */
function printDoc() {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  const title = (ui.title.value.trim() || 'Document').replace(/[<>&]/g, '');
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <link rel="stylesheet" href="${new URL('vendor/katex/katex.min.css', location.href)}">
    <style>
      @page { margin: 12mm; }
      body { font: 11pt/1.45 Georgia, 'Times New Roman', serif; color: #111; margin: 0; }
      h1 { font-size: 17pt; margin: 0 0 6pt; } h2 { font-size: 13pt; margin: 10pt 0 4pt; border-bottom: 1px solid #ccc; }
      h3 { font-size: 11.5pt; margin: 8pt 0 3pt; } p, li { margin: 2pt 0; } ul, ol { padding-left: 16pt; margin: 3pt 0; }
      code { font-size: 9.5pt; background: #f3f3f3; padding: 0 3px; border-radius: 3px; }
      pre { background: #f6f6f6; padding: 6pt; border-radius: 4px; white-space: pre-wrap; font-size: 9.5pt; }
      table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 3pt 6pt; }
      .katex-display { margin: 4pt 0; } .code-head, .code-actions, button { display: none !important; }
    </style></head><body>${renderMarkdown(ui.text.value)}</body></html>`;
  frame.onload = () => {
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1000);
    }, 300); // let the math font load
  };
}

function download() {
  const name = (ui.title.value.trim() || 'Document').replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Document';
  const blob = new Blob([ui.text.value], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

