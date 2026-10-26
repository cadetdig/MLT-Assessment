'use strict';
// Previan Assessment App — server. Uses only what comes with Node.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Store } = require('./lib/store');
const S = require('./lib/security');
const { AppError } = S;
const { tally, toCsv } = require('./lib/scoring');
const { extractLines } = require('./lib/importer');
const { defaultInstructions, scales, relationships } = require('./lib/library');
const Rules = require('./public/rules.js');

const VERSION = '2.2.0';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3860);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const LOCAL_ONLY = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
const SECURE = PUBLIC_URL.startsWith('https://') || process.env.FORCE_HTTPS === '1';
const SETUP_KEY = process.env.SETUP_KEY || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || !LOCAL_ONLY;
const DATA_DIR = path.resolve(process.env.DATA_DIR || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'PrevianAssessmentApp')
  : path.join(os.homedir(), '.previan-assessment-app')));

if (!LOCAL_ONLY && SETUP_KEY.length < 16) {
  console.error('Online mode needs a SETUP_KEY of at least 16 characters so only you can create the administrator account.');
  process.exit(1);
}

const store = new Store(DATA_DIR);
const db = () => store.data;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = SECURE ? '__Host-previan' : 'previan';
const SESSION_IDLE = 7 * 24 * 3600 * 1000;   // signed out after a week of no use
const SESSION_MAX = 30 * 24 * 3600 * 1000;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- helpers
const limits = new Map();
function rateLimit(req, bucket, max) {
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  const key = bucket + ':' + (fwd || req.socket.remoteAddress);
  const t = Date.now();
  let r = limits.get(key);
  if (!r || r.until < t) { r = { n: 0, until: t + 15 * 60 * 1000 }; limits.set(key, r); }
  if (++r.n > max) throw new AppError(429, 'Too many attempts. Please wait 15 minutes and try again.');
  if (limits.size > 5000) for (const [k, v] of limits) if (v.until < t) limits.delete(k);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...(SECURE ? { 'strict-transport-security': 'max-age=31536000' } : {}),
    ...headers,
  });
  res.end(body);
}
const json = (res, status, value, headers) => send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', ...headers });

async function readBody(req, limit = 1024 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new AppError(415, 'Expected JSON.');
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new AppError(413, 'That is too large to send.'); chunks.push(c); }
  try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  throw new AppError(400, 'The request was not readable.');
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const appUrl = (req) => PUBLIC_URL || ('http://' + (req.headers.host || '127.0.0.1:' + PORT));

// Blocks other websites from acting on a signed-in browser's behalf.
function checkOrigin(req) {
  if (['GET', 'HEAD'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) throw new AppError(403, 'Please use the app directly.');
  let host;
  try { host = new URL(origin).host; } catch { throw new AppError(403, 'Please use the app directly.'); }
  const expected = PUBLIC_URL ? new URL(PUBLIC_URL).host : req.headers.host;
  if (host !== expected) throw new AppError(403, 'Please use the app directly.');
}

// ---------------------------------------------------------------- sessions
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  const value = raw && raw.slice(COOKIE.length + 1);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  const key = S.sha256(value);
  const s = db().sessions[key];
  if (!s) return null;
  const t = Date.now();
  if (t - s.lastSeen > SESSION_IDLE || t - s.created > SESSION_MAX) { delete db().sessions[key]; store.save(); return null; }
  if (s.role === 'rater') {
    const u = db().users[s.userId];
    if (!u || u.disabled) { delete db().sessions[key]; store.save(); return null; }
  }
  if (s.role === 'admin' && s.userId !== 'admin' && !(db().admins || {})[s.userId]) { delete db().sessions[key]; store.save(); return null; }
  if (t - s.lastSeen > 60 * 1000) { s.lastSeen = t; store.save(); }
  return { ...s, key };
}

