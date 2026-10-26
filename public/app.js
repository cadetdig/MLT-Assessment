'use strict';
/* Previan Assessment App — browser screens. Plain JavaScript, no frameworks. */

const app = document.getElementById('app');
const state = { session: null, renderId: 0 };
const REL = { self: 'Self', board: 'Board member', manager: 'Manager / CEO', peer: 'Peer', direct_report: 'Direct report', customer: 'Client / customer', other: 'Other' };
const REL_ORDER = ['self', 'board', 'manager', 'peer', 'direct_report', 'customer', 'other'];
const STATUS = { not_started: 'Not opened yet', joined: 'Logged in', in_progress: 'In progress', submitted: 'Submitted', excluded: 'Excluded' };

// ------------------------------------------------------------------ tiny helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}
// Replace an element's contents; accepts nested lists and skips empty values.
function setKids(el, ...kids) {
  const out = [];
  const add = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) k.forEach(add); else out.push(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  el.replaceChildren(...out);
}
function timeEstimate(count, comments) {
  const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
  const lo = round5(count * (comments ? 0.8 : 0.3));
  const hi = round5(count * (comments ? 1.3 : 0.5));
  return 'about ' + (lo === hi ? lo : lo + '–' + hi) + ' minutes';
}
const fmt = (n, d = 2) => (n === null || n === undefined ? '—' : Number(n).toFixed(d));
const fmtGap = (n) => (n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + Number(n).toFixed(2));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtDue = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const qs = (name) => new URLSearchParams(location.search).get(name);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new Error('Cannot reach the app. Check your internet connection (or that the app window is still open) and try again.'); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong (' + res.status + ').');
    err.status = res.status;
    if (res.status === 401 && state.session && state.session.user && url !== '/api/session') { state.session.user = null; setTimeout(render, 0); }
    throw err;
  }
  return data;
}

function go(path, replace) {
  const warning = typeof window.onbeforeunload === 'function' && window.onbeforeunload();
  if (warning && !replace && !confirm(warning + '\n\nLeave this page anyway?')) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', path); render();
}
window.addEventListener('popstate', () => render());
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(a.getAttribute('href')); }
});
const link = (href, attrs, ...kids) => h('a', { href, 'data-link': true, ...attrs }, ...kids);

let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

async function copyText(textValue, message) {
  try { await navigator.clipboard.writeText(textValue); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, textValue);
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(message || 'Copied.');
}

function modal({ title, subtitle, body, foot, wide, onClose }) {
  const back = h('div', { class: 'modal-back', role: 'presentation' });
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'muted', style: { margin: '4px 0 0' } }, subtitle) : null),
      h('button', { class: 'close-x', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'modal-body' }, body),
    foot ? h('div', { class: 'modal-foot' }, typeof foot === 'function' ? foot(close) : foot) : null);
  back.appendChild(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', esc);
  document.body.appendChild(back);
  const first = box.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, box };
}

function confirmBox(title, message, okLabel = 'Yes, continue', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: h('p', null, message),
      foot: (close) => [
        h('button', { class: 'btn', onclick: () => { done = true; resolve(false); close(); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => { done = true; resolve(true); close(); } }, okLabel),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    return m;
  });
}

// Form helper: runs fn, shows errors in place, disables the button while busy.
async function busy(button, errorBox, fn) {
  if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try { return await fn(); }
  catch (e) {
    if (errorBox) { errorBox.textContent = e.message; errorBox.hidden = false; } else toast(e.message);
    return undefined;
  } finally { if (button && button.isConnected) { button.disabled = false; button.textContent = label; } }
}
const errBox = () => h('div', { class: 'error', role: 'alert', hidden: true });
const field = (label, input, hint) => h('label', { class: 'field' }, label, hint ? h('span', { class: 'hint' }, hint) : null, input);

