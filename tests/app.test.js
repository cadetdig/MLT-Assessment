'use strict';
// Run with:  node --test tests/
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let child; let base; let dataDir;
const ADMIN = { username: 'carla', password: 'admin-password-123', displayName: 'Carla Dignall' };

function client() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(method, url, body, opts = {}) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (method !== 'GET') { headers['content-type'] = 'application/json'; headers.origin = opts.origin === undefined ? base : opts.origin; }
      if (opts.origin === null) delete headers.origin;
      const res = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: res.status, body: json, text, headers: res.headers };
    },
  };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, r.text.slice(0, 300)); return r.body; };

async function start(dir) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', OPEN_BROWSER: '0' } });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = out.match(/READY (\S+)/); if (m) resolve(m[1]); });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', () => reject(new Error('server exited: ' + out)));
    setTimeout(() => reject(new Error('timeout: ' + out)), 10000);
  });
  return { proc, url };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'previan-test-'));
  ({ proc: child, url: base } = await start(dataDir));
});
after(() => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const admin = client();
let recoveryKey; let assessment; const raters = {};

test('first-time setup creates the administrator and a recovery key', async () => {
  assert.equal(ok(await client().req('GET', '/api/session')).setupRequired, true);
  const r = ok(await admin.req('POST', '/api/setup', ADMIN), 201);
  assert.match(r.recoveryKey, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
  recoveryKey = r.recoveryKey;
  ok(await client().req('POST', '/api/setup', ADMIN), 409);
  const s = ok(await admin.req('GET', '/api/session'));
  assert.equal(s.user.role, 'admin');
});

test('library starts with the 50 master statements and three starting sets', async () => {
  const o = ok(await admin.req('GET', '/api/admin/overview'));
  assert.equal(o.library.competencies.length, 50);
  assert.equal(o.library.competencies[0].statement, 'Learns quickly and absorbs new information with ease.');
  assert.equal(o.library.competencies[49].statement, 'Addresses a group confidently and delivers well-prepared, engaging presentations.');
  assert.deepEqual(o.library.templates.map((t) => t.competencyIds.length), [50, 45, 32]);
});

test('requests from other websites are refused', async () => {
  ok(await admin.req('POST', '/api/admin/assessments', { subjectName: 'X' }, { origin: 'https://evil.example' }), 403);
  ok(await admin.req('POST', '/api/admin/assessments', { subjectName: 'X' }, { origin: null }), 403);
});

test('create an assessment from a starting set (first 4 statements)', async () => {
  const lib = ok(await admin.req('GET', '/api/admin/overview')).library;
  const ids = lib.competencies.slice(0, 4).map((c) => c.id);
  const r = ok(await admin.req('POST', '/api/admin/assessments', { subjectName: 'Jordan Avery', roleTitle: 'COO', organization: 'Acme', competencyIds: ids, targetScore: 8 }), 201);
  assessment = ok(await admin.req('GET', '/api/admin/assessments/' + r.id)).assessment;
  assert.equal(assessment.questions.length, 4);
  // Edit questions while nobody has submitted: add a role-specific statement.
  const qs = [...assessment.questions, { category: 'Role-Specific', name: 'Board Relations', statement: 'Builds trust and credibility with the board.' }];
  const saved = ok(await admin.req('PUT', '/api/admin/assessments/' + assessment.id + '/questions', { questions: qs })).questions;
  assert.equal(saved.length, 5);
  assessment = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id)).assessment;
});

test('add raters; only one self-assessment allowed', async () => {
  const r = ok(await admin.req('POST', '/api/admin/assessments/' + assessment.id + '/raters', { raters: [
    { raterName: 'Jordan Avery', relationship: 'self' },
    { raterName: 'Board One', relationship: 'board' },
    { raterName: 'Peer One', relationship: 'peer' },
    { raterName: 'Peer Two', relationship: 'peer' },
    { raterName: 'Report One', relationship: 'direct_report' },
  ] }), 201);
  for (const i of r.created) raters[i.raterName] = { inv: i, c: client() };
  ok(await admin.req('POST', '/api/admin/assessments/' + assessment.id + '/raters', { raters: [{ raterName: 'Another Self', relationship: 'self' }] }), 409);
});

