/* Previan Assessment App — completion and comment-quality guidelines.
   One file used by BOTH the rater's browser (live guidance) and the server
   (final check on submit), so the rules can never disagree. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Answers that say nothing about what the rater observed.
  const PLACEHOLDERS = new Set([
    'na', 'n a', 'none', 'nothing', 'nil', 'no comment', 'no comments', 'nothing to add', 'not applicable',
    'ok', 'okay', 'good', 'fine', 'great', 'yes', 'no', 'same', 'same as above', 'see above', 'as above', 'ditto',
    'idk', 'i dont know', 'dont know', 'not sure', 'unsure', 'tbd', 'x', 'xx', 'xxx', 'asdf', 'test', 'blah',
  ]);

  // Small connecting words that carry no observation on their own.
  const STOP = new Set(('a an the and or but so if then than that this these those there here it its is are was were be been being am ' +
    'i me my we our you your he him his she her they them their who whom which what when where why how ' +
    'to of in on at by for with from as into about over under up down out off again also just very really quite ' +
    'do does did done doing have has had having can could would should will shall may might must ' +
    'not no nor too more most much many some any all each every both few own same other such only ' +
    'one two lot lots thing things way well get gets got make makes made').split(' '));

  // Plain-language cues used to spot a comment that contradicts its score.
  const POSITIVE = new Set(('excellent outstanding exceptional great strong strength strengths superb impressive effective effectively ' +
    'reliable reliably consistently excels excel skilled skillful talented capable confident clear clearly ' +
    'thoughtful respected trusted admire admired inspiring inspires helpful supportive proactive decisive ' +
    'organized fair calm composed insightful brilliant fantastic wonderful best positive successful successfully ' +
    'thorough dependable knowledgeable creative innovative engaging approachable').split(' '));
  const NEGATIVE = new Set(('poor poorly weak weakness weaknesses struggle struggles struggled fail fails failed failing lack lacks lacking ' +
    'inconsistent inconsistently ineffective unclear avoid avoids avoided difficult problem problems concern concerns concerned ' +
    'disappointing disappointed bad unreliable slow late rarely seldom disorganized defensive dismissive rigid indecisive ' +
    'micromanages micromanage abrasive frustrating frustrated confusing unprepared reluctant overwhelmed improve improvement').split(' '));
  const NEGATORS = new Set(['not', 'never', 'no', 'isnt', 'doesnt', 'dont', 'didnt', 'wasnt', 'cant', 'wont', 'hardly', 'barely']);

  const words = (text) => String(text || '').toLowerCase().replace(/[’']/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  const normalize = (text) => words(text).join(' ');
  const meaningful = (list) => list.filter((w) => w.length > 2 && !STOP.has(w));

  function settingsOf(a) {
    const minWords = Number.isInteger(a.minCommentWords) ? a.minCommentWords : 10;
    const ext = Number.isInteger(a.minCommentWordsExtreme) ? a.minCommentWordsExtreme : 20;
    const min = a.scale.min; const max = a.scale.max;
    return {
      min, max,
      allowNotObserved: Boolean(a.allowNotObserved),
      commentsRequired: a.commentsRequired !== false,
      commentMode: a.commentMode === 'split' ? 'split' : 'single',
      minWords,
      minWordsExtreme: Math.max(ext, minWords),
      // Scores that need a fuller explanation: the low end and a perfect score.
      lowCut: min + Math.floor((max - min) * 0.34),
      highCut: max - Math.floor((max - min) * 0.25),
    };
  }

  const isExtreme = (s, r) => typeof r === 'number' && (r <= s.lowCut || r === s.max);
  const wordsNeeded = (s, r) => (isExtreme(s, r) ? s.minWordsExtreme : s.minWords);

  const commentText = (s, ans) => (s.commentMode === 'split'
    ? [ans.strength, ans.development].filter(Boolean).join(' ')
    : ans.comment || '');

  // Counts praise and criticism cues; "not effective" counts as criticism.
  function tone(text) {
    const w = words(text);
    let pos = 0; let neg = 0;
    w.forEach((word, i) => {
      const negated = NEGATORS.has(w[i - 1]) || NEGATORS.has(w[i - 2]);
      if (POSITIVE.has(word)) { if (negated) neg++; else pos++; }
      else if (NEGATIVE.has(word)) { if (negated) pos++; else neg++; }
    });
    return { pos, neg };
  }

  // Does the comment read clearly the opposite way to the score?
  function mismatch(s, rating, text) {
    if (typeof rating !== 'number') return null;
    const t = tone(text);
    if (rating >= s.highCut && t.neg >= 2 && t.pos === 0) return 'critical';
    if (rating <= s.lowCut && t.pos >= 2 && t.neg === 0) return 'positive';
    return null;
  }

  // Problems with one comment's length and substance, or null when it is fine.
  function commentIssue(text, need, statement) {
    const w = words(text);
    if (!w.length) return { code: 'empty', message: 'Add a comment that explains your score.' };
    if (PLACEHOLDERS.has(w.join(' '))) return { code: 'placeholder', message: 'Please describe what you have actually observed. Answers like "' + String(text).trim() + '" can’t be accepted.' };
    if (w.length < need) {
      const n = need - w.length;
      return { code: 'short', needed: n, message: n + ' more word' + (n === 1 ? '' : 's') + ' needed (at least ' + need + ' for this score).' };
    }
    const own = new Set(meaningful(w));
    if (own.size < 4) return { code: 'repetitive', message: 'Please use your own words to describe a real example.' };
    if (statement) {
      const inStatement = new Set(meaningful(words(statement)));
      const fresh = [...own].filter((x) => !inStatement.has(x));
      if (fresh.length < 4) return { code: 'restates', message: 'This mostly repeats the statement. Please describe what you have actually seen, in your own words.' };
    }
    return null;
  }

  // ---------------------------------------------------------------- detail
  // Beyond the minimum, encourage richer comments.
  function detailLevel(count, need) {
    if (count < need) return 'below';
    if (count >= Math.max(need + 25, 45)) return 'excellent';
    if (count >= Math.max(need + 10, 25)) return 'good';
    return 'minimum';
  }

  // ---------------------------------------------------------------- anonymity
  const TITLES = '(?:assistant|executive assistant|ea|manager|boss|supervisor|direct report|report|deputy|peer|colleague|chair|chairman|chairwoman|chairperson|board member|director|cfo|ceo|coo|cto|cio|cmo|chro|vp|svp|evp|vice president|president|head|lead|secretary|controller|treasurer|counsel|general counsel|partner|owner|founder|analyst|coordinator|administrator|nurse|physician|doctor|hygienist|dentist|receptionist|office manager)';
  const HARD = [
    [/[\w.+-]+@[\w-]+\.[\w.]+/, 'Please remove the email address. Comments must not reveal who you are.'],
    [/(?:\+?\d[\s().-]?){9,}\d/, 'Please remove the phone number. Comments must not reveal who you are.'],
    [/\bmy name(?:'s| is)\b|\bthis is \w+ (?:from|in)\b/i, 'Please don’t include your name. Comments must not reveal who you are.'],
    [/(?:^|[\n.!?]\s*)(?:regards|kind regards|best regards|sincerely|cheers|thanks|thank you|best|signed)\s*[,–—-]\s*[\p{L} .]{2,40}\s*$/iu, 'Please remove the sign-off at the end. Comments must not reveal who you are.'],
    [/(?:^|\n)\s*(?:--|—|–|-)\s*[\p{L}][\p{L} .]{1,40}\s*$/u, 'Please remove the signature at the end. Comments must not reveal who you are.'],
    [new RegExp('\\b(?:i am|i\'m|im|i was|i\'ve been|ive been|as)\\s+(?:his|her|their|your|the|a|an)\\s+(?:\\w+\\s+){0,2}' + TITLES + '\\b', 'i'), 'Please remove details about your own role or position. Comments must not reveal who you are.'],
    [new RegExp('\\bin my (?:role|position|capacity|job) (?:as|of)\\b', 'i'), 'Please remove details about your own role or position. Comments must not reveal who you are.'],
    [/\bi (?:directly )?report(?:ed)? (?:directly )?to\b/i, 'Please don’t describe your reporting relationship. Comments must not reveal who you are.'],
  ];
  const SOFT = [
    [/\b(?:for|over|nearly|almost) (?:\d+|two|three|four|five|six|seven|eight|nine|ten|twenty) (?:years?|months?)\b|\bsince (?:19|20)\d\d\b|\bwhen i (?:joined|started|was hired|came on)\b/i, 'how long you have worked together'],
    [/\b(?:my|our) (?:department|dept|division|unit|office|branch|region|location|store|clinic|practice|shift|committee|board|team|group|floor|site|plant)\b/i, 'your department or team'],
    [/\bthe only (?:woman|man|female|male|person|one|member|lawyer|engineer|accountant|doctor|nurse|director|manager|\w+ on)\b/i, 'something that makes you unique'],
    [/\b(?:i|me) (?:personally )?(?:was|am) the (?:one|person)\b/i, 'something only you did'],
  ];
  const ALLOWED_CAPS = new Set(('i january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday ceo cfo coo cto board q1 q2 q3 q4 ok okay').split(' '));

  // Returns { hard: message } or { soft: [reasons] } or null.
  function identityIssue(text, ctx) {
    if (!ctx || ctx.isSelf || !text) return null;
    const raw = String(text);
    for (const [re, msg] of HARD) if (re.test(raw)) return { hard: msg };
    const own = (ctx.selfTerms || []).map((t) => String(t).toLowerCase()).filter((t) => t.length >= 3);
    const subject = new Set((ctx.subjectTerms || []).map((t) => String(t).toLowerCase()));
    const w = new Set(words(raw));
    const hit = own.find((t) => w.has(t) && !subject.has(t));
    if (hit) return { hard: 'Your comment includes your own name (“' + hit + '”). Please remove it. Comments must not reveal who you are.' };
    const reasons = [];
    for (const [re, why] of SOFT) if (re.test(raw)) reasons.push(why);
    // Capitalized words mid-sentence are often names of people, teams or places.
    const names = [];
    const re = /(^|[^\p{L}\p{N}])(\p{Lu}[\p{Ll}]{2,})/gu;
    let m;
    while ((m = re.exec(raw))) {
      const before = raw.slice(0, m.index + m[1].length).trimEnd();
      const startOfSentence = !before || /[.!?:;\n"“(]$/.test(before);
      const word = m[2].toLowerCase();
      if (!startOfSentence && !subject.has(word) && !ALLOWED_CAPS.has(word) && !names.includes(m[2])) names.push(m[2]);
    }
    if (names.length) reasons.push('names such as “' + names.slice(0, 3).join('”, “') + '”');
    return reasons.length ? { soft: reasons } : null;
  }

  const similarity = (a, b) => {
    let both = 0;
    a.forEach((x) => { if (b.has(x)) both++; });
    return both / (a.size + b.size - both);
  };

  // Checks every statement. Returns { byQuestion: {id: [issues]}, completeCount, complete }.
  function check(a, questions, answers, ctx) {
    const s = settingsOf(a);
    const byQuestion = {};
    const seen = []; // { key, set, number }
    let completeCount = 0;
    questions.forEach((q, index) => {
      const ans = (answers && answers[q.id]) || {};
      const issues = [];
      const r = ans.rating;
      const rated = (Number.isInteger(r) && r >= s.min && r <= s.max) || (r === 'na' && s.allowNotObserved);
      if (!rated) issues.push({ code: 'rating', message: 'Choose a rating from ' + s.min + ' to ' + s.max + '.' });
      if (s.commentsRequired && r !== 'na') {
        const text = commentText(s, ans);
        const problem = commentIssue(text, wordsNeeded(s, r), q.statement);
        const who = identityIssue(text, ctx);
        if (who && who.hard) issues.push({ code: 'identity', message: who.hard });
        else if (who && who.soft && ans.confirmedAnonymous !== true && !problem) {
          issues.push({ code: 'identity-check', reasons: who.soft, message: 'Your comment mentions ' + who.soft.join(' and ') + '. Details like this could reveal who you are. Please remove them, or confirm they can’t identify you.' });
        }
        if (problem) issues.push(problem);
        else {
          const key = normalize(text);
          const set = new Set(meaningful(words(text)));
          const twin = seen.find((x) => x.key === key || (set.size >= 6 && x.set.size >= 6 && similarity(set, x.set) >= 0.75));
          if (twin) issues.push({ code: 'duplicate', duplicateOf: twin.number, message: (twin.key === key ? 'This is the same comment as statement ' : 'This is very similar to your comment on statement ') + twin.number + '. Please describe what you have seen for this statement specifically.' });
          else seen.push({ key, set, number: index + 1 });
          const way = rated ? mismatch(s, r, text) : null;
          if (way && ans.confirmedMatch !== true) {
            issues.push({ code: 'mismatch', direction: way, message: way === 'critical'
              ? 'Your comment reads as mostly critical, but your score is ' + r + '. Please make sure the comment explains this high score, adjust the score, or confirm both are right.'
              : 'Your comment reads as mostly positive, but your score is ' + r + '. Please make sure the comment explains this low score, adjust the score, or confirm both are right.' });
          }
        }
      }
      byQuestion[q.id] = issues;
      if (!issues.length) completeCount++;
    });
    return { byQuestion, completeCount, complete: completeCount === questions.length };
  }

  function summary(a, questions, result) {
    const lines = [];
    questions.forEach((q, i) => {
      const issues = result.byQuestion[q.id];
      if (issues && issues.length) lines.push('Statement ' + (i + 1) + ': ' + issues.map((x) => x.message).join(' '));
    });
    return lines;
  }

  return { PLACEHOLDERS, words, normalize, meaningful, settingsOf, isExtreme, wordsNeeded, commentText, tone, mismatch, commentIssue, detailLevel, identityIssue, check, summary };
});
