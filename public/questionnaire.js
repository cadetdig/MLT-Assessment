'use strict';
/* Previan Assessment App — the rater's questionnaire: guidelines, section-by-section
   answering with live guidance, progress, encouragement, review and submit.
   Loaded after app.js and rules.js. */

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const ROLE_PHRASE = { board: 'a member of the board', manager: 'their manager', peer: 'a peer', direct_report: 'a member of their team', customer: 'a client', other: 'someone who works with them' };

function tipsFor(isSelf, subj, a) {
  const range = a.scale.min + '–' + a.scale.max;
  return isSelf ? [
    'Think of specific situations: what did you actually do?',
    'Be candid with yourself. The most useful self-assessments are honest about areas for growth as well as strengths.',
    'Use the full ' + range + ' scale. Honest differences between statements make your results far more meaningful.',
    'Rate how you actually behave most of the time, not how you would like to.',
    'Detail makes your self-assessment meaningful: describe the situation, what you did, and the result.',
  ] : [
    'Think of a specific moment when you saw ' + subj + ' do this. Real examples are the most useful.',
    'Be honest. Candid, constructive feedback is one of the most valuable gifts you can give a leader.',
    'Use the full ' + range + ' scale. Ratings that reflect real differences help far more than the same number throughout.',
    'There are no right or wrong answers. Your own first-hand experience is what counts.',
    'Be fair and balanced: describe what works well and what could be better.',
    'The more detail you give, the more meaningful your feedback is to ' + subj + '. Describe the situation, what they did, and the impact.',
    'Keep it anonymous: describe what ' + subj + ' did, without details about your own name, role, or team.',
  ];
}

function milestoneMessage(pct, nextIsLast, isSelf, subj, rater) {
  if (isSelf) {
    if (nextIsLast) return 'Final section, you’re nearly done. Thank you for reflecting so thoughtfully.';
    if (pct < 30) return 'Good start. Honest self-reflection takes courage, and it makes the comparison with others’ feedback far more meaningful.';
    if (pct < 60) return 'Halfway through. Thank you for taking such a candid look at your own leadership.';
    return 'Steady progress. Keep being candid; this is for your own growth.';
  }
  if (nextIsLast) return 'Final section, ' + rater + '! You’re almost there. Thank you for staying with it. Your honesty here will make a real difference for ' + subj + '.';
  if (pct < 30) return 'Wonderful start! Thank you for the care you’re putting into this. Detailed, honest examples are exactly what make feedback like yours meaningful to ' + subj + '.';
  if (pct < 45) return 'You’re making great progress. Every comment you write helps ' + subj + ' see their leadership more clearly.';
  if (pct < 60) return 'Halfway there! Your time and candor are genuinely appreciated. Thank you for being so thoughtful.';
  return 'Well past halfway. Thoughtful, detailed feedback like yours is rare and truly valued. Keep going!';
}

function progressMessage(pct) {
  if (pct === 0) return 'Let’s begin, and thank you for your time.';
  if (pct < 25) return 'Great start. Thank you!';
  if (pct < 50) return 'You’re making real progress.';
  if (pct < 75) return 'Over halfway. Your input is truly valued.';
  if (pct < 100) return 'Almost there. Thank you for being so thorough.';
  return 'All done. Ready to review and submit!';
}

const anchorFor = (scale, v) => { const x = scale.anchors.find((r) => v >= r.from && v <= r.to); return x ? x.label : ''; };

