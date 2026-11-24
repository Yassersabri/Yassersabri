/* SANS Schedule Control — scheduling engine
 * Dates, Saudi work calendars, Critical Path Method (forward/backward pass with
 * progress and constraints), and schedule importers (CSV, Primavera XER, MS Project XML).
 * Works in the browser (window.SANS) and in Node (module.exports) for testing.
 */
(function (root) {
  'use strict';
  const SANS = root.SANS = root.SANS || {};

  /* ---------- Dates ---------- */
  const DAY = 864e5;
  function dn(iso) {               // ISO date -> integer day number (UTC)
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  }
  function iso(d) {                // day number -> ISO date
    if (d == null || !isFinite(d)) return '';
    return new Date(d * DAY).toISOString().slice(0, 10);
  }
  function weekday(d) { return new Date(d * DAY).getUTCDay(); } // 0 Sun .. 6 Sat
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDate(v) {          // flexible date parser -> ISO or ''
    if (v == null) return '';
    let s = String(v).trim();
    if (!s) return '';
    s = s.replace(/\s*[AP*]\s*$/i, '').trim(); // P6 exports append "A" for actuals
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return iso(dn(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`));
    if ((m = /^(\d{1,2})[-/.\s]([A-Za-z]{3})[A-Za-z]*[-/.\s](\d{2,4})/.exec(s))) {
      const mo = MON[m[2].toLowerCase()]; if (!mo) return '';
      let y = +m[3]; if (y < 100) y += 2000;
      return iso(dn(`${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`));
    }
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) { // dd/mm/yyyy (Saudi / UK convention)
      let y = +m[3]; if (y < 100) y += 2000;
      let d = +m[1], mo = +m[2];
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      return iso(dn(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`));
    }
    const t = Date.parse(s);
    return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
  }

  /* ---------- Saudi calendar data ---------- */
  // Official public holidays (approximate Hijri-based dates; verify against the Umm al-Qura calendar each year).
  const KSA_HOLIDAYS = [
    // Founding Day (22 Feb) and National Day (23 Sep)
    ...[2024, 2025, 2026, 2027, 2028, 2029, 2030].flatMap(y => [[`${y}-02-22`, 1, 'Founding Day'], [`${y}-09-23`, 1, 'National Day']]),
    ['2024-04-09', 6, 'Eid al-Fitr'], ['2024-06-15', 6, 'Eid al-Adha'],
    ['2025-03-29', 6, 'Eid al-Fitr'], ['2025-06-05', 6, 'Eid al-Adha'],
    ['2026-03-19', 6, 'Eid al-Fitr'], ['2026-05-26', 6, 'Eid al-Adha'],
    ['2027-03-09', 6, 'Eid al-Fitr'], ['2027-05-15', 6, 'Eid al-Adha'],
    ['2028-02-26', 6, 'Eid al-Fitr'], ['2028-05-04', 6, 'Eid al-Adha'],
    ['2029-02-14', 6, 'Eid al-Fitr'], ['2029-04-23', 6, 'Eid al-Adha'],
    ['2030-02-04', 6, 'Eid al-Fitr'], ['2030-04-13', 6, 'Eid al-Adha'],
  ];
  const RAMADAN = [ // approximate start / end
    ['2024-03-11', '2024-04-09'], ['2025-03-01', '2025-03-29'], ['2026-02-18', '2026-03-19'],
    ['2027-02-08', '2027-03-09'], ['2028-01-28', '2028-02-26'], ['2029-01-16', '2029-02-14'], ['2030-01-06', '2030-02-04'],
  ];
  // Summer midday outdoor-work ban (Ministry of Human Resources): 15 Jun – 15 Sep, 12:00–15:00
  function inSummerBan(d) { const s = iso(d).slice(5); return s >= '06-15' && s <= '09-15'; }
  function inRamadan(d) { return RAMADAN.some(([a, b]) => d >= dn(a) && d <= dn(b)); }

  const WEEKS = { // index 0 = Sunday
    '5d': { label: '5-day week (Sun–Thu)', days: [1, 1, 1, 1, 1, 0, 0] },
    '6d': { label: '6-day week (Sat–Thu)', days: [1, 1, 1, 1, 1, 0, 1] },
    '7d': { label: '7-day week', days: [1, 1, 1, 1, 1, 1, 1] },
  };

  function holidaySet(useKsa, extra) {
    const s = new Set();
    if (useKsa) for (const [d, n] of KSA_HOLIDAYS) for (let i = 0; i < n; i++) s.add(dn(d) + i);
    for (const h of (extra || [])) { const d = dn(parseDate(h)); if (d != null) s.add(d); }
    return s;
  }

  // Work calendar: maps day numbers <-> working-day indexes
  function makeCalendar(opts) {
    const week = (WEEKS[opts.week] || WEEKS['6d']).days;
    const hol = opts.holidaySet || holidaySet(opts.ksaHolidays !== false, opts.holidays);
    const from = opts.from, to = opts.to;
    const days = [];
    for (let d = from; d <= to; d++) if (week[weekday(d)] && !hol.has(d)) days.push(d);
    function ceilIdx(d) { // first working day on/after d
      let lo = 0, hi = days.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (days[mid] < d) lo = mid + 1; else hi = mid; }
      return lo;
    }
    function floorIdx(d) { return ceilIdx(d + 1) - 1; } // last working day on/before d
    function date(i) { return days[Math.max(0, Math.min(days.length - 1, i))]; }
    return { days, ceilIdx, floorIdx, date, from, to, week: opts.week };
  }

  /* ---------- Activity helpers ---------- */
  function status(a) {
    if (a.af || (+a.pct >= 100)) return 'C';
    if (a.as || +a.pct > 0) return 'IP';
    return 'NS';
  }
  function remDur(a) {
    const st = status(a);
    if (st === 'C') return 0;
    if (a.rem != null && a.rem !== '' && isFinite(+a.rem)) return Math.max(0, Math.round(+a.rem));
    const d = +a.dur || 0;
    return Math.max(0, Math.round(d * (1 - (+a.pct || 0) / 100)));
  }
  const HARD = new Set(['MSO', 'MFO', 'SNLT', 'FNLT']);

  /* ---------- Critical Path Method ---------- */
  // project: {start, dataDate, contractFinish, calendar:{week, ksaHolidays, holidays}}
  // activities: [{id,name,wbs,dur,rem,pct,as,af,bs,bf,res,cost,cons,consDate,ms,preds:[{id,t,lag}]}]
  function cpm(project, activities, override) {
    const ov = override || {};
    const acts = activities;
    const byId = new Map();
    acts.forEach((a, i) => byId.set(String(a.id), i));
    // calendar range
    let lo = Infinity, hi = -Infinity;
    const consider = d => { if (d != null) { if (d < lo) lo = d; if (d > hi) hi = d; } };
    consider(dn(project.start)); consider(dn(project.dataDate)); consider(dn(project.contractFinish));
    for (const a of acts) { consider(dn(a.as)); consider(dn(a.af)); consider(dn(a.bs)); consider(dn(a.bf)); }
    if (!isFinite(lo)) lo = dn(new Date().toISOString().slice(0, 10));
    if (!isFinite(hi)) hi = lo;
    const totalDur = acts.reduce((s, a) => s + (+a.dur || 0) + Math.abs(+a.rem || 0), 0);
    const calOpts = Object.assign({}, project.calendar || {}, ov.calendar || {});
    const cal = makeCalendar({ week: calOpts.week || '6d', ksaHolidays: calOpts.ksaHolidays !== false, holidays: calOpts.holidays, from: lo - 400, to: hi + Math.max(3650, Math.ceil(totalDur * 1.6)) });

    const n = acts.length;
    const succ = Array.from({ length: n }, () => []);
    const pred = Array.from({ length: n }, () => []);
    const badLinks = [];
    acts.forEach((a, i) => {
      for (const p of (a.preds || [])) {
        const j = byId.get(String(p.id));
        if (j == null || j === i) { badLinks.push({ act: a.id, pred: p.id }); continue; }
        const rel = { from: j, to: i, t: (p.t || 'FS').toUpperCase(), lag: Math.round(+p.lag || 0) };
        succ[j].push(rel); pred[i].push(rel);
      }
    });
    // topological order (Kahn); loops appended and reported
    const indeg = pred.map(p => p.length);
    const q = []; indeg.forEach((d, i) => { if (!d) q.push(i); });
    const order = [];
    while (q.length) { const i = q.shift(); order.push(i); for (const r of succ[i]) if (--indeg[r.to] === 0) q.push(r.to); }
    const loops = [];
    if (order.length < n) { const seen = new Set(order); for (let i = 0; i < n; i++) if (!seen.has(i)) { loops.push(acts[i].id); order.push(i); } }

    const ddDay = dn(project.dataDate) ?? dn(project.start) ?? lo;
    const dd = cal.ceilIdx(ddDay);
    const startIdx = cal.ceilIdx(dn(project.start) ?? ddDay);
    const ES = new Array(n), EF = new Array(n), LS = new Array(n), LF = new Array(n), D = new Array(n), ST = new Array(n);
    for (let i = 0; i < n; i++) { ST[i] = status(acts[i]); D[i] = acts[i].ms ? 0 : remDur(acts[i]); }

    // forward pass
    for (const i of order) {
      const a = acts[i];
      if (ST[i] === 'C') {
        const s = dn(a.as) ?? dn(a.af) ?? dn(a.bs);
        const f = dn(a.af) ?? dn(a.bf);
        ES[i] = s != null ? cal.ceilIdx(s) : dd;
        EF[i] = f != null ? cal.floorIdx(f) + 1 : ES[i] + (+a.dur || 0);
        if (a.ms) EF[i] = ES[i];
        continue;
      }
      let es = ST[i] === 'IP' ? (dn(a.as) != null ? cal.ceilIdx(dn(a.as)) : dd) : Math.max(dd, startIdx);
      let efMin = -Infinity;
      for (const r of pred[i]) {
        const p = r.from;
        if (ES[p] == null) continue; // loop member
        if (ST[i] === 'IP') { // in-progress: logic only constrains the remaining finish
          if (r.t === 'FS' || r.t === 'FF') efMin = Math.max(efMin, EF[p] + r.lag + (r.t === 'FS' ? D[i] : 0));
          continue;
        }
        if (r.t === 'FS') es = Math.max(es, EF[p] + r.lag);
        else if (r.t === 'SS') es = Math.max(es, ES[p] + r.lag);
        else if (r.t === 'FF') es = Math.max(es, EF[p] + r.lag - D[i]);
        else if (r.t === 'SF') es = Math.max(es, ES[p] + r.lag - D[i]);
      }
      const cd = dn(a.consDate);
      if (ST[i] === 'NS' && cd != null) {
        if (a.cons === 'SNET') es = Math.max(es, cal.ceilIdx(cd));
        if (a.cons === 'MSO') es = cal.ceilIdx(cd);
        if (a.cons === 'FNET') es = Math.max(es, cal.floorIdx(cd) + 1 - D[i]);
        if (a.cons === 'MFO') es = cal.floorIdx(cd) + 1 - D[i];
      }
      ES[i] = es;
      EF[i] = ST[i] === 'IP' ? Math.max(dd + D[i], efMin) : es + D[i];
    }
    let maxEF = -Infinity; for (let i = 0; i < n; i++) if (EF[i] > maxEF) maxEF = EF[i];
    if (!isFinite(maxEF)) maxEF = dd;
    const cfDay = dn(project.contractFinish);
    const term = cfDay != null ? cal.floorIdx(cfDay) + 1 : maxEF;

    // backward pass
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (ST[i] === 'C') { LS[i] = ES[i]; LF[i] = EF[i]; continue; }
      let lf = term;
      for (const r of succ[i]) {
        const s = r.to;
        if (ST[s] === 'C' || LS[s] == null) continue;
        if (ST[s] === 'IP' && (r.t === 'SS' || r.t === 'SF')) continue;
        if (r.t === 'FS') lf = Math.min(lf, (ST[s] === 'IP' ? LF[s] - D[s] : LS[s]) - r.lag);
        else if (r.t === 'SS') lf = Math.min(lf, LS[s] - r.lag + D[i]);
        else if (r.t === 'FF') lf = Math.min(lf, LF[s] - r.lag);
        else if (r.t === 'SF') lf = Math.min(lf, LF[s] - r.lag + D[i]);
      }
      const a = acts[i], cd = dn(a.consDate);
      if (cd != null) {
        if (a.cons === 'FNLT' || a.cons === 'MFO') lf = Math.min(lf, cal.floorIdx(cd) + 1);
        if (a.cons === 'SNLT' || a.cons === 'MSO') lf = Math.min(lf, cal.ceilIdx(cd) + D[i]);
      }
      LF[i] = lf; LS[i] = lf - D[i];
    }

    // results
    let minTF = Infinity;
    const res = acts.map((a, i) => {
      const tf = ST[i] === 'C' ? null : LF[i] - EF[i];
      if (tf != null && tf < minTF) minTF = tf;
      const startD = cal.date(ES[i]);
      const finD = (a.ms || D[i] === 0) && ST[i] !== 'C' ? (pred[i].length ? cal.date(EF[i] - 1) : cal.date(ES[i])) : cal.date(Math.max(ES[i], EF[i] - 1));
      return {
        i, id: a.id, st: ST[i], es: ES[i], ef: EF[i], ls: LS[i], lf: LF[i], tf, rem: D[i],
        start: ST[i] !== 'NS' && a.as ? a.as : ((a.ms || D[i] === 0) && ST[i] !== 'C' ? iso(finD) : iso(startD)),
        finish: ST[i] === 'C' && a.af ? a.af : iso(finD),
        npred: pred[i].length, nsucc: succ[i].length,
      };
    });
    if (!isFinite(minTF)) minTF = 0;
    const NEAR = ov.nearCritical ?? 10;
    let finishDay = -Infinity;
    for (const r of res) {
      r.crit = r.tf != null && r.tf <= minTF;
      r.near = r.tf != null && !r.crit && r.tf <= minTF + NEAR;
      const f = dn(r.finish); if (f > finishDay) finishDay = f;
    }
    // driving critical path chain (from project finish backwards)
    return {
      cal, acts, res, succ, pred, order, loops, badLinks, dd, ddDay, minTF,
      finish: iso(finishDay), finishDay, maxEF, term,
      cfDay, varianceDays: cfDay != null ? finishDay - cfDay : null,
      critical: res.filter(r => r.crit && r.st !== 'C'),
    };
  }

  /* ---------- Importers ---------- */
  const ALIASES = {
    id: ['activity id', 'activity_id', 'task_code', 'id', 'act id', 'code', 'unique id', 'task id'],
    name: ['activity name', 'name', 'task name', 'description', 'task_name', 'activity description'],
    wbs: ['wbs', 'wbs code', 'wbs name', 'wbs_id', 'area', 'outline number'],
    dur: ['original duration', 'duration', 'orig dur', 'od', 'planned duration', 'baseline duration', 'dur'],
    rem: ['remaining duration', 'rem dur', 'rd', 'remaining'],
    pct: ['% complete', 'percent complete', 'pct', 'activity % complete', 'physical % complete', 'progress', '%'],
    as: ['actual start', 'act start', 'actual_start', 'as'],
    af: ['actual finish', 'act finish', 'actual_finish', 'af'],
    bs: ['baseline start', 'bl start', 'bl project start', 'baseline_start', 'planned start', 'bs'],
    bf: ['baseline finish', 'bl finish', 'bl project finish', 'baseline_finish', 'planned finish', 'bf'],
    res: ['resources', 'resource', 'resource names', 'resource name', 'crew', 'trade'],
    cost: ['cost', 'budgeted total cost', 'budget', 'planned cost', 'baseline cost', 'value'],
    cons: ['constraint', 'primary constraint', 'constraint type'],
    consDate: ['constraint date', 'primary constraint date'],
    preds: ['predecessors', 'predecessor', 'preds', 'logic', 'predecessor details'],
    ms: ['milestone', 'is milestone', 'type', 'activity type'],
  };
  function splitCSV(text) {
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t'
      : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  function parsePreds(s) {
    if (!s) return [];
    return String(s).split(/[,;|]+/).map(x => x.trim()).filter(Boolean).map(x => {
      const m = /^(.+?)\s*[:\s]?\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*(d|days?|w|wk|wks|weeks?)?$/i.exec(x);
      if (!m) return { id: x, t: 'FS', lag: 0 };
      let lag = m[3] ? +m[3].replace(/\s/g, '') : 0;
      if (m[4] && /^w/i.test(m[4])) lag *= 5;
      return { id: m[1].trim(), t: (m[2] || 'FS').toUpperCase(), lag: Math.round(lag) };
    });
  }
  function num(v) { if (v == null || v === '') return null; const x = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isFinite(x) ? x : null; }
  function normCons(s) {
    if (!s) return '';
    const t = String(s).toLowerCase();
    if (/mandatory start|must start on|^mso|start on$/.test(t) || t === 'mso') return 'MSO';
    if (/mandatory finish|must finish on|^mfo|finish on$/.test(t) || t === 'mfo') return 'MFO';
    if (/start on or after|start no earlier|snet/.test(t)) return 'SNET';
    if (/start on or before|start no later|snlt/.test(t)) return 'SNLT';
    if (/finish on or after|finish no earlier|fnet/.test(t)) return 'FNET';
    if (/finish on or before|finish no later|fnlt/.test(t)) return 'FNLT';
    return '';
  }
  function fromCSV(text) {
    const rows = splitCSV(text);
    if (rows.length < 2) throw new Error('The file needs a header row and at least one activity row.');
    const head = rows[0].map(h => String(h).trim().toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim());
    const col = {};
    for (const [k, al] of Object.entries(ALIASES)) {
      const ix = head.findIndex(h => al.includes(h));
      if (ix >= 0) col[k] = ix;
    }
    if (col.id == null) throw new Error('Could not find an "Activity ID" column. Rename the ID column to "Activity ID" and import again.');
    const get = (r, k) => col[k] != null ? r[col[k]] : '';
    const acts = rows.slice(1).map(r => {
      const durS = String(get(r, 'dur') || '');
      let dur = num(durS);
      if (/w/i.test(durS) && dur != null) dur *= 5;
      if (/h/i.test(durS) && dur != null) dur = dur / 8;
      const msRaw = String(get(r, 'ms') || '').toLowerCase();
      const ms = /mile|yes|true|^1$/.test(msRaw) || (dur === 0);
      return {
        id: String(get(r, 'id')).trim(), name: String(get(r, 'name') || '').trim(), wbs: String(get(r, 'wbs') || '').trim(),
        dur: dur == null ? null : Math.round(dur), rem: num(get(r, 'rem')), pct: num(get(r, 'pct')) ?? 0,
        as: parseDate(get(r, 'as')), af: parseDate(get(r, 'af')), bs: parseDate(get(r, 'bs')), bf: parseDate(get(r, 'bf')),
        res: String(get(r, 'res') || '').trim(), cost: num(get(r, 'cost')), cons: normCons(get(r, 'cons')), consDate: parseDate(get(r, 'consDate')),
        ms, preds: parsePreds(get(r, 'preds')),
      };
    }).filter(a => a.id);
    return { activities: acts, info: {}, source: 'CSV' };
  }

  function fromXER(text) {
    const tables = {}; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('%T')) { cur = { name: line.split('\t')[1].trim(), fields: [], rows: [] }; tables[cur.name] = cur; }
      else if (line.startsWith('%F') && cur) cur.fields = line.split('\t').slice(1);
      else if (line.startsWith('%R') && cur) { const v = line.split('\t').slice(1); const o = {}; cur.fields.forEach((f, i) => o[f] = v[i]); cur.rows.push(o); }
    }
    if (!tables.TASK) throw new Error('No TASK table found. Export the project from Primavera P6 as an .xer file.');
    const proj = (tables.PROJECT && tables.PROJECT.rows[0]) || {};
    let hpd = 8;
    if (tables.CALENDAR) { const c = tables.CALENDAR.rows.find(r => r.default_flag === 'Y') || tables.CALENDAR.rows[0]; if (c && +c.day_hr_cnt) hpd = +c.day_hr_cnt; }
    const wbs = new Map(); (tables.PROJWBS ? tables.PROJWBS.rows : []).forEach(w => wbs.set(w.wbs_id, w.wbs_short_name || w.wbs_name));
    const rsrc = new Map(); (tables.RSRC ? tables.RSRC.rows : []).forEach(r => rsrc.set(r.rsrc_id, r.rsrc_short_name || r.rsrc_name));
    const tRes = new Map(), tCost = new Map();
    (tables.TASKRSRC ? tables.TASKRSRC.rows : []).forEach(r => {
      if (!tRes.has(r.task_id)) tRes.set(r.task_id, []);
      const nm = rsrc.get(r.rsrc_id); if (nm) tRes.get(r.task_id).push(nm);
      tCost.set(r.task_id, (tCost.get(r.task_id) || 0) + (+r.target_cost || 0));
    });
    const code = new Map(); tables.TASK.rows.forEach(t => code.set(t.task_id, t.task_code));
    const preds = new Map();
    const PT = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
    (tables.TASKPRED ? tables.TASKPRED.rows : []).forEach(p => {
      if (!preds.has(p.task_id)) preds.set(p.task_id, []);
      if (code.has(p.pred_task_id)) preds.get(p.task_id).push({ id: code.get(p.pred_task_id), t: PT[p.pred_type] || 'FS', lag: Math.round((+p.lag_hr_cnt || 0) / hpd) });
    });
    const CT = { CS_MSO: 'MSO', CS_MEO: 'MFO', CS_MSOA: 'SNET', CS_MSOB: 'SNLT', CS_MEOA: 'FNET', CS_MEOB: 'FNLT' };
    const acts = tables.TASK.rows.filter(t => t.task_type !== 'TT_LOE' && t.task_type !== 'TT_WBS').map(t => {
      const ms = t.task_type === 'TT_Mile' || t.task_type === 'TT_FinMile';
      const st = t.status_code;
      return {
        id: t.task_code, name: t.task_name, wbs: wbs.get(t.wbs_id) || '',
        dur: Math.round((+t.target_drtn_hr_cnt || 0) / hpd), rem: st === 'TK_Complete' ? 0 : Math.round((+t.remain_drtn_hr_cnt || 0) / hpd),
        pct: st === 'TK_Complete' ? 100 : Math.round(+t.phys_complete_pct || 0),
        as: parseDate(t.act_start_date), af: parseDate(t.act_end_date),
        bs: parseDate(t.target_start_date), bf: parseDate(t.target_end_date),
        res: (tRes.get(t.task_id) || []).join(', '), cost: tCost.get(t.task_id) || null,
        cons: CT[t.cstr_type] || '', consDate: parseDate(t.cstr_date), ms, preds: preds.get(t.task_id) || [],
      };
    });
    return {
      activities: acts, source: 'Primavera P6 (XER)',
      info: { code: proj.proj_short_name || '', dataDate: parseDate(proj.last_recalc_date || proj.next_data_date), start: parseDate(proj.plan_start_date), plannedFinish: parseDate(proj.scd_end_date || proj.plan_end_date) },
      notes: ['XER target dates were loaded as baseline dates. Replace them with your approved baseline if a separate baseline exists.'],
    };
  }

  function fromMSPXML(text) {
    if (typeof DOMParser === 'undefined') throw new Error('XML import needs a browser.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The XML file could not be read. Save from MS Project as "XML Format (*.xml)".');
    const kid = (el, tag) => { for (const c of el.children) if (c.tagName === tag) return c.textContent; return ''; };
    const projEl = doc.documentElement;
    const minPerDay = (+kid(projEl, 'MinutesPerDay')) || 480;
    const dur = s => { const m = /PT(\d+)H(\d+)M/.exec(s || ''); return m ? (+m[1] * 60 + +m[2]) / minPerDay : 0; };
    const resName = new Map();
    for (const r of doc.getElementsByTagName('Resource')) resName.set(kid(r, 'UID'), kid(r, 'Name'));
    const assign = new Map();
    for (const a of doc.getElementsByTagName('Assignment')) {
      const t = kid(a, 'TaskUID'), n = resName.get(kid(a, 'ResourceUID'));
      if (n) { if (!assign.has(t)) assign.set(t, []); assign.get(t).push(n); }
    }
    const tasks = [...doc.getElementsByTagName('Task')];
    const uidToId = new Map(), names = new Map();
    tasks.forEach(t => { uidToId.set(kid(t, 'UID'), kid(t, 'ID') || kid(t, 'UID')); names.set(kid(t, 'OutlineNumber'), kid(t, 'Name')); });
    const LT = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };
    const CT = { 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };
    const acts = tasks.filter(t => kid(t, 'Summary') !== '1' && kid(t, 'UID') !== '0' && kid(t, 'Name')).map(t => {
      const preds = [...t.children].filter(c => c.tagName === 'PredecessorLink').map(l => ({
        id: uidToId.get(kid(l, 'PredecessorUID')), t: LT[kid(l, 'Type')] || 'FS', lag: Math.round((+kid(l, 'LinkLag') || 0) / 10 / minPerDay),
      })).filter(p => p.id);
      let bs = '', bf = '';
      for (const b of t.children) if (b.tagName === 'Baseline' && kid(b, 'Number') === '0') { bs = parseDate(kid(b, 'Start')); bf = parseDate(kid(b, 'Finish')); }
      const on = kid(t, 'OutlineNumber'); const parent = on.includes('.') ? names.get(on.slice(0, on.lastIndexOf('.'))) : '';
      return {
        id: kid(t, 'ID') || kid(t, 'UID'), name: kid(t, 'Name'), wbs: kid(t, 'WBS') ? `${kid(t, 'WBS').split('.').slice(0, -1).join('.')}${parent ? ' ' + parent : ''}`.trim() : parent,
        dur: Math.round(dur(kid(t, 'Duration'))), rem: Math.round(dur(kid(t, 'RemainingDuration'))), pct: +kid(t, 'PercentComplete') || 0,
        as: parseDate(kid(t, 'ActualStart')), af: parseDate(kid(t, 'ActualFinish')), bs, bf,
        res: (assign.get(kid(t, 'UID')) || []).join(', '), cost: +kid(t, 'Cost') || null,
        cons: CT[kid(t, 'ConstraintType')] || '', consDate: parseDate(kid(t, 'ConstraintDate')),
        ms: kid(t, 'Milestone') === '1', preds,
      };
    });
    return {
      activities: acts, source: 'MS Project (XML)',
      info: { name: kid(projEl, 'Title') || kid(projEl, 'Name'), dataDate: parseDate(kid(projEl, 'StatusDate')), start: parseDate(kid(projEl, 'StartDate')), plannedFinish: parseDate(kid(projEl, 'FinishDate')) },
    };
  }

  function importSchedule(filename, text) {
    const f = (filename || '').toLowerCase();
    if (f.endsWith('.xer') || text.startsWith('ERMHDR')) return fromXER(text);
    if (f.endsWith('.xml') || /^\s*<\?xml|<Project[\s>]/.test(text)) return fromMSPXML(text);
    return fromCSV(text);
  }

  /* ---------- Export ---------- */
  function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function predStr(p) { return p.map(x => `${x.id}${x.t !== 'FS' || x.lag ? x.t : ''}${x.lag ? (x.lag > 0 ? '+' : '') + x.lag : ''}`).join('; '); }
  function toCSV(activities, result) {
    const head = ['Activity ID', 'Activity Name', 'WBS', 'Original Duration', 'Remaining Duration', '% Complete', 'Actual Start', 'Actual Finish',
      'Start', 'Finish', 'Baseline Start', 'Baseline Finish', 'Total Float', 'Critical', 'Resources', 'Cost', 'Constraint', 'Constraint Date', 'Predecessors', 'Milestone'];
    const rows = activities.map((a, i) => {
      const r = result ? result.res[i] : {};
      return [a.id, a.name, a.wbs, a.dur, r.rem ?? a.rem, a.pct, a.as, a.af, r.start, r.finish, a.bs, a.bf, r.tf ?? '', r.crit ? 'Yes' : '', a.res, a.cost ?? '', a.cons, a.consDate, predStr(a.preds || []), a.ms ? 'Yes' : ''];
    });
    return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  Object.assign(SANS, {
    dn, iso, weekday, parseDate, inRamadan, inSummerBan, WEEKS, KSA_HOLIDAYS, RAMADAN, HARD,
    holidaySet, makeCalendar, status, remDur, cpm, parsePreds, predStr,
    fromCSV, fromXER, fromMSPXML, importSchedule, toCSV,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = SANS;
})(typeof window !== 'undefined' ? window : globalThis);
