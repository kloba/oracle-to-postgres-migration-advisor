---
name: oracle-recommend-migration-path
description: "Preliminary Oracle to Azure PostgreSQL migration disposition and recommended assessment path. Runs a short guided interview (or takes a profile and a schema scan), then applies a source-backed knowledge base and a versioned rule set to pre-select the target (Azure Database for PostgreSQL flexible server, elastic clusters, HorizonDB preview, PostgreSQL on VMs or AKS, or Oracle kept on Azure), the Microsoft conversion and data-movement routes (and the gaps where Microsoft has no product), blockers, evidence gaps, cost levers and Microsoft programme fit, with a rule ID behind every verdict. It recommends Microsoft services only. Trigger when the user wants to migrate or modernize Oracle Database to PostgreSQL on Azure, asks which Azure target or tool fits an Oracle workload, wants to leave Oracle licensing, or says 'migrate Oracle to PostgreSQL', 'Oracle to Azure', 'migrer Oracle vers PostgreSQL' or 'replace Oracle with Postgres'."
allowed-tools: AskUserQuestion, Read, Grep, Glob, Bash
---

# Skill: Recommend an Oracle to PostgreSQL migration path

## Description

Give the user a **preliminary recommendation and a recommended assessment path** for moving an Oracle Database workload to PostgreSQL on Azure. This skill is a **discovery and pre-selection assistant**, not a final architecture decision. Every answer stays **provisional** until an architect and an assessment tool validate it, and the confidence never rises above **medium**: the skill reads no artefact from the estate.

It rests on the knowledge base [`docs/oracle-to-azure-postgresql-migration.md`](../../docs/oracle-to-azure-postgresql-migration.md) and the rules in [`reference/decision-rules.md`](../../reference/decision-rules.md). The rules are also implemented as an executable mirror, `tools/advisor/engine.mjs`, which the test suite checks against the document.

## When to use

- The user wants to migrate or modernize Oracle Database to PostgreSQL on Azure, and no assessment exists yet.
- The user asks which Azure target (flexible server, elastic cluster, HorizonDB, VMs, AKS) or which Microsoft tool fits an Oracle workload.
- The user needs the blockers and the evidence to collect before committing to a path.

Use something else when:

- **DDL and PL/SQL source are available.** Run `oracle-assess-schema` first. It supplies `plsql_volume` and `oracle_features` from the code, which beats asking.
- The user wants the prerequisite checklist for a chosen path: `oracle-prerequisite-plan`.
- The user wants a PDF report with the scan results: `oracle-assessment-report`.
- The source is SQL Server, not Oracle: use `fredgis/sql-migration-advisor`, which this design follows.

## What this skill never does

- It never says a Microsoft migration service moves Oracle rows to PostgreSQL. **There is none.** The Microsoft converter converts schema and code only. Microsoft's own routes copy rows offline (the Azure Data Factory Oracle connector, and `oracle_fdw`, a PostgreSQL extension Azure ships).
- It never recommends, prefers, ranks or compares a product from outside Microsoft, and no question of the interview brings one in. Where Microsoft has no product (change data capture from Oracle, a schema converter for Oracle 11g or older), the card says so in terms, calls it a **gap** (`methodGaps[]`) and names no substitute. If the user asks for a product from another vendor, say that this advisor covers Microsoft services only, and that the Microsoft account team can say what options exist.
- It never gives a cost figure for an estate. A figure needs measured sizing and stated pricing assumptions. It names levers.
- It never claims `validated` or `high` confidence.
- It never recommends anything on the retired list in the card (Azure Data Studio, DMS for Oracle to PostgreSQL, SSMA for Oracle as a route to PostgreSQL, Single Server, Arc-enabled PostgreSQL, PostgreSQL 14 or older as a new target, and the rest).
- It never presents "Converted" as "equivalent".

## User inputs

**The field and option catalogue lives in [`reference/input-contract.md`](../../reference/input-contract.md).** It owns the 29 canonical fields, their stable IDs, which rules consume each field and what happens when one is unknown. The question wording and option labels below are the only copy; a test fails when an ID here is not in the contract.

### Asking rules

Each rule records a failure seen in real interviews.

- **Never use a multi-select.** Single-selects, free text and typed values only. A multi-select that returns empty cannot be told from "none".
- **Never let an empty answer carry meaning.** "I have none of these" and "I have not checked" are opposite answers: one clears a blocker, the other raises one. Ask a single-select that names the intent (`None, confirmed` / `Let me list them` / `Not checked yet`) before asking for any list.
- **Ask each question at most once.** If the answer is empty, or the user declines, do not re-ask and never re-ask in a stricter form.
- **An empty answer is `UNKNOWN`, never `NONE_CONFIRMED`.** Record the unknown, carry it into `unknowns[]` and `evidenceRequired[]`, keep the recommendation `provisional`, and go on.
- **A free-text list that matches nothing is `UNKNOWN`.** The user committed to listing; not recognising their words is the skill's problem, not evidence of absence.
- If a decision-driving field ends up unknown, say so once in the output. Do not block the interview to chase it.

