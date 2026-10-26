'use strict';
/* Previan Assessment App — administrator screens. Loaded after app.js. */

const SHORT = { board: 'Board', manager: 'Manager', peer: 'Peers', direct_report: 'Reports', customer: 'Clients', other: 'Other' };
const inviteLink = (code) => location.origin + '/i/' + code;
const isLocal = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const relSelect = (value, includeSelf = true) => h('select', null, REL_ORDER.filter((k) => includeSelf || k !== 'self').map((k) => h('option', { value: k, selected: k === value }, k === 'self' ? 'Self (the person being assessed)' : REL[k])));

// ------------------------------------------------------------------ dashboard
async function viewAdminHome(id) {
  loading(id, 'assessments');
  let data;
  try { data = await api('GET', '/api/admin/overview'); } catch (e) { return mount(id, topbar('assessments'), page('', h('div', { class: 'error' }, e.message))); }
  const list = data.assessments;
  const open = list.filter((a) => a.status === 'open');
  const filter = h('input', { type: 'search', placeholder: 'Search by name, organization, or role', style: { maxWidth: '360px', marginTop: 0 } });
  const holder = h('div', { class: 'a-list' });
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = list.filter((a) => !q || [a.subjectName, a.organization, a.roleTitle, a.cohort].join(' ').toLowerCase().includes(q));
    setKids(holder, ...(shown.length ? shown.map((a) => {
      const pct = a.invited ? Math.round((a.submitted / a.invited) * 100) : 0;
      return link('/admin/a/' + a.id, { class: 'a-card' },
        h('div', null, h('h3', null, a.subjectName), h('div', { class: 'meta' }, [a.roleTitle, a.organization, a.cohort].filter(Boolean).join(' · ') || 'No role or organization yet')),
        h('div', null, h('div', { class: 'row between', style: { marginBottom: '6px', fontSize: '13.5px' } }, h('span', null, a.submitted + ' of ' + a.invited + ' submitted'), a.inProgress ? h('small', null, a.inProgress + ' in progress') : null),
          h('div', { class: 'progress' }, h('i', { style: { width: pct + '%' } }))),
        h('div', { style: { textAlign: 'right' } }, h('span', { class: 'chip ' + a.status }, a.status === 'open' ? 'Collecting' : 'Closed'), h('div', { class: 'meta' }, a.dueDate ? 'Due ' + fmtDue(a.dueDate) : '')));
    }) : [h('div', { class: 'card empty' }, h('h3', null, list.length ? 'No matches' : 'No assessments yet'),
      h('p', null, list.length ? 'Try a different search.' : 'Create your first 360° assessment to get started.'),
      list.length ? null : link('/admin/new', { class: 'btn primary' }, '+ New assessment'))]));
  };
  filter.addEventListener('input', draw);
  draw();
  mount(id, topbar('assessments'), page('',
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Welcome, ' + state.session.user.displayName.split(' ')[0]), h('h1', null, 'Assessments'),
      h('p', null, open.length + ' collecting · ' + (list.length - open.length) + ' closed · ' + plural(data.raterCount, 'rater login'))),
    link('/admin/new', { class: 'btn primary big' }, '+ New assessment')),
    isLocal() ? h('div', { class: 'warn', style: { marginBottom: '16px' } }, h('strong', null, 'Trial mode on this computer. '), 'Invitation links work only on this PC until the app is put online. See "Going online" in the Start Here guide.') : null,
    list.length > 3 ? h('div', { style: { marginBottom: '14px' } }, filter) : null,
    holder));
}

// ------------------------------------------------------------------ new assessment
async function viewNewAssessment(id) {
  loading(id, 'assessments');
  let data;
  try { data = await api('GET', '/api/admin/overview'); } catch (e) { return mount(id, topbar('assessments'), page('', h('div', { class: 'error' }, e.message))); }
  const lib = data.library;
  const copyId = qs('copy');
  const source = copyId ? data.assessments.find((a) => a.id === copyId) : null;
  const inp = (attrs) => h('input', { type: 'text', ...attrs });
  const f = {
    subjectName: inp({ placeholder: 'Full name of the person being assessed' }),
    roleTitle: inp({ placeholder: 'e.g. Chief Operating Officer', value: source ? source.roleTitle : '' }),
    organization: inp({ placeholder: 'Client organization', value: source ? source.organization : '' }),
    cohort: inp({ placeholder: 'Optional — e.g. Senior Leadership Team 2026', value: source ? source.cohort : '' }),
    dueDate: h('input', { type: 'date' }),
    targetScore: h('select', null, [5, 6, 7, 8, 9, 10].map((v) => h('option', { value: v, selected: v === 8 }, v + ' out of 10'))),
    scale: h('select', null, h('option', { value: '1-10' }, '1–10 (Rarely … Always)'), h('option', { value: '0-10' }, '0–10 (Never … Always), the original master scale'), h('option', { value: '1-5' }, '1–5')),
  };
  f.scale.addEventListener('change', () => {
    const max = f.scale.value === '1-5' ? 5 : 10;
    f.setKids(targetScore, ...Array.from({ length: max === 5 ? 4 : 6 }, (_, i) => (max === 5 ? 2 + i : 5 + i)).map((v) => h('option', { value: v, selected: v === (max === 5 ? 4 : 8) }, v + ' out of ' + max)));
  });

  let mode = source ? 'copy' : 'template';
  let chosen = new Set((lib.templates[0] || { competencyIds: [] }).competencyIds);
  let activeTpl = lib.templates[0] ? lib.templates[0].id : null;
  const pickArea = h('div');
  const countEl = h('strong');
  const categories = [...new Set(lib.competencies.map((c) => c.category))];

  function drawPick() {
    countEl.textContent = mode === 'copy' ? (source ? source.questionCount + ' statements copied' : '') : chosen.size + ' statements selected';
    if (mode === 'copy') {
      const sel = h('select', null, h('option', { value: '' }, 'Choose an assessment…'), data.assessments.map((a) => h('option', { value: a.id, selected: source && a.id === source.id }, a.subjectName + (a.organization ? ' — ' + a.organization : '') + ' (' + a.questionCount + ')')));
      sel.addEventListener('change', () => { pickArea.dataset.copy = sel.value; countEl.textContent = sel.value ? data.assessments.find((a) => a.id === sel.value).questionCount + ' statements copied' : ''; });
      if (source) pickArea.dataset.copy = source.id;
      setKids(pickArea, field('Copy all questions (including your edits) from', sel, 'Perfect for the next person in the same cohort or role.'));
      return;
    }
    setKids(pickArea, 
      h('div', { class: 'grid three', style: { marginBottom: '16px' } }, lib.templates.map((t) => h('button', { type: 'button', class: 'tpl' + (activeTpl === t.id ? ' active' : ''), onclick: () => { activeTpl = t.id; chosen = new Set(t.competencyIds); drawPick(); } },
        h('strong', null, t.name), h('span', null, plural(t.competencyIds.length, 'statement') + (t.description ? ' · ' + t.description : ''))))),
      h('p', { class: 'muted' }, 'Fine-tune below: tick or untick any statement. You can also edit wording, reorder, or add new questions after creating it.'),
      categories.map((cat) => {
        const items = lib.competencies.filter((c) => c.category === cat);
        const all = items.every((c) => chosen.has(c.id));
        return h('div', { class: 'pick-group' },
          h('header', null, h('strong', null, cat), h('button', { type: 'button', class: 'btn small', onclick: () => { items.forEach((c) => (all ? chosen.delete(c.id) : chosen.add(c.id))); activeTpl = null; drawPick(); } }, all ? 'Untick all' : 'Tick all')),
          items.map((c) => {
            const cb = h('input', { type: 'checkbox', checked: chosen.has(c.id) });
            cb.addEventListener('change', () => { cb.checked ? chosen.add(c.id) : chosen.delete(c.id); activeTpl = null; countEl.textContent = chosen.size + ' statements selected'; });
            return h('label', { class: 'pick-item' }, cb, h('span', null, c.name ? h('b', null, c.name + '. ') : null, c.statement, c.core ? [' ', h('span', { class: 'chip core' }, 'Core')] : null));
          }));
      }));
  }
  drawPick();
  const modeSeg = h('div', { class: 'seg', style: { maxWidth: '520px' } });
  const drawSeg = () => setKids(modeSeg, 
    h('button', { type: 'button', class: mode === 'template' ? 'active' : '', onclick: () => { mode = 'template'; drawSeg(); drawPick(); } }, 'Start from the question library'),
    h('button', { type: 'button', class: mode === 'copy' ? 'active' : '', disabled: !data.assessments.length, onclick: () => { mode = 'copy'; drawSeg(); drawPick(); } }, 'Copy a previous assessment'));
  drawSeg();
  const err = errBox();
  const createBtn = h('button', { class: 'btn primary big', onclick: () => busy(createBtn, err, async () => {
    const body = { subjectName: f.subjectName.value, roleTitle: f.roleTitle.value, organization: f.organization.value, cohort: f.cohort.value, dueDate: f.dueDate.value, targetScore: Number(f.targetScore.value), scale: f.scale.value };
    if (mode === 'copy') { if (!pickArea.dataset.copy) throw new Error('Choose an assessment to copy.'); body.copyFromAssessmentId = pickArea.dataset.copy; }
    else { if (!chosen.size) throw new Error('Tick at least one statement.'); body.competencyIds = lib.competencies.filter((c) => chosen.has(c.id)).map((c) => c.id); }
    const r = await api('POST', '/api/admin/assessments', body);
    toast('Assessment created. Next: add your raters.');
    go('/admin/a/' + r.id + '?tab=raters', true);
  }) }, 'Create assessment');

  mount(id, topbar('assessments'), page('',
    h('div', { class: 'page-head' }, h('div', null, link('/admin', { class: 'muted' }, '← Assessments'), h('h1', { style: { marginTop: '8px' } }, 'New assessment'))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '1. Who is being assessed?')),
      h('div', { class: 'form-grid' }, h('div', { class: 'full' }, field('Name *', f.subjectName)), field('Role / title', f.roleTitle), field('Organization', f.organization),
        field('Cohort or group', f.cohort, 'Optional — groups several leaders from one client.'), field('Due date', f.dueDate, 'Shown to raters. Optional.'),
        field('Rating scale', f.scale), field('Target score', f.targetScore, 'The standard you compare results against.'))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, '2. Which statements should raters answer?'), countEl), modeSeg, pickArea),
    h('div', { class: 'card' }, err, h('div', { class: 'row between' }, h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing is sent to anyone yet. You will add raters next.'), createBtn))));
}

// ------------------------------------------------------------------ one assessment
async function viewAssessment(id, aid) {
  loading(id, 'assessments');
  let data;
  try { data = await api('GET', '/api/admin/assessments/' + aid); } catch (e) { return mount(id, topbar('assessments'), page('', h('div', { class: 'error' }, e.message))); }
  const a = data.assessment;
  const inv = data.invitations;
  const tab = qs('tab') || 'overview';
  const setTab = (t) => go('/admin/a/' + aid + '?tab=' + t);
  const submitted = inv.filter((i) => i.status === 'submitted').length;
  const tabs = [['overview', 'Overview'], ['raters', 'Raters', inv.length], ['questions', 'Questions', a.questions.length], ['results', 'Results', submitted], ['settings', 'Settings']];
  const body = h('div');
  const head = h('div', { class: 'page-head' },
    h('div', null, link('/admin', { class: 'muted no-print' }, '← Assessments'),
      h('h1', { style: { marginTop: '8px' } }, a.subjectName),
      h('p', null, [a.roleTitle, a.organization, a.cohort].filter(Boolean).join(' · ') || ' ', ' ', h('span', { class: 'chip ' + a.status }, a.status === 'open' ? 'Collecting responses' : 'Closed'))),
    h('div', { class: 'row no-print' }, link('/admin/new?copy=' + a.id, { class: 'btn' }, 'Duplicate for another person')));
  mount(id, topbar('assessments'), page('', head,
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label, n]) => h('button', { role: 'tab', class: tab === k ? 'active' : '', 'aria-selected': String(tab === k), onclick: () => setTab(k) }, label, n !== undefined ? h('span', { class: 'count' }, n) : null))),
    body));
  const ctx = { a, inv, data, reload: () => render(), setTab, body };
  if (tab === 'raters') return tabRaters(ctx);
  if (tab === 'questions') return tabQuestions(ctx);
  if (tab === 'results') return tabResults(ctx);
  if (tab === 'settings') return tabSettings(ctx);
  return tabOverview(ctx);
}

