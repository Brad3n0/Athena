// Small, dependency-free Markdown renderer (works offline) with basic code highlighting.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const RUN_ICON = '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>';
const SAVE_ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

// ------------------------------------------------------------- highlighting
const KEYWORDS = new Set((
  'abstract and as assert async await break case catch class const continue def default del delete do elif else enum ' +
  'except export extends false final finally fn for from func function global go if impl import in instanceof interface ' +
  'is lambda let loop match mod mut namespace new nil none not null or package pass private protected pub public raise ' +
  'return self static struct super switch this throw throws trait true try type typeof use using var void where while ' +
  'with yield True False None echo then fi done esac local int float double char bool string long short unsigned auto'
).split(' '));
const HASH_COMMENT = new Set(['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'ruby', 'rb', 'yaml', 'yml', 'toml', 'r', 'perl', 'powershell', 'ps1', 'dockerfile', 'makefile', 'ini', 'conf']);
const NO_HIGHLIGHT = new Set(['text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'csv', 'log', 'output']);

export function highlight(code, lang) {
  lang = (lang || '').toLowerCase();
  if (NO_HIGHLIGHT.has(lang) || code.length > 60000) return esc(code);
  const hash = HASH_COMMENT.has(lang);
  const sql = lang === 'sql';
  const parts = [
    '(\\/\\*[\\s\\S]*?\\*\\/' + (hash ? '|#[^\\n]*' : '|\\/\\/[^\\n]*') + (sql || lang === 'lua' ? '|--[^\\n]*' : '') + (lang === 'html' || lang === 'xml' ? '|<!--[\\s\\S]*?-->' : '') + ')',
    '("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')',
    '(\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b)',
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()',
    '([A-Za-z_$][\\w$]*)',
  ];
  const re = new RegExp(parts.join('|'), 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [tok, com, str, num, fn, word] = m;
    if (com) out += `<span class="tok-com">${esc(com)}</span>`;
    else if (str) out += `<span class="tok-str">${esc(str)}</span>`;
    else if (num) out += `<span class="tok-num">${esc(num)}</span>`;
    else if (fn) out += KEYWORDS.has(fn) ? `<span class="tok-kw">${fn}</span>` : `<span class="tok-fn">${esc(fn)}</span>`;
    else if (word) out += KEYWORDS.has(sql ? word.toLowerCase() : word) || (sql && /^(select|from|where|insert|into|update|delete|join|left|right|inner|on|group|by|order|limit|values|set|create|table|drop|alter|and|or|not|as|having|distinct|count)$/i.test(word)) ? `<span class="tok-kw">${esc(word)}</span>` : esc(word);
    else out += esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last));
}

// ----------------------------------------------------------------- inline
function inline(text) {
  const codes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  text = esc(text);
  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => /^(https?:|data:image\/)/.test(src) ? `<img alt="${alt}" src="${src}" style="max-width:100%">` : alt)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => /^(https?:|mailto:|#)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${t}</a>` : t)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,!?;:'"])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

function codeBlock(code, lang) {
  const label = esc(lang || 'code');
  const runnable = /^(python|py|python3)$/i.test(lang || '');
  const run = runnable ? `<button type="button" data-run>${RUN_ICON}Run</button>` : '';
  return `<div class="code-block"><div class="code-head"><span>${label}</span><div class="code-actions">${run}<button type="button" data-save-code title="Save as a file">${SAVE_ICON}Save</button><button type="button" data-copy>${COPY_ICON}Copy code</button></div></div>` +
    `<pre><code data-lang="${label}">${highlight(code, lang)}</code></pre></div>`;
}

const splitRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// ------------------------------------------------------------------ blocks
export function renderMarkdown(src) {
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '', i = 0, para = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`; para = []; } };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code (tolerates an unclosed fence while streaming)
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (fence) {
      flush();
      const close = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++]);
      i++;
      html += codeBlock(body.join('\n'), fence[2]);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); html += `<h${h[1].length}>${inline(h[2].replace(/#+\s*$/, ''))}</h${h[1].length}>`; i++; continue; }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html += '<hr>'; i++; continue; }

    if (/^\s*>/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`;
      continue;
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      i += 2;
      let t = '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        t += '<tr>' + splitRow(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      }
      html += t + '</tbody></table>';
      continue;
    }

    // lists (nested by indentation)
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const block = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length) || (!lines[i].trim() && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1] || '')))) {
        block.push(lines[i++]);
      }
      html += renderList(block.filter((l) => l.trim()));
      continue;
    }

    para.push(line);
    i++;
  }
  flush();
  return html;
}

function renderList(lines) {
  const indent = (l) => l.match(/^\s*/)[0].length;
  const base = indent(lines[0]);
  const ordered = /^\s*\d+[.)]/.test(lines[0]);
  const start = ordered ? parseInt(lines[0].trim(), 10) : 1;
  let html = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
  let i = 0;
  while (i < lines.length) {
    const text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
    i++;
    const children = [];
    while (i < lines.length && indent(lines[i]) > base) children.push(lines[i++]);
    const task = text.match(/^\[([ xX])\]\s+(.*)/);
    const body = task ? `<input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}> ${inline(task[2])}` : inline(text);
    let inner = '';
    if (children.length) {
      inner = /^\s*([-*+]|\d+[.)])\s+/.test(children[0]) ? renderList(children) : `<br>${inline(children.map((c) => c.trim()).join(' '))}`;
    }
    html += `<li>${body}${inner}</li>`;
  }
  return html + (ordered ? '</ol>' : '</ul>');
}

// Plain text for the speech engine: drop code, markup and emoji.
export function toSpeech(src) {
  return (src || '')
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/```[\s\S]*?(```|$)/g, ' I put the code in the chat. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~#]+/g, '')
    .replace(/https?:\/\/\S+/g, 'the link')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
}