test('logins can only be created from a valid, unused invitation', async () => {
  ok(await client().req('POST', '/api/register', { inviteCode: '0'.repeat(32), username: 'x@y.com', password: 'longenough1' }), 404);
  for (const [name, r] of Object.entries(raters)) {
    const username = name.toLowerCase().replace(/ /g, '.') + '@example.com';
    ok(await r.c.req('POST', '/api/register', { inviteCode: r.inv.code, username, password: 'rater-password-1', displayName: name }), 201);
    const claim = ok(await r.c.req('POST', '/api/invite/' + r.inv.code + '/claim'));
    assert.equal(claim.invitationId, r.inv.id);
    r.username = username;
  }
  // A used invitation cannot be taken by someone else.
  ok(await client().req('POST', '/api/register', { inviteCode: raters['Peer One'].inv.code, username: 'intruder@x.com', password: 'rater-password-1' }), 409);
  ok(await raters['Peer Two'].c.req('POST', '/api/invite/' + raters['Peer One'].inv.code + '/claim'), 409);
  ok(await client().req('POST', '/api/register', { inviteCode: raters['Board One'].inv.code, username: 'carla', password: 'rater-password-1' }), 409);
});

test('raters see only their own questionnaire and never admin data', async () => {
  const peer = raters['Peer One'].c;
  const mine = ok(await peer.req('GET', '/api/my')).questionnaires;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, raters['Peer One'].inv.id);
  ok(await peer.req('GET', '/api/my/' + raters['Peer Two'].inv.id), 404);
  ok(await peer.req('GET', '/api/admin/overview'), 403);
  ok(await peer.req('GET', '/api/admin/assessments/' + assessment.id + '/results'), 403);
  ok(await client().req('GET', '/api/my'), 401);
});

const qids = () => assessment.questions.map((q) => q.id);
// Realistic-length, varied comments (no names, no praise/criticism words) so they pass the quality checks.
const BANK = ['budget', 'planning', 'vendor', 'meeting', 'schedule', 'project', 'quarterly', 'forecast', 'hiring', 'process', 'review', 'customer', 'contract', 'pricing', 'timeline', 'training', 'rollout', 'inventory', 'staffing', 'audit', 'policy', 'launch', 'migration', 'proposal', 'priorities', 'handoff', 'escalation', 'deadline', 'supplier', 'metrics', 'dashboard', 'workshop', 'onboarding', 'renewal', 'expansion', 'negotiation', 'agenda', 'memo', 'presentation', 'transition', 'integration', 'compliance', 'logistics', 'facilities', 'travel', 'payroll', 'software', 'hardware', 'warehouse', 'marketing', 'campaign', 'analysis', 'summary', 'checklist', 'calendar', 'retreat', 'offsite', 'briefing', 'update', 'followup'];
const commentFor = (note, n) => note + ' noticed this during the ' + Array.from({ length: 14 }, (_, j) => BANK[(n * 13 + j * 7) % BANK.length]).join(' ') + ' work last year';
const answersAll = (rating, note = 'R') => Object.fromEntries(qids().map((id, n) => [id, { rating: typeof rating === 'function' ? rating(n) : rating, comment: commentFor(note, n) }]));

test('new assessments default to a 1–10 scale with required comments and no skipping', async () => {
  assert.equal(assessment.scale, '1-10');
  assert.equal(assessment.commentsRequired, true);
  assert.equal(assessment.allowNotObserved, false);
  assert.equal(assessment.minCommentWords, 10);
});