function tabOverview({ a, inv, setTab, body }) {
  const by = (s) => inv.filter((i) => i.status === s).length;
  const submitted = by('submitted');
  const others = inv.filter((i) => i.status === 'submitted' && i.relationship !== 'self').length;
  const selfInv = inv.find((i) => i.relationship === 'self');
  const step = (done, title, detail, action) => h('div', { class: 'step' + (done ? ' done' : '') }, h('span', { class: 'dot' }, done ? '✓' : ''),
    h('div', { style: { flex: 1 } }, h('strong', null, title), h('div', { class: 'muted', style: { fontSize: '13.5px' } }, detail)), action || null);
  setKids(body, 
    h('div', { class: 'grid four' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Raters invited'), h('div', { class: 'value' }, inv.length)),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Submitted'), h('div', { class: 'value' }, submitted, h('small', null, ' / ' + inv.length))),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'In progress'), h('div', { class: 'value' }, by('in_progress'))),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Due'), h('div', { class: 'value', style: { fontSize: '20px' } }, a.dueDate ? fmtDue(a.dueDate) : 'No date'))),
    h('div', { class: 'card', style: { marginTop: '16px' } }, h('h2', { style: { marginBottom: '14px' } }, 'Your checklist'),
      h('div', { class: 'steps' },
        step(true, 'Questions ready — ' + plural(a.questions.length, 'statement'), 'Review the wording, or add questions specific to this role.', h('button', { class: 'btn small', onclick: () => setTab('questions') }, 'Review')),
        step(inv.length > 0, 'Add raters', inv.length ? plural(inv.length, 'rater') + (selfInv ? ', including the self-assessment' : ' — consider adding a self-assessment') : 'Add the board members, manager, peers, and direct reports who will give feedback.', h('button', { class: 'btn small', onclick: () => setTab('raters') }, 'Raters')),
        step(inv.some((i) => i.status !== 'not_started'), 'Send each rater their personal link', 'Use the Email or Copy link buttons on the Raters tab.'),
        step(others >= (a.minGroupSize || 3), 'Collect responses', others + ' from other raters so far. At least ' + (a.minGroupSize || 3) + ' are needed before the combined report is shared with a client.'),
        step(false, 'Review the results', 'Scores and comments are tallied automatically as responses arrive.', h('button', { class: 'btn small primary', onclick: () => setTab('results') }, 'Results')))));
}

// ------------------------------------------------------------------ raters tab
function inviteEmail(a, i) {
  const first = (i.raterName || '').split(' ')[0];
  const sender = state.session.user.displayName;
  const subj = (i.relationship === 'self' ? 'Your 360° self-assessment' : '360° feedback for ' + a.subjectName);
  const lines = [
    'Dear ' + (first || 'colleague') + ',', '',
    i.relationship === 'self'
      ? 'As part of your 360° leadership assessment, please complete the self-assessment using your personal link below.'
      : 'You have been asked to provide confidential feedback on ' + a.subjectName + (a.roleTitle ? ' (' + a.roleTitle + ')' : '') + ' as part of a 360° leadership assessment.',
    '', 'Your personal link:', inviteLink(i.code), '',
    'When you open it, create a username and password. You will see a short set of guidelines first. Every statement asks for a rating and a brief comment describing what you have observed; it takes ' + timeEstimate(a.questions.length, a.commentsRequired !== false) + '. Your answers save as you go, so you can stop and come back at any time.',
    a.dueDate ? 'Please complete it by ' + fmtDue(a.dueDate) + '.' : null,
    '', i.relationship === 'self' ? null : 'Your individual answers are seen only by me; the report shared with the organization combines feedback from several people.',
    '', 'Thank you,', sender,
  ].filter((x) => x !== null);
  return 'mailto:' + encodeURIComponent(i.raterEmail || '') + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(lines.join('\n'));
}

