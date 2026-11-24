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

  /* ---------- Primavera P6 XER ---------- */
  function xerTables(text) {
    const tables = {}; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('%T')) { cur = { name: line.split('\t')[1].trim(), fields: [], rows: [] }; tables[cur.name] = cur; }
      else if (line.startsWith('%F') && cur) cur.fields = line.split('\t').slice(1).map(f => f.trim());
      else if (line.startsWith('%R') && cur) { const v = line.split('\t').slice(1); const o = {}; cur.fields.forEach((f, i) => o[f] = v[i] ?? ''); cur.rows.push(o); }
    }
    return tables;
  }
  // P6 clndr_data: days 1=Sunday..7=Saturday; exceptions as days since 1899-12-30
  function parseClndr(data) {
    const out = { work: null, holidays: [] };
    if (!data) return out;
    const dow = data.indexOf('DaysOfWeek');
    if (dow >= 0) {
      const exc = data.indexOf('Exceptions', dow); const end = exc > 0 ? exc : data.length;
      const work = [];
      for (let d = 1; d <= 7; d++) {
        const s = data.indexOf(`(0||${d}()(`, dow);
        if (s < 0 || s > end) { work.push(0); continue; }
        let e = d < 7 ? data.indexOf(`(0||${d + 1}()(`, s) : end; if (e < 0 || e > end) e = end;
        work.push(/s\|\d/.test(data.slice(s, e)) ? 1 : 0);
      }
      if (work.some(Boolean)) out.work = work;
    }
    const re = /\(d\|(\d+)\)\(\s*\)/g; let m;
    const ex = data.indexOf('Exceptions');
    if (ex >= 0) while ((m = re.exec(data.slice(ex)))) out.holidays.push(iso(+m[1] - 25569));
    return out;
  }
  function weekKey(work) {
    if (!work) return null;
    for (const [k, w] of Object.entries(WEEKS)) if (w.days.join('') === work.join('')) return k;
    const n = work.reduce((s, x) => s + x, 0);
    return n >= 7 ? '7d' : n === 6 ? '6d' : '5d';
  }

  function fromXER(text) {
    const tables = xerTables(text);
    if (!tables.TASK) throw new Error('No TASK table found. Export the project from Primavera P6 as an .xer file.');
    const projs = tables.PROJECT ? tables.PROJECT.rows : [];
    const count = new Map(); tables.TASK.rows.forEach(t => count.set(t.proj_id, (count.get(t.proj_id) || 0) + 1));
    const proj = projs.slice().sort((a, b) => (count.get(b.proj_id) || 0) - (count.get(a.proj_id) || 0))[0] || {};
    const notes = [];
    if (projs.length > 1) notes.push(`The file holds ${projs.length} projects; "${proj.proj_short_name}" (the largest) was imported.`);
    const inProj = t => !proj.proj_id || !t.proj_id || t.proj_id === proj.proj_id;
    const cals = tables.CALENDAR ? tables.CALENDAR.rows : [];
    const tasksP = tables.TASK.rows.filter(inProj);
    const calUse = new Map(); tasksP.forEach(t => calUse.set(t.clndr_id, (calUse.get(t.clndr_id) || 0) + 1));
    const mainCalId = proj.clndr_id || [...calUse].sort((a, b) => b[1] - a[1])[0]?.[0];
    const cal = cals.find(c => c.clndr_id === mainCalId) || cals.find(c => c.default_flag === 'Y') || cals[0] || {};
    if (calUse.size > 1) notes.push(`${calUse.size} calendars are used; the project calendar "${cal.clndr_name || mainCalId}" is applied to all activities.`);
    const hpd = +cal.day_hr_cnt || 8;
    const pc = parseClndr(cal.clndr_data);
    const wbsRows = (tables.PROJWBS ? tables.PROJWBS.rows : []).filter(inProj);
    const wbs = new Map(); wbsRows.forEach(w => wbs.set(w.wbs_id, w));
    const rsrc = new Map(); (tables.RSRC ? tables.RSRC.rows : []).forEach(r => rsrc.set(r.rsrc_id, r.rsrc_short_name || r.rsrc_name));
    const tRes = new Map(), tCost = new Map();
    (tables.TASKRSRC ? tables.TASKRSRC.rows : []).forEach(r => {
      if (!tRes.has(r.task_id)) tRes.set(r.task_id, []);
      const nm = rsrc.get(r.rsrc_id); if (nm && !tRes.get(r.task_id).includes(nm)) tRes.get(r.task_id).push(nm);
      tCost.set(r.task_id, (tCost.get(r.task_id) || 0) + (+r.target_cost || 0));
    });
    const code = new Map(); tables.TASK.rows.forEach(t => code.set(t.task_id, t.task_code));
    const preds = new Map();
    const PT = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
    let external = 0;
    (tables.TASKPRED ? tables.TASKPRED.rows : []).forEach(p => {
      if (!preds.has(p.task_id)) preds.set(p.task_id, []);
      if (p.pred_proj_id && proj.proj_id && p.pred_proj_id !== proj.proj_id) { external++; return; }
      if (code.has(p.pred_task_id)) preds.get(p.task_id).push({ id: code.get(p.pred_task_id), t: PT[p.pred_type] || 'FS', lag: Math.round((+p.lag_hr_cnt || 0) / hpd) });
    });
    if (external) notes.push(`${external} links to other projects were ignored.`);
    const CT = { CS_MSO: 'MSO', CS_MEO: 'MFO', CS_MSOA: 'SNET', CS_MSOB: 'SNLT', CS_MEOA: 'FNET', CS_MEOB: 'FNLT' };
    const skipped = tasksP.filter(t => t.task_type === 'TT_LOE' || t.task_type === 'TT_WBS').length;
    if (skipped) notes.push(`${skipped} level-of-effort / WBS summary activities were excluded from the analysis.`);
    const acts = tasksP.filter(t => t.task_type !== 'TT_LOE' && t.task_type !== 'TT_WBS').map(t => {
      const ms = t.task_type === 'TT_Mile' || t.task_type === 'TT_FinMile';
      const st = t.status_code;
      const w = wbs.get(t.wbs_id);
      return {
        id: t.task_code, name: t.task_name, wbs: w ? (w.wbs_name || w.wbs_short_name) : '',
        dur: Math.round((+t.target_drtn_hr_cnt || 0) / hpd), rem: st === 'TK_Complete' ? 0 : Math.round((+t.remain_drtn_hr_cnt || 0) / hpd),
        pct: st === 'TK_Complete' ? 100 : Math.round(+t.phys_complete_pct || 0),
        as: parseDate(t.act_start_date), af: parseDate(t.act_end_date),
        bs: parseDate(t.target_start_date), bf: parseDate(t.target_end_date),
        res: (tRes.get(t.task_id) || []).join(', '), cost: tCost.get(t.task_id) || null,
        cons: CT[t.cstr_type] || '', consDate: parseDate(t.cstr_date), ms, preds: preds.get(t.task_id) || [],
        xid: t.task_id, xwbs: t.wbs_id, xtype: t.task_type,
      };
    });
    const calendar = pc.work ? { week: weekKey(pc.work), ksaHolidays: pc.holidays.length === 0, holidays: pc.holidays } : null;
    if (calendar && pc.work && WEEKS[calendar.week].days.join('') !== pc.work.join('')) notes.push(`The P6 work week was mapped to the nearest standard week (${WEEKS[calendar.week].label}).`);
    notes.push('XER planned (target) dates were loaded as baseline dates. Replace them with your approved baseline if it is held separately.');
    return {
      activities: acts, source: 'Primavera P6 (XER)', notes,
      info: {
        code: proj.proj_short_name || '', name: proj.proj_short_name || '',
        dataDate: parseDate(proj.last_recalc_date || proj.next_data_date), start: parseDate(proj.plan_start_date), plannedFinish: parseDate(proj.plan_end_date || proj.scd_end_date),
        calendar,
        xer: {
          projId: proj.proj_id || '', projShort: proj.proj_short_name || '', clndrId: cal.clndr_id || '', clndrName: cal.clndr_name || '', hpd,
          wbs: wbsRows.map(w => ({ id: w.wbs_id, parent: w.parent_wbs_id, short: w.wbs_short_name, name: w.wbs_name, seq: w.seq_num, node: w.proj_node_flag })),
          version: (text.split(/\r?\n/)[0] || '').split('\t')[1] || '',
        },
      },
    };
  }

  function clndrData(week, holidays, hpd) {
    const days = (WEEKS[week] || WEEKS['6d']).days;
    const am = '08:00|f|12:00', endH = Math.min(23, 13 + Math.max(1, hpd - 4));
    const pm = `13:00|f|${String(endH).padStart(2, '0')}:00`;
    let s = '(0||CalendarData()((0||DaysOfWeek()(';
    days.forEach((w, i) => { s += w ? `(0||${i + 1}()((0||0(s|${am})())(0||1(s|${pm})())))` : `(0||${i + 1}()())`; });
    s += '))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(';
    holidays.forEach((d, k) => { s += `(0||${k}(d|${d + 25569})())`; });
    return s + '))))';
  }

  // Write a P6-importable XER for the project and (updated / revised) schedule.
  function toXER(P, acts, r, opts) {
    const o = opts || {};
    const X = P.xer || {};
    const hpd = X.hpd || 8;
    const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
    const num = v => (Math.round((+v || 0) * 100) / 100).toString();
    const D = (d, t) => d ? `${d} ${t}` : '';
    const cal = P.calendar || { week: '6d', ksaHolidays: true, holidays: [] };
    const projId = X.projId || '1001', clndrId = X.clndrId || '1001';
    const short = clean(X.projShort || P.code || 'SANS-PROJECT').slice(0, 40);
    let nextId = 900000;
    const used = new Set();
    const newId = () => { while (used.has(String(nextId))) nextId++; used.add(String(nextId)); return String(nextId++); };
    // WBS
    const wbsRows = (X.wbs || []).map(w => Object.assign({}, w));
    wbsRows.forEach(w => used.add(String(w.id)));
    let root = wbsRows.find(w => w.node === 'Y');
    if (!root) { root = { id: newId(), parent: '', short, name: P.name || short, seq: 0, node: 'Y' }; wbsRows.unshift(root); }
    const byName = new Map(wbsRows.map(w => [w.name || w.short, w.id]));
    const wbsIds = new Set(wbsRows.map(w => String(w.id)));
    const wbsOf = a => {
      if (a.xwbs && wbsIds.has(String(a.xwbs))) return a.xwbs;
      const nm = (a.wbs || '').trim() || 'Unassigned';
      if (!byName.has(nm)) { const id = newId(); wbsRows.push({ id, parent: root.id, short: nm.slice(0, 20), name: nm, seq: wbsRows.length, node: 'N' }); byName.set(nm, id); wbsIds.add(id); }
      return byName.get(nm);
    };
    // task ids
    acts.forEach(a => { if (a.xid && /^\d+$/.test(a.xid)) used.add(String(a.xid)); });
    const seen = new Set();
    const tid = acts.map(a => { const ok = a.xid && /^\d+$/.test(a.xid) && !seen.has(a.xid); const id = ok ? String(a.xid) : newId(); seen.add(id); return id; });
    const idx = new Map(acts.map((a, i) => [a.id, i]));
    const CT = { MSO: 'CS_MSO', MFO: 'CS_MEO', SNET: 'CS_MSOA', SNLT: 'CS_MSOB', FNET: 'CS_MEOA', FNLT: 'CS_MEOB' };
    const ST = { C: 'TK_Complete', IP: 'TK_Active', NS: 'TK_NotStart' };
    const day = i => iso(r.cal.date(i));
    const dd = iso(r.ddDay);
    const lines = [];
    const T = (name, fields, rows) => { lines.push('%T\t' + name, '%F\t' + fields.join('\t')); rows.forEach(v => lines.push('%R\t' + v.map(clean).join('\t'))); };
    const today = new Date().toISOString().slice(0, 10);
    lines.push(['ERMHDR', X.version || '19.12', today, 'Project', 'admin', 'SANS Schedule Control', 'dbxDatabaseNoName', 'Project Management', 'SAR'].join('\t'));
    T('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'decimal_symbol', 'digit_group_symbol', 'pos_curr_fmt_type', 'neg_curr_fmt_type', 'curr_type', 'curr_short_name', 'group_digit_cnt', 'base_exch_rate'],
      [['1', '2', 'SAR', '.', ',', '#1.1', '(#1.1)', 'Saudi Riyal', 'SAR', '3', '1']]);
    const hol = new Set();
    if (cal.ksaHolidays !== false) for (const [d, n] of KSA_HOLIDAYS) for (let i = 0; i < n; i++) hol.add(dn(d) + i);
    (cal.holidays || []).forEach(h => { const d = dn(parseDate(h)); if (d != null) hol.add(d); });
    T('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
      [[clndrId, 'N', X.clndrName || `SANS ${(WEEKS[cal.week] || WEEKS['6d']).label}`, projId, '', D(today, '00:00'), 'CA_Project', hpd, hpd * (WEEKS[cal.week] || WEEKS['6d']).days.reduce((s, x) => s + x, 0), hpd * 26, hpd * 300, 'N', clndrData(cal.week, [...hol].sort((a, b) => a - b), hpd)]]);
    T('PROJECT', ['proj_id', 'proj_short_name', 'clndr_id', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'last_recalc_date', 'sum_data_date', 'def_duration_type', 'def_complete_pct_type', 'task_code_base', 'task_code_step', 'def_task_type', 'critical_drtn_hr_cnt', 'critical_path_type'],
      [[projId, short, clndrId, D(P.start, '08:00'), D(P.contractFinish || r.finish, '17:00'), D(r.finish, '17:00'), D(dd, '08:00'), D(dd, '08:00'), 'DT_FixedDUR2', 'CP_Phys', '1000', '10', 'TT_Task', '0', 'CT_TotFloat']]);
    T('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'est_wt', 'proj_node_flag', 'sum_data_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'],
      (acts.forEach(wbsOf), wbsRows).map((w, k) => [w.id, projId, '', w.seq ?? k, '1', w.node === 'Y' ? 'Y' : 'N', 'N', 'WS_Open', w.short || w.name, w.name || w.short, w.node === 'Y' ? '' : (w.parent || root.id)]));
    const taskRows = acts.map((a, i) => {
      const x = r.res[i];
      const type = a.ms ? (/Mile/.test(a.xtype || '') ? a.xtype : (x.npred ? 'TT_FinMile' : 'TT_Mile')) : (a.xtype && !/Mile|LOE|WBS/.test(a.xtype) ? a.xtype : 'TT_Task');
      const ip = x.st === 'IP', ns = x.st === 'NS', c = x.st === 'C';
      const es = c ? a.as : ip ? dd : x.start, ef = x.finish;
      const ls = c ? '' : day(x.ls), lf = c ? '' : day(Math.max(x.ls, x.lf - 1));
      return [tid[i], projId, wbsOf(a), clndrId, num(a.pct || 0), 'CP_Phys', type, 'DT_FixedDUR2', ST[x.st], a.id, a.name,
        c ? '' : num(x.tf * hpd), num(((+a.dur || 0)) * hpd), num((a.ms ? 0 : x.rem) * hpd),
        a.consDate ? D(a.consDate, /^F|MFO/.test(a.cons) ? '17:00' : '08:00') : '', CT[a.cons] || '',
        D(c || ip ? (a.as || x.start) : '', '08:00'), D(c ? (a.af || x.finish) : '', '17:00'),
        D(ns ? x.start : es, '08:00'), D(ef, '17:00'), D(ls, '08:00'), D(lf, '17:00'),
        D(ns || ip ? (ns ? x.start : dd) : '', '08:00'), D(c ? '' : ef, '17:00'),
        D(a.bs || x.start, '08:00'), D(a.bf || x.finish, '17:00'), x.crit && !c ? 'Y' : 'N'];
    });
    T('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name',
      'total_float_hr_cnt', 'target_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'cstr_date', 'cstr_type', 'act_start_date', 'act_end_date',
      'early_start_date', 'early_end_date', 'late_start_date', 'late_end_date', 'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'driving_path_flag'], taskRows);
    const PT = { FS: 'PR_FS', SS: 'PR_SS', FF: 'PR_FF', SF: 'PR_SF' };
    const predRows = []; let pid = 700000;
    acts.forEach((a, i) => (a.preds || []).forEach(p => { const j = idx.get(p.id); if (j == null) return; predRows.push([String(pid++), tid[i], tid[j], projId, projId, PT[p.t] || 'PR_FS', num((+p.lag || 0) * hpd)]); }));
    T('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows);
    // resources
    const rs = new Map(); let rid = 600000;
    acts.forEach(a => String(a.res || '').split(/\s*[,;]\s*/).filter(Boolean).forEach(n => { if (!rs.has(n)) rs.set(n, String(rid++)); }));
    if (rs.size) {
      T('RSRC', ['rsrc_id', 'clndr_id', 'rsrc_seq_num', 'rsrc_name', 'rsrc_short_name', 'rsrc_type', 'active_flag', 'def_qty_per_hr', 'cost_qty_type'],
        [...rs].map(([n, id], k) => [id, clndrId, k, n, n.replace(/\s+/g, '_').slice(0, 20).toUpperCase(), 'RT_Labor', 'Y', '1', 'QT_Hour']));
      const tr = []; let trid = 500000;
      acts.forEach((a, i) => {
        const names = String(a.res || '').split(/\s*[,;]\s*/).filter(Boolean); if (!names.length) return;
        const cost = (+a.cost || 0) / names.length, remF = 1 - Math.min(100, +a.pct || 0) / 100;
        names.forEach(n => tr.push([String(trid++), tid[i], projId, rs.get(n), 'RR_Labor', num(cost), num(cost * remF), num((+a.dur || 0) * hpd), num(r.res[i].rem * hpd)]));
      });
      T('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'rsrc_type', 'target_cost', 'remain_cost', 'target_qty', 'remain_qty'], tr);
    }
    lines.push('%E');
    return lines.join('\r\n') + '\r\n';
  }

  // Minimal ZIP writer (stored, no compression) for packaging .xer files
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd2 = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd2, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd2, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let k = 0;
    for (const p of all) { out.set(p, k); k += p.length; }
    return out;
  }
  // Decode an uploaded file: UTF-8 first, then Windows-1256 (Arabic) as used by P6 on Arabic Windows
  function decodeBytes(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('windows-1256').decode(buf); } catch (e2) { return new TextDecoder('windows-1252').decode(buf); } }
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
    fromCSV, fromXER, fromMSPXML, importSchedule, toCSV, toXER, xerTables, parseClndr, zipStore, crc32, decodeBytes,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = SANS;
})(typeof window !== 'undefined' ? window : globalThis);
