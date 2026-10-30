/* ============================================================
   Event Action Plan Tool — app logic
   ============================================================ */
(function (NVC) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  // Risk rating colours (fill + text), shared by the on-screen table and the Word table.
  // Hex without '#' so the docx library can use them directly.
  const RATING_COLORS = {
    Low:     { fill: '4FA46A', text: 'FFFFFF' },
    Medium:  { fill: 'E6A817', text: '1F2733' },
    High:    { fill: 'E4632A', text: 'FFFFFF' },
    Extreme: { fill: 'B0281C', text: 'FFFFFF' },
  };
  const ratingColor = (r) => RATING_COLORS[r] || { fill: 'DFE4EA', text: '1F2733' };

  // A4 + unit helpers for the Word document
  const MM_TO_TWIP = 1440 / 25.4;
  const mm = (v) => Math.round(v * MM_TO_TWIP);
  const A4 = { w: 11906, h: 16838 };                 // A4 portrait, twips
  const A4_PX = { w: Math.round(210 / 25.4 * 96), h: Math.round(297 / 25.4 * 96) }; // full-page image px @96dpi
  // Page margins (mm) — tuned to sit inside the letterhead's clear white zone
  const MARGIN = { top: 52, right: 20, bottom: 44, left: 20 };
  // Plain pages (no letterhead) — used for notifications, which come from the organiser, not Council
  const MARGIN_PLAIN = { top: 25, right: 20, bottom: 25, left: 20 };
  // The Word document starts its text lower than the preview, so full-width panels sit clear of the letterhead artwork
  const MARGIN_WORD = { top: 66, right: 20, bottom: 44, left: 20 };

  function base64ToUint8(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /* ---------------- State ---------------- */
  const answers = {};
  let currentCat = null;
  // Demo links: add ?demo=level1 or ?demo=level4 to the address to open a ready-made example
  // (it resets each time the page loads), or ?demo=blank for a separate empty workspace that
  // keeps what is typed into it. Without ?demo the planner uses the visitor's own saved answers.
  const DEMO = new URLSearchParams(window.location.search).get('demo');
  const STORAGE_KEY = 'nvc-event-plan-answers' + (DEMO ? ':' + DEMO : '');

  function saveAnswers() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); } catch (e) { /* private mode / disabled */ }
  }
  function loadAnswers() {
    if (DEMO && NVC.DEMOS && NVC.DEMOS[DEMO]) { Object.assign(answers, NVC.DEMOS[DEMO]); return; }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(answers, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }

  /* ---------------- Views ---------------- */
  function showView(id) {
    $$('.view').forEach(v => v.classList.add('hidden'));
    $('#view-' + id).classList.remove('hidden');
    // Header button: Refresh on the dashboard only, Download while previewing a document
    $('#btn-restart').classList.toggle('hidden', id !== 'dashboard');
    $('#btn-download').classList.toggle('hidden', id !== 'plan');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard() {
    $('#live-strip').hidden = true; // the double-width tile is the indicator here
    const grid = $('#tile-grid');
    grid.innerHTML = '';

    NVC.CATEGORIES.forEach(cat => {
      const status = NVC.categoryStatus(cat.id, answers);
      const tile = el('button', 'tile');
      tile.type = 'button';
      if (cat.accent) tile.style.borderColor = cat.accent;
      tile.addEventListener('click', () => openCategory(cat.id));

      tile.appendChild(el('p', 'tile-title', cat.title));
      tile.appendChild(el('p', 'tile-sub', cat.sub));

      const st = el('div', 'tile-status ' + status);
      st.appendChild(el('span', 'dot'));
      st.appendChild(el('span', null, status === 'done' ? 'Complete' : status === 'partial' ? 'In progress' : 'Not started'));
      tile.appendChild(st);
      grid.appendChild(tile);
    });

    // Live Level tile (double width) — fills the 2-tile "Live Levels" slot
    grid.appendChild(renderLiveTile());
    updateGenerateButton();
  }

  /* ---------------- Documentation tracker pane (right-hand side) ---------------- */
  function docSubmittedMap() {
    if (!answers._docs_submitted || typeof answers._docs_submitted !== 'object') answers._docs_submitted = {};
    return answers._docs_submitted;
  }
  function docBadgeText(it) {
    if (it.daysUntil === null) return '—';
    if (it.daysUntil < 0) return 'overdue';
    if (it.daysUntil === 0) return 'today';
    return it.daysUntil + ' d';   // exact overdue count is on hover (docBadgeTitle)
  }
  function docBadgeTitle(it) {
    if (it.daysUntil === null) return 'Set an event date to see the due date';
    if (it.daysUntil < 0) return Math.abs(it.daysUntil) + ' business days overdue';
    if (it.daysUntil === 0) return 'Due today';
    return 'Due in ' + it.daysUntil + ' business days';
  }
  function renderDocPane() {
    const pane = $('#doc-pane');
    if (!pane) return;
    const d = NVC.deriveContextFull(answers);
    const t = NVC.docTracker(answers, d, new Date());
    pane.innerHTML = '';
    const card = el('div', 'doc-card');
    card.appendChild(el('h3', 'doc-title', 'Documents'));

    if (!t.applicable) {
      card.appendChild(el('p', 'doc-sub', t.level
        ? 'No Council documents required at Level 1.'
        : 'Documents Council needs will appear here once you answer a few questions.'));
      pane.appendChild(card);
      return;
    }

    const sub = docSubmittedMap();
    const total = t.items.length;
    const done = t.items.filter(it => sub[it.id]).length;
    const pct = total ? Math.round(done / total * 100) : 0;

    const prog = el('div', 'doc-progress');
    const ph = el('div', 'doc-progress-head');
    ph.appendChild(el('span', null, 'Done'));
    ph.appendChild(el('span', 'doc-pct', pct + '%'));
    prog.appendChild(ph);
    const bar = el('div', 'doc-bar'); const fill = el('div', 'doc-bar-fill'); fill.style.width = pct + '%';
    bar.appendChild(fill); prog.appendChild(bar);
    card.appendChild(prog);

    if (!t.valid) card.appendChild(el('p', 'doc-hint', 'Set an event date in Event Details to see due dates.'));

    const list = el('ul', 'doc-list');
    t.items.forEach(it => {
      const submitted = !!sub[it.id];
      const li = el('li', 'doc-item ' + (submitted ? 'submitted' : 'status-' + it.status));
      const cb = el('input'); cb.type = 'checkbox'; cb.className = 'doc-check'; cb.checked = submitted;
      cb.setAttribute('aria-label', 'Submitted: ' + it.text);
      cb.addEventListener('change', () => { sub[it.id] = cb.checked; saveAnswers(); renderDocPane(); });
      li.appendChild(cb);
      const main = el('div', 'doc-item-main');
      const label = el('span', 'doc-text', it.short || it.text);
      label.title = it.text;                      // full description on hover
      main.appendChild(label);
      const badge = el('span', 'doc-badge ' + (submitted ? 'is-done' : 'status-' + it.status));
      badge.textContent = submitted ? '✓' : docBadgeText(it);
      badge.title = submitted ? 'Submitted' : docBadgeTitle(it);
      main.appendChild(badge);
      li.appendChild(main);
      list.appendChild(li);
    });
    card.appendChild(list);
    card.appendChild(el('div', 'doc-foot', done + ' / ' + total));
    pane.appendChild(card);
  }

  function renderLiveTile() {
    const { level, topDrivers, totalLevel } = NVC.computeLevel(answers);
    const meta = NVC.LEVEL_META[level] || NVC.LEVEL_META[0];
    const tile = el('div', 'tile tile-live');
    tile.id = 'live-tile';

    const head = el('div', 'live-head');
    head.appendChild(el('span', 'live-label', 'Live Approval Level'));
    if (meta.timeframe) head.appendChild(el('span', 'live-timeframe', (level === 1 ? '' : 'Est. ') + meta.timeframe));
    tile.appendChild(head);

    const row = el('div', 'live-level-row');
    const numEl = el('div', 'live-level-num', level ? String(level) : '–');
    numEl.style.color = meta.color;
    row.appendChild(numEl);
    const rightBox = el('div');
    if (level) {
      const badge = el('span', 'live-badge', meta.name);
      badge.style.background = meta.color;
      rightBox.appendChild(badge);
    }
    // Before any answers the tile shows the prompt; once a level shows, the badge and reasons speak for themselves
    if (!level) rightBox.appendChild(el('p', 'live-desc', meta.desc));
    if (totalLevel) rightBox.appendChild(el('p', 'live-desc', totalLevelNote(totalLevel)));
    row.appendChild(rightBox);
    tile.appendChild(row);

    if (level && topDrivers.length) {
      const ul = el('ul', 'live-drivers');
      topDrivers.forEach(d => ul.appendChild(el('li', null, d.reason)));
      tile.appendChild(ul);
    }
    return tile;
  }

  // Update just the live tile in place (with a pulse) so it feels "live"
  function refreshLiveTile() {
    const old = $('#live-tile');
    if (!old) return renderDashboard();
    const fresh = renderLiveTile();
    fresh.classList.add('pulse');
    old.replaceWith(fresh);
  }

  function updateGenerateButton() {
    // Require the Event Details tile complete (name, attendance, date, times, location)
    const ready = NVC.categoryStatus('event_details', answers) === 'done';
    const btn = $('#btn-generate');
    btn.disabled = !ready;
    const hint = $('#generate-hint');
    if (hint) hint.textContent = ready
      ? 'Your plan is ready. You can keep refining answers or generate now.'
      : 'Complete the required Event Details to generate your plan.';
  }

  /* ---------------- Question flow ---------------- */
  function openCategory(catId) {
    currentCat = catId;
    const cat = NVC.CATEGORIES.find(c => c.id === catId);
    $('#q-category-label').textContent = cat.title;
    renderQuestions();
    showView('questions');
  }

  function renderQuestions() {
    const form = $('#q-form');
    form.innerHTML = '';
    const fields = NVC.visibleFields(currentCat, answers);
    fields.forEach(f => form.appendChild(renderField(f)));
    refreshHints();
  }

  function renderField(f) {
    const wrap = el('div', 'q-field' + (f.showIf ? ' q-conditional' : ''));
    const label = el('label', 'q-label', f.label + (f.required ? ' *' : ''));
    label.setAttribute('for', 'f_' + f.id);
    wrap.appendChild(label);
    if (f.help) wrap.appendChild(el('p', 'q-help', f.help));
    // Optional live hint that reacts to the answers so far (see refreshHints)
    let hintEl = null;
    if (f.hint) { hintEl = el('p', 'q-hint'); hintEl.dataset.hint = f.id; }

    if (f.type === 'yesno' || f.type === 'select') {
      const opts = f.type === 'yesno'
        ? [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]
        : f.options;
      const set = el('div', 'choice-set');
      opts.forEach(o => {
        const chip = el('label', 'choice' + (answers[f.id] === o.value ? ' selected' : ''));
        chip.textContent = o.label;
        const input = el('input');
        input.type = 'radio'; input.name = 'f_' + f.id; input.value = o.value;
        chip.appendChild(input);
        chip.addEventListener('click', (ev) => {
          ev.preventDefault();
          answers[f.id] = o.value;
          onAnswerChange(f);
        });
        set.appendChild(chip);
      });
      wrap.appendChild(set);
    } else {
      const input = el('input');
      input.id = 'f_' + f.id;
      input.type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text';
      if (f.type === 'number') input.min = '0';
      if (answers[f.id] != null) input.value = answers[f.id];
      // Text/number/date/time fields never gate another field's visibility,
      // so we update state + live indicators live, without re-rendering the form
      // (re-rendering would steal focus mid-typing).
      const commit = () => { answers[f.id] = input.value; saveAnswers(); refreshLiveStrip(); if (f.gateway) renderQuestions(); };
      input.addEventListener('input', () => { answers[f.id] = input.value; refreshLiveStrip(); refreshHints(); });
      input.addEventListener('change', commit);
      if (f.unit) {
        const row = el('div'); row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
        row.appendChild(input); row.appendChild(el('span', 'q-help', f.unit)); row.querySelector('.q-help').style.margin = '0';
        wrap.appendChild(row);
      } else {
        wrap.appendChild(input);
      }
    }
    if (hintEl) wrap.appendChild(hintEl);
    return wrap;
  }

  // Update every live hint currently on screen
  function refreshHints() {
    $$('.q-hint').forEach(p => {
      const f = NVC.FIELDS.find(x => x.id === p.dataset.hint);
      const t = f && f.hint ? f.hint(answers) : null;
      p.textContent = t || '';
      p.hidden = !t;
    });
  }

  function onAnswerChange(f) {
    saveAnswers();
    // Gateway/conditional fields can change which questions show — re-render this category
    renderQuestions();
    refreshLiveStrip();
  }

  function refreshLiveStrip() {
    // Lightweight live level indicator visible during the question flow
    const strip = $('#live-strip');
    const { level, topDrivers } = NVC.computeLevel(answers);
    const meta = NVC.LEVEL_META[level] || NVC.LEVEL_META[0];
    if (!level) { strip.hidden = true; return; }
    strip.hidden = false;
    strip.style.background = meta.color;
    strip.innerHTML = '';
    strip.appendChild(el('strong', null, 'Approval Level ' + level + ' — ' + meta.name));
    if (topDrivers[0]) strip.appendChild(el('span', null, '  ·  ' + topDrivers.map(d => d.reason).join(', ')));
  }

  // Level 1 (Self-Managed): the whole Action Plan is one page of standard conditions
  const L1_LABEL = 'SELF-MANAGED EVENT';
  const L1_BUBBLE = 'Level 1 — Self-Managed  —  No Council approval needed';
  const L1_HEADING = 'Standard Conditions';
  const L1_FOOT = 'You do not need to send anything to Council. Keep this page as your checklist for the day.';
  const level1Rows = (data) => [
    ['Event date', answers.event_date],
    ['Times', `${answers.event_start || '—'} – ${answers.event_finish || '—'}`],
    ['Location', answers.event_location],
    ['Most people on site at once', people(data.d.att)],
  ];
  const CHECKLIST_TITLE = 'Council Documentation Checklist';
  const CHECKLIST_INTRO = 'The documents Council needs from you for the event to proceed.';
  const CHECKLIST_OVERDUE = 'Contact Council As Soon As Possible';
  // Status bubble text for a checklist group, e.g. "Initial Documents — Contact Council As Soon As Possible — Due By …"
  const checklistBubble = (g) => [g.title, g.overdue ? CHECKLIST_OVERDUE : null, g.dueText].filter(Boolean).join('  —  ');
  const totalLevelNote = (n) => `Total attendance is in the Level ${n} range. Council may assess at that level.`;
  const people = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString());

  /* ---------------- Plan generation ---------------- */
  function buildPlanData() {
    const d = NVC.deriveContextFull(answers);
    const topics = NVC.TOPICS.filter(t => t.include(answers, d)).map(t => {
      const c = t.calc(answers, d) || {};
      return {
        title: t.title,
        headline: c.headline,
        escalate: !!c.escalate,
        note: t.note || c.note,
        notes: (t.notes || []).filter(n => !n.showIf || n.showIf(answers, d)).map(n => typeof n.text === 'function' ? n.text(answers, d) : n.text),
        actions: (t.actions || []).filter(x => !x.showIf || x.showIf(answers, d)).map(x => x.text),
        risks: (t.risks || []).filter(r => !r.showIf || r.showIf(answers, d)),
        genReqs: t.genReqs || [],
      };
    });
    const level = d.level;
    const meta = NVC.LEVEL_META[level];
    const notifications = Object.values(NVC.NOTIFICATIONS).filter(n => n.trigger(answers, d));
    // Cover-page attendance lines (shared by the preview and the Word document)
    const attendanceRows = [['Total attendance', people(d.total)], ['Peak on site at one time', people(d.att)]];
    if (d.stayHours) attendanceRows.push(['Typical visit (implied)', 'about ' + NVC.formatHours(d.stayHours)]);
    const totalLevel = NVC.computeLevel(answers).totalLevel;
    return { answers, d, topics, level, meta, notifications, attendanceRows, totalLevel };
  }

  // Which document the preview is showing: 'plan' | 'es' | 'resident'
  let currentDoc = 'plan';

  function renderPlanPreview() {
    const data = buildPlanData();
    const body = $('#plan-body');
    body.innerHTML = '';

    // Tabs: a notification only appears when the event triggers it
    const available = ['plan'].concat(data.notifications.map(n => n.id));
    if (!available.includes(currentDoc)) currentDoc = 'plan';
    $$('.doc-tab').forEach(t => {
      t.hidden = !available.includes(t.dataset.doc);
      const on = t.dataset.doc === currentDoc;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // Set the letterhead background ONCE via a shared stylesheet rule (not inline
    // per sheet) so the large data URI isn't duplicated across every page.
    if (NVC.LETTERHEAD && !$('#lh-style')) {
      const st = document.createElement('style');
      st.id = 'lh-style';
      st.textContent = `.sheet{background-image:url("${NVC.LETTERHEAD.dataUri}")}`;
      document.head.appendChild(st);
    }
    const sheet = () => el('div', 'sheet');

    if (currentDoc !== 'plan') {
      body.appendChild(notificationSheet(currentDoc, data, sheet()));
      $('#live-strip').hidden = true;
      showView('plan');
      return;
    }

    // ---- Level 1 (Self-Managed): a single page of standard conditions, nothing else ----
    if (data.level === 1) {
      const page = sheet();
      page.classList.add('sheet-cover');
      page.appendChild(el('div', 'cover-label', L1_LABEL));
      page.appendChild(el('h1', 'cover-title', answers.event_name || 'Event'));
      page.appendChild(el('div', 'cover-council l1-council', 'Nambucca Valley Council'));
      const g1 = el('div', 'cover-grid');
      level1Rows(data).forEach(([k, v]) => {
        const row = el('div', 'cover-row');
        row.appendChild(el('span', 'k', k));
        row.appendChild(el('span', 'v', v || '—'));
        g1.appendChild(row);
      });
      page.appendChild(g1);
      page.appendChild(el('div', 'headline ok l1-bubble', L1_BUBBLE));
      page.appendChild(el('h4', null, L1_HEADING));
      NVC.LEVEL1_CONDITIONS.forEach(x => {
        const item = el('div', 'check-item');
        item.appendChild(el('span', 'box', '☐'));
        item.appendChild(el('span', 'txt', x));
        page.appendChild(item);
      });
      page.appendChild(el('p', 'cover-disclaimer l1-foot', L1_FOOT));
      body.appendChild(page);
      $('#live-strip').hidden = true;
      showView('plan');
      return;
    }

    // ---- Front page: key event details only ----
    const cover = sheet();
    cover.classList.add('sheet-cover');
    cover.appendChild(el('div', 'cover-label', 'EVENT ACTION PLAN'));
    cover.appendChild(el('h1', 'cover-title', answers.event_name || 'Event Action Plan'));
    cover.appendChild(el('div', 'cover-council', 'Nambucca Valley Council'));
    const grid = el('div', 'cover-grid');
    const mrow = (k, v) => {
      const row = el('div', 'cover-row');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v || '—'));
      grid.appendChild(row);
    };
    mrow('Event date', answers.event_date);
    mrow('Times', `${answers.event_start || '—'} – ${answers.event_finish || '—'}`);
    mrow('Location', answers.event_location);
    data.attendanceRows.forEach(([k, v]) => mrow(k, v));
    mrow('Approval Level', `${data.level} — ${data.meta.name}`);
    mrow('Indicative timeframe', data.meta.timeframe);
    mrow('Site plan', data.meta.sitePlan);
    mrow('Organiser contact', [answers.organiser_contact_name, answers.organiser_contact_phone].filter(Boolean).join(', '));
    cover.appendChild(grid);
    if (data.totalLevel) cover.appendChild(el('p', 'cover-note', totalLevelNote(data.totalLevel)));
    cover.appendChild(el('p', 'cover-disclaimer', 'This plan is for the organiser\'s own use. It is not a Council approval or sign-off.'));
    body.appendChild(cover);

    // (The Council Documentation Checklist is now a live right-hand pane on the
    //  dashboard, not a page in the plan — see renderDocPane / NVC.docTracker.)
    const capacity = pageCapacityPx();

    // ---- Topics: flow each across as many A4 pages as it needs ----
    data.topics.forEach(t => paginateTopic(t, body, capacity));

    // ---- Final page: Risk Rating Matrix + a blank table for the organiser's own risks ----
    paginateBlocks([
      { el: el('h3', 'topic-h', EXTRA_RISKS_TITLE), keepNext: true },
      { el: el('p', 'notif-purpose', EXTRA_RISKS_INTRO) },
      { el: el('h4', null, 'Risk Rating Matrix'), keepNext: true },
      { el: riskMatrixEl() },
      { el: el('h4', null, 'Your Additional Risks'), keepNext: true },
      { el: blankRiskTableEl(NVC.EXTRA_RISK_ROWS) },
    ], body, capacity);

    renderDocPane();
    $('#live-strip').hidden = true;
    showView('plan');
  }

  // On-screen preview of a notification — same content as its Word download
  function notificationSheet(id, data, page) {
    const n = NVC.NOTIFICATIONS[id];
    page.classList.add('sheet-plain');   // no Council letterhead — the notice comes from the organiser
    page.appendChild(el('h3', 'topic-h', n.title));
    page.appendChild(el('h4', null, 'Purpose'));
    page.appendChild(el('p', 'notif-purpose', n.purpose));
    if (n.recipients) {
      page.appendChild(el('h4', null, 'Recipients'));
      n.recipients.forEach(r => page.appendChild(el('div', 'gen-item', '•  ' + r)));
    }
    page.appendChild(el('h4', null, 'Details'));
    const grid = el('div', 'cover-grid notif-grid');
    n.fields(answers, data.d).forEach(([k, v]) => {
      const row = el('div', 'cover-row');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v + ''));
      grid.appendChild(row);
    });
    page.appendChild(grid);
    return page;
  }

  function downloadCurrentDoc() {
    if (currentDoc === 'plan') generatePlanDocx();
    else generateNotificationDocx(currentDoc);
  }

  /* ---------------- A4 pagination for the preview ---------------- */
  // Usable content height of one A4 page (page minus top/bottom margins), in px.
  function pageCapacityPx() {
    const probe = el('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:100mm;height:0';
    document.body.appendChild(probe);
    const pxPerMm = (probe.offsetWidth / 100) || 3.7795;
    probe.remove();
    return (297 - MARGIN.top - MARGIN.bottom) * pxPerMm;
  }

  // Column widths (%): Risk and Your Controls match; Likelihood, Consequence and Rating match
  const RISK_COLS = [27.5, 15, 15, 15, 27.5];

  function riskTableEl(risks) {
    const table = el('table', 'risk');
    const cg = el('colgroup');
    RISK_COLS.forEach(w => { const c = el('col'); c.style.width = w + '%'; cg.appendChild(c); });
    table.appendChild(cg);
    const thead = el('tr');
    ['Risk', 'Likelihood', 'Consequence', 'Rating', 'Your Controls'].forEach(h => thead.appendChild(el('th', null, h)));
    table.appendChild(thead);
    risks.forEach(r => {
      const tr = el('tr');
      tr.appendChild(el('td', null, r.risk));
      tr.appendChild(el('td', null, r.likelihood));
      tr.appendChild(el('td', null, r.consequence));
      const rc = ratingColor(r.rating);
      const rate = el('td', 'rating-cell', r.rating);
      rate.style.backgroundColor = '#' + rc.fill;
      rate.style.color = '#' + rc.text;
      tr.appendChild(rate);
      tr.appendChild(el('td', 'ctrl-cell', '(add your controls)'));
      table.appendChild(tr);
    });
    return table;
  }

  // Ordered flow blocks for a topic. `keepNext` = don't leave this at the foot of a
  // page without the block after it; `atomic` = never split (the whole risk table).
  function buildTopicBlocks(t) {
    const blocks = [];
    const push = (node, meta) => blocks.push(Object.assign({ el: node }, meta || {}));
    push(el('h3', 'topic-h', t.title), { keepNext: true });
    push(el('div', 'headline' + (t.escalate ? ' escalate' : ''), t.headline));
    t.notes.forEach(n => push(el('div', 'note-inline', n)));
    if (t.actions.length) {
      push(el('h4', null, 'Action Checklist'), { keepNext: true });
      t.actions.forEach(x => {
        const item = el('div', 'check-item');
        item.appendChild(el('span', 'box', '☐'));
        item.appendChild(el('span', 'txt', x));
        push(item);
      });
    }
    // General Requirements now sit directly under the Action Checklist...
    if (t.genReqs.length) {
      push(el('h4', null, 'General Requirements'), { keepNext: true });
      t.genReqs.forEach(g => push(el('div', 'gen-item', '•  ' + g)));
    }
    // ...and the Risk table follows, kept whole (never split across pages).
    if (t.risks.length) {
      push(el('h4', null, 'Risks — record your controls'), { keepNext: true });
      push(riskTableEl(t.risks), { atomic: true });
    }
    if (t.note) push(el('div', 'note-inline', 'Note: ' + t.note));
    return blocks;
  }

  // Blank risk table for the organiser's own risks
  function blankRiskTableEl(rows) {
    const table = riskTableEl([]);
    for (let i = 0; i < rows; i++) {
      const tr = el('tr', 'blank-row');
      for (let c = 0; c < RISK_COLS.length; c++) tr.appendChild(el('td'));
      table.appendChild(tr);
    }
    return table;
  }

  // The likelihood × consequence matrix, coloured like the rating cells
  function riskMatrixEl() {
    const m = NVC.RISK_MATRIX;
    const table = el('table', 'risk risk-matrix');
    const head = el('tr');
    head.appendChild(el('th', null, 'Likelihood \\ Consequence'));
    m.consequences.forEach(c => head.appendChild(el('th', null, c)));
    table.appendChild(head);
    m.rows.forEach(([likelihood, ratings]) => {
      const tr = el('tr');
      tr.appendChild(el('th', null, likelihood));
      ratings.forEach(r => {
        const rc = ratingColor(r);
        const td = el('td', 'rating-cell', r);
        td.style.backgroundColor = '#' + rc.fill; td.style.color = '#' + rc.text;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    return table;
  }

  const EXTRA_RISKS_TITLE = 'Additional Risks';
  const EXTRA_RISKS_INTRO = 'Add any risks specific to your event that are not covered on the pages above. Use the matrix to rate each one.';

  function paginateTopic(t, container, capacity) { paginateBlocks(buildTopicBlocks(t), container, capacity); }

  // Flow a list of blocks ({ el, keepNext? }) across as many A4 sheets as they need
  function paginateBlocks(blocks, container, capacity) {
    // Measure inside a .sheet context so sheet-scoped styles (e.g. heading margins) apply
    const meas = el('div', 'sheet');
    meas.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;padding:0;margin:0;min-height:0;box-shadow:none;background:none;width:${210 - MARGIN.left - MARGIN.right}mm`;
    document.body.appendChild(meas);
    const heightOf = (node) => {
      meas.innerHTML = '';
      const c = node.cloneNode(true);
      meas.appendChild(c);
      const cs = getComputedStyle(c);
      return c.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    };
    const newSheet = () => { const s = el('div', 'sheet'); container.appendChild(s); return s; };
    let page = newSheet(), used = 0;
    for (let i = 0; i < blocks.length; i++) {
      const h = heightOf(blocks[i].el);
      let need = h;                                   // keepNext: reserve room for the next block too
      if (blocks[i].keepNext && blocks[i + 1]) need += heightOf(blocks[i + 1].el);
      if (used > 0 && used + need > capacity) { page = newSheet(); used = 0; }
      page.appendChild(blocks[i].el);
      used += h;
    }
    meas.remove();
  }

  /* ---------------- Word (.docx) generation ---------------- */
  const D = () => window.docx;

  function para(text, opts) {
    const o = opts || {};
    return new (D().Paragraph)({
      spacing: { after: o.after != null ? o.after : 80, before: o.before },
      heading: o.heading,
      keepNext: o.keepNext,
      alignment: o.center ? D().AlignmentType.CENTER : undefined,
      children: [wrun({ text: text, bold: o.bold, italics: o.italics, size: o.size, color: o.color, characterSpacing: o.spacing })],
    });
  }

  /* ---- Word document look: mirrors the on-screen preview ----
     Built to open cleanly in Google Docs first and Microsoft Word second, so it uses only
     plain tables, cell shading and Arial — no content controls, text boxes or custom fonts. */
  const WORD_FONT = 'Arial';
  // Every run names the font explicitly, so nothing falls back to a serif default in any program
  const wrun = (opts) => new (D().TextRun)(Object.assign({ font: WORD_FONT }, opts));
  const CONTENT_TWIP = mm(210 - MARGIN.left - MARGIN.right);
  const INK = { text: '1F2733', soft: '5A6675', faint: '8A95A3', border: 'DFE4EA', head: 'F0F2F5' };
  // Bubble / panel colours, matching .headline, .headline.escalate, .headline.ok and .note-inline
  const TONES = {
    info:   { fill: 'E8F1FA', text: '245A94' },
    danger: { fill: 'FDECEA', text: 'C0392B' },
    ok:     { fill: 'E6F5EA', text: '1E7A3C' },
    warn:   { fill: 'FDF6E7', text: 'B7791F' },
  };
  const WORD_STYLES = {
    default: {
      document: { run: { font: WORD_FONT, size: 20, color: INK.text } },
      title: { run: { font: WORD_FONT, size: 52, bold: true, color: INK.text }, paragraph: { spacing: { after: 40 } } },
      heading1: { run: { font: WORD_FONT, size: 33, bold: true, color: INK.text }, paragraph: { spacing: { after: 80 } } },
    },
  };
  const makeDoc = (section) => new (D().Document)({ styles: WORD_STYLES, sections: [section] });

  function noBorders() {
    const dx = D();
    const n = { style: dx.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    return { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n };
  }
  const noCellBorders = () => { const b = noBorders(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  // Small gap paragraph — needed between tables so Word and Google Docs keep them separate
  const gap = (after) => new (D().Paragraph)({ spacing: { after: after != null ? after : 80 }, children: [wrun({ text: '', size: 8 })] });
  // Small uppercase section label (the preview's h4)
  const label = (text) => para(text.toUpperCase(), { bold: true, size: 18, color: INK.soft, spacing: 10, after: 70, before: 120, keepNext: true });

  // Shaded bubble / panel: a one-cell borderless table, which keeps its colour in both programs
  function panel(text, tone, o) {
    const dx = D(), t = TONES[tone], opt = o || {};
    return new dx.Table({
      width: { size: CONTENT_TWIP, type: dx.WidthType.DXA }, columnWidths: [CONTENT_TWIP],
      layout: dx.TableLayoutType.FIXED, borders: noBorders(),
      rows: [new dx.TableRow({ cantSplit: true, children: [new dx.TableCell({
        width: { size: CONTENT_TWIP, type: dx.WidthType.DXA }, borders: noCellBorders(),
        shading: { fill: t.fill, type: dx.ShadingType.CLEAR, color: 'auto' },
        margins: { top: 110, bottom: 110, left: 170, right: 170 },
        children: [new dx.Paragraph({ spacing: { after: 0 }, keepNext: opt.keepNext,
          children: [wrun({ text, bold: opt.bold !== false, italics: opt.italics, size: opt.size || 22, color: t.text })] })],
      })] })],
    });
  }

  // Key / value rows with a rule under each (cover page and notification details)
  function kvTable(rows, keyW, totalW) {
    const dx = D(), total = totalW || CONTENT_TWIP;
    const rule = { style: dx.BorderStyle.SINGLE, size: 4, color: INK.border };
    const none = noCellBorders();
    const cell = (text, w, runOpts) => new dx.TableCell({
      width: { size: w, type: dx.WidthType.DXA }, verticalAlign: dx.VerticalAlign.TOP,
      borders: { top: none.top, left: none.left, right: none.right, bottom: rule },
      margins: { top: 110, bottom: 110, left: 0, right: 120 },
      children: [new dx.Paragraph({ spacing: { after: 0 }, children: [wrun(Object.assign({ text: (text || '—') + '' }, runOpts))] })],
    });
    return new dx.Table({
      width: { size: total, type: dx.WidthType.DXA }, columnWidths: [keyW, total - keyW],
      layout: dx.TableLayoutType.FIXED, borders: noBorders(),
      rows: rows.map(([k, v]) => new dx.TableRow({ cantSplit: true, children: [
        cell(k, keyW, { bold: true, size: 20, color: INK.soft }),
        cell(v, total - keyW, { bold: true, size: 22, color: INK.text }),
      ] })),
    });
  }

  // Checklist with real, clickable check boxes (Word content controls) beside each item
  function checklistTable(actions) {
    const dx = D();
    const boxW = 330, textW = CONTENT_TWIP - boxW;
    const none = noCellBorders();
    const rows = actions.map(x => new dx.TableRow({
      cantSplit: true,
      children: [
        new dx.TableCell({
          width: { size: boxW, type: dx.WidthType.DXA }, verticalAlign: dx.VerticalAlign.TOP, borders: none,
          margins: { top: 45, bottom: 45, left: 0, right: 0 },
          children: [new dx.Paragraph({ spacing: { after: 0 }, children: [new dx.CheckBox({ checked: false })] })],
        }),
        new dx.TableCell({
          width: { size: textW, type: dx.WidthType.DXA }, verticalAlign: dx.VerticalAlign.TOP, borders: none,
          margins: { top: 45, bottom: 45, left: 0, right: 0 },
          children: [new dx.Paragraph({ spacing: { after: 0 }, children: [wrun({ text: x, size: 21 })] })],
        }),
      ],
    }));
    return new dx.Table({ width: { size: CONTENT_TWIP, type: dx.WidthType.DXA }, columnWidths: [boxW, textW],
      layout: dx.TableLayoutType.FIXED, borders: noBorders(), rows });
  }

  // Risk table: fixed column widths matching the preview, coloured rating cells,
  // and a "Your Controls" column whose typing size is set to match the rest of the row.
  function riskTable(risks, blankRows) {
    const dx = D();
    const widths = RISK_COLS.map(p => Math.round(CONTENT_TWIP * p / 100));
    widths[4] = CONTENT_TWIP - widths[0] - widths[1] - widths[2] - widths[3];
    const W = (i) => ({ size: widths[i], type: dx.WidthType.DXA });
    const rule = { style: dx.BorderStyle.SINGLE, size: 4, color: INK.border };
    const borders = { top: rule, bottom: rule, left: rule, right: rule };
    const pad = { top: 70, bottom: 70, left: 90, right: 90 };
    const typeHere = () => new dx.Paragraph({ spacing: { after: 0 }, run: { size: 18, font: WORD_FONT }, children: [wrun({ text: '', size: 18 })] });
    const header = new dx.TableRow({
      tableHeader: true, cantSplit: true,
      children: ['Risk', 'Likelihood', 'Consequence', 'Rating', 'Your Controls'].map((hd, i) => new dx.TableCell({
        width: W(i), borders, margins: pad, shading: { fill: INK.head, type: dx.ShadingType.CLEAR, color: 'auto' },
        children: [new dx.Paragraph({ spacing: { after: 0 }, keepNext: true, children: [wrun({ text: hd.toUpperCase(), bold: true, size: 15, color: INK.soft })] })],
      })),
    });
    const text = (t, i) => new dx.TableCell({ width: W(i), borders, margins: pad, children: [para(t, { size: 18, after: 0, keepNext: true })] });
    const rows = risks.map(r => {
      const rc = ratingColor(r.rating);
      return new dx.TableRow({
        cantSplit: true,
        children: [
          text(r.risk, 0), text(r.likelihood, 1), text(r.consequence, 2),
          new dx.TableCell({
            width: W(3), borders, margins: pad, verticalAlign: dx.VerticalAlign.CENTER,
            shading: { fill: rc.fill, type: dx.ShadingType.CLEAR, color: 'auto' },
            children: [new dx.Paragraph({ alignment: dx.AlignmentType.CENTER, spacing: { after: 0 }, keepNext: true,
              children: [wrun({ text: r.rating, size: 18, bold: true, color: rc.text })] })],
          }),
          new dx.TableCell({ width: W(4), borders, margins: pad, children: [typeHere()] }),
        ],
      });
    });
    // Blank rows for the organiser's own risks (Additional Risks page)
    for (let i = 0; i < (blankRows || 0); i++) {
      rows.push(new dx.TableRow({
        cantSplit: true, height: { value: 560, rule: dx.HeightRule.ATLEAST },
        children: widths.map((_, c) => new dx.TableCell({ width: W(c), borders, margins: pad, children: [typeHere()] })),
      }));
    }
    return new dx.Table({ width: { size: CONTENT_TWIP, type: dx.WidthType.DXA }, columnWidths: widths, layout: dx.TableLayoutType.FIXED, rows: [header, ...rows] });
  }

  function riskMatrixTable() {
    const dx = D();
    const m = NVC.RISK_MATRIX;
    const firstW = Math.round(CONTENT_TWIP * 0.25), colW = Math.floor((CONTENT_TWIP - firstW) / m.consequences.length);
    const widths = [CONTENT_TWIP - colW * m.consequences.length].concat(m.consequences.map(() => colW));
    const rule = { style: dx.BorderStyle.SINGLE, size: 4, color: INK.border };
    const borders = { top: rule, bottom: rule, left: rule, right: rule };
    const cell = (text, i, opts) => new dx.TableCell({
      width: { size: widths[i], type: dx.WidthType.DXA }, borders, margins: { top: 90, bottom: 90, left: 90, right: 90 },
      shading: { fill: opts.fill, type: dx.ShadingType.CLEAR, color: 'auto' }, verticalAlign: dx.VerticalAlign.CENTER,
      children: [new dx.Paragraph({
        alignment: opts.center ? dx.AlignmentType.CENTER : dx.AlignmentType.LEFT, spacing: { after: 0 },
        children: [wrun({ text, size: opts.size || 18, bold: true, color: opts.color || INK.soft })],
      })],
    });
    const head = new dx.TableRow({ cantSplit: true, children: [cell('LIKELIHOOD \\ CONSEQUENCE', 0, { fill: INK.head, size: 15 })]
      .concat(m.consequences.map((c, i) => cell(c.toUpperCase(), i + 1, { fill: INK.head, center: true, size: 15 }))) });
    const rows = m.rows.map(([likelihood, ratings]) => new dx.TableRow({ cantSplit: true,
      children: [cell(likelihood.toUpperCase(), 0, { fill: INK.head, size: 15 })].concat(ratings.map((r, i) => { const rc = ratingColor(r); return cell(r, i + 1, { fill: rc.fill, color: rc.text, center: true }); })),
    }));
    return new dx.Table({ width: { size: CONTENT_TWIP, type: dx.WidthType.DXA }, columnWidths: widths, layout: dx.TableLayoutType.FIXED, rows: [head, ...rows] });
  }

  function letterheadHeader() {
    const dx = D();
    return new dx.Header({
      children: [new dx.Paragraph({
        spacing: { after: 0 },
        children: [new dx.ImageRun({
          data: base64ToUint8(NVC.LETTERHEAD.b64),
          transformation: { width: A4_PX.w, height: A4_PX.h },
          floating: {
            horizontalPosition: { relative: dx.HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: dx.VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true, allowOverlap: true,
            wrap: { type: dx.TextWrappingType.NONE },
          },
        })],
      })],
    });
  }

  // A4 section with the letterhead background + tuned margins.
  // plain = true gives an unbranded page (no Council letterhead) for the notifications.
  function a4Section(children, plain) {
    const dx = D();
    const m = plain ? MARGIN_PLAIN : MARGIN_WORD;
    const section = {
      properties: {
        page: {
          size: { width: A4.w, height: A4.h, orientation: dx.PageOrientation.PORTRAIT },
          margin: {
            top: mm(m.top), right: mm(m.right),
            bottom: mm(m.bottom), left: mm(m.left), header: 0, footer: 0,
          },
        },
      },
      children: children,
    };
    if (!plain) section.headers = { default: letterheadHeader() };
    return section;
  }

  function buildPlanDoc() {
    const dx = D();
    const data = buildPlanData();
    const kids = [];
    const pageTitle = (text) => new dx.Paragraph({
      heading: dx.HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 80 },
      children: [wrun({ text })],
    });

    // ---- Level 1 (Self-Managed): a single page of standard conditions, nothing else ----
    if (data.level === 1) {
      kids.push(para(L1_LABEL, { bold: true, size: 20, color: TONES.info.text, spacing: 40, after: 60 }));
      kids.push(para(answers.event_name || 'Event', { heading: dx.HeadingLevel.TITLE, after: 40 }));
      kids.push(para('Nambucca Valley Council', { size: 22, color: INK.soft, after: 300 }));
      kids.push(kvTable(level1Rows(data), 3100, 7100));
      kids.push(gap(260));
      kids.push(panel(L1_BUBBLE, 'ok'));
      kids.push(gap(120));
      kids.push(label(L1_HEADING));
      kids.push(checklistTable(NVC.LEVEL1_CONDITIONS));
      kids.push(gap(300));
      kids.push(para(L1_FOOT, { italics: true, size: 18, color: INK.faint, after: 0 }));
      return makeDoc(a4Section(kids));
    }

    // ---- Front page: key event details only ----
    kids.push(para('EVENT ACTION PLAN', { bold: true, size: 20, color: TONES.info.text, spacing: 40, after: 60 }));
    kids.push(para(answers.event_name || 'Event Action Plan', { heading: dx.HeadingLevel.TITLE, after: 40 }));
    kids.push(para('Nambucca Valley Council', { size: 22, color: INK.soft, after: 420 }));
    kids.push(kvTable([
      ['Event date', answers.event_date], ['Times', `${answers.event_start || '—'} – ${answers.event_finish || '—'}`],
      ['Location', answers.event_location], ...data.attendanceRows,
      ['Approval Level', `${data.level} — ${data.meta.name}`], ['Indicative timeframe', data.meta.timeframe],
      ['Site plan', data.meta.sitePlan],
      ['Organiser contact', [answers.organiser_contact_name, answers.organiser_contact_phone].filter(Boolean).join(', ')],
    ], 2500, 7100));
    if (data.totalLevel) { kids.push(gap(260)); kids.push(panel(totalLevelNote(data.totalLevel), 'warn', { size: 20 })); }
    kids.push(gap(420));
    kids.push(para('This plan is for the organiser\'s own use. It is not a Council approval or sign-off.',
      { italics: true, size: 18, color: INK.faint, after: 0 }));

    // (Council Documentation Checklist removed from the plan — it is now the live
    //  right-hand pane on the dashboard.)

    // ---- One page per topic (each heading starts a new page) ----
    data.topics.forEach(t => {
      kids.push(pageTitle(t.title));
      kids.push(panel(t.headline, t.escalate ? 'danger' : 'info'));
      kids.push(gap(80));
      t.notes.forEach(n => { kids.push(panel(n, 'warn', { bold: false, size: 19 })); kids.push(gap(80)); });
      if (t.actions.length) {
        kids.push(label('Action Checklist'));
        kids.push(checklistTable(t.actions));
        kids.push(gap(60));
      }
      // General Requirements sit directly under the Action Checklist...
      if (t.genReqs.length) {
        kids.push(label('General Requirements'));
        t.genReqs.forEach(g => kids.push(para('•  ' + g, { size: 20, color: INK.soft, after: 60 })));
      }
      // ...then the Risk table (rows kept together via cantSplit + a keepNext label).
      if (t.risks.length) {
        kids.push(label('Risks — record your controls'));
        kids.push(riskTable(t.risks));
        kids.push(gap(80));
      }
      if (t.note) { kids.push(gap(40)); kids.push(panel('Note: ' + t.note, 'warn', { bold: false, size: 19 })); }
    });

    // ---- Final page: Risk Rating Matrix + a blank table for the organiser's own risks ----
    kids.push(pageTitle(EXTRA_RISKS_TITLE));
    kids.push(para(EXTRA_RISKS_INTRO, { size: 21, color: INK.soft, after: 100 }));
    kids.push(label('Risk Rating Matrix'));
    kids.push(riskMatrixTable());
    kids.push(gap(100));
    kids.push(label('Your Additional Risks'));
    kids.push(riskTable([], NVC.EXTRA_RISK_ROWS));

    return makeDoc(a4Section(kids));
  }

  function generatePlanDocx() {
    downloadDoc(buildPlanDoc(), sanitize(answers.event_name || 'Event') + '-Action-Plan');
  }

  function buildNotificationDoc(id) {
    const dx = D();
    const data = buildPlanData();
    const n = NVC.NOTIFICATIONS[id];
    const kids = [];
    kids.push(para(n.title, { heading: dx.HeadingLevel.HEADING_1, after: 160 }));
    kids.push(label('Purpose'));
    kids.push(para(n.purpose, { size: 21, color: INK.soft, after: 120 }));
    if (n.recipients) {
      kids.push(label('Recipients'));
      n.recipients.forEach(r => kids.push(para('•  ' + r, { size: 20, color: INK.soft, after: 60 })));
    }
    kids.push(label('Details'));
    kids.push(kvTable(n.fields(answers, data.d), 3300));
    return makeDoc(a4Section(kids, true));
  }

  function generateNotificationDocx(id) {
    downloadDoc(buildNotificationDoc(id), sanitize(answers.event_name || 'Event') + '-' + NVC.NOTIFICATIONS[id].filename);
  }

  function downloadDoc(doc, filename) {
    D().Packer.toBlob(doc).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename + '.docx';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    });
  }

  const sanitize = (s) => String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'Event';

  /* ---------------- Wiring ---------------- */
  // Draft banner + feedback link, shown only when data/site.js turns them on (the public feedback site)
  function renderSiteBanner() {
    const site = NVC.SITE || {};
    if (!site.draftBanner) return;
    const bar = el('div', 'draft-banner');
    bar.appendChild(el('span', null, site.bannerText || 'Draft for feedback — not an official Council tool yet.'));
    if (site.feedbackEmail) {
      const link = el('a', 'btn btn-ghost draft-feedback', 'Give feedback');
      link.href = 'mailto:' + site.feedbackEmail + '?subject=' + encodeURIComponent('Event Planner feedback');
      bar.appendChild(link);
    }
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function init() {
    renderSiteBanner();
    loadAnswers();
    renderDashboard();
    $('#btn-back-dash').addEventListener('click', () => { renderDashboard(); showView('dashboard'); });
    $('#btn-back-dash-2').addEventListener('click', () => { renderDashboard(); showView('dashboard'); });
    $('#btn-save-category').addEventListener('click', () => { renderDashboard(); showView('dashboard'); });
    $('#btn-generate').addEventListener('click', () => { currentDoc = 'plan'; renderPlanPreview(); });
    $$('.doc-tab').forEach(t => t.addEventListener('click', () => { currentDoc = t.dataset.doc; renderPlanPreview(); }));
    $('#btn-download').addEventListener('click', downloadCurrentDoc);
    // Refresh clears every answer. It asks for a second click instead of using a browser
    // confirm() dialog, because some embedded browsers suppress those and the button would do nothing.
    const refreshBtn = $('#btn-restart');
    let refreshArmed = null;
    const disarmRefresh = () => {
      clearTimeout(refreshArmed); refreshArmed = null;
      refreshBtn.textContent = 'Refresh'; refreshBtn.classList.remove('btn-danger');
    };
    refreshBtn.addEventListener('click', () => {
      if (!refreshArmed) {
        refreshBtn.textContent = 'Click again to clear all answers';
        refreshBtn.classList.add('btn-danger');
        refreshArmed = setTimeout(disarmRefresh, 5000);
        return;
      }
      disarmRefresh();
      Object.keys(answers).forEach(k => delete answers[k]);
      saveAnswers();
      renderDashboard(); showView('dashboard');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // Exposed for verification/testing: returns the plan/notification .docx as a base64 string
  async function exportBase64(kind) {
    const dx = D();
    const toB64 = (blob) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(blob); });
    let doc;
    if (kind === 'es' || kind === 'resident') { doc = buildNotificationDoc(kind); }
    else { doc = buildPlanDoc(); }
    return toB64(await dx.Packer.toBlob(doc));
  }
  NVC._debug = { answers, buildPlanData, exportBase64, buildPlanDoc: () => buildPlanDoc() };
})(window.NVC = window.NVC || {});