function tabRaters(ctx) {
  const { a, inv, body, reload } = ctx;
  const name = h('input', { type: 'text', placeholder: 'Full name' });
  const email = h('input', { type: 'email', placeholder: 'Email (optional, used for the invitation email)' });
  const rel = relSelect('peer', !inv.some((i) => i.relationship === 'self'));
  const err = errBox();
  const add = h('button', { class: 'btn primary', onclick: () => busy(add, err, async () => {
    await api('POST', '/api/admin/assessments/' + a.id + '/raters', { raters: [{ raterName: name.value, raterEmail: email.value, relationship: rel.value }] });
    toast('Rater added.'); reload();
  }) }, 'Add rater');

  const menuFor = (i) => {
    const items = [
      ['Copy personal link', () => copyText(inviteLink(i.code), 'Link copied — paste it into an email or text message.')],
      ['Edit name, email, or relationship', () => editRaterModal(a, i, reload)],
      i.status === 'submitted' || i.status === 'excluded' ? ['View their answers', () => viewResponseModal(i.id)] : null,
      i.status === 'submitted' ? ['Exclude from results…', () => excludeModal(i, reload)] : null,
      i.status === 'excluded' ? ['Include in results again', async () => { await api('PATCH', '/api/admin/invitations/' + i.id, { excluded: false }); toast('Included again.'); reload(); }] : null,
      i.submittedAt ? ['Reopen so they can make changes', async () => {
        if (!(await confirmBox('Reopen this questionnaire?', i.raterName + ' will be able to change their answers and must submit again. Their answers stay saved.', 'Reopen'))) return;
        await api('PATCH', '/api/admin/invitations/' + i.id, { reopen: true }); toast('Reopened.'); reload();
      }] : null,
      i.account && !i.submittedAt ? ['Disconnect login (wrong person used the link)', async () => {
        if (!(await confirmBox('Disconnect this login?', 'The link will be free to use again. Any draft answers stay with the invitation.', 'Disconnect'))) return;
        await api('PATCH', '/api/admin/invitations/' + i.id, { unlink: true }); toast('Login disconnected.'); reload();
      }] : null,
      ['Remove rater…', async () => {
        if (!(await confirmBox('Remove ' + i.raterName + '?', i.submittedAt ? 'Their submitted answers will be permanently deleted from this assessment.' : 'Their link will stop working.', 'Remove', true))) return;
        await api('DELETE', '/api/admin/invitations/' + i.id); toast('Rater removed.'); reload();
      }],
    ].filter(Boolean);
    const menu = h('div', { class: 'menu', hidden: true, style: { right: 0, top: '36px', minWidth: '260px' } }, items.map(([label, fn]) => h('button', { onclick: (e) => { menu.hidden = true; Promise.resolve(fn()).catch((x) => toast(x.message)); } }, label)));
    return h('div', { class: 'usermenu' }, h('button', { class: 'btn small', style: { borderRadius: '7px', color: 'var(--ink)', borderColor: 'var(--line)' }, onclick: (e) => { e.stopPropagation(); document.querySelectorAll('.usermenu .menu').forEach((m) => { if (m !== menu) m.hidden = true; }); menu.hidden = !menu.hidden; } }, 'More ▾'), menu);
  };

  const sorted = [...inv].sort((x, y) => REL_ORDER.indexOf(x.relationship) - REL_ORDER.indexOf(y.relationship));
  const table = inv.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, ['Rater', 'Relationship', 'Status', 'Progress', 'Last activity', ''].map((t) => h('th', null, t)))),
    h('tbody', null, sorted.map((i) => h('tr', null,
      h('td', null, h('strong', null, i.raterName), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, i.raterEmail || (i.account ? 'Login: ' + i.account.username : 'No email'))),
      h('td', null, h('span', { class: 'chip' + (i.relationship === 'self' ? ' self' : '') }, REL[i.relationship])),
      h('td', null, h('span', { class: 'chip ' + i.status }, STATUS[i.status]), i.excludedReason ? h('div', { class: 'muted', style: { fontSize: '12px' } }, i.excludedReason) : null),
      h('td', { style: { minWidth: '120px' } }, h('div', { class: 'progress' }, h('i', { style: { width: Math.round((i.progress.answered / i.progress.total) * 100) + '%' } })), h('small', null, i.progress.answered + '/' + i.progress.total)),
      h('td', null, h('small', null, i.submittedAt ? 'Submitted ' + fmtDateTime(i.submittedAt) : fmtDateTime(i.lastActivity || i.claimedAt))),
      h('td', { class: 'num' }, h('div', { class: 'row end', style: { flexWrap: 'nowrap' } },
        i.submittedAt ? null : h('a', { class: 'btn small', href: inviteEmail(a, i) }, i.status === 'not_started' ? 'Email invite' : 'Email reminder'),
        menuFor(i))))))))
    : h('div', { class: 'card empty' }, h('h3', null, 'No raters yet'), h('p', null, 'Add each person who will give feedback. Each gets a personal link.'));

  setKids(body, 
    isLocal() ? h('div', { class: 'warn', style: { marginBottom: '14px' } }, 'Trial mode: links start with ', h('code', null, location.origin), ' and only open on this computer. Once the app is online, links will work for anyone.') : null,
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Add a rater'), h('button', { class: 'btn small', onclick: () => bulkRatersModal(a, inv, reload) }, 'Add several at once')),
      h('div', { class: 'grid', style: { gridTemplateColumns: '1.2fr 1.4fr 1fr auto', alignItems: 'end' } }, field('Name', name), field('Email', email), field('Relationship', rel), add), err),
    h('div', { class: 'card-head', style: { marginTop: '22px' } }, h('h2', null, 'Raters'),
      inv.length ? h('button', { class: 'btn small', onclick: () => copyText(sorted.map((i) => i.raterName + ' (' + REL[i.relationship] + '): ' + inviteLink(i.code)).join('\n'), 'All links copied.') }, 'Copy all links') : null),
    table);
}

function guessRel(s) {
  const t = (s || '').toLowerCase();
  if (/\bself\b/.test(t)) return 'self';
  if (/board|director|chair/.test(t)) return 'board';
  if (/manager|boss|ceo|supervisor|report(s)? to/.test(t)) return 'manager';
  if (/direct|subordinate|team member|reports?\b/.test(t)) return 'direct_report';
  if (/peer|colleague/.test(t)) return 'peer';
  if (/client|customer|vendor|partner/.test(t)) return 'customer';
  return null;
}

function bulkRatersModal(a, inv, reload) {
  const ta = h('textarea', { rows: 8, placeholder: 'One rater per line:  Name, email, relationship\n\nJane Smith, jane@acme.com, board\nTom Lee, tom@acme.com, peer\nMaria Gomez, , direct report' });
  const err = errBox();
  const preview = h('div');
  let parsed = [];
  const parse = () => {
    parsed = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split(/\t|,|;/).map((x) => x.trim());
      const emailPart = parts.find((x) => /@/.test(x)) || '';
      const relPart = parts.slice(1).find((x) => guessRel(x)) || '';
      return { raterName: parts[0], raterEmail: emailPart, relationship: guessRel(relPart) || 'peer' };
    }).filter((r) => r.raterName);
    setKids(preview, parsed.length ? h('table', { class: 'table', style: { marginTop: '12px' } }, h('tbody', null, parsed.map((r) => {
      const sel = relSelect(r.relationship);
      sel.style.marginTop = '0';
      sel.addEventListener('change', () => { r.relationship = sel.value; });
      return h('tr', null, h('td', null, r.raterName), h('td', null, h('small', null, r.raterEmail || '—')), h('td', null, sel));
    }))) : null);
  };
  ta.addEventListener('input', parse);
  modal({ title: 'Add several raters', subtitle: 'Paste from a spreadsheet or type them in. Check the relationships before adding.', wide: true,
    body: h('div', null, ta, preview, err),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
      if (!parsed.length) throw new Error('Add at least one line.');
      await api('POST', '/api/admin/assessments/' + a.id + '/raters', { raters: parsed });
      close(); toast(plural(parsed.length, 'rater') + ' added.'); reload();
    }) }, 'Add raters')] });
}

function editRaterModal(a, i, reload) {
  const name = h('input', { type: 'text', value: i.raterName });
  const email = h('input', { type: 'email', value: i.raterEmail });
  const rel = relSelect(i.relationship);
  const err = errBox();
  modal({ title: 'Edit rater', body: h('div', { class: 'stack' }, field('Name', name), field('Email', email), field('Relationship', rel, i.submittedAt ? 'Changing this moves their ratings to a different group in the results.' : null), err),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
      await api('PATCH', '/api/admin/invitations/' + i.id, { raterName: name.value, raterEmail: email.value, relationship: rel.value });
      close(); toast('Saved.'); reload();
    }) }, 'Save')] });
}

function excludeModal(i, reload) {
  const reason = h('input', { type: 'text', placeholder: 'e.g. Duplicate response, rater did not work with this person' });
  const err = errBox();
  modal({ title: 'Exclude ' + i.raterName + ' from results?', body: h('div', { class: 'stack' }, h('p', null, 'Their answers are kept, but left out of every score and comment list. You can include them again at any time.'), field('Reason (for your records)', reason), err),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn danger', onclick: (e) => busy(e.target, err, async () => {
      await api('PATCH', '/api/admin/invitations/' + i.id, { excluded: true, excludedReason: reason.value });
      close(); toast('Excluded from results.'); reload();
    }) }, 'Exclude')] });
}

async function viewResponseModal(invId) {
  let d;
  try { d = await api('GET', '/api/admin/invitations/' + invId + '/response'); } catch (e) { return toast(e.message); }
  const i = d.invitation;
  const split = Object.values(d.answers).some((x) => x.strength || x.development);
  modal({ wide: true, title: i.raterName + ' — ' + REL[i.relationship], subtitle: (i.account ? 'Login: ' + i.account.username + ' · ' : '') + 'Submitted ' + fmtDateTime(i.submittedAt) + (i.excluded ? ' · EXCLUDED from results' : ''),
    body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Statement'), h('th', { class: 'num' }, 'Rating'), split ? [h('th', null, 'Strength'), h('th', null, 'Development need')] : h('th', null, 'Comment'))),
      h('tbody', null, d.questions.map((q, n) => {
        const ans = d.answers[q.id] || {};
        return h('tr', null, h('td', { class: 'muted' }, n + 1), h('td', null, q.name ? h('strong', null, q.name + '. ') : null, q.statement),
          h('td', { class: 'num' }, h('strong', null, ans.rating === 'na' ? 'N/O' : ans.rating ?? '—')),
          split ? [h('td', { style: { whiteSpace: 'pre-wrap', fontSize: '13.5px' } }, ans.strength || ''), h('td', { style: { whiteSpace: 'pre-wrap', fontSize: '13.5px' } }, ans.development || '')]
            : h('td', { style: { whiteSpace: 'pre-wrap', fontSize: '13.5px', minWidth: '260px' } }, [ans.comment, ans.strength, ans.development].filter(Boolean).join('\n')));
      })))),
    foot: (close) => [h('button', { class: 'btn', onclick: () => window.print() }, 'Print'), h('button', { class: 'btn primary', onclick: close }, 'Close')] });
}

