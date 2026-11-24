/* SANS Schedule Control — schedule review & assessment
 * DCMA 14-point check, missing-information extraction, performance indices,
 * recommendations, and automatic risk triggers.
 */
(function (root) {
  'use strict';
  const SANS = root.SANS;
  const { dn, iso } = SANS;
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;

  /* ---------- Performance metrics ---------- */
  function metrics(project, acts, r) {
    const ddDay = r.ddDay;
    const weight = a => (+a.cost > 0 ? +a.cost : Math.max(1, +a.dur || 1));
    let pv = 0, ev = 0, total = 0, haveBL = 0;
    let dueBL = 0, doneOfDue = 0, doneTotal = 0, missed = 0; const missedIds = [];
    acts.forEach((a, i) => {
      if (a.ms) return;
      const w = weight(a); total += w;
      ev += w * Math.min(100, +a.pct || 0) / 100;
      const bs = dn(a.bs), bf = dn(a.bf);
      if (bs != null && bf != null) {
        haveBL++;
        if (bf <= ddDay) pv += w;
        else if (bs < ddDay) pv += w * (ddDay - bs) / Math.max(1, bf - bs + 1);
        if (bf <= ddDay) {
          dueBL++;
          if (r.res[i].st === 'C') { doneOfDue++; if (dn(a.af) > bf) { missed++; missedIds.push(a.id); } }
          else { missed++; missedIds.push(a.id); }
        }
      }
      if (r.res[i].st === 'C') doneTotal++;
    });
    const spi = pv > 0 ? ev / pv : null;
    const bei = dueBL > 0 ? doneTotal / dueBL : null;
    const cpLen = Math.max(1, r.maxEF - r.dd);
    const floatToContract = r.cfDay != null ? r.term - r.maxEF : null;
    const cpli = floatToContract != null ? (cpLen + floatToContract) / cpLen : null;
    const blFinish = acts.reduce((m, a) => Math.max(m, dn(a.bf) ?? -Infinity), -Infinity);
    const startDay = dn(project.start);
    const elapsed = startDay != null && r.cfDay != null ? Math.max(0, Math.min(1, (ddDay - startDay) / Math.max(1, r.cfDay - startDay))) : null;
    return {
      planned: total ? pv / total * 100 : null, actual: total ? ev / total * 100 : null, spi, bei, cpli,
      dueBL, doneOfDue, missed, missedIds, haveBL, blFinish: isFinite(blFinish) ? iso(blFinish) : '',
      floatToContract, cpLen, timeElapsed: elapsed != null ? elapsed * 100 : null,
      ldExposure: r.varianceDays > 0 && project.ldRate ? Math.min(r.varianceDays * project.ldRate, project.contractValue && project.ldCapPct ? project.contractValue * project.ldCapPct / 100 : Infinity) : 0,
    };
  }

  /* ---------- DCMA 14-point assessment ---------- */
  function dcma(project, acts, r, m) {
    const inc = r.res.filter(x => x.st !== 'C');
    const incTasks = inc.filter(x => !acts[x.i].ms);
    const nInc = Math.max(1, inc.length);
    const rels = []; acts.forEach(a => (a.preds || []).forEach(p => rels.push({ a: a.id, ...p })));
    const nRel = Math.max(1, rels.length);
    // first / last activities are allowed one open end
    const firstIds = new Set(r.res.filter(x => x.npred === 0).sort((a, b) => a.es - b.es).slice(0, 1).map(x => x.id));
    const lastIds = new Set(r.res.filter(x => x.nsucc === 0).sort((a, b) => b.ef - a.ef).slice(0, 1).map(x => x.id));
    const openEnds = inc.filter(x => (x.npred === 0 && !firstIds.has(x.id)) || (x.nsucc === 0 && !lastIds.has(x.id)));
    const leads = rels.filter(x => x.lag < 0);
    const lags = rels.filter(x => x.lag > 0);
    const nonFS = rels.filter(x => (x.t || 'FS') !== 'FS');
    const hard = inc.filter(x => SANS.HARD.has(acts[x.i].cons));
    const highF = inc.filter(x => x.tf > 44);
    const negF = inc.filter(x => x.tf < 0);
    const highD = incTasks.filter(x => x.rem > 44);
    const invalid = r.res.filter(x => {
      const a = acts[x.i];
      return (dn(a.as) > r.ddDay) || (dn(a.af) > r.ddDay) || (x.st === 'NS' && dn(x.start) < r.ddDay) || (x.st === 'IP' && dn(x.finish) < r.ddDay);
    });
    const noRes = incTasks.filter(x => !String(acts[x.i].res || '').trim() && !(+acts[x.i].cost > 0));
    // Critical path test: add delay to first critical activity; finish should slip by the same amount
    let cpTest = false;
    const firstCrit = r.critical.slice().sort((a, b) => a.es - b.es)[0];
    if (firstCrit) {
      const test = acts.map((a, i) => i === firstCrit.i ? Object.assign({}, a, { rem: SANS.remDur(a) + 60, dur: (+a.dur || 0) + 60, ms: false }) : a);
      const t = SANS.cpm(project, test);
      cpTest = t.maxEF - r.maxEF >= 55;
    }
    const L = (code, name, metric, value, threshold, pass, items, why, fix) => ({ code, name, metric, value, threshold, pass, items: (items || []).map(x => x.id ?? x), why, fix });
    const rows = [
      L(1, 'Logic', 'Open ends', pct(openEnds.length, nInc), '≤ 5%', pct(openEnds.length, nInc) <= 5, openEnds,
        'Activities without a predecessor or successor do not move when other work slips, so the forecast hides delay.',
        'Link every activity into the network with at least one predecessor and one successor.'),
      L(2, 'Leads', 'Negative lags', leads.length, '0', leads.length === 0, leads.map(x => x.a),
        'Negative lag forecasts a successor before its predecessor finishes and distorts the critical path.',
        'Replace negative lags with SS/FF relationships or split the activities.'),
      L(3, 'Lags', 'Positive lags', pct(lags.length, nRel), '≤ 5%', pct(lags.length, nRel) <= 5, lags.map(x => x.a),
        'Lags represent unmodelled work such as curing or approvals that cannot be progressed or statused.',
        'Convert long lags into real activities (e.g. "Concrete curing", "Consultant review").'),
      L(4, 'Relationship types', 'Finish-to-Start', pct(rels.length - nonFS.length, nRel), '≥ 90%', pct(rels.length - nonFS.length, nRel) >= 90, nonFS.map(x => x.a),
        'Heavy use of SS/FF/SF relationships makes the path difficult to trace and to defend in a delay claim.',
        'Use FS logic by default; keep SS/FF only where a true overlap exists.'),
      L(5, 'Hard constraints', 'Mandatory / "no later than" dates', pct(hard.length, nInc), '≤ 5%', pct(hard.length, nInc) <= 5, hard,
        'Hard constraints override the logic and create artificial float or negative float.',
        'Replace hard constraints with logic and use SNET constraints only for external access dates.'),
      L(6, 'High float', 'Total float > 44 days', pct(highF.length, nInc), '≤ 5%', pct(highF.length, nInc) <= 5, highF,
        'Very high float usually means missing successors or a missing logic tie to the completion milestone.',
        'Review successors of high-float activities and tie them to the handover milestone.'),
      L(7, 'Negative float', 'Total float < 0', negF.length, '0', negF.length === 0, negF,
        'Negative float means the forecast finish is after the contract or constraint date.',
        'Prepare a recovery schedule or submit an Extension of Time with the delay analysis.'),
      L(8, 'High duration', 'Remaining duration > 44 days', pct(highD.length, Math.max(1, incTasks.length)), '≤ 5%', pct(highD.length, Math.max(1, incTasks.length)) <= 5, highD,
        'Long activities cannot be measured accurately in a monthly update.',
        'Break long activities into areas, floors or zones of 44 working days or less.'),
      L(9, 'Invalid dates', 'Actuals after / forecasts before data date', invalid.length, '0', invalid.length === 0, invalid,
        'Actual dates in the future or forecast dates in the past mean the update was not statused correctly.',
        'Correct actual dates and move unfinished work to after the data date.'),
      L(10, 'Resources', 'Incomplete tasks without resources or cost', pct(noRes.length, Math.max(1, incTasks.length)), '0%', noRes.length === 0, noRes,
        'Unloaded activities cannot be checked for manpower, productivity or cash-flow feasibility.',
        'Assign the crew, subcontractor or cost to every activity.'),
      L(11, 'Missed tasks', 'Late against baseline', m.dueBL ? pct(m.missed, m.dueBL) : '—', '≤ 5%', m.dueBL ? pct(m.missed, m.dueBL) <= 5 : null, m.missedIds,
        'Tasks finishing later than their baseline finish show execution falling behind the plan.',
        'Analyse the missed tasks for root causes such as approvals, manpower or materials.'),
      L(12, 'Critical path test', 'Delay propagates to finish', cpTest ? 'Yes' : 'No', 'Pass', cpTest, cpTest ? [] : (firstCrit ? [firstCrit] : []),
        'If a delay to a critical activity does not move the finish, the critical path is broken by constraints or open ends.',
        'Remove hard constraints and open ends until a continuous path runs from the data date to completion.'),
      L(13, 'CPLI', 'Critical Path Length Index', m.cpli != null ? m.cpli.toFixed(2) : '—', '≥ 0.95', m.cpli != null ? m.cpli >= 0.95 : null, [],
        'CPLI below 0.95 means the remaining critical path is unlikely to meet the contract finish without recovery.',
        'Assess recovery options such as crashing, fast-tracking and extended working hours.'),
      L(14, 'BEI', 'Baseline Execution Index', m.bei != null ? m.bei.toFixed(2) : '—', '≥ 0.95', m.bei != null ? m.bei >= 0.95 : null, [],
        'BEI below 0.95 means fewer activities are being completed than the baseline planned.',
        'Increase production rates on the activities that are due and remove blockers.'),
    ];
    const scored = rows.filter(x => x.pass !== null);
    const score = scored.length ? Math.round(scored.filter(x => x.pass).length / scored.length * 100) : 0;
    return { rows, score, openEnds, negF, hard, highD };
  }

  /* ---------- Missing information extraction ---------- */
  function missing(project, acts, r) {
    const out = [];
    const add = (area, item, severity, detail, ids) => out.push({ area, item, severity, detail, ids: ids || [] });
    const P = [
      ['code', 'Project code', 'Medium'], ['name', 'Project name', 'High'], ['client', 'Client', 'Medium'], ['location', 'Site location', 'Low'],
      ['start', 'Project start / NTP date', 'High'], ['dataDate', 'Data date (status date)', 'High'], ['contractFinish', 'Contract completion date', 'High'],
      ['contractValue', 'Contract value', 'Medium'], ['ldRate', 'Delay damages (LD) rate per day', 'Medium'], ['pm', 'Project manager', 'Low'], ['planner', 'Planning engineer', 'Low'],
    ];
    for (const [k, label, sev] of P) if (project[k] == null || project[k] === '' || project[k] === 0) add('Project data', label, sev, `${label} is not recorded in the project register.`);
    if (!project.calendar || !project.calendar.week) add('Project data', 'Work calendar', 'Medium', 'No project work week defined; the 6-day Saudi construction week (Sat–Thu) is assumed.');

    const ids = new Map();
    acts.forEach(a => ids.set(a.id, (ids.get(a.id) || 0) + 1));
    const dup = [...ids].filter(([, c]) => c > 1).map(([k]) => k);
    if (dup.length) add('Schedule data', 'Duplicate activity IDs', 'High', `${dup.length} activity IDs are used more than once.`, dup);
    const noName = acts.filter(a => !String(a.name || '').trim()).map(a => a.id);
    if (noName.length) add('Schedule data', 'Activity names', 'High', `${noName.length} activities have no description.`, noName);
    const noWbs = acts.filter(a => !String(a.wbs || '').trim()).map(a => a.id);
    if (noWbs.length) add('Schedule data', 'WBS assignment', 'Medium', `${noWbs.length} activities are not assigned to a WBS element.`, noWbs);
    const noDur = acts.filter(a => !a.ms && !(+a.dur > 0)).map(a => a.id);
    if (noDur.length) add('Schedule data', 'Durations', 'High', `${noDur.length} tasks have zero or missing original duration (should they be milestones?).`, noDur);
    const noBL = acts.filter(a => !a.bs || !a.bf).map(a => a.id);
    if (noBL.length) add('Baseline', 'Baseline dates', noBL.length === acts.length ? 'High' : 'Medium', noBL.length === acts.length ? 'No baseline is loaded, so variance, BEI, SPI and missed-task checks cannot be measured.' : `${noBL.length} activities have no baseline start/finish.`, noBL);
    const incomplete = r.res.filter(x => x.st !== 'C');
    const noRes = incomplete.filter(x => !acts[x.i].ms && !String(acts[x.i].res || '').trim()).map(x => x.id);
    if (noRes.length) add('Resources & cost', 'Resource assignment', 'Medium', `${noRes.length} remaining tasks have no crew, subcontractor or resource.`, noRes);
    const noCost = acts.filter(a => !a.ms && !(+a.cost > 0)).map(a => a.id);
    if (noCost.length) add('Resources & cost', 'Cost loading', 'Low', `${noCost.length} tasks have no cost, so earned value and cash flow are incomplete.`, noCost);
    const noPred = r.res.filter(x => x.npred === 0).map(x => x.id);
    if (noPred.length > 1) add('Logic', 'Missing predecessors', 'High', `${noPred.length} activities have no predecessor (only the start milestone should).`, noPred);
    const noSucc = r.res.filter(x => x.nsucc === 0).map(x => x.id);
    if (noSucc.length > 1) add('Logic', 'Missing successors', 'High', `${noSucc.length} activities have no successor (only the completion milestone should).`, noSucc);
    if (r.badLinks.length) add('Logic', 'Broken links', 'High', `${r.badLinks.length} relationships point to activity IDs that do not exist.`, r.badLinks.map(b => b.act));
    if (r.loops.length) add('Logic', 'Logic loops', 'High', `${r.loops.length} activities form a circular logic loop.`, r.loops);
    const ipNoAS = acts.filter(a => +a.pct > 0 && !a.as).map(a => a.id);
    if (ipNoAS.length) add('Progress', 'Actual start dates', 'High', `${ipNoAS.length} activities show progress but have no actual start date.`, ipNoAS);
    const cNoAF = acts.filter(a => +a.pct >= 100 && !a.af).map(a => a.id);
    if (cNoAF.length) add('Progress', 'Actual finish dates', 'High', `${cNoAF.length} activities are 100% complete but have no actual finish date.`, cNoAF);
    const afLow = acts.filter(a => a.af && +a.pct < 100).map(a => a.id);
    if (afLow.length) add('Progress', 'Percent complete', 'Medium', `${afLow.length} activities have an actual finish but are below 100%.`, afLow);
    const consNoDate = acts.filter(a => a.cons && !a.consDate).map(a => a.id);
    if (consNoDate.length) add('Schedule data', 'Constraint dates', 'Medium', `${consNoDate.length} activities have a constraint type with no date.`, consNoDate);
    const msDur = acts.filter(a => a.ms && +a.dur > 0).map(a => a.id);
    if (msDur.length) add('Schedule data', 'Milestone durations', 'Low', `${msDur.length} milestones carry a duration.`, msDur);
    if (!acts.some(a => a.ms)) add('Schedule data', 'Contract milestones', 'High', 'The schedule has no milestones (NTP, key dates, substantial completion).');
    const stale = r.res.filter(x => x.st === 'NS' && dn(acts[x.i].bs) != null && dn(acts[x.i].bs) < r.ddDay - 30).map(x => x.id);
    if (stale.length) add('Progress', 'Overdue starts', 'Medium', `${stale.length} activities were due to start more than 30 days ago and have not started. Confirm their status.`, stale);
    const sevRank = { High: 0, Medium: 1, Low: 2 };
    return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  }

  /* ---------- Keyword classifiers (Saudi construction context) ---------- */
  const KW = {
    outdoor: /excavat|earth|backfill|concret|pour|raft|slab|roof|asphalt|paving|landscap|external|facade|curtain|shoring|piling|site|steel erect|road|utilit|fence|waterproof/i,
    procurement: /procur|supply|deliver|fabricat|import|purchase|long[- ]lead|order|manufactur/i,
    authority: /permit|approval|authorit|municipal|balady|civil defen|sec\b|nwc|momra|inspection|occupancy|sbc|license|licence|energi[sz]/i,
    commissioning: /test|commission|t&c|energi/i,
  };

  /* ---------- Risk triggers ---------- */
  function risks(project, acts, r, m, d) {
    const out = [];
    const T = (rid, title, category, trigger, cause, effect, p, i, response, action, ids) =>
      out.push({ rid, title, category, trigger, cause, effect, prob: p, impact: i, score: p * i, response, action, ids: (ids || []).map(x => x.id ?? x) });
    const crit = r.critical;
    const near = r.res.filter(x => x.near && x.st !== 'C');
    const inc = r.res.filter(x => x.st !== 'C');
    const sar = v => 'SAR ' + Math.round(v).toLocaleString('en-US');

    if (r.varianceDays > 0) {
      T('R01', 'Contract completion delay', 'Time', `Forecast finish ${r.finish} is ${r.varianceDays} calendar days after the contract date ${project.contractFinish}.`,
        'Cumulative slippage on the critical path.', `Delay damages exposure ${m.ldExposure ? sar(m.ldExposure) : 'not quantified (LD rate missing)'} and extended site overheads.`,
        r.varianceDays > 60 ? 5 : r.varianceDays > 20 ? 4 : 3, 5, 'Mitigate', 'Approve a recovery schedule and evaluate an Extension of Time for excusable delays.', crit);
    }
    if (d.negF.length) T('R02', 'Negative float on the schedule', 'Time', `${d.negF.length} activities carry negative total float (worst ${r.minTF} days).`,
      'Forecast dates exceed the contract finish or constraint dates.', 'Milestones will be missed without intervention.', 4, 4, 'Mitigate', 'Run the recovery options and re-sequence the driving path.', d.negF);
    if (inc.length && near.length / inc.length > 0.15) T('R03', 'Multiple near-critical paths', 'Time', `${near.length} activities (${Math.round(near.length / inc.length * 100)}%) are within 10 days of the critical path.`,
      'Parallel paths with little float.', 'A small slip on any path becomes critical and the finish becomes volatile.', 4, 3, 'Mitigate', 'Monitor near-critical work weekly and protect float with buffers.', near);
    const merges = inc.filter(x => (x.crit || x.near) && x.npred >= 3);
    if (merges.length) T('R04', 'Merge-point bias', 'Time', `${merges.length} critical or near-critical activities have 3 or more predecessors.`,
      'Several paths converge on one activity.', 'Deterministic dates understate the real risk of late start at the merge point.', 3, 3, 'Mitigate', 'Run schedule risk analysis on merge points and track their feeding paths.', merges);
    const ram = inc.filter(x => (x.crit || x.near) && rangeHits(x, SANS.inRamadan));
    if (ram.length) T('R05', 'Ramadan productivity reduction', 'Resources', `${ram.length} critical or near-critical activities are scheduled during Ramadan.`,
      'Reduced working hours (about 6 hours a day) and lower productivity during Ramadan.', 'Production rates fall by 20–30% and planned durations become optimistic.', 4, 3, 'Mitigate', 'Plan night shifts, add manpower or extend these durations in the Ramadan window.', ram);
    const heat = inc.filter(x => (x.crit || x.near) && KW.outdoor.test(acts[x.i].name) && rangeHits(x, SANS.inSummerBan));
    if (heat.length) T('R06', 'Summer midday work ban and heat stress', 'HSE', `${heat.length} critical outdoor activities fall in the 15 Jun – 15 Sep midday work ban.`,
      'Outdoor work is prohibited from 12:00 to 15:00 and high temperatures affect concrete placement.', 'Lost working hours, cold-joint and curing risks.', 4, 3, 'Mitigate', 'Shift pours and outdoor work to night or early-morning shifts and use retarders and chilled water.', heat);
    const proc = inc.filter(x => (x.crit || x.near) && KW.procurement.test(acts[x.i].name));
    if (proc.length) T('R07', 'Long-lead procurement on the driving path', 'Supply chain', `${proc.length} procurement activities are critical or near-critical.`,
      'Import lead times, shipping, customs clearance and SASO/SABER conformity.', 'Installation start is delayed and downstream trades wait.', 3, 4, 'Mitigate', 'Expedite purchase orders, monitor factory progress and plan alternative local suppliers.', proc);
    const auth = inc.filter(x => (x.crit || x.near || x.tf < 20) && KW.authority.test(acts[x.i].name));
    if (auth.length) T('R08', 'Authority approval and utility connection delay', 'External', `${auth.length} activities depending on authorities (Balady, Civil Defense, SEC, NWC) have low float.`,
      'Approval cycles outside the contractor\'s control.', 'Inspection, energization or occupancy certificates come late.', 4, 4, 'Mitigate', 'Submit early, assign a dedicated authority liaison and record dates for EOT entitlement.', auth);
    if (d.openEnds.length) T('R09', 'Schedule integrity: open ends', 'Schedule quality', `${d.openEnds.length} activities have no predecessor or successor.`,
      'Incomplete logic.', 'The critical path and the forecast finish may be wrong.', 3, 3, 'Avoid', 'Fix the logic before issuing the update.', d.openEnds);
    if (d.hard.length) T('R10', 'Hard constraints masking float', 'Schedule quality', `${d.hard.length} activities have hard constraints.`,
      'Mandatory or "no later than" dates override logic.', 'Float and the critical path are artificially altered.', 2, 3, 'Avoid', 'Replace hard constraints with logic links.', d.hard);
    if (m.spi != null && m.spi < 0.9) T('R11', 'Low productivity / progress behind plan', 'Performance', `SPI is ${m.spi.toFixed(2)} (planned ${m.planned.toFixed(1)}% against actual ${m.actual.toFixed(1)}%).`,
      'Insufficient manpower, low productivity or late material.', 'Remaining durations are likely to be optimistic.', 4, 4, 'Mitigate', 'Run a manpower histogram review and increase crews on critical fronts.', []);
    if (m.bei != null && m.bei < 0.9) T('R12', 'Baseline execution shortfall', 'Performance', `BEI is ${m.bei.toFixed(2)}: ${m.doneOfDue} of ${m.dueBL} tasks due by the data date are complete.`,
      'Tasks are not being completed as planned.', 'A backlog of work builds up and future periods become overloaded.', 3, 4, 'Mitigate', 'Prepare a 3-week look-ahead to clear the backlog of overdue tasks.', []);
    const longCrit = crit.filter(x => x.rem > 44 && !acts[x.i].ms);
    if (longCrit.length) T('R13', 'Long critical activities', 'Schedule quality', `${longCrit.length} critical activities have more than 44 days remaining.`,
      'Insufficient breakdown.', 'Slippage inside the activity is not visible until it is too late.', 3, 3, 'Mitigate', 'Break these activities down by floor or zone.', longCrit);
    const critNoRes = crit.filter(x => !acts[x.i].ms && !String(acts[x.i].res || '').trim());
    if (critNoRes.length) T('R14', 'Unresourced critical work', 'Resources', `${critNoRes.length} critical activities have no resource assigned.`,
      'Crew or subcontractor not identified.', 'Mobilization is late on the critical path.', 3, 4, 'Mitigate', 'Assign responsible crews and subcontractors and confirm mobilization dates.', critNoRes);
    const oos = [];
    acts.forEach((a, i) => {
      if (!a.as) return;
      for (const p of (a.preds || [])) {
        const pa = acts.find(x => x.id === p.id);
        if (pa && p.t === 'FS' && (!pa.af || dn(pa.af) > dn(a.as))) { oos.push(a.id); break; }
      }
    });
    if (oos.length) T('R15', 'Out-of-sequence progress', 'Schedule quality', `${oos.length} activities started before their FS predecessors finished.`,
      'Work proceeded without following the planned logic.', 'Retained logic may forecast misleading dates and rework may be needed.', 2, 3, 'Mitigate', 'Correct the logic to reflect how the work is actually being done.', oos);
    const stalled = r.res.filter(x => x.st === 'IP' && dn(acts[x.i].bf) != null && dn(acts[x.i].bf) < r.ddDay && (+acts[x.i].pct || 0) < 50);
    if (stalled.length) T('R16', 'Stalled activities', 'Performance', `${stalled.length} in-progress activities are past their baseline finish with less than 50% complete.`,
      'Disruption, resource shortage or design issues.', 'Successors keep slipping.', 4, 3, 'Mitigate', 'Hold root-cause meetings and add resources.', stalled);
    if (m.cpli != null && m.cpli < 0.95) T('R17', 'Critical path not achievable', 'Time', `CPLI is ${m.cpli.toFixed(2)}, below 0.95.`,
      'Remaining critical work exceeds the time available.', 'The contract finish will be missed.', 4, 5, 'Mitigate', 'Approve an acceleration plan (see the Recovery tab).', crit);
    return out.sort((a, b) => b.score - a.score);
  }
  function rangeHits(x, fn) {
    const s = dn(x.start), f = dn(x.finish);
    if (s == null || f == null) return false;
    for (let d = s; d <= f; d += 3) if (fn(d)) return true;
    return fn(f);
  }

  /* ---------- Recommendations ---------- */
  function recommendations(project, acts, r, m, d, miss, rk) {
    const out = [];
    const add = (priority, area, text) => out.push({ priority, area, text });
    if (r.varianceDays > 0) add('Immediate', 'Time', `The forecast finish (${r.finish}) is ${r.varianceDays} calendar days late. Adopt a recovery schedule (see the Recovery tab) and notify the Engineer under the contract's delay clause.`);
    if (m.cpli != null && m.cpli < 0.95) add('Immediate', 'Time', `CPLI is ${m.cpli.toFixed(2)}. Accelerate the critical path by about ${Math.max(0, -m.floatToContract)} working days.`);
    for (const x of miss.filter(x => x.severity === 'High').slice(0, 6)) add('Immediate', 'Data', `Complete the missing data: ${x.item}. ${x.detail}`);
    for (const row of d.rows.filter(x => x.pass === false)) add(row.code === 7 || row.code === 12 ? 'Immediate' : 'Short term', `DCMA ${row.code} ${row.name}`, row.fix);
    for (const x of rk.filter(x => x.score >= 12).slice(0, 6)) add('Short term', `Risk ${x.rid}`, x.action);
    if (m.spi != null && m.spi < 0.95) add('Short term', 'Performance', `SPI is ${m.spi.toFixed(2)}. Raise production on critical fronts and issue a 3-week look-ahead with manpower targets.`);
    for (const x of miss.filter(x => x.severity !== 'High').slice(0, 5)) add('Continuous', 'Data', `${x.item}: ${x.detail}`);
    add('Continuous', 'Governance', 'Issue the schedule update and narrative every month at the agreed data date, and keep the approved baseline frozen.');
    return out;
  }

  function assess(project, acts) {
    const r = SANS.cpm(project, acts);
    const m = metrics(project, acts, r);
    const d = dcma(project, acts, r, m);
    const miss = missing(project, acts, r);
    const rk = risks(project, acts, r, m, d);
    const recs = recommendations(project, acts, r, m, d, miss, rk);
    const quality = Math.round(d.score * 0.7 + Math.max(0, 100 - miss.reduce((s, x) => s + (x.severity === 'High' ? 8 : x.severity === 'Medium' ? 4 : 1), 0)) * 0.3);
    const health = r.varianceDays == null ? 'Unknown' : r.varianceDays > 30 || (m.cpli != null && m.cpli < 0.9) ? 'Critical' : r.varianceDays > 0 || (m.spi != null && m.spi < 0.95) ? 'At risk' : 'On track';
    return { r, m, d, miss, rk, recs, quality, health };
  }

  Object.assign(SANS, { metrics, dcma, missing, risks, recommendations, assess, KW });
})(typeof window !== 'undefined' ? window : globalThis);