// ------------------------------------------------------------------ layout
function topbar(active) {
  const u = state.session && state.session.user;
  const nav = u && u.role === 'admin' ? [
    ['/admin', 'Assessments', 'assessments'], ['/admin/library', 'Question Library', 'library'],
    ['/admin/people', 'People', 'people'], ['/admin/settings', 'Settings & Backup', 'settings'],
  ] : u ? [['/home', 'My questionnaires', 'home']] : [];
  const menu = h('div', { class: 'menu', hidden: true },
    h('button', { onclick: () => { menu.hidden = true; changePasswordModal(); } }, 'Change my password'),
    h('button', { onclick: signOut }, 'Sign out'));
  const navLinks = (cls) => h('nav', { class: cls }, nav.map(([href, label, key]) => link(href, { class: key === active ? 'active' : '' }, label)));
  return [
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
      link(u ? (u.role === 'admin' ? '/admin' : '/home') : '/', { class: 'brand' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'P'),
        h('span', { class: 'brand-name' }, 'Previan Assessment App', h('small', null, '360° Leadership Feedback'))),
      navLinks('nav'),
      h('div', { class: 'spacer' }),
      u ? h('div', { class: 'usermenu' },
        h('button', { 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, u.displayName + ' ▾'), menu) : null)),
    nav.length ? navLinks('subnav') : null,
  ];
}
document.addEventListener('click', () => document.querySelectorAll('.usermenu .menu').forEach((m) => { m.hidden = true; }));

function mount(id, ...nodes) {
  if (id !== state.renderId) return false;
  setKids(app, ...nodes.flat());
  window.scrollTo(0, 0);
  return true;
}
const page = (cls, ...kids) => h('main', { class: 'page ' + (cls || '') }, ...kids);
const loading = (id, active) => mount(id, topbar(active), page('', h('p', { class: 'muted' }, 'Loading…')));

async function signOut() {
  try { await api('POST', '/api/logout'); } catch {}
  state.session = null;
  go('/', true);
}

function changePasswordModal() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = errBox();
  modal({
    title: 'Change my password',
    body: h('div', { class: 'stack' }, field('Current password', cur), field('New password', n1, 'At least 10 characters. A short phrase is easy to remember.'), field('Type the new password again', n2), err),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
        if (n1.value !== n2.value) throw new Error('The two new passwords do not match.');
        await api('POST', '/api/account/password', { currentPassword: cur.value, newPassword: n1.value });
        close(); toast('Password changed.');
      }) }, 'Change password')],
  });
}

// ------------------------------------------------------------------ router
async function render() {
  const id = ++state.renderId;
  window.onbeforeunload = null;
  try {
    if (!state.session) state.session = await api('GET', '/api/session');
  } catch (e) {
    return mount(id, page('narrow', h('div', { class: 'card' }, h('h2', null, 'The app is not responding'), h('p', null, e.message), h('button', { class: 'btn primary', onclick: () => { state.session = null; render(); } }, 'Try again'))));
  }
  const s = state.session;
  const p = location.pathname.replace(/\/+$/, '') || '/';
  let m;
  if (s.setupRequired) return viewSetup(id);
  if ((m = p.match(/^\/i\/([a-f0-9]{32})$/))) return viewInvite(id, m[1]);
  if (!s.user) return viewLogin(id);
  if (s.user.mustChangePassword) return viewForcePassword(id);
  if (s.user.role === 'admin') {
    if (p === '/admin') return viewAdminHome(id);
    if (p === '/admin/new') return viewNewAssessment(id);
    if ((m = p.match(/^\/admin\/a\/([a-f0-9-]{36})$/))) return viewAssessment(id, m[1]);
    if (p === '/admin/library') return viewLibrary(id);
    if (p === '/admin/people') return viewPeople(id);
    if (p === '/admin/settings') return viewSettings(id);
    return go('/admin', true);
  }
  if (p === '/home') return viewRaterHome(id);
  if ((m = p.match(/^\/q\/([a-f0-9-]{36})$/))) return viewQuestionnaire(id, m[1]);
  return go('/home', true);
}

// ------------------------------------------------------------------ sign-in screens
function authLayout(id, side, main) {
  return mount(id, topbar(), h('div', { class: 'auth' },
    h('section', { class: 'auth-side' }, side),
    h('section', { class: 'auth-main' }, h('div', { class: 'auth-card' }, main))));
}
const defaultSide = () => [
  h('div', { class: 'eyebrow', style: { color: '#e3c690' } }, 'Previan Partners'),
  h('h1', null, 'Candid feedback, ', h('em', null, 'clearly'), ' brought together.'),
  h('p', null, 'Leadership 360° assessments: invited raters answer privately, and the results are tallied competency by competency.'),
];