// ------------------------------------------------------------------ questions tab
function questionEditor(list, { onChange, showCore } = {}) {
  const wrap = h('div');
  const cats = () => [...new Set(list.map((q) => q.category).filter(Boolean))];
  const listId = 'cats-' + Math.random().toString(36).slice(2);
  const draw = () => {
    const dl = h('datalist', { id: listId }, cats().map((c) => h('option', { value: c })));
    setKids(wrap, dl, list.length ? null : h('p', { class: 'muted' }, 'No questions yet.'), ...list.map((q, n) => {
      const cat = h('input', { type: 'text', value: q.category, list: listId, placeholder: 'Category', 'aria-label': 'Category' });
      const nm = h('input', { type: 'text', value: q.name || '', placeholder: 'Short name', 'aria-label': 'Short name' });
      const st = h('textarea', { value: q.statement, rows: 2, placeholder: 'Statement raters will rate', 'aria-label': 'Statement' });
      cat.addEventListener('input', () => { q.category = cat.value; onChange && onChange(); });
      nm.addEventListener('input', () => { q.name = nm.value; onChange && onChange(); });
      st.addEventListener('input', () => { q.statement = st.value; onChange && onChange(); });
      const move = (d) => { const j = n + d; if (j < 0 || j >= list.length) return; [list[n], list[j]] = [list[j], list[n]]; draw(); onChange && onChange(); };
      const core = showCore ? h('label', { class: 'check', style: { fontSize: '12.5px', whiteSpace: 'nowrap', paddingTop: '6px' }, title: 'Core statements apply to every role' }, (() => { const c = h('input', { type: 'checkbox', checked: Boolean(q.core) }); c.addEventListener('change', () => { q.core = c.checked; onChange && onChange(); }); return c; })(), 'Core') : null;
      return h('div', { class: 'q-edit' }, h('div', { class: 'n' }, n + 1), h('div', { class: 'cat' }, cat), h('div', { class: 'nm' }, nm), h('div', { class: 'st' }, st),
        h('div', { class: 'tools' }, core,
          h('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn del', title: 'Remove', 'aria-label': 'Remove', onclick: () => { list.splice(n, 1); draw(); onChange && onChange(); } }, '✕')));
    }));
  };
  draw();
  return { el: wrap, redraw: draw };
}

async function tabQuestions({ a, data, body, reload }) {
  if (data.lockedQuestions) {
    setKids(body, h('div', { class: 'notice', style: { marginBottom: '14px' } }, 'These questions are locked because responses have been submitted — changing them now would mix answers to different questions. To use a different set, click "Duplicate for another person".'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, a.questions.map((q, n) => h('tr', null, h('td', { class: 'muted' }, n + 1), h('td', null, h('small', null, q.category)), h('td', null, q.name ? h('strong', null, q.name + '. ') : null, q.statement)))))));
    return;
  }
  const list = a.questions.map((q) => ({ ...q }));
  let dirty = false;
  const status = h('span', { class: 'muted' }, 'All changes saved');
  const saveBtn = h('button', { class: 'btn primary', disabled: true }, 'Save changes');
  const mark = () => { dirty = true; saveBtn.disabled = false; status.textContent = 'Unsaved changes'; status.className = 'neg'; };
  const ed = questionEditor(list, { onChange: mark });
  const err = errBox();
  saveBtn.addEventListener('click', () => busy(saveBtn, err, async () => {
    await api('PUT', '/api/admin/assessments/' + a.id + '/questions', { questions: list });
    dirty = false; toast('Questions saved.'); reload();
  }));
  window.onbeforeunload = () => (dirty ? 'You have unsaved changes.' : undefined);
  let lib;
  const addFromLibrary = async () => {
    if (!lib) lib = (await api('GET', '/api/admin/overview')).library;
    const present = new Set(list.map((q) => q.statement));
    const chosen = new Set();
    const cats = [...new Set(lib.competencies.map((c) => c.category))];
    modal({ wide: true, title: 'Add from the question library', subtitle: 'Already-included statements are greyed out.',
      body: h('div', null, cats.map((cat) => h('div', { class: 'pick-group' }, h('header', null, h('strong', null, cat)),
        lib.competencies.filter((c) => c.category === cat).map((c) => {
          const has = present.has(c.statement);
          const cb = h('input', { type: 'checkbox', disabled: has, checked: has });
          cb.addEventListener('change', () => (cb.checked ? chosen.add(c) : chosen.delete(c)));
          return h('label', { class: 'pick-item', style: has ? { opacity: .5 } : null }, cb, h('span', null, c.name ? h('b', null, c.name + '. ') : null, c.statement));
        })))),
      foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        for (const c of chosen) list.push({ category: c.category, name: c.name, statement: c.statement });
        close(); ed.redraw(); if (chosen.size) mark();
      } }, 'Add selected')] });
  };
  setKids(body, 
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Questions for ' + a.subjectName + ' (' + list.length + ' of up to 200)'), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Edit wording, reorder, or remove statements. Changes here affect only this assessment, not your library.')),
        h('div', { class: 'row' }, status, saveBtn)),
      h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('button', { class: 'btn small', onclick: () => { list.push({ category: list.length ? list[list.length - 1].category : 'General', name: '', statement: '' }); ed.redraw(); mark(); } }, '+ Add a question'),
        h('button', { class: 'btn small', onclick: () => addFromLibrary().catch((e) => toast(e.message)) }, '+ Add from library'),
        h('button', { class: 'btn small', onclick: () => importModal((items) => { list.push(...items); ed.redraw(); mark(); }) }, 'Import from Word, Excel, or text')),
      err, ed.el));
}

// ------------------------------------------------------------------ importer (shared)
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseQuestionLines(lines, defaultCategory) {
  const skipWords = /^(#|no\.?|score|rating|statement|statements|question|questions|comment.*|strength.*|development.*|n\/?a)$/i;
  const ignoreHeading = /instruction|rating scale|scale|direction|questionnaire|survey|comment|reworded|page \d|confidential/i;
  const rows = lines.map((l) => {
    let cells = l.includes(' | ') ? l.split(' | ') : l.includes('\t') ? l.split('\t') : [l];
    cells = cells.map((c) => c.trim()).filter(Boolean);
    let num = null;
    if (cells.length && /^\d{1,3}[.)]?$/.test(cells[0])) num = parseInt(cells.shift(), 10);
    else if (cells.length === 1) { const m = cells[0].match(/^(\d{1,3})[.)]\s+(.+)$/); if (m) { num = parseInt(m[1], 10); cells = [m[2]]; } }
    while (cells.length > 1 && /^\d{1,2}(\.\d)?$/.test(cells[cells.length - 1])) cells.pop();
    return { cells, num, raw: l };
  });
  const numberedCount = rows.filter((r) => r.num !== null).length;
  let map = null; let category = '';
  const items = [];
  for (const r of rows) {
    const lower = r.cells.map((c) => c.toLowerCase());
    if (lower.length > 1 && lower.some((c) => /statement|question|behavio/.test(c)) && lower.every((c) => skipWords.test(c) || /statement|question|competenc|category|name|behavio|title/.test(c))) {
      map = { cat: lower.findIndex((c) => /category|cluster|group|section/.test(c)), name: lower.findIndex((c) => /competenc|name|title/.test(c)), st: lower.findIndex((c) => /statement|question|behavio/.test(c)) };
      continue;
    }
    if (!r.cells.length) continue;
    if (map && map.st >= 0 && r.cells[map.st]) {
      items.push({ include: true, category: (map.cat >= 0 && r.cells[map.cat]) || category || defaultCategory, name: map.name >= 0 ? r.cells[map.name] || '' : '', statement: r.cells[map.st] });
      continue;
    }
    if (lower.every((c) => skipWords.test(c))) continue;
    const joined = r.cells.join(' — ');
    const looksHeading = r.num === null && r.cells.length === 1 && joined.length <= 60 && !/[.?!:]$/.test(joined);
    if (looksHeading) { if (!ignoreHeading.test(joined)) category = joined; continue; }
    if (numberedCount >= 3 && r.num === null) continue; // instructions or notes in a numbered document
    if (numberedCount < 3 && joined.length < 12) continue;
    let name = ''; let statement = joined;
    if (r.cells.length >= 2 && r.cells[0].length <= 60) { name = r.cells[0]; statement = r.cells.slice(1).join(' '); }
    else { const m = joined.match(/^([^:–—]{3,50})\s*[:–—]\s+(.{12,})$/); if (m) { name = m[1].trim(); statement = m[2].trim(); } }
    items.push({ include: true, category: category || defaultCategory, name, statement });
  }
  return items;
}

