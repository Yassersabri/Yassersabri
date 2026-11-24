/* SANS Schedule Control — schedule recovery engine
 * Generates recovery options (crashing, fast-tracking, extended work week, combined
 * auto-recovery, EOT) by re-running CPM on modified copies of the schedule.
 */
(function (root) {
  'use strict';
  const SANS = root.SANS;
  const { dn, iso } = SANS;
  const clone = acts => acts.map(a => Object.assign({}, a, { preds: (a.preds || []).map(p => Object.assign({}, p)) }));

  const DEFAULTS = { maxCrashPct: 25, crashPremium: 0.5, defaultCrashCost: 12000, overlapPct: 30, maxLinks: 12, reworkPct: 4, linkCost: 25000, overtimePremium: 0.5, defaultDailyWork: 25000, maxIter: 800 };

  function ctx(project, acts, target) {
    const r = SANS.cpm(project, acts);
    const t = dn(target) ?? r.cfDay;
    return { r, targetDay: t };
  }
  // Work the contractor cannot accelerate with own resources (authority reviews, inspections, supplier lead times)
  const external = a => SANS.KW && (SANS.KW.authority.test(a.name || '') || SANS.KW.procurement.test(a.name || ''));
  const meets = (r, t) => t == null ? true : r.finishDay <= t;

  /* Crashing: shorten the cheapest critical activities one day at a time */
  function crash(project, acts0, target, o, log, calendar) {
    const acts = clone(acts0);
    const P = calendar ? Object.assign({}, project, { calendar }) : project;
    const t = dn(target);
    const base = new Map(acts.map(a => [a.id, SANS.remDur(a)]));
    const done = new Map();
    let cost = 0, r = SANS.cpm(P, acts), it = 0;
    const blocked = new Set();
    while (!meets(r, t) && it++ < o.maxIter) {
      const cands = r.critical.filter(x => {
        const a = acts[x.i];
        if (a.ms || x.rem <= 1 || blocked.has(a.id) || external(a)) return false;
        return (done.get(a.id) || 0) < Math.floor(base.get(a.id) * o.maxCrashPct / 100);
      });
      if (!cands.length) break;
      const slope = x => { const a = acts[x.i]; return +a.cost > 0 && +a.dur > 0 ? Math.max(o.defaultCrashCost * 0.4, a.cost / a.dur * o.crashPremium) : o.defaultCrashCost; };
      cands.sort((a, b) => slope(a) - slope(b) || b.rem - a.rem);
      const pick = cands[0], a = acts[pick.i];
      a.rem = SANS.remDur(a) - 1;
      if (SANS.status(a) === 'NS') a.dur = Math.max(1, (+a.dur || 0) - 1);
      const before = r.finishDay;
      r = SANS.cpm(P, acts);
      if (r.finishDay >= before && cands.length === 1) blocked.add(a.id);
      done.set(a.id, (done.get(a.id) || 0) + 1);
      cost += slope(pick);
    }
    for (const [id, days] of done) {
      const a = acts.find(x => x.id === id);
      log.push({ id, name: a.name, kind: 'Crash', change: `Remaining duration ${base.get(id)} → ${base.get(id) - days} days (−${days})`, how: 'Add crew / second shift / overtime' });
    }
    return { acts, r, cost };
  }

  /* Fast-tracking: overlap critical FS pairs using SS + FF relationships */
  function fastTrack(project, acts0, target, o, log, calendar) {
    const acts = clone(acts0);
    const P = calendar ? Object.assign({}, project, { calendar }) : project;
    const t = dn(target);
    let r = SANS.cpm(P, acts), cost = 0, n = 0;
    const tried = new Set();
    while (!meets(r, t) && n < o.maxLinks) {
      const critIdx = new Set(r.critical.map(x => x.i));
      let best = null;
      r.critical.forEach(x => {
        const s = acts[x.i];
        if (s.ms || SANS.status(s) !== 'NS' || external(s)) return;
        (s.preds || []).forEach((p, k) => {
          const pi = acts.findIndex(a => a.id === p.id);
          if (pi < 0 || !critIdx.has(pi)) return;
          const pa = acts[pi];
          const key = pa.id + '>' + s.id;
          if (tried.has(key) || p.t !== 'FS' || pa.ms || SANS.status(pa) !== 'NS' || SANS.remDur(pa) < 5 || (+p.lag || 0) < 0) return;
          const score = SANS.remDur(pa);
          if (!best || score > best.score) best = { s, p, k, pa, key, score };
        });
      });
      if (!best) break;
      tried.add(best.key);
      const pd = SANS.remDur(best.pa);
      const ss = Math.ceil(pd * (1 - o.overlapPct / 100)) + (+best.p.lag || 0);
      const before = r.finishDay;
      const saved = { t: best.p.t, lag: best.p.lag };
      best.p.t = 'SS'; best.p.lag = ss;
      best.s.preds.push({ id: best.pa.id, t: 'FF', lag: Math.max(0, +saved.lag || 0) });
      const r2 = SANS.cpm(P, acts);
      if (r2.finishDay >= before) { // no gain – revert
        best.p.t = saved.t; best.p.lag = saved.lag; best.s.preds.pop();
        continue;
      }
      r = r2; n++;
      const c = Math.max(o.linkCost, (+best.s.cost || 0) * o.reworkPct / 100);
      cost += c;
      log.push({ id: best.s.id, name: best.s.name, kind: 'Fast-track', change: `${best.pa.id} → ${best.s.id}: FS${saved.lag ? '+' + saved.lag : ''} changed to SS+${ss} with FF (${o.overlapPct}% overlap)`, how: 'Overlap work by zones or floors, with interface coordination' });
    }
    return { acts, r, cost, links: n };
  }

  function nextWeek(w) { return w === '5d' ? '6d' : w === '6d' ? '7d' : null; }

  function extraWorkCost(project, acts, oldR, newR, o) {
    // premium paid for the additional weekend days actually worked between data date and new finish
    let remCost = 0, remDays = 0;
    acts.forEach((a, i) => { if (oldR.res[i].st !== 'C' && !a.ms) { remCost += (+a.cost || 0) * (1 - (+a.pct || 0) / 100); remDays += oldR.res[i].rem; } });
    const daily = remCost > 0 ? remCost / Math.max(1, oldR.maxEF - oldR.dd) : o.defaultDailyWork;
    const oldSet = new Set(oldR.cal.days);
    let extra = 0;
    for (const d of newR.cal.days) if (d >= newR.ddDay && d <= newR.finishDay && !oldSet.has(d)) extra++;
    return { cost: extra * daily * o.overtimePremium, extra, daily };
  }

  function evaluate(project, base, opt, o) {
    const r = opt.r;
    const oldVar = base.varianceDays ?? 0, newVar = r.varianceDays ?? 0;
    const recovered = base.finishDay - r.finishDay;
    const ldAvoided = (Math.max(0, oldVar) - Math.max(0, newVar)) * (+project.ldRate || 0);
    const indirectSaved = Math.max(0, recovered) * (+project.dailyIndirect || 0);
    opt.finish = r.finish; opt.recovered = recovered; opt.variance = newVar;
    opt.savings = ldAvoided + indirectSaved; opt.ldAvoided = ldAvoided; opt.indirectSaved = indirectSaved;
    opt.net = opt.savings - opt.cost;
    opt.meets = r.cfDay == null || opt.targetDay == null ? null : r.finishDay <= opt.targetDay;
    return opt;
  }

  function recover(project, acts, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const target = o.target || project.contractFinish;
    const base = SANS.cpm(project, acts);
    const targetDay = dn(target) ?? base.cfDay;
    const week = (project.calendar && project.calendar.week) || '6d';
    const opts = [];

    // A. Crashing
    { const log = []; const x = crash(project, acts, target, o, log);
      opts.push(evaluate(project, base, { key: 'crash', name: 'A. Crashing (add resources)', short: 'Crashing', acts: x.acts, r: x.r, cost: x.cost, log, targetDay,
        risk: log.length > 8 ? 'High' : 'Medium', calendar: null,
        desc: `Shorten the cheapest critical activities by up to ${o.maxCrashPct}% using extra crews, second shifts or overtime.`,
        assumptions: ['Authority approvals, inspections and procurement lead times are excluded; they cannot be accelerated with site resources.', `Maximum compression ${o.maxCrashPct}% of the remaining duration per activity.`, `Crash cost is ${Math.round(o.crashPremium * 100)}% of the activity's daily cost, or SAR ${o.defaultCrashCost.toLocaleString('en-US')} a day where no cost is loaded.`] }, o)); }
    // B. Fast-tracking
    { const log = []; const x = fastTrack(project, acts, target, o, log);
      opts.push(evaluate(project, base, { key: 'fasttrack', name: 'B. Fast-tracking (overlap activities)', short: 'Fast-tracking', acts: x.acts, r: x.r, cost: x.cost, log, targetDay,
        risk: x.links > 5 ? 'High' : x.links ? 'Medium' : 'Low', calendar: null,
        desc: `Overlap up to ${o.maxLinks} critical finish-to-start pairs by ${o.overlapPct}% using start-to-start and finish-to-finish links.`,
        assumptions: [`${o.overlapPct}% overlap per pair, applied only to pairs that have not started.`, `Rework and coordination allowance of ${o.reworkPct}% of the successor's cost, at least SAR ${o.linkCost.toLocaleString('en-US')} per pair.`] }, o)); }
    // C. Extended work week
    const nw = nextWeek(week);
    if (nw) {
      const cal = Object.assign({}, project.calendar || {}, { week: nw });
      const P = Object.assign({}, project, { calendar: cal });
      const r = SANS.cpm(P, acts);
      const c = extraWorkCost(project, acts, base, r, o);
      opts.push(evaluate(project, base, { key: 'calendar', name: `C. Extended work week (${SANS.WEEKS[nw].label})`, short: 'Extended week', acts: clone(acts), r, cost: c.cost, targetDay, risk: nw === '7d' ? 'Medium' : 'Low', calendar: cal,
        log: [{ id: '—', name: 'Project calendar', kind: 'Calendar', change: `${SANS.WEEKS[week].label} → ${SANS.WEEKS[nw].label} (${c.extra} additional working days)`, how: 'Weekend working with overtime premium, subject to Labour Law Art. 107' }],
        desc: `Move the remaining work from the ${SANS.WEEKS[week].label} to the ${SANS.WEEKS[nw].label}.`,
        assumptions: [`Overtime premium of ${Math.round(o.overtimePremium * 100)}% on an average daily work cost of SAR ${Math.round(c.daily).toLocaleString('en-US')}.`, 'Requires Ministry of Human Resources overtime compliance and consultant approval for weekend inspections.'] }, o));
    }
    // D. Combined auto-recovery
    {
      const log = []; let cur = clone(acts), cost = 0, cal = null;
      let r = base;
      if (!meets(r, targetDay) && nw) {
        cal = Object.assign({}, project.calendar || {}, { week: nw });
        const r2 = SANS.cpm(Object.assign({}, project, { calendar: cal }), cur);
        const c = extraWorkCost(project, cur, r, r2, o);
        cost += c.cost; r = r2;
        log.push({ id: '—', name: 'Project calendar', kind: 'Calendar', change: `${SANS.WEEKS[week].label} → ${SANS.WEEKS[nw].label}`, how: 'Weekend working with overtime premium' });
      }
      if (!meets(r, targetDay)) { const x = fastTrack(project, cur, target, Object.assign({}, o, { maxLinks: Math.min(6, o.maxLinks) }), log, cal); cur = x.acts; r = x.r; cost += x.cost; }
      if (!meets(r, targetDay)) { const x = crash(project, cur, target, o, log, cal); cur = x.acts; r = x.r; cost += x.cost; }
      opts.push(evaluate(project, base, { key: 'auto', name: 'D. Auto-recovery (combined)', short: 'Auto-recovery', acts: cur, r, cost, log, targetDay, calendar: cal,
        risk: log.length > 10 ? 'High' : 'Medium',
        desc: 'Applies the lowest-disruption levers first: an extended work week, then a limited number of overlaps, then crashing of the cheapest critical activities. It stops as soon as the target date is met.',
        assumptions: ['Combines the assumptions of options A, B and C.', 'Each lever is applied only when the previous one did not meet the target.'] }, o));
    }
    // E. EOT
    if ((base.varianceDays || 0) > 0) {
      opts.push({ key: 'eot', name: 'E. Extension of Time claim', short: 'EOT claim', acts: null, r: base, cost: 0, log: [], targetDay, risk: 'Medium', calendar: null,
        finish: base.finish, recovered: 0, variance: base.varianceDays, savings: 0, net: 0, meets: null,
        desc: 'Claim time for excusable delays (client changes, late approvals, authority delays, force majeure) supported by a Time Impact Analysis under FIDIC Sub-Clause 8.5 (2017) / 8.4 (1999).',
        assumptions: ['No acceleration cost; the outcome depends on entitlement and on contemporaneous records (notices within 28 days).'] });
    }
    // recommend
    const feasible = opts.filter(x => x.acts && x.meets);
    const rankRisk = { Low: 0, Medium: 1, High: 2 };
    let rec = feasible.sort((a, b) => b.net - a.net || rankRisk[a.risk] - rankRisk[b.risk])[0];
    if (!rec) rec = opts.filter(x => x.acts).sort((a, b) => b.recovered - a.recovered)[0];
    opts.forEach(x => x.recommended = x === rec);
    return { base, options: opts, target: iso(targetDay), recommended: rec, settings: o };
  }

  // Changes between original and revised activities (for the revised schedule register)
  function diff(orig, rev, rOrig, rRev) {
    const out = [];
    rev.forEach((a, i) => {
      const o = orig[i], x = rOrig.res[i], y = rRev.res[i];
      if (!o) return;
      const ds = dn(y.start) - dn(x.start), df = dn(y.finish) - dn(x.finish);
      if (ds || df || SANS.remDur(o) !== SANS.remDur(a)) out.push({ id: a.id, name: a.name, oldStart: x.start, newStart: y.start, oldFinish: x.finish, newFinish: y.finish, shift: df, oldRem: SANS.remDur(o), newRem: SANS.remDur(a), crit: y.crit });
    });
    return out;
  }

  Object.assign(SANS, { recover, recoveryDefaults: DEFAULTS, scheduleDiff: diff, cloneActs: clone });
})(typeof window !== 'undefined' ? window : globalThis);