function startSession(res, role, userId) {
  const value = S.token(32);
  const t = Date.now();
  db().sessions[S.sha256(value)] = { role, userId, created: t, lastSeen: t };
  for (const [k, s] of Object.entries(db().sessions)) if (t - s.lastSeen > SESSION_IDLE) delete db().sessions[k];
  store.flush();
  res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX / 1000}${SECURE ? '; Secure' : ''}`);
}
function endSession(res, session) {
  if (session) { delete db().sessions[session.key]; store.flush(); }
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
}

function who(session) {
  if (!session) return null;
  if (session.role === 'admin') {
    const st = db().settings;
    if (session.userId === 'admin') return { role: 'admin', owner: true, username: st.adminUsername, displayName: st.adminDisplayName };
    const ad = (db().admins || {})[session.userId];
    return ad ? { role: 'admin', owner: false, username: ad.username, displayName: ad.displayName, mustChangePassword: Boolean(ad.mustChangePassword) } : null;
  }
  const u = db().users[session.userId];
  return u ? { role: 'rater', username: u.username, displayName: u.displayName, mustChangePassword: Boolean(u.mustChangePassword) } : null;
}

function requireAdmin(session) {
  if (!session) throw new AppError(401, 'Please sign in.');
  if (session.role !== 'admin') throw new AppError(403, 'This area is for the administrator.');
}
function requireRater(session) {
  if (!session) throw new AppError(401, 'Please sign in.');
  if (session.role !== 'rater') throw new AppError(403, 'Sign in with a rater login to answer questionnaires. (The administrator account cannot be a rater.)');
  return db().users[session.userId];
}

function requireOwner(session) {
  requireAdmin(session);
  if (session.userId !== 'admin') throw new AppError(403, 'Only the owner (' + (db().settings.adminDisplayName || 'the main administrator') + ') can do this.');
}
function verifyAdminPassword(session, password) {
  if (session.userId === 'admin') {
    const st = db().settings;
    if (!S.verifyPassword(password, st.adminSalt, st.adminHash)) throw new AppError(403, 'Your administrator password is not correct.');
    return;
  }
  const ad = (db().admins || {})[session.userId];
  if (!ad || !S.verifyPassword(password, ad.salt, ad.hash)) throw new AppError(403, 'Your administrator password is not correct.');
}
function usernameTaken(username) {
  return username === db().settings.adminUsername
    || Object.values(db().users).some((u) => u.username === username)
    || Object.values(db().admins || {}).some((x) => x.username === username);
}

// ---------------------------------------------------------------- shapes
const invitesFor = (aid) => Object.values(db().invitations).filter((i) => i.assessmentId === aid);
// The settings the completion guidelines need (shared with the browser via public/rules.js).
const ruleView = (a) => ({
  scale: scales[a.scale] || scales['1-10'],
  allowNotObserved: Boolean(a.allowNotObserved),
  commentsRequired: a.commentsRequired !== false,
  commentMode: a.commentMode === 'split' ? 'split' : 'single',
  minCommentWords: Number.isInteger(a.minCommentWords) ? a.minCommentWords : 10,
  minCommentWordsExtreme: Number.isInteger(a.minCommentWordsExtreme) ? a.minCommentWordsExtreme : 20,
});
// Words that would identify this rater (their own names), used by the anonymity checks.
function identityCtx(inv, a) {
  const u = inv.userId ? db().users[inv.userId] : null;
  const parts = [inv.raterName, u && u.displayName, u && u.username && u.username.split('@')[0], inv.raterEmail && inv.raterEmail.split('@')[0], u && u.email && u.email.split('@')[0]]
    .filter(Boolean).join(' ');
  const selfTerms = [...new Set(Rules.words(parts.replace(/[._\d+-]+/g, ' ')))].filter((w) => w.length >= 3);
  return { isSelf: inv.relationship === 'self', selfTerms, subjectTerms: Rules.words(a.subjectName) };
}
function progressOf(inv, a) {
  const answered = Rules.check(ruleView(a), a.questions, inv.answers || {}, identityCtx(inv, a)).completeCount;
  return { answered, total: a.questions.length };
}
function inviteStatus(inv) {
  if (inv.submittedAt) return inv.excluded ? 'excluded' : 'submitted';
  if (inv.lastActivity) return 'in_progress';
  if (inv.userId) return 'joined';
  return 'not_started';
}
function adminInvite(inv, a) {
  const u = inv.userId ? db().users[inv.userId] : null;
  return {
    id: inv.id, code: inv.code, raterName: inv.raterName, raterEmail: inv.raterEmail, relationship: inv.relationship,
    status: inviteStatus(inv), progress: progressOf(inv, a), createdAt: inv.createdAt, claimedAt: inv.claimedAt || null,
    lastActivity: inv.lastActivity || null, submittedAt: inv.submittedAt || null,
    excluded: Boolean(inv.excluded), excludedReason: inv.excludedReason || '',
    account: u ? { username: u.username, displayName: u.displayName } : null,
  };
}
function assessmentSummary(a) {
  const inv = invitesFor(a.id);
  return {
    id: a.id, subjectName: a.subjectName, roleTitle: a.roleTitle, organization: a.organization, cohort: a.cohort,
    dueDate: a.dueDate, status: a.status, createdAt: a.createdAt, questionCount: a.questions.length,
    invited: inv.length, submitted: inv.filter((i) => i.submittedAt && !i.excluded).length,
    inProgress: inv.filter((i) => !i.submittedAt && i.lastActivity).length,
  };
}
const raterView = (a) => ({
  id: a.id, subjectName: a.subjectName, roleTitle: a.roleTitle, organization: a.organization, dueDate: a.dueDate,
  status: a.status, instructions: a.instructions, ...ruleView(a),
  consultant: db().settings.adminDisplayName || 'the consultant',
  questions: a.questions.map((q) => ({ id: q.id, category: q.category, name: q.name, statement: q.statement })),
});

// ---------------------------------------------------------------- validation
const MAX_QUESTIONS = 200;   // per questionnaire
const MAX_LIBRARY = 500;     // in the question library
function cleanQuestions(list, max = MAX_QUESTIONS) {
  if (!Array.isArray(list) || !list.length) throw new AppError(400, 'Add at least one question.');
  if (list.length > max) throw new AppError(400, max === MAX_LIBRARY ? 'The library can hold up to ' + max + ' statements.' : 'A questionnaire can have up to ' + max + ' statements.');
  const seen = new Set();
  return list.map((q) => {
    const statement = text(q && q.statement, 600);
    if (!statement) throw new AppError(400, 'Every question needs a statement.');
    let qid = typeof q.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : S.id();
    if (seen.has(qid)) qid = S.id();
    seen.add(qid);
    return { id: qid, category: text(q.category, 80) || 'General', name: text(q.name, 80), statement };
  });
}

function cleanAnswers(a, raw, final, ctx) {
  const rv = ruleView(a);
  const out = {};
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const q of a.questions) {
    const v = input[q.id];
    if (!v || typeof v !== 'object') continue;
    let rating = null;
    if (v.rating === 'na' && rv.allowNotObserved) rating = 'na';
    else if (Number.isInteger(v.rating) && v.rating >= rv.scale.min && v.rating <= rv.scale.max) rating = v.rating;
    out[q.id] = { rating, comment: text(v.comment, 4000), strength: text(v.strength, 4000), development: text(v.development, 4000) };
    if (v.confirmedMatch === true) out[q.id].confirmedMatch = true;
    if (v.confirmedAnonymous === true) out[q.id].confirmedAnonymous = true;
  }
  if (final) {
    const result = Rules.check(rv, a.questions, out, ctx);
    if (!result.complete) {
      const lines = Rules.summary(rv, a.questions, result);
      throw new AppError(400, `${lines.length} statement${lines.length === 1 ? '' : 's'} still ${lines.length === 1 ? 'needs' : 'need'} attention before you can submit. ${lines.slice(0, 3).join(' ')}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- routes
