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
// Mortalize (the humanizer): rewrite so it sounds like a person wrote it (the strengths live in athena/humanize.py).
const HUMANIZE = [['light', 'Light touch'], ['medium', 'Natural'], ['strong', 'Strong rewrite'], ['voice', 'In my voice']];

let deps; // { state, model(), save(), toast() }
const ui = {};
const undo = [];
const redo = [];
let busy = null; // AbortController while she's rewriting
let saveTimer = 0;

export function initCanvas(d) {
  deps = d;
  Object.assign(ui, {
    root: $('#canvas'), title: $('#canvasTitle'), text: $('#canvasText'), preview: $('#canvasPreview'), hl: $('#canvasHighlight'),
    words: $('#canvasWords'), bar: $('#canvasBar'), barLabel: $('#canvasBarLabel'), ask: $('#canvasAsk'), askInput: $('#canvasAskInput'),
    report: $('#canvasReport'),
  });
  ui.bar.insertAdjacentHTML('beforeend', QUICK.map(([label], i) => `<button type="button" data-cq="${i}">${label}</button>`).join('') +
    `<select id="canvasTone" title="Change the tone"><option value="">Tone…</option>${TONES.map((t) => `<option>${t}</option>`).join('')}</select>` +
    '<select id="canvasHuman" title="Mortalize: make it sound like a person wrote it"></select>' +
    '<button type="button" id="canvasCheck" title="AI check: how predictable it is to Athena’s brain (like GPTZero)">🤖 Check</button>');
  fillHumanize();
  $('#canvasHuman').onchange = (e) => { const v = e.target.value; e.target.value = ''; if (v) humanizeAction(v); };
  $('#canvasCheck').onclick = () => check();
  ui.report.onclick = (e) => {
    if (e.target.closest('[data-rp="close"]')) ui.report.hidden = true;
    if (e.target.closest('[data-rp="highlight"]')) setHighlight(true);
  };
  ui.hl.onclick = () => setHighlight(false);
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
    if (act === 'highlight') setHighlight(ui.hl.hidden);
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
  lastCheck = null;
  ui.report.hidden = true;
  $('#canvasHead [data-cv="highlight"]').hidden = true;
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

/** Show the formatted document. The formatter already escapes what you typed; this also drops anything
 * that could run (scripts, event handlers, javascript: links) as a second safety net. */
function showFormatted(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => {
    if (/^on/i.test(a.name) || (/^(?:href|src|action|formaction|xlink:href)$/i.test(a.name) && !/^(?:https?:|mailto:|#|data:image\/)/i.test(a.value.trim()))) n.removeAttribute(a.name);
  }));
  ui.preview.replaceChildren(...doc.body.childNodes);
}

function changed() {
  const c = deps.state.chat?.canvas;
  if (c && !ui.root.hidden) { c.text = ui.text.value; c.title = ui.title.value; }
  countWords();
  if (ui.preview && !ui.preview.hidden) showFormatted(renderMarkdown(ui.text.value));
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
async function edit(instruction, extra = {}) {
  if (busy) return null;
  const model = deps.model();
  if (!model) { deps.toast('Download a model first (Settings → Models)', 'error'); return null; }
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
      body: JSON.stringify({ model, instruction, text: target.text, document: sel ? doc : '', ...extra }),
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
    const result = tidy(out, !!sel, true);
    ui.text.setSelectionRange(before.length, before.length + result.length);
    flash();
    return result;
  } catch (e) {
    if (e.name !== 'AbortError') { ui.text.value = doc; undo.pop(); deps.toast(e.message, 'error'); }
    return null;
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
  ui.hl.hidden = true;
  $('#canvasHead [data-cv="highlight"]').classList.remove('on');
  ui.preview.hidden = !on;
  ui.text.hidden = on;
  $('#canvasHead [data-cv="preview"]').classList.toggle('on', on);
  if (on) showFormatted(renderMarkdown(ui.text.value) || '<p class="muted">Nothing here yet.</p>');
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


// ------------------------------------------------------------- humanize

const samples = () => String(deps.state.settings?.writing_samples || '');

function fillHumanize() {
  const has = !!samples().trim();
  $('#canvasHuman').innerHTML = '<option value="">✍️ Mortalize…</option>' +
    HUMANIZE.map(([v, label]) => `<option value="${v}"${v === 'voice' && !has ? ' disabled' : ''}>${label}${v === 'voice' && !has ? ' (save a sample first)' : ''}</option>`).join('') +
    '<option disabled>──────────</option><option value="save-voice">Save selection as my voice</option>' +
    (has ? '<option value="forget-voice">Forget my voice sample</option>' : '');
}

async function saveSamples(text) {
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writing_samples: text }) });
  if (!res.ok) throw new Error(`Couldn't save (error ${res.status})`);
  deps.state.settings = await res.json();
  fillHumanize();
}

