# Output contract

The single source of truth for what a recommendation contains, how it is rendered, and what the skill must verify about its own
answer before showing it.

---

## 1. Status vocabulary

| Field | Allowed values |
|---|---|
| `recommendationStatus` | `provisional` when the skill names one target and one method path · `shortlist` when no rule separates the candidates, or a better-ranked candidate is held on an unanswered question, and it refuses to invent a winner. Neither certifies anything: the skill reads no artefact from the estate |
| `confidence` | `low` · `medium` |
| Eligibility, per target | `eligible` · `eligible_with_remediation` · `unsupported` · `excluded_by_preference` · `unknown_requires_assessment` |
| Method status | `available` · `unavailable` · `refused` · `unknown_requires_assessment` |
| Method gate result | `passed` · `failed` · `unknown_requires_assessment` |

**`unsupported` and `excluded_by_preference` are not interchangeable.** `unsupported` is a technical incompatibility: a
requirement the target cannot meet. `excluded_by_preference` names the answer that set the target aside, so it can be revisited
without re-arguing feasibility. A card read in three months must not conclude that a target was ruled out on its merits when the
customer had only expressed a preference.

`validated` and `high` are not in this contract. The skill reads no artefact: it opens no report, runs no tool and queries no
service, so it cannot certify one. Promoting a recommendation means reading real artefacts and recording, for each, its type, its
URI or hash, the tool and version that produced it, its date, the target region and the approver.

### Confidence

| Level | Meaning |
|---|---|
| `medium` | Triage is complete and internally consistent. The ceiling for this skill |
| `low` | At least one decision-driving unknown remains, a capacity answer was assumed, the status is `shortlist`, or two answers conflict |

---

## 2. Structure

```text
metadata
  knowledgeBaseVersion
  decisionRulesVersion
  evaluatedAt
  recommendationStatus    = provisional | shortlist
  confidence              = low | medium
normalizedProfile         every canonical field, with an ID or UNKNOWN
eligibilityTrace          one entry per target, all eight: state, ruleId, reason, contributing[]
recommendation            absent when the status is shortlist
  target, label, ruleId, why, postgresMajor, remediation
alternative
  target, label, wins     the condition under which it wins
shortlist[]               present only when the status is shortlist:
                          target, label, state, why, separatedBy
methodCandidates[]        every method the matrix marks primary or secondary for the chosen target:
                          id, family, role, status, reason, ruleId
selectedMethods           schemaConversion, dataMovement (each an id, or null where Microsoft has no method), dataFamily, cutoverDowntime
methodGaps[]              the steps Microsoft has no product for: id, ruleId (OP-SCOPE), text. Ids: SCHEMA_CONVERSION, ONLINE_CAPTURE
methodGateTrace           per family (schemaConversion, dataMovement): the gates the selected route passed, failed or could not check
blockers[]                features with no equivalent on the chosen target
unknowns[]                field, why, rules
assumptions[]             what the skill assumed because a capacity field was unanswered
evidenceRequired[]        field, evidence
largestRisk
nextActions[]
costLevers[]
programmeFit[]
retired[]                 what the skill will not recommend, and the replacement
```

Markdown is the default rendering. JSON is produced on request. **The card is a faithful rendering of this object**: an example
may not introduce a field that does not exist here.

---

## 3. Self-check, before rendering

Run every invariant below **before** showing the card. It is the only mechanism that protects a live answer, so it is not
optional.

