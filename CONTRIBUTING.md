# Contributing

Run `node tests/run-tests.mjs` before and after every change. It needs Node 20 or later and nothing else.

## The rule that matters most

**Do not edit a generated file.** `reference/compat-catalog.json`, `reference/feature-matrix.json`, `schemas/input.schema.json` and the generated blocks in the knowledge base are written by `tools/catalog/build.mjs`, `tools/schema/build-schemas.mjs` and `tools/kb/build-kb.mjs`. A test fails when one differs from a fresh build.

## Change a rule

1. Edit `reference/decision-rules.md` (the prose, and the rule index at the end) and, if a number changes, `reference/decision-rules.data.json`.
2. Edit `tools/advisor/engine.mjs` to match. The rule ID in the document and the one the engine emits must be the same string.
3. Add or change a golden scenario in `tests/golden-scenarios.json` that shows the new behaviour, written from the document, not from the engine's output.
4. Run the tests. A property test failing means the rule can break an invariant on some input: fix the rule, not the test.

## Change what a target carries

Edit `tools/catalog/feature-matrix-source.mjs`: one row per Oracle feature, one cell per target, each `[state, note, sources]`. A cell with no source is the author's judgement and its note must say why. Run `node tools/catalog/build.mjs`.

## Add or change a construct

Edit `tools/catalog/catalog-source.mjs` (or `research-entries.mjs` for entries that came from the independent research). Give it a class, a weight and the PostgreSQL equivalent. A weight follows the published Ora2Pg cost convention only when that convention scores the construct; then set `origin: 'ora2pg-25.0:KEY'`. Otherwise it is `advisor`. Keep `BLOCKER` for constructs with no supported equivalent on flexible server: it is the only class that feeds eligibility. Rebuild, run `examples/contoso-store/run.sh`, and look at the hits for the new construct on real code before trusting its pattern.

## Change a fact

1. Read the vendor page. Update `reference/sources.json` (`checked` date, and `pageDate` if the page shows one).
2. Update `reference/decision-rules.data.json`, the knowledge base prose, and the rule text if it quoted the old fact.
3. Run `node tools/check-sources.mjs` and `node tools/kb/build-kb.mjs`.
4. If the fact moved a verdict, add a golden scenario.

## Change a skill

The skills carry the question wording. The IDs in them must exist in `reference/input-contract.md`; the tests check it. Do not copy the contract into a skill.

## Wording

- A recommendation is **preliminary** and **provisional**. Never `validated`. Confidence never exceeds `medium`.
- Never say a Microsoft migration service moves Oracle rows to PostgreSQL.
- Never recommend, prefer, rank or compare a product from outside Microsoft, in a rule, a skill, a document or the engine's output (`OP-SCOPE`). Where Microsoft has no product for a step, write a gap that says what Microsoft lacks and names no substitute. Self-check invariant 19 scans the engine's output for the names of such products and fails when one appears.
- Ora2Pg appears only as the origin of the published cost-unit convention behind the effort estimate. It is a yardstick, never a tool to run or adopt.
- Never give a cost figure for an estate. Name levers.
- Mark an unverified claim unverified. Where sources disagree, quote both.
- Plain sentences. No emojis.
