// PDF viewer: read a PDF in a panel next to the chat. It uses the browser's own PDF viewer, so zoom, page
// thumbnails, search (Ctrl+F) and print all work. "Open in canvas" copies the PDF's text into the writing canvas,
// where you can edit it, Mortalize it or ask the Oracle about it.

const $ = (s) => document.querySelector(s);

let deps; // { openCanvas({ text, title }), toast(msg, kind) }
let current = null; // { file, url }
const ui = {};

/** PDFs attached this session, by name, so their chips in the chat can open them here. (Not saved anywhere.) */
export const pdfFiles = new Map();
export const isPdf = (file) => file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));

export function initPdfView(d) {
  deps = d;
  Object.assign(ui, {
    root: $('#pdfView'), name: $('#pdfName'), frame: $('#pdfFrame'), empty: $('#pdfEmpty'), input: $('#pdfInput'),
    toCanvas: $('#pdfView [data-pv="canvas"]'),
  });
  ui.root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-pv]')?.dataset.pv;
    if (act === 'close') closePdf();
    if (act === 'open') ui.input.click();
    if (act === 'canvas') toCanvas();
  });
  ui.input.onchange = () => { const f = ui.input.files[0]; ui.input.value = ''; if (f) openPdf(f); };
  // Any chip for a PDF attached this session (in the composer or in a sent message) opens it here.
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pdf]');
    if (!chip || e.target.closest('[data-rm]')) return;
    const file = pdfFiles.get(chip.dataset.pdf);
    if (file) openPdf(file);
  });
}

export const pdfOpen = () => !!ui.root && !ui.root.hidden;

/** Show the empty viewer (drop or pick a PDF), or close it if it's already open. */
export function togglePdfView() {
  if (pdfOpen()) closePdf();
  else show();
}

export async function openPdf(file) {
  if (!isPdf(file)) return deps.toast(`${file?.name || 'That'} isn't a PDF`, 'error');
  if (current?.blob) URL.revokeObjectURL(current.url);
  pdfFiles.set(file.name, file);
  // Hand it to Athena's server so the viewer shows its real name; if that fails, show it straight from memory.
  let url = '';
  let blob = false;
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/pdfview', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `error ${res.status}`);
    url = `/api/pdfview/${body.id}/${encodeURIComponent(file.name)}`;
  } catch (err) {
    if (/isn't a PDF|too large/.test(err.message)) return deps.toast(err.message, 'error');
    url = URL.createObjectURL(file);
    blob = true;
  }
  current = { file, url, blob };
  ui.name.textContent = file.name;
  ui.name.title = file.name;
  show(); // first, so the viewer knows the panel's width and can fit the page to it
  // navpanes=0 hides the page-thumbnail strip, which crowds a side panel; it's one click away in the toolbar.
  ui.frame.src = `${url}#navpanes=0&view=FitH`;
}

export function closePdf() {
  ui.root.hidden = true;
  document.body.classList.remove('pdf-on');
  ui.frame.src = 'about:blank';
  if (current?.blob) URL.revokeObjectURL(current.url);
  current = null;
  ui.name.textContent = 'PDF viewer';
}

/** Is this point (from a drop) over the open viewer? Then the PDF goes here instead of into the chat. */
export function pdfViewHit(x, y) {
  if (!pdfOpen()) return false;
  const r = ui.root.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function show() {
  ui.root.hidden = false;
  document.body.classList.add('pdf-on');
  ui.frame.hidden = !current;
  ui.empty.hidden = !!current;
  ui.toCanvas.disabled = !current;
}

async function toCanvas() {
  if (!current) return;
  const form = new FormData();
  form.append('file', current.file);
  ui.toCanvas.disabled = true;
  deps.toast(`Reading ${current.file.name}…`);
  try {
    const res = await fetch('/api/extract', { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `Couldn't read it (error ${res.status})`);
    deps.openCanvas({ text: body.text, title: current.file.name.replace(/\.pdf$/i, '') });
    if (body.truncated) deps.toast('It\'s long, so the canvas has the first part');
  } catch (err) {
    deps.toast(err.message, 'error');
  } finally {
    ui.toCanvas.disabled = !current;
  }
}
