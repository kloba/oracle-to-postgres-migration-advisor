# Decision rules: Oracle to Azure PostgreSQL

The policy the `oracle-recommend-migration-path` skill applies. It is a **preliminary** disposition: every recommendation
stays `provisional` until an assessment tool and an architect validate it. Machine-checkable constants live in
[`decision-rules.data.json`](decision-rules.data.json); the Oracle feature by target table lives in
[`feature-matrix.json`](feature-matrix.json); the catalogue of constructs the schema scan looks for lives in
[`compat-catalog.json`](compat-catalog.json). Every source is in [`sources.json`](sources.json), fetched and read on
2026-10-12.

Every verdict carries a **rule ID**. The index at the end lists all of them, so a reader can look one up, read what it
consumes and how it treats an unknown, and argue with it.

Version: **v1.0**. Knowledge base: **v1.0**.

---

## How a recommendation is made

```text
  interview or profile
        │
        ▼
  A  Phase A: hard eligibility. Eight target families, each ruled in, ruled out, or held.
        │
        ▼
  B  Phase B: rank the survivors, name one primary and one alternative.
        │
        ▼
  C  Methods: schema and code conversion, data movement, validation, assessment, each gated.
        │
        ▼
  D  Output: blockers, unknowns, evidence required, cost levers, programme fit, next actions.
```

The eight families, all of which appear in every Phase A trace:

| ID | Target |
|---|---|
| `pg_flex` | Azure Database for PostgreSQL flexible server |
| `pg_elastic` | Flexible server elastic cluster (Citus-based, sharded) |
| `horizondb` | Azure HorizonDB for PostgreSQL (public preview) |
| `pg_vm` | PostgreSQL on Azure virtual machines, self-managed |
| `pg_aks` | PostgreSQL on AKS with CloudNativePG, self-managed |
| `cosmos_pg` | Azure Cosmos DB for PostgreSQL |
| `oracle_dbaz` | Oracle AI Database@Azure (stay on Oracle) |
| `oracle_vm` | Oracle Database on Azure virtual machines (stay on Oracle) |

The last two are not PostgreSQL targets. They are on the list because an honest advisor sometimes says "do not migrate to
PostgreSQL", and a family that silently disappears cannot be argued with.

### Scope (`OP-SCOPE`)

This advisor is scoped to Microsoft's platform and is not an official Microsoft product. It recommends Microsoft services, Microsoft-published tools and Azure-hosted
offerings, and nothing else. A product from another vendor is never named as a target, an alternative or a method, and no
input of the interview can bring one back. Where Microsoft has no product for a step (change data capture from Oracle, a
schema converter for an Oracle release the Microsoft converter does not cover) the card says so in terms and calls it a
**gap**. It names no substitute. The two Oracle families are Azure-hosted offerings and appear only as the answer to "do not
migrate". Ora2Pg's published cost table is the unit convention behind the effort estimate: a yardstick, not a recommendation
to run the tool.

---

## Step A: Phase A eligibility filter

### A0. Input normalisation

Inputs follow [`input-contract.md`](input-contract.md). Before any rule runs:

1. Map every answer to a stable ID. An answer that maps to none is `UNKNOWN`.
2. A list field answered `NONE_CONFIRMED` is an empty list. Answered `NOT_SURE`, it is `UNKNOWN`, which is **not** an empty list.
3. `region` is lower-cased and stripped of spaces (`West Europe` becomes `westeurope`).
4. `plsql_volume` and `oracle_features` come from a schema scan when one is supplied; the scan wins over a stated value, and the card says so.
5. Show the normalised profile back to the user before asking for anything else.

### A1. Eligibility states

| State | Meaning |
|---|---|
| `eligible` | Nothing consumed so far rules it out and no remediation is required |
| `eligible_with_remediation` | Viable, with a named workaround or a redesign the customer must accept |
| `unsupported` | A **technical** incompatibility. A requirement the target cannot meet |
| `excluded_by_preference` | Ruled out by something the customer said they prefer. Nothing is technically wrong, and it can be revisited |
| `unknown_requires_assessment` | A field a rule needs is unanswered, or the vendor documentation does not say |

`unsupported` and `excluded_by_preference` are not interchangeable. A reader returning to a card in three months must be
able to tell a target that cannot work from one the customer set aside.

When several rules speak about one target, the most severe state wins, in this order:
`unsupported` > `excluded_by_preference` > `unknown_requires_assessment` > `eligible_with_remediation` > `eligible`.
The trace records the rule that set the state and every other rule that contributed. When several rules give a target the same
most-severe state, the reported rule is the one **listed first in the rule index** at the end of this document, and the others
are recorded as contributing. A target no rule touched is `eligible` and reports no rule.

