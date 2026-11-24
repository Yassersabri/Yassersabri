/* SANS Schedule Control — narrative report generator
 * Produces the monthly schedule narrative as HTML (in-app preview and a standalone
 * document that opens in Word or a browser) and as plain text.
 */
(function (root) {
  'use strict';
  const SANS = root.SANS;
  const { dn } = SANS;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sar = v => v == null || v === '' ? '—' : 'SAR ' + Math.round(+v).toLocaleString('en-US');
  const fmt = d => { if (!d) return '—'; const t = new Date(d + 'T00:00:00Z'); return t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
  const hijri = d => { try { return d ? new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z')) : ''; } catch (e) { return ''; } };
  const n1 = v => v == null ? '—' : (+v).toFixed(1);
  const n2 = v => v == null ? '—' : (+v).toFixed(2);

  function drivingPath(acts, r) {
    return r.critical.slice().sort((a, b) => a.es - b.es || a.ef - b.ef).map(x => ({ id: x.id, name: acts[x.i].name, start: x.start, finish: x.finish, tf: x.tf, rem: x.rem }));
  }

  function build(project, acts, A, R, register) {
    const P = project, r = A.r, m = A.m;
    const path = drivingPath(acts, r);
    const late = (r.varianceDays || 0) > 0;
    const rec = R && R.recommended;
    const st = { C: 0, IP: 0, NS: 0 }; r.res.forEach(x => st[x.st]++);
    const ms = acts.map((a, i) => ({ a, x: r.res[i] })).filter(o => o.a.ms);
    const topRisks = (register || A.rk).filter(x => (x.status || 'Open') !== 'Closed').slice(0, 8);
    const today = new Date().toISOString().slice(0, 10);
    const pathTxt = path.length ? path.slice(0, 8).map(p => `${p.id} ${p.name}`).join(' → ') + (path.length > 8 ? ` → … (${path.length} activities)` : '') : 'not identified';
    const causes = [];
    if (m.spi != null && m.spi < 0.95) causes.push(`progress is behind plan (SPI ${n2(m.spi)})`);
    const slipped = acts.map((a, i) => ({ a, x: r.res[i] })).filter(o => o.a.bf && o.x.st !== 'NS' && dn(o.x.finish) - dn(o.a.bf) > 10).sort((p, q) => (dn(q.x.finish) - dn(q.a.bf)) - (dn(p.x.finish) - dn(p.a.bf))).slice(0, 3);
    if (slipped.length) causes.push('the largest slippages are on ' + slipped.map(o => `${o.a.id} ${o.a.name} (+${dn(o.x.finish) - dn(o.a.bf)} days)`).join(', '));
    if (A.rk.some(x => x.rid === 'R08')) causes.push('authority approvals and utility connections sit on low-float paths');

    const S = [];
    S.push(['1. Executive summary', `
      <p>As of the data date <b>${fmt(P.dataDate)}</b> (${esc(hijri(P.dataDate))}), <b>${esc(P.name || 'the project')}</b> is forecast to complete on <b>${fmt(r.finish)}</b>
      against a contract completion date of <b>${fmt(P.contractFinish)}</b>. ${late ? `This is a delay of <b>${r.varianceDays} calendar days</b>, with total float of ${r.minTF} working days on the critical path.` : r.varianceDays != null ? `The project holds <b>${-r.varianceDays} calendar days</b> of margin against the contract date.` : 'No contract completion date is recorded, so the variance cannot be measured.'}
      Overall schedule health is rated <b>${esc(A.health)}</b>, and the schedule quality score is <b>${A.quality}/100</b> (DCMA ${A.d.score}%).</p>
      <p>Physical progress is <b>${n1(m.actual)}%</b> against <b>${n1(m.planned)}%</b> planned (SPI ${n2(m.spi)}, BEI ${n2(m.bei)}, CPLI ${n2(m.cpli)}).
      ${causes.length ? 'The main reasons for the current position: ' + esc(causes.join('; ')) + '.' : ''}
      ${late && m.ldExposure ? `The delay damages exposure at the contract rate is <b>${sar(m.ldExposure)}</b>.` : ''}</p>
      ${rec ? `<p>The recommended recovery is <b>${esc(rec.name)}</b>. It forecasts completion on <b>${fmt(rec.finish)}</b> (${rec.recovered} days recovered) at an estimated cost of <b>${sar(rec.cost)}</b> and a net benefit of <b>${sar(rec.net)}</b>.</p>` : ''}`]);

    S.push(['2. Project information', table(['Item', 'Detail'], [
      ['Project code', P.code], ['Project name', P.name], ['Client', P.client], ['Consultant', P.consultant], ['Location', P.location], ['Sector', P.sector],
      ['Contract type', P.contractType], ['Contract value', P.contractValue ? sar(P.contractValue) : '—'], ['Start / NTP', fmt(P.start)], ['Contract completion', fmt(P.contractFinish)],
      ['Data date', `${fmt(P.dataDate)} (${hijri(P.dataDate)})`], ['Work calendar', (SANS.WEEKS[(P.calendar || {}).week] || SANS.WEEKS['6d']).label + ((P.calendar || {}).ksaHolidays !== false ? ', KSA public holidays' : '')],
      ['Delay damages', P.ldRate ? `${sar(P.ldRate)} per day, capped at ${P.ldCapPct || '—'}%` : '—'], ['Project manager', P.pm], ['Planning engineer', P.planner],
    ].map(x => [x[0], x[1] || '—']))]);

    S.push(['3. Progress status', `
      <p>${st.C} activities are complete, ${st.IP} are in progress and ${st.NS} have not started (${acts.length} in total). ${m.timeElapsed != null ? `Contract time elapsed is ${n1(m.timeElapsed)}% against ${n1(m.actual)}% physical progress.` : ''}</p>` +
      table(['Indicator', 'Value', 'Threshold', 'Status'], [
        ['Planned progress', n1(m.planned) + '%', '', ''], ['Actual progress', n1(m.actual) + '%', '', ''],
        ['SPI (schedule performance)', n2(m.spi), '≥ 0.95', m.spi == null ? '—' : m.spi >= 0.95 ? 'OK' : 'Below'],
        ['BEI (baseline execution)', n2(m.bei), '≥ 0.95', m.bei == null ? '—' : m.bei >= 0.95 ? 'OK' : 'Below'],
        ['CPLI (critical path length)', n2(m.cpli), '≥ 0.95', m.cpli == null ? '—' : m.cpli >= 0.95 ? 'OK' : 'Below'],
        ['Float to contract finish', m.floatToContract != null ? m.floatToContract + ' wd' : '—', '≥ 0', m.floatToContract == null ? '—' : m.floatToContract >= 0 ? 'OK' : 'Negative'],
      ])]);

    S.push(['4. Critical path analysis', `
      <p>The critical path (lowest total float, ${r.minTF} working days) runs through: ${esc(pathTxt)}.
      ${A.r.loops.length ? `<b>Warning:</b> logic loops were found (${esc(A.r.loops.join(', '))}).` : ''}</p>` +
      table(['Activity', 'Description', 'Start', 'Finish', 'Rem. dur', 'Total float'], path.slice(0, 25).map(p => [p.id, p.name, fmt(p.start), fmt(p.finish), p.rem, p.tf]))]);

    if (ms.length) S.push(['5. Key milestones', table(['Milestone', 'Baseline', 'Forecast / actual', 'Variance (days)', 'Status'], ms.map(o => {
      const v = o.a.bf ? dn(o.x.finish) - dn(o.a.bf) : null;
      return [`${o.a.id} ${o.a.name}`, fmt(o.a.bf), fmt(o.x.finish), v == null ? '—' : (v > 0 ? '+' : '') + v, o.x.st === 'C' ? 'Achieved' : v > 0 ? 'Late' : 'On time'];
    }))]);

    S.push(['6. Schedule quality assessment (DCMA 14-point)', `<p>${A.d.rows.filter(x => x.pass === true).length} of ${A.d.rows.filter(x => x.pass !== null).length} applicable checks pass (score ${A.d.score}%).</p>` +
      `<p class="small">Basis: DCMA 14-Point Schedule Assessment. Total Tasks = ${A.d.totalTasks} incomplete tasks (excluding completed tasks, milestones, LOE and summary activities); total relationships = ${A.d.totalRels} (links touching incomplete tasks). Durations and float are in working days.</p>` +
      table(['#', 'Check', 'DCMA criterion', 'Count', 'Result', 'Threshold', 'Status'], A.d.rows.map(x => [x.code, x.name, x.metric, x.count, x.value === '—' ? '—' : x.value + x.unit, x.threshold, x.pass == null ? 'N/A' : x.pass ? 'Pass' : 'Fail'])) +
      (A.d.rows.some(x => x.pass === false) ? table(['#', 'Failed check', 'Corrective action', 'Activities'], A.d.rows.filter(x => x.pass === false).map(x => [x.code, x.name, x.fix, x.items.slice(0, 12).join(', ') + (x.items.length > 12 ? ` … (+${x.items.length - 12})` : '')])) : '')]);

    S.push(['7. Missing information and data gaps', A.miss.length ? table(['Severity', 'Area', 'Item', 'Detail'], A.miss.map(x => [x.severity, x.area, x.item, x.detail + (x.ids.length ? ` (${x.ids.slice(0, 8).join(', ')}${x.ids.length > 8 ? '…' : ''})` : '')])) : '<p>No missing information was detected.</p>']);

    S.push(['8. Risk triggers and register', topRisks.length ? table(['ID', 'Risk', 'Trigger', 'P×I', 'Response', 'Owner', 'Status'], topRisks.map(x => [x.rid, x.title, x.trigger, `${x.prob}×${x.impact}=${x.prob * x.impact}`, x.action, x.owner || P.planner || '—', x.status || 'Open'])) : '<p>No risks were triggered.</p>']);

    if (R) S.push(['9. Recovery options', `<p>Target completion date: <b>${fmt(R.target)}</b>. Current forecast: <b>${fmt(R.base.finish)}</b>.</p>` +
      table(['Option', 'Forecast finish', 'Days recovered', 'Meets target', 'Est. cost', 'Net benefit', 'Risk'], R.options.map(o => [o.name + (o.recommended ? ' (recommended)' : ''), fmt(o.finish), o.recovered, o.meets == null ? 'Entitlement' : o.meets ? 'Yes' : 'No', sar(o.cost), sar(o.net), o.risk])) +
      (rec ? `<p><b>Recommended: ${esc(rec.name)}.</b> ${esc(rec.desc)}</p>` + (rec.log.length ? table(['Activity', 'Measure', 'Change', 'Means'], rec.log.slice(0, 30).map(l => [l.id + ' ' + (l.name || ''), l.kind, l.change, l.how])) : '') +
        `<p class="small">Assumptions: ${esc(rec.assumptions.join(' '))}</p>` : '')]);

    S.push([R ? '10. Recommendations and actions' : '9. Recommendations and actions', table(['Priority', 'Area', 'Action'], A.recs.map(x => [x.priority, x.area, x.text]))]);
    S.push([R ? '11. Basis of the update' : '10. Basis of the update', `<p>Schedule calculated using the Critical Path Method with retained logic from the data date. Calendar: ${esc((SANS.WEEKS[(P.calendar || {}).week] || SANS.WEEKS['6d']).label)}; KSA public holidays (Founding Day, Eid al-Fitr, Eid al-Adha, National Day) ${(P.calendar || {}).ksaHolidays !== false ? 'are' : 'are not'} applied. Hijri-based holiday dates are approximate and should be confirmed against the Umm al-Qura calendar. Durations are in working days and variances are in calendar days. Prepared on ${fmt(today)} by ${esc(P.planner || 'Planning Department')}, SANS International.</p>`]);

    const body = S.map(([h, c]) => `<section><h2>${esc(h)}</h2>${c}</section>`).join('\n');
    const head = `<header class="rh"><div class="org">SANS International · Planning &amp; Project Controls</div><h1>Schedule narrative report</h1>
      <div class="meta">${esc(P.code || '')} · ${esc(P.name || '')} · Data date ${fmt(P.dataDate)} · Health: ${esc(A.health)}</div></header>`;
    return { html: head + body, sections: S };
  }

  function table(h, rows) {
    return `<div class="tw"><table><thead><tr>${h.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function standalone(inner, title) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Calibri,"Segoe UI",Arial,sans-serif;color:#1d2a33;max-width:960px;margin:24px auto;padding:0 24px;line-height:1.5;font-size:11pt}
h1{font-size:20pt;margin:4px 0}h2{font-size:13pt;color:#0f5f5f;border-bottom:2px solid #0f5f5f;padding-bottom:3px;margin-top:22px}
.org{font-size:9pt;letter-spacing:.08em;text-transform:uppercase;color:#5b6b75}.meta{color:#5b6b75}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt}th,td{border:1px solid #c9d3d8;padding:4px 6px;text-align:left;vertical-align:top}th{background:#e7eff0}
.small{font-size:9pt;color:#5b6b75}</style></head><body>${inner}</body></html>`;
  }

  function toText(sections) {
    const strip = h => h.replace(/<\/(p|tr|h2)>/g, '\n').replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n');
    return sections.map(([h, c]) => h.toUpperCase() + '\n' + strip(c).trim()).join('\n\n');
  }

  Object.assign(SANS, { buildReport: build, reportStandalone: standalone, reportText: toText, esc, fmtDate: fmt, hijri, sar });
})(typeof window !== 'undefined' ? window : globalThis);