test('guidelines are enforced on submit: rating, length, placeholders, copy-paste', async () => {
  const p = raters['Peer Two'];
  const url = '/api/my/' + p.inv.id + '/submit';
  let a = answersAll(5, 'G'); a[qids()[2]].rating = null;
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 3: Choose a rating from 1 to 10/);
  a = answersAll(5, 'G'); a[qids()[0]].rating = 0;
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 1: Choose a rating/);
  a = answersAll(5, 'G'); a[qids()[1]].comment = 'Good leader, very nice.';
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 2: 6 more words needed/);
  a = answersAll(5, 'G'); a[qids()[1]].comment = 'N/A';
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 2: Please describe what you have actually observed/);
  a = answersAll(5, 'G'); a[qids()[3]].comment = 'good good good good good good good good good good good';
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 4: Please use your own words/);
  a = answersAll(5, 'G'); a[qids()[4]].comment = a[qids()[0]].comment;
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 5: This is the same comment as statement 1/);
  a = answersAll(5, 'G'); a[qids()[4]].rating = 'na';
  ok(await p.c.req('POST', url, { answers: a }), 400); // "Not observed" is off by default
  // Drafts still save with anything in them, so raters never lose work.
  ok(await p.c.req('PUT', '/api/my/' + p.inv.id + '/draft', { answers: { [qids()[0]]: { rating: 3, comment: 'short' } }, acceptedGuidelines: true }));
  const back = ok(await p.c.req('GET', '/api/my/' + p.inv.id));
  assert.equal(back.answers[qids()[0]].comment, 'short');
  assert.ok(back.guidelinesAcceptedAt);
  const prog = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id)).invitations.find((i) => i.id === p.inv.id).progress;
  assert.deepEqual(prog, { answered: 0, total: 5 }); // progress counts only statements that meet the guidelines
});

test('drafts save, incomplete submissions are refused, then submit works', async () => {
  const peer = raters['Peer One'];
  const partial = answersAll(7, 'P1'); delete partial[qids()[4]];
  ok(await peer.c.req('PUT', '/api/my/' + peer.inv.id + '/draft', { answers: partial }));
  const back = ok(await peer.c.req('GET', '/api/my/' + peer.inv.id));
  assert.equal(back.answers[qids()[0]].rating, 7);
  assert.equal(back.answers[qids()[0]].comment, commentFor('P1', 0));
  ok(await peer.c.req('POST', '/api/my/' + peer.inv.id + '/submit', { answers: partial }), 400);
  // Out-of-range and fractional ratings are not accepted as answers.
  const bad = answersAll(7); bad[qids()[0]].rating = 11; bad[qids()[1]].rating = 6.5;
  ok(await peer.c.req('POST', '/api/my/' + peer.inv.id + '/submit', { answers: bad }), 400);
  ok(await peer.c.req('POST', '/api/my/' + peer.inv.id + '/submit', { answers: answersAll(7, 'P1') }));
  ok(await peer.c.req('PUT', '/api/my/' + peer.inv.id + '/draft', { answers: answersAll(1) }), 409);
});

test('comment quality: fuller comments for extreme scores, no restating, agreement with the score', async () => {
  const p = raters['Peer Two'];
  const url = '/api/my/' + p.inv.id + '/submit';
  const twelve = 'In the spring planning cycle this showed in how deadlines were handled for vendors';
  let a = answersAll(6, 'Q'); a[qids()[0]] = { rating: 10, comment: twelve };
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 1: \d+ more words? needed \(at least 20 for this score\)/);
  a = answersAll(6, 'Q'); a[qids()[0]].comment = 'Learns quickly and absorbs new information with ease, learns quickly and absorbs it all with ease.';
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 1: This mostly repeats the statement/);
  const harsh = 'Struggles with every rollout; the migration failed twice, the team was frustrated and confused, and deadlines slipped badly.';
  a = answersAll(6, 'Q'); a[qids()[1]] = { rating: 9, comment: harsh };
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /Statement 2: Your comment reads as mostly critical, but your score is 9/);
  a[qids()[1]].confirmedMatch = true;
  ok(await p.c.req('PUT', '/api/my/' + p.inv.id + '/draft', { answers: a })); // confirmation is accepted; nothing submitted yet
});