async function viewQuestionnaire(id, invId) {
  loading(id, 'home');
  let data;
  try { data = await api('GET', '/api/my/' + invId); } catch (e) { return mount(id, topbar('home'), page('narrow', h('div', { class: 'error' }, e.message))); }
  const a = data.assessment;
  const isSelf = data.relationship === 'self';
  const subjFirst = firstName(a.subjectName);
  const subj = isSelf ? 'you' : subjFirst;
  const rater = firstName(data.raterName);
  const s = Rules.settingsOf(a);

  const answers = {};
  for (const q of a.questions) {
    const v = data.answers[q.id] || {};
    answers[q.id] = { rating: v.rating === undefined ? null : v.rating, comment: v.comment || '', strength: v.strength || '', development: v.development || '' };
    if (v.confirmedMatch) answers[q.id].confirmedMatch = true;
    if (v.confirmedAnonymous) answers[q.id].confirmedAnonymous = true;
  }
  if (data.submittedAt) return mount(id, topbar('home'), page('narrow', doneCard(a, data.submittedAt, answers, isSelf, rater)));
  if (a.status !== 'open') return mount(id, topbar('home'), page('narrow', h('div', { class: 'card' }, h('h2', null, 'This questionnaire is closed'), h('p', null, 'Please contact the person who invited you.'))));

  const sections = [];
  for (const q of a.questions) {
    let sec = sections.find((x) => x.name === q.category);
    if (!sec) { sec = { name: q.category, questions: [] }; sections.push(sec); }
    sec.questions.push(q);
  }
  const numberOf = new Map(a.questions.map((q, i) => [q.id, i + 1]));
  const total = a.questions.length;
  let res = Rules.check(a, a.questions, answers, data.identity);
  const qDone = (q) => res.byQuestion[q.id].length === 0;
  const sectionDone = (sec) => sec.questions.every(qDone);
  const firstOpen = () => { const i = sections.findIndex((sec) => !sectionDone(sec)); return i < 0 ? sections.length : i; };
  const pct = () => Math.round((res.completeCount / total) * 100);
  const tips = tipsFor(isSelf, subj, a);

  let accepted = Boolean(data.guidelinesAcceptedAt);
  let current = accepted ? firstOpen() : -1; // -1 = welcome & guidelines
  let banner = accepted && res.completeCount > 0
    ? { text: 'Welcome back' + (rater ? ', ' + rater : '') + '! You’re ' + pct() + '% of the way through. Thank you for continuing.' } : null;
  let showErrors = false;

  // ----- autosave
  let pending = null; let saving = false; let dirty = false; let sendAccepted = false;
  const savedEl = h('div', { class: 'saved', 'aria-live': 'polite' }, data.savedAt ? 'Saved ' + fmtDateTime(data.savedAt) : 'Your answers save automatically.');
  const save = async () => {
    if (saving) { clearTimeout(pending); pending = setTimeout(save, 700); return; }
    clearTimeout(pending); pending = null; saving = true; dirty = false;
    savedEl.className = 'saved'; savedEl.textContent = 'Saving…';
    try {
      const r = await api('PUT', '/api/my/' + invId + '/draft', { answers, acceptedGuidelines: sendAccepted || undefined });
      savedEl.textContent = 'Saved ✓ ' + fmtDateTime(r.savedAt);
    } catch (e) { dirty = true; savedEl.className = 'saved bad'; savedEl.textContent = 'Not saved yet. ' + e.message; }
    finally { saving = false; }
  };
  const scheduleSave = () => { dirty = true; clearTimeout(pending); pending = setTimeout(save, 900); };
  window.onbeforeunload = () => (dirty ? 'Your latest answers are still saving.' : undefined);

  // ----- persistent pieces
  const barFill = h('i');
  const stripCount = h('strong');
  const stripPct = h('span', { class: 'pct' });
  const stripMsg = h('span', { class: 'msg' });
  const strip = h('div', { class: 'q-strip', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'q-strip-in' },
      h('div', { class: 'q-strip-text' }, stripCount, stripMsg),
      h('div', { class: 'progress big' }, barFill), stripPct));
  const side = h('aside', { class: 'q-side' });
  const main = h('section', { class: 'q-main' });
  const cardRefs = new Map();

  function refreshProgress() {
    res = Rules.check(a, a.questions, answers, data.identity);
    const p = pct();
    barFill.style.width = p + '%';
    stripCount.textContent = res.completeCount + ' of ' + total + ' statements complete';
    stripPct.textContent = p + '%';
    stripMsg.textContent = progressMessage(p);
    drawSide();
  }

  const goTo = (i) => { current = i; showErrors = false; banner = null; drawMain(); drawSide(); };
  function drawSide() {
    const open = firstOpen();
    setKids(side,
      h('div', { class: 'eyebrow' }, isSelf ? 'Self-assessment' : 'Feedback for'),
      h('h2', null, a.subjectName),
      h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '4px 0 0' } }, [a.roleTitle, a.organization].filter(Boolean).join(' · ')),
      h('div', { class: 'sections' },
        h('button', { class: current === -1 ? 'active' : '', onclick: () => goTo(-1) }, h('span', null, 'Guidelines'), h('span', { class: accepted ? 'tick' : 'muted' }, accepted ? '✓' : '')),
        sections.map((sec, i) => {
          const n = sec.questions.filter(qDone).length;
          const locked = !accepted || i > open;
          return h('button', { class: (i === current ? 'active' : '') + (locked ? ' locked' : ''), disabled: locked, title: locked ? 'Complete the earlier sections first' : '',
            onclick: () => goTo(i) },
          h('span', null, sec.name), h('span', { class: n === sec.questions.length ? 'tick' : 'muted' }, locked ? '🔒' : n === sec.questions.length ? '✓' : n + '/' + sec.questions.length));
        }),
        h('button', { class: (current === sections.length ? 'active' : '') + (open < sections.length ? ' locked' : ''), disabled: open < sections.length,
          onclick: () => goTo(sections.length) }, h('span', null, 'Review & submit'), h('span', null, open < sections.length ? '🔒' : '→'))),
      savedEl);
  }

  // ----- one statement
  function placeholderFor(r) {
    const score = typeof r === 'number' ? r : null;
    if (isSelf) {
      if (score !== null && score <= s.lowCut) return 'Why a ' + score + '? Describe a real situation, what you did, and what got in the way. The more detail, the more useful your results.';
      return (score !== null ? 'Why a ' + score + '? ' : '') + 'Describe a real situation, what you did, and the result it had. The more detail, the more useful your results.';
    }
    if (score !== null && score <= s.lowCut) return 'Why a ' + score + '? Describe a situation you saw, what ' + subj + ' did, and the impact it had, and what you would like to see instead. The more detail, the more helpful.';
    if (score !== null && score >= s.highCut) return 'Why a ' + score + '? Describe a situation you saw, what ' + subj + ' did, and the impact it had. The more detail, the more helpful.';
    return (score !== null ? 'Why a ' + score + '? ' : '') + 'Describe a situation you saw, what ' + subj + ' did, and the impact it had. The more detail, the more helpful.';
  }

  const DETAIL = {
    below: ['', 'Keep going'],
    minimum: ['ok', 'Meets the minimum. More detail makes it more meaningful.'],
    good: ['good', 'Good detail. Thank you!'],
    excellent: ['great', '★ Excellent, rich detail. This is exactly what helps most.'],
  };

  function updateCard(q) {
    const ref = cardRefs.get(q.id);
    if (!ref) return;
    const ans = answers[q.id];
    const issues = res.byQuestion[q.id];
    const done = issues.length === 0;
    ref.card.classList.toggle('done', done);
    ref.card.classList.toggle('missing', showErrors && !done);
    ref.status.hidden = !done;
    const ratingIssue = issues.find((x) => x.code === 'rating');
    ref.ratingNote.hidden = !(showErrors && ratingIssue);
    if (!ref.quality) return;
    const na = ans.rating === 'na';
    ref.quality.hidden = na;
    ref.naNote.hidden = !na;
    if (na) return;
    const text = Rules.commentText(s, ans);
    const n = Rules.words(text).length;
    const need = Rules.wordsNeeded(s, ans.rating);
    const level = Rules.detailLevel(n, need);
    const has = (codes) => issues.find((x) => codes.includes(x.code));
    const lengthIssue = has(['empty', 'short']);
    const ownIssue = has(['placeholder', 'repetitive', 'restates', 'duplicate']);
    const idHard = has(['identity']);
    const idSoft = has(['identity-check']);
    const mis = has(['mismatch']);
    const rated = typeof ans.rating === 'number';
    // Detail meter: fills toward "excellent".
    const target = Math.max(need + 25, 45);
    ref.detailFill.style.width = Math.min(100, Math.round((n / target) * 100)) + '%';
    ref.detailFill.parentNode.className = 'detail-bar ' + (DETAIL[level][0] || '');
    ref.detailText.textContent = level === 'below' ? n + ' of ' + need + ' words' + (rated && Rules.isExtreme(s, ans.rating) ? ' (scores of ' + ans.rating + ' need a fuller explanation)' : '') + '. Keep going.' : DETAIL[level][1];
    ref.detailText.className = 'detail-text ' + (level === 'below' && showErrors ? 'bad' : DETAIL[level][0]);
    // Checklist
    const item = (el, state, label) => { el.className = 'qi ' + state; el.textContent = (state === 'ok' ? '✓ ' : state === 'bad' ? '! ' : '○ ') + label; };
    item(ref.ciLength, lengthIssue ? (showErrors ? 'bad' : 'todo') : 'ok', 'At least ' + need + ' words');
    item(ref.ciOwn, lengthIssue ? 'todo' : ownIssue ? 'bad' : 'ok', 'Specific, in your own words');
    item(ref.ciScore, !rated || lengthIssue || ownIssue ? 'todo' : mis ? 'bad' : 'ok', rated ? 'Explains your score of ' + ans.rating : 'Explains your score');
    item(ref.ciAnon, idHard ? 'bad' : idSoft ? 'bad' : n ? 'ok' : 'todo', isSelf ? 'Written in your own voice' : 'Doesn’t reveal who you are');
    // Messages that need the rater's attention
    const msg = idHard || ownIssue || (lengthIssue && showErrors && lengthIssue.code === 'empty' ? lengthIssue : null);
    ref.issueText.hidden = !msg;
    ref.issueText.textContent = msg ? msg.message : '';
    ref.misBox.hidden = !mis;
    if (mis) ref.misText.textContent = mis.message;
    ref.idBox.hidden = !(idSoft && !idHard);
    if (idSoft && !idHard) ref.idText.textContent = idSoft.message;
  }

  function questionCard(q) {
    const ans = answers[q.id];
    const card = h('article', { class: 'q-card', id: 'q-' + q.id });
    const status = h('span', { class: 'q-status', hidden: true }, '✓ Complete');
    const ratingLabel = h('span', { class: 'rating-label' }, typeof ans.rating === 'number' ? ans.rating + ' · ' + anchorFor(a.scale, ans.rating) : ans.rating === 'na' ? 'Not observed' : '');
    const ratingNote = h('div', { class: 'field-note bad', hidden: true }, 'Please choose a rating from ' + s.min + ' to ' + s.max + '.');
    const buttons = [];
    const boxes = [];
    const setRating = (v) => {
      if (ans.rating !== v) delete ans.confirmedMatch;
      ans.rating = v;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
      ratingLabel.textContent = typeof v === 'number' ? v + ' · ' + anchorFor(a.scale, v) : 'Not observed';
      boxes.forEach((t) => { t.placeholder = placeholderFor(v); });
      changed(q);
    };
    for (let v = s.min; v <= s.max; v++) {
      buttons.push(h('button', { type: 'button', 'data-v': String(v), 'aria-pressed': String(ans.rating === v), 'aria-label': 'Rate ' + v + ' (' + anchorFor(a.scale, v) + ')', onclick: () => setRating(v) }, String(v)));
    }
    if (s.allowNotObserved) buttons.push(h('button', { type: 'button', class: 'na', 'data-v': 'na', 'aria-pressed': String(ans.rating === 'na'), onclick: () => setRating('na') }, 'Not observed'));
    const box = (key, label) => {
      const t = h('textarea', { placeholder: placeholderFor(ans.rating), maxlength: '4000', value: ans[key], rows: 4, 'aria-label': label });
      t.addEventListener('input', () => { ans[key] = t.value; changed(q); });
      boxes.push(t);
      return h('div', { class: 'c-box' }, h('label', null, label), t);
    };
    const req = s.commentsRequired ? ' (required)' : ' (optional)';
    const commentArea = s.commentMode === 'split'
      ? h('div', { class: 'comments' }, box('strength', 'Strength'), box('development', 'Development need'))
      : h('div', { class: 'comments one' }, box('comment', (isSelf ? 'Explain your score' : 'Explain your score: what you have observed') + req));
    const refs = { card, status, ratingNote };
    let quality = null;
    if (s.commentsRequired) {
      refs.detailFill = h('i');
      refs.detailText = h('span', { class: 'detail-text' });
      refs.ciLength = h('span'); refs.ciOwn = h('span'); refs.ciScore = h('span'); refs.ciAnon = h('span');
      refs.issueText = h('div', { class: 'field-note bad', hidden: true });
      refs.misText = h('span');
      refs.misBox = h('div', { class: 'confirm-box', hidden: true }, refs.misText,
        h('button', { type: 'button', class: 'btn small', onclick: () => { ans.confirmedMatch = true; changed(q); } }, 'Yes, my comment supports this score'));
      refs.idText = h('span');
      refs.idBox = h('div', { class: 'confirm-box', hidden: true }, refs.idText,
        h('button', { type: 'button', class: 'btn small', onclick: () => { ans.confirmedAnonymous = true; changed(q); } }, 'I’ve checked: this doesn’t identify me'));
      quality = h('div', { class: 'quality' },
        h('div', { class: 'sbi' }, h('span', null, 'A strong comment covers:'), h('b', null, '① the situation'), h('b', null, '② what ' + (isSelf ? 'you' : subj) + ' did'), h('b', null, '③ the impact it had')),
        h('div', { class: 'detail' }, h('span', { class: 'detail-bar' }, refs.detailFill), refs.detailText),
        h('div', { class: 'checklist' }, refs.ciLength, refs.ciOwn, refs.ciScore, refs.ciAnon),
        refs.issueText, refs.misBox, refs.idBox);
      refs.quality = quality;
      refs.naNote = h('div', { class: 'field-note', hidden: true }, 'No comment is needed for “Not observed”.');
    }
    card.append(
      h('div', { class: 'q-top' }, h('div', { class: 'q-num' }, 'Statement ' + numberOf.get(q.id) + ' of ' + total + (q.name ? ' · ' + q.name : '')), status),
      h('div', { class: 'q-statement' }, q.statement),
      h('div', { class: 'scale' + (s.max - s.min === 9 ? ' n10' : ''), role: 'group', 'aria-label': 'Rating' }, buttons),
      h('div', { class: 'anchors' }, a.scale.anchors.map((x) => h('span', null, h('b', null, x.from === x.to ? x.from : x.from + '–' + x.to), ' ', x.label)), ratingLabel),
      ratingNote, commentArea, quality, refs.naNote || null);
    cardRefs.set(q.id, refs);
    return card;
  }

  function changed(q) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const wasDone = qDone(q);
    refreshProgress();
    // Duplicate checks can change other statements' status, so refresh the whole section.
    cardRefs.forEach((_, qid) => { const qq = a.questions.find((x) => x.id === qid); if (qq) updateCard(qq); });
    if (showErrors && current >= 0 && current < sections.length && sectionDone(sections[current])) { showErrors = false; attention.hidden = true; cardRefs.forEach((_, qid) => updateCard(a.questions.find((x) => x.id === qid))); }
    else if (showErrors) drawAttention();
    if (!wasDone && qDone(q)) { /* a small moment of thanks happens in the meter text */ }
    scheduleSave();
  }

  const attention = h('div', { class: 'warn', hidden: true, role: 'alert' });
  function drawAttention() {
    const sec = sections[current];
    const open = sec.questions.filter((q) => !qDone(q));
    attention.hidden = !open.length;
    setKids(attention, h('strong', null, open.length === 1 ? 'One statement in this section still needs attention.' : open.length + ' statements in this section still need attention.'),
      ' They’re highlighted below. Every statement needs a rating' + (s.commentsRequired ? ' and a comment of at least ' + s.minWords + ' words' : '') + ' before you can continue.');
  }

  // ----- pages
  function drawMain() {
    cardRefs.clear();
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    window.scrollTo({ top: 0 });
    if (current === -1) return drawWelcome();
    if (current === sections.length) return drawReview();
    const sec = sections[current];
    const ratings = sec.questions.map((q) => answers[q.id].rating).filter((r) => typeof r === 'number');
    const sameScore = sectionDone(sec) && sec.questions.length >= 3 && ratings.length === sec.questions.length && new Set(ratings).size === 1;
    const nextBtn = h('button', { class: 'btn primary big', onclick: () => {
      if (!sectionDone(sec)) {
        showErrors = true;
        cardRefs.forEach((_, qid) => updateCard(a.questions.find((x) => x.id === qid)));
        drawAttention();
        const firstBad = sec.questions.find((q) => !qDone(q));
        const el = document.getElementById('q-' + firstBad.id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('Statement ' + numberOf.get(firstBad.id) + ': ' + res.byQuestion[firstBad.id][0].message);
        return;
      }
      showErrors = false;
      save();
      const nextIsLast = current + 1 === sections.length - 1;
      banner = current + 1 < sections.length ? { text: milestoneMessage(pct(), nextIsLast, isSelf, subjFirst, rater), star: true } : null;
      current++;
      drawMain(); drawSide();
    } }, current + 1 < sections.length ? 'Next: ' + sections[current + 1].name + ' →' : 'Review & submit →');
    setKids(main,
      banner ? h('div', { class: 'q-banner' + (banner.star ? ' star' : '') }, banner.star ? h('span', { class: 'q-banner-icon', 'aria-hidden': 'true' }, '★') : null, h('span', null, banner.text)) : null,
      h('div', { class: 'eyebrow' }, 'Section ' + (current + 1) + ' of ' + sections.length),
      h('h1', { style: { marginBottom: '6px' } }, sec.name),
      h('p', { class: 'tip-line' }, h('span', { 'aria-hidden': 'true' }, '💡 '), tips[current % tips.length]),
      sec.questions.map(questionCard),
      attention,
      sameScore ? h('div', { class: 'notice', style: { marginTop: '14px' } }, 'You’ve given every statement in this section the same score (' + ratings[0] + '). That’s fine if it reflects your experience. Just make sure each rating stands on its own.') : null,
      h('div', { class: 'q-nav' },
        current > 0 ? h('button', { class: 'btn', onclick: () => { current--; banner = null; showErrors = false; drawMain(); drawSide(); } }, '← ' + sections[current - 1].name) : h('span'),
        nextBtn));
    banner = null;
    sec.questions.forEach(updateCard);
  }

  function drawWelcome() {
    const phrase = ROLE_PHRASE[data.relationship] || 'someone who works with them';
    const guidelines = [
      ['Rate every statement from ' + s.min + ' to ' + s.max + '.', s.allowNotObserved ? 'If you truly have not had the chance to observe a behavior, choose “Not observed”.' : 'Every statement must be rated. None can be skipped.'],
      s.commentsRequired ? ['Explain every score with a detailed comment.', 'At least ' + s.minWords + ' words' + (s.minWordsExtreme > s.minWords ? ' (' + s.minWordsExtreme + ' for scores of ' + s.min + '–' + s.lowCut + ' or ' + s.max + ')' : '') + '. Describe the situation, what ' + (isSelf ? 'you' : subjFirst) + ' did, and the impact it had. ' + (isSelf ? 'The more detail, the more meaningful your results.' : 'Detail is what makes your feedback truly meaningful to ' + subjFirst + '. The more, the better.')] : null,
      s.commentsRequired ? ['Make each comment fit its score, in your own words.', 'Your comment should clearly support the number you chose. Don’t simply repeat the statement, reuse a comment, or write placeholders like “N/A” or “OK”.'] : null,
      s.commentsRequired && !isSelf ? ['Keep your comments anonymous.', 'Don’t include your name, title, department, how long you have worked together, or anything else that could reveal who you are.'] : null,
      ['Complete each section before moving to the next.', 'Your progress is always shown at the top of the screen.'],
      isSelf ? ['Be candid with yourself.', 'Rate how you actually behave most of the time, not how you would like to.'] : ['Be honest, fair, and specific.', 'Base your answers on your own first-hand experience, not on what you have heard from others.'],
      ['Review and submit at the end.', 'Your answers save automatically, so you can stop and come back any time. Once submitted, they are final.'],
    ].filter(Boolean);
    const ok = h('input', { type: 'checkbox', checked: accepted });
    const begin = h('button', { class: 'btn primary big', disabled: !accepted, onclick: () => {
      const fresh = !accepted;
      accepted = true; sendAccepted = true; save();
      current = firstOpen();
      if (current === sections.length) current = sections.length;
      banner = fresh ? { text: isSelf ? 'Let’s begin. Answer as candidly as you can; this is for your own growth.' : 'Thank you' + (rater ? ', ' + rater : '') + '! Let’s begin. Take your time. There are no right or wrong answers, only your honest experience.', star: true } : null;
      drawMain(); drawSide();
    } }, accepted ? 'Continue the questionnaire →' : 'Begin the questionnaire →');
    ok.addEventListener('change', () => { begin.disabled = !ok.checked; });
    setKids(main,
      h('div', { class: 'card welcome' },
        h('div', { class: 'eyebrow' }, isSelf ? 'Your self-assessment' : 'Thank you for taking part'),
        h('h1', null, isSelf ? 'Reflecting on your leadership' : 'Helping ' + subjFirst + ' grow'),
        h('p', { class: 'lead' }, isSelf
          ? 'This is your self-assessment. Your own view of your leadership will be compared with feedback from others, so candid reflection, on strengths and areas for growth alike, makes the results far more valuable to you.'
          : 'You’ve been invited to share your perspective on ' + a.subjectName + ' as ' + phrase + '. Honest, thoughtful feedback is one of the most valuable things a leader can receive. Your perspective matters, and it is genuinely appreciated.'),
        h('div', { class: 'meta-row' },
          h('span', null, h('strong', null, total), ' statements'),
          h('span', null, h('strong', null, sections.length), ' sections'),
          h('span', null, timeEstimate(total, s.commentsRequired)),
          a.dueDate ? h('span', null, 'Please finish by ', h('strong', null, fmtDue(a.dueDate))) : null),
        a.instructions ? h('div', { class: 'instructions' }, a.instructions) : null,
        h('h2', { style: { margin: '22px 0 12px' } }, 'Guidelines for completing the questionnaire'),
        h('ol', { class: 'guide-list' }, guidelines.map(([t, d]) => h('li', null, h('strong', null, t), h('span', null, d)))),
        h('div', { class: 'scale-key' }, h('span', { class: 'muted' }, 'Rating scale: '), a.scale.anchors.map((x) => h('span', { class: 'chip' }, (x.from === x.to ? x.from : x.from + '–' + x.to) + ' ' + x.label))),
        isSelf ? null : h('p', { class: 'muted', style: { fontSize: '14px', marginTop: '16px' } }, '🔒 Your individual answers are seen only by ' + a.consultant + ', the consultant running this assessment. Reports shared with the organization combine feedback from several people.'),
        h('label', { class: 'check agree' }, ok, isSelf ? 'I have read these guidelines and will reflect honestly and thoroughly.' : 'I have read these guidelines and will give honest, thoughtful, and thorough feedback.'),
        h('div', { class: 'row end' }, begin)));
  }

  function drawReview() {
    if (firstOpen() < sections.length) { current = firstOpen(); return drawMain(); }
    const comments = a.questions.filter((q) => Rules.commentText(s, answers[q.id]).trim()).length;
    const wordsTotal = a.questions.reduce((n, q) => n + Rules.words(Rules.commentText(s, answers[q.id])).length, 0);
    const rich = a.questions.filter((q) => ['good', 'excellent'].includes(Rules.detailLevel(Rules.words(Rules.commentText(s, answers[q.id])).length, Rules.wordsNeeded(s, answers[q.id].rating)))).length;
    const err = errBox();
    setKids(main,
      h('div', { class: 'q-banner star' }, h('span', { class: 'q-banner-icon', 'aria-hidden': 'true' }, '★'),
        h('span', null, 'You’ve completed every statement' + (rater ? ', ' + rater : '') + '. Thank you! ' + (isSelf ? 'Your candid reflection is the foundation of a meaningful assessment.' : 'Your thoughtful, honest feedback is truly valued.'))),
      h('div', { class: 'eyebrow' }, 'Last step'), h('h1', { style: { marginBottom: '16px' } }, 'Review & submit'),
      h('div', { class: 'card stack' },
        h('div', { class: 'grid three' },
          h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Statements rated'), h('div', { class: 'value' }, total, h('small', null, ' / ' + total))),
          h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Comments written'), h('div', { class: 'value' }, comments)),
          h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Words of feedback'), h('div', { class: 'value' }, wordsTotal))),
        s.commentsRequired ? h('p', null, rich === total ? '★ Every comment has good or excellent detail. Thank you, that’s exactly what makes this meaningful.'
          : rich + ' of ' + total + ' comments have good or excellent detail. If you have a moment, adding more detail to the shorter ones makes your feedback even more meaningful' + (isSelf ? '.' : ' to ' + subjFirst + '.')) : null,
        h('p', null, 'Want to look over anything first? Choose a section:'),
        h('div', { class: 'row' }, sections.map((sec, i) => h('button', { class: 'btn small', onclick: () => { current = i; drawMain(); drawSide(); } }, sec.name))),
        h('div', { class: 'notice' }, 'When you submit, your answers are sent to ' + (isSelf ? 'the consultant' : a.consultant) + ' and can no longer be changed.'),
        err,
        h('div', { class: 'row end' }, h('button', { class: 'btn primary big', onclick: async (e) => {
          if (!(await confirmBox('Submit your feedback?', 'Your answers will be sent and can no longer be changed.', 'Submit'))) return;
          busy(e.target, err, async () => {
            clearTimeout(pending);
            const r = await api('POST', '/api/my/' + invId + '/submit', { answers });
            dirty = false; window.onbeforeunload = null;
            mount(state.renderId, topbar('home'), page('narrow', doneCard(a, r.submittedAt, answers, isSelf, rater)));
          });
        } }, 'Submit my feedback'))));
  }

  refreshProgress();
  drawMain();
  mount(id, topbar('home'), page('', strip, h('div', { class: 'q-layout' }, side, main)));
}

function doneCard(a, when, answers, isSelf, rater) {
  const s = Rules.settingsOf(a);
  const qs = a.questions || [];
  const comments = qs.filter((q) => answers[q.id] && Rules.commentText(s, answers[q.id]).trim()).length;
  const wordsTotal = qs.reduce((n, q) => n + (answers[q.id] ? Rules.words(Rules.commentText(s, answers[q.id])).length : 0), 0);
  return h('div', { class: 'card done-card' },
    h('div', { class: 'done-mark', 'aria-hidden': 'true' }, '✓'),
    h('h1', null, 'Thank you' + (rater ? ', ' + rater : '') + '!'),
    h('p', { class: 'lead' }, isSelf ? 'Your self-assessment has been submitted.' : 'Your feedback for ', isSelf ? null : h('strong', null, a.subjectName), isSelf ? null : ' has been submitted.'),
    qs.length ? h('p', null, 'You rated ' + plural(qs.length, 'statement') + ' and wrote ' + plural(comments, 'comment') + (wordsTotal ? ': ' + wordsTotal.toLocaleString() + ' words in all.' : '.')) : null,
    h('p', null, isSelf
      ? 'Thank you for reflecting so candidly. Your self-assessment will be compared with feedback from others to give you a clear, balanced picture of your leadership.'
      : 'The time, honesty, and care you put into this are sincerely appreciated. Feedback like yours is what makes real leadership growth possible.'),
    h('p', { class: 'muted' }, 'Submitted ' + fmtDateTime(when) + '. You can close this window now.'),
    link('/home', { class: 'btn' }, 'Back to my questionnaires'));
}
