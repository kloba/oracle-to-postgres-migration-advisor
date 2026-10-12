# Architecture

## The shape

```text
                         reference/ (single sources of truth, checked by tests)
 ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 │ input-contract.md  output-contract.md  decision-rules.md + .data.json  sources.json        │
 │ feature-matrix.json   compat-catalog.json   prerequisite-catalog.json                      │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ generated from                ▲ read by                       ▲ read by
 tools/catalog/*-source.mjs       tools/advisor/engine.mjs        tools/assess/lib/analyze.mjs
 (authoring source, build.mjs)    (executable mirror of the       (static scan: mask, split,
                                   rules, selfCheck)               detect, score, classify)
                                        │                                │
                                        ▼                                ▼
                               recommendation object  ◄──────  assessment.json (plsql_volume,
                                        │                       oracle_features, constructs)
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
      render-card.mjs           tools/plan (steps)         tools/report (HTML, PDF)
      (Markdown card)           prerequisite plan          17 sections + appendices
```

## Source of truth for each thing

| What | Written in | Read by | Guarded by |
|---|---|---|---|
| The vocabulary of an interview | `reference/input-contract.md` | engine, schema generator, skill, tests | the generated `schemas/input.schema.json` must match; every ID in the skill must exist; every enumerated ID must be accepted without a note |
| The shape of an answer and its invariants | `reference/output-contract.md`, `schemas/output.schema.json` | engine, card, report | 19 invariants in `selfCheck`; each is tested by corrupting an answer and checking that it is caught |
| Targets, limits, dates, programmes | `reference/decision-rules.data.json` | engine, report, knowledge base blocks | rule IDs in the engine and in the index must agree; cited source IDs must resolve |
| Which Oracle features a target carries | `tools/catalog/feature-matrix-source.mjs` → `reference/feature-matrix.json` | engine (Phase A), plan, knowledge base | the generated JSON must equal a fresh build; every cell has a state, every non-native cell a note; adding features never improves a target |
| What a construct costs and how it classifies | `tools/catalog/catalog-source.mjs` + `research-entries.mjs` → `reference/compat-catalog.json` | assessor | pattern compiles, no empty matches, weight origin named, BLOCKER rare and remediated |
| Prerequisite steps | `reference/prerequisite-catalog.json` | plan, report | schema, sources resolve, each step conditioned on real fields, plan changes with the recommendation |
| Facts and their pages | `reference/sources.json` | everything that cites | HTTPS, unique, dated; weekly job checks the pages still resolve |

Generated files are never edited by hand. `node tools/catalog/build.mjs --check`, `node tools/schema/build-schemas.mjs --check` and `node tools/kb/build-kb.mjs --check` fail when a generated file differs from a fresh build.

## The engine

`tools/advisor/engine.mjs` implements the rules in `decision-rules.md`:

1. **Normalise** the profile: all 29 fields present, an absent field is `UNKNOWN`, a list answered `NOT_SURE` is unknown and not empty.
2. **Phase A** collects what each rule says about each of the eight families into a trace and reduces to the most severe state (`unsupported` over `excluded_by_preference` over `unknown_requires_assessment` over `eligible_with_remediation` over `eligible`). Feature verdicts come from the feature matrix, one aggregated entry per target.
3. **Phase B** picks the primary: intent, packaged ISV, management model, then the lowest score (3 per redesign when the application is limited, 1 otherwise, 0.25 per workaround, 1.5 per unknown, plus a preference penalty). If a better-ranked target is held on an unanswered question, the status is `shortlist` and no winner is invented. The alternative is always one of the eight families and may be absent.
4. **Phase C** enumerates every Microsoft method the matrix marks primary or secondary, gates the selected conversion and data routes against the profile, and records for each gate whether it passed, failed or could not be checked. Where Microsoft has no method (change capture, a converter for Oracle 11g or older) it records a gap in `methodGaps[]` and names no product (`OP-SCOPE`).
5. **Phase D** assembles blockers, unknowns, evidence, the largest risk, next actions, levers and programme fit.
6. **`selfCheck`** runs the 19 invariants, including the scan of the card for any product from outside Microsoft. The CLI and the report builder refuse to print a card that fails one, and name the invariant. An unproven gate is reported as `unknown_requires_assessment`, never `passed`.

The engine takes no clock, no network and no randomness, so two evaluations of one profile are identical (tested).