test('anonymity: own name, role, sign-off and contact details are refused; softer clues need confirming', async () => {
  const p = raters['Peer Two'];
  const url = '/api/my/' + p.inv.id + '/submit';
  const base = 'noticed this when the quarterly vendor review stalled and decisions waited on several open items';
  const cases = [
    ['As his CFO I ' + base, /own role or position/],
    ['I report directly to Jordan and ' + base, /reporting relationship/],
    ['Two of us ' + base + '. Regards, Peer Two', /sign-off|your own name/],
    ['Contact me at someone@acme.com because I ' + base, /email address/],
    ['This is Peer Two writing; I ' + base, /your own name/],
  ];
  for (const [text, re] of cases) {
    const a = answersAll(6, 'Q'); a[qids()[2]].comment = text;
    assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, re, text);
  }
  const soft = 'In my department we ' + base + ' for several weeks before anyone acted';
  const a = answersAll(6, 'Q'); a[qids()[2]].comment = soft;
  assert.match(ok(await p.c.req('POST', url, { answers: a }), 400).error, /your department or team/);
  a[qids()[2]].confirmedAnonymous = true;
  ok(await p.c.req('PUT', '/api/my/' + p.inv.id + '/draft', { answers: a }));
  // The self-assessment is not subject to anonymity checks.
  const self = raters['Jordan Avery'];
  const s = answersAll(1, 'SELF'); s[qids()[2]].comment = 'In my department I ' + base + ' and I should have stepped in much sooner';
  ok(await self.c.req('PUT', '/api/my/' + self.inv.id + '/draft', { answers: s }));
});

test('questions lock once a response is submitted', async () => {
  ok(await admin.req('PUT', '/api/admin/assessments/' + assessment.id + '/questions', { questions: assessment.questions }), 409);
});

test('tally: means per statement, category, group, self, not-observed, and comments', async () => {
  const sub = (name, answers) => raters[name].c.req('POST', '/api/my/' + raters[name].inv.id + '/submit', { answers });
  ok(await sub('Peer Two', answersAll(9, 'P2')));
  // Turn on "Not observed" for this assessment; the board member uses it on the last statement.
  ok(await admin.req('PATCH', '/api/admin/assessments/' + assessment.id, { allowNotObserved: true }));
  const board = answersAll((n) => (n === 4 ? 'na' : 4), 'B1'); board[qids()[4]].comment = '';
  ok(await sub('Board One', board));
  ok(await sub('Report One', answersAll(10, 'R1')));
  ok(await sub('Jordan Avery', answersAll(1, 'SELF')));
  const r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.equal(r.counts.others, 4);
  assert.equal(r.counts.self, 1);
  assert.equal(r.thresholdMet, true);
  const q0 = r.questions[0];
  assert.equal(q0.othersMean, 7.5);          // (7 + 9 + 4 + 10) / 4
  assert.equal(q0.selfMean, 1);
  assert.equal(q0.gapToTarget, -0.5);        // 7.5 − 8
  assert.equal(q0.selfVsOthers, -6.5);
  assert.deepEqual([q0.low, q0.high], [4, 10]);
  assert.equal(q0.groups.peer.mean, 8);      // (7 + 9) / 2
  assert.equal(q0.groups.board.mean, 4);
  const q4 = r.questions[4];
  assert.equal(q4.othersN, 3);
  assert.equal(q4.notObserved, 1);
  assert.equal(q4.othersMean, 8.67);          // (7 + 9 + 10) / 3, board member left out
  assert.equal(q0.comments.filter((c) => c.kind === 'comment').length, 5); // every rater, self included
  assert.ok(q0.comments.some((c) => c.self && c.text === commentFor('SELF', 0) && c.rating === 1));
  assert.equal(q4.comments.length, 4); // the board member's "Not observed" needed no comment
  const cat = r.categories.find((c) => c.name === 'Intellect & Strategy');
  assert.equal(cat.othersMean, 7.5);
  assert.equal(r.overall.othersMean, Math.round(((7.5 * 4 + 8.67) / 5) * 100) / 100);
  assert.ok(r.highlights.strengths.includes(q4.id));
});