function viewSetup(id) {
  const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'e.g. Carla Dignall' });
  const user = h('input', { type: 'text', autocomplete: 'username', placeholder: 'e.g. carla', autocapitalize: 'none', spellcheck: 'false' });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const key = h('input', { type: 'password', autocomplete: 'off' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary big', style: { width: '100%' }, type: 'submit' }, 'Create my administrator account');
  const form = h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, err, async () => {
      if (p1.value !== p2.value) throw new Error('The two passwords do not match.');
      const r = await api('POST', '/api/setup', { displayName: name.value, username: user.value, password: p1.value, setupKey: key.value });
      showRecoveryKey(id, r.recoveryKey, 'Your administrator account is ready');
    });
  } },
  h('div', { class: 'eyebrow' }, 'First-time setup'), h('h2', null, 'Create your administrator account'),
  h('p', { class: 'muted' }, 'This is the private login you will use to create assessments and see every result. Raters get their own logins later, from their invitation links.'),
  state.session.setupKeyRequired ? field('Setup key', key, 'The private key from your hosting settings (SETUP_KEY).') : null,
  field('Your name', name), field('Username', user, 'What you will type to sign in.'),
  field('Password', p1, 'At least 10 characters.'), field('Type the password again', p2), err, btn);
  authLayout(id, defaultSide(), form);
}

function showRecoveryKey(id, keyValue, heading) {
  const ok = h('input', { type: 'checkbox' });
  const cont = h('button', { class: 'btn primary big', style: { width: '100%' }, disabled: true, onclick: () => { state.session = null; go('/admin', true); } }, 'Continue to my workspace');
  ok.addEventListener('change', () => { cont.disabled = !ok.checked; });
  authLayout(id, defaultSide(), h('div', { class: 'stack' },
    h('div', { class: 'eyebrow' }, 'Important — save this now'), h('h2', null, heading),
    h('p', null, 'Below is your ', h('strong', null, 'recovery key'), '. If you ever forget your administrator password, this key is the only way back in. It is shown only once.'),
    h('div', { class: 'keybox' }, keyValue),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => copyText(keyValue, 'Recovery key copied. Paste it somewhere safe.') }, 'Copy key'),
      h('button', { class: 'btn', onclick: () => window.print() }, 'Print')),
    h('p', { class: 'muted' }, 'Keep it with your important papers or in a password manager — not in this app.'),
    h('label', { class: 'check' }, ok, 'I have saved my recovery key somewhere safe.'), cont));
}

function viewLogin(id, opts = {}) {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary big', style: { width: '100%' }, type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, err, async () => {
      const r = await api('POST', '/api/login', { username: user.value, password: pass.value });
      state.session.user = r.user;
      if (opts.afterLogin) return opts.afterLogin(r.user);
      go(r.user.role === 'admin' ? '/admin' : '/home', true);
    });
  } },
  opts.embedded ? null : [h('div', { class: 'eyebrow' }, 'Welcome back'), h('h2', null, 'Sign in')],
  field('Username', user), field('Password', pass), err, btn,
  h('p', { class: 'muted', style: { textAlign: 'center' } }, h('button', { type: 'button', class: 'linkish', onclick: () => forgotModal() }, 'Forgot your password?')));
  if (opts.embedded) return form;
  authLayout(id, defaultSide(), h('div', { class: 'card' }, form,
    h('p', { class: 'muted', style: { marginTop: '14px', fontSize: '13.5px' } }, 'Raters: use the personal invitation link you were sent to create your login.')));
}