async function humanizeAction(v) {
  try {
    if (v === 'save-voice') {
      const sel = selection();
      if (!sel || (sel.text.match(/\S+/g) || []).length < 40) return deps.toast('Highlight at least a paragraph (40+ words) that YOU wrote, then pick this again.');
      const all = `${samples().trim()}\n\n${sel.text.trim()}`.trim().slice(-6000); // keep the newest ~6,000 characters
      await saveSamples(all);
      return deps.toast('Saved. "In my voice" will copy how you write.');
    }
    if (v === 'forget-voice') { await saveSamples(''); return deps.toast('Forgot your voice sample'); }
    const sel = selection();
    const target = sel ? sel.text : ui.text.value;
    if (!target.trim()) return deps.toast('Paste or write something first');
    const before = await score(target);
    showReport(before);
    const label = HUMANIZE.find(([k]) => k === v)?.[1] || 'Natural';
    const result = await edit(`Mortalize (${label})`, { mode: 'humanize', strength: v });
    if (result) { const base = ui.text.selectionStart; remember(await score(result), base, before); }
  } catch (e) { deps.toast(e.message, 'error'); }
}

async function score(text) {
  setChecking(true);
  try {
    const res = await fetch('/api/humanize/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(`Check failed (error ${res.status})`);
    return await res.json();
  } finally { setChecking(false); }
}

function setChecking(on) {
  const b = $('#canvasCheck');
  b.disabled = on;
  b.textContent = on ? '⏳ Checking…' : '🤖 Check';
  if (on) { ui.report.innerHTML = '<div class="muted small">Athena\'s brain is reading it word by word… (longer text takes up to a minute)</div>'; ui.report.hidden = false; }
}

async function check() {
  const sel = selection();
  const text = sel ? sel.text : ui.text.value;
  if (!text.trim()) return deps.toast('Nothing to check yet');
  const base = sel ? sel.a : 0;
  try { remember(await score(text), base); } catch (e) { ui.report.hidden = true; deps.toast(e.message, 'error'); }
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showReport(r, before) {
  if (r.score == null) { ui.report.hidden = true; return deps.toast(r.label); }
  const d = r.deep;
  const tone = r.score < 35 ? 'good' : r.score < 70 ? 'mid' : 'bad';
  const change = before?.score != null ? `<span class="muted">${before.score}% → </span>` : '';
  const stats = d
    ? `Surprise ${d.perplexity} <span class="muted">(how unpredictable the words are; low = AI-like)</span> · Variety ${d.burstiness ?? '–'} <span class="muted">(how much that changes between sentences; low = AI-like)</span> · ` +
      `${d.top10}% of words were in her top 10 guesses${d.truncated ? ` · checked the first ${d.checked_chars.toLocaleString()} characters` : ''}`
    : `Style check only · avg sentence ${r.avg_sentence} words · rhythm ${r.variation}`;
  ui.report.innerHTML = `
    <div class="rp-top">
      <b class="rp-score ${tone}">${change}${r.score}%</b>
      <span>${esc(r.label)}</span>
      <span class="rp-meter"><i class="${tone}" style="width:${r.score}%"></i></span>
      ${d?.spans ? '<button type="button" class="rp-hl" data-rp="highlight">🖍️ Highlight</button>' : ''}
      <button type="button" class="icon-btn" data-rp="close" title="Close">×</button>
    </div>
    <div class="small">${stats}</div>
    ${d?.sentences?.length ? `<div class="small">Most AI-like sentences:</div><ul class="rp-sents">${d.sentences.map((x) => `<li><b>${x.ai}%</b> ${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${r.tells.length ? `<div class="rp-tells">${r.tells.map((t) => `<span>${esc(t.phrase)}${t.count > 1 ? ` ×${t.count}` : ''}</span>`).join('')}</div>` : ''}
    ${r.tips.length ? `<div class="small">${r.tips.map(esc).join(' ')}</div>` : ''}
    ${r.note ? `<div class="small rp-note">${esc(r.note)}</div>` : ''}
    <div class="muted small">${d ? 'Checked the way GPTZero works (word surprise + sentence variety) using Athena\'s own brain, plus the style meter.' : 'Style meter only.'}
      Turnitin and GPTZero use their own trained models, so their numbers will differ.</div>`;
  ui.report.hidden = false;
}

// ------------------------------------------------- highlight view (like Turnitin's AI report)

let lastCheck = null; // { doc, base, r } from the last Check, so the highlights line up with the text

function remember(r, base, before) {
  lastCheck = r.deep?.spans ? { doc: ui.text.value, base, r } : null;
  $('#canvasHead [data-cv="highlight"]').hidden = !lastCheck;
  showReport(r, before);
}

const level = (ai) => (ai >= 70 ? 'hi' : ai >= 40 ? 'mid' : 'lo');

function highlightHtml() {
  const { doc, base, r } = lastCheck;
  const spans = r.deep.spans.map((s) => ({ a: base + s.start, b: base + s.end, ai: s.ai }));
  const paras = new Map(r.deep.paragraphs.map((p) => [base + p.start, p.ai]));
  const cuts = [...new Set([0, doc.length, ...spans.flatMap((s) => [s.a, s.b]), ...paras.keys()])]
    .filter((x) => x >= 0 && x <= doc.length).sort((x, y) => x - y);
  let html = '';
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const piece = esc(doc.slice(a, cuts[i + 1]));
    if (paras.has(a)) { const ai = paras.get(a); html += `<span class="hl-badge ${level(ai)}">¶ ${ai}% AI</span>`; }
    const s = spans.find((x) => x.a <= a && a < x.b);
    html += s && s.ai >= 40 ? `<mark class="${level(s.ai)}" title="${s.ai}% likely AI">${piece}</mark>` : piece;
  }
  const checked = r.deep.truncated ? ' Only the first part was checked.' : '';
  return `<div class="hl-legend"><b>${r.score}% AI overall</b> · <mark class="hi">likely AI (70%+)</mark> <mark class="mid">maybe (40–69%)</mark>
    unmarked = likely human · hover a sentence for its % · click to keep editing.${checked}</div><div class="hl-body">${html}</div>`;
}

function setHighlight(on) {
  if (on) {
    if (!lastCheck) return deps.toast('Run 🤖 Check first');
    if (ui.text.value !== lastCheck.doc) return deps.toast('The text changed since the check. Run 🤖 Check again.');
    setPreview(false);
    ui.hl.innerHTML = highlightHtml();
  }
  ui.hl.hidden = !on;
  ui.text.hidden = on;
  ui.report.hidden = on; // the highlight view has its own summary; bring the report back when you go back to editing
  $('#canvasHead [data-cv="highlight"]').classList.toggle('on', on);
}
