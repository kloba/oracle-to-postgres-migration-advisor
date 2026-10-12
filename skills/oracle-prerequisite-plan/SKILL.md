---
name: oracle-prerequisite-plan
description: "Builds a prerequisite and preparation plan for a chosen Oracle to Azure PostgreSQL migration path: what to line up on the Oracle side (read account, and ARCHIVELOG and supplemental logging as preparation when the downtime needs change capture), the Azure side (Foundry quota, Copilot seats, scratch server, extension allow-list, creation-time choices), the network, the licences and programmes, the data-movement tuning the schema needs, validation, cutover and rollback, grouped by phase with owners and a source for every step. Trigger when a recommendation exists, or when the user asks 'what do I need before migrating Oracle to PostgreSQL', 'prerequisites for the Oracle schema converter', 'checklist for Oracle to Azure PostgreSQL', or 'what should we prepare'."
allowed-tools: Read, Grep, Glob, Bash
---

# Skill: Oracle to PostgreSQL prerequisite plan

## Description

Turn a recommendation into a checklist someone can start on. The plan is **generated, not written by hand**: `reference/prerequisite-catalog.json` holds the steps, each with a condition on the recommendation, the selected methods, the stated profile and, when there is one, the schema scan. A step with no source says so and gives its basis.

## When to use

- After `oracle-recommend-migration-path`, when the user wants to know what to prepare.
- When the long-lead items matter: Foundry quota, Copilot seats, networking, the extension allow-list.

## Inputs

1. The profile (JSON, as for the recommendation skill).
2. Optionally the schema scan from `oracle-assess-schema`. Without it, steps that depend on the shape of the data (large objects, partitions, LONG columns, index-organised tables) are absent, and the plan says so.

## Run

```bash
node tools/plan/cli.mjs profile.json --scan assessment.json --name "Contoso Store" --out plan.md
```

`--json` writes the structured plan. The same builder feeds section 12 of the PDF report, so the two cannot disagree.

## What the plan contains

Five phases, each with steps, an area, a suggested owner and the sources:

| Phase | What it holds |
|---|---|
| Before committing to a path | The DDL export, AWR collection, the Oracle contract, programme funding, a converter pilot, and a decision for each gap on the card: how to meet a downtime target that needs change capture (Microsoft has no service for it), and how to convert the schema when the converter cannot be used |
| Before the first conversion run | The long lead times: the converter read account, Foundry quota above 1,000,000 tokens per minute, Copilot seats, the scratch server, the extension allow-list and preload, creation-time choices, the private network path, identity, ARCHIVELOG and supplemental logging when change capture will be used, the Data Factory connector or `oracle_fdw` set-up, data-shape tuning, and one application step for each feature the target carries by workaround or redesign |
| Before the cutover rehearsal | A timed load on production-sized data, plpgsql_check, differential testing, row comparison, plan comparison, connection limits |
| At cutover | The handoff point and sequence resets, the way back |
| After the move | Backup and restore, the PostgreSQL major version lifecycle |

## Rules for the plan

- **Preliminary.** The plan follows a provisional recommendation and changes when it does. Say so.
- **No cost.** Nothing in the plan is an estimate of money or time. The advisor does not size a target.
- **Owners are suggestions.** Do not present them as assignments.
- **Judgement is labelled.** A step marked *Judgement* rests on the author's reading, not on a page. Offer to find a source if it matters.
- **Name no product from outside Microsoft.** Where Microsoft has no product (change data capture, a converter for Oracle 11g or older), the plan has a decision step that says so and points to the Microsoft account team. It names no substitute.
- **Flag the unverified.** Several facts are unverified in the sources: what `oracle_fdw` needs on flexible server, and whether a supported reverse replication to Oracle exists for rollback (Microsoft offers none). The plan says each one.

## Adding or changing a step

Edit `reference/prerequisite-catalog.json`. Each item needs a phase, an area, an owner, a title, a detail, a `when` condition and either `sources` (ids in `reference/sources.json`) or a `basis` that starts with `judgement:`. The test suite checks the schema of the catalogue, that every source resolves, and that the plan changes with the recommendation.
