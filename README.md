# Oracle to PostgreSQL migration advisor

Which Azure PostgreSQL target should an Oracle estate assess first, how should its schema and PL/SQL be converted, how do the rows move, and how much of that work does the source code say is there?

This repository answers those questions in a way a reviewer can check. A short interview and a **static scan of the Oracle source** feed a versioned rule set; every verdict carries a rule ID, every fact carries a source and a date, and the answer is always **preliminary and provisional**. It also produces a **PDF assessment report**.

It is the Oracle counterpart of [fredgis/sql-migration-advisor](https://github.com/fredgis/sql-migration-advisor) (SQL Server to Azure) and follows its design. See [NOTICE](NOTICE).

> **Status.** Version 1.0.0. Facts were read from vendor documentation on **2026-10-12** and are listed with their pages in [`reference/sources.json`](reference/sources.json). A weekly job re-checks that the pages still resolve.

## Install

In Claude Code, add this repository as a plugin marketplace and install the plugin (the four skills are `oracle-recommend-migration-path`, `oracle-assess-schema`, `oracle-prerequisite-plan` and `oracle-assessment-report`):

```text
/plugin marketplace add kloba/oracle-to-postgres-migration-advisor
/plugin install oracle-to-postgres-migration-advisor@kloba
```

Or clone it and run the tools directly, which needs only Node 20 or later:

```bash
git clone https://github.com/kloba/oracle-to-postgres-migration-advisor.git
cd oracle-to-postgres-migration-advisor
node tests/run-tests.mjs
```

## What you get

| Piece | What it does | Where |
|---|---|---|
| **Recommendation skill** | Interview (or profile plus scan), then Phase A eligibility across eight target families, Phase B ranking, Phase C method routes (Microsoft's only, with gaps stated), Phase D card | `skills/oracle-recommend-migration-path`, `tools/advisor` |
| **Schema assessor** | Scans DDL and PL/SQL with no database connection. Scores each object in cost units (the convention Ora2Pg publishes) against 250+ catalogued constructs. Classes: CLEAN, PARTIAL, REVIEW, BLOCKER | `skills/oracle-assess-schema`, `tools/assess` |
| **Prerequisite plan** | Generates the checklist for the chosen path, by phase, with owners and a source for each step | `skills/oracle-prerequisite-plan`, `tools/plan` |
| **PDF report** | Recommendation, eight-family trace, inventory, hotspots, effort, data movement, validation, plan, sources, and appendices that test the scan against a ground truth | `skills/oracle-assessment-report`, `tools/report` |
| **Knowledge base** | The source-backed document the rules rest on | [`docs/oracle-to-azure-postgresql-migration.md`](docs/oracle-to-azure-postgresql-migration.md) |
| **Test suite** | About 200 checks, including thousands of random interviews run through the 19 self-check invariants | `tests/run-tests.mjs` |

Everything runs on Node 20 or later with **no dependencies**. The PDF needs Google Chrome or Microsoft Edge.

## Quick start

```bash
node tests/run-tests.mjs                       # the regression suite

# Reproduce the worked example: clone the public lab, scan 1,523 objects, build the PDF
examples/contoso-store/run.sh                  # -> examples/contoso-store/output/contoso-store-assessment.pdf

# Evaluate a profile and print the recommendation card
node tools/advisor/cli.mjs examples/contoso-store/profile.json \
  --scan examples/contoso-store/output/assessment.json --name "Contoso Store"

# Scan your own Oracle source, then build the checklist and the report
node tools/assess/oracle-assess.mjs path/to/ddl --name "My estate" --out assessment.json --summary
node tools/plan/cli.mjs my-profile.json --scan assessment.json --out plan.md
node tools/report/build-report.mjs --assessment assessment.json --profile my-profile.json --title "My estate" --out report.pdf
```

A profile is a JSON object of the fields in [`reference/input-contract.md`](reference/input-contract.md); every field is optional and an absent one is `UNKNOWN`, never "none". [`schemas/input.schema.json`](schemas/input.schema.json) describes it.

## How it decides

```text
 interview answers ─┐                        ┌─ Phase A  hard eligibility for all eight families
                    ├─► normalised profile ──┤  Phase B  rank the survivors (OP-INTENT, OP-MANAGEMENT, OP-RANK)
 schema scan ───────┘   (stable IDs,         │  Phase C  conversion and data-movement routes, gated; gaps stated
 (PL/SQL volume,         UNKNOWN is never    └─ Phase D  the card: blockers, unknowns, risk, next actions
  Oracle features)       "none")                      │
                                                      ▼
                          19 self-check invariants ─► card, JSON, prerequisite plan, PDF
```

The eight families: Azure Database for PostgreSQL **flexible server**, flexible server **elastic clusters**, **HorizonDB** (public preview, no SLA), **PostgreSQL on VMs**, **PostgreSQL on AKS**, Cosmos DB for PostgreSQL (retired for new work), **Oracle AI Database@Azure** and **Oracle on Azure VMs** (the honest answer when no PostgreSQL target survives). Each ends in `eligible`, `eligible_with_remediation`, `unsupported`, `excluded_by_preference` or `unknown_requires_assessment`. A target the customer set aside is never called unsupported. The alternative is always one of these eight and may be absent.

## Scope

The advisor is scoped to Microsoft's platform (it is not an official Microsoft product) and recommends Microsoft services, Microsoft-published tools and Azure-hosted offerings, and nothing else. Where Microsoft has no product for a step, the card says so and names none. That applies to two steps: **change data capture** (Microsoft has no change-capture service from Oracle to PostgreSQL, so a downtime of minutes is shown as a gap) and **schema converters for older Oracle releases** (the Microsoft converter lists Oracle 12.1 to 21c, so for 11g or older the card shows a gap). No answer of the interview can bring a product from another vendor back, and a self-check invariant scans the output for them. The Microsoft account team can say what options exist outside Microsoft.

## What it will not do

- **It will not say a Microsoft migration service moves Oracle rows to PostgreSQL.** There is none. Azure Database Migration Service has no Oracle to PostgreSQL scenario, and the Microsoft converter converts schema and code only. Microsoft's own routes copy rows offline (the Azure Data Factory Oracle connector, and `oracle_fdw`, a PostgreSQL extension Azure ships). A downtime that needs change capture is shown as a gap, and the advisor recommends no product for it.
- **It reads no artefact from your estate** (no AWR, no row counts, no application), so confidence never exceeds `medium` and the status is `provisional` or `shortlist`. Never `validated`.
- **It gives no cost figure.** A figure needs measured sizing and stated pricing assumptions. It names levers.
- **It does not present "Converted" as "equivalent".** Every converted object needs independent testing.
- **It does not recommend retired items** (Azure Data Studio, SSMA for Oracle as a route to PostgreSQL, Single Server, PostgreSQL 14 or older as a new target, and the rest of the list in the card).

## The worked example

[`examples/contoso-store`](examples/contoso-store) scans the public [Contoso Store lab](https://github.com/kloba/oracle-to-postgres-migration-lab): 1,523 Oracle objects, 25,498 lines of code, 90 package bodies. The advisor recommends **flexible server on PostgreSQL 17**, with the Microsoft converter for schema and code and an offline Data Factory copy for the rows. No other family survives the profile's answers, so no alternative is named. The report also shows where the scan is weak:

- It finds **92%** of the objects the lab itself declares for its 43 hard cases.
- Its effort units do **not** predict which objects Microsoft's converter failed on (AUC about 0.4). They estimate human time, and the report says so.
- Independent research disagrees with the lab's own predictions on nine cases, listed with the evidence.

The profile in that example is stated for demonstration. A real engagement replaces it.

## Repository layout

```text
skills/                 four skills: recommend, assess schema, prerequisite plan, assessment report
reference/              the single sources of truth
  input-contract.md       29 fields, stable IDs, UNKNOWN versus none
  output-contract.md      the answer's shape and 19 self-check invariants
  decision-rules.md       38 rule IDs and their index; decision-rules.data.json holds the numbers
  feature-matrix.json     27 Oracle features by 5 PostgreSQL targets, generated from tools/catalog
  compat-catalog.json     256 constructs with class, weight and PostgreSQL equivalent, generated
  prerequisite-catalog.json  the steps behind the plan
  sources.json            every cited page, with the date it was read
schemas/                JSON Schemas for the profile, the answer and the assessment
tools/                  advisor engine and card, assessor, catalog builders, plan, report, doc PDF, source check
tests/                  run-tests.mjs and the golden scenarios
docs/                   the knowledge base, the architecture, the PDF of the knowledge base
examples/contoso-store/ the worked example and its generated PDF
```

## Where to go next

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit, which file is the source of truth for what, and which test guards each one.
- [`docs/oracle-to-azure-postgresql-migration.md`](docs/oracle-to-azure-postgresql-migration.md): the knowledge base.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to change a rule, a construct or a fact.

## Credits and licence

MIT, see [LICENSE](LICENSE). The structure follows [fredgis/sql-migration-advisor](https://github.com/fredgis/sql-migration-advisor). The cost units follow the convention that [Ora2Pg](https://github.com/darold/ora2pg) publishes in its manual and cost tables; no Ora2Pg code is included, and the advisor does not recommend running the tool. The example schema is the [Contoso Store lab](https://github.com/kloba/oracle-to-postgres-migration-lab). Vendor names are trademarks of their owners; see [NOTICE](NOTICE).