test('exclude a response, then include it again', async () => {
  const id = raters['Report One'].inv.id;
  ok(await admin.req('PATCH', '/api/admin/invitations/' + id, { excluded: true, excludedReason: 'Test' }));
  let r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.equal(r.counts.others, 3);
  assert.equal(r.questions[0].othersMean, 6.67); // (7 + 9 + 4) / 3
  ok(await admin.req('PATCH', '/api/admin/invitations/' + id, { excluded: false }));
  r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.equal(r.counts.others, 4);
});

test('reopen lets a rater change answers', async () => {
  const p = raters['Peer One'];
  ok(await admin.req('PATCH', '/api/admin/invitations/' + p.inv.id, { reopen: true }));
  ok(await p.c.req('POST', '/api/my/' + p.inv.id + '/submit', { answers: answersAll(7, 'P1-revised') }));
  const resp = ok(await admin.req('GET', '/api/admin/invitations/' + p.inv.id + '/response'));
  assert.equal(resp.answers[qids()[0]].comment, commentFor('P1-revised', 0));
});

test('CSV export contains scores, groups, and labeled comments', async () => {
  const r = await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.text, /"Others mean"/);
  assert.match(r.text, /"Peer mean"/);
  assert.match(r.text, /"Comments"/);
  assert.match(r.text, /\[SELF · 1\] SELF noticed this during/);
  assert.match(r.text, /\[BOARD MEMBER · 4\] B1 noticed this during/);
});

test('closing the assessment stops new answers', async () => {
  ok(await admin.req('POST', '/api/admin/assessments/' + assessment.id + '/raters', { raters: [{ raterName: 'Late Peer', relationship: 'peer' }] }), 201);
  const inv = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id)).invitations.find((i) => i.raterName === 'Late Peer');
  const late = client();
  ok(await late.req('POST', '/api/register', { inviteCode: inv.code, username: 'late@example.com', password: 'rater-password-1' }), 201);
  ok(await admin.req('PATCH', '/api/admin/assessments/' + assessment.id, { status: 'closed' }));
  ok(await late.req('PUT', '/api/my/' + inv.id + '/draft', { answers: {} }), 409);
  ok(await admin.req('PATCH', '/api/admin/assessments/' + assessment.id, { status: 'open' }));
  ok(await late.req('PUT', '/api/my/' + inv.id + '/draft', { answers: {} }));
});