function forgotModal() {
  const key = h('input', { type: 'text', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = errBox();
  modal({
    title: 'Forgot your password?',
    body: h('div', { class: 'stack' },
      h('div', { class: 'notice' }, h('strong', null, 'Raters: '), 'please ask the person who invited you to reset your password. They will give you a temporary one.'),
      h('h3', null, 'Administrator: use your recovery key'),
      field('Recovery key', key), field('New password', n1, 'At least 10 characters.'), field('Type the new password again', n2), err),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
        if (n1.value !== n2.value) throw new Error('The two passwords do not match.');
        const r = await api('POST', '/api/recover', { recoveryKey: key.value, newPassword: n1.value });
        close();
        state.session.user = r.user;
        alert('Your password has been reset. Your username is: ' + r.username + '\n\nYour old recovery key no longer works. A new one is shown next — please save it.');
        showRecoveryKey(state.renderId, r.recoveryKey, 'Password reset — here is your new recovery key');
      }) }, 'Reset my password')],
  });
}

function viewForcePassword(id) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = errBox();
  const btn = h('button', { class: 'btn primary big', style: { width: '100%' }, type: 'submit' }, 'Save my new password');
  authLayout(id, defaultSide(), h('form', { class: 'card stack', onsubmit: (e) => {
    e.preventDefault();
    busy(btn, err, async () => {
      if (n1.value !== n2.value) throw new Error('The two new passwords do not match.');
      await api('POST', '/api/account/password', { currentPassword: cur.value, newPassword: n1.value });
      state.session = null; toast('Password saved.'); go('/home', true);
    });
  } }, h('h2', null, 'Choose a new password'), h('p', { class: 'muted' }, 'You signed in with a temporary password. Please choose your own to continue.'),
  field('Temporary password', cur), field('New password', n1, 'At least 10 characters.'), field('Type the new password again', n2), err, btn));
}

// ------------------------------------------------------------------ invitation landing
async function viewInvite(id, code) {
  let info;
  try { info = await api('GET', '/api/invite/' + code); }
  catch (e) { return authLayout(id, defaultSide(), h('div', { class: 'card' }, h('h2', null, 'Invitation not found'), h('p', null, e.message))); }
  const u = state.session.user;
  const isSelf = info.relationship === 'self';
  const side = [
    h('div', { class: 'eyebrow', style: { color: '#e3c690' } }, isSelf ? 'Your self-assessment' : 'You are invited to give feedback'),
    h('h1', null, info.subjectName),
    h('p', null, [info.roleTitle, info.organization].filter(Boolean).join(' · ')),
    h('p', null, 'You are responding as: ', h('strong', { style: { color: '#fff' } }, isSelf ? 'Self-assessment' : info.relationshipLabel)),
    h('p', null, plural(info.questionCount, 'statement'), ' · ', timeEstimate(info.questionCount, info.commentsRequired), info.dueDate ? ' · please finish by ' + fmtDue(info.dueDate) : ''),
    h('p', { style: { fontSize: '14px' } }, 'Each statement asks for a rating from ' + info.scale.min + ' to ' + info.scale.max + (info.commentsRequired ? ' and a short comment describing what you have observed' : '') + '. Your answers save as you go, so you can stop and come back any time with the same login.'),
    isSelf ? null : h('p', { style: { fontSize: '14px' } }, 'Your individual answers are seen only by the consultant running this assessment; reports shared with the organization combine feedback from several people.'),
  ];
  const claimAndGo = async () => { const r = await api('POST', '/api/invite/' + code + '/claim'); go('/q/' + r.invitationId, true); };
  if (info.status !== 'open' && !info.mine) {
    return authLayout(id, side, h('div', { class: 'card' }, h('h2', null, 'This questionnaire is closed'), h('p', null, 'Please contact the person who invited you if you still need to respond.')));
  }
  if (u && u.role === 'rater') {
    const err = errBox();
    return authLayout(id, side, h('div', { class: 'card stack' },
      h('h2', null, info.mine ? 'Welcome back, ' + u.displayName : 'Add this to your questionnaires'),
      info.claimed && !info.mine ? h('div', { class: 'warn' }, 'This invitation was already accepted with a different login. If that was you, sign out and sign in with that login.') : null,
      err,
      info.mine ? h('button', { class: 'btn primary big', onclick: () => go('/q/' + info.invitationId) }, 'Continue the questionnaire')
        : h('button', { class: 'btn primary big', disabled: info.claimed, onclick: (e) => busy(e.target, err, claimAndGo) }, 'Start the questionnaire'),
      h('button', { class: 'btn ghost', onclick: signOut }, 'Not ' + u.displayName + '? Sign out')));
  }
  if (u && u.role === 'admin') {
    return authLayout(id, side, h('div', { class: 'card stack' }, h('h2', null, 'You are signed in as the administrator'),
      h('p', null, 'This is the page your rater ', h('strong', null, info.raterName), ' will see. To test it as a rater, open this link in a private/incognito window.'),
      h('button', { class: 'btn', onclick: () => go('/admin') }, 'Back to my workspace')));
  }
  // Not signed in: create a login (default) or sign in.
  let mode = info.claimed ? 'login' : 'create';
  const holder = h('div');
  const draw = () => {
    const seg = h('div', { class: 'seg' },
      h('button', { class: mode === 'create' ? 'active' : '', disabled: info.claimed, onclick: () => { mode = 'create'; draw(); } }, 'Create my login'),
      h('button', { class: mode === 'login' ? 'active' : '', onclick: () => { mode = 'login'; draw(); } }, 'I already have a login'));
    let body;
    if (mode === 'login') {
      body = viewLogin(id, { embedded: true, afterLogin: async () => { try { await claimAndGo(); } catch (e) { toast(e.message); go('/home', true); } } });
    } else {
      const name = h('input', { type: 'text', autocomplete: 'name', value: info.raterName || '' });
      const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Your email address works well' });
      const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
      const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
      const err = errBox();
      const btn = h('button', { class: 'btn primary big', style: { width: '100%' }, type: 'submit' }, 'Create login & start');
      body = h('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        busy(btn, err, async () => {
          if (p1.value !== p2.value) throw new Error('The two passwords do not match.');
          const r = await api('POST', '/api/register', { inviteCode: code, displayName: name.value, username: user.value, password: p1.value });
          state.session.user = r.user;
          await claimAndGo();
        });
      } }, field('Your name', name), field('Choose a username', user, 'You will use this to sign back in.'),
      field('Choose a password', p1, 'At least 10 characters.'), field('Type the password again', p2), err, btn);
    }
    setKids(holder, h('div', { class: 'card' }, h('h2', { style: { marginBottom: '14px' } }, 'Hello' + (info.raterName ? ', ' + info.raterName.split(' ')[0] : '')), seg, body));
  };
  draw();
  authLayout(id, side, holder);
}

