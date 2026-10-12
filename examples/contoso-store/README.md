# Worked example: Contoso Store

The [Contoso Store lab](https://github.com/kloba/oracle-to-postgres-migration-lab) is a public Oracle schema built to be hard to convert: 1,185 objects across tables, views, 90 package bodies, triggers, scheduler jobs, VPD policies and more, plus 43 declared hard cases. The advisor scans its source and produces the assessment.

```bash
examples/contoso-store/run.sh
```

The script clones the lab into `.cache/` (or uses `O2P_LAB=/path/to/checkout`), regenerates the lab's 792 seeded objects, scans everything, calibrates against the lab's own converter run and hard-case list, and builds the PDF.

| File | What it is |
|---|---|
| `profile.json` | The interview answers. **Stated for demonstration**, from what the lab's documentation says: an on-premises single instance on Oracle 23ai, a customer that wants a managed service, a limited-change application, EU data boundary, public preview refused. A real engagement replaces them. |
| `output/contoso-store-assessment.pdf` | The report. |
| `output/contoso-store-assessment.html` | The same report as HTML. |
| `output/assessment.json`, `calibration.json`, `recall.json` | Generated, ignored by git. Run the script to rebuild them. |

The scan supplies `plsql_volume` and `oracle_features`; where they conflict with `profile.json`, the scan wins.

## What to look at in the PDF

- **Section 2** shows all eight families and the rule that decided each one.
- **Section 5** and **6** show what drives the effort and the package bodies that carry the risk.
- **Section 9** puts the manual effort (133 to 265 person-days) beside an assumption-based figure for AI-assisted conversion, with the assumptions, a breakdown by workstream and a sensitivity table. The second figure uses the converter's measured not-converted rates from `output/calibration.json`.
- **Section 12** is the generated prerequisite plan.
- **Appendix A** tests the scan against the lab's declared hard cases, and lists the nine places where independent research disagrees with the lab's own predictions.
- **Appendix B** shows that the effort units do not predict which objects Microsoft's converter failed on.