function importModal(onAdd, { title = 'Import questions' } = {}) {
  const file = h('input', { type: 'file', accept: '.docx,.csv,.txt,.tsv' });
  const paste = h('textarea', { rows: 7, placeholder: 'Or paste your questions here — one per line. Copying a table straight from Word or Excel works too.\n\nTips: a short line on its own (like "Leading People") becomes the category for the questions under it. "Name: statement" fills in the short name.' });
  const defCat = h('input', { type: 'text', value: 'Imported', style: { maxWidth: '260px' } });
  const err = errBox();
  const preview = h('div');
  let items = [];
  let footHolder;
  const drawPreview = () => {
    const included = items.filter((x) => x.include).length;
    setKids(preview, !items.length ? null : h('div', { style: { marginTop: '16px' } },
      h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('strong', null, 'Found ' + plural(items.length, 'question') + ' — check them before adding'),
        h('button', { class: 'btn small', onclick: () => { const all = items.every((x) => x.include); items.forEach((x) => { x.include = !all; }); drawPreview(); } }, 'Tick / untick all')),
      h('div', { class: 'table-wrap', style: { maxHeight: '48vh', overflowY: 'auto' } }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Category'), h('th', null, 'Short name'), h('th', null, 'Statement'))),
        h('tbody', null, items.map((x) => {
          const cb = h('input', { type: 'checkbox', checked: x.include });
          cb.addEventListener('change', () => { x.include = cb.checked; addBtn.textContent = 'Add ' + plural(items.filter((y) => y.include).length, 'question'); });
          const mk = (key, w) => { const i = h(key === 'statement' ? 'textarea' : 'input', { type: 'text', value: x[key], rows: 2, style: { marginTop: 0, minWidth: w, fontSize: '13.5px', padding: '6px 8px', minHeight: key === 'statement' ? '38px' : null } }); i.addEventListener('input', () => { x[key] = i.value; }); return i; };
          return h('tr', null, h('td', null, cb), h('td', null, mk('category', '120px')), h('td', null, mk('name', '120px')), h('td', { style: { width: '55%' } }, mk('statement', '220px')));
        }))))));
    addBtn.textContent = 'Add ' + plural(included, 'question');
    addBtn.disabled = !included;
  };
  const read = h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
    let lines = [];
    if (file.files[0]) {
      const f = file.files[0];
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('That file could not be read.')); r.readAsDataURL(f); });
      lines = (await api('POST', '/api/admin/import/extract', { filename: f.name, dataBase64: b64 })).lines;
      if (/\.csv$/i.test(f.name)) lines = lines.map((l) => splitCsvLine(l).join(' | '));
    }
    if (paste.value.trim()) lines = lines.concat(paste.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    if (!lines.length) throw new Error('Choose a file or paste some questions first.');
    items = parseQuestionLines(lines, defCat.value.trim() || 'Imported');
    if (!items.length) throw new Error('No questions were recognised. Try pasting them one per line.');
    drawPreview();
  }) }, 'Read questions');
  const addBtn = h('button', { class: 'btn brass', disabled: true }, 'Add questions');
  const m = modal({ wide: true, title, subtitle: 'Upload a Word (.docx), Excel-saved CSV, or text file — or paste. Nothing is added until you confirm.',
    body: h('div', { class: 'stack' }, h('div', { class: 'grid two' }, field('File', file, 'Older .doc files: open in Word and Save As .docx first.'), field('Category for questions without one', defCat)), paste, h('div', { class: 'row' }, read), err, preview),
    foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), addBtn] });
  addBtn.addEventListener('click', () => {
    const chosen = items.filter((x) => x.include && x.statement.trim()).map((x) => ({ category: x.category.trim() || 'Imported', name: x.name.trim(), statement: x.statement.trim() }));
    if (!chosen.length) return;
    onAdd(chosen); m.close(); toast(plural(chosen.length, 'question') + ' added. Remember to save.');
  });
}

// ------------------------------------------------------------------ results tab
async function tabResults({ a, body }) {
  setKids(body, h('p', { class: 'muted' }, 'Tallying…'));
  let r;
  try { r = (await api('GET', '/api/admin/assessments/' + a.id + '/results')).result; } catch (e) { return setKids(body, h('div', { class: 'error' }, e.message)); }
  const max = a.scale === '1-5' ? 5 : 10;
  const min = a.scale === '0-10' ? 0 : 1;
  const pct = (v) => ((v - min) / (max - min)) * 100;
  let qById = new Map(r.questions.map((q) => [q.id, q]));
  let clientView = false;
  let showGroups = true;
  const open = new Set();
  const groupKeys = () => REL_ORDER.filter((g) => g !== 'self' && r.counts.groups[g] > 0 && (!clientView || r.counts.groups[g] >= r.minGroupSize));
  const bar = (others, self) => h('div', { class: 'bar' },
    others !== null ? h('span', { class: 'fill', style: { width: pct(others) + '%' } }) : null,
    h('span', { class: 'target', style: { left: pct(r.target) + '%' } }),
    self !== null ? h('span', { class: 'self', style: { left: pct(self) + '%' } }) : null);
  const gapCell = (g) => h('td', { class: 'num ' + (g === null ? '' : g < 0 ? 'neg' : 'pos') }, fmtGap(g));
  const holder = h('div');
  const reloadResults = async () => {
    try { r = (await api('GET', '/api/admin/assessments/' + a.id + '/results')).result; } catch (e) { return toast(e.message); }
    qById = new Map(r.questions.map((q) => [q.id, q]));
    const y = window.scrollY; draw(); window.scrollTo(0, y);
  };

  if (!r.counts.submitted) {
    setKids(body, h('div', { class: 'card empty' }, h('h3', null, 'No responses yet'), h('p', null, 'Results will tally here automatically as raters submit.')));
    return;
  }

  const draw = () => {
    const gk = showGroups ? groupKeys() : [];
    const commentWho = (c) => (c.self ? 'Self' : clientView ? 'Rater' : REL[c.relationship]);
    const highlight = (title, ids, show) => h('div', { class: 'card' }, h('h3', { style: { marginBottom: '8px' } }, title),
      ids.length ? h('div', { class: 'hl' }, ids.map((qid) => { const q = qById.get(qid); return h('div', { class: 'hl-item' }, h('span', null, '#' + q.number + ' ' + (q.name || q.statement)), h('strong', null, show(q))); }))
        : h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'None.'));
    setKids(holder, 
      h('div', { class: 'report-title' }, h('div', { class: 'eyebrow' }, '360° Feedback Report'), h('h1', null, a.subjectName),
        h('p', null, [a.roleTitle, a.organization].filter(Boolean).join(' · ') + ' · ' + fmtDate(new Date().toISOString()))),
      !r.thresholdMet ? h('div', { class: 'warn', style: { marginBottom: '14px' } }, h('strong', null, 'Fewer than ' + r.minGroupSize + ' other raters have responded. '), 'You can see everything, but wait for more responses before sharing combined results with the client, so no one can be identified.') : null,
      h('div', { class: 'grid four' },
        h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Other raters'), h('div', { class: 'value' }, r.counts.others), h('small', null, REL_ORDER.filter((g) => g !== 'self' && r.counts.groups[g]).map((g) => REL[g] + ' ' + r.counts.groups[g]).join(' · '))),
        h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Others’ average'), h('div', { class: 'value' }, fmt(r.overall.othersMean), h('small', null, ' / ' + max))),
        h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Self average'), h('div', { class: 'value', style: { color: 'var(--red)' } }, r.counts.self ? fmt(r.overall.selfMean) : '—'), h('small', null, r.counts.self ? 'Self-assessment received' : 'No self-assessment yet')),
        h('div', { class: 'stat' }, h('div', { class: 'label' }, 'Target'), h('div', { class: 'value' }, r.target, h('small', null, ' / ' + max)), r.counts.excluded ? h('small', null, r.counts.excluded + ' excluded') : null)),
      h('div', { class: 'grid four', style: { marginTop: '16px' } },
        highlight('Top strengths', r.highlights.strengths, (q) => fmt(q.othersMean)),
        highlight('Development priorities', r.highlights.development, (q) => fmt(q.othersMean)),
        highlight('Blind spots (self rated higher)', r.highlights.blindSpots, (q) => fmtGap(q.selfVsOthers)),
        highlight('Hidden strengths (self rated lower)', r.highlights.hiddenStrengths, (q) => fmtGap(q.selfVsOthers))),
      h('div', { class: 'card-head', style: { marginTop: '26px' } }, h('h2', null, 'By category'), h('div', { class: 'legend' }, h('span', null, h('i', { class: 'l-fill' }), 'Others’ average'), h('span', null, h('i', { class: 'l-self' }), 'Self'), h('span', null, h('i', { class: 'l-target' }), 'Target ' + r.target))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Category'), h('th', { style: { width: '32%' } }, ''), h('th', { class: 'num' }, 'Others'), h('th', { class: 'num' }, 'Self'), h('th', { class: 'num' }, 'vs target'), gk.map((g) => h('th', { class: 'num', title: REL[g] }, SHORT[g])))),
        h('tbody', null, r.categories.map((c) => h('tr', null, h('td', null, h('strong', null, c.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, plural(c.questionIds.length, 'statement'))),
          h('td', null, bar(c.othersMean, c.selfMean)), h('td', { class: 'num' }, h('strong', null, fmt(c.othersMean))), h('td', { class: 'num', style: { color: 'var(--red)' } }, fmt(c.selfMean)), gapCell(c.gapToTarget),
          gk.map((g) => h('td', { class: 'num' }, fmt(c.groups[g] ?? null)))))))),
      h('div', { class: 'card-head', style: { marginTop: '26px' } }, h('h2', null, 'Every statement'),
        h('div', { class: 'row no-print' }, h('button', { class: 'btn small', onclick: () => { if (open.size === r.questions.length) open.clear(); else r.questions.forEach((q) => open.add(q.id)); draw(); } }, open.size === r.questions.length ? 'Collapse all comments' : 'Show all comments'))),
      h('p', { class: 'muted no-print', style: { marginTop: '-6px' } }, 'Click any row to see its comments. Comments in red are from the self-assessment.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', { style: { minWidth: '260px' } }, 'Competency'), h('th', { style: { width: '130px' } }, ''), h('th', { class: 'num' }, 'Others'), h('th', { class: 'num' }, 'Self'), h('th', { class: 'num' }, 'vs target'), h('th', { class: 'num' }, 'Range'), h('th', { class: 'num' }, 'Comments'), gk.map((g) => h('th', { class: 'num', title: REL[g] }, SHORT[g])))),
        h('tbody', null, r.questions.flatMap((q) => {
          const isOpen = open.has(q.id);
          const row = h('tr', { class: 'r-row' + (isOpen ? ' openrow' : ''), onclick: () => { isOpen ? open.delete(q.id) : open.add(q.id); draw(); } },
            h('td', { class: 'muted' }, q.number),
            h('td', { style: { minWidth: '260px' } }, h('strong', null, q.name || q.statement.slice(0, 60)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, q.name ? q.statement : '')),
            h('td', null, bar(q.othersMean, q.selfMean)),
            h('td', { class: 'num' }, h('strong', null, fmt(q.othersMean)), q.notObserved ? h('div', { class: 'muted', style: { fontSize: '11px' } }, q.notObserved + ' N/O') : null),
            h('td', { class: 'num', style: { color: 'var(--red)' } }, fmt(q.selfMean)), gapCell(q.gapToTarget),
            h('td', { class: 'num' }, q.low === null ? '—' : q.low + '–' + q.high),
            h('td', { class: 'num' }, q.comments.length || '—'),
            gk.map((g) => h('td', { class: 'num' }, q.groups[g] ? fmt(q.groups[g].mean) : '—')));
          if (!isOpen) return [row];
          const list = (kind) => { const cs = q.comments.filter((c) => c.kind === kind).sort((x, y) => Number(y.self) - Number(x.self) || (y.rating ?? -1) - (x.rating ?? -1)); return cs.length ? cs.map((c) => commentCard(c, clientView, commentWho(c), reloadResults)) : h('p', { class: 'muted', style: { fontSize: '13px' } }, 'No comments.'); };
          const hasSplit = q.comments.some((c) => c.kind !== 'comment');
          const hasOne = q.comments.some((c) => c.kind === 'comment') || !hasSplit;
          return [row, h('tr', { class: 'comments-panel' }, h('td', { colspan: String(8 + gk.length) },
            hasOne ? h('div', { class: 'c-one' }, h('h4', null, 'What raters observed (' + q.comments.filter((c) => c.kind === 'comment').length + ')'), list('comment')) : null,
            hasSplit ? h('div', { class: 'c-cols' }, h('div', null, h('h4', null, 'Strengths'), list('strength')), h('div', null, h('h4', null, 'Development needs'), list('development'))) : null))];
        })))));
  };

  const cv = h('input', { type: 'checkbox' });
  cv.addEventListener('change', () => { clientView = cv.checked; draw(); });
  const sg = h('input', { type: 'checkbox', checked: true });
  sg.addEventListener('change', () => { showGroups = sg.checked; draw(); });
  draw();
  setKids(body, 
    h('div', { class: 'card no-print', style: { marginBottom: '16px', padding: '14px 18px' } }, h('div', { class: 'row between' },
      h('div', { class: 'row', style: { gap: '20px' } },
        h('label', { class: 'check', title: 'Hides rater-group columns that have fewer than the minimum number of raters, and labels comments only as Self or Rater.' }, cv, 'Client-ready view (protects rater anonymity)'),
        h('label', { class: 'check' }, sg, 'Show rater-group columns')),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '/api/admin/assessments/' + a.id + '/export.csv' }, 'Download for Excel'),
        h('button', { class: 'btn primary', onclick: () => { r.questions.forEach((q) => open.add(q.id)); draw(); setTimeout(() => window.print(), 100); } }, 'Print / save as PDF')))),
    holder);
}

