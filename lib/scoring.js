'use strict';
// The tally: means per question, per category and overall, split into Self,
// All other raters, and each rater group, plus every written comment.
const { relationships } = require('./library');

const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const groupOrder = Object.keys(relationships).filter((k) => k !== 'self');

function tally(assessment, invitations) {
  const included = invitations.filter((i) => i.submittedAt && !i.excluded);
  const self = included.filter((i) => i.relationship === 'self');
  const others = included.filter((i) => i.relationship !== 'self');
  const groupCounts = {};
  for (const g of groupOrder) groupCounts[g] = others.filter((i) => i.relationship === g).length;
  const minGroup = assessment.minGroupSize || 3;
  const target = assessment.targetScore;

  const ratingOf = (inv, qid) => {
    const a = inv.answers && inv.answers[qid];
    return a && typeof a.rating === 'number' ? a.rating : null;
  };

  const questions = assessment.questions.map((q, index) => {
    const otherRatings = others.map((i) => ratingOf(i, q.id)).filter((v) => v !== null);
    const selfRatings = self.map((i) => ratingOf(i, q.id)).filter((v) => v !== null);
    const groups = {};
    for (const g of groupOrder) {
      const r = others.filter((i) => i.relationship === g).map((i) => ratingOf(i, q.id)).filter((v) => v !== null);
      if (r.length) groups[g] = { n: r.length, mean: round(mean(r)) };
    }
    const comments = [];
    for (const inv of included) {
      const a = inv.answers && inv.answers[q.id];
      if (!a) continue;
      const edits = (inv.reportEdits && inv.reportEdits[q.id]) || {};
      const flags = [];
      if (a.confirmedAnonymous) flags.push('identity');
      if (a.confirmedMatch) flags.push('mismatch');
      for (const kind of ['comment', 'strength', 'development']) {
        const original = (a[kind] || '').trim();
        if (!original) continue;
        const edited = typeof edits[kind] === 'string';
        const text = edited ? edits[kind] : original;
        if (!text) continue; // removed from the report by the administrator
        comments.push({ kind, text, edited, original: edited ? original : undefined, flags, relationship: inv.relationship, self: inv.relationship === 'self', invitationId: inv.id, questionId: q.id, rating: ratingOf(inv, q.id) });
      }
    }
    const othersMean = round(mean(otherRatings));
    const selfMean = round(mean(selfRatings));
    return {
      id: q.id, number: index + 1, category: q.category, name: q.name, statement: q.statement,
      othersMean, selfMean, othersN: otherRatings.length,
      notObserved: others.length - otherRatings.length,
      low: otherRatings.length ? Math.min(...otherRatings) : null,
      high: otherRatings.length ? Math.max(...otherRatings) : null,
      gapToTarget: othersMean === null ? null : round(othersMean - target),
      selfVsOthers: othersMean === null || selfMean === null ? null : round(selfMean - othersMean),
      groups, comments,
    };
  });

  const categories = [];
  for (const q of questions) {
    let c = categories.find((x) => x.name === q.category);
    if (!c) { c = { name: q.category, questionIds: [], othersMean: null, selfMean: null }; categories.push(c); }
    c.questionIds.push(q.id);
  }
  for (const c of categories) {
    const qs = questions.filter((q) => q.category === c.name);
    c.othersMean = round(mean(qs.map((q) => q.othersMean).filter((v) => v !== null)));
    c.selfMean = round(mean(qs.map((q) => q.selfMean).filter((v) => v !== null)));
    c.gapToTarget = c.othersMean === null ? null : round(c.othersMean - target);
    c.groups = {};
    for (const g of groupOrder) {
      const vals = qs.map((q) => q.groups[g] && q.groups[g].mean).filter((v) => typeof v === 'number');
      if (vals.length) c.groups[g] = round(mean(vals));
    }
  }

  const scored = questions.filter((q) => q.othersMean !== null);
  const byMean = [...scored].sort((a, b) => b.othersMean - a.othersMean);
  const blindSpots = scored.filter((q) => q.selfVsOthers !== null && q.selfVsOthers >= 1.5).sort((a, b) => b.selfVsOthers - a.selfVsOthers);
  const hidden = scored.filter((q) => q.selfVsOthers !== null && q.selfVsOthers <= -1.5).sort((a, b) => a.selfVsOthers - b.selfVsOthers);

  return {
    target, minGroupSize: minGroup,
    counts: {
      invited: invitations.length,
      submitted: included.length,
      self: self.length,
      others: others.length,
      excluded: invitations.filter((i) => i.submittedAt && i.excluded).length,
      groups: groupCounts,
    },
    thresholdMet: others.length >= minGroup,
    overall: {
      othersMean: round(mean(scored.map((q) => q.othersMean))),
      selfMean: round(mean(questions.map((q) => q.selfMean).filter((v) => v !== null))),
    },
    categories,
    questions,
    highlights: {
      strengths: byMean.slice(0, 5).map((q) => q.id),
      development: [...scored].sort((a, b) => a.othersMean - b.othersMean).slice(0, 5).map((q) => q.id),
      blindSpots: blindSpots.slice(0, 5).map((q) => q.id),
      hiddenStrengths: hidden.slice(0, 5).map((q) => q.id),
    },
  };
}

function toCsv(assessment, result) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formulas
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const groupKeys = groupOrder.filter((g) => result.counts.groups[g] > 0);
  const kinds = [['comment', 'Comments'], ['strength', 'Strength comments'], ['development', 'Development comments']]
    .filter(([k]) => result.questions.some((q) => q.comments.some((c) => c.kind === k)));
  if (!kinds.length) kinds.push(assessment.commentMode === 'split' ? ['strength', 'Strength comments'] : ['comment', 'Comments']);
  const header = ['#', 'Category', 'Competency', 'Statement', 'Others mean', 'Self', 'Gap to target (' + result.target + ')', 'Self minus others', 'Ratings', 'Not observed', 'Low', 'High',
    ...groupKeys.map((g) => relationships[g] + ' mean'), ...kinds.map(([, label]) => label)];
  const rows = [header];
  for (const q of result.questions) {
    const label = (c) => '[' + (c.self ? 'SELF' : relationships[c.relationship].toUpperCase()) + (typeof c.rating === 'number' ? ' · ' + c.rating : '') + '] ' + c.text;
    rows.push([q.number, q.category, q.name, q.statement, q.othersMean, q.selfMean, q.gapToTarget, q.selfVsOthers, q.othersN, q.notObserved, q.low, q.high,
      ...groupKeys.map((g) => (q.groups[g] ? q.groups[g].mean : '')),
      ...kinds.map(([k]) => q.comments.filter((c) => c.kind === k).map(label).join('\n'))]);
  }
  rows.push([]);
  rows.push(['', 'CATEGORY AVERAGES']);
  for (const c of result.categories) rows.push(['', c.name, '', '', c.othersMean, c.selfMean, c.gapToTarget]);
  rows.push(['', 'OVERALL', '', '', result.overall.othersMean, result.overall.selfMean]);
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

module.exports = { tally, toCsv };
