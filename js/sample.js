/* SANS Schedule Control — built-in sample project (example data only, never saved unless the user chooses to). */
(function (root) {
  'use strict';
  const SANS = root.SANS;

  // [id, name, wbs, duration, predecessors, resources, cost SAR, milestone]
  const ROWS = [
    ['M1000', 'Notice to Proceed', '1 Milestones', 0, '', '', null, 1],
    ['A1010', 'Mobilization & site establishment', '2 Engineering & Approvals', 20, 'M1000', 'Site Team', 450000],
    ['A1020', 'Shop drawings – structural', '2 Engineering & Approvals', 25, 'M1000', 'Design Office', 180000],
    ['A1030', 'Shop drawings – MEP', '2 Engineering & Approvals', 35, 'A1020SS+10', 'Design Office', 220000],
    ['A1040', 'Balady building permit & Civil Defense approval', '2 Engineering & Approvals', 30, 'M1000', 'PM Office', 60000],
    ['A1050', 'Material submittals & approvals', '2 Engineering & Approvals', 30, 'A1020', 'Design Office', 90000],
    ['A1060', 'Value engineering proposal', '2 Engineering & Approvals', 15, 'A1020', '', null],
    ['P1010', 'Procure rebar & structural steel', '3 Procurement', 40, 'A1050', 'Procurement', 3200000],
    ['P1020', 'Procure MEP long-lead (chillers, switchgear, generator)', '3 Procurement', 120, 'A1030', 'Procurement', 6500000],
    ['P1030', 'Procure curtain wall & facade system', '3 Procurement', 110, 'A1050', 'Procurement', 4100000],
    ['P1040', 'Procure elevators', '3 Procurement', 150, 'A1050', 'Procurement', 2300000],
    ['C1010', 'Excavation & shoring', '4 Substructure', 30, 'A1010; A1040', 'Earthworks Crew', 1400000],
    ['C1020', 'Dewatering & piling', '4 Substructure', 35, 'C1010SS+10', 'Piling Subcontractor', 2100000],
    ['C1030', 'Raft foundation concrete pour', '4 Substructure', 25, 'C1020; P1010', 'Concrete Crew', 2800000],
    ['C1040', 'Basement walls & waterproofing', '4 Substructure', 30, 'C1030', 'Concrete Crew', 1600000],
    ['C1050', 'Backfilling & compaction', '4 Substructure', 15, 'C1040', 'Earthworks Crew', 300000],
    ['S1010', 'Ground floor columns & slab', '5 Superstructure', 20, 'C1040', 'Concrete Crew', 1500000],
    ['S1020', '1st floor columns & slab', '5 Superstructure', 18, 'S1010', 'Concrete Crew', 1300000],
    ['S1030', '2nd floor columns & slab', '5 Superstructure', 18, 'S1020', 'Concrete Crew', 1300000],
    ['S1040', '3rd floor columns & slab', '5 Superstructure', 18, 'S1030', 'Concrete Crew', 1300000],
    ['S1050', '4th floor columns & slab', '5 Superstructure', 18, 'S1040', 'Concrete Crew', 1300000],
    ['S1060', 'Roof slab & roof waterproofing', '5 Superstructure', 20, 'S1050', 'Concrete Crew', 1100000],
    ['M1010', 'Structure complete', '1 Milestones', 0, 'S1060', '', null, 1],
    ['E1010', 'MEP first fix – basement & ground floor', '6 MEP', 30, 'S1010; A1030', 'MEP Subcontractor', 1900000],
    ['E1020', 'MEP first fix – typical floors', '6 MEP', 60, 'E1010; S1040', 'MEP Subcontractor', 3600000],
    ['E1030', 'Install chillers, switchgear & generator', '6 MEP', 35, 'P1020; S1060', 'MEP Subcontractor', 1200000],
    ['E1040', 'MEP second fix & terminations', '6 MEP', 45, 'E1020; F1020SS+15', 'MEP Subcontractor', 2400000],
    ['F1010', 'Blockwork & plastering', '7 Finishes & Facade', 70, 'S1030', 'Finishing Crew', 2200000],
    ['F1020', 'Ceilings, flooring & painting', '7 Finishes & Facade', 80, 'F1010SS+20; E1020SS+20', 'Finishing Crew', 4800000],
    ['F1030', 'Curtain wall & facade installation', '7 Finishes & Facade', 60, 'P1030; S1060', 'Facade Subcontractor', 2600000],
    ['F1040', 'Elevator installation', '7 Finishes & Facade', 50, 'P1040; M1010', 'Elevator Supplier', 900000],
    ['X1010', 'External utilities (SEC & NWC connections)', '8 External Works', 40, 'C1050', 'MEP Subcontractor', 1100000],
    ['X1020', 'Landscaping, paving & asphalt', '8 External Works', 35, 'X1010; F1030', 'Earthworks Crew', 1300000],
    ['X1030', 'SEC permanent power energization', '8 External Works', 20, 'X1010; E1030', 'PM Office', 150000],
    ['T1010', 'MEP testing & commissioning', '9 Testing & Handover', 30, 'E1040; E1030; X1030', 'MEP Subcontractor', 700000],
    ['T1020', 'Civil Defense inspection & occupancy certificate', '9 Testing & Handover', 20, 'T1010; F1040', 'PM Office', 80000],
    ['T1030', 'Snagging & de-snagging', '9 Testing & Handover', 20, 'F1020; F1030; T1010SS+10', 'Finishing Crew', 350000],
    ['M1020', 'Substantial completion & handover', '1 Milestones', 0, 'T1020; T1030; X1020', '', null, 1],
  ];
  // Slip factors used to simulate what actually happened on site up to the data date
  const SLIP = { A1040: 1.8, A1050: 1.3, C1010: 1.25, C1020: 1.2, C1030: 1.3, P1030: 1.15, S1010: 1.2, A1030: 1.25 };

  function build() {
    const info = {
      id: 'sample-riyadh-hq', sample: true,
      code: 'SANS-RUH-2601', name: 'Riyadh Commercial HQ Building (B+G+4)', client: 'Example Client – Real Estate Developer',
      sector: 'Private', location: 'Riyadh – Al Malqa', contractType: 'Lump Sum (FIDIC Red Book)', contractValue: 68000000,
      start: '2026-01-04', dataDate: '2026-11-15', contractFinish: '', ldRate: 34000, ldCapPct: 10, dailyIndirect: 18000,
      pm: 'Project Manager (example)', planner: 'Planning Engineer (example)', consultant: 'Supervision Consultant (example)',
      calendar: { week: '6d', ksaHolidays: true, holidays: [] }, reportingCycle: 'Monthly',
    };
    const base = ROWS.map(r => ({
      id: r[0], name: r[1], wbs: r[2], dur: r[3], rem: null, pct: 0, as: '', af: '', bs: '', bf: '',
      res: r[5], cost: r[6], cons: '', consDate: '', ms: !!r[7], preds: SANS.parsePreds(r[4]),
    }));
    base.find(a => a.id === 'X1010').cons = 'SNET'; base.find(a => a.id === 'X1010').consDate = '2026-08-01';
    base.find(a => a.id === 'A1040').preds = [{ id: 'M1000', t: 'FS', lag: 5 }];
    // baseline = unprogressed schedule from project start
    const bl = SANS.cpm({ start: info.start, dataDate: info.start, calendar: info.calendar }, base);
    base.forEach((a, i) => { a.bs = bl.res[i].start; a.bf = bl.res[i].finish; });
    info.contractFinish = bl.finish;
    // simulate actual progress with slips
    const sim = base.map(a => Object.assign({}, a, { dur: Math.round(a.dur * (SLIP[a.id] || 1.05)) }));
    const sr = SANS.cpm({ start: info.start, dataDate: info.start, calendar: info.calendar }, sim);
    const dd = SANS.dn(info.dataDate);
    base.forEach((a, i) => {
      const r = sr.res[i], s = SANS.dn(r.start), f = SANS.dn(r.finish);
      if (f < dd) { a.as = r.start; a.af = r.finish; a.pct = 100; a.rem = 0; }
      else if (s < dd) {
        a.as = r.start;
        const done = sr.cal.ceilIdx(dd) - sr.cal.ceilIdx(s);
        const simDur = sim[i].dur || 1;
        a.pct = Math.min(95, Math.round(done / simDur * 100));
        a.rem = Math.max(1, simDur - done);
      }
    });
    return { info, activities: base, risks: [], revisions: [], log: [] };
  }
  SANS.sampleProject = build;
})(typeof window !== 'undefined' ? window : globalThis);