async function route(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const session = readSession(req);
  const data = db();

  // ----- public / account
  if (m === 'GET' && p === '/api/session') {
    return json(res, 200, { setupRequired: !data.settings.adminHash, setupKeyRequired: !LOCAL_ONLY, localOnly: LOCAL_ONLY, user: who(session), version: VERSION });
  }
  if (m === 'POST' && p === '/api/setup') {
    rateLimit(req, 'setup', 10);
    const b = await readBody(req);
    if (data.settings.adminHash) throw new AppError(409, 'The administrator account already exists. Please sign in.');
    if (!LOCAL_ONLY && b.setupKey !== SETUP_KEY) throw new AppError(403, 'The setup key is not correct.');
    const username = S.normalizeUsername(b.username);
    S.checkPassword(b.password);
    const pw = S.hashPassword(b.password);
    const key = S.recoveryKey();
    const rk = S.hashPassword(S.normalizeRecoveryKey(key));
    Object.assign(data.settings, {
      adminUsername: username, adminDisplayName: text(b.displayName, 80) || 'Administrator',
      adminSalt: pw.salt, adminHash: pw.hash, recoverySalt: rk.salt, recoveryHash: rk.hash, setupAt: now(),
    });
    startSession(res, 'admin', 'admin');
    return json(res, 201, { recoveryKey: key, user: who({ role: 'admin', userId: 'admin' }) });
  }
  if (m === 'POST' && p === '/api/login') {
    rateLimit(req, 'login', 25);
    const b = await readBody(req);
    let username;
    try { username = S.normalizeUsername(b.username); } catch { throw new AppError(401, 'That username and password do not match.'); }
    if (data.settings.adminHash && username === data.settings.adminUsername) {
      if (!S.verifyPassword(b.password, data.settings.adminSalt, data.settings.adminHash)) throw new AppError(401, 'That username and password do not match.');
      startSession(res, 'admin', 'admin');
      return json(res, 200, { user: who({ role: 'admin', userId: 'admin' }) });
    }
    const co = Object.values(data.admins || {}).find((x) => x.username === username);
    if (co) {
      if (!S.verifyPassword(b.password, co.salt, co.hash)) throw new AppError(401, 'That username and password do not match.');
      startSession(res, 'admin', co.id);
      return json(res, 200, { user: who({ role: 'admin', userId: co.id }) });
    }
    const u = Object.values(data.users).find((x) => x.username === username);
    const ok = u ? S.verifyPassword(b.password, u.salt, u.hash) : (S.hashPassword('timing-equalizer'), false);
    if (!ok) throw new AppError(401, 'That username and password do not match.');
    if (u.disabled) throw new AppError(403, 'This login has been turned off. Please contact the administrator.');
    startSession(res, 'rater', u.id);
    return json(res, 200, { user: who({ role: 'rater', userId: u.id }) });
  }
  if (m === 'POST' && p === '/api/logout') { endSession(res, session); return json(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/register') {
    rateLimit(req, 'register', 20);
    const b = await readBody(req);
    const inv = Object.values(data.invitations).find((i) => i.code === b.inviteCode);
    if (!inv) throw new AppError(404, 'Logins are created from an invitation link. Please use the link you were sent.');
    if (inv.userId) throw new AppError(409, 'This invitation has already been used. If it was you, sign in instead.');
    const username = S.normalizeUsername(b.username);
    S.checkPassword(b.password);
    if (usernameTaken(username))
      throw new AppError(409, 'That username is taken. Please choose another.');
    const pw = S.hashPassword(b.password);
    const u = { id: S.id(), username, displayName: text(b.displayName, 80) || inv.raterName || username, email: text(b.email, 120) || inv.raterEmail || '', salt: pw.salt, hash: pw.hash, createdAt: now(), disabled: false };
    data.users[u.id] = u;
    claimInvite(u, inv.code);
    startSession(res, 'rater', u.id);
    return json(res, 201, { user: who({ role: 'rater', userId: u.id }) });
  }
  if (m === 'POST' && p === '/api/recover') {
    rateLimit(req, 'recover', 8);
    const b = await readBody(req);
    const st = data.settings;
    if (!st.recoveryHash || !S.verifyPassword(S.normalizeRecoveryKey(b.recoveryKey), st.recoverySalt, st.recoveryHash))
      throw new AppError(403, 'That recovery key is not correct.');
    S.checkPassword(b.newPassword);
    const pw = S.hashPassword(b.newPassword);
    const key = S.recoveryKey();
    const rk = S.hashPassword(S.normalizeRecoveryKey(key));
    Object.assign(st, { adminSalt: pw.salt, adminHash: pw.hash, recoverySalt: rk.salt, recoveryHash: rk.hash });
    for (const [k, s] of Object.entries(data.sessions)) if (s.role === 'admin' && s.userId === 'admin') delete data.sessions[k];
    startSession(res, 'admin', 'admin');
    return json(res, 200, { recoveryKey: key, username: st.adminUsername, user: who({ role: 'admin', userId: 'admin' }) });
  }
  if (m === 'POST' && p === '/api/account/password') {
    if (!session) throw new AppError(401, 'Please sign in.');
    rateLimit(req, 'password', 15);
    const b = await readBody(req);
    S.checkPassword(b.newPassword);
    if (session.role === 'admin') {
      verifyAdminPassword(session, b.currentPassword);
      const pw = S.hashPassword(b.newPassword);
      if (session.userId === 'admin') Object.assign(data.settings, { adminSalt: pw.salt, adminHash: pw.hash });
      else Object.assign(data.admins[session.userId], pw, { mustChangePassword: false });
    } else {
      const u = data.users[session.userId];
      if (!S.verifyPassword(b.currentPassword, u.salt, u.hash)) throw new AppError(403, 'Your current password is not correct.');
      Object.assign(u, S.hashPassword(b.newPassword), { mustChangePassword: false });
    }
    for (const [k, s] of Object.entries(data.sessions)) if (k !== session.key && s.userId === session.userId) delete data.sessions[k];
    store.flush();
    return json(res, 200, { ok: true });
  }

  // ----- invitations (public preview, then claim)
  let match = p.match(/^\/api\/invite\/([a-f0-9]{32})$/);
  if (m === 'GET' && match) {
    rateLimit(req, 'invite-view', 120);
    const inv = Object.values(data.invitations).find((i) => i.code === match[1]);
    if (!inv) throw new AppError(404, 'This invitation link is not valid. Please check the link or contact the administrator.');
    const a = data.assessments[inv.assessmentId];
    const mine = session && session.role === 'rater' && inv.userId === session.userId;
    return json(res, 200, {
      subjectName: a.subjectName, roleTitle: a.roleTitle, organization: a.organization, dueDate: a.dueDate, status: a.status,
      raterName: inv.raterName, relationship: inv.relationship, relationshipLabel: relationships[inv.relationship],
      questionCount: a.questions.length, claimed: Boolean(inv.userId), mine: Boolean(mine), invitationId: mine ? inv.id : null,
      ...ruleView(a),
    });
  }
  match = p.match(/^\/api\/invite\/([a-f0-9]{32})\/claim$/);
  if (m === 'POST' && match) {
    const u = requireRater(session);
    const inv = claimInvite(u, match[1]);
    return json(res, 200, { invitationId: inv.id });
  }

  // ----- rater area
  if (p.startsWith('/api/my')) {
    const u = requireRater(session);
    if (m === 'GET' && p === '/api/my') {
      const list = Object.values(data.invitations).filter((i) => i.userId === u.id).map((inv) => {
        const a = data.assessments[inv.assessmentId];
        return { id: inv.id, subjectName: a.subjectName, roleTitle: a.roleTitle, organization: a.organization, dueDate: a.dueDate, status: a.status,
          relationship: inv.relationship, relationshipLabel: relationships[inv.relationship], submittedAt: inv.submittedAt || null, progress: progressOf(inv, a) };
      }).sort((x, y) => Number(Boolean(x.submittedAt)) - Number(Boolean(y.submittedAt)));
      return json(res, 200, { questionnaires: list });
    }
    match = p.match(/^\/api\/my\/([a-f0-9-]{36})(\/draft|\/submit)?$/);
    if (match) {
      const inv = data.invitations[match[1]];
      if (!inv || inv.userId !== u.id) throw new AppError(404, 'Questionnaire not found.');
      const a = data.assessments[inv.assessmentId];
      if (m === 'GET' && !match[2]) {
        return json(res, 200, { assessment: raterView(a), relationship: inv.relationship, relationshipLabel: relationships[inv.relationship],
          raterName: u.displayName || inv.raterName, guidelinesAcceptedAt: inv.guidelinesAcceptedAt || null, identity: identityCtx(inv, a),
          answers: inv.answers || {}, submittedAt: inv.submittedAt || null, savedAt: inv.lastActivity || null });
      }
      if (inv.submittedAt) throw new AppError(409, 'You have already submitted this questionnaire. Thank you!');
      if (a.status !== 'open') throw new AppError(409, 'This questionnaire is closed. Please contact the administrator.');
      const b = await readBody(req);
      if (m === 'PUT' && match[2] === '/draft') {
        if (b.acceptedGuidelines === true && !inv.guidelinesAcceptedAt) inv.guidelinesAcceptedAt = now();
        inv.answers = cleanAnswers(a, b.answers, false, identityCtx(inv, a));
        inv.lastActivity = now();
        store.save();
        return json(res, 200, { savedAt: inv.lastActivity });
      }
      if (m === 'POST' && match[2] === '/submit') {
        inv.answers = cleanAnswers(a, b.answers, true, identityCtx(inv, a));
        if (!inv.guidelinesAcceptedAt) inv.guidelinesAcceptedAt = now();
        inv.lastActivity = now();
        inv.submittedAt = now();
        store.flush();
        return json(res, 200, { submittedAt: inv.submittedAt });
      }
    }
    throw new AppError(404, 'Not found.');
  }

  // ----- administrator area
  if (p.startsWith('/api/admin/')) {
    requireAdmin(session);
    if (m === 'GET' && p === '/api/admin/overview') {
      const list = Object.values(data.assessments).filter((a) => a.status !== 'deleted').map(assessmentSummary).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return json(res, 200, { assessments: list, library: data.library, relationships, scales: Object.keys(scales), raterCount: Object.keys(data.users).length });
    }
    if (m === 'POST' && p === '/api/admin/assessments') {
      const b = await readBody(req);
      const subjectName = text(b.subjectName, 120);
      if (!subjectName) throw new AppError(400, "Enter the name of the person being assessed.");
      let questions;
      if (b.copyFromAssessmentId && data.assessments[b.copyFromAssessmentId]) questions = data.assessments[b.copyFromAssessmentId].questions;
      else {
        const ids = Array.isArray(b.competencyIds) ? b.competencyIds : [];
        questions = ids.map((cid) => data.library.competencies.find((c) => c.id === cid)).filter(Boolean)
          .map((c) => ({ category: c.category, name: c.name, statement: c.statement, sourceId: c.id }));
      }
      const a = {
        id: S.id(), subjectName, roleTitle: text(b.roleTitle, 120), organization: text(b.organization, 120), cohort: text(b.cohort, 120),
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || '') ? b.dueDate : '',
        targetScore: Number.isFinite(Number(b.targetScore)) ? Number(b.targetScore) : 8,
        scale: scales[b.scale] ? b.scale : '1-10', allowNotObserved: false, commentsRequired: true, commentMode: 'single', minCommentWords: 10, minCommentWordsExtreme: 20, minGroupSize: 3,
        instructions: defaultInstructions, status: 'open', createdAt: now(),
        questions: cleanQuestions(questions.map((q) => ({ ...q, id: undefined }))),
      };
      data.assessments[a.id] = a;
      store.flush();
      return json(res, 201, { id: a.id });
    }
    match = p.match(/^\/api\/admin\/assessments\/([a-f0-9-]{36})(\/[a-z.-]+)?$/);
    if (match) {
      const a = data.assessments[match[1]];
      if (!a || a.status === 'deleted') throw new AppError(404, 'Assessment not found.');
      const sub = match[2] || '';
      const invites = invitesFor(a.id);
      if (m === 'GET' && !sub) {
        return json(res, 200, { assessment: a, scaleInfo: scales[a.scale], invitations: invites.map((i) => adminInvite(i, a)).sort((x, y) => x.createdAt.localeCompare(y.createdAt)), lockedQuestions: invites.some((i) => i.submittedAt) });
      }
      if (m === 'PATCH' && !sub) {
        const b = await readBody(req);
        for (const f of ['subjectName', 'roleTitle', 'organization', 'cohort']) if (typeof b[f] === 'string') a[f] = text(b[f], 120) || (f === 'subjectName' ? a[f] : '');
        if (typeof b.instructions === 'string') a.instructions = text(b.instructions, 3000) || defaultInstructions;
        if (typeof b.dueDate === 'string') a.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate) ? b.dueDate : '';
        if (b.targetScore !== undefined && Number.isFinite(Number(b.targetScore))) a.targetScore = Number(b.targetScore);
        if (typeof b.commentsRequired === 'boolean') a.commentsRequired = b.commentsRequired;
        if (typeof b.allowNotObserved === 'boolean') a.allowNotObserved = b.allowNotObserved;
        if (Number.isInteger(b.minCommentWords) && b.minCommentWords >= 1 && b.minCommentWords <= 60) a.minCommentWords = b.minCommentWords;
        if (Number.isInteger(b.minCommentWordsExtreme) && b.minCommentWordsExtreme >= 1 && b.minCommentWordsExtreme <= 100) a.minCommentWordsExtreme = b.minCommentWordsExtreme;
        if (['single', 'split'].includes(b.commentMode) && b.commentMode !== (a.commentMode || 'single')) {
          if (invites.some((i) => i.lastActivity)) throw new AppError(409, 'The comment style cannot change after raters have started.');
          a.commentMode = b.commentMode;
        }
        if (Number.isInteger(b.minGroupSize) && b.minGroupSize >= 1 && b.minGroupSize <= 10) a.minGroupSize = b.minGroupSize;
        if (b.scale && scales[b.scale] && b.scale !== a.scale) {
          if (invites.some((i) => i.lastActivity)) throw new AppError(409, 'The rating scale cannot change after raters have started.');
          a.scale = b.scale;
        }
        if (['open', 'closed'].includes(b.status)) a.status = b.status;
        store.flush();
        return json(res, 200, { assessment: a });
      }
      if (m === 'DELETE' && !sub) {
        const b = await readBody(req);
        verifyAdminPassword(session, b.password);
        a.status = 'deleted';
        for (const i of invites) delete data.invitations[i.id];
        delete data.assessments[a.id];
        store.flush();
        return json(res, 200, { ok: true });
      }
      if (m === 'PUT' && sub === '/questions') {
        if (invites.some((i) => i.submittedAt)) throw new AppError(409, 'Questions are locked because responses have been submitted. Duplicate this assessment to make a new version.');
        const b = await readBody(req);
        a.questions = cleanQuestions(b.questions);
        store.flush();
        return json(res, 200, { questions: a.questions });
      }
      if (m === 'POST' && sub === '/raters') {
        const b = await readBody(req);
        const list = Array.isArray(b.raters) ? b.raters.slice(0, 200) : [];
        if (!list.length) throw new AppError(400, 'Add at least one rater.');
        const created = [];
        for (const r of list) {
          const raterName = text(r && r.raterName, 100);
          const relationship = relationships[r && r.relationship] ? r.relationship : 'other';
          if (!raterName) throw new AppError(400, 'Each rater needs a name.');
          if (relationship === 'self' && (invites.some((i) => i.relationship === 'self') || created.some((i) => i.relationship === 'self')))
            throw new AppError(409, 'This assessment already has a self-assessment invitation.');
          const inv = { id: S.id(), assessmentId: a.id, code: S.token(16), raterName, raterEmail: text(r.raterEmail, 120), relationship, userId: null, answers: {}, createdAt: now() };
          data.invitations[inv.id] = inv;
          created.push(inv);
        }
        store.flush();
        return json(res, 201, { created: created.map((i) => adminInvite(i, a)) });
      }
      if (m === 'GET' && sub === '/results') return json(res, 200, { result: tally(a, invites), relationships });
      if (m === 'GET' && sub === '/export.csv') {
        const name = (a.subjectName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assessment') + '-360-results.csv';
        return send(res, 200, toCsv(a, tally(a, invites)), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` });
      }
    }
    match = p.match(/^\/api\/admin\/invitations\/([a-f0-9-]{36})\/report-edit$/);
    if (m === 'PUT' && match) {
      const inv = data.invitations[match[1]];
      if (!inv || !inv.submittedAt) throw new AppError(404, 'Submitted response not found.');
      const a = data.assessments[inv.assessmentId];
      const b = await readBody(req);
      if (!a.questions.some((q) => q.id === b.questionId) || !['comment', 'strength', 'development'].includes(b.kind)) throw new AppError(400, 'That comment was not found.');
      inv.reportEdits = inv.reportEdits || {};
      const edits = inv.reportEdits[b.questionId] || {};
      const value = typeof b.text === 'string' ? b.text.trim().slice(0, 4000) : null;
      if (value === null || b.revert === true) delete edits[b.kind]; else edits[b.kind] = value;
      if (Object.keys(edits).length) inv.reportEdits[b.questionId] = edits; else delete inv.reportEdits[b.questionId];
      store.flush();
      return json(res, 200, { ok: true });
    }
    match = p.match(/^\/api\/admin\/invitations\/([a-f0-9-]{36})(\/response)?$/);
    if (match) {
      const inv = data.invitations[match[1]];
      if (!inv) throw new AppError(404, 'Invitation not found.');
      const a = data.assessments[inv.assessmentId];
      if (m === 'GET' && match[2]) return json(res, 200, { invitation: adminInvite(inv, a), answers: inv.answers || {}, questions: a.questions, scale: scales[a.scale] });
      if (m === 'PATCH' && !match[2]) {
        const b = await readBody(req);
        if (typeof b.raterName === 'string' && text(b.raterName, 100)) inv.raterName = text(b.raterName, 100);
        if (typeof b.raterEmail === 'string') inv.raterEmail = text(b.raterEmail, 120);
        if (b.relationship && relationships[b.relationship] && b.relationship !== inv.relationship) {
          if (b.relationship === 'self' && invitesFor(a.id).some((i) => i.relationship === 'self' && i.id !== inv.id)) throw new AppError(409, 'This assessment already has a self-assessment invitation.');
          inv.relationship = b.relationship;
        }
        if (typeof b.excluded === 'boolean') { inv.excluded = b.excluded; inv.excludedReason = b.excluded ? text(b.excludedReason, 300) : ''; }
        if (b.reopen === true) { inv.submittedAt = null; inv.excluded = false; }
        if (b.unlink === true && !inv.submittedAt) { inv.userId = null; inv.claimedAt = null; }
        store.flush();
        return json(res, 200, { invitation: adminInvite(inv, a) });
      }
      if (m === 'DELETE' && !match[2]) {
        delete data.invitations[inv.id];
        store.flush();
        return json(res, 200, { ok: true });
      }
    }
    if (m === 'PUT' && p === '/api/admin/library') {
      const b = await readBody(req, 2 * 1024 * 1024);
      if (!Array.isArray(b.competencies) || !Array.isArray(b.templates)) throw new AppError(400, 'The library was not readable.');
      const competencies = cleanQuestions(b.competencies.map((c) => ({ ...c })), MAX_LIBRARY)
        .map((c, i) => ({ ...c, core: Boolean(b.competencies[i].core) }));
      const known = new Set(competencies.map((c) => c.id));
      const templates = b.templates.slice(0, 50).map((t) => ({
        id: typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.id) ? t.id : S.id(),
        name: text(t.name, 100) || 'Untitled set', description: text(t.description, 300),
        competencyIds: Array.isArray(t.competencyIds) ? t.competencyIds.filter((x) => known.has(x)) : [],
      }));
      data.library = { competencies, templates };
      store.flush();
      return json(res, 200, { library: data.library });
    }
    if (m === 'POST' && p === '/api/admin/import/extract') {
      const b = await readBody(req, 22 * 1024 * 1024);
      return json(res, 200, { lines: extractLines(b.filename, b.dataBase64) });
    }
    if (m === 'GET' && p === '/api/admin/people') {
      const people = Object.values(data.users).map((u) => {
        const inv = Object.values(data.invitations).filter((i) => i.userId === u.id);
        return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, createdAt: u.createdAt, disabled: Boolean(u.disabled),
          questionnaires: inv.map((i) => ({ subjectName: data.assessments[i.assessmentId].subjectName, relationship: i.relationship, submitted: Boolean(i.submittedAt) })) };
      }).sort((x, y) => x.displayName.localeCompare(y.displayName));
      return json(res, 200, { people });
    }
    match = p.match(/^\/api\/admin\/people\/([a-f0-9-]{36})(\/reset)?$/);
    if (match) {
      const u = data.users[match[1]];
      if (!u) throw new AppError(404, 'Person not found.');
      if (m === 'POST' && match[2]) {
        const temp = S.tempPassword();
        Object.assign(u, S.hashPassword(temp), { mustChangePassword: true });
        for (const [k, s] of Object.entries(data.sessions)) if (s.userId === u.id) delete data.sessions[k];
        store.flush();
        return json(res, 200, { username: u.username, temporaryPassword: temp });
      }
      if (m === 'PATCH' && !match[2]) {
        const b = await readBody(req);
        if (typeof b.disabled === 'boolean') u.disabled = b.disabled;
        if (typeof b.displayName === 'string' && text(b.displayName, 80)) u.displayName = text(b.displayName, 80);
        store.flush();
        return json(res, 200, { ok: true });
      }
    }
    if (m === 'GET' && p === '/api/admin/admins') {
      const st = data.settings;
      const list = [{ id: 'admin', owner: true, username: st.adminUsername, displayName: st.adminDisplayName, createdAt: st.setupAt }]
        .concat(Object.values(data.admins || {}).map((x) => ({ id: x.id, owner: false, username: x.username, displayName: x.displayName, createdAt: x.createdAt, mustChangePassword: Boolean(x.mustChangePassword) })));
      return json(res, 200, { admins: list, me: session.userId });
    }
    if (m === 'POST' && p === '/api/admin/admins') {
      requireOwner(session);
      const b = await readBody(req);
      verifyAdminPassword(session, b.password);
      const username = S.normalizeUsername(b.username);
      if (usernameTaken(username)) throw new AppError(409, 'That username is already in use. Please choose another.');
      const displayName = text(b.displayName, 80);
      if (!displayName) throw new AppError(400, 'Enter their name.');
      if (Object.keys(data.admins || {}).length >= 5) throw new AppError(400, 'Up to 5 additional administrators can be added.');
      const temp = S.tempPassword();
      const ad = { id: S.id(), username, displayName, ...S.hashPassword(temp), mustChangePassword: true, createdAt: now() };
      data.admins = data.admins || {};
      data.admins[ad.id] = ad;
      store.flush();
      return json(res, 201, { username, temporaryPassword: temp });
    }
    match = p.match(/^\/api\/admin\/admins\/([a-f0-9-]{36})(\/reset)?$/);
    if (match) {
      requireOwner(session);
      const ad = (data.admins || {})[match[1]];
      if (!ad) throw new AppError(404, 'Administrator not found.');
      const b = await readBody(req);
      verifyAdminPassword(session, b.password);
      for (const [k, x] of Object.entries(data.sessions)) if (x.userId === ad.id) delete data.sessions[k];
      if (m === 'POST' && match[2]) {
        const temp = S.tempPassword();
        Object.assign(ad, S.hashPassword(temp), { mustChangePassword: true });
        store.flush();
        return json(res, 200, { username: ad.username, temporaryPassword: temp });
      }
      if (m === 'DELETE' && !match[2]) {
        delete data.admins[ad.id];
        store.flush();
        return json(res, 200, { ok: true });
      }
    }
    if (m === 'POST' && p === '/api/admin/backup') {
      const b = await readBody(req);
      verifyAdminPassword(session, b.password);
      const env = S.encryptBackup(JSON.stringify(data), b.password);
      const name = 'Previan-backup-' + now().slice(0, 10) + '.previanbackup';
      return send(res, 200, JSON.stringify(env), { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"` });
    }
    if (m === 'POST' && p === '/api/admin/restore') {
      requireOwner(session);
      const b = await readBody(req, 200 * 1024 * 1024);
      const restored = JSON.parse(S.decryptBackup(b.backup, b.password));
      if (!restored || restored.format !== 'PREVIAN-DATA-1' || !restored.settings || !restored.settings.adminHash) throw new AppError(400, 'This backup is not a complete Previan workspace.');
      restored.sessions = {};
      const saved = store.replaceAll(restored);
      res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
      return json(res, 200, { ok: true, safetyCopy: saved, adminUsername: restored.settings.adminUsername });
    }
    throw new AppError(404, 'Not found.');
  }
  throw new AppError(404, 'Not found.');
}