// One comment in the results, with review flags and "Edit for report".
function commentCard(c, clientView, whoLabel, reload) {
  const flags = [];
  if (!clientView && c.flags && c.flags.includes('identity')) flags.push(h('span', { class: 'flag warn-flag', title: 'The anonymity check flagged a detail and the rater confirmed it does not identify them. Please read it before sharing.' }, 'Check anonymity'));
  if (!clientView && c.flags && c.flags.includes('mismatch')) flags.push(h('span', { class: 'flag', title: 'The comment read differently from the score; the rater confirmed both are right.' }, 'Rater confirmed score'));
  if (!clientView && c.edited) flags.push(h('span', { class: 'flag edited-flag' }, 'Edited for report'));
  const edit = () => {
    const ta = h('textarea', { rows: 6, value: c.text });
    const err = errBox();
    const save = (body, msg) => async (e) => busy(e.target, err, async () => {
      await api('PUT', '/api/admin/invitations/' + c.invitationId + '/report-edit', { questionId: c.questionId, kind: c.kind, ...body });
      m.close(); toast(msg); reload();
    });
    const m = modal({ wide: true, title: 'Edit this comment for the report',
      subtitle: 'Remove anything that could identify the rater. Scores are unchanged. The rater’s original wording is kept for your records only.',
      body: h('div', { class: 'stack' }, ta,
        c.edited ? h('div', { class: 'notice' }, h('strong', null, 'Original: '), c.original) : null, err),
      foot: (close) => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        c.edited ? h('button', { class: 'btn', onclick: save({ revert: true }, 'Original wording restored.') }, 'Restore original') : null,
        h('button', { class: 'btn danger', onclick: save({ text: '' }, 'Comment left out of the report.') }, 'Leave out of report'),
        h('button', { class: 'btn primary', onclick: (e) => { if (!ta.value.trim()) { err.textContent = 'Type the comment, or choose "Leave out of report".'; err.hidden = false; return; } return save({ text: ta.value }, 'Saved for the report.')(e); } }, 'Save for report'),
      ] });
  };
  return h('div', { class: 'comment' + (c.self ? ' self' : '') },
    h('span', { class: 'who' }, whoLabel, typeof c.rating === 'number' ? h('span', { class: 'c-rating' }, 'rated ' + c.rating) : null),
    flags.length ? h('div', { class: 'flags' }, flags) : null,
    c.text,
    clientView ? null : h('div', { class: 'c-tools no-print' }, h('button', { class: 'linkish', onclick: edit }, 'Edit for report')));
}

// ------------------------------------------------------------------ settings tab
function tabSettings({ a, inv, body, reload }) {
  const t = (v, ph) => h('input', { type: 'text', value: v || '', placeholder: ph || '' });
  const f = { subjectName: t(a.subjectName), roleTitle: t(a.roleTitle), organization: t(a.organization), cohort: t(a.cohort), dueDate: h('input', { type: 'date', value: a.dueDate || '' }) };
  const max = a.scale === '1-5' ? 5 : 10;
  const started = inv.some((i) => i.status !== 'not_started' && i.status !== 'joined');
  const target = h('input', { type: 'number', min: '0', max: String(max), step: '0.5', value: String(a.targetScore) });
  const minGroup = h('select', null, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === (a.minGroupSize || 3) }, n + (n === 3 ? ' (recommended)' : ''))));
  const instructions = h('textarea', { rows: 5, value: a.instructions });
  const comments = h('input', { type: 'checkbox', checked: a.commentsRequired !== false });
  const na = h('input', { type: 'checkbox', checked: Boolean(a.allowNotObserved) });
  const minWords = h('select', null, [5, 8, 10, 15, 20, 25, 30].map((n) => h('option', { value: n, selected: n === (a.minCommentWords || 10) }, n + ' words' + (n === 10 ? ' (recommended)' : ''))));
  const ext = a.minCommentWordsExtreme || 20;
  const minWordsExt = h('select', null, [10, 15, 20, 25, 30, 40, 50].map((n) => h('option', { value: n, selected: n === ext }, n + ' words' + (n === 20 ? ' (recommended)' : ''))));
  const mode = h('select', { disabled: started }, h('option', { value: 'single', selected: a.commentMode !== 'split' }, 'One box: what the rater has observed'), h('option', { value: 'split', selected: a.commentMode === 'split' }, 'Two boxes: Strength and Development need'));
  const err = errBox();
  const save = h('button', { class: 'btn primary', onclick: () => busy(save, err, async () => {
    await api('PATCH', '/api/admin/assessments/' + a.id, { subjectName: f.subjectName.value, roleTitle: f.roleTitle.value, organization: f.organization.value, cohort: f.cohort.value, dueDate: f.dueDate.value,
      targetScore: Number(target.value), minGroupSize: Number(minGroup.value), instructions: instructions.value, commentsRequired: comments.checked, allowNotObserved: na.checked, minCommentWords: Number(minWords.value), minCommentWordsExtreme: Number(minWordsExt.value), commentMode: mode.value });
    toast('Settings saved.'); reload();
  }) }, 'Save settings');
  const toggle = h('button', { class: 'btn ' + (a.status === 'open' ? 'danger' : 'primary'), onclick: (e) => busy(e.target, null, async () => {
    const next = a.status === 'open' ? 'closed' : 'open';
    if (next === 'closed' && !(await confirmBox('Close this assessment?', 'Raters will no longer be able to answer or submit. Their saved drafts are kept, and you can reopen at any time.', 'Close it'))) return;
    await api('PATCH', '/api/admin/assessments/' + a.id, { status: next }); toast(next === 'open' ? 'Reopened.' : 'Closed.'); reload();
  }) }, a.status === 'open' ? 'Close the assessment' : 'Reopen the assessment');
  const del = h('button', { class: 'btn danger', onclick: () => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const e2 = errBox();
    modal({ title: 'Delete ' + a.subjectName + '?', body: h('div', { class: 'stack' }, h('p', null, 'This permanently deletes the assessment, ' + plural(inv.length, 'rater invitation') + ', and every answer. Download a backup or the Excel results first if you may need them.'), field('Your administrator password', pw), e2),
      foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn danger solid', onclick: (e) => busy(e.target, e2, async () => {
        await api('DELETE', '/api/admin/assessments/' + a.id, { password: pw.value }); close(); toast('Deleted.'); go('/admin', true);
      }) }, 'Delete permanently')] });
  } }, 'Delete assessment…');
  setKids(body, 
    h('div', { class: 'card' }, h('h2', { style: { marginBottom: '14px' } }, 'Details'),
      h('div', { class: 'form-grid' }, field('Name', f.subjectName), field('Role / title', f.roleTitle), field('Organization', f.organization), field('Cohort or group', f.cohort), field('Due date', f.dueDate),
        field('Target score (out of ' + max + ')', target, 'Used for the "vs target" column.'))),
    h('div', { class: 'card' }, h('h2', { style: { marginBottom: '14px' } }, 'What raters see'),
      h('div', { class: 'stack' }, field('Instructions shown at the start', instructions),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Rating scale: ' + ({ '1-5': '1–5', '0-10': '0–10' }[a.scale] || '1–10') + ' (set when the assessment was created). Raters see your guidelines first and must meet them to submit.'),
        h('label', { class: 'check' }, comments, h('span', null, h('strong', null, 'Require a comment on every statement. '), h('span', { class: 'muted' }, 'Raters cannot move on until each statement has a comment that meets the minimum length. Placeholders like "N/A" or "OK" and copy-and-pasted comments are not accepted.'))),
        h('div', { class: 'grid three' }, field('Minimum comment length', minWords, 'For each statement.'), field('For very low scores or a perfect score', minWordsExt, 'Scores at the ends of the scale need a fuller explanation.'), field('Comment style', mode, started ? 'Locked because raters have started.' : null)),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13.5px' } }, 'Every comment is also checked to be specific and in the rater’s own words (not a repeat of the statement or of another comment), to agree with the score, and not to reveal who the rater is.'),
        h('label', { class: 'check' }, na, h('span', null, h('strong', null, 'Offer a "Not observed" choice. '), h('span', { class: 'muted' }, 'Off: every statement must be rated. Turn on if some raters (for example, board members) cannot observe every behavior; these are left out of averages.'))))),
    h('div', { class: 'card' }, h('h2', { style: { marginBottom: '14px' } }, 'Confidentiality'),
      field('Minimum raters before a group is shown in the client-ready view', minGroup, 'Groups with fewer raters are hidden in the client-ready view, so individuals cannot be identified. You always see everything.')),
    h('div', { class: 'card' }, err, h('div', { class: 'row end' }, save)),
    h('div', { class: 'card' }, h('h2', { style: { marginBottom: '8px' } }, 'Collection'), h('p', { class: 'muted' }, a.status === 'open' ? 'Raters can currently answer.' : 'Closed — raters cannot answer.'),
      h('div', { class: 'row between' }, toggle, del)));
}

