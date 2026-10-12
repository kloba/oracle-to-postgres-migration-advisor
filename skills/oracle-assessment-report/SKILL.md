---
name: oracle-assessment-report
description: "Produces the Oracle to Azure PostgreSQL migration assessment as a PDF: recommendation card, all eight target families, estate profile, object inventory by class, what drives the effort, hotspots, extension allow-list, what the converter does not convert, effort range in cost units, data movement, validation, a generated prerequisite plan, cost levers and programmes, plus appendices that test the scan against a ground truth and list the sources. Charts are inline SVG with labels and textures so they print in greyscale. Trigger when the user asks for the assessment PDF, a migration report, results in a document, or 'generate the report for the Oracle schema'."
allowed-tools: Read, Grep, Glob, Bash
---

# Skill: Oracle assessment report (PDF)

## Description

Render the whole assessment as one document a customer can read and a reviewer can check. The report builder is `tools/report/build-report.mjs`: it computes the recommendation with the same engine the tests use, from the stated profile plus what the scan supplies, runs the 19-invariant self-check (and refuses to print if it fails), writes HTML, and prints the PDF with headless Chrome or Edge.

## Needs

- Node 20 or later.
- Google Chrome or Microsoft Edge installed. The builder starts it headless with **its own profile directory** (`/tmp/o2p-report-chrome`) and never touches a running browser or any tool that shares one. Without a browser it writes the HTML and says so; print that to PDF from a browser.
- A schema scan (`oracle-assess-schema`) and a profile JSON.

## Run

```bash
node tools/report/build-report.mjs \
  --assessment assessment.json --profile profile.json \
  --title "Contoso Store" --out report.pdf
```

Optional: `--calibration calibration.json --recall recall.json` add Appendices A and B. `--html-only` skips the PDF. For the worked example, `examples/contoso-store/run.sh` reproduces everything from the public lab.

## What the report holds

1. Executive summary: the target, the scan in four numbers, the five things most likely to hurt.
2. Recommendation: the card and the Phase A trace for all eight families.
3. Estate profile: each answer marked as stated, derived from the scan, or unknown.
4. Inventory by type and class.
5. What drives the effort: constructs by units, a category by class heat grid, the silent semantic traps.
6. Hotspots: the heaviest package bodies and other objects.
7. Target configuration: extensions to allow-list, settings that cannot change later.
8. Outside the converter: what the Microsoft tool does not convert, with the count found.
9. Effort and risk: the two paces, units by workstream, what a source scan cannot size.
10. Data movement: the offline routes Microsoft has and what the schema says the load must handle. **No Microsoft migration service moves Oracle rows, and Microsoft has no change-capture service: a downtime that needs one is shown as a gap, with no product named.**
11. Validation.
12. The generated prerequisite plan.
13. Cost levers, programmes, next actions, the retired list.
- Appendix A: the scan against the lab's declared hard cases, and where this catalog disagrees with the lab's own predictions.
- Appendix B: does the effort score predict what the converter did?
- Appendix C: method, scoring and limits.
- Appendix D: sources, grouped, each read on a stated date.

## Reading it honestly

- It is **preliminary and provisional**, and says so on the cover.
- The effort figure is two paces of Ora2Pg's own convention, not a quote and not an interval. The report also shows a second, assumption-based figure for AI-assisted conversion (section 9). Present it as a model, beside the manual figure, never alone.
- The report states where the scan is weak: units do not predict converter failures (AUC about 0.4), and some constructs are only found indirectly.
- Charts use a fixed status palette that is never the only signal: each class carries a label, a glyph and a texture, so the document survives greyscale printing and colour-blind readers.

## Checking the PDF

Render it and look. The builder checks the data, not the layout.

```bash
pdftoppm -r 62 -png report.pdf /tmp/pages
```

Look for clipped chart labels, tables that split with a lone row, and pages that are mostly empty.
