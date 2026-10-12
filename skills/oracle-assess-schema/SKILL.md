---
name: oracle-assess-schema
description: "Static assessment of an Oracle schema from its DDL and PL/SQL source files. Scans scripts with no database connection, scores every object against 250+ catalogued Oracle constructs in Ora2Pg's cost units (5 minutes each, 84 per person-day), classifies each object CLEAN, PARTIAL, REVIEW or BLOCKER for PostgreSQL, finds package state, autonomous transactions, VPD, scheduler chains, silent semantic traps and extensions to allow-list, and writes a JSON assessment that supplies plsql_volume and oracle_features to the recommendation skill. Trigger when the user has Oracle DDL, a schema export, SQL or PL/SQL files, a repository of Oracle scripts, or asks 'how hard is this Oracle schema to migrate to PostgreSQL', 'scan my Oracle code', 'how many PL/SQL lines', or 'estimate the effort for Oracle to Postgres'."
allowed-tools: Read, Grep, Glob, Bash
---

# Skill: Assess an Oracle schema from source

## Description

Read Oracle DDL and PL/SQL source files and report, object by object, what will and will not convert to PostgreSQL. The scan needs **no database connection**: it reads text. That is its strength (a customer can run it on an export they already have) and its limit (it cannot see data volume, workload, performance, the application or the Oracle data dictionary).

The scan is `tools/assess/oracle-assess.mjs`. It needs Node 20 or later and nothing else.

## When to use

- The user has `.sql`, `.pls`, `.pks`, `.pkb`, `.tps`, `.tpb`, `.trg`, `.vw`, `.ddl`, `.prc` or `.fnc` files, or a repository of them.
- Before `oracle-recommend-migration-path`: the scan supplies `plsql_volume` and `oracle_features`, so the interview does not have to ask.
- The user wants a defensible effort range in Ora2Pg's own units, or the list of constructs that will not convert mechanically.

Do not use it to size a target (compute, IOPS, storage). That needs AWR or ASH data, which is not in the source.

## Getting the source

If the user has no files, tell them how to export without giving a connection to anyone else:

- **SQLcl:** `ddl` for each object, or `DBMS_METADATA.GET_DDL` in a spool file.
- **SQL Developer:** Export DDL.

Ask for grants, synonyms, jobs, VPD policies and materialized view definitions as well. A scan of tables alone says little.

## Run

```bash
node tools/assess/oracle-assess.mjs <file-or-dir>... --name "Contoso Store" --schema CONTOSO --out assessment.json --summary
```

`--summary` prints the object counts, class split, effort, level and the top constructs. The JSON is described by `schemas/assessment.schema.json`.

## What it does

1. **Masks** comments, string interiors and SQL*Plus commands, keeping offsets and line breaks, so a match is never found in a comment. Only unambiguous SQL*Plus lines are removed: `START WITH`, `CONNECT BY`, `EXIT WHEN` and `DESC` are code.
2. **Splits** statements. Plain SQL ends at `;`. PL/SQL ends at a `/` line. A statement that reaches the next `CREATE` without ending is recovered and flagged. Objects built by `EXECUTE IMMEDIATE` in installer blocks are found and marked dynamic.
3. **Detects** constructs: patterns, plus computed metrics (package state, overloads, string `IS NULL` tests, columns typed with VARRAY or object types).
4. **Scores** with Ora2Pg 25.0's model: a routine costs 1, plus 2 to test, plus 1 per 1,000 characters, plus its constructs. 54 catalogued weights are Ora2Pg's own; the rest are marked `advisor`.
5. **Classes**: `CLEAN` mechanical; `PARTIAL` converts but may drift; `REVIEW` needs a design decision or a hand rewrite; `BLOCKER` has no supported equivalent on flexible server. A semantic note that is true of nearly every object (for example `||` with NULL) is counted but does not move an object out of `CLEAN`.

## Reading the result

- **The effort is a range from two paces, not a statistical interval.** 5 minutes per unit is an expert's pace; 10 is Ora2Pg's suggestion for a first migration. It covers reading and rewriting schema and PL/SQL and a basic test per routine. It does not cover data movement, performance tuning, application changes, testing at scale or cutover.
- **A second figure covers AI-assisted conversion.** The assess CLI prints it, and the report shows both side by side. It counts the same units after the Microsoft converter drafts the code and people review it. It is a model with stated assumptions (`tools/assess/lib/ai-effort.mjs`), not a measurement, and no vendor publishes a productivity figure. Most of what remains is testing and design decisions, which AI does not remove. With a calibration file the model uses the converter's measured not-converted rate; without one it assumes 20% to 40%. The 10 to 15 object pilot measures the real review cost for the estate. Say so, and do not quote the lower figure without the manual one beside it.
- **The score does not predict a converter's failures.** Calibrated against Microsoft's converter on the Contoso Store lab, the AUC is 0.41: the failures follow dependency cascades and best-effort flags more than difficulty. The units estimate human time. Do not present them as a tool-success predictor.
- **Package bodies carry the risk.** Look at package state, autonomous transactions, `UTL_FILE`, `DBMS_SCHEDULER`, VPD and object types first.
- **Hygiene findings are real findings.** Statements that never terminate and objects created by dynamic DDL mean a scan of top-level statements alone would be wrong.
- **State the limits.** The JSON carries `limitations[]`. Repeat the ones that matter to the user's decision.

## Hand over

1. Show the object counts, the class split and the effort range.
2. Name the five constructs most likely to hurt, with object counts.
3. Pass the assessment to `oracle-recommend-migration-path` (`--scan assessment.json`) and offer `oracle-assessment-report` for the PDF.

## Calibration and recall

When a ground truth exists (the Contoso Store lab declares which objects carry each of its 43 hard cases and publishes a per-object converter result), `tools/calibrate/` measures how the scan compares:

```bash
node tools/calibrate/hard-case-recall.mjs assessment.json design.md --out recall.json
node tools/calibrate/join-conversion.mjs assessment.json object_mapping_summary.csv --out calibration.json
```

On the lab the scan finds 92% of the objects the lab declares, and the effort units have weak ranking power over converter failures. Both results are in Appendices A and B of the report.