| # | Invariant |
|---|---|
| 1 | The primary target is `eligible` or `eligible_with_remediation`, never one just marked `unsupported` |
| 2 | The alternative target is also `eligible` or `eligible_with_remediation` |
| 3 | A selected method is not `unavailable` or `refused`. Its gate may be `passed`, or `unknown_requires_assessment` when a field it depends on is unproven; a recommendation resting on an unproven gate is provisional and says which evidence would settle it |
| 4 | The recommendation violates no capacity or feature limit the trace records |
| 5 | Every hard-gate unknown appears in both `unknowns` and `evidenceRequired`. A **hard-gate unknown** is a fact the interview could have collected and did not. A prerequisite the interview cannot reach at all belongs in `evidenceRequired` and `nextActions`, and does not lower confidence |
| 6 | An `unsupported` target never appears as primary or alternative, and `cosmos_pg` never appears as either |
| 7 | Refusing a preview **method** never removes a generally available **target** when another viable method exists |
| 8 | No cost figure appears without measured sizing and stated pricing assumptions |
| 9 | `recommendationStatus` is `provisional` or `shortlist`, and `confidence` is at most `medium` |
| 10 | **A method gate may not report `passed` while any field it consumes is unknown.** Report `unknown_requires_assessment` and name the evidence instead |
| 11 | All eight target families appear in the Phase A trace. A family that silently disappears cannot be argued with |
| 12 | `unsupported` marks a technical incompatibility only. A target the customer set aside is `excluded_by_preference` |
| 13 | `normalizedProfile` is present, so the reader can see what the skill thinks it was told |
| 14 | **For a PostgreSQL primary, every method the matrix marks `primary` or `secondary` for the chosen target appears in `methodCandidates`, with a status and a reason.** A method that is never a candidate is never rejected either, so its absence cannot be argued with |
| 15 | Each selected route appears in `methodCandidates`, and **its status there and its `methodGateTrace` result answer the same question, so they must agree**: `available` with `passed`, `unknown_requires_assessment` with `unknown_requires_assessment`, never `unavailable` or `refused` for a method that won |
| 16 | **A shortlist is a state, not a sentence in the target field.** When no rule separates the candidates, `recommendationStatus` is `shortlist`, `recommendation` is absent, and `shortlist[]` names at least two families, each with why it stands and **what would separate it**. When no PostgreSQL target stands, the list says which answer to revisit and may name the Oracle-on-Azure fallback |
| 17 | The Microsoft converter is never presented as moving rows, and no Microsoft migration service (Database Migration Service, the PostgreSQL migration service) is presented as moving Oracle rows to PostgreSQL. The routes that do move rows offline are the Data Factory copy and `oracle_fdw`; nothing from Microsoft does it by change capture |
| 18 | Nothing on the retired list is recommended |
| 19 | **Nothing from outside Microsoft is recommended** (`OP-SCOPE`). No target, alternative, candidate, selected method, next action or cost lever names another vendor's product. A step Microsoft has no product for is a gap in `methodGaps[]`, with no substitute named. A selected route may be `null` only when a gap explains it |

**When an invariant fails, do not repair the output silently.** Expose the inconsistency, return a provisional shortlist or name
the missing evidence, and say which invariant broke. A card that quietly corrects itself hides the fact that the rules disagreed.

**When every invariant passes, show nothing about the check.** The user sees the normal card.

---

## 4. Markdown rendering

In the user's language.

```markdown
> **Preliminary recommendation: <profile>**
> **<PRIMARY TARGET>** on PostgreSQL <major> · status **provisional** · confidence **<medium|low>**
> KB **<version>** · rules **<version>** · evaluated **<timestamp>**

One sentence on why this is the recommended assessment path.

**Schema and code:** <route or gap> · **Data:** <route or gap> (<online|offline>) · **Cutover downtime:** <class>

| Target | State | Rule | Why |
|---|---|---|---|
| ... all eight ... |

**Alternative:** <target>, <wins condition>.

**Gaps.** What Microsoft has no product for, and no substitute named.
**Blockers.** ...
**Unknowns and the evidence that would settle them.** ...
**Largest risk.** ...
**Next actions.** ...
**Cost levers.** ...  **Programme fit.** ...
**Never recommended.** ...
```

A shortlist renders the same way with a **Shortlist** table in place of the headline, and no target in bold.

---

## 5. Honest wording the card must keep

- "Preliminary" and "provisional" appear in the header. The card never says "recommended migration" without them.
- The Microsoft converter converts schema and code. The card says it does not move rows and names the Microsoft route that does (the Data Factory copy or `oracle_fdw`), or the gap where Microsoft has none.
- "Converted" is not "equivalent". The card says so once, in the largest risk or the next actions.
- A cost is a lever, not a figure.
- Quote the source of anything volatile (regions where zone-redundant HA is blocked, programme names and funding percentages), and say to confirm it before promising it.
