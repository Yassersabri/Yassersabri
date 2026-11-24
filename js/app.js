/* SANS Schedule Control — application (UI, storage, routing) */
(function () {
  'use strict';
  const S = window.SANS;
  const esc = S.esc, fmt = S.fmtDate, sar = S.sar;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const VIEWS = [
    ['portfolio', 'Portfolio'], ['project-data', 'Project data'], ['schedule', 'Schedule'], ['review', 'Review'],
    ['recovery', 'Recovery'], ['risks', 'Risks'], ['report', 'Report'],
  ];
  const state = {
    mode: 'local', db: null, user: null, uid: null, downloads: null, names: {},
    projects: [], loading: false, dbNote: '', sample: S.sampleProject(),
    cur: null, dirty: false, A: null, R: null, optKey: null, view: 'portfolio',
    schedView: 'table', filter: 'all', q: '', rec: {}, confirmDelete: false, importMsg: '',
  };

  /* ---------- prefs (per viewer convenience) ---------- */
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('sans-sct-pref:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sans-sct-pref:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  /* ---------- storage ---------- */
  const LKEY = 'sans-sct:projects:v1';
  const Local = {
    all() { try { return JSON.parse(localStorage.getItem(LKEY) || '{}'); } catch (e) { return {}; } },
    write(o) { try { localStorage.setItem(LKEY, JSON.stringify(o)); return true; } catch (e) { return false; } },
    list() { return Object.values(this.all()).map(p => meta(p)); },
    async load(id) { const p = this.all()[id]; return p ? JSON.parse(JSON.stringify(p)) : null; },
    async save(p) { const o = this.all(); o[p.id] = JSON.parse(JSON.stringify(p)); if (!this.write(o)) throw new Error('Browser storage is full or blocked. Export a backup file instead.'); },
    async remove(id) { const o = this.all(); delete o[id]; this.write(o); },
  };
  function meta(p) { const m = Object.assign({}, p); delete m.activities; return m; }
  function chunk(acts) {
    const out = []; let cur = [], size = 0;
    for (const a of acts) { const s = JSON.stringify(a).length; if (cur.length && size + s > 150000) { out.push(cur); cur = []; size = 0; } cur.push(a); size += s; }
    if (cur.length || !out.length) out.push(cur);
    return out;
  }
  const Remote = {
    async load(id) {
      const db = state.db;
      const m = await db.doc('projects/' + id).get();
      if (!m.exists) return null;
      const p = JSON.parse(JSON.stringify(m.data()));
      const cs = await db.collection('projects/' + id + '/chunks').get();
      const parts = cs.docs.map(d => d.data()).filter(d => d.k < (p.chunks || 0)).sort((a, b) => a.k - b.k);
      p.activities = parts.flatMap(d => JSON.parse(JSON.stringify(d.acts || [])));
      return p;
    },
    async save(p) {
      const db = state.db;
      const parts = chunk(p.activities || []);
      const prev = (state.projects.find(x => x.id === p.id) || {}).chunks || 0;
      for (let k = 0; k < parts.length; k++) await db.doc(`projects/${p.id}/chunks/c${k}`).set({ k, acts: JSON.parse(JSON.stringify(parts[k])) });
      for (let k = parts.length; k < prev; k++) await db.doc(`projects/${p.id}/chunks/c${k}`).delete();
      const m = JSON.parse(JSON.stringify(meta(p))); m.chunks = parts.length;
      await db.doc('projects/' + p.id).set(m);
    },
    async remove(id) {
      const db = state.db;
      const prev = (state.projects.find(x => x.id === id) || {}).chunks || 0;
      for (let k = 0; k < Math.max(prev, 1); k++) await db.doc(`projects/${id}/chunks/c${k}`).delete();
      await db.doc('projects/' + id).delete();
    },
  };
  const Store = () => state.mode === 'db' ? Remote : Local;

  async function initCapabilities() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    state.loading = true; render();
    const [db, user, dl] = await Promise.all([
      window.claude.use('db').catch(() => null), window.claude.use('user').catch(() => null), window.claude.use('downloads').catch(() => null),
    ]);
    state.downloads = dl; state.user = user;
    if (user) { try { state.uid = await user.id(); } catch (e) { /* anonymous */ } }
    if (!db) { state.loading = false; render(); return; }
    state.db = db; state.mode = 'db';
    let timer = setTimeout(() => { state.dbNote = 'The company register cannot be reached yet. The list may be incomplete.'; state.loading = false; render(); }, 10000);
    db.collection('projects').onSnapshot(snap => {
      state.projects = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (!snap.metadata.fromCache) { clearTimeout(timer); state.dbNote = ''; }
      state.loading = false;
      resolveNames();
      // reopen remembered project once list arrives
      const want = pref.get('project', null);
      if (!state.cur && want && state.projects.some(p => p.id === want)) openProject(want, true);
      else render();
    }, err => { clearTimeout(timer); state.loading = false; state.dbNote = 'The company register is unavailable (' + (err && err.code || 'error') + ').'; render(); });
  }
  async function resolveNames() {
    if (!state.user) return;
    const ids = [...new Set(state.projects.map(p => p.updatedBy).filter(Boolean))];
    if (!ids.length) return;
    try { const ps = await state.user.profiles(ids); for (const id of ids) state.names[id] = (ps[id] && ps[id].name) || 'A colleague'; render(); } catch (e) { /* ignore */ }
  }

  /* ---------- project lifecycle ---------- */
  const newId = () => 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function blankProject() {
    return {
      id: newId(), info: { code: '', name: 'New project', client: '', consultant: '', sector: 'Government', location: '', contractType: 'Lump Sum', contractValue: null,
        start: '', dataDate: new Date().toISOString().slice(0, 10), contractFinish: '', ldRate: null, ldCapPct: 10, dailyIndirect: null, pm: '', planner: '',
        reportingCycle: 'Monthly', calendar: { week: '6d', ksaHolidays: true, holidays: [] }, scope: '', events: [] },
      activities: [], risks: [], revisions: [], log: [],
    };
  }
  function fromSample() {
    const s = S.sampleProject();
    return { id: 'sample', sample: true, info: Object.assign(s.info, { events: [
      { date: '2026-02-20', desc: 'Balady permit resubmission requested by municipality', party: 'Authority', days: 26 },
      { date: '2026-05-10', desc: 'Late approval of raft rebar shop drawings by consultant', party: 'Client / Engineer', days: 9 },
    ] }), activities: s.activities, risks: [], revisions: [], log: [] };
  }
  async function openProject(id, quiet) {
    if (id === 'sample') { state.cur = fromSample(); }
    else {
      try { const p = await Store().load(id); if (!p) { toast('That project is no longer in the register.'); return; } state.cur = p; }
      catch (e) { toast('Could not open the project: ' + (e.message || e.code || 'error')); return; }
    }
    state.cur.info.events = state.cur.info.events || [];
    state.cur.info.calendar = state.cur.info.calendar || { week: '6d', ksaHolidays: true, holidays: [] };
    state.dirty = false; state.confirmDelete = false; state.importMsg = '';
    pref.set('project', id);
    recalc();
    if (!quiet && state.view === 'portfolio') go(state.cur.activities.length ? 'review' : 'schedule');
    else render();
  }
  function recalc() {
    state.R = null; state.optKey = null;
    const c = state.cur;
    if (c && c.activities.length) {
      try { state.A = S.assess(projInfo(), c.activities); } catch (e) { console.error(e); state.A = null; toast('Calculation error: ' + e.message); }
    } else state.A = null;
  }
  function projInfo() { return state.cur.info; }
  function getR() {
    if (!state.R && state.A) {
      state.R = S.recover(projInfo(), state.cur.activities, state.rec);
      if (!state.optKey) state.optKey = state.R.recommended ? state.R.recommended.key : state.R.options[0].key;
    }
    return state.R;
  }
  function markDirty() { state.dirty = true; }
  function summary() {
    const A = state.A, I = state.cur.info;
    if (!A) return { health: 'No schedule', acts: 0, dataDate: I.dataDate };
    return {
      health: A.health, finish: A.r.finish, variance: A.r.varianceDays, minTF: A.r.minTF, quality: A.quality, dcma: A.d.score,
      spi: A.m.spi, cpli: A.m.cpli, bei: A.m.bei, actual: A.m.actual, planned: A.m.planned, ld: A.m.ldExposure,
      risksHigh: A.rk.filter(x => x.score >= 12).length, acts: state.cur.activities.length, dataDate: I.dataDate,
    };
  }
  async function saveProject() {
    const c = state.cur; if (!c) return;
    if (c.sample) { c.id = newId(); delete c.sample; c.info.name = c.info.name + ' (copy)'; }
    c.updatedAt = new Date().toISOString(); c.updatedBy = state.uid || null;
    c.summary = summary();
    c.log = (c.log || []).slice(-60);
    try {
      await Store().save(c);
      state.dirty = false; pref.set('project', c.id);
      if (state.mode === 'local') state.projects = Local.list();
      toast(state.mode === 'db' ? 'Saved to the company register.' : 'Saved in this browser.');
    } catch (e) {
      toast(e && (e.code === 'permission_denied' || e.code === 'not_granted') ? 'You have view-only access to the register. Ask the owner for Contributor access.' : 'Save failed: ' + (e.message || e.code || 'error'));
    }
    render();
  }
  async function deleteProject() {
    const c = state.cur; if (!c || c.sample) return;
    try { await Store().remove(c.id); } catch (e) { toast('Delete failed: ' + (e.message || e.code)); return; }
    if (state.mode === 'local') state.projects = Local.list();
    state.cur = null; state.A = null; state.R = null; pref.set('project', null);
    toast('Project deleted.'); go('portfolio');
  }
  function addLog(text) { const c = state.cur; c.log = c.log || []; c.log.push({ at: new Date().toISOString(), by: state.uid || null, text }); }

  /* ---------- files ---------- */
  async function saveFile(filename, data) {
    if (state.downloads) {
      try { await state.downloads.save({ filename, data }); toast('Saved ' + filename); }
      catch (e) { if (e && e.code === 'declined') return; toast(e && e.code === 'unavailable' ? 'Saving files is not available in this view. Use Copy instead.' : 'Could not save the file (' + (e && e.code || 'error') + ').'); }
      return;
    }
    if (window.claude) { toast('Saving files is not available in this view. Use Copy instead.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' })); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }
  async function importScheduleFile(file) {
    try { applyImport(S.importSchedule(file.name, await readFile(file)), file.name); }
    catch (e) { state.importMsg = e.message || String(e); render(); }
  }
  function applyImport(res, label) {
    if (!res.activities.length) throw new Error('No activities were found in ' + label + '.');
    const c = state.cur, I = c.info;
    for (const [k, v] of Object.entries(res.info || {})) if (v && !I[k] && k !== 'plannedFinish') I[k] = v;
    if (!I.start) { const ds = res.activities.map(a => a.as || a.bs).filter(Boolean).sort(); if (ds[0]) I.start = ds[0]; }
    if (!I.contractFinish && res.info && res.info.plannedFinish) I.contractFinish = res.info.plannedFinish;
    c.activities = res.activities;
    addLog(`Schedule imported from ${label} (${res.source}, ${res.activities.length} activities).`);
    state.importMsg = '';
    markDirty(); recalc();
    toast(`Imported ${res.activities.length} activities from ${res.source}.` + (res.notes ? ' ' + res.notes.join(' ') : ''));
    render();
  }
  const TEMPLATE = 'Activity ID,Activity Name,WBS,Original Duration,Remaining Duration,% Complete,Actual Start,Actual Finish,Baseline Start,Baseline Finish,Resources,Cost,Constraint,Constraint Date,Predecessors,Milestone\r\n' +
    'M1000,Notice to Proceed,1 Milestones,0,0,100,2026-01-04,2026-01-04,2026-01-04,2026-01-04,,,,,,Yes\r\n' +
    'A1010,Mobilization,2 Preliminaries,20,0,100,2026-01-04,2026-01-28,2026-01-04,2026-01-26,Site Team,450000,,,M1000,\r\n' +
    'C1010,Excavation & shoring,4 Substructure,30,12,60,2026-01-29,,2026-01-27,2026-03-02,Earthworks Crew,1400000,,,A1010,\r\n' +
    'C1020,Raft foundation,4 Substructure,25,25,0,,,2026-03-03,2026-03-31,Concrete Crew,2800000,,,C1010FS+3,\r\n' +
    'M1020,Substantial completion,1 Milestones,0,,0,,,2026-03-31,2026-03-31,,,Finish On or Before,2026-04-30,C1020,Yes\r\n';

  /* ---------- small UI helpers ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4200); }
  const n2 = v => v == null || !isFinite(v) ? '—' : (+v).toFixed(2);
  const n1 = v => v == null || !isFinite(v) ? '—' : (+v).toFixed(1);
  const healthChip = h => `<span class="chip ${h === 'Critical' ? 'crit' : h === 'At risk' ? 'warn' : h === 'On track' ? 'ok' : ''}">${esc(h || '—')}</span>`;
  const varTxt = v => v == null ? '—' : v > 0 ? `+${v} d late` : v < 0 ? `${-v} d early` : 'On date';
  const ago = isoTs => { if (!isoTs) return ''; const d = new Date(isoTs); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  function idx(n) { return n; }

  function go(view) { if (location.hash !== '#' + view) location.hash = view; else { state.view = view; render(); } }
  function route() {
    const h = (location.hash || '').replace('#', '');
    state.view = VIEWS.some(v => v[0] === h) ? h : 'portfolio';
    if (state.view !== 'portfolio' && !state.cur) state.view = 'portfolio';
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- chrome ---------- */
  function renderChrome() {
    const sel = $('#projSel');
    const list = state.mode === 'local' ? (state.projects = Local.list()) : state.projects;
    const opts = ['<option value="">— Portfolio —</option>'].concat(list.slice().sort((a, b) => (a.info.code || '').localeCompare(b.info.code || '')).map(p => `<option value="${esc(p.id)}">${esc((p.info.code ? p.info.code + ' · ' : '') + (p.info.name || 'Untitled'))}</option>`));
    opts.push('<option value="sample">Example · Riyadh Commercial HQ (sample data)</option>');
    if (state.cur && !state.cur.sample && !list.some(p => p.id === state.cur.id)) opts.push(`<option value="${esc(state.cur.id)}">${esc(state.cur.info.name)} (unsaved)</option>`);
    sel.innerHTML = opts.join('');
    sel.value = state.cur ? state.cur.id : '';
    const b = $('#storeBadge');
    b.classList.toggle('on', state.mode === 'db');
    b.querySelector('span').textContent = state.mode === 'db' ? 'Company register (shared)' : state.loading ? 'Connecting to register…' : 'Saved in this browser';
    const risksN = state.A ? state.A.rk.filter(x => x.score >= 12).length : 0;
    $('#tabs').innerHTML = VIEWS.map(([k, l]) => `<a href="#${k}" class="${k !== 'portfolio' && !state.cur ? 'off' : ''}" ${state.view === k ? 'aria-current="page"' : ''}>${l}${k === 'risks' && risksN ? `<small>${risksN}</small>` : ''}</a>`).join('');
  }
  function projectBar() {
    const c = state.cur, I = c.info, A = state.A;
    return `<div class="pbar">
      <div class="t"><div class="eyebrow">${esc(I.code || 'No code')} ${c.sample ? '· Example data' : ''}</div><h2>${esc(I.name || 'Untitled project')}</h2>
        <div class="sub">Data date ${fmt(I.dataDate)}${S.hijri(I.dataDate) ? ' · ' + esc(S.hijri(I.dataDate)) : ''} · ${c.activities.length} activities${c.updatedAt ? ' · last saved ' + esc(ago(c.updatedAt)) + (c.updatedBy && state.names[c.updatedBy] ? ' by ' + esc(state.names[c.updatedBy]) : '') : ''}</div></div>
      <div class="row">${A ? healthChip(A.health) : ''}${state.dirty ? '<span class="chip warn">Unsaved changes</span>' : ''}
        <button class="btn pri" data-act="save" ${state.dirty || c.sample ? '' : 'disabled'}>${c.sample ? 'Save a copy to the register' : 'Save project'}</button></div>
    </div>`;
  }

  /* ---------- views ---------- */
  function render() {
    renderChrome();
    const v = $('#view');
    const fn = { portfolio: vPortfolio, 'project-data': vData, schedule: vSchedule, review: vReview, recovery: vRecovery, risks: vRisks, report: vReport }[state.view] || vPortfolio;
    try { v.innerHTML = fn(); } catch (e) { console.error(e); v.innerHTML = `<div class="notice">Something went wrong while drawing this view: ${esc(e.message)}</div>`; }
    afterRender();
  }

  function vPortfolio() {
    const list = state.projects;
    const sampleA = S.assess(state.sample.info, state.sample.activities);
    const rows = list.map(p => ({ id: p.id, info: p.info, s: p.summary || {}, updatedAt: p.updatedAt, updatedBy: p.updatedBy, sample: false }));
    const showSample = true;
    const sum = rows.reduce((o, r) => { o.value += +r.info.contractValue || 0; o.ld += +r.s.ld || 0; o[r.s.health] = (o[r.s.health] || 0) + 1; return o; }, { value: 0, ld: 0 });
    const storeTxt = state.mode === 'db' ? 'Projects are recorded in the shared company register. Everyone with access to this tool sees the same list.' : 'Projects are saved in this browser only. Open this tool from the company link to use the shared register, or export backups.';
    return `
      <section class="panel"><header><div><div class="eyebrow">Company portfolio</div><h2>Project schedules across SANS International</h2></div>
        <div class="row"><button class="btn pri" data-act="new">New project</button><button class="btn" data-act="open" data-id="sample">Open example project</button>
        <label class="btn" for="jsonIn">Import backup (.json)</label><input type="file" id="jsonIn" accept=".json,application/json" hidden></div></header>
        <p class="hint">${storeTxt}</p>
        ${state.dbNote ? `<div class="notice">${esc(state.dbNote)}</div>` : ''}
        <div class="kpis">
          <div class="kpi"><span class="l">Projects</span><span class="v">${rows.length}</span><span class="s">recorded</span></div>
          <div class="kpi crit"><span class="l">Critical</span><span class="v">${sum.Critical || 0}</span><span class="s">> 30 d late or CPLI < 0.90</span></div>
          <div class="kpi warn"><span class="l">At risk</span><span class="v">${sum['At risk'] || 0}</span><span class="s">late or SPI < 0.95</span></div>
          <div class="kpi ok"><span class="l">On track</span><span class="v">${sum['On track'] || 0}</span><span class="s">within contract date</span></div>
          <div class="kpi"><span class="l">Contract value</span><span class="v">${(sum.value / 1e6).toFixed(1)}M</span><span class="s">SAR, all projects</span></div>
          <div class="kpi ${sum.ld ? 'crit' : ''}"><span class="l">LD exposure</span><span class="v">${(sum.ld / 1e6).toFixed(2)}M</span><span class="s">SAR at current forecast</span></div>
        </div>
        ${state.loading && !rows.length ? '<div class="notice info">Loading the company register…</div>' : ''}
        ${!rows.length && !state.loading ? `<div class="empty"><h3>No projects recorded yet</h3><p class="hint">Create a project, enter its contract data and import the Primavera P6 (.xer), MS Project (.xml) or Excel/CSV schedule. The example below shows what the tool produces.</p></div>` : ''}
        <div class="tw"><table><thead><tr><th>Project</th><th>Health</th><th>Data date</th><th>Forecast finish</th><th class="num">Variance</th><th class="num">SPI</th><th class="num">CPLI</th><th class="num">Quality</th><th class="num">High risks</th><th>Last update</th></tr></thead><tbody>
          ${rows.map(r => `<tr class="click" data-act="open" data-id="${esc(r.id)}"><td><span class="idc">${esc(r.info.code || '—')}</span><br>${esc(r.info.name)}<br><span class="hint">${esc([r.info.client, r.info.location].filter(Boolean).join(' · '))}</span></td>
            <td>${healthChip(r.s.health)}</td><td class="date">${fmt(r.s.dataDate || r.info.dataDate)}</td><td class="date">${fmt(r.s.finish)}</td>
            <td class="num ${r.s.variance > 0 ? 'neg' : ''}">${varTxt(r.s.variance)}</td><td class="num">${n2(r.s.spi)}</td><td class="num">${n2(r.s.cpli)}</td><td class="num">${r.s.quality ?? '—'}</td><td class="num">${r.s.risksHigh ?? '—'}</td>
            <td class="hint">${esc(ago(r.updatedAt))}${r.updatedBy && state.names[r.updatedBy] ? '<br>' + esc(state.names[r.updatedBy]) : ''}</td></tr>`).join('')}
          ${showSample ? `<tr class="click" data-act="open" data-id="sample"><td><span class="idc">${esc(state.sample.info.code)}</span> <span class="chip plain acc">Example</span><br>${esc(state.sample.info.name)}<br><span class="hint">Sample data to explore the tool. It is not saved.</span></td>
            <td>${healthChip(sampleA.health)}</td><td class="date">${fmt(state.sample.info.dataDate)}</td><td class="date">${fmt(sampleA.r.finish)}</td><td class="num neg">${varTxt(sampleA.r.varianceDays)}</td>
            <td class="num">${n2(sampleA.m.spi)}</td><td class="num">${n2(sampleA.m.cpli)}</td><td class="num">${sampleA.quality}</td><td class="num">${sampleA.rk.filter(x => x.score >= 12).length}</td><td class="hint">—</td></tr>` : ''}
        </tbody></table></div>
      </section>
      <section class="grid2">
        <div class="panel"><h3>Monthly update workflow</h3><div class="list">
          ${[['Record', 'Enter or update the project data: contract dates, data date, LD rate and calendar.'], ['Import', 'Load the updated P6, MS Project or Excel schedule.'], ['Review', 'Read the DCMA 14-point results, missing information and recommendations.'], ['Recover', 'Compare recovery options, then adopt the revised schedule.'], ['Risks', 'Confirm the triggered risks, owners and responses.'], ['Report', 'Download the narrative report and issue it with the update.']]
          .map(([a, b]) => `<div class="item"><span class="chip plain acc">${a}</span><span class="d">${b}</span></div>`).join('')}</div></div>
        <div class="panel"><h3>Standards built in</h3><div class="list">
          <div class="item"><span class="chip plain">CPM</span><span class="d">Forward and backward pass with retained logic, progress at the data date, and FS/SS/FF/SF links, lags and constraints.</span></div>
          <div class="item"><span class="chip plain">DCMA</span><span class="d">The 14-point schedule assessment with thresholds, plus SPI, BEI and CPLI.</span></div>
          <div class="item"><span class="chip plain">KSA</span><span class="d">Sat–Thu work week, Founding Day, National Day and both Eids, plus Ramadan and the summer midday work-ban risk triggers.</span></div>
          <div class="item"><span class="chip plain">FIDIC</span><span class="d">Delay damages exposure, an EOT route, and contemporaneous delay event records.</span></div></div></div>
      </section>`;
  }

  const INFO_FIELDS = [
    ['Identification', [['code', 'Project code', 'text', 1], ['name', 'Project name', 'text', 1], ['client', 'Client / Employer', 'text', 1], ['consultant', 'Consultant / Engineer', 'text'],
      ['sector', 'Sector', ['Government', 'Semi-government (Aramco, SEC, NWC…)', 'Giga-project (NEOM, ROSHN, Red Sea…)', 'Private', 'Industrial']], ['location', 'Site location', 'text', 1],
      ['contractType', 'Contract type', ['Lump Sum', 'Lump Sum (FIDIC Red Book)', 'Re-measured', 'Design & Build (FIDIC Yellow)', 'EPC / Turnkey (FIDIC Silver)', 'Cost Plus', 'Framework / Call-off']]]],
    ['Contract dates', [['start', 'Start / NTP date', 'date', 1], ['contractFinish', 'Contract completion date', 'date', 1], ['dataDate', 'Data date (status date)', 'date', 1], ['reportingCycle', 'Reporting cycle', ['Weekly', 'Bi-weekly', 'Monthly']]]],
    ['Commercial', [['contractValue', 'Contract value (SAR)', 'number', 1], ['ldRate', 'Delay damages per day (SAR)', 'number', 1], ['ldCapPct', 'LD cap (% of contract value)', 'number'], ['dailyIndirect', 'Daily site overheads (SAR)', 'number']]],
    ['Team', [['pm', 'Project manager', 'text', 1], ['planner', 'Planning engineer', 'text', 1]]],
  ];
  function vData() {
    const c = state.cur, I = c.info, cal = I.calendar;
    const f = ([k, label, type, req]) => {
      const v = I[k] ?? '';
      const lab = `<span>${esc(label)}${req ? ' <b>*</b>' : ''}</span>`;
      if (Array.isArray(type)) return `<label class="fld">${lab}<select id="i-${k}" data-info="${k}">${type.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}${type.includes(v) || !v ? '' : `<option selected>${esc(v)}</option>`}</select></label>`;
      return `<label class="fld">${lab}<input id="i-${k}" type="${type}" data-info="${k}" value="${esc(v)}" ${type === 'number' ? 'min="0" step="any"' : ''}></label>`;
    };
    return projectBar() + `
      <section class="panel"><header><h3>Project register entry</h3><p>Fields marked * feed the delay, LD and recovery calculations.</p></header>
        ${INFO_FIELDS.map(([g, fs]) => `<fieldset class="fs"><legend>${g}</legend><div class="form">${fs.map(f).join('')}</div></fieldset>`).join('')}
        <fieldset class="fs"><legend>Work calendar</legend><div class="form">
          <label class="fld"><span>Work week</span><select id="i-week" data-cal="week">${Object.entries(S.WEEKS).map(([k, w]) => `<option value="${k}" ${cal.week === k ? 'selected' : ''}>${w.label}</option>`).join('')}</select></label>
          <label class="fld check"><input type="checkbox" id="i-ksa" data-cal="ksaHolidays" ${cal.ksaHolidays !== false ? 'checked' : ''}> <span>Apply KSA public holidays (Founding Day, both Eids, National Day)</span></label>
          <label class="fld wide"><span>Additional non-working days (YYYY-MM-DD, comma-separated)</span><input type="text" id="i-hol" data-cal="holidays" value="${esc((cal.holidays || []).join(', '))}"></label>
        </div></fieldset>
        <label class="fld wide"><span>Scope summary</span><textarea id="i-scope" data-info="scope" style="font-family:var(--f-body)">${esc(I.scope || '')}</textarea></label>
      </section>
      <section class="panel"><header><h3>Delay events record</h3><p>Contemporaneous records support Extension of Time entitlement and appear in the narrative.</p></header>
        <div class="tw"><table><thead><tr><th>Date</th><th>Event</th><th>Responsibility</th><th class="num">Est. impact (days)</th><th></th></tr></thead><tbody>
          ${(I.events || []).map((e, k) => `<tr><td class="date">${fmt(e.date)}</td><td>${esc(e.desc)}</td><td>${esc(e.party)}</td><td class="num">${esc(e.days ?? '')}</td><td><button class="btn sm" data-act="ev-del" data-k="${k}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="hint">No delay events recorded.</td></tr>'}
        </tbody></table></div>
        <div class="form">
          <label class="fld"><span>Date</span><input type="date" id="ev-date"></label>
          <label class="fld" style="grid-column: span 2"><span>Event description</span><input type="text" id="ev-desc" placeholder="e.g. Late approval of MEP shop drawings"></label>
          <label class="fld"><span>Responsibility</span><select id="ev-party"><option>Client / Engineer</option><option>Authority</option><option>Contractor</option><option>Subcontractor / Supplier</option><option>Neutral (force majeure)</option></select></label>
          <label class="fld"><span>Est. impact (days)</span><input type="number" id="ev-days" min="0"></label>
          <div class="fld" style="align-self:end"><button class="btn" data-act="ev-add">Add event</button></div>
        </div>
      </section>
      <section class="panel"><header><h3>Update history</h3></header>
        <div class="list">${(c.log || []).slice().reverse().slice(0, 12).map(l => `<div class="item"><span class="hint mono">${esc(ago(l.at))}</span><span class="d">${esc(l.text)}</span></div>`).join('') || '<p class="hint">No history yet.</p>'}</div>
        ${c.sample ? '' : `<div class="row">${state.confirmDelete ? `<span class="hint">Delete this project and its schedule for everyone?</span><button class="btn danger" data-act="delete-yes">Delete permanently</button><button class="btn" data-act="delete-no">Keep it</button>` : `<button class="btn danger" data-act="delete-ask">Delete project…</button>`}
          <button class="btn" data-act="export-json">Download backup (.json)</button></div>`}
      </section>`;
  }

  function actRows() {
    const c = state.cur, A = state.A;
    const q = state.q.trim().toLowerCase();
    const issues = new Set(A ? A.miss.flatMap(x => x.ids).concat(A.d.rows.filter(x => x.pass === false).flatMap(x => x.items)) : []);
    return c.activities.map((a, i) => ({ a, i, r: A ? A.r.res[i] : null })).filter(({ a, r }) => {
      if (q && !(`${a.id} ${a.name} ${a.wbs} ${a.res}`.toLowerCase().includes(q))) return false;
      switch (state.filter) {
        case 'crit': return r && r.crit && r.st !== 'C';
        case 'near': return r && (r.crit || r.near) && r.st !== 'C';
        case 'ip': return r && r.st === 'IP';
        case 'ns': return r && r.st === 'NS';
        case 'issues': return issues.has(a.id);
        default: return true;
      }
    });
  }
  function vSchedule() {
    const c = state.cur, A = state.A;
    const rows = actRows();
    const filters = [['all', 'All'], ['crit', 'Critical'], ['near', 'Critical + near'], ['ip', 'In progress'], ['ns', 'Not started'], ['issues', 'With issues']];
    return projectBar() + `
      <section class="panel"><header><div><h3>Import schedule</h3><p>Primavera P6 (.xer), MS Project (.xml) or Excel saved as CSV. Importing replaces the current activity list.</p></div>
        <button class="btn" data-act="template">Download CSV template</button></header>
        <div class="drop" id="drop"><strong>Drop the schedule file here</strong><span class="hint">or</span>
          <div class="row"><label class="btn pri" for="schedIn">Choose file…</label><input type="file" id="schedIn" accept=".xer,.xml,.csv,.txt,.tsv" hidden>
          <button class="btn" data-act="paste-toggle">Paste from Excel</button></div>
          <div id="pasteBox" hidden style="width:100%;display:grid;gap:8px"><textarea id="pasteTxt" rows="6" placeholder="Copy the columns with headers from Excel (Activity ID, Activity Name, Original Duration, Predecessors, …) and paste here"></textarea><div><button class="btn pri" data-act="paste-import">Import pasted rows</button></div></div>
        </div>
        ${state.importMsg ? `<div class="notice">${esc(state.importMsg)}</div>` : ''}
        <p class="hint">Predecessor format: <span class="mono">A1010; A1020SS+5; A1030FF-2</span> (FS is assumed when no type is given). Durations are in working days and dates are YYYY-MM-DD or DD/MM/YYYY.</p>
      </section>
      <section class="panel"><header><div><h3>Activities</h3><p>${rows.length} of ${c.activities.length} shown${A ? ` · forecast finish ${fmt(A.r.finish)}` : ''}</p></div>
        <div class="row"><div class="seg" role="group" aria-label="View">${['table', 'gantt'].map(k => `<button data-act="sview" data-v="${k}" aria-pressed="${state.schedView === k}">${k === 'table' ? 'Table' : 'Gantt'}</button>`).join('')}</div>
        <button class="btn" data-act="act-new">Add activity</button><button class="btn" data-act="export-csv" ${c.activities.length ? '' : 'disabled'}>Download CSV</button></div></header>
        <div class="row"><input type="search" id="q" placeholder="Search ID, name, WBS, resource" value="${esc(state.q)}" style="max-width:320px">
          <div class="seg" role="group" aria-label="Filter">${filters.map(([k, l]) => `<button data-act="filter" data-v="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join('')}</div></div>
        ${!c.activities.length ? '<div class="empty"><h3>No activities yet</h3><p class="hint">Import a schedule file above or add activities one by one.</p></div>'
        : state.schedView === 'gantt' ? ganttBlock(c.activities, A.r, rows.map(x => x.i)) : `<div class="tw tall" id="actTable">${actTable(rows)}</div>`}
      </section>`;
  }
  function actTable(rows) {
    const lim = rows.slice(0, 800);
    return `<table><thead><tr><th>ID</th><th>Activity name</th><th>WBS</th><th class="num">OD</th><th class="num">RD</th><th class="num">%</th><th>Start</th><th>Finish</th><th>BL finish</th><th class="num">Var</th><th class="num">TF</th><th>Predecessors</th><th>Resource</th></tr></thead><tbody>
      ${lim.map(({ a, i, r }) => {
        const v = r && a.bf ? S.dn(r.finish) - S.dn(a.bf) : null;
        return `<tr class="click ${r && r.crit && r.st !== 'C' ? 'critrow' : r && r.near ? 'nearrow' : ''}" data-act="act-edit" data-i="${i}">
        <td><span class="idc">${esc(a.id)}</span></td><td>${esc(a.name)}${a.ms ? ' <span class="chip plain">MS</span>' : ''}</td><td class="hint">${esc(a.wbs)}</td>
        <td class="num">${a.dur ?? ''}</td><td class="num">${r ? r.rem : ''}</td><td class="num">${+a.pct || 0}</td>
        <td class="date">${r ? fmt(r.start) + (r.st !== 'NS' ? ' A' : '') : ''}</td><td class="date">${r ? fmt(r.finish) + (r.st === 'C' ? ' A' : '') : ''}</td><td class="date">${fmt(a.bf)}</td>
        <td class="num ${v > 0 ? 'neg' : ''}">${v == null ? '' : (v > 0 ? '+' : '') + v}</td><td class="num ${r && r.tf < 0 ? 'neg' : ''}">${r && r.tf != null ? r.tf : ''}</td>
        <td class="mono hint" style="font-size:.76rem">${esc(S.predStr(a.preds || []))}</td><td class="hint">${esc(a.res)}</td></tr>`;
      }).join('')}</tbody></table>${rows.length > 800 ? `<p class="hint" style="padding:8px">Showing the first 800 of ${rows.length}. Use search or filters to narrow down.</p>` : ''}`;
  }

  /* ---------- Gantt ---------- */
  function ganttBlock(acts, r, rowsIdx, ghost) {
    return `<div class="legend"><span><i style="background:var(--crit)"></i>Critical</span><span><i style="background:var(--warn)"></i>Near-critical (≤10 d)</span><span><i style="background:var(--bar)"></i>Other</span><span><i style="background:var(--done)"></i>Complete</span><span><i style="background:var(--bl);height:4px"></i>Baseline</span>${ghost ? '<span><i style="border:1px dashed var(--muted);background:none"></i>Current forecast before recovery</span>' : ''}<span><i style="background:var(--accent);height:2px"></i>Data date</span><span><i style="background:var(--crit);height:2px"></i>Contract finish</span></div>
      <div class="gantt">${gantt(acts, r, rowsIdx, ghost)}</div>`;
  }
  function gantt(acts, r, rowsIdx, ghost) {
    const rows = (rowsIdx || acts.map((_, i) => i)).slice(0, 1500);
    const dn = S.dn;
    let lo = Infinity, hi = -Infinity;
    const see = d => { if (d != null && isFinite(d)) { lo = Math.min(lo, d); hi = Math.max(hi, d); } };
    for (const i of rows) { see(dn(r.res[i].start)); see(dn(r.res[i].finish)); see(dn(acts[i].bs)); see(dn(acts[i].bf)); if (ghost) { see(dn(ghost.res[i].start)); see(dn(ghost.res[i].finish)); } }
    see(r.ddDay); if (r.cfDay != null) see(r.cfDay);
    if (!isFinite(lo)) return '<p class="hint" style="padding:12px">Nothing to draw.</p>';
    lo -= 10; hi += 20;
    const span = hi - lo, px = Math.max(0.9, Math.min(7, 1100 / span));
    const L = 300, top = 34, rh = 22, W = Math.ceil(L + span * px + 30), H = top + rows.length * rh + 10;
    const x = d => L + (d - lo) * px;
    const o = [`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gantt chart">`];
    // month ticks
    let d0 = new Date(lo * 864e5); d0 = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1));
    const step = px < 1.6 ? 3 : 1;
    for (let t = d0; t.getTime() / 864e5 < hi; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + step, 1))) {
      const xd = x(t.getTime() / 864e5);
      o.push(`<line class="tick" x1="${xd}" x2="${xd}" y1="${top - 8}" y2="${H}"/><text class="tickt" x="${xd + 3}" y="${top - 12}">${t.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`);
    }
    rows.forEach((i, k) => {
      const a = acts[i], q = r.res[i], y = top + k * rh;
      if (k % 2) o.push(`<rect class="zebra" x="0" y="${y}" width="${W}" height="${rh}"/>`);
      const nm = (a.name || '').length > 36 ? a.name.slice(0, 35) + '…' : (a.name || '');
      o.push(`<text class="lbl-id" x="8" y="${y + 15}">${esc(a.id)}</text><text x="74" y="${y + 15}">${esc(nm)}</text>`);
      const bs = dn(a.bs), bf = dn(a.bf);
      if (bs != null && bf != null) o.push(`<rect class="b-bl" x="${x(bs)}" y="${y + 16}" width="${Math.max(2, (bf - bs + 1) * px)}" height="3"/>`);
      if (ghost) { const g = ghost.res[i]; const gs = dn(g.start), gf = dn(g.finish); if (!a.ms) o.push(`<rect class="ghost" x="${x(gs)}" y="${y + 3}" width="${Math.max(2, (gf - gs + 1) * px)}" height="11" rx="2"/>`); }
      const s = dn(q.start), f = dn(q.finish);
      const cls = q.st === 'C' ? 'b-done' : q.crit ? 'b-crit' : q.near ? 'b-near' : 'b-norm';
      const tip = `<title>${esc(a.id)} ${esc(a.name)} | ${fmt(q.start)} → ${fmt(q.finish)}${q.tf != null ? ' | TF ' + q.tf : ''}</title>`;
      if (a.ms || (q.rem === 0 && q.st !== 'C' && !(+a.dur > 0))) { const cx = x(f) + px / 2; o.push(`<path class="${cls}" d="M${cx} ${y + 3} l6 6 l-6 6 l-6 -6 z">${tip}</path>`); }
      else o.push(`<rect class="${cls}" x="${x(s)}" y="${y + 4}" width="${Math.max(2, (f - s + 1) * px)}" height="10" rx="2">${tip}</rect>`);
    });
    o.push(`<line class="sep" x1="${L - 6}" x2="${L - 6}" y1="0" y2="${H}"/>`);
    o.push(`<line class="dd" x1="${x(r.ddDay)}" x2="${x(r.ddDay)}" y1="${top - 6}" y2="${H}"/><text class="ddt" x="${x(r.ddDay) + 3}" y="${top - 1}">DD</text>`);
    if (r.cfDay != null) o.push(`<line class="cf" x1="${x(r.cfDay + 1)}" x2="${x(r.cfDay + 1)}" y1="${top - 6}" y2="${H}"/><text class="cft" x="${x(r.cfDay + 1) + 3}" y="${top - 1}">Contract</text>`);
    o.push('</svg>');
    return o.join('');
  }

  function needSchedule() {
    return projectBar() + `<div class="empty"><h3>No schedule loaded</h3><p class="hint">Import the project schedule to run the review, recovery, risks and report.</p><a class="btn pri" href="#schedule">Go to Schedule</a></div>`;
  }

  function vReview() {
    if (!state.A) return needSchedule();
    const A = state.A, m = A.m, r = A.r, I = state.cur.info;
    const kpi = (l, v, s, cls) => `<div class="kpi ${cls || ''}"><span class="l">${l}</span><span class="v">${v}</span><span class="s">${s}</span></div>`;
    const grp = { Immediate: [], 'Short term': [], Continuous: [] };
    A.recs.forEach(x => (grp[x.priority] = grp[x.priority] || []).push(x));
    return projectBar() + `
      <section class="kpis">
        ${kpi('Forecast finish', fmt(r.finish), varTxt(r.varianceDays) + ' vs contract ' + fmt(I.contractFinish), r.varianceDays > 0 ? 'crit' : r.varianceDays != null ? 'ok' : '')}
        ${kpi('Total float', r.minTF + ' wd', 'on the critical path', r.minTF < 0 ? 'crit' : r.minTF < 10 ? 'warn' : 'ok')}
        ${kpi('SPI', n2(m.spi), `planned ${n1(m.planned)}% · actual ${n1(m.actual)}%`, m.spi == null ? '' : m.spi < 0.9 ? 'crit' : m.spi < 0.95 ? 'warn' : 'ok')}
        ${kpi('BEI', n2(m.bei), `${m.doneOfDue} of ${m.dueBL} due tasks done`, m.bei == null ? '' : m.bei < 0.95 ? 'warn' : 'ok')}
        ${kpi('CPLI', n2(m.cpli), 'target ≥ 0.95', m.cpli == null ? '' : m.cpli < 0.95 ? 'crit' : 'ok')}
        ${kpi('Schedule quality', A.quality + '/100', `DCMA ${A.d.score}% pass`, A.quality < 60 ? 'crit' : A.quality < 80 ? 'warn' : 'ok')}
        ${kpi('LD exposure', m.ldExposure ? (m.ldExposure / 1e6).toFixed(2) + 'M' : '—', I.ldRate ? 'SAR at ' + sar(I.ldRate) + '/day' : 'LD rate not set', m.ldExposure ? 'crit' : '')}
      </section>
      <section class="panel"><header><h3>Progress</h3><p>Planned (bar) against actual (line), weighted by ${state.cur.activities.some(a => +a.cost > 0) ? 'cost' : 'duration'}.</p></header>
        <div class="prog" role="img" aria-label="Planned ${n1(m.planned)} percent, actual ${n1(m.actual)} percent"><i class="p" style="width:${Math.min(100, m.planned || 0)}%"></i><i class="a" style="width:${Math.min(100, m.actual || 0)}%"></i></div>
        <div class="row hint"><span>Actual <b class="mono">${n1(m.actual)}%</b></span><span>Planned <b class="mono">${n1(m.planned)}%</b></span>${m.timeElapsed != null ? `<span>Time elapsed <b class="mono">${n1(m.timeElapsed)}%</b></span>` : ''}</div>
      </section>
      <section class="panel"><header><div><h3>DCMA 14-point assessment</h3><p>${A.d.rows.filter(x => x.pass === true).length} of ${A.d.rows.filter(x => x.pass !== null).length} applicable checks pass (${A.d.score}%). Total Tasks: <b class="mono">${A.d.totalTasks}</b> incomplete tasks, excluding completed tasks, milestones, LOE and summary activities. Relationships: <b class="mono">${A.d.totalRels}</b> links touching incomplete tasks. Units are working days.</p></div>
          <button class="btn" data-act="dcma-csv">Download DCMA results (CSV)</button></header>
        <div class="tw"><table><thead><tr><th class="num">#</th><th>Check</th><th>DCMA criterion</th><th class="num">Count</th><th class="num">Result</th><th>Threshold</th><th>Status</th><th>Why it matters / corrective action</th></tr></thead><tbody>
          ${A.d.rows.map(x => `<tr class="${x.pass === false ? 'critrow' : ''}"><td class="num">${x.code}</td><td><b>${esc(x.name)}</b></td><td class="hint" style="min-width:200px">${esc(x.metric)}<br><span style="font-size:.76rem">Base: ${esc(x.base)}</span></td><td class="num">${esc(x.count)}</td><td class="num"><b>${esc(x.value)}${x.value === '—' ? '' : x.unit}</b></td><td class="mono">${esc(x.threshold)}</td>
            <td>${x.pass == null ? '<span class="chip">N/A</span>' : x.pass ? '<span class="chip ok">Pass</span>' : '<span class="chip crit">Fail</span>'}</td>
            <td class="hint" style="min-width:260px">${esc(x.why)}${x.pass === false ? ' <b>' + esc(x.fix) + '</b>' : ''}${x.detail.length ? `<details><summary>${x.detail.length} ${x.code >= 2 && x.code <= 4 ? 'relationships' : 'items'}</summary><div class="tw" style="margin-top:6px"><table><tbody>${x.detail.slice(0, 300).map(i => `<tr><td><span class="idc">${esc(i.id)}</span></td><td>${esc(i.name)}</td><td class="mono" style="font-size:.76rem">${esc(i.note)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${A.d.msHard.length ? `<div class="notice">Outside the DCMA task count: ${A.d.msHard.length} milestone(s) carry hard constraints (${esc(A.d.msHard.map(i => i.id + ' ' + i.note).join(', '))}). Confirm they are contractual key dates.</div>` : ''}
        ${A.d.totalTasks === 0 ? '<div class="notice info">There are no incomplete tasks, so the percentage checks do not apply.</div>' : ''}
      </section>
      <section class="grid2">
        <div class="panel"><header><h3>Missing information</h3><p>${A.miss.length} gaps extracted</p></header>
          <div class="list">${A.miss.map(x => `<div class="item"><span class="chip ${x.severity === 'High' ? 'crit' : x.severity === 'Medium' ? 'warn' : ''}">${x.severity}</span><div><b>${esc(x.item)}</b> <span class="hint">· ${esc(x.area)}</span><div class="d">${esc(x.detail)}</div>${x.ids.length ? `<details><summary>Show activities</summary><div class="ids">${esc(x.ids.join(', '))}</div></details>` : ''}</div></div>`).join('') || '<p class="hint">No missing information detected.</p>'}
          ${A.miss.some(x => x.area === 'Project data') ? '<div><a class="btn sm" href="#project-data">Complete the project data</a></div>' : ''}</div></div>
        <div class="panel"><header><h3>Recommendations</h3><p>${A.recs.length} actions</p></header>
          ${Object.entries(grp).filter(([, v]) => v.length).map(([k, v]) => `<div><div class="eyebrow">${k}</div><div class="list">${v.map(x => `<div class="item"><span class="chip plain ${k === 'Immediate' ? 'crit' : k === 'Short term' ? 'warn' : ''}">${esc(x.area)}</span><span class="d">${esc(x.text)}</span></div>`).join('')}</div></div>`).join('')}
        </div>
      </section>
      <section class="panel"><header><h3>Critical path</h3><p>${A.r.critical.length} remaining activities at the lowest float (${r.minTF} wd)</p></header>
        ${ganttBlock(state.cur.activities, r, A.r.res.filter(x => (x.crit || x.near) && x.st !== 'C').sort((a, b) => a.es - b.es).map(x => x.i))}
      </section>`;
  }

  function vRecovery() {
    if (!state.A) return needSchedule();
    const R = getR(), I = state.cur.info, o = Object.assign({}, S.recoveryDefaults, state.rec);
    const sel = R.options.find(x => x.key === state.optKey) || R.recommended;
    const gap = R.base.finishDay - S.dn(R.target);
    const fld = (k, l, v, extra) => `<label class="fld"><span>${l}</span><input type="number" id="rs-${k}" data-rec="${k}" value="${v}" ${extra || 'min="0"'}></label>`;
    let diff = [];
    if (sel && sel.acts) diff = S.scheduleDiff(state.cur.activities, sel.acts, R.base, sel.r);
    return projectBar() + `
      <section class="panel"><header><div><h3>Recovery analysis</h3><p>Current forecast ${fmt(R.base.finish)} against target ${fmt(R.target)}: ${isNaN(gap) ? 'no target date' : gap > 0 ? `<b class="neg">${gap} calendar days to recover</b>` : `${-gap} days of margin`}.</p></div></header>
        <div class="form">
          <label class="fld"><span>Target completion date</span><input type="date" id="rs-target" data-rec="target" value="${esc(state.rec.target || I.contractFinish || '')}"></label>
          ${fld('maxCrashPct', 'Max compression per activity (%)', o.maxCrashPct, 'min="0" max="60"')}
          ${fld('overlapPct', 'Fast-track overlap (%)', o.overlapPct, 'min="0" max="80"')}
          ${fld('maxLinks', 'Max overlapped pairs', o.maxLinks)}
          ${fld('defaultCrashCost', 'Crash cost / day without cost data (SAR)', o.defaultCrashCost)}
          ${fld('overtimePremium', 'Overtime premium (fraction)', o.overtimePremium, 'min="0" max="2" step="0.05"')}
        </div>
        ${gap <= 0 && !state.rec.target ? '<div class="notice info">The current forecast meets the contract date. Set an earlier target date above to test acceleration scenarios.</div>' : ''}
      </section>
      <section class="panel"><header><h3>Available options</h3><p>Select an option to see its revised schedule.</p></header>
        ${optionChart(R)}
        <div class="opts" role="radiogroup" aria-label="Recovery options">${R.options.map(x => `
          <div class="opt" role="radio" tabindex="0" aria-checked="${x === sel}" data-act="opt" data-k="${x.key}"><span class="radio"></span>
            <div><span class="nm">${esc(x.name)}</span> ${x.recommended ? '<span class="chip acc">Recommended</span>' : ''} ${x.meets === true ? '<span class="chip ok">Meets target</span>' : x.meets === false ? '<span class="chip warn">Short of target</span>' : ''}<div class="ds">${esc(x.desc)}</div></div>
            <span class="chip ${x.risk === 'High' ? 'crit' : x.risk === 'Medium' ? 'warn' : 'ok'}">${x.risk} risk</span>
            <div class="stats"><span>Finish <b>${fmt(x.finish)}</b></span><span>Recovered <b>${x.recovered} d</b></span><span>Cost <b>${sar(x.cost)}</b></span><span>Savings <b>${sar(x.savings)}</b></span><span>Net <b class="${x.net < 0 ? 'neg' : ''}">${sar(x.net)}</b></span></div>
          </div>`).join('')}</div>
      </section>
      ${sel ? `<section class="panel"><header><div><h3>${esc(sel.name)}</h3><p>${esc(sel.desc)}</p></div>
        ${sel.acts ? `<div class="row"><button class="btn pri" data-act="adopt">Adopt as revised schedule</button><button class="btn" data-act="export-rev">Download revised schedule (CSV)</button></div>` : ''}</header>
        <ul class="hint" style="margin:0;padding-left:18px">${sel.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
        ${sel.key === 'eot' ? `<div class="list"><div class="item"><span class="chip plain">1</span><span class="d">Identify excusable events from the delay events record (${(I.events || []).length} recorded) and from the Engineer's instructions.</span></div>
          <div class="item"><span class="chip plain">2</span><span class="d">Prepare a Time Impact Analysis: insert fragnets into the last accepted programme and measure the effect on completion.</span></div>
          <div class="item"><span class="chip plain">3</span><span class="d">Serve the notice within 28 days of awareness (FIDIC 2017 Sub-Clause 20.2) and keep contemporaneous records.</span></div>
          <div class="item"><span class="chip plain">4</span><span class="d">Run mitigation in parallel with option D for contractor-risk delay, since concurrent delay may reduce entitlement.</span></div></div>` : ''}
        ${sel.log.length ? `<h4 class="eyebrow">Measures applied (${sel.log.length})</h4><div class="tw"><table><thead><tr><th>Activity</th><th>Measure</th><th>Change</th><th>Means</th></tr></thead><tbody>${sel.log.map(l => `<tr><td><span class="idc">${esc(l.id)}</span> ${esc(l.name || '')}</td><td>${esc(l.kind)}</td><td>${esc(l.change)}</td><td class="hint">${esc(l.how)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${sel.acts ? `<h4 class="eyebrow">Revised schedule: remaining work</h4>${ganttBlock(sel.acts, sel.r, sel.r.res.filter(x => x.st !== 'C').sort((a, b) => a.es - b.es).map(x => x.i), R.base)}
          <h4 class="eyebrow">Date changes (${diff.length})</h4><div class="tw tall"><table><thead><tr><th>Activity</th><th>Start before → after</th><th>Finish before → after</th><th class="num">Shift (d)</th><th class="num">RD before → after</th></tr></thead><tbody>
          ${diff.slice(0, 200).map(dd => `<tr class="${dd.crit ? 'critrow' : ''}"><td><span class="idc">${esc(dd.id)}</span> ${esc(dd.name)}</td><td class="date">${fmt(dd.oldStart)} → ${fmt(dd.newStart)}</td><td class="date">${fmt(dd.oldFinish)} → ${fmt(dd.newFinish)}</td><td class="num">${dd.shift > 0 ? '+' : ''}${dd.shift}</td><td class="num">${dd.oldRem} → ${dd.newRem}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">No date changes.</td></tr>'}</tbody></table></div>` : ''}
      </section>` : ''}
      ${(state.cur.revisions || []).length ? `<section class="panel"><header><h3>Adopted revisions</h3></header><div class="tw"><table><thead><tr><th>Rev.</th><th>Adopted</th><th>Option</th><th>Forecast before</th><th>Forecast after</th></tr></thead><tbody>${state.cur.revisions.map(v => `<tr><td class="mono">R${v.n}</td><td class="date">${esc(ago(v.at))}</td><td>${esc(v.option)}</td><td class="date">${fmt(v.before)}</td><td class="date">${fmt(v.after)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }
  function optionChart(R) {
    const items = R.options.filter(x => x.finish);
    const dn = S.dn, t = dn(R.target), cur = R.base.finishDay;
    const ds = items.map(x => dn(x.finish)).concat([cur]).concat(isNaN(t) || t == null ? [] : [t]);
    const lo = Math.min(...ds) - 7, hi = Math.max(...ds) + 7;
    const L = 190, W = 760, rh = 30, top = 26, H = top + items.length * rh + 14;
    const x = d => L + (d - lo) / (hi - lo) * (W - L - 24);
    const o = [`<div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" style="min-width:560px;max-width:${W}px" role="img" aria-label="Forecast finish by recovery option">`];
    const steps = 5;
    for (let k = 0; k <= steps; k++) { const d = Math.round(lo + (hi - lo) * k / steps); o.push(`<line class="ax" x1="${x(d)}" x2="${x(d)}" y1="${top - 6}" y2="${H - 8}"/><text x="${x(d)}" y="${top - 10}" text-anchor="middle">${esc(fmt(S.iso(d)).slice(0, 6))}</text>`); }
    if (t != null && !isNaN(t)) o.push(`<line class="tg" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 8}"/><text x="${x(t) + 4}" y="${H - 2}" style="fill:var(--crit)">target</text>`);
    o.push(`<line class="cur" x1="${x(cur)}" x2="${x(cur)}" y1="${top - 6}" y2="${H - 8}"/>`);
    items.forEach((it, k) => {
      const y = top + k * rh + rh / 2, f = dn(it.finish);
      o.push(`<text class="nm" x="0" y="${y + 4}">${esc(it.short)}</text>`);
      o.push(`<circle class="dot0" cx="${x(cur)}" cy="${y}" r="4"/>`);
      if (f !== cur) o.push(`<line class="stem" x1="${x(cur)}" x2="${x(f)}" y1="${y}" y2="${y}"/>`);
      o.push(`<circle class="dot ${it.meets === false ? 'miss' : ''}" cx="${x(f)}" cy="${y}" r="6"><title>${esc(it.name)}: ${fmt(it.finish)}</title></circle><text x="${x(f) + (f < cur ? -10 : 10)}" y="${y - 8}" text-anchor="${f < cur ? 'end' : 'start'}">${it.recovered ? '−' + it.recovered + ' d' : ''}</text>`);
    });
    o.push('</svg></div><p class="hint">Hollow dot: current forecast. Filled dot: forecast with the option (amber if it falls short of the target). Red line: target date.</p>');
    return o.join('');
  }

  function riskRegister() {
    const c = state.cur, A = state.A;
    const reg = c.risks || [];
    const byId = new Map(reg.map(x => [x.rid, x]));
    const auto = A ? A.rk.map(x => Object.assign({}, x, { auto: true, active: true }, pick(byId.get(x.rid)))) : [];
    const autoIds = new Set(auto.map(x => x.rid));
    const stale = reg.filter(x => !x.manual && !autoIds.has(x.rid) && x.title).map(x => Object.assign({}, x, { auto: true, active: false }));
    const manual = reg.filter(x => x.manual);
    return auto.concat(manual, stale);
  }
  function pick(o) { if (!o) return {}; const r = {}; for (const k of ['status', 'owner', 'notes']) if (o[k] != null) r[k] = o[k]; return r; }
  function vRisks() {
    if (!state.A) return needSchedule();
    const list = riskRegister();
    const open = list.filter(x => (x.status || 'Open') !== 'Closed' && x.active !== false);
    const cell = (p, i) => { const n = open.filter(x => x.prob === p && x.impact === i).length; const s = p * i; return `<div class="${s >= 15 ? 'h-h' : s >= 8 ? 'h-m' : 'h-l'} ${n ? 'has' : ''}" title="P${p} × I${i}">${n || ''}</div>`; };
    return projectBar() + `
      <section class="grid2">
        <div class="panel"><header><h3>Risk heat map</h3><p>${open.length} open risks</p></header>
          <div class="heat">${[5, 4, 3, 2, 1].map(p => `<div class="ax">P${p}</div>${[1, 2, 3, 4, 5].map(i => cell(p, i)).join('')}`).join('')}<div class="ax"></div>${[1, 2, 3, 4, 5].map(i => `<div class="ax">I${i}</div>`).join('')}</div>
          <p class="hint">Probability (P) against impact (I), each scored 1–5. Risks scoring 15 or more need a response owner this period.</p></div>
        <div class="panel"><header><h3>Add a risk</h3><p>Record risks the triggers cannot detect.</p></header>
          <div class="form">
            <label class="fld wide"><span>Risk title</span><input type="text" id="mr-title" placeholder="e.g. Saudization quota limits on specialist trades"></label>
            <label class="fld"><span>Category</span><select id="mr-cat">${['Time', 'Cost', 'Resources', 'Supply chain', 'External', 'HSE', 'Design', 'Commercial', 'Quality'].map(x => `<option>${x}</option>`).join('')}</select></label>
            <label class="fld"><span>Probability (1–5)</span><input type="number" id="mr-p" min="1" max="5" value="3"></label>
            <label class="fld"><span>Impact (1–5)</span><input type="number" id="mr-i" min="1" max="5" value="3"></label>
            <label class="fld"><span>Owner</span><input type="text" id="mr-owner"></label>
            <label class="fld wide"><span>Response / action</span><input type="text" id="mr-act"></label>
          </div><div><button class="btn pri" data-act="risk-add">Add to register</button></div></div>
      </section>
      <section class="panel"><header><div><h3>Risk register</h3><p>Risks marked "Auto" are raised by triggers on the current schedule. Edits to status, owner and notes are kept with the project.</p></div></header>
        <div class="tw"><table><thead><tr><th>ID</th><th>Risk & trigger</th><th class="num">P×I</th><th>Response</th><th>Owner</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${list.map(x => `<tr class="${x.score >= 15 && x.active !== false ? 'critrow' : x.score >= 8 ? 'nearrow' : ''}">
          <td><span class="idc">${esc(x.rid)}</span><br>${x.manual ? '<span class="chip plain">Manual</span>' : x.active === false ? '<span class="chip plain">No longer triggered</span>' : '<span class="chip plain acc">Auto</span>'}</td>
          <td style="min-width:260px"><b>${esc(x.title)}</b> <span class="hint">· ${esc(x.category)}</span>${x.trigger ? `<div class="hint">${esc(x.trigger)}</div>` : ''}${x.effect ? `<div class="hint"><i>Effect:</i> ${esc(x.effect)}</div>` : ''}${x.ids && x.ids.length ? `<details><summary>${x.ids.length} activities</summary><div class="ids">${esc(x.ids.join(', '))}</div></details>` : ''}</td>
          <td class="num"><span class="chip ${x.score >= 15 ? 'crit' : x.score >= 8 ? 'warn' : 'ok'}">${x.prob}×${x.impact}=${x.prob * x.impact}</span></td>
          <td style="min-width:200px"><b>${esc(x.response || '')}</b> <span class="hint">${esc(x.action || '')}</span></td>
          <td><input type="text" id="ro-${esc(x.rid)}" data-risk="${esc(x.rid)}" data-k="owner" value="${esc(x.owner || '')}" placeholder="${esc(state.cur.info.planner || 'Owner')}" style="min-width:120px"></td>
          <td><select id="rs-${esc(x.rid)}" data-risk="${esc(x.rid)}" data-k="status">${['Open', 'Mitigating', 'Accepted', 'Closed'].map(s => `<option ${(x.status || 'Open') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td><input type="text" id="rn-${esc(x.rid)}" data-risk="${esc(x.rid)}" data-k="notes" value="${esc(x.notes || '')}" style="min-width:140px"></td></tr>`).join('') || '<tr><td colspan="7" class="hint">No risks triggered.</td></tr>'}
        </tbody></table></div>
      </section>`;
  }

  function reportData() {
    const R = getR();
    const reg = riskRegister().filter(x => x.active !== false);
    return S.buildReport(state.cur.info, state.cur.activities, state.A, R, reg);
  }
  function vReport() {
    if (!state.A) return needSchedule();
    const rep = reportData();
    return projectBar() + `
      <section class="panel"><header><div><h3>Narrative report</h3><p>Generated from the current schedule, assessment, risk register and recommended recovery. Download it as HTML (opens in Word for editing) or copy the text into the company template.</p></div>
        <div class="row"><button class="btn pri" data-act="rep-html">Download report (.html)</button><button class="btn" data-act="rep-copy">Copy as text</button><button class="btn" data-act="export-csv">Schedule (CSV)</button></div></header>
      </section>
      <article class="report" id="reportBody">${rep.html}${eventsHtml()}</article>`;
  }
  function eventsHtml() {
    const ev = state.cur.info.events || [];
    if (!ev.length) return '';
    return `<section><h2>Annex A. Delay events record</h2><div class="tw"><table><thead><tr><th>Date</th><th>Event</th><th>Responsibility</th><th>Est. impact (days)</th></tr></thead><tbody>${ev.map(e => `<tr><td>${fmt(e.date)}</td><td>${esc(e.desc)}</td><td>${esc(e.party)}</td><td>${esc(e.days ?? '')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  /* ---------- overlay: activity editor ---------- */
  function openEditor(i) {
    const c = state.cur, isNew = i == null;
    const a = isNew ? { id: '', name: '', wbs: '', dur: 10, rem: null, pct: 0, as: '', af: '', bs: '', bf: '', res: '', cost: null, cons: '', consDate: '', ms: false, preds: [] } : c.activities[i];
    const f = (k, l, t, v, ex) => `<label class="fld"><span>${l}</span><input id="e-${k}" type="${t}" value="${esc(v ?? '')}" ${ex || ''}></label>`;
    $('#overlay').innerHTML = `<div class="ov" data-act="ov-close"><div class="box" role="dialog" aria-modal="true" aria-label="Edit activity">
      <h3>${isNew ? 'Add activity' : 'Edit activity ' + esc(a.id)}</h3>
      <div class="form">
        ${f('id', 'Activity ID', 'text', a.id)}${f('name', 'Activity name', 'text', a.name)}${f('wbs', 'WBS', 'text', a.wbs)}
        ${f('dur', 'Original duration (wd)', 'number', a.dur, 'min="0"')}${f('rem', 'Remaining duration (wd)', 'number', a.rem, 'min="0" placeholder="auto"')}${f('pct', '% complete', 'number', a.pct, 'min="0" max="100"')}
        ${f('as', 'Actual start', 'date', a.as)}${f('af', 'Actual finish', 'date', a.af)}${f('bs', 'Baseline start', 'date', a.bs)}${f('bf', 'Baseline finish', 'date', a.bf)}
        ${f('res', 'Resource / crew', 'text', a.res)}${f('cost', 'Budgeted cost (SAR)', 'number', a.cost, 'min="0"')}
        <label class="fld"><span>Constraint</span><select id="e-cons">${['', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'].map(x => `<option value="${x}" ${a.cons === x ? 'selected' : ''}>${x || 'None'}</option>`).join('')}</select></label>
        ${f('consDate', 'Constraint date', 'date', a.consDate)}
        <label class="fld check"><input type="checkbox" id="e-ms" ${a.ms ? 'checked' : ''}> <span>Milestone</span></label>
        <label class="fld wide"><span>Predecessors (e.g. A1010; A1020SS+5)</span><input id="e-preds" type="text" value="${esc(S.predStr(a.preds || []))}"></label>
      </div>
      <div class="notice" id="e-err" hidden></div>
      <div class="row"><button class="btn pri" data-act="ed-save" data-i="${isNew ? '' : i}">${isNew ? 'Add activity' : 'Apply changes'}</button><button class="btn" data-act="ov-close">Cancel</button>
        ${isNew ? '' : `<span style="flex:1"></span><button class="btn danger" data-act="ed-del" data-i="${i}">Delete activity</button>`}</div>
    </div></div>`;
    $('#e-id').focus();
  }
  function closeOverlay() { $('#overlay').innerHTML = ''; }
  function saveEditor(iStr) {
    const c = state.cur, isNew = iStr === '';
    const v = k => $('#e-' + k).value.trim();
    const numOrNull = k => v(k) === '' ? null : +v(k);
    const a = { id: v('id'), name: v('name'), wbs: v('wbs'), dur: numOrNull('dur'), rem: numOrNull('rem'), pct: +v('pct') || 0, as: v('as'), af: v('af'), bs: v('bs'), bf: v('bf'),
      res: v('res'), cost: numOrNull('cost'), cons: $('#e-cons').value, consDate: v('consDate'), ms: $('#e-ms').checked, preds: S.parsePreds(v('preds')) };
    const err = m => { const e = $('#e-err'); e.textContent = m; e.hidden = false; };
    if (!a.id) return err('Enter an activity ID.');
    if (c.activities.some((x, k) => x.id === a.id && String(k) !== iStr)) return err('Activity ID ' + a.id + ' is already used.');
    const unknown = a.preds.filter(p => !c.activities.some(x => x.id === p.id));
    if (unknown.length) return err('Unknown predecessor: ' + unknown.map(p => p.id).join(', '));
    if (isNew) c.activities.push(a);
    else {
      const old = c.activities[+iStr].id;
      c.activities[+iStr] = a;
      if (old !== a.id) c.activities.forEach(x => (x.preds || []).forEach(p => { if (p.id === old) p.id = a.id; }));
    }
    markDirty(); recalc(); closeOverlay(); render();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'ov-close' && e.target !== t && t.classList.contains('ov')) return; // clicks inside the dialog box
    switch (act) {
      case 'open': openProject(t.dataset.id); break;
      case 'new': state.cur = blankProject(); state.dirty = true; state.A = null; state.R = null; go('project-data'); break;
      case 'save': saveProject(); break;
      case 'delete-ask': state.confirmDelete = true; render(); break;
      case 'delete-no': state.confirmDelete = false; render(); break;
      case 'delete-yes': deleteProject(); break;
      case 'ev-add': {
        const desc = $('#ev-desc').value.trim(); if (!desc) { toast('Describe the delay event first.'); return; }
        state.cur.info.events.push({ date: $('#ev-date').value, desc, party: $('#ev-party').value, days: $('#ev-days').value === '' ? null : +$('#ev-days').value });
        addLog('Delay event recorded: ' + desc); markDirty(); render(); break;
      }
      case 'ev-del': state.cur.info.events.splice(+t.dataset.k, 1); markDirty(); render(); break;
      case 'template': saveFile('SANS_schedule_template.csv', TEMPLATE); break;
      case 'paste-toggle': { const b = $('#pasteBox'); b.hidden = !b.hidden; if (!b.hidden) $('#pasteTxt').focus(); break; }
      case 'paste-import': try { applyImport(S.fromCSV($('#pasteTxt').value), 'pasted rows'); } catch (err) { state.importMsg = err.message; render(); } break;
      case 'sview': state.schedView = t.dataset.v; pref.set('schedView', state.schedView); render(); break;
      case 'filter': state.filter = t.dataset.v; render(); break;
      case 'act-new': openEditor(null); break;
      case 'act-edit': openEditor(+t.dataset.i); break;
      case 'ov-close': closeOverlay(); break;
      case 'ed-save': saveEditor(t.dataset.i); break;
      case 'ed-del': {
        const i = +t.dataset.i, id = state.cur.activities[i].id;
        state.cur.activities.splice(i, 1);
        state.cur.activities.forEach(x => x.preds = (x.preds || []).filter(p => p.id !== id));
        markDirty(); recalc(); closeOverlay(); render(); break;
      }
      case 'export-csv': saveFile(`${state.cur.info.code || 'schedule'}_schedule_${state.cur.info.dataDate || ''}.csv`, S.toCSV(state.cur.activities, state.A && state.A.r)); break;
      case 'export-json': saveFile(`${state.cur.info.code || 'project'}_backup.json`, JSON.stringify(Object.assign({ format: 'sans-schedule-control/1' }, state.cur), null, 1)); break;
      case 'dcma-csv': {
        const q = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
        const lines = [['Check #', 'Check', 'DCMA criterion', 'Base', 'Count', 'Result', 'Threshold', 'Status', 'Activity ID', 'Activity name', 'Finding'].join(',')];
        state.A.d.rows.forEach(x => {
          const head = [x.code, x.name, x.metric, x.base, x.count, x.value === '—' ? '—' : x.value + x.unit, x.threshold, x.pass == null ? 'N/A' : x.pass ? 'Pass' : 'Fail'];
          if (!x.detail.length) lines.push(head.concat(['', '', '']).map(q).join(','));
          x.detail.forEach(i => lines.push(head.concat([i.id, i.name, i.note]).map(q).join(',')));
        });
        saveFile(`${state.cur.info.code || 'project'}_DCMA14_${state.cur.info.dataDate || ''}.csv`, lines.join('\r\n')); break;
      }
      case 'opt': state.optKey = t.dataset.k; render(); break;
      case 'adopt': {
        const R = getR(), sel = R.options.find(x => x.key === state.optKey);
        if (!sel || !sel.acts) return;
        const c = state.cur;
        c.revisions = c.revisions || [];
        const n = c.revisions.length + 1;
        c.revisions.push({ n, at: new Date().toISOString(), option: sel.name, before: R.base.finish, after: sel.finish });
        c.activities = S.cloneActs(sel.acts);
        if (sel.calendar) c.info.calendar = Object.assign({}, sel.calendar);
        addLog(`Revised schedule R${n} adopted (${sel.name}): forecast ${R.base.finish} → ${sel.finish}.`);
        markDirty(); recalc(); toast(`Revision R${n} adopted. Save the project to keep it.`); go('review'); break;
      }
      case 'export-rev': {
        const R = getR(), sel = R.options.find(x => x.key === state.optKey);
        if (sel && sel.acts) saveFile(`${state.cur.info.code || 'schedule'}_revised_${sel.key}.csv`, S.toCSV(sel.acts, sel.r)); break;
      }
      case 'risk-add': {
        const title = $('#mr-title').value.trim(); if (!title) { toast('Enter a risk title.'); return; }
        const c = state.cur; c.risks = c.risks || [];
        const n = c.risks.filter(x => x.manual).length + 1;
        c.risks.push({ rid: 'M' + String(n).padStart(2, '0'), manual: true, title, category: $('#mr-cat').value, prob: Math.min(5, Math.max(1, +$('#mr-p').value || 3)), impact: Math.min(5, Math.max(1, +$('#mr-i').value || 3)),
          owner: $('#mr-owner').value.trim(), action: $('#mr-act').value.trim(), response: 'Mitigate', status: 'Open', trigger: '', ids: [] });
        c.risks.forEach(x => { if (x.manual) x.score = x.prob * x.impact; });
        markDirty(); render(); break;
      }
      case 'rep-html': { const rep = reportData(); saveFile(`${state.cur.info.code || 'project'}_schedule_narrative_${state.cur.info.dataDate || ''}.html`, S.reportStandalone(rep.html + eventsHtml(), `${state.cur.info.code} Schedule Narrative`)); break; }
      case 'rep-copy': {
        const rep = reportData(); const txt = S.reportText(rep.sections);
        const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#reportBody')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Text selected. Press Ctrl+C to copy.'); };
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Report copied to the clipboard.'), fallback); else fallback();
        break;
      }
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#overlay').innerHTML) closeOverlay();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.opt')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'projSel') { if (t.value) openProject(t.value); else { go('portfolio'); } return; }
    if (t.id === 'schedIn' && t.files[0]) { importScheduleFile(t.files[0]); return; }
    if (t.id === 'jsonIn' && t.files[0]) {
      try {
        const p = JSON.parse(await readFile(t.files[0]));
        if (!p.info || !Array.isArray(p.activities)) throw new Error('This is not a SANS Schedule Control backup file.');
        delete p.format; if (state.projects.some(x => x.id === p.id)) p.id = newId();
        state.cur = p; state.cur.info.events = p.info.events || []; state.dirty = true; recalc();
        toast('Backup loaded. Save the project to add it to the register.'); go('review');
      } catch (err) { toast(err.message); }
      return;
    }
    const c = state.cur; if (!c) return;
    if (t.dataset.info) {
      const k = t.dataset.info, numeric = t.type === 'number';
      c.info[k] = numeric ? (t.value === '' ? null : +t.value) : t.value;
      markDirty(); recalc(); renderChrome(); refreshBar(); return;
    }
    if (t.dataset.cal) {
      const k = t.dataset.cal;
      c.info.calendar[k] = k === 'ksaHolidays' ? t.checked : k === 'holidays' ? t.value.split(/[,;\s]+/).map(S.parseDate).filter(Boolean) : t.value;
      markDirty(); recalc(); refreshBar(); return;
    }
    if (t.dataset.rec) {
      const k = t.dataset.rec;
      if (k === 'target') { if (t.value) state.rec.target = t.value; else delete state.rec.target; }
      else if (t.value !== '') state.rec[k] = +t.value;
      state.R = null; state.optKey = null; render(); return;
    }
    if (t.dataset.risk) {
      const rid = t.dataset.risk, k = t.dataset.k;
      c.risks = c.risks || [];
      let x = c.risks.find(r => r.rid === rid);
      if (!x) { const auto = state.A.rk.find(r => r.rid === rid); x = { rid, title: auto ? auto.title : rid, category: auto ? auto.category : '', prob: auto ? auto.prob : 3, impact: auto ? auto.impact : 3 }; c.risks.push(x); }
      x[k] = t.value; markDirty(); refreshBar(); return;
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') { state.q = e.target.value; const tb = $('#actTable'); if (tb) tb.innerHTML = actTable(actRows()); }
  });
  function refreshBar() { const old = $('.pbar'); if (old && state.cur) { const tmp = document.createElement('div'); tmp.innerHTML = projectBar(); old.replaceWith(tmp.firstElementChild); } }
  function afterRender() {
    const d = $('#drop');
    if (d) {
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importScheduleFile(f); });
    }
  }
  window.addEventListener('beforeunload', e => { if (state.dirty && state.cur && !state.cur.sample) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', route);

  /* ---------- boot ---------- */
  state.schedView = pref.get('schedView', 'table');
  state.projects = Local.list();
  if (!window.claude) {
    const want = pref.get('project', null);
    if (want && (want === 'sample' || state.projects.some(p => p.id === want))) openProject(want, true).then(route); else route();
  } else route();
  initCapabilities();
})();