## The assessor

`tools/assess` is a static analyser for Oracle source text. The order matters:

1. **mask.mjs** blanks comments, string interiors and unambiguous SQL*Plus lines, keeping offsets and line breaks, so a pattern is never matched in a comment. `START WITH`, `CONNECT BY`, `EXIT WHEN` and `DESC` are code and stay.
2. **split.mjs** cuts statements (`;` for SQL, a `/` line for PL/SQL), recognises objects, recovers a statement that never terminated, finds objects created by `EXECUTE IMMEDIATE`, and records links between objects (a trigger and its table, a policy and its function).
3. **analyze.mjs** runs the catalogued patterns and metrics, scans package members by indentation, scores with Ora2Pg 25.0's model, classes each object by its worst construct, and summarises: totals, hotspots, extensions to allow-list, semantic traps, data-movement signals, hygiene.

4. **ai-effort.mjs** turns the same units into a second figure for the case where the Microsoft converter drafts the code and people review it. Each object carries `unitParts` (base, test, size, and the construct units by class), so the model can tell what a converter can draft (reading, rewriting, CLEAN and PARTIAL constructs), what needs a person's decision (REVIEW constructs) and what never shrinks (the test allowance, BLOCKER constructs, objects the converter does not read). It is a model with stated assumptions in `AI_ASSUMPTIONS`, not a measurement: a review costs 25% to 50% of the manual cost, a decision twice that, an unconverted object the full cost, and setup is 3 to 5 person-days. With a calibration file the unconverted rate is the measured one per object type; without one it is an assumed 20% to 40%. The figure never falls below its floor, and it is absent when the converter is unavailable. The report builder and the assess CLI both call it.

`tools/calibrate` tests the assessor against a ground truth when one exists: recall of the objects a lab declares for its hard cases, and the rank power of the effort units over a converter's recorded outcomes. Both are reported, including the finding that the units do not predict converter failures.

## The report and the documents

`tools/report/build-report.mjs` computes the recommendation itself (same engine), then renders HTML with inline SVG charts and prints it with headless Chrome or Edge in a dedicated profile directory (`/tmp/o2p-report-chrome`), so a running browser is never touched. Charts follow a fixed status palette that is never the only signal: each class has a label, a glyph and a hatch, so the document prints in greyscale. `tools/pdf/build-doc.mjs` prints any Markdown document the same way; the knowledge base PDF is made with it.

## Quality gates

`node tests/run-tests.mjs` covers, in order:

| Group | What it proves |
|---|---|
| catalog | generated JSON in sync; every construct well formed; BLOCKER is rare and remediated; Ora2Pg-origin weights are named |
| feature matrix and sources | every verdict present; every cited source resolves; unsourced verdicts counted |
| contract | the input contract lists the matrix features; the rule index and the engine agree; 19 invariants in the output contract |
| properties | thousands of random interviews: no exception, no invariant broken, deterministic, monotone in the features listed, no product from outside Microsoft ever named, no price and no certainty ever emitted, no retired item chosen |
| schemas | the input schema is generated from the contract; every random answer validates against the output schema |
| card and plan | the card keeps the honest wording on random interviews; the plan follows the recommendation and cites its sources |
| rules | bands, orderings and levers (PL/SQL volume, downtime family, the change-capture and schema-conversion gaps, cost levers, customer-managed keys) |
| self-check | each invariant catches a deliberately corrupted answer |
| assessor | masking, splitting, recovery, dynamic DDL, package state, Ora2Pg arithmetic, migration level |
| golden | hand-written scenarios with the expected outcome of each rule |
| report | the builder renders a complete document with no placeholder text |

A weekly workflow (`weekly-source-check.yml`) runs `tools/check-sources.mjs`: every page in the register must still resolve, and the register must have been read within 45 days.

## Known limits of the design

- The rules are an interpretation of vendor documentation read on one date. The knowledge base lists what is volatile and who could settle it.
- Some verdicts in the feature matrix rest on the author's reading and say so in their note; the test counts them.
- The preference penalty in `OP-RANK` is a stated judgement, not a measurement. It says, in numbers a reviewer can argue with, how much redesign work justifies leaving the managed first-party service.
- The assessor reads text. It does not see data volume, workload, the application or the Oracle dictionary, and a construct built from strings at run time is invisible to it unless it is created by an installer block.
