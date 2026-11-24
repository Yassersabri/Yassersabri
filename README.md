# SANS Schedule Control

A schedule review, assessment, recovery and reporting tool built for **SANS International** planning and project controls. It runs in any modern browser with no installation and no server.

## What it does

| Area | Capability |
|---|---|
| **Project register** | Records each project's contract data (code, client, consultant, sector, location, contract type and value, NTP, contract completion, data date, LD rate and cap, daily overheads, PM, planner), its work calendar, scope, a delay events record and an update history. Includes a company-wide portfolio view. |
| **Schedule import** | Primavera P6 `.xer`, MS Project `.xml`, and Excel CSV or pasted rows. A CSV template is included. Activities can also be added or edited in the tool. XER import picks the largest project in a multi-project file, reads the P6 calendar (work week and holidays), WBS tree, resources and costs, and handles UTF-8 or Arabic Windows-1256 encoding. |
| **XER export** | Writes a P6-importable XER of the updated schedule (Schedule and Report tabs) or of any recovery option (Recovery tab). It reuses the original P6 project, WBS, calendar and activity IDs, so the file can update the existing project in P6. It carries progress, remaining durations, early/late dates, total float, constraints, relationships with lags, resources and the calendar with holidays. In the shared page the .xer arrives inside a .zip; extract it before importing. |
| **Appearance** | A White / Black switch in the header. The white theme uses a low-glare sage-white palette for long working sessions. |
| **CPM engine** | Forward and backward pass with progress at the data date (retained logic), FS/SS/FF/SF links with lags, SNET/SNLT/FNET/FNLT/MSO/MFO constraints, and loop detection. |
| **Saudi calendars** | 5-day (Sun–Thu), 6-day (Sat–Thu) or 7-day week; Founding Day, National Day, Eid al-Fitr and Eid al-Adha; Hijri (Umm al-Qura) dates in reports. |
| **Review & assessment** | DCMA 14-point check, SPI, BEI and CPLI, a schedule quality score and an overall health rating. |
| **Missing information** | Extracts gaps in project data, baseline, WBS, durations, logic, resources, cost and progress statusing. |
| **Recommendations** | Prioritised actions (Immediate, Short term, Continuous) generated from the findings. |
| **Recovery** | A. Crashing · B. Fast-tracking · C. Extended work week · D. **Auto-recovery** (combined, stops at the target) · E. EOT route. Each option is recalculated by CPM, with its cost, savings (LD avoided and overheads saved), net benefit and risk. The recommended option is chosen automatically. |
| **Revised schedule** | A Gantt chart comparing the revised schedule with the pre-recovery forecast and baseline, a date-change register, CSV export, and **Adopt as revised schedule** (revision history is kept). |
| **Risk triggers** | 17 automatic triggers, including negative float, LD exposure, near-critical paths, merge points, Ramadan productivity, the summer midday work ban, long-lead procurement, authority approvals (Balady, Civil Defense, SEC, NWC), open ends, low SPI/BEI and out-of-sequence progress. Also a 5×5 heat map and an editable register with manual risks. |
| **Narrative report** | A monthly narrative covering the executive summary, project information, progress, critical path, milestones, DCMA results, data gaps, risks, recovery options, recommendations, the basis of the update and the delay events annex. Download it as HTML (opens in Word) or copy it as text. |

## Using it

1. Open `index.html` in a browser (Chrome or Edge recommended).
2. **Portfolio → New project**, then fill in **Project data** (fields marked * drive the calculations).
3. **Schedule → Import** the P6, MSP or CSV file.
4. Work through **Review**, **Recovery** (adopt a revision if approved), **Risks** and **Report**.
5. **Save project.**

Open the *Example project* to see a worked case: a Riyadh B+G+4 building that is 49 days late with −36 days of float.

### Where data is stored
- **Shared company page (claude.ai artifact):** projects are saved in the shared company register, so everyone with access sees the same portfolio. Large schedules are split across several records automatically.
- **Local file:** projects are saved in this browser's storage. Use *Download backup (.json)* and *Import backup* to move projects between machines.

## Files

```
index.html        UI layout and styles
js/engine.js      dates, KSA calendars, CPM, XER/XML/CSV importers, CSV export
js/analysis.js    DCMA 14-point, metrics, missing info, risk triggers, recommendations
js/recovery.js    crashing, fast-tracking, calendar, auto-recovery, EOT options
js/report.js      narrative report generator
js/sample.js      built-in example project
js/app.js         application: storage, views, editors
```

## Notes and assumptions
- Durations are in working days and variances are in calendar days.
- The Eid holiday dates are approximate. Confirm them each year against the Umm al-Qura calendar, or add exact dates under *Additional non-working days*.
- XER target dates are loaded as baseline dates. Replace them with the approved baseline if it is held separately.
- Recovery costs use transparent default assumptions (shown on each option), which you can adjust on the Recovery tab.