### Take what the user already has

Before asking anything:

1. If the user can supply a profile in prose or JSON, take it, normalise it against the contract, **show the normalised profile back**, and ask only for the fields that are both missing and able to change a surviving candidate.
2. If a schema scan exists (`oracle-assess-schema`), read `plsql_volume` and `oracle_features` from it. Do not ask for them.
3. A full interview is twenty turns. Most people who know their estate should not have to walk it.

### Tier 1: triage

Ask one at a time. Show the label, record the **stable ID**. The rules match IDs, never wording. If an answer arrives as free text, map it to an ID first; if it maps to none, the field is `UNKNOWN`.

1. **Scope** (`scope`): "How big is this migration?" `Single database` **`SINGLE_DB`** · `A few databases (2 to 10)` **`FEW_DATABASES`** · `Large estate (10 or more)` **`LARGE_ESTATE`**. A large estate is scanned and grouped first.
2. **Source location** (`source_location`): "Where does the Oracle database run today?" `On-premises` **`ON_PREM`** · `Azure VM` **`AZURE_VM`** · `AWS EC2` **`AWS_EC2`** · `Amazon RDS for Oracle` **`AWS_RDS_ORACLE`** · `GCP Compute Engine` **`GCP_COMPUTE`** · `OCI or Autonomous` **`OCI_OR_AUTONOMOUS`** · `Oracle Database@Azure` **`ORACLE_DB_AT_AZURE`** · `Exadata on-premises` **`EXADATA_ON_PREM`**.
3. **Oracle version** (`source_version`): "Which release?" `11g or older` **`ORA_11G_OR_OLDER`** · `12c (12.1 or 12.2)` **`ORA_12C`** · `18c` **`ORA_18C`** · `19c` **`ORA_19C`** · `21c` **`ORA_21C`** · `23ai or 26ai` **`ORA_23AI_26AI`**. Microsoft's converter lists 12.1 to 21c. It does not list 11g, 23ai or 26ai, and for 11g or older the card shows a schema-conversion gap.
4. **Topology** (`topology`): "Single instance, RAC or Exadata?" `Single instance` **`SINGLE_INSTANCE`** · `RAC` **`RAC`** · `Exadata` **`EXADATA`**.
5. **Edition** (`edition`): `Standard Edition 2` **`SE2`** · `Enterprise Edition` **`EE`** · `Not sure` **`NOT_SURE`**. A licence note, not a gate.
6. **Character set** (`character_set`): "What is NLS_CHARACTERSET?" `AL32UTF8` **`AL32UTF8`** · `A single-byte legacy set` **`SINGLE_BYTE_LEGACY`** · `Another multibyte set` **`OTHER_MULTIBYTE`** · `Not sure` **`NOT_SURE`**.
7. **Intent** (`intent`): "What do you need now?" `Move to Azure now` **`MIGRATE_NOW`** · `Assessment only` **`ASSESSMENT_ONLY`** · `Rehost on Azure first, modernize later` **`REHOST_FIRST`**.
8. **Main driver** (`driver`): `Oracle licence cost` **`ORACLE_LICENSE_COST`** · `Support lifecycle` **`SUPPORT_LIFECYCLE`** · `Application modernization` **`APP_MODERNIZATION`** · `Open-source strategy` **`OPEN_SOURCE_STRATEGY`** · `Data-centre exit` **`DATACENTER_EXIT`** · `Performance or scale` **`PERFORMANCE_SCALE`**. The driver raises urgency; it never changes eligibility.
9. **Management model** (`management_model`): "How much control do you need?" `Fully managed PaaS` **`MANAGED_PAAS`** · `Operating system and engine control` **`OS_CONTROL`** · `Kubernetes` **`KUBERNETES`**.
10. **Application changeability** (`app_changeability`): "Can the application change?" `Yes, the code is ours and can change` **`APP_CHANGEABLE`** · `Limited change` **`APP_LIMITED`** · `Frozen` **`APP_FROZEN`** · `A packaged vendor application` **`PACKAGED_ISV`**. If `PACKAGED_ISV`, ask **10a**.
    - **10a** (`isv_supports_postgres`): "Does the vendor certify the application on PostgreSQL?" `Yes` **`YES`** · `No` **`NO`** · `Not sure` **`NOT_SURE`**.