test('Edit for report changes what the results show, and can be undone', async () => {
  const id = raters['Peer Two'].inv.id;
  const qid = qids()[0];
  ok(await admin.req('PUT', '/api/admin/invitations/' + id + '/report-edit', { questionId: qid, kind: 'comment', text: 'Edited wording for the client report, details removed.' }));
  let r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  let c = r.questions[0].comments.find((x) => x.invitationId === id);
  assert.equal(c.text, 'Edited wording for the client report, details removed.');
  assert.equal(c.edited, true);
  assert.equal(c.original, commentFor('P2', 0));
  ok(await admin.req('PUT', '/api/admin/invitations/' + id + '/report-edit', { questionId: qid, kind: 'comment', text: '' }));
  r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.ok(!r.questions[0].comments.some((x) => x.invitationId === id), 'left out of the report');
  assert.equal(r.questions[0].othersMean, 7.5, 'scores are unchanged');
  ok(await admin.req('PUT', '/api/admin/invitations/' + id + '/report-edit', { questionId: qid, kind: 'comment', revert: true }));
  r = ok(await admin.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.equal(r.questions[0].comments.find((x) => x.invitationId === id).text, commentFor('P2', 0));
  ok(await raters['Peer One'].c.req('PUT', '/api/admin/invitations/' + id + '/report-edit', { questionId: qid, kind: 'comment', text: 'x' }), 403);
});

test('a second administrator can edit everything; only the owner manages administrators and restores', async () => {
  ok(await admin.req('POST', '/api/admin/admins', { displayName: 'Husband Dignall', username: 'husband', password: 'wrong-password' }), 403);
  ok(await admin.req('POST', '/api/admin/admins', { displayName: 'X', username: raters['Peer One'].username, password: ADMIN.password }), 409);
  const add = ok(await admin.req('POST', '/api/admin/admins', { displayName: 'Husband Dignall', username: 'husband', password: ADMIN.password }), 201);
  const co = client();
  const login = ok(await co.req('POST', '/api/login', { username: 'husband', password: add.temporaryPassword }));
  assert.equal(login.user.role, 'admin');
  assert.equal(login.user.owner, false);
  assert.equal(login.user.mustChangePassword, true);
  ok(await co.req('POST', '/api/account/password', { currentPassword: add.temporaryPassword, newPassword: 'husband-password-1' }));
  // Full editing rights
  ok(await co.req('GET', '/api/admin/assessments/' + assessment.id + '/results'));
  const created = ok(await co.req('POST', '/api/admin/assessments', { subjectName: 'Second Leader', competencyIds: ok(await co.req('GET', '/api/admin/overview')).library.competencies.slice(0, 3).map((c) => c.id) }), 201);
  ok(await co.req('PUT', '/api/admin/assessments/' + created.id + '/questions', { questions: [{ category: 'Custom', name: 'Board Trust', statement: 'Builds trust with the board through regular, candid updates.' }] }));
  // Owner-only actions
  ok(await co.req('POST', '/api/admin/admins', { displayName: 'Y', username: 'yy-admin', password: 'husband-password-1' }), 403);
  ok(await co.req('POST', '/api/admin/restore', { backup: {}, password: 'husband-password-1' }), 403);
  // The owner can remove them; their session ends at once.
  const list = ok(await admin.req('GET', '/api/admin/admins')).admins;
  assert.equal(list.length, 2);
  const hid = list.find((x) => x.username === 'husband').id;
  ok(await admin.req('DELETE', '/api/admin/admins/' + hid, { password: ADMIN.password }));
  ok(await co.req('GET', '/api/admin/overview'), 401);
  ok(await client().req('POST', '/api/login', { username: 'husband', password: 'husband-password-1' }), 401);
  ok(await admin.req('DELETE', '/api/admin/assessments/' + created.id, { password: ADMIN.password }));
});

test('questionnaires hold 80 statements (up to 200) and the library up to 500', async () => {
  const lib = ok(await admin.req('GET', '/api/admin/overview')).library;
  const r = ok(await admin.req('POST', '/api/admin/assessments', { subjectName: 'Big Questionnaire', competencyIds: lib.competencies.map((c) => c.id) }), 201);
  const eighty = Array.from({ length: 80 }, (_, i) => ({ category: 'Section ' + (1 + Math.floor(i / 10)), name: 'Item ' + (i + 1), statement: 'Custom statement number ' + (i + 1) + ' about observable leadership behavior.' }));
  assert.equal(ok(await admin.req('PUT', '/api/admin/assessments/' + r.id + '/questions', { questions: eighty })).questions.length, 80);
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ category: 'S', statement: 'Statement ' + i }));
  ok(await admin.req('PUT', '/api/admin/assessments/' + r.id + '/questions', { questions: tooMany }), 400);
  const bigLib = { competencies: Array.from({ length: 300 }, (_, i) => ({ id: 'L' + i, category: 'C', name: '', statement: 'Library statement ' + i, core: false })), templates: [] };
  ok(await admin.req('PUT', '/api/admin/library', bigLib));
  ok(await admin.req('PUT', '/api/admin/library', { competencies: lib.competencies, templates: lib.templates }));
  ok(await admin.req('DELETE', '/api/admin/assessments/' + r.id, { password: ADMIN.password }));
});

