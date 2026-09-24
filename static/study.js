// Study mode widgets: interactive flashcards and practice quizzes built from the model's JSON blocks.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Parse the model's JSON, forgiving common slips (trailing commas, smart quotes, a wrapping object). */
function parseLoose(src) {
  let text = (src || '').trim().replace(/[“”]/g, '"');
  const tries = [text, text.replace(/,\s*([\]}])/g, '$1')];
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v;
      const arr = Object.values(v || {}).find(Array.isArray);
      if (arr) return arr;
    } catch { /* try the next repair */ }
  }
  return null;
}

function normCards(raw) {
  return (raw || []).map((c) => ({
    front: c.front ?? c.term ?? c.q ?? c.question ?? '',
    back: c.back ?? c.definition ?? c.a ?? c.answer ?? '',
  })).filter((c) => c.front && c.back);
}

function normQuiz(raw) {
  return (raw || []).map((x) => {
    const choices = x.choices ?? x.options ?? [];
    let answer = x.answer ?? x.correct ?? x.correct_answer ?? 0;
    if (typeof answer === 'string') {
      const letter = answer.trim().match(/^([A-Da-d])[).:]?$/);
      answer = letter ? 'abcd'.indexOf(letter[1].toLowerCase()) : Math.max(0, choices.findIndex((c) => String(c).trim().toLowerCase() === answer.trim().toLowerCase()));
    }
    return { q: x.q ?? x.question ?? '', choices, answer: Number(answer) || 0, explain: x.explain ?? x.explanation ?? '' };
  }).filter((x) => x.q && x.choices.length >= 2);
}

const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

/** Turn every .study-widget placeholder inside `root` into its widget. */
export function hydrateStudy(root, streaming) {
  root.querySelectorAll('.study-widget').forEach((w) => {
    const kind = w.dataset.kind;
    const data = parseLoose(w.dataset.src);
    const items = data && (kind === 'quiz' ? normQuiz(data) : normCards(data));
    if (!items || !items.length) {
      w.innerHTML = `<div class="study-building"><span class="spin"></span>${streaming ? `Building your ${kind === 'quiz' ? 'quiz' : 'flashcards'}…` : `Couldn't read the ${kind}. Try “regenerate”.`}</div>`;
      return;
    }
    if (kind === 'quiz') renderQuiz(w, items);
    else renderCards(w, items);
  });
}

// ------------------------------------------------------------ flashcards
function renderCards(w, cards) {
  w._fc = { cards, order: cards.map((_, i) => i), i: 0, flipped: false, known: new Set() };
  w.innerHTML = `<div class="flashcards">
    <div class="fc-top"><span class="fc-title">🃏 Flashcards</span><span class="fc-count"></span></div>
    <div class="fc-card" tabindex="0" title="Click or press Space to flip"><div class="fc-inner"><div class="fc-face fc-front"></div><div class="fc-face fc-back"></div></div></div>
    <div class="fc-bar">
      <button type="button" data-fc="prev" title="Previous (←)">‹</button>
      <button type="button" data-fc="flip">Flip</button>
      <button type="button" data-fc="known" title="Mark as known">✓ Got it</button>
      <button type="button" data-fc="shuffle" title="Shuffle">⤮</button>
      <button type="button" data-fc="next" title="Next (→)">›</button>
    </div>
    <div class="fc-progress"><div></div></div>
  </div>`;
  showCard(w);
}

function showCard(w) {
  const s = w._fc;
  const card = s.cards[s.order[s.i]];
  w.querySelector('.fc-front').innerHTML = inline(card.front);
  w.querySelector('.fc-back').innerHTML = inline(card.back);
  w.querySelector('.fc-card').classList.toggle('flipped', s.flipped);
  w.querySelector('.fc-card').classList.toggle('known', s.known.has(s.order[s.i]));
  w.querySelector('.fc-count').textContent = `${s.i + 1} / ${s.cards.length}${s.known.size ? ` · ${s.known.size} known` : ''}`;
  w.querySelector('.fc-progress div').style.width = `${(s.known.size / s.cards.length) * 100}%`;
}

export function flashcardAction(w, act) {
  const s = w._fc;
  if (!s) return;
  if (act === 'flip') s.flipped = !s.flipped;
  if (act === 'next' || act === 'prev') { s.i = (s.i + (act === 'next' ? 1 : -1) + s.cards.length) % s.cards.length; s.flipped = false; }
  if (act === 'known') {
    const id = s.order[s.i];
    s.known.has(id) ? s.known.delete(id) : s.known.add(id);
    if (s.known.size < s.cards.length && s.known.has(id)) { s.i = (s.i + 1) % s.cards.length; s.flipped = false; }
  }
  if (act === 'shuffle') {
    for (let i = s.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.order[i], s.order[j]] = [s.order[j], s.order[i]]; }
    s.i = 0; s.flipped = false;
  }
  showCard(w);
}

// ------------------------------------------------------------ quiz
function renderQuiz(w, qs) {
  w._qz = { qs, picks: new Array(qs.length).fill(null) };
  w.innerHTML = `<div class="quiz">
    <div class="fc-top"><span class="fc-title">📝 Practice quiz</span><span class="qz-count">${qs.length} questions</span></div>
    ${qs.map((q, i) => `
      <div class="qz-q" data-q="${i}">
        <div class="qz-text"><b>${i + 1}.</b> ${inline(q.q)}</div>
        <div class="qz-choices">${q.choices.map((c, j) => `<button type="button" data-choice="${j}"><span class="qz-letter">${'ABCDEF'[j] || j + 1}</span>${inline(c)}</button>`).join('')}</div>
        <div class="qz-explain" hidden></div>
      </div>`).join('')}
    <div class="qz-footer"><span class="qz-score">Answer the questions to see your score.</span><button type="button" data-quiz="retry" hidden>↻ Try again</button></div>
  </div>`;
}

export function quizAnswer(w, qi, choice) {
  const s = w._qz;
  if (!s || s.picks[qi] !== null) return;
  s.picks[qi] = choice;
  const q = s.qs[qi];
  const box = w.querySelector(`.qz-q[data-q="${qi}"]`);
  box.querySelectorAll('[data-choice]').forEach((b) => {
    const j = Number(b.dataset.choice);
    b.disabled = true;
    b.classList.toggle('right', j === q.answer);
    b.classList.toggle('wrong', j === choice && j !== q.answer);
  });
  const ok = choice === q.answer;
  const ex = box.querySelector('.qz-explain');
  ex.hidden = false;
  ex.innerHTML = `${ok ? '✅ Correct!' : `❌ The answer is <b>${'ABCDEF'[q.answer]}</b>.`} ${inline(q.explain)}`;
  const answered = s.picks.filter((p) => p !== null).length;
  const right = s.picks.filter((p, i) => p === s.qs[i].answer).length;
  const done = answered === s.qs.length;
  const pct = Math.round((right / s.qs.length) * 100);
  w.querySelector('.qz-score').innerHTML = done
    ? `<b>You got ${right} / ${s.qs.length} (${pct}%)</b> ${pct >= 90 ? '🏆 Amazing!' : pct >= 70 ? '🎉 Nice work!' : pct >= 50 ? '👍 Getting there!' : '📚 Keep practicing!'}`
    : `${right} correct so far · ${s.qs.length - answered} to go`;
  w.querySelector('[data-quiz="retry"]').hidden = !done;
}

export function quizRetry(w) {
  const s = w._qz;
  if (s) renderQuiz(w, s.qs);
}