11. **Compliance** (`compliance`): `Standard commercial` **`STANDARD_COMMERCIAL`** · `EU data boundary` **`EU_DATA_BOUNDARY`** · `Government or sovereign` **`GOVERNMENT_SOVEREIGN`** · `Edge or air-gapped` **`EDGE_AIR_GAPPED`**.
12. **Azure region** (`region`): free text, for example `swedencentral`, or `Not sure`.
13. **Preview services** (`preview_acceptable`): "Can this project take a service that is still in preview?" `Preview is acceptable` **`PREVIEW_ACCEPTED`** · `Generally available only` **`PREVIEW_REFUSED`** · `Not sure` **`NOT_SURE`**. HorizonDB is a public preview with no SLA.
14. **Customer-managed keys** (`cmk_required`): `Required` **`CMK_YES`** · `Not required` **`CMK_NO`** · `Not sure` **`NOT_SURE`**.
15. **Largest database, planned** (`largest_db_size`): say it is the size **at the end of the planning horizon**, not today. `Under 1 TiB` **`UNDER_1_TB`** · `1 to 8 TiB` **`FROM_1_TO_8_TB`** · `8 to 32 TiB` **`FROM_8_TO_32_TB`** · `32 to 64 TiB` **`FROM_32_TO_64_TB`** · `64 to 128 TiB` **`FROM_64_TO_128_TB`** · `Over 128 TiB` **`OVER_128_TB`** · `Not sure` **`NOT_SURE`**.
16. **Peak I/O** (`peak_io`): `Under 20,000 IOPS` **`UNDER_20K_IOPS`** · `20,000 to 80,000` **`FROM_20K_TO_80K_IOPS`** · `Over 80,000` **`OVER_80K_IOPS`** · `Not sure` **`NOT_SURE`**.
17. **Peak compute** (`peak_compute`): `Up to 96 vCores` **`UP_TO_96_VCORES`** · `97 to 192` **`FROM_97_TO_192_VCORES`** · `Over 192` **`OVER_192_VCORES`** · `Not sure` **`NOT_SURE`**.
18. **Availability target** (`availability_target`): `99.9%` **`STANDARD_99_9`** · `99.95%` **`HIGH_99_95`** · `99.99%` **`HIGHEST_99_99`** · `Not sure` **`NOT_SURE`**.
19. **Cross-region recovery** (`dr_requirement`): `None` **`NO_CROSS_REGION_DR`** · `Asynchronous` **`ASYNC_CROSS_REGION`** · `Zero data loss across regions` **`ZERO_RPO_CROSS_REGION`** · `Not sure` **`NOT_SURE`**.
20. **Oracle features in use** (`feature_dependencies`): "Do you know which of these the schema uses: RAC for write scale, Advanced Queuing, Java in the database, UTL_HTTP and UTL_MAIL, UTL_FILE, Spatial, Oracle Text, XML DB, VPD, Label Security or Vault, Flashback, database links, external tables, scheduler chains, autonomous transactions, package state, object-type inheritance, fast-refresh materialized views, interval or reference partitioning?" Single-select: `None of them, confirmed` **`NONE_CONFIRMED`** · `Let me list them` **`LIST_FEATURES`** · `Not checked yet` **`NOT_SURE`**. `NOT_SURE` holds every feature-dependent verdict at `unknown_requires_assessment` until a scan runs. Only `LIST_FEATURES` opens **20a**.
    - **20a** (`oracle_features`): free text. Map to the feature IDs in the contract (section 3). If nothing matches, record `UNKNOWN`, not `NONE_CONFIRMED`.
21. **PL/SQL volume** (`plsql_volume`): from the scan if there is one. Otherwise: `Little or none (under 5,000 lines)` **`NONE_OR_LIGHT`** · `Moderate (5,000 to 50,000)` **`MODERATE`** · `Heavy (50,000 to 250,000)` **`HEAVY`** · `Very heavy (over 250,000)` **`VERY_HEAVY`** · `Not sure` **`NOT_SURE`**.
22. **Oracle app tier** (`app_tier_oracle`): "Forms, Reports, APEX, OBIEE, ODI, WebLogic or mod_plsql around the database?" `None, confirmed` **`NONE_CONFIRMED`** · `Let me list them` **`LIST_APP_TIER`** · `Not sure` **`NOT_SURE`**. These are application work, not database work.

### Tier 2: method inputs

Ask these only when a method choice is still open.