### A2. Hard rules

#### Applies to every PostgreSQL target

| Rule | Reads | Effect |
|---|---|---|
| `OP-ISV` | `app_changeability`, `isv_supports_postgres` | `PACKAGED_ISV` with `isv_supports_postgres = NO`: **every PostgreSQL target is `unsupported`**. With `NOT_SURE`: every PostgreSQL target is `unknown_requires_assessment`. With `YES`: no effect. Moving the database does not move a vendor application, and the vendor decides what is supported |
| `OP-COSMOS` | none | `cosmos_pg` is always `unsupported`: new deployments are blocked and the service retires 2029-03-31. Existing customers move to `pg_elastic` |
| `OP-FEATURE-GATE` | `feature_dependencies` | `NOT_SURE` holds `pg_flex`, `pg_elastic`, `horizondb` and `pg_aks` at `unknown_requires_assessment` until a scan runs. `pg_vm` is broader: it becomes `eligible_with_remediation`, with the unknown recorded and the scan as the remediation |
| `OP-FEATURE-MATRIX` | `oracle_features`, [`feature-matrix.json`](feature-matrix.json) | For every listed feature, read the target's cell. `unsupported` makes the target `unsupported`. `redesign` or `workaround` makes it `eligible_with_remediation`. `unknown` makes it `eligible_with_remediation` and records the unknown. `native` has no effect. The rule ID reported is `OP-FEATURE-MATRIX` and the reason names each feature |
| `OP-FROZEN-REDESIGN` | `app_changeability`, `oracle_features` | `APP_FROZEN` and any feature in state `redesign` on that target: the target is `unsupported`, because a redesign needs a change the customer said cannot happen. The reason names the feature. `APP_LIMITED` keeps `eligible_with_remediation` and records the redesign as the largest risk |
| `OP-SIZE` | `largest_db_size` | See table below |
| `OP-IO` | `peak_io` | `FROM_20K_TO_80K_IOPS`: `pg_flex` is `eligible_with_remediation`, because only Premium SSD v2 reaches it and that disk has no storage autogrow, no long-term retention backups and no on-demand backups. `OVER_80K_IOPS`: `pg_flex` is `unsupported` (Premium SSD v2 tops out at 80,000 IOPS and 1,200 MiB/s). `horizondb`, `pg_vm`, `pg_aks` are `unknown_requires_assessment`: striping across disks may reach it and Microsoft publishes nothing to confirm |
| `OP-COMPUTE` | `peak_compute`, `preview_acceptable` | `FROM_97_TO_192_VCORES`: `pg_flex` is reachable only on the **V6 preview** SKUs (see `OP-V6`); `pg_vm` and `pg_aks` are `eligible_with_remediation` (large VM sizes exist, and sizing is the operator's). `OVER_192_VCORES`: `pg_flex`, `horizondb` are `unsupported`. `pg_elastic` scales out instead and is `unknown_requires_assessment`. `pg_vm`, `pg_aks` are `unknown_requires_assessment` |
| `OP-V6` | `peak_compute`, `preview_acceptable` | When `peak_compute = FROM_97_TO_192_VCORES`: `PREVIEW_ACCEPTED` makes `pg_flex` `eligible_with_remediation` (V6 is in public preview, has no VNet integration, and cannot scale to or from Burstable); `PREVIEW_REFUSED` makes it `excluded_by_preference`; `NOT_SURE` makes it `unknown_requires_assessment` |
| `OP-AVAILABILITY` | `availability_target` | `HIGH_99_95` or `HIGHEST_99_99`: `pg_flex` needs HA (same-zone gives 99.95%, zone-redundant gives 99.99%) and **stays `eligible`**: the cost of HA is a lever (D3), and the only remediation is the regional one in `OP-REGION-HA`. `horizondb` publishes no SLA and is `unsupported`. `pg_vm` and `pg_aks` are `eligible_with_remediation`: the customer builds and tests HA and there is no managed-service SLA. |
| `OP-REGION-HA` | `availability_target`, `region` | `HIGHEST_99_99` needs zone-redundant HA. A region where new zone-redundant deployments are blocked, or where it is unavailable, makes `pg_flex` `eligible_with_remediation`: move to a sibling region, or accept 99.95%. An **unknown region** does not change the state, because the region decides the remediation and not whether the target can work: `region` is recorded in `unknowns[]` and `evidenceRequired[]`. The lists are volatile; the card says to confirm in the portal |
| `OP-DR` | `dr_requirement` | `ZERO_RPO_CROSS_REGION`: `pg_flex`, `pg_elastic`, `horizondb` are `unsupported` (cross-region replication is asynchronous and forced promotion can lose data). `pg_vm`, `pg_aks` are `eligible_with_remediation` (synchronous cross-region replication is possible and the customer owns the latency cost). `NOT_SURE`: no state changes and `dr_requirement` is recorded as an unknown. The Oracle targets are not limited by this rule or by any PostgreSQL ceiling in this table. `ASYNC_CROSS_REGION`: `pg_flex` is `eligible` (cross-region read replica, manual promotion); `pg_elastic` is `unsupported` (a single read replica and no documented cross-region path); `horizondb` is `unsupported` (no cross-region replicas in preview) |
| `OP-CMK` | `cmk_required` | `CMK_YES`: `pg_flex` is `eligible`, with the note that the choice is made at creation and cannot be reverted. `horizondb` is `unsupported` (service-managed keys only), and the reported rule is `OP-CMK` |
| `OP-MANAGEMENT` | `management_model` | `MANAGED_PAAS`: `pg_vm`, `pg_aks` and `oracle_vm` are `excluded_by_preference` (the customer would own HA, patching and backup). `OS_CONTROL`: `pg_flex`, `pg_elastic`, `horizondb` are `unsupported` (no superuser, no file system, no custom extensions) and `oracle_dbaz` is `excluded_by_preference` (Oracle operates the infrastructure). `KUBERNETES`: every target except `pg_aks` is `excluded_by_preference` |
| `OP-REGION` | `compliance` | `GOVERNMENT_SOVEREIGN`: the managed PostgreSQL targets (`pg_flex`, `pg_elastic`, `horizondb`) are `unknown_requires_assessment` (sovereign-region availability is not established). `EDGE_AIR_GAPPED`: the same three are `unsupported`; only `pg_vm` and `pg_aks` remain among the PostgreSQL targets. The Oracle targets are governed by `OP-STAY-REGION` |

`OP-SIZE` per target:

| `largest_db_size` | `pg_flex` | `pg_elastic` | `horizondb` | `pg_vm`, `pg_aks` |
|---|---|---|---|---|
| `UNDER_1_TB`, `FROM_1_TO_8_TB`, `FROM_8_TO_32_TB` | `eligible` | `unknown_requires_assessment` (needs a distribution key) | `eligible` | `eligible` |
| `FROM_32_TO_64_TB` | `eligible_with_remediation`: Premium SSD v2 only, which has no storage autogrow, no long-term retention backups and no on-demand backups | `unknown_requires_assessment` | `eligible` | `eligible` |
| `FROM_64_TO_128_TB` | `unsupported` | `eligible_with_remediation`: shardable workloads only | `eligible_with_remediation` (preview) | `unknown_requires_assessment` |
| `OVER_128_TB` | `unsupported` | `unknown_requires_assessment` | `unsupported` | `unknown_requires_assessment` |
| `NOT_SURE` | `eligible` with an assumption and an unknown | `unknown_requires_assessment` (the distribution key does not depend on the size) | `eligible` with the same assumption | `eligible` with the same assumption |

The planned size is size at the end of the planning horizon divided by an 80% fill target: flexible server goes read-only at 95%
used and a major version upgrade needs 10 to 20% free. A capacity field answered `NOT_SURE` records an **assumption** and an
**unknown** and lowers confidence; it does not hold the target, because a capacity question is asked in triage and most estates
fit. The assumption is stated on the card.

#### HorizonDB

| Rule | Reads | Effect |
|---|---|---|
| `OP-PREVIEW` | `preview_acceptable` | HorizonDB is in public preview and has no published SLA. `PREVIEW_REFUSED`: `excluded_by_preference`. `NOT_SURE`: `unknown_requires_assessment` |
| `OP-HZ-GATE` | none | The preview gaps: customer-managed keys, cross-region replicas, long-term retention, VNet injection, built-in PgBouncer, a configurable maintenance window, and a backup retention fixed at 7 days. Keys and cross-region recovery are enforced by `OP-CMK` and `OP-DR`. The others have no input field, so they change no state: whenever `horizondb` is eligible or held, the card **lists the gaps as a note** |
| `OP-HZ-REGION` | `region` | A region outside the Learn list is `unsupported`. `NOT_SURE` is `unknown_requires_assessment` |

HorizonDB is also `unsupported` when a required Oracle-compatibility extension is absent from its list: `oracle_fdw`,
`pg_hint_plan`, `plpgsql_check`. The feature matrix carries that. And it cannot be the conversion scratch database, so a
HorizonDB target still needs a flexible server for the conversion step.

#### Oracle on Azure (stay on Oracle)

| Rule | Reads | Effect |
|---|---|---|
| `OP-STAY-ORACLE` | `topology`, `edition`, `app_changeability`, `intent` | Both stay-on-Oracle targets are `eligible` whenever their own gates pass. `oracle_vm` with `topology = RAC` is `unknown_requires_assessment`: Microsoft's page says RAC is unsupported on Azure Bare Metal and says nothing about RAC on standard VMs |
| `OP-STAY-REGION` | `region`, `compliance` | `oracle_dbaz` needs a region in the 33-region list and an OCI tenancy. A region outside the list is `unsupported`; `NOT_SURE` is `unknown_requires_assessment`. `GOVERNMENT_SOVEREIGN` and `EDGE_AIR_GAPPED` make it `unsupported` |
| `OP-INTENT` | `intent` | `REHOST_FIRST`: the stay-on-Oracle targets are ranked ahead of every PostgreSQL target. `ASSESSMENT_ONLY`: the card names the assessment path and the target to assess first, and does not name a migration method as the thing to run |

#### Other

| Rule | Reads | Effect |
|---|---|---|
| `OP-RAC` | `topology`, `oracle_features` | `RAC` with `RAC_WRITE_SCALE`: PostgreSQL has one writer. Targets remain `eligible_with_remediation` only while the ceilings in `OP-COMPUTE` and `OP-IO` hold; otherwise those rules already refuse them. `RAC_HA_ONLY` has no effect |
| `OP-ESTATE` | `scope` | `LARGE_ESTATE`: no effect on eligibility. The card says to run the schema scan across the estate first and group databases by result, because one profile cannot stand for many |
| `OP-LICENSE-NOTE` | `edition`, `topology` | Informational. Standard Edition 2 has a vCPU cap when it runs on Azure virtual machines; the card tells the customer to confirm entitlements with Oracle, which is a contract question |

---

## Step B: Phase B ranking

### B1. Ordering the survivors

A target is a **survivor** when its state is `eligible` or `eligible_with_remediation`. `unknown_requires_assessment` targets
are not survivors: they are named in the card as held, with the evidence that would release them.

The primary target is chosen by the first rule below that applies. A rule that selects a named target applies **only when that target is a survivor**; otherwise the chain falls through to the next rule.

1. **`OP-INTENT`**: `REHOST_FIRST` selects `oracle_dbaz` when it survives and `topology` is `RAC` or `EXADATA` or `edition` is `EE`, otherwise `oracle_vm`.
2. **`OP-ISV`** and **`OP-STAY-ORACLE`**: when no PostgreSQL target survives, none is held (see B3), and a stay-on-Oracle target survives, that target is the primary, chosen as in rule 1. The rule reported is `OP-ISV` when the cause is a packaged application the vendor does not support on PostgreSQL, otherwise `OP-STAY-ORACLE`. The card says moving Oracle as it is to Azure is the honest answer and the modernisation question is deferred, not answered.
3. **`OP-MANAGEMENT`**: `KUBERNETES` selects `pg_aks`; `OS_CONTROL` selects `pg_vm`.
4. **`OP-RANK`**: otherwise the survivor with the lowest score:

   ```text
   score = 3 x redesign   (APP_LIMITED)   or   1 x redesign   (APP_CHANGEABLE, or not stated)
         + 0.25 x workaround
         + 1.5 x unknown   (a feature the vendor documentation does not describe)
         + maturity penalty
   ```

   where `redesign`, `workaround` and `unknown` count the listed Oracle features in that state on the target, and the
   maturity penalty is `pg_flex` 0, `pg_elastic` 1, `horizondb` 3, `pg_vm` 4, `pg_aks` 5. A self-managed target displaces flexible server only when flexible server needs
   about two more redesigns than it does for an application that cannot change (`APP_LIMITED`). Ties go to the lower
   penalty. The weights are not measurements. They say, in numbers a reviewer can argue with, that a managed Microsoft
   service wins unless the redesign work it needs is large enough to pay for the operations a self-managed target adds.

`driver` does not change eligibility. `SUPPORT_LIFECYCLE` raises the urgency in the card when the source is 11g, 12c or 18c
(`OP-LIFECYCLE`), which are in Sustaining Support; it never changes the target.

### B2. The alternative

The alternative is the best-ranked survivor that is a different family from the primary and that wins under a stated
condition. The card states that condition. An alternative that has no condition is not an alternative. The alternative is
always one of the eight families above. An Oracle family is not named as the alternative when `driver` is `ORACLE_LICENSE_COST` or
`OPEN_SOURCE_STRATEGY`: it keeps exactly what the customer wants to leave. When no other family survives, the card names no
alternative and says so; it does not reach for a product from another vendor (`OP-SCOPE`).

### B3. Shortlist

When no survivor exists, or when a target that would outrank the chosen primary is **held** at `unknown_requires_assessment`
(for example flexible server held because the Oracle features were never checked, which would otherwise let a weaker target win by
default), the status is `shortlist` and **no primary is named**. A recommendation that a held, better-ranked candidate could
overturn is not a recommendation. The card lists at least two families, why each stands, and what would separate them. A **held** target is one at `unknown_requires_assessment` because of an answer the interview could still collect, or because Microsoft's documentation does not say whether the target meets a requirement the customer stated (the ceilings in `OP-SIZE`, `OP-IO` and `OP-COMPUTE`). Both can be settled with evidence, and until they are the advisor does not tell the customer to stay on Oracle. A hold the target carries by its nature, such as the distribution key an elastic cluster needs whatever the answers, is **not** a held better-ranked candidate: it keeps the target out of the primary choice and out of this test, and the card still names it in the trace. A held target ranks above the primary when its preference penalty (`OP-RANK`) is lower. When fewer than two families stand, the list is filled from the stay-on-Oracle targets that survive and then from the families that come closest, each with the answer to revisit.
A shortlist is a state, not a sentence in the target field.

### B4. PostgreSQL version

Never recommend PostgreSQL 14 or older as a new target. PostgreSQL 11, 12 and 13 are in paid Extended Support. PostgreSQL 14
leaves standard support on 2026-12-11 and is below the converter's floor of 15. Recommend **PostgreSQL 17 or 18**, and state
that PostgreSQL 18 lacks some extensions, so the allow-list is checked first.

---

## Step C: Methods

Four independent decisions, each with candidates, a status and a reason. Only Microsoft services, Microsoft-published tools and
components Azure ships (`OP-SCOPE`) appear as candidates. A method that is never listed is never rejected either, so its
absence cannot be argued with: every Microsoft method the matrix marks `primary` or `secondary` for the chosen target appears in
`methodCandidates`. Where Microsoft has no method, the card carries a **gap** (`methodGaps[]`) that says so.

Method statuses: `available` (nothing consumed rules it out), `unavailable` (something does), `unknown_requires_assessment`
(a field it needs is unanswered or undocumented), `refused` (ruled out by preference, for example preview).

### C1. Schema and code conversion

| Route | Kind | Rule | Gate |
|---|---|---|---|
| `MS_VSCODE_AI`: AI-assisted schema conversion in the PostgreSQL extension for VS Code | migration, **GA** since v1.23.0 (2026-05-26) | `OP-CONVERTER-GATE`, `OP-SOURCE-VERSION` | Oracle 12.1 to 21c. `ORA_11G_OR_OLDER`: `unavailable`. `ORA_23AI_26AI`: `unknown_requires_assessment` (not listed; run a pilot). Needs `converter_prereqs = FOUNDRY_AND_COPILOT_READY`; `FOUNDRY_OR_COPILOT_MISSING` is `unavailable` until the quota and the seat exist; `NOT_SURE` is `unknown_requires_assessment`. The scratch database is a flexible server on PostgreSQL 15 or later |
| `APP_CONVERSION_PREVIEW`: application-code conversion in the same extension | overlay, **Preview** | `OP-PREVIEW` | `PREVIEW_REFUSED`: `refused`. Never replaces schema conversion |

**Choosing the route.** `MS_VSCODE_AI` is the only schema route Microsoft publishes. It is selected when it is `available`, and
also when it is `unknown_requires_assessment`: the card names the pilot that settles it (for example, convert 10 to 15
objects of an Oracle 23ai schema). When it is `unavailable` there is **no selected route** and the card carries the gap
`SCHEMA_CONVERSION` (rule `OP-SCOPE`): Microsoft publishes no other schema converter for Oracle to PostgreSQL, so the conversion
is done by hand to the Microsoft guidance for the objects the converter cannot read, or with a partner chosen by the customer
and the Microsoft account team; this advisor recommends no product. `APP_CONVERSION_PREVIEW` is never selected as the schema route.

The Microsoft converter does **not** move rows. It does not convert users, roles, privileges, VPD, `DBMS_SCHEDULER` jobs,
database links, application contexts, bitmap and global-partitioned indexes, materialized view logs, external tables, Advanced
Queuing, Java in the database, external C libraries, or wrapped PL/SQL. The card lists these as manual workstreams whenever the
schema scan or the interview says the estate uses them.

### C2. Data movement

There is **no Microsoft first-party service that moves Oracle rows to PostgreSQL by change capture**. Azure Database Migration
Service has no Oracle to PostgreSQL scenario, and the PostgreSQL migration service accepts PostgreSQL sources only. Microsoft's
own routes move rows offline: the Azure Data Factory Oracle connector, and `oracle_fdw`, the PostgreSQL extension Azure ships
on flexible server.

`downtime` picks the family (`OP-METHOD-DATA`, `OP-DOWNTIME`):

| `downtime` | Family | Cutover downtime |
|---|---|---|
| `NEAR_ZERO` | online (change data capture) only | minutes |
| `MINIMAL` | online, unless `largest_db_size = UNDER_1_TB` and `network_bandwidth = GOOD_BANDWIDTH`, when an offline load may also meet it | minutes to a couple of hours |
| `OFFLINE` | offline bulk copy | the full load time plus validation |
| `NOT_SURE` | both families, the offline candidates `unknown_requires_assessment` | not stated |

**Online family: a gap.** No change-capture service is published by Microsoft, so there is no online candidate and no
selected data route. The card carries the gap `ONLINE_CAPTURE` (rule `OP-SCOPE`): "Microsoft offers no change data capture from
Oracle to PostgreSQL. A downtime this short needs a capture product from outside Microsoft. This advisor recommends none; the
Microsoft account team can say what options exist. Whatever is chosen needs ARCHIVELOG mode with supplemental logging on the
source and a private network path. The Microsoft routes below move rows offline, and their downtime is the full load time plus
validation, which the rehearsal measures." The offline candidates are then `unavailable` for this downtime, and the plan lists the
prerequisites any capture product needs.

**Offline candidates:**

| Route | Notes |
|---|---|
| `ADF_COPY` | Azure Data Factory Oracle connector v2.0. Moves rows; no DDL, no change capture. Microsoft's service |
| `ORACLE_FDW_COPY` | `INSERT ... SELECT` over `oracle_fdw`, flexible server, `pg_vm` and `pg_aks` (absent on HorizonDB), needs a network path (`OP-ORACLE-FDW-PATH`: `private_connectivity = PRIVATE_LINK_READY`). Also the basis for in-database comparison. What it needs on flexible server is not fully documented, which the card says |

**Choosing the route.** The selected data route is the first `available` candidate in the order `ADF_COPY`, `ORACLE_FDW_COPY`.
When none is `available`, it is the first `unknown_requires_assessment` one, and when neither exists (the online family) it is
none, with the gap. A route is selected only when the primary is a PostgreSQL target: for `oracle_dbaz` and `oracle_vm` Step C
does not apply, `methodCandidates` is empty and the card says the move is a rehost done with Oracle's own tooling, which this
advisor does not cover.

`OP-SEED`: `network_bandwidth = LIMITED_WAN` or `VERY_LARGE_MULTI_TB` makes a row copy over the wire impractical. The card
recommends exporting to files and shipping them (Azure Data Box or Storage Mover) and loading with COPY. The shipped copy is a
transport. It is not a method, because it has no cutover of its own, and closing the gap after it needs capture, which is the
`ONLINE_CAPTURE` gap again.

`OP-CHARSET`: `character_set` other than `AL32UTF8` needs a conversion to UTF-8 during load, and characters that do not map
are a data-quality finding. `NOT_SURE` is an unknown. PostgreSQL rejects NUL characters in text.

### C3. Validation

Always recommended; never a gate. "Converted" is not "equivalent", and Microsoft's own documentation says so.

| Route | Notes |
|---|---|
| `PLPGSQL_CHECK` | Static analysis of converted PL/pgSQL. Version 2.8 on PostgreSQL 14 to 18. It must be allow-listed **and** preloaded, then the server restarted; the converter runs it on the scratch database, and if the extension is missing the check silently does not run. **Absent on HorizonDB** |
| `DIFFERENTIAL_TESTING` | The same queries and workloads on both sides, result sets diffed. The only route that catches a converted query that is wrong and quiet |
| `ORACLE_FDW_COMPARE` | Row-level comparison through foreign tables. Needs primary keys. Collation must be `C` or ordering differs |

### C4. Assessment

| Route | Kind | Notes |
|---|---|---|
| `SCHEMA_SCAN` | assessment | This repository's static scan of Oracle source. Needs no database connection. Reads text only. Its effort figure follows the unit convention published with Ora2Pg 25.0 and a second figure for AI-assisted conversion; neither is a measurement |
| `VSCODE_DISCOVERY` | assessment | The discovery step of the Microsoft converter: object inventory, dependent schemas, invalid objects. No effort estimate |
| `AWR_SIZING` | assessment | Oracle AWR and ASH reports for IOPS, throughput, CPU and memory. The only honest source for sizing a target |

Azure Migrate does not assess Oracle databases. The Azure Copilot Migration Agent does not cover them either.

---

## Step D: Output

### D1. Blockers, unknowns and evidence

Every decision-driving field that ended `UNKNOWN` appears in both `unknowns[]` and `evidenceRequired[]`. A prerequisite the
interview cannot reach at all is not a hard-gate unknown: it belongs in `evidenceRequired[]` and `nextActions[]` and does not
lower confidence.

### D2. Confidence and status

| `confidence` | Meaning |
|---|---|
| `medium` | Triage is complete and consistent. The ceiling: the skill reads no artefact from the estate |
| `low` | At least one decision-driving unknown remains, a capacity answer was assumed, the status is `shortlist`, or two answers conflict |

The **decision-driving** fields are `source_version`, `app_changeability`, `isv_supports_postgres`, `feature_dependencies` and `downtime`: each can change a state or a route. `converter_prereqs` becomes decision-driving once the Microsoft converter is the selected schema route. What lowers confidence is an unanswered field. A route that is unknown because the vendor does not list the source release (the Microsoft converter on Oracle 23ai) is named with the pilot that settles it and does not by itself lower confidence. A gap (`methodGaps[]`) does not lower it either: it is a fact about what Microsoft offers, not a question the interview left open. Any other unanswered field is recorded in `unknowns[]` and `evidenceRequired[]` and does not by itself lower the confidence. A target held by its own nature (an elastic cluster's distribution key) is not an unknown in this sense, and a prerequisite the interview cannot reach (for example whether Foundry quota can be granted) belongs in `evidenceRequired[]` and `nextActions[]`.

`recommendationStatus` is `provisional` when one target is named, `shortlist` when none is. `validated` and
`high` do not exist: promoting a recommendation needs real artefacts, opened and recorded with their tool, version, date and
approver, and that belongs to a workflow that can open them.

### D3. Cost levers (`OP-COST-LEVERS`)

State only what is sourced, and never a figure without measured sizing and stated pricing assumptions.

- Retiring Oracle licences and annual support: the saving depends on the customer's Oracle contract. Confirm with Oracle contract and licence management.
- **Azure Hybrid Benefit does not apply to Azure Database for PostgreSQL**, so there is no licence to bring.
- Reserved capacity is for compute only. Microsoft's pages quote three different maxima, so use the calculator for the region and SKU.
- High availability doubles compute and storage cost. Use zone-redundant HA only where the availability target needs it.
- Burstable plus stop and start suits dev and test only. It is not for production and has no HA.
- Storage can only grow. Premium SSD v2 sets capacity, IOPS and throughput separately.
- Keeping Oracle on Azure virtual machines is the benchmark: two Azure vCPUs are one Oracle processor licence with multithreading on, with no core factor discount.

### D4. Programme fit (`OP-COST-LEVERS`)

Quote both names: Microsoft is renaming the programme.

- **Frontier Accelerate for Azure and for Databases** (formerly Azure Accelerate): partner-nominated delivery funding and credits, advertised at 50% of year-one usage, subject to application and approval. A May 2026 Partner Center notice names Oracle to Azure PostgreSQL. Engage through the account team or a specialised partner.
- **Cloud Accelerate Factory**: zero-cost Microsoft delivery assistance alongside a partner. Oracle to PostgreSQL is not named. Nomination is required, and the value is not guaranteed.
- **FastTrack for Azure**: free remote guidance for nominated projects above $5,000 a month. Database scope is not stated.

### D5. Retired: never recommend

Never recommend any of these, and say what replaces each.

| Item | Replacement |
|---|---|
| Azure Data Studio and its migration extensions (retired 2026-02-28; Oracle assessment and conversion extensions 2024-12-15) | the PostgreSQL extension for VS Code |
| Azure Database for PostgreSQL Single Server (2025-03-28) | flexible server |
| Azure Arc-enabled PostgreSQL (2025-07) | flexible server |
| Azure Cosmos DB for PostgreSQL for new work | flexible server elastic clusters |
| Azure Database Migration Service for Oracle to PostgreSQL | it never existed. There is no Microsoft row-movement service |
| SSMA for Oracle as a route to PostgreSQL | it targets SQL Server and Azure SQL only |
| Azure Migrate as an Oracle database assessor | the discovery step of the converter, the schema scan |
| Azure Data Factory Oracle connector v1.0 (removed 2026-03-31) | connector v2.0 |
| PostgreSQL 11, 12, 13 and 14 as a new target | PostgreSQL 17 or 18 |

### D6. Reverse path

PostgreSQL to Oracle is not a supported Microsoft path, and Microsoft offers no reverse replication. A rollback plan is a retained
Oracle copy that is not updated after cutover, or a capture setup from outside Microsoft agreed before cutover. The card says
which, rather than promising either.

---

## Rule index

Every rule ID the skill may cite. `tests/run-tests.mjs` fails when this list and the engine disagree.

| ID | Step | One line |
|---|---|---|
| `OP-ISV` | A | A packaged vendor application decides what is supported |
| `OP-COSMOS` | A | Cosmos DB for PostgreSQL is closed to new deployments |
| `OP-FEATURE-GATE` | A | Unchecked Oracle features hold the narrower targets |
| `OP-FEATURE-MATRIX` | A | Each listed feature is read from the feature by target table |
| `OP-FROZEN-REDESIGN` | A | A frozen application cannot take a redesign |
| `OP-SIZE` | A | Planned database size against each target's ceiling |
| `OP-IO` | A | Peak IOPS and throughput against the disk ceilings |
| `OP-COMPUTE` | A | Peak vCores and memory against the SKU ceilings |
| `OP-V6` | A | 97 to 192 vCores is reachable only on the preview V6 SKUs |
| `OP-AVAILABILITY` | A | The availability target against each target's SLA |
| `OP-REGION-HA` | A | Zone-redundant HA is blocked or absent in some regions |
| `OP-DR` | A | Cross-region recovery point against replication that is asynchronous |
| `OP-CMK` | A | Customer-managed keys are a creation-time choice and absent on HorizonDB |
| `OP-MANAGEMENT` | A | Managed, OS-level or Kubernetes control |
| `OP-REGION` | A | Sovereign and air-gapped requirements |
| `OP-PREVIEW` | A | HorizonDB is a preview with no SLA |
| `OP-HZ-GATE` | A | HorizonDB preview gaps: keys, DR, retention, networking |
| `OP-HZ-REGION` | A | HorizonDB regions |
| `OP-STAY-ORACLE` | A | Oracle on Azure as a legitimate target |
| `OP-STAY-REGION` | A | Oracle AI Database@Azure regions and tenancy |
| `OP-INTENT` | A | Rehost first, or assess only |
| `OP-RAC` | A | PostgreSQL has one writer |
| `OP-ESTATE` | A | Large estates are scanned and grouped first |
| `OP-LICENSE-NOTE` | A | Oracle entitlement is a contract question |
| `OP-RANK` | B | Order of the survivors |
| `OP-LIFECYCLE` | B | Oracle support dates as urgency, never as a target |
| `OP-SCOPE` | C | Microsoft services only; where Microsoft has no product the card says so (a gap) |
| `OP-CONVERTER-GATE` | C | The Microsoft converter's versions and prerequisites |
| `OP-SOURCE-VERSION` | C | Source-version support of the Microsoft converter |
| `OP-METHOD-DATA` | C | Downtime picks the family of data path |
| `OP-DOWNTIME` | C | What each downtime class means in minutes |
| `OP-SEED` | C | Seed by shipping files when the wire is the limit |
| `OP-ORACLE-FDW-PATH` | C | oracle_fdw needs a network path to Oracle |
| `OP-CHARSET` | C | Character set conversion to UTF-8 |
| `OP-PLSQL` | D | PL/SQL volume bands, from the scan where there is one |
| `OP-APP-TIER` | D | Oracle components around the database are application work |
| `OP-EVIDENCE` | D | Stated evidence is a claim, never proof |
| `OP-COST-LEVERS` | D | Cost levers and programme fit, sourced and caveated |