// ------------------------------------------------------------------ rater: home
async function viewRaterHome(id) {
  loading(id, 'home');
  let data;
  try { data = await api('GET', '/api/my'); } catch (e) { return mount(id, topbar('home'), page('narrow', h('div', { class: 'error' }, e.message))); }
  const list = data.questionnaires;
  mount(id, topbar('home'), page('narrow',
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Your feedback'), h('h1', null, 'My questionnaires'),
      h('p', null, 'Your answers save automatically. Come back any time with the same login.'))),
    list.length ? h('div', { class: 'a-list' }, list.map((q) => {
      const pct = Math.round((q.progress.answered / q.progress.total) * 100);
      return h('div', { class: 'a-card', style: { gridTemplateColumns: '1fr 200px' } },
        h('div', null, h('h3', null, q.subjectName), h('div', { class: 'meta' }, [q.roleTitle, q.organization].filter(Boolean).join(' · ')),
          h('div', { class: 'meta' }, 'You are responding as ', h('strong', null, q.relationship === 'self' ? 'Self-assessment' : q.relationshipLabel), q.dueDate ? ' · due ' + fmtDue(q.dueDate) : '')),
        h('div', null, q.submittedAt ? h('span', { class: 'chip submitted' }, '✓ Submitted ' + fmtDate(q.submittedAt))
          : q.status !== 'open' ? h('span', { class: 'chip closed' }, 'Closed')
            : [h('div', { class: 'progress', style: { marginBottom: '8px' } }, h('i', { style: { width: pct + '%' } })),
              h('div', { class: 'row between' }, h('small', null, q.progress.answered + ' of ' + q.progress.total), link('/q/' + q.id, { class: 'btn primary small' }, pct ? 'Continue' : 'Start'))]));
    })) : h('div', { class: 'card empty' }, h('h3', null, 'No questionnaires yet'), h('p', null, 'Open the invitation link you were sent and it will appear here.'))));
}