test('password reset for a rater, and admin recovery with the recovery key', async () => {
  const people = ok(await admin.req('GET', '/api/admin/people')).people;
  const p = people.find((x) => x.username === raters['Peer Two'].username);
  const reset = ok(await admin.req('POST', '/api/admin/people/' + p.id + '/reset'));
  ok(await raters['Peer Two'].c.req('GET', '/api/my'), 401); // old session ended
  const fresh = client();
  const login = ok(await fresh.req('POST', '/api/login', { username: p.username, password: reset.temporaryPassword }));
  assert.equal(login.user.mustChangePassword, true);
  ok(await fresh.req('POST', '/api/account/password', { currentPassword: reset.temporaryPassword, newPassword: 'my-new-password-2' }));
  ok(await client().req('POST', '/api/login', { username: p.username, password: 'my-new-password-2' }));
  // Admin forgot password:
  ok(await client().req('POST', '/api/recover', { recoveryKey: 'AAAA-BBBB-CCCC-DDDD-EEEE', newPassword: 'whatever-123' }), 403);
  const rec = client();
  const r = ok(await rec.req('POST', '/api/recover', { recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ' '), newPassword: 'recovered-pass-1' }));
  assert.equal(r.username, 'carla');
  assert.notEqual(r.recoveryKey, recoveryKey);
  ok(await admin.req('GET', '/api/admin/overview'), 401); // old admin sessions signed out
  ok(await admin.req('POST', '/api/login', { username: 'carla', password: 'recovered-pass-1' }));
  ADMIN.password = 'recovered-pass-1';
});

test('backup needs the admin password, and restore brings everything back after a restart', async () => {
  ok(await admin.req('POST', '/api/admin/backup', { password: 'wrong-password' }), 403);
  const b = await admin.req('POST', '/api/admin/backup', { password: ADMIN.password });
  assert.equal(b.status, 200);
  const envelope = JSON.parse(b.text);
  assert.equal(envelope.format, 'PREVIAN-BACKUP-1');
  assert.ok(!b.text.includes('Jordan Avery'), 'backup must be encrypted');
  // Delete the assessment, then restore it.
  ok(await admin.req('DELETE', '/api/admin/assessments/' + assessment.id, { password: 'nope-nope-nope' }), 403);
  ok(await admin.req('DELETE', '/api/admin/assessments/' + assessment.id, { password: ADMIN.password }));
  assert.equal(ok(await admin.req('GET', '/api/admin/overview')).assessments.length, 0);
  ok(await admin.req('POST', '/api/admin/restore', { backup: envelope, password: 'wrong-password' }), 400);
  ok(await admin.req('POST', '/api/admin/restore', { backup: envelope, password: ADMIN.password }));
  // Restart the server on the same data folder.
  child.kill(); await new Promise((r) => setTimeout(r, 300));
  ({ proc: child, url: base } = await start(dataDir));
  const again = client();
  ok(await again.req('POST', '/api/login', { username: 'carla', password: ADMIN.password }));
  const o = ok(await again.req('GET', '/api/admin/overview'));
  assert.equal(o.assessments.length, 1);
  assert.equal(o.assessments[0].submitted, 5);
  const r = ok(await again.req('GET', '/api/admin/assessments/' + assessment.id + '/results')).result;
  assert.equal(r.questions[0].othersMean, 7.5);
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.startsWith('before-restore-')));
});

test('importer reads a Word table', async () => {
  const docx = '/root/.claude/uploads/58bef1ca-53c2-505d-978e-edfa27849a7d/f04a26d5-Core-Competency-360-Master-Reworded.docx';
  if (!fs.existsSync(docx)) return;
  const again = client();
  ok(await again.req('POST', '/api/login', { username: 'carla', password: ADMIN.password }));
  const r = ok(await again.req('POST', '/api/admin/import/extract', { filename: 'master.docx', dataBase64: fs.readFileSync(docx).toString('base64') }));
  assert.ok(r.lines.includes('1 | Learns quickly and absorbs new information with ease.'));
  ok(await again.req('POST', '/api/admin/import/extract', { filename: 'old.doc', dataBase64: 'AAAA' }), 400);
});