// ------------------------------------------------------------------ question library
async function viewLibrary(id) {
  loading(id, 'library');
  let data;
  try { data = await api('GET', '/api/admin/overview'); } catch (e) { return mount(id, topbar('library'), page('', h('div', { class: 'error' }, e.message))); }
  const lib = JSON.parse(JSON.stringify(data.library));
  let dirty = false;
  const status = h('span', { class: 'muted' }, 'All changes saved');
  const saveBtn = h('button', { class: 'btn primary', disabled: true }, 'Save library');
  const mark = () => { dirty = true; saveBtn.disabled = false; status.textContent = 'Unsaved changes'; status.className = 'neg'; drawSets(); };
  window.onbeforeunload = () => (dirty ? 'You have unsaved changes.' : undefined);
  const ed = questionEditor(lib.competencies, { onChange: mark, showCore: true });
  const err = errBox();
  saveBtn.addEventListener('click', () => busy(saveBtn, err, async () => {
    for (const c of lib.competencies) if (!c.id) c.id = 'c' + Math.random().toString(36).slice(2, 10);
    const ids = new Set(lib.competencies.map((c) => c.id));
    lib.templates.forEach((t) => { t.competencyIds = t.competencyIds.filter((x) => ids.has(x)); });
    await api('PUT', '/api/admin/library', lib);
    dirty = false; window.onbeforeunload = null; toast('Library saved.'); render();
  }));
  const setsEl = h('div', { class: 'grid three' });
  function drawSets() {
    setKids(setsEl, ...lib.templates.map((t) => h('div', { class: 'card', style: { margin: 0 } },
      h('h3', null, t.name), h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '4px 0 12px' } }, plural(t.competencyIds.filter((x) => lib.competencies.some((c) => c.id === x)).length, 'statement') + (t.description ? ' · ' + t.description : '')),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => editSetModal(t) }, 'Edit'),
        h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox('Delete "' + t.name + '"?', 'The statements stay in your library; only this starting set is removed.', 'Delete', true)) { lib.templates.splice(lib.templates.indexOf(t), 1); mark(); } } }, 'Delete')))),
    h('button', { class: 'tpl', style: { display: 'grid', placeItems: 'center', minHeight: '120px' }, onclick: () => { const t = { id: 'set-' + Math.random().toString(36).slice(2, 8), name: 'New starting set', description: '', competencyIds: lib.competencies.filter((c) => c.core).map((c) => c.id) }; lib.templates.push(t); editSetModal(t); } },
      h('strong', null, '+ New starting set'), h('span', null, 'e.g. CFO, Board-level, Sales leader')));
  }
  function editSetModal(t) {
    for (const c of lib.competencies) if (!c.id) c.id = 'c' + Math.random().toString(36).slice(2, 10);
    const name = h('input', { type: 'text', value: t.name });
    const desc = h('input', { type: 'text', value: t.description, placeholder: 'When to use this set' });
    const chosen = new Set(t.competencyIds);
    const cats = [...new Set(lib.competencies.map((c) => c.category))];
    modal({ wide: true, title: 'Edit starting set', subtitle: 'Choose which library statements this set starts with. You can still adjust each assessment afterwards.',
      body: h('div', { class: 'stack' }, h('div', { class: 'grid two' }, field('Name', name), field('Description', desc)),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { lib.competencies.filter((c) => c.core).forEach((c) => chosen.add(c.id)); refresh(); } }, 'Tick all Core statements')),
        h('div', { id: 'set-picks' })),
      foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => {
        t.name = name.value.trim() || 'Untitled set'; t.description = desc.value.trim();
        t.competencyIds = lib.competencies.filter((c) => chosen.has(c.id)).map((c) => c.id); close(); mark();
      } }, 'Done')] });
    function refresh() {
      setKids(document.getElementById('set-picks'), ...cats.map((cat) => h('div', { class: 'pick-group' }, h('header', null, h('strong', null, cat)),
        lib.competencies.filter((c) => c.category === cat).map((c) => {
          const cb = h('input', { type: 'checkbox', checked: chosen.has(c.id) });
          cb.addEventListener('change', () => (cb.checked ? chosen.add(c.id) : chosen.delete(c.id)));
          return h('label', { class: 'pick-item' }, cb, h('span', null, c.name ? h('b', null, c.name + '. ') : null, c.statement, c.core ? [' ', h('span', { class: 'chip core' }, 'Core')] : null));
        }))));
    }
    refresh();
  }
  drawSets();
  mount(id, topbar('library'), page('',
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Reusable content'), h('h1', null, 'Question Library'),
      h('p', null, 'Your master statements and the starting sets used when you create an assessment. Editing here never changes assessments already created.')),
    h('div', { class: 'row' }, status, saveBtn)),
    h('h2', { style: { margin: '6px 0 12px' } }, 'Starting sets'), setsEl,
    h('div', { class: 'card', style: { marginTop: '22px' } },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'All statements (' + lib.competencies.length + ' of up to 500)'), h('p', { class: 'muted', style: { margin: '4px 0 0' } }, 'Tick "Core" for statements that apply to every role.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { lib.competencies.push({ id: 'c' + Math.random().toString(36).slice(2, 10), category: lib.competencies.length ? lib.competencies[lib.competencies.length - 1].category : 'General', name: '', statement: '', core: false }); ed.redraw(); mark(); } }, '+ Add a statement'),
          h('button', { class: 'btn small', onclick: () => importModal((items) => {
            const added = items.map((x) => ({ ...x, id: 'c' + Math.random().toString(36).slice(2, 10), core: false }));
            lib.competencies.push(...added); ed.redraw();
            if (confirm('Also create a new starting set from these ' + added.length + ' statements?')) lib.templates.push({ id: 'set-' + Math.random().toString(36).slice(2, 8), name: 'Imported set', description: 'Created from an import', competencyIds: added.map((x) => x.id) });
            mark();
          }, { title: 'Import statements into the library' }) }, 'Import from Word, Excel, or text'))),
      err, ed.el)));
}