23. **Downtime tolerance** (`downtime`): `Near zero (minutes)` **`NEAR_ZERO`** · `Minimal (tens of minutes to a couple of hours)` **`MINIMAL`** · `An offline window` **`OFFLINE`** · `Not sure` **`NOT_SURE`**. Minutes of downtime need change capture, which Microsoft does not offer. Ask anyway, and when the answer is `NEAR_ZERO` or `MINIMAL` say once that the card will show a gap and not a product.
24. **Bandwidth** (`network_bandwidth`): `Good, such as ExpressRoute` **`GOOD_BANDWIDTH`** · `Limited WAN` **`LIMITED_WAN`** · `Very large, multi-terabyte` **`VERY_LARGE_MULTI_TB`** · `Not sure` **`NOT_SURE`**.
25. **Private connectivity** (`private_connectivity`): `Private link ready` **`PRIVATE_LINK_READY`** · `Public only` **`PUBLIC_ONLY`** · `Not sure` **`NOT_SURE`**. It decides whether `oracle_fdw` and a Data Factory self-hosted runtime can reach the Oracle listener.
26. **Converter prerequisites** (`converter_prereqs`), only when Microsoft's converter is a candidate: "Is there a Microsoft Foundry deployment of gpt-5.2 with more than 1,000,000 tokens per minute, and a GitHub Copilot seat?" `Both ready` **`FOUNDRY_AND_COPILOT_READY`** · `One is missing` **`FOUNDRY_OR_COPILOT_MISSING`** · `Not sure` **`NOT_SURE`**. While one is missing the converter is unavailable and the card shows a schema-conversion gap, which closes when the quota and the seat exist.
27. **Evidence in hand** (`evidence`): `An effort estimate` **`EFFORT_ESTIMATE`** · `The VS Code discovery step` **`VSCODE_DISCOVERY`** · `A schema scan` **`SCHEMA_SCAN`** · `AWR sizing` **`AWR_SIZING`** · `None` **`NONE`**. Each is a claim to verify elsewhere. None raises confidence.

## Decision process

Follow [`reference/decision-rules.md`](../../reference/decision-rules.md). It has four steps and a rule ID for every verdict.

- **Step A, hard eligibility.** Trace **all eight** families: `pg_flex`, `pg_elastic`, `horizondb`, `pg_vm`, `pg_aks`, `cosmos_pg`, `oracle_dbaz`, `oracle_vm`. Each ends in one of `eligible`, `eligible_with_remediation`, `unsupported`, `excluded_by_preference` or `unknown_requires_assessment`. `unsupported` is a technical incompatibility. `excluded_by_preference` names an answer the customer can change. They are not interchangeable.
- **Step B, rank the survivors.** `OP-INTENT`, `OP-ISV` and `OP-STAY-ORACLE`, `OP-MANAGEMENT`, then `OP-RANK`. The alternative is always one of the eight and may be absent; an Oracle family is not named as the alternative when `driver` is `ORACLE_LICENSE_COST` or `OPEN_SOURCE_STRATEGY`. If a better-ranked target is held on an unanswered question, the status is `shortlist` and the card says what would separate the candidates.
- **Step C, methods.** Every Microsoft method the matrix marks primary or secondary appears in `methodCandidates` with a status and a reason. Schema conversion: `MS_VSCODE_AI` is the only route Microsoft publishes. When it is unavailable there is no route and the card carries the schema-conversion gap. Data movement by downtime class: offline, the Data Factory Oracle connector and then `oracle_fdw`; a downtime that needs change capture has no Microsoft route and the card carries the change-capture gap (`OP-SCOPE`).
- **Step D, the card.** Blockers, unknowns, largest risk, next actions, cost levers, programme fit, the retired list.

### Run the mirror when you can

If Node is available, the executable mirror gives the same answer deterministically and runs the 19-invariant self-check:

```bash
node tools/advisor/cli.mjs profile.json --scan assessment.json --name "Contoso Store"
```

If the self-check fails, no card is printed and the failed invariant is named. Do not repair the output silently: expose the inconsistency, return a provisional shortlist or the missing evidence, and say which invariant broke. If Node is not available, apply the rules by hand and run the same checks (reference/output-contract.md, section 3) before you show the card.

## Output

Render the card in the user's language, in the shape of [`reference/output-contract.md`](../../reference/output-contract.md) section 4. The card is a faithful rendering of the output object: do not add a field that object does not have. JSON on request.

The header says **Preliminary** and **provisional** (or **shortlist**). The card states, once each:

- the converter converts schema and code and does not move rows, and the routes that do are Microsoft's offline ones;
- every gap says what Microsoft lacks and that the advisor recommends no product for it, and points to the Microsoft account team;
- "Converted" is not "equivalent": every converted object needs independent testing;
- a cost is a lever, not a figure;
- the source and date of anything volatile (regions where zone-redundant HA is blocked, HorizonDB status, programme names and funding), and that it must be confirmed before it is promised.

Offer the next skills: `oracle-prerequisite-plan` for the checklist, `oracle-assessment-report` for the PDF.

## What to do when the sources disagree

Microsoft's pages sometimes disagree (for example, the Frontier Accelerate and Azure Accelerate names, or whether a GitHub Copilot seat is a converter prerequisite). Quote both, say which page says what, and mark the item unverified. Never smooth it over.