function claimInvite(user, code) {
  const inv = Object.values(db().invitations).find((i) => i.code === code);
  if (!inv) throw new AppError(404, 'This invitation link is not valid.');
  if (inv.userId && inv.userId !== user.id) throw new AppError(409, 'This invitation was already accepted by a different login. Please contact the administrator if this is a mistake.');
  if (!inv.userId) { inv.userId = user.id; inv.claimedAt = now(); store.flush(); }
  return inv;
}

// ---------------------------------------------------------------- static files
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) throw new AppError(405, 'Not allowed.');
  let rel = decodeURIComponent(url.pathname);
  if (!/^\/[A-Za-z0-9_./-]*$/.test(rel) || rel.includes('..')) throw new AppError(404, 'Not found.');
  let file = path.join(PUBLIC_DIR, rel);
  if (!types[path.extname(file)] || !fs.existsSync(file)) file = path.join(PUBLIC_DIR, 'index.html'); // app pages
  const headers = { 'content-type': types[path.extname(file)] };
  if (file.endsWith('.html')) headers['cache-control'] = 'no-store';
  send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, app: 'previan-assessment-app', version: VERSION });
    if (url.pathname.startsWith('/api/')) { checkOrigin(req); return await route(req, res, url); }
    return serveStatic(req, res, url);
  } catch (error) {
    if (res.headersSent) return;
    const status = error instanceof AppError ? error.status : 500;
    if (status === 500) console.error(error);
    json(res, status, { error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  }
});
server.requestTimeout = 120000;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\nPrevian Assessment App is already running. Opening it in your browser...');
    openBrowser('http://127.0.0.1:' + PORT);
    setTimeout(() => process.exit(0), 1500);
  } else { console.error(e); process.exit(1); }
});

function openBrowser(address) {
  if (process.env.OPEN_BROWSER !== '1') return;
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}

server.listen(PORT, HOST, () => {
  const address = PUBLIC_URL || `http://127.0.0.1:${server.address().port}`;
  console.log('');
  console.log('  Previan Assessment App ' + VERSION + ' is running.');
  console.log('  Open: ' + address);
  console.log('  Your data is saved in: ' + DATA_DIR);
  if (LOCAL_ONLY) console.log('  Keep this window open while you use the app. Close it to stop.');
  console.log('READY ' + address);
  openBrowser(address);
});

function shutdown() { try { store.flush(); } catch {} process.exit(0); }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