// ------------------------------------------------------------------ people
async function viewPeople(id) {
  loading(id, 'people');
  let data;
  try { data = await api('GET', '/api/admin/people'); } catch (e) { return mount(id, topbar('people'), page('', h('div', { class: 'error' }, e.message))); }
  const reset = async (p) => {
    if (!(await confirmBox('Reset password for ' + p.displayName + '?', 'They will get a temporary password and must choose a new one when they next sign in.', 'Reset password'))) return;
    const r = await api('POST', '/api/admin/people/' + p.id + '/reset');
    modal({ title: 'Temporary password', body: h('div', { class: 'stack' }, h('p', null, 'Give these details to ', h('strong', null, p.displayName), ' (by phone or a separate message is safest):'),
      h('div', { class: 'keybox', style: { fontSize: '17px', textAlign: 'left' } }, 'Username: ' + r.username, h('br'), 'Temporary password: ' + r.temporaryPassword),
      h('button', { class: 'btn', onclick: () => copyText('Username: ' + r.username + '\nTemporary password: ' + r.temporaryPassword) }, 'Copy')),
    foot: (close) => h('button', { class: 'btn primary', onclick: close }, 'Done') });
  };
  mount(id, topbar('people'), page('',
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Logins'), h('h1', null, 'People'), h('p', null, 'Everyone who has created a rater login. Logins can only be created from an invitation link.'))),
    data.people.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Name', 'Username', 'Questionnaires', 'Joined', 'Status', ''].map((t) => h('th', null, t)))),
      h('tbody', null, data.people.map((p) => h('tr', null,
        h('td', null, h('strong', null, p.displayName), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, p.email)),
        h('td', null, p.username),
        h('td', null, p.questionnaires.map((q) => h('div', { style: { fontSize: '13px' } }, q.subjectName + ' · ' + REL[q.relationship] + (q.submitted ? ' ✓' : '')))),
        h('td', null, h('small', null, fmtDate(p.createdAt))),
        h('td', null, h('span', { class: 'chip ' + (p.disabled ? 'closed' : 'open') }, p.disabled ? 'Turned off' : 'Active')),
        h('td', { class: 'num' }, h('div', { class: 'row end', style: { flexWrap: 'nowrap' } },
          h('button', { class: 'btn small', onclick: () => reset(p).catch((e) => toast(e.message)) }, 'Reset password'),
          h('button', { class: 'btn small', onclick: async () => { await api('PATCH', '/api/admin/people/' + p.id, { disabled: !p.disabled }).catch((e) => toast(e.message)); render(); } }, p.disabled ? 'Turn on' : 'Turn off'))))))))
      : h('div', { class: 'card empty' }, h('h3', null, 'No rater logins yet'), h('p', null, 'They appear here once raters open their invitation links.'))));
}

// ------------------------------------------------------------------ settings & backup
function viewSettings(id) {
  const me = state.session.user;
  const adminsCard = h('div', { class: 'card stack' }, h('h2', null, 'Administrators'), h('p', { class: 'muted' }, 'Loading…'));
  const drawAdmins = async () => {
    let d;
    try { d = await api('GET', '/api/admin/admins'); } catch (e) { return setKids(adminsCard, h('div', { class: 'error' }, e.message)); }
    const askPw = (title, message, okLabel, run) => {
      const pw = h('input', { type: 'password', autocomplete: 'current-password' });
      const err = errBox();
      modal({ title, body: h('div', { class: 'stack' }, h('p', null, message), field('Your administrator password', pw), err),
        foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => { await run(pw.value); close(); }) }, okLabel)] });
    };
    const showTemp = (who, r) => modal({ title: 'Login details for ' + who,
      body: h('div', { class: 'stack' }, h('p', null, 'Give these to ', h('strong', null, who), ' in person or by phone. They will choose their own password when they first sign in.'),
        h('div', { class: 'keybox', style: { fontSize: '17px', textAlign: 'left' } }, 'Web address: ' + location.origin, h('br'), 'Username: ' + r.username, h('br'), 'Temporary password: ' + r.temporaryPassword),
        h('button', { class: 'btn', onclick: () => copyText('Web address: ' + location.origin + '\nUsername: ' + r.username + '\nTemporary password: ' + r.temporaryPassword) }, 'Copy')),
      foot: (close) => h('button', { class: 'btn primary', onclick: close }, 'Done') });
    const addForm = () => {
      const name = h('input', { type: 'text', placeholder: 'Full name' });
      const user = h('input', { type: 'text', placeholder: 'e.g. their first name or email', autocapitalize: 'none', spellcheck: 'false' });
      const pw = h('input', { type: 'password', autocomplete: 'current-password' });
      const err = errBox();
      modal({ title: 'Add an administrator', subtitle: 'Administrators can create and edit assessments and questions, and see all results. Only you can add or remove administrators and restore backups.',
        body: h('div', { class: 'stack' }, field('Their name', name), field('Their username', user), field('Your own administrator password', pw, 'To confirm it’s you.'), err),
        foot: (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: (e) => busy(e.target, err, async () => {
          const r = await api('POST', '/api/admin/admins', { displayName: name.value, username: user.value, password: pw.value });
          close(); drawAdmins(); showTemp(name.value.trim(), r);
        }) }, 'Add administrator')] });
    };
    setKids(adminsCard,
      h('div', { class: 'card-head', style: { margin: 0 } }, h('h2', null, 'Administrators'), me.owner ? h('button', { class: 'btn small primary', onclick: addForm }, '+ Add administrator') : null),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Only these people can edit questionnaires, assessments, and results. Raters can only answer their own questionnaire.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', null, d.admins.map((x) => h('tr', null,
        h('td', null, h('strong', null, x.displayName), x.id === d.me ? h('span', { class: 'muted' }, ' (you)') : null),
        h('td', null, x.username),
        h('td', null, h('span', { class: 'chip ' + (x.owner ? 'core' : 'open') }, x.owner ? 'Owner' : 'Administrator'), x.mustChangePassword ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, ' · hasn’t signed in yet') : null),
        h('td', { class: 'num' }, me.owner && !x.owner ? h('div', { class: 'row end', style: { flexWrap: 'nowrap' } },
          h('button', { class: 'btn small', onclick: () => askPw('Reset password for ' + x.displayName + '?', 'They will get a temporary password and choose a new one when they sign in.', 'Reset password', async (pw) => { const r = await api('POST', '/api/admin/admins/' + x.id + '/reset', { password: pw }); showTemp(x.displayName, r); drawAdmins(); }) }, 'Reset password'),
          h('button', { class: 'btn small danger', onclick: () => askPw('Remove ' + x.displayName + ' as an administrator?', 'They will be signed out and can no longer sign in. Assessments and results are not affected.', 'Remove', async (pw) => { await api('DELETE', '/api/admin/admins/' + x.id, { password: pw }); toast('Administrator removed.'); drawAdmins(); }) }, 'Remove')) : null)))))));
  };
  drawAdmins();
  const bpw = h('input', { type: 'password', autocomplete: 'current-password' });
  const berr = errBox();
  const backup = h('button', { class: 'btn primary', onclick: () => busy(backup, berr, async () => {
    const res = await fetch('/api/admin/backup', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: bpw.value }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Backup failed.'); }
    const blob = await res.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: 'Previan-backup-' + new Date().toISOString().slice(0, 10) + '.previanbackup' });
    document.body.appendChild(a); a.click(); a.remove();
    bpw.value = ''; toast('Backup downloaded. Keep it somewhere safe, such as OneDrive or a USB drive.');
  }) }, 'Download backup');
  const rfile = h('input', { type: 'file', accept: '.previanbackup,.json' });
  const rpw = h('input', { type: 'password', autocomplete: 'off' });
  const rok = h('input', { type: 'checkbox' });
  const rerr = errBox();
  const restore = h('button', { class: 'btn danger', onclick: () => busy(restore, rerr, async () => {
    if (!rfile.files[0]) throw new Error('Choose a backup file.');
    if (!rok.checked) throw new Error('Tick the box to confirm you want to replace everything.');
    let backupFile;
    try { backupFile = JSON.parse(await rfile.files[0].text()); } catch { throw new Error('That is not a Previan backup file.'); }
    const r = await api('POST', '/api/admin/restore', { backup: backupFile, password: rpw.value });
    alert('Restored. A safety copy of what was here before was saved as ' + r.safetyCopy + '.\n\nPlease sign in again with the administrator login from the backup (username: ' + r.adminUsername + ').');
    state.session = null; go('/', true);
  }) }, 'Restore from backup');
  mount(id, topbar('settings'), page('narrow',
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Your workspace'), h('h1', null, 'Settings & Backup'))),
    h('div', { class: 'card stack' }, h('h2', null, 'Your login'), h('p', null, 'Username: ', h('strong', null, state.session.user.username)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: changePasswordModal }, 'Change my password')),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Forgot your password? Use "Forgot your password?" on the sign-in page with the recovery key you saved during setup.')),
    h('div', { class: 'card stack' }, h('h2', null, 'Download a backup'),
      h('p', null, 'A single encrypted file with everything: assessments, questions, raters, logins, and every answer. The app also keeps 30 days of automatic daily copies, but a downloaded backup stored elsewhere protects you if the computer or server is lost.'),
      field('Your administrator password', bpw, 'The backup is locked with this password. You will need the same password to restore it.'), berr, h('div', { class: 'row' }, backup)),
    adminsCard,
    !me.owner ? h('div', { class: 'card' }, h('h2', { style: { marginBottom: '8px' } }, 'Restore a backup'), h('p', { class: 'muted', style: { margin: 0 } }, 'Only the owner can restore a backup.')) : h('div', { class: 'card stack' }, h('h2', null, 'Restore a backup'),
      h('div', { class: 'warn' }, 'Restoring replaces everything currently in the app with the backup. (A safety copy of the current data is saved first.) Use this to move to a new computer or to the online version.'),
      field('Backup file', rfile), field('Password used when the backup was made', rpw),
      h('label', { class: 'check' }, rok, 'I understand this replaces everything currently in the app.'), rerr, h('div', { class: 'row' }, restore)),
    h('div', { class: 'card' }, h('h2', { style: { marginBottom: '8px' } }, 'About'), h('p', { class: 'muted', style: { margin: 0 } }, 'Previan Assessment App ' + state.session.version + (isLocal() ? ' · running on this computer (trial mode)' : ' · online')))));
}

render();
