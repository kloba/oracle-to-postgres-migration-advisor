# Oracle to Azure Database for PostgreSQL: knowledge base for the migration advisor

> **Status: preliminary.** Every statement here is provisional. Last verified **2026-10-12**. Knowledge base **v1.0**, written for decision rules **v1.0**.
> This is the source-backed reading that the rules in [`reference/decision-rules.md`](../reference/decision-rules.md) rest on. It is not an assessment of any estate.

Audience: a Microsoft or partner architect who is starting an Oracle to PostgreSQL on Azure engagement. After reading it you should know the target options, the tool options, the compatibility traps, and what nobody has settled yet.

---

## 0. How to read this document

### 0.1 Status vocabulary

| Term | Meaning in this document and in the advisor |
|---|---|
| `provisional` | One target and one method path are named. Nothing is certified. The advisor reads no artefact from the estate, so it cannot confirm anything it is told. |
| `shortlist` | No primary target is named. Either no rule separates the candidates, or a better-ranked candidate is held on an unanswered question. A shortlist is a state, not a sentence. |
| confidence `medium` | Triage is complete and consistent. This is the ceiling. |
| confidence `low` | A decision-driving unknown remains, a capacity answer was assumed, the status is `shortlist`, or two answers conflict. |
| preliminary | The status of every output, and of this document. |

The five eligibility states used for a target are `eligible`, `eligible_with_remediation`, `unsupported`, `excluded_by_preference` and `unknown_requires_assessment`. `unsupported` is a technical incompatibility. `excluded_by_preference` is something the customer said they prefer, so it can be revisited without re-arguing feasibility. The method statuses are `available`, `unavailable`, `refused` and `unknown_requires_assessment`.

### 0.2 Tags in the text

| Tag | Meaning |
|---|---|
| `checked 2026-10-12` | The linked page was read on that date. Every volatile fact (a date, a region, a version, a programme name) carries its link and this tag. |
| `unverified` | The research found the claim only on a secondary source, or reached it by inference. It is kept so that a reader can test it. It must not be repeated to a customer as fact. |
| `not sourced` | No page in `reference/sources.json` supports the statement. It is listed in the project notes and is open for a source to be added. |
| `conflict` | Two sources, or a source and the project data, disagree. The project data wins and the disagreement is stated. |

Link text is the title of the page as it appears in `sources.json`. No other URL is cited. Rule IDs such as `OP-RANK` are written in backticks and can be looked up in the rule index in section 1.

### 0.3 What the advisor does not do

- It gives **no sizing**. Planned size, IOPS, vCores and memory are answers the customer gives. The only honest source for sizing is a workload report such as Oracle AWR and ASH, which the advisor does not read.
- It states **no cost figure** for an estate, no saving percentage and no price. A cost is a lever, not a figure (`OP-COST-LEVERS`). Programme thresholds are quoted only when a source states them.
- It **reads no artefact** from the estate. A schema scan, an effort estimate or an AWR report that the customer mentions is recorded as a claim to verify elsewhere (`OP-EVIDENCE`). It never raises the status above `provisional` or the confidence above `medium`.
- It never recommends anything on the retired list (section 11).
- It never says that a Microsoft migration service, or the Microsoft converter, moves Oracle rows to PostgreSQL. No such service exists (section 5).
- It recommends only Microsoft services, Microsoft-published tools and Azure-hosted offerings (`OP-SCOPE`). Where Microsoft has no product for a step, it says so and names none (section 7).

### 0.4 Reading order

Sections 1 to 3 give the decision and the facts behind it. Sections 4 and 5 cover the two big work streams: converting code and moving rows. Section 6 is the compatibility catalogue. Section 7 lists what Microsoft has no product for. Sections 8 to 10 cover validation, cutover and money. Section 11 is the retired list. Section 12 lists what is still unknown and who could settle it.

---

## 1. Summary: the decision in one page

The advisor works in three phases. **Phase A** rules each of eight target families in, out, or on hold. **Phase B** ranks the survivors and names one primary and one alternative, or declines to and returns a shortlist. **Phase C** picks a route for each of four method decisions: schema and code conversion, data movement, validation and assessment. Each verdict carries a rule ID.

### 1.1 Situation to target

| Situation | Assess first | Why | Rules |
|---|---|---|---|
| A packaged vendor application (E-Business Suite, PeopleSoft, a core-banking suite) whose vendor does not support PostgreSQL | Stay on Oracle: `oracle_dbaz` or `oracle_vm` | Moving the database does not move the application. The vendor decides what is supported, so every PostgreSQL target is `unsupported`. If the vendor's position is unknown, every PostgreSQL target is held. | `OP-ISV`, `OP-INTENT` |
| The customer wants to rehost first | `oracle_dbaz` when RAC, Exadata or Enterprise Edition is in play and its gates pass, otherwise `oracle_vm` | An honest advisor sometimes says "do not migrate to PostgreSQL". Both targets stay on Oracle. | `OP-INTENT`, `OP-STAY-ORACLE`, `OP-STAY-REGION` |
| The customer wants a fully managed service | `pg_vm`, `pg_aks` and `oracle_vm` are set aside by preference | The customer would own HA, patching and backup. The preference can be revisited, so these are `excluded_by_preference`, not `unsupported`. | `OP-MANAGEMENT` |
| The customer insists on Kubernetes, or on operating-system control | `pg_aks` for Kubernetes, `pg_vm` for OS control. For OS control `oracle_dbaz` is set aside by preference. | Managed PostgreSQL has no superuser, no file system and no custom extensions, and Oracle operates the Database@Azure infrastructure. | `OP-MANAGEMENT` |
| A downtime of minutes (`NEAR_ZERO`, or `MINIMAL` on a large database) | No data route. The card shows the gap `ONLINE_CAPTURE` | Microsoft offers no change-capture service from Oracle to PostgreSQL. The offline routes (`ADF_COPY`, `ORACLE_FDW_COPY`) take the full load time plus validation. The advisor recommends no product from outside Microsoft. | `OP-SCOPE`, `OP-METHOD-DATA`, `OP-DOWNTIME` |
| The source is Oracle 11g or older, or the converter's prerequisites do not exist yet | No schema route. The card shows the gap `SCHEMA_CONVERSION` | Microsoft's converter lists Oracle 12.1 to 21c and needs a Foundry deployment and a Copilot seat. Microsoft publishes no other converter, and the advisor names none. | `OP-SCOPE`, `OP-SOURCE-VERSION`, `OP-CONVERTER-GATE` |
| Anything else that survives Phase A | `pg_flex` on PostgreSQL 17 or 18 | A managed Microsoft service wins unless the redesign it needs is large enough to pay for the operations that a self-managed target adds. | `OP-RANK` |
| Planned size of 64 to 128 TB | Flexible server is out. `pg_elastic` only if the workload shards. `horizondb` only if a preview is acceptable. `pg_vm` and `pg_aks` are held. | The ceiling is 64 TiB on flexible server and 128 TB on HorizonDB (preview). | `OP-SIZE` |
| Peak compute of 97 to 192 vCores | `pg_flex` on the V6 preview SKUs, only if a preview is acceptable | General availability stops at 96 vCores. | `OP-COMPUTE`, `OP-V6` |
| Peak IO from 20,000 to 80,000 IOPS | `pg_flex` needs Premium SSD v2 and is `eligible_with_remediation`. | Premium SSD v2 has no storage autogrow, no long-term retention backups and no on-demand backups. | `OP-IO` |
| Peak IO over 80,000 IOPS | `pg_flex` is out. `horizondb`, `pg_vm` and `pg_aks` are held. | Premium SSD v2 tops out at 80,000 IOPS and 1,200 MiB/s. | `OP-IO` |
| Availability target of 99.99% | `pg_flex` with zone-redundant HA, after a region check. `horizondb` is out. | HorizonDB publishes no SLA. | `OP-AVAILABILITY`, `OP-REGION-HA` |
| Zero data loss across regions | Flexible server, elastic cluster and HorizonDB are out. `pg_vm` and `pg_aks` remain with synchronous replication. | Cross-region replication on the managed services is asynchronous. | `OP-DR` |
| Customer-managed keys | `pg_flex`, chosen at creation and not reversible. `horizondb` is out. | Preview HorizonDB has service-managed keys only. | `OP-CMK`, `OP-HZ-GATE` |
| Preview refused | `horizondb` is excluded by preference, and so is `pg_flex` when the compute need is 97 to 192 vCores. The preview application-conversion tool is `refused`. | Refusing a preview method never removes a generally available target when another viable method exists. | `OP-PREVIEW`, `OP-V6` |
| The Oracle feature list was never checked | Hold `pg_flex`, `pg_elastic`, `horizondb` and `pg_aks`. The status becomes `shortlist` when a held target would outrank the primary. | A recommendation that a held candidate could overturn is not a recommendation. | `OP-FEATURE-GATE`, `OP-FEATURE-MATRIX` |
| Government sovereign or air-gapped requirement | The managed targets are held (sovereign) or out (air-gapped). `pg_vm` and `pg_aks` remain for an air-gapped site. | Sovereign-region availability is not established for Microsoft's managed PostgreSQL services. | `OP-REGION`, `OP-STAY-REGION` |
| Azure Cosmos DB for PostgreSQL | Never. | New deployments are blocked and the service retires on 2029-03-31. | `OP-COSMOS` |
| The source is Oracle 11g, 12c or 18c | No change of target. The urgency rises. | These releases are in Sustaining Support. Lifecycle never changes the target. | `OP-LIFECYCLE` |

The sources for the thresholds in this table are in section 2, where each family is described, and each volatile number is linked there.

### 1.2 How Phase B scores the survivors

A target survives when it is `eligible` or `eligible_with_remediation`. Held targets are named on the card with the evidence that would release them. The primary is picked by the first of these that applies: `OP-INTENT`, then `OP-ISV` and `OP-STAY-ORACLE`, then `OP-MANAGEMENT`, then the lowest score from `OP-RANK`:

```text
score = 3 x redesign   (APP_LIMITED)   or   1 x redesign   (APP_CHANGEABLE, or not stated)
      + 0.25 x workaround
      + 1.5 x unknown   (a feature the vendor documentation does not describe)
      + maturity penalty

maturity penalty: pg_flex 0, pg_elastic 1, horizondb 3, pg_vm 4, pg_aks 5
```

The counts are the listed Oracle features that the feature matrix (section 6.2) marks `redesign`, `workaround` or `unknown` for that target. The weights are not measurements. They say, in numbers a reviewer can argue with, that a managed Microsoft service wins unless the redesign work it needs outweighs the operations a self-managed target adds.

The alternative is the best-ranked survivor from a different family, with the condition under which it wins. It is always one of the eight families, and it may be absent: when no other family survives, the card names none and says so. An Oracle family is not named as the alternative when `driver` is `ORACLE_LICENSE_COST` or `OPEN_SOURCE_STRATEGY`, because it keeps what the customer wants to leave (step B2).

### 1.3 How the four method decisions are made

| Decision | Preferred order | Rules |
|---|---|---|
| Schema and code conversion | `MS_VSCODE_AI`, the only schema route Microsoft publishes. It is chosen while it is `available` or merely unproven (a pilot settles it). Otherwise there is no route and the card shows the gap `SCHEMA_CONVERSION`. | `OP-CONVERTER-GATE`, `OP-SOURCE-VERSION`, `OP-SCOPE` |
| Data movement | `NEAR_ZERO` and `MINIMAL` downtime need change capture, and Microsoft has none: no route, and the gap `ONLINE_CAPTURE`. `OFFLINE` uses `ADF_COPY`, then `ORACLE_FDW_COPY`. No Microsoft migration service moves Oracle rows. | `OP-METHOD-DATA`, `OP-DOWNTIME`, `OP-SCOPE`, `OP-SEED` |
| Validation | Always recommended. Never a gate. "Converted" is not "equivalent". | section 8 |
| Assessment | `SCHEMA_SCAN`, `VSCODE_DISCOVERY`, `AWR_SIZING`. Azure Migrate does not assess Oracle databases. | section 4.7 |

### 1.4 The PostgreSQL major version

Never recommend PostgreSQL 14 or older as a new target. The rules recommend **PostgreSQL 17 or 18** and require the extension allow-list to be checked first, because PostgreSQL 18 lacks some extensions (step B4 of the decision rules). Elastic clusters run PostgreSQL 17 and 18 only, and the HorizonDB extension table lists PostgreSQL 17 only (section 2). The dates are in section 2.1.

### 1.5 The answers that change the result most

Most answers only adjust a score. These can flip a target from eligible to unsupported, or move the status to `shortlist`. Ask them first, and do not guess them.

| Answer | What it can flip | Rule |
|---|---|---|
| Is the application a packaged vendor product, and does the vendor support PostgreSQL | Every PostgreSQL target at once | `OP-ISV` |
| Has the Oracle feature list been checked | Holds four targets until a scan runs | `OP-FEATURE-GATE` |
| Whether the application can change | Whether a feature that needs a redesign rules a target out (frozen) or only weighs on its score (limited) | `OP-FROZEN-REDESIGN`, `OP-RANK` |
| Is a preview acceptable | HorizonDB, the V6 SKUs and the application-conversion tool | `OP-PREVIEW`, `OP-V6` |
| Availability target and region | Zone-redundant HA, and HorizonDB (no SLA) | `OP-AVAILABILITY`, `OP-REGION-HA` |
| Cross-region recovery point | Every managed Microsoft target | `OP-DR` |
| Planned size, peak IO and peak compute | Flexible server ceilings | `OP-SIZE`, `OP-IO`, `OP-COMPUTE` |
| Downtime tolerance | Whether a data route exists at all: minutes of downtime needs change capture, which Microsoft does not offer (a gap) | `OP-METHOD-DATA`, `OP-SCOPE` |
| Oracle source version | Whether Microsoft's converter can be used, or schema conversion is a gap | `OP-SOURCE-VERSION`, `OP-CONVERTER-GATE`, `OP-SCOPE` |

A capacity field answered "not sure" records an assumption and an unknown and lowers confidence. It does not hold the target, because most estates fit and the question is asked in triage.

### 1.6 Rule index

The index is generated from the rule file. It lists every rule ID the advisor may cite, the phase it belongs to and one line on what it does. Rule IDs used elsewhere in this document are looked up here.

<!-- GENERATED:rule-index -->
| Rule | Step | One line |
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
<!-- /GENERATED -->

---

## 2. The eight target families

Six of the eight are PostgreSQL targets. The last two stay on Oracle and are on the list so that "do not migrate" can be argued with. All eight are Azure services or run on Azure (`OP-SCOPE`).

| ID | Family | Status | Who operates it, and who owns the SLA |
|---|---|---|---|
| `pg_flex` | Azure Database for PostgreSQL flexible server | GA | Microsoft operates it. Microsoft owns the SLA. |
| `pg_elastic` | Flexible server elastic cluster (Citus-based, sharded) | GA since 2025-11 | Microsoft. |
| `horizondb` | Azure HorizonDB for PostgreSQL | Public preview since 2026-06-02 | Microsoft. No SLA is published. |
| `pg_vm` | PostgreSQL on Azure virtual machines | Customer operated | The customer. No managed-service SLA. |
| `pg_aks` | PostgreSQL on AKS with CloudNativePG | Customer operated | The customer. Excluded from the AKS SLA. |
| `cosmos_pg` | Azure Cosmos DB for PostgreSQL | New deployments blocked | Retires 2029-03-31. |
| `oracle_dbaz` | Oracle AI Database@Azure | GA | Oracle operates the infrastructure. |
| `oracle_vm` | Oracle Database on Azure virtual machines | Customer operated | The customer. |

### 2.0 Limits at a glance

The table below is generated from `reference/decision-rules.data.json`. It shows the numbers that the Phase A rules compare an answer against: storage, IOPS, throughput, vCores, memory, replicas, backup retention, SLA percentages and the HorizonDB and elastic-cluster limits. Read it as service limits, not as performance guarantees. Three cautions apply.

- Effective IOPS and throughput are also capped by the virtual machine size. Microsoft's compute page gives D32ds_v5 as 51,200 IOPS and 865 MiB/s, and says D64 and E64 sizes and above reach 80,000 IOPS and 1,200 MiB/s ([Compute](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), checked 2026-10-12). Choosing a bigger SKU is the usual answer, not rejecting the target.
- Microsoft's own pages disagree in places: the limits page still describes storage that scales in doubling steps with a restart, which is Premium SSD behaviour and not Premium SSD v2 behaviour; and the compute page lists V6 rows without the preview label that the overview page gives them ([Azure Database for PostgreSQL limits](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits), checked 2026-10-12, [Azure Database for PostgreSQL overview (regions, HA, V6)](https://learn.microsoft.com/en-us/azure/postgresql/overview), checked 2026-10-12). The project data follows the overview page: V6 is a public preview.
- Premium SSD v2 has a default regional quota of 32 TiB per subscription per region. Above that a quota request is needed ([Storage](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage), checked 2026-10-12).

<!-- GENERATED:limits -->
| | Flexible server | Elastic cluster | HorizonDB |
|---|---|---|---|
| Status | Generally available | GA since 2025-11 | Public Preview since 2026-06-02 |
| PostgreSQL majors | 15, 16, 17, 18 (16 to 18 recommended; 14 is avoided) | 17, 18 | 17 |
| Largest storage | 32 TiB on Premium SSD; 64 TiB on Premium SSD v2 | per node; storage does not autogrow | 128 TB |
| Peak IOPS | 20,000 (Premium SSD); 80,000 (Premium SSD v2) | not stated here | not published |
| Peak throughput | 900 MiB/s; 1,200 MiB/s | not stated here | not published |
| Compute | up to 96 vCores GA; 192 on V6 (preview) | scale out, up to 20 nodes self-service | up to 192 vCores per replica |
| Memory | up to 672 GiB GA; 1,832 GiB on V6 | per node | not published |
| Read replicas | 5 direct, 30 with cascading | one | up to 15 |
| Availability SLA | 99.99% zone-redundant HA; 99.95% same-zone HA; 99.9% without HA | per-node HA | none published |
| Backup | point-in-time restore 7 to 35 days; long-term retention up to 10 years for databases up to 1 TiB | see Microsoft documentation | fixed 7 days |
| Default maximum connections | 5,000 from 16 vCores | not stated here | not published |
| Not supported | no storage autogrow; no long-term retention backups; no on-demand backups; not on PostgreSQL 13; not on Burstable (Premium SSD v2) | one database per cluster; no in-place major version upgrade; a single read replica; private endpoints only; no storage autogrow | customer-managed keys; cross-region read replicas; long-term retention; VNet injection; built-in PgBouncer; configurable maintenance window; oracle_fdw; pg_hint_plan; plpgsql_check |

Flexible server standard support ends: PostgreSQL 14: 2026-12-11; PostgreSQL 15: 2027-11-11; PostgreSQL 16: 2028-11-09; PostgreSQL 17: 2029-11-08; PostgreSQL 18: 2030-11-14. HorizonDB regions in the preview: canadacentral, centralus, eastus, westus2, westus3, germanywestcentral, swedencentral, australiaeast, koreacentral.
<!-- /GENERATED -->

### 2.1 pg_flex: Azure Database for PostgreSQL flexible server

**What it is.** Microsoft's first-party managed service on community PostgreSQL. It is the default first target (`OP-RANK`, maturity penalty 0).

**Status and dates.** Generally available. PostgreSQL 15 to 18 are in standard support. Standard support ends 2026-12-11 for PostgreSQL 14, 2027-11-11 for 15, 2028-11-09 for 16, 2029-11-08 for 17 and 2030-11-14 for 18 ([Version policy](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-version-policy), checked 2026-10-12). PostgreSQL 11, 12 and 13 left standard support on 2026-07-31 and are in paid Extended Support ([Extended support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support), checked 2026-10-12). The extended-support page implies a later date for PostgreSQL 14 than the version-policy page does; the project uses the earlier 2026-12-11 (conflict, recorded in the project notes). PostgreSQL 18 lacks some extensions and cannot set `io_method = io_uring` ([Supported PostgreSQL versions](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-supported-versions), checked 2026-10-12).

**Hard limits.**

- Storage from 32 GiB to 64 TiB. Premium SSD reaches 32 TiB, 20,000 IOPS and 900 MiB/s. Premium SSD v2 reaches 64 TiB, 80,000 IOPS and 1,200 MiB/s ([Storage](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage), checked 2026-10-12, [Premium SSD v2](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage-premium-ssd-v2), checked 2026-10-12).
- Premium SSD v2 has no storage autogrow, no long-term retention backups and no on-demand backups. It does not run on PostgreSQL 13 or on Burstable. IOPS and throughput can be changed only a limited number of times a day, and chained operations such as HA, scaling and failover can raise disk-hydration errors (unverified detail from the research reading of [Premium SSD v2](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage-premium-ssd-v2), checked 2026-10-12).
- Storage only grows. The server goes read-only at 95% used. A major version upgrade needs 10 to 20% free. This is why the advisor divides the planned size by an 80% fill target (`OP-SIZE`).
- Compute: up to 96 vCores and 672 GiB of memory in general availability. The V6 SKUs reach 192 vCores and 1,832 GiB, but they are a public preview, have no VNet integration and cannot scale to or from Burstable (`OP-V6`) ([Compute](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), checked 2026-10-12, [Azure Database for PostgreSQL overview (regions, HA, V6)](https://learn.microsoft.com/en-us/azure/postgresql/overview), checked 2026-10-12).
- Burstable is not for production. It has no HA and no read replicas ([Compute](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), checked 2026-10-12).
- Connections: 5,000 by default from 16 vCores. Raising it is discouraged. The built-in PgBouncer is the intended answer ([Azure Database for PostgreSQL limits](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits), checked 2026-10-12).
- Read replicas: 5 direct, 30 in total with cascading. Replication is asynchronous. Lag is usually seconds to minutes and, in the page's words, "could extend to hours" under heavy write load ([Read replicas](https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas), checked 2026-10-12).
- Backup: point-in-time restore for 7 to 35 days. Restore always makes a new server. Long-term retention reaches 10 years, only for databases up to 1 TiB, and restores as files ([Backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), checked 2026-10-12).
- No superuser, no tablespaces, no custom extensions. The server's administrator role is `azure_pg_admin`, which is restricted ([Access control and privileges](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control), checked 2026-10-12).

**HA, DR and SLA.** The SLA is 99.99% with zone-redundant HA, 99.95% with same-zone HA and 99.9% with no HA ([Reliability, HA and SLA](https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql), checked 2026-10-12, [Service Level Agreements for Online Services](https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services?lang=1), checked 2026-10-12). Zone-redundant failover typically takes 60 to 120 seconds, and RPO is zero for a zone failure. HA doubles compute and storage cost, because the standby is billed like the primary. Cross-region recovery is a cross-region read replica with manual promotion. Forced promotion can lose data that was not yet replicated, which is why `OP-DR` refuses zero RPO across regions. Geo-redundant backup is chosen only at creation.

Zone-redundant HA is volatile. The project data lists regions where new zone-redundant deployments are currently blocked and regions where zone-redundant HA is unavailable. Re-check in the portal before promising a region ([Azure Database for PostgreSQL overview (regions, HA, V6)](https://learn.microsoft.com/en-us/azure/postgresql/overview), checked 2026-10-12).

- Blocked for new deployments: Brazil South, Central India, East Asia, East US, East US 2, Germany West Central, Mexico Central, North Europe, Qatar Central, South Central US, Southeast Asia, West Europe, West US 2.
- Unavailable: West US, North Central US, UK West, Canada East, Japan West, Australia Southeast, Korea South, Norway West, Switzerland West, UAE Central.
- Microsoft's overview page and a roundup page disagree on Japan West (conflict). The page's own advice is to use a sibling region in the same geography or to accept 99.95% (`OP-REGION-HA`).

**Extensions that matter for Oracle estates.** `oracle_fdw` 1.2 (generally available since December 2024), `orafce` 4.16, `pg_hint_plan`, `plpgsql_check` 2.8, `pg_partman`, `pg_cron`, `session_variable`, `login_hook`, `pg_ivm`, `azure_storage`, `dblink`, `postgres_fdw`. Details and caveats are in section 6.5.

**What it cannot carry.** The feature matrix (section 6.2) marks 15 listed Oracle features `redesign` on flexible server: Advanced Queuing, Java in the database, external C procedures, network access from the database, advanced spatial, schema-based XML, Multimedia, Label Security and Database Vault, Flashback, edition-based redefinition, advanced scheduler features, the PL/SQL web toolkit, object type inheritance, fast-refresh materialized views and Exadata offload. It marks `RAC_WRITE_SCALE`, package state, autonomous transactions and heavy partitioning `workaround`.

**What would change this.** A general-availability announcement for the V6 SKUs. Zone-redundant HA reopening in the blocked regions. Long-term retention and autogrow on Premium SSD v2. A newer PostgreSQL major with the extensions the estate needs.

### 2.2 pg_elastic: flexible server elastic cluster

**What it is.** A sharded cluster built on Citus, where each node is a flexible server. Rows or schemas are distributed across nodes by a distribution key ([Elastic clusters](https://learn.microsoft.com/en-us/azure/postgresql/elastic-clusters/concepts-elastic-clusters), checked 2026-10-12). It replaces Azure Cosmos DB for PostgreSQL for new work.

**Status and dates.** Generally available since 2025-11.

**Hard limits** ([Elastic cluster limitations](https://learn.microsoft.com/en-us/azure/postgresql/elastic-clusters/concepts-elastic-clusters-limitations), checked 2026-10-12):

- 20 nodes by self-service. More needs a support case.
- PostgreSQL 17 and 18 only.
- One database per cluster. `CREATE DATABASE` fails.
- No in-place major version upgrade.
- A single read replica.
- Private endpoints only. No VNet injection.
- No storage autogrow.
- Unsupported extensions include `anon`, `postgis_topology` and TimescaleDB.

**HA, DR and SLA.** Per-node HA. The SLA for elastic clusters is not stated in the sources the project holds (not sourced).

**What it cannot carry.** It is not a lift-and-shift target. A monolithic estate with joins and constraints across what would become shards needs a data-model change (`OP-SIZE` marks it `unknown_requires_assessment` because it needs a distribution key). `RAC_WRITE_SCALE` and heavy partitioning are `redesign` in the matrix. Whether `oracle_fdw` and PostGIS work on an elastic cluster is not confirmed.

**What would change this.** Storage autogrow, Premium SSD v2 and a higher per-node ceiling reaching general availability. The Cosmos DB for PostgreSQL migration page lists these as planned; that page is not in `sources.json`, so the roadmap is `not sourced`.

### 2.3 horizondb: Azure HorizonDB for PostgreSQL

**What it is.** A Postgres-compatible service with stateless compute on shared storage. A cluster has one primary and readable standbys behind read-write and read-only endpoints ([Azure HorizonDB overview](https://learn.microsoft.com/en-us/azure/horizondb/overview), checked 2026-10-12).

**Status and dates.** **Public preview since 2026-06-02, with no published SLA.** It is not generally available. No general-availability date appears on the release notes or the Build announcement ([Azure HorizonDB release notes](https://learn.microsoft.com/en-us/azure/horizondb/release-notes/release-notes), checked 2026-10-12, [Azure HorizonDB public preview (Build)](https://techcommunity.microsoft.com/blog/adforpostgresql/azure-horizondb-enterprise-ready-postgres-engineered-for-the-ai-era/4524094), checked 2026-10-12). A press report of a second-half 2026 target is secondary and `not sourced`.

**Hard limits** ([Azure HorizonDB compute and replicas](https://learn.microsoft.com/en-us/azure/horizondb/configure-maintain/concepts-compute-replicas), checked 2026-10-12, [Azure HorizonDB overview](https://learn.microsoft.com/en-us/azure/horizondb/overview)):

- Storage scales automatically up to 128 TB.
- Up to 15 read replicas, and up to 192 vCores per replica.
- The extension table lists PostgreSQL 17 only. No page states the supported majors outright, so PostgreSQL 17 only is `unverified`.
- Regions (Microsoft Learn list): Canada Central, Central US, East US, West US 2, West US 3, Germany West Central, Sweden Central, Australia East, Korea Central. The Build announcement named a different set (conflict). The project follows the Learn list. Re-check before promising a region (`OP-HZ-REGION`).

**Not supported in the preview** (`OP-HZ-GATE`): customer-managed keys, cross-region read replicas, long-term retention, VNet injection (Private Link only), built-in PgBouncer and a configurable maintenance window. Backup retention is fixed at 7 days.

**Extensions** ([Azure HorizonDB extensions](https://learn.microsoft.com/en-us/azure/horizondb/extensions/concepts-extensions-versions), checked 2026-10-12): `orafce` is present at a lower version than flexible server (4.9 against 4.16, from the research reading of the extension page). `pg_cron`, `pg_partman`, `pgaudit`, `dblink`, `postgres_fdw` and `azure_storage` are present. **`oracle_fdw`, `pg_hint_plan` and `plpgsql_check` are absent.** Each of those three makes a HorizonDB target worse for an Oracle estate: no foreign data wrapper to Oracle, no plan hints, no static analysis of converted code.

**The conversion constraint.** Microsoft's schema converter does not accept HorizonDB as its scratch database ([Schema conversion tutorial and prerequisites](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-tutorial), checked 2026-10-12). A HorizonDB target therefore still needs a flexible server for the conversion step. The one HorizonDB migration page the research found documents `pg_dump` and `pg_restore`. That page is not in `sources.json`, so it is `not sourced`.

**HA, DR and SLA.** Replicas can sit in different zones. No SLA percentage is published on any page the project holds ([Azure HorizonDB overview](https://learn.microsoft.com/en-us/azure/horizondb/overview), checked 2026-10-12), so `OP-AVAILABILITY` rules it out for a 99.95% or 99.99% target. No cross-region replicas exist in the preview, so `OP-DR` rules it out for any cross-region requirement.

**What would change this.** A general-availability date with an SLA. Customer-managed keys. `oracle_fdw`, `plpgsql_check` and `pg_hint_plan` joining the list. Cross-region replicas. A scratch-database role in the converter.

### 2.4 pg_vm: PostgreSQL on Azure virtual machines

**What it is.** Community PostgreSQL installed and run by the customer on Azure VMs.

**Status.** Customer operated. The customer owns high availability, patching, backup and monitoring. There is no managed-service SLA (inference; no Microsoft page for PostgreSQL on plain VMs is in `sources.json`, so this is `unverified`).

**When it is justified.** When a hard limit of the managed services applies: an extension outside the allow-list, superuser or untrusted languages, tablespaces, server file access, more than 64 TiB, more than 80,000 IOPS or 1,200 MiB/s from one disk, more than 192 vCores, or a PostgreSQL major not yet offered. Premium SSD v2 disk limits apply to VM disks too ([Premium SSD v2](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage-premium-ssd-v2), checked 2026-10-12). Striping several disks may go further. Microsoft publishes nothing to confirm it, so `OP-IO` marks `pg_vm` `unknown_requires_assessment` above 80,000 IOPS.

**HA, DR and SLA.** The customer builds and tests them. Synchronous cross-region replication is possible, and the customer owns the latency cost (`OP-DR`). There is no managed-service SLA (`OP-AVAILABILITY`).

**Extensions.** The operator can install any extension and any procedural language, and owns the risk. The matrix cells for `pg_vm` record that, not that a given extension works.

**What it cannot carry.** The matrix marks nine features `redesign`: advanced spatial, schema-based XML, Multimedia, Label Security and Vault, Flashback, edition-based redefinition, the web toolkit, object type inheritance and Exadata offload.

**Conversion still needs a flexible server.** The Microsoft converter's scratch database must be a flexible server on PostgreSQL 15 or later, whatever the final target is.

**What would change this.** A Microsoft reference page for PostgreSQL on VMs, so that the support boundary stops being an inference.

### 2.5 pg_aks: PostgreSQL on AKS with CloudNativePG

**What it is.** CloudNativePG running on AKS. Microsoft publishes a how-to for a multi-zone cluster with one primary and two replicas, backups to Azure Blob Storage and Premium SSD, Premium SSD v2 or local NVMe storage ([PostgreSQL HA on AKS (CloudNativePG)](https://learn.microsoft.com/en-us/azure/aks/postgresql-ha-overview), checked 2026-10-12).

**Status.** Customer operated. Open-source software deployed on AKS, including CloudNativePG and PostgreSQL, is excluded from the AKS SLA, the limited warranty and Azure support. Never promise a Microsoft SLA on this target (`OP-AVAILABILITY`). The page was last updated 2025-11-09, so it may be stale.

**Limits.** CloudNativePG cannot declaratively add extra databases. `postInitSQL` is the workaround. Local NVMe storage loses data if the cluster is stopped or deallocated, so Blob backups are required.

**HA, DR and extensions.** CloudNativePG gives one primary and two replicas across zones. Cross-region synchronous replication is possible and the customer owns the latency cost (`OP-DR`). Extensions are installed in a custom image, and the operator owns the risk. The matrix marks nine features `redesign`, the same nine as `pg_vm`.

**When it is justified.** `OP-MANAGEMENT` selects it when the customer requires Kubernetes. Otherwise it carries the highest maturity penalty (5).

**What would change this.** Not stated by Microsoft. A refreshed how-to would settle whether the 2025 page is stale.

### 2.6 cosmos_pg: Azure Cosmos DB for PostgreSQL

**Retired for new work.** New deployments are blocked. The service retires on 2029-03-31 ([Azure Cosmos DB for PostgreSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/introduction), checked 2026-10-12, [Azure service retirement calendar (Advisor)](https://learn.microsoft.com/en-us/azure/advisor/advisor-how-to-use-service-upgrade-retirement-recommendations), checked 2026-10-12). Existing customers move to `pg_elastic`. `OP-COSMOS` makes the family `unsupported` for every Oracle migration, and it never appears as a primary or an alternative. It is described here only so that a customer who already runs it is not surprised.

**Limits, HA, extensions, what it cannot carry.** Not assessed. A family that cannot be a target needs no comparison of its limits.

**What would change this.** Nothing. The retirement is announced. The only question is the customer's own move to an elastic cluster.

### 2.7 oracle_dbaz: Oracle AI Database@Azure

**What it is.** Oracle Cloud Infrastructure database services running in Azure datacentres, managed by Oracle's operations team. It was called Oracle Database@Azure. It is provisioned through the Azure portal, API and Terraform, and **needs an OCI tenancy** ([Oracle AI Database@Azure overview](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/database-overview), checked 2026-10-12).

**Offerings per region** include Exadata Database Service on dedicated and Exascale infrastructure, Autonomous AI Database in dedicated and serverless forms, Autonomous Recovery Service, Oracle Base Database Service and further Oracle database services ([Oracle AI Database@Azure regions](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/oracle-database-regions), checked 2026-10-12).

**Regions.** Thirty-three Azure regions: Australia East, Australia Southeast, Central India, Japan East, Japan West, South India, Southeast Asia, Brazil South, Brazil Southeast, France Central, France South, Germany North, Germany West Central, Italy North, North Europe, Spain Central, Sweden Central, Switzerland North, UAE Central, UAE North, UK South, UK West, West Europe, Canada Central, Canada East, Central US, East US, East US 2, North Central US, South Central US, West US, West US 2 and West US 3. The OCI tenancy must also be subscribed to the region. A region outside the list makes the target `unsupported` (`OP-STAY-REGION`).

**HA and DR.** The region list marks each region as having two or more availability zones, or a single zone with a paired disaster-recovery region. The single-zone regions are Japan West, South India, Brazil Southeast, France South, Germany North, UAE Central, UK West, Canada East, North Central US and West US ([Oracle AI Database@Azure regions](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/oracle-database-regions), checked 2026-10-12). Oracle's own SLA for the services is not in `sources.json`: `not sourced`.

**Commercial.** Sold by Oracle as an Azure Marketplace private offer, billed through Azure, and counted toward the Microsoft Azure Consumption Commitment. Bring-your-own-licence is supported ([Oracle AI Database@Azure overview](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/database-overview), checked 2026-10-12).

**Caveat.** Microsoft's Exadata page says it supports only the X9M shape and that other shapes are unsupported. The page's own date is 2024 even though it was updated in 2026, so it may be stale. Confirm the shape with Oracle before ruling a shape in or out ([Exadata on Oracle Database@Azure](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/exadata-manage-services), checked 2026-10-12).

**What it cannot do.** It is not PostgreSQL, so it does not retire the Oracle licence or the Oracle skill set. It fits when the workload depends on RAC, Exadata or an Oracle-certified application, or when there is no room for a code change.

### 2.8 oracle_vm: Oracle Database on Azure virtual machines

**What it is.** Oracle Database 12.1 or later, Standard or Enterprise Edition, on Azure VMs. Oracle Linux images are the supported base. The customer brings the licence (BYOL) ([Oracle on Azure virtual machines](https://learn.microsoft.com/en-us/azure/virtual-machines/workloads/oracle/oracle-overview), checked 2026-10-12).

**Licensing.** Azure is an authorised cloud environment. Two Azure vCPUs count as one Oracle Processor licence when multithreading is on, and one vCPU counts as one licence when it is off. The Core Factor Table does not apply ([Oracle licensing for authorized cloud environments](https://www.oracle.com/us/corporate/pricing/cloud-licensing-070579.pdf), checked 2026-10-12). Standard Edition 2 has a vCPU cap on Azure VMs. The entitlement is a contract question, so the card tells the customer to confirm it with Oracle (`OP-LICENSE-NOTE`).

**HA and DR.** The customer owns them, using Data Guard, Active Data Guard or storage-level replication.

**RAC.** Microsoft's page says RAC and RAC One Node are not supported on Azure Bare Metal. It says nothing about RAC on standard VMs, and the advisor does not infer an answer. `OP-STAY-ORACLE` marks `oracle_vm` with RAC `unknown_requires_assessment`.

**What would change this.** A Microsoft statement on RAC on standard VMs. Oracle's own certification for the shape in question.

---

## 3. Oracle source versions and lifecycle

Oracle's support dates set the **urgency** of a move. They never choose the target (`OP-LIFECYCLE`). The source version also gates which tools can read the source (`OP-SOURCE-VERSION`).

### 3.1 Support dates

Dates are from Oracle's Lifetime Support chart ([Oracle Lifetime Support: Oracle Database technology chart](https://www.oracle.com/us/support/library/lsp-tech-chart-069290.pdf), checked 2026-10-12) and the statement of support policy changes ([Oracle software technical support policies: statement of changes](https://www.oracle.com/contracts/docs/software_technical_support_policies_soc.pdf), checked 2026-10-12).

| Release | Premier Support ends | Extended Support ends | State on 2026-10-12 | Migration driver |
|---|---|---|---|---|
| 11g (11.2) | January 2015 | December 2020 | Sustaining only | Yes |
| 12c (12.1, 12.2) | 12.1: July 2018. 12.2.0.1: 2020-11-30 | 12.1: July 2022 | Sustaining only | Yes |
| 18c | June 2021 | none | Sustaining only | Yes |
| 19c (long-term release) | 2029-12 | 2032-12 | Supported | No, on lifecycle alone |
| 21c (innovation release) | 2027-07 | none listed | Supported | Yes, about nine months of Premier Support remain |
| 23ai, renamed 26ai | not in the 2026-10-02 chart as 23ai. 26ai: December 2031 | 26ai: not yet set | Supported | No |

What this means:

- **Sustaining Support** carries no new fixes, security updates or certifications (the definition comes from Oracle's policy document, which is not in `sources.json`: `not sourced`). For 11g, 12c and 18c this is a real driver. `OP-LIFECYCLE` raises the urgency on the card when `driver = SUPPORT_LIFECYCLE` and the source is one of these.
- **19c** is in Premier Support until December 2029. Lifecycle alone is a weaker driver for 19c than it is often presented. Older 19c dates are still in circulation, including Premier in April 2024 and an interim Extended date of December 2028, so quote the current chart only ([Oracle software technical support policies: statement of changes](https://www.oracle.com/contracts/docs/software_technical_support_policies_soc.pdf), checked 2026-10-12).
- **23ai was renamed 26ai.** A statement of changes dated 2025-11-07 replaced "Oracle 23AI Database" with "Oracle AI Database 26ai" ([Oracle software technical support policies: statement of changes](https://www.oracle.com/contracts/docs/software_technical_support_policies_soc.pdf), checked 2026-10-12). Whether 23ai moves to 26ai by release update is `unverified`. Confirm in My Oracle Support. The project treats the two names as one option, `ORA_23AI_26AI`.
- Extended Support is a separate fee per support period. An earlier fee waiver covered May 2024 to April 2026 ([Oracle software technical support policies: statement of changes](https://www.oracle.com/contracts/docs/software_technical_support_policies_soc.pdf), checked 2026-10-12). Entitlement questions go to Oracle contract and licence management.

### 3.2 Which tool reads which source version

"Not listed" is not "not supported". It means the vendor documentation does not say, so a pilot settles it. Only Microsoft's routes are listed (`OP-SCOPE`).

| Tool or route | Oracle releases the documentation lists | Not listed or unknown | Source |
|---|---|---|---|
| Microsoft converter (VS Code extension) | 12.1, 12.2, 18c, 19c, 21c | 11g is not supported. 23ai and 26ai are not listed: run a pilot (`OP-CONVERTER-GATE`). Microsoft publishes no other schema converter (section 4.6) | [Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), checked 2026-10-12 |
| Azure Data Factory Oracle connector 2.0 | 11g and later (research reading) | Release-level detail | [Azure Data Factory Oracle connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-oracle), checked 2026-10-12 |

An estate on 23ai or 26ai is the awkward case. Microsoft's converter does not list it. The advisor selects the converter anyway, as the only schema route Microsoft publishes, with status `unknown_requires_assessment`, and names a pilot: convert 10 to 15 objects of the 23ai schema and read the result. If the pilot fails, Microsoft has no other schema converter and schema conversion is a gap (section 4.6).

---

## 4. Converting schema and code

### 4.1 The role taxonomy

Every tool in the advisor has exactly one role. A tool that moves rows is not a converter, and a converter is not an assessor. The most common mistake in a plan is to give one tool two jobs. Only Microsoft services, Microsoft-published tools and components that Azure ships appear here (`OP-SCOPE`).

| Role | Meaning | Examples |
|---|---|---|
| migration | Converts schema or code. | The Microsoft VS Code converter (schema and code, no rows) |
| assessment | Inventories and estimates. Converts nothing. | `SCHEMA_SCAN`, the converter's discovery step, `AWR_SIZING` |
| transport | Moves rows. Converts no schema or code. | The Data Factory connector, `oracle_fdw` |
| overlay | A compatibility layer or federation that reduces conversion instead of doing it. | `orafce`, `oracle_fdw`, the preview application-code conversion |
| out-of-scope | Looks relevant and does not apply. | SSMA for Oracle, Azure Migrate, the Azure Copilot migration agent, Azure DMS (section 4.8) |

### 4.2 The route-selection rule

`MS_VSCODE_AI` is the only schema route Microsoft publishes. It is selected when it is `available`, and also when it is `unknown_requires_assessment`, because Microsoft does not list the source release and a pilot settles it. The card names the pilot. `APP_CONVERSION_PREVIEW` is never selected as the schema route. When the converter is `unavailable` there is no selected route, and the card carries the gap `SCHEMA_CONVERSION` (`OP-SCOPE`, section 4.6).

| Route | Kind | Gate |
|---|---|---|
| `MS_VSCODE_AI` | migration, GA | Oracle 12.1 to 21c. `ORA_11G_OR_OLDER` is `unavailable`. `ORA_23AI_26AI` is `unknown_requires_assessment`. Needs `FOUNDRY_AND_COPILOT_READY` (`OP-CONVERTER-GATE`, `OP-SOURCE-VERSION`) |
| `APP_CONVERSION_PREVIEW` | overlay, preview | `refused` when a preview is refused (`OP-PREVIEW`). Never replaces schema conversion |

### 4.3 Microsoft's AI-assisted converter

**Status.** Schema conversion in the PostgreSQL extension for Visual Studio Code (`ms-ossdata.vscode-pgsql`) is **generally available** since version 1.23.0 on 2026-05-26 ([vscode-pgsql changelog](https://github.com/microsoft/vscode-pgsql/blob/main/CHANGELOG.md), checked 2026-10-12). Application-code conversion is a **preview**. The changelog says odd minor versions are pre-releases and even minors are stable, and the GA note first shipped in 1.23.x. The research read 1.32.0 (2026-10-05) as the stable release that matches the Learn pages dated the same day. That reading is an inference and is `unverified`.

**What it does.** It extracts schema objects from Oracle, converts them with a Microsoft Foundry model, compiles the result in a scratch database and runs `plpgsql_check` there. It converts tables, constraints, B-tree indexes, sequences, triggers, views, materialized views, synonyms (with limits), packages, functions, procedures, object types, VARRAYs, nested tables and subtypes. In code it handles package state and cursors, hierarchical queries (to `WITH RECURSIVE`) and autonomous transactions (through `dblink`) ([Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), checked 2026-10-12). Its discovery step inventories the selected schemas, checks Oracle permissions and lists invalid objects and dependent schemas. It gives no effort estimate.

**Flow.** Discovery lists the selected schemas, dependent schemas and invalid objects. Extraction reads the dictionary. Conversion runs in a scratch database. The report lists what converted and what needs review. A setup step then writes the scripts that create the target objects and extensions. The scripts are a separate, manual deployment step ([Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), checked 2026-10-12). The extension changelog describes a discovery step, a post-conversion setup package and conversion directly into target schemas as the 1.31 line of features ([vscode-pgsql changelog](https://github.com/microsoft/vscode-pgsql/blob/main/CHANGELOG.md)).

**What it does not do.** It **does not move rows**. Microsoft's pages say to plan row-data migration separately ([Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12). The Oracle account needs dictionary access only, not table data. Generated scripts are not deployed by generating them.

**Prerequisites** ([Schema conversion tutorial and prerequisites](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-tutorial), checked 2026-10-12, [Schema conversion best practices](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-best-practices), checked 2026-10-12):

| Need | Detail |
|---|---|
| Microsoft Foundry | A deployment of `gpt-5.2` with quota above 1,000,000 tokens per minute. Authentication by API key or Microsoft Entra ID. |
| GitHub Copilot | A Pro+, Business or Enterprise seat. The tutorial lists it. The oracle-migration page's prerequisite list does not (conflict). The advisor treats it as required (`converter_prereqs`). |
| Scratch database | An Azure Database for PostgreSQL **flexible server** on PostgreSQL 15 or later. **HorizonDB is not accepted.** Match its major version to the production target. |
| `plpgsql_check` | Allow-listed **and** preloaded, then the server restarted. If it is missing, the static check silently does not run and the report does not say so. |
| Oracle account | `CONNECT`, `SELECT_CATALOG_ROLE`, `SELECT ANY DICTIONARY`, `SELECT` on `SYS.ARGUMENT$` and `SYS.V_$RESOURCE_LIMIT`. The `sessions` parameter must be above 10. System schemas are never converted. |
| Workstation | VS Code 1.95.2 or later. Windows x64, Linux x64 or macOS 13 or later. No ARM64 on Windows or Linux. Outbound access to the Microsoft `pgsql-tools` repository. One project at a time. |

**Limits stated by Microsoft** ([Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12). A status of "Converted" does not guarantee compilation, completeness or equivalent behaviour at run time. Placeholder routines that raise errors can show as Converted. A completed conversion cannot be rerun. The tool runs `DROP SCHEMA ... CASCADE` on matching scratch schemas, so the scratch database must be disposable. These are not converted: Java in the database, external C libraries, wrapped PL/SQL, bitmap, global-partitioned and domain indexes, materialized view logs, external tables, Advanced Queuing, clusters, `DIRECTORY` objects, database links, application contexts, VPD and `DBMS_RLS`, `DBMS_SCHEDULER` and `DBMS_JOB` objects, users, roles and privileges, and system-event triggers. The card lists them as manual workstreams whenever the interview or a scan says the estate uses them.

**Quality evidence.** Microsoft's blog reports about 98% overall conversion across more than 60,000 objects in representative runs ([AI-assisted Oracle to PostgreSQL schema conversion in VS Code](https://techcommunity.microsoft.com/blog/adforpostgresql/ai-assisted-oracle-to-postgresql-schema-conversion-in-visual-studio-code/4542203), checked 2026-10-12). That figure is vendor-reported and `unverified`. The community Contoso Store lab ([Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab), checked 2026-10-12) measured less on a deliberately hostile schema. In its first run, 947 of 1,185 objects converted (79.92%), and about 95% of the stated failure reasons were scratch-database timeouts and lock contention, not bad translations. A later run reached 93.02% of standalone objects. Neither run deployed the result to a loaded database to compare behaviour. The lab itself says "converted" is not evidence of equivalence.

**Converted is not equivalent.** Microsoft says so on its own limitations page, and the same model that wrote the conversion can review it, so review is not independent. Section 8 covers what independent checking looks like.

### 4.4 The preview application-conversion tool

The same extension converts application code: SQL scripts, stored-procedure calls, loader control files, shell scripts, Java, Python, .NET, Node.js, C++ and Ruby. The target is a flexible server on 15 or later, or HorizonDB 17 or later. It works best with Copilot on a Claude Sonnet 4.6 or Opus 4.6 class model ([Application conversion overview (preview)](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-application/app-conversions-overview), checked 2026-10-12). It is a preview, so it is `refused` when the customer refuses previews (`OP-PREVIEW`). Refusing it never removes a generally available target. It never replaces schema conversion. Oracle components around the database (Forms, Reports, APEX, OBIEE, ODI, WebLogic, `mod_plsql`) are application work, not database work (`OP-APP-TIER`).

### 4.5 The effort estimate and its unit convention

The schema scan (section 4.7) prices every construct it finds in **cost units** and adds the units up. The unit convention is the one that Ora2Pg, an open-source Oracle to PostgreSQL tool, publishes in its manual and its cost tables ([Ora2Pg manual](https://raw.githubusercontent.com/darold/ora2pg/master/doc/Ora2Pg.pod), checked 2026-10-12, [Ora2Pg cost tables (lib/Ora2Pg/PLSQL.pm)](https://raw.githubusercontent.com/darold/ora2pg/master/lib/Ora2Pg/PLSQL.pm), checked 2026-10-12). This repository borrows the convention as a yardstick. It does not assess that tool and does not recommend running it.

- **Unit.** One unit is five minutes by default, an expert's pace. The manual suggests ten minutes for a first migration.
- **Day.** The advisor's catalogue converts units to person-days at 84 units per day, which is a seven-hour day of 420 minutes at five minutes a unit. That is a convention for comparison, not a quote. The manual states its own day limit as both 5 and 10 person-days (conflict), so the advisor quotes no default day limit.
- **Weights.** Where the published tables score a construct, the catalogue copies the score (origin `ora2pg-25.0`). Elsewhere the weight is this project's estimate (origin `advisor`). Section 6.1 gives the counts.
- **Level.** The convention also grades a database with a level such as `B-5`: `A` can be converted mostly automatically, `B` needs a rewrite below the day limit, `C` needs a rewrite above it, and the digit from 1 to 5 is the technical difficulty. The advisor classes objects as `CLEAN`, `PARTIAL`, `REVIEW` or `BLOCKER` and decides nothing from the level.

**An AI-assisted figure.** When the Microsoft converter drafts the code and people review it, the same units shrink, but not by a fixed share. The schema scan splits each object's units into what a converter can draft (reading and rewriting, and CLEAN and PARTIAL constructs), what needs a person's decision (REVIEW constructs), and what stays (the per-routine test allowance, BLOCKER constructs, and objects the converter does not read, such as jobs, VPD policies and users). The model assumes a review costs a quarter to a half of the manual cost, a design decision twice that, an unconverted object the full cost, and 3 to 5 person-days of setup. These are this project's assumptions: no vendor publishes a productivity figure, and Microsoft's own page says only that the tool reduces manual effort and that converted objects must be validated independently. The pilot of 10 to 15 objects replaces the assumptions with measurements. The model is in `tools/assess/lib/ai-effort.mjs`.

### 4.6 When the Microsoft converter cannot be used

The converter is `unavailable` for Oracle 11g and older, which Microsoft does not list, and until its prerequisites exist: a Foundry deployment with enough quota and a GitHub Copilot seat. Microsoft publishes no other schema converter for Oracle to PostgreSQL. The card then shows a **gap**, `SCHEMA_CONVERSION` (`OP-SCOPE`), and names no substitute. It says: convert by hand to Microsoft's guidance, or with a partner chosen with the Microsoft account team, or upgrade the source to a release the converter lists. When the cause is a missing prerequisite only, the gap closes once the quota and the seat exist, and the prerequisite plan lists the lead times. This knowledge base does not recommend a converter from another vendor.

### 4.7 Assessment routes

| Route | What it gives | What it does not |
|---|---|---|
| `SCHEMA_SCAN` | This repository's static scan of Oracle source text. Needs no database connection. Effort in the cost units of section 4.5. | It reads text only and has the limits of a pattern scan. The effort is a heuristic, not a quote. |
| `VSCODE_DISCOVERY` | Object inventory, dependent schemas, invalid objects, permission check. | No effort estimate. |
| `AWR_SIZING` | IOPS, throughput, CPU and memory from Oracle AWR and ASH reports. | The advisor does not read it. It is the only honest source for sizing a target. |

Azure Migrate does not discover Oracle databases as a workload. Its discovery covers SQL Server, ASP.NET web apps, MySQL, MongoDB and PostgreSQL ([Azure Migrate discovery methods](https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate), checked 2026-10-12). The DMS tools matrix lists it under discovery for Oracle to Azure Database for PostgreSQL, which contradicts that page (conflict). The advisor follows the Azure Migrate page. The Azure Copilot migration agent does not cover Oracle databases either ([Azure Copilot migration agent](https://learn.microsoft.com/en-us/azure/copilot/migration-agent), checked 2026-10-12).

### 4.8 Tools that look relevant and do not apply

| Tool | Why not | Source |
|---|---|---|
| SSMA for Oracle | It targets SQL Server and Azure SQL only. | [SSMA for Oracle](https://learn.microsoft.com/en-us/sql/ssma/oracle/sql-server-migration-assistant-for-oracle-oracletosql), checked 2026-10-12 |
| Azure Database Migration Service | It has no Oracle to PostgreSQL scenario. | [DMS scenario status](https://learn.microsoft.com/en-us/azure/dms/resource-scenario-status), checked 2026-10-12 |
| Azure Data Studio and its migration extensions | Retired. | [What's happening to Azure Data Studio](https://learn.microsoft.com/en-us/azure-data-studio/whats-happening-azure-data-studio), checked 2026-10-12 |
| Azure Migrate, Azure Copilot migration agent | Not Oracle database assessors. | section 4.7 |

Products from other vendors are not assessed here (section 7). The complete retired list is in section 11.

---

## 5. Moving the data

**No Microsoft migration service moves Oracle rows to PostgreSQL, and Microsoft publishes no change-capture service for it.** Azure Database Migration Service has no Oracle to PostgreSQL scenario. Its Oracle rows lead to Azure SQL targets only ([DMS scenario status](https://learn.microsoft.com/en-us/azure/dms/resource-scenario-status), checked 2026-10-12). The migration service built into Azure Database for PostgreSQL takes PostgreSQL sources only ([Migration service in Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/migrate/migration-service/overview-migration-service-postgresql), checked 2026-10-12). The Microsoft converter converts schema and code and moves no rows (section 4.3).

Microsoft's own routes copy rows **offline**: Azure Data Factory with the Oracle connector, and `oracle_fdw`, a PostgreSQL extension that Azure ships. Azure Data Factory is a general-purpose pipeline service, not a migration service. The pipeline is built and owned by the customer or partner, it creates no DDL, and it has no change capture. A downtime of minutes needs change capture, and Microsoft has no product for it (section 5.2).

### 5.1 Offline routes

Offline routes copy a snapshot. They have no change capture, so the source must stop changing for the final copy. A copy taken earlier cannot be brought up to date without change capture, which Microsoft does not offer (section 5.2).

| Route | Role | How it works | Notes and limits |
|---|---|---|---|
| `ADF_COPY` | transport | The Data Factory Oracle connector 2.0 as the source of a copy pipeline. | Generally available. Supports parallel copy by physical partition or dynamic range. Needs a self-hosted integration runtime for on-premises or VNet sources. `NUMBER` without precision maps to `Decimal(256,130)`, so type mapping is the pipeline author's job. Connector 1.0 was removed on 2026-03-31, so never build on it ([Azure Data Factory Oracle connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-oracle), checked 2026-10-12, [ADF connector release stages](https://learn.microsoft.com/en-us/azure/data-factory/connector-release-stages-and-timelines), checked 2026-10-12). |
| `ORACLE_FDW_COPY` | transport, overlay | `INSERT ... SELECT` over `oracle_fdw` foreign tables. On flexible server, `pg_vm` and `pg_aks`. HorizonDB lacks the extension. | Needs a network path from the server to the Oracle listener (`OP-ORACLE-FDW-PATH`). Outbound access from a VNet-integrated server is governed by its network security groups. What it needs on flexible server is not fully documented: client-library prerequisites are `unverified` (section 12). Also the basis for in-database comparison (section 8). |

The selected data route is the first `available` route in the order `ADF_COPY`, `ORACLE_FDW_COPY`. When none is `available` it is the first `unknown_requires_assessment` one, and when neither exists it is none, with a gap (section 5.2). For `oracle_dbaz` and `oracle_vm` there is no route: the move is a rehost done with Oracle's own tooling, which this advisor does not cover.

One load detail decides whether a document store loads: PostgreSQL `bytea` has a 1 GB limit, against a far larger BLOB limit in Oracle. That is irrelevant for product images ([Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab), checked 2026-10-12).

### 5.2 Online routes: a gap

Microsoft offers no change-capture service from Oracle to PostgreSQL. A downtime of minutes needs a capture product from outside Microsoft. This knowledge base does not recommend, compare or rank one, and no answer of the interview selects one. The Microsoft account team can say what options exist.

The card carries the gap `ONLINE_CAPTURE` (`OP-SCOPE`) instead of a route when `downtime` is `NEAR_ZERO`, or `MINIMAL` unless the largest database is under 1 TB and the bandwidth is good. When `downtime` is `NOT_SURE` it carries the gap as a possibility. There is then no selected data route. The offline routes in section 5.1 are `unavailable` for a downtime that needs capture, because their downtime is the full load time plus validation, which the rehearsal measures.

### 5.3 What any change-capture product needs from the source

Whichever product the customer chooses, the prerequisite plan lists these as preparation. They are properties of log-based capture in general, not of one product.

| Prerequisite | Why |
|---|---|
| `ARCHIVELOG` mode and supplemental logging | A capture tool reads the redo log. The log only exists in `ARCHIVELOG` mode, and supplemental logging lets the tool see whole rows. Enabling them needs a restart, which is itself downtime. |
| A private network path from Oracle to Azure | Change capture over the public internet is not acceptable. |
| A primary key or unique key on every captured table | The apply side needs a key. |

A cutover that needs a restart to enable `ARCHIVELOG` is not near zero.

### 5.4 Downtime classes

`OP-DOWNTIME` fixes what each class means. `OP-METHOD-DATA` picks the family.

| `downtime` | Family | Cutover downtime in minutes |
|---|---|---|
| `NEAR_ZERO` | Online only: a gap, because Microsoft has no route | Minutes, with a product from outside Microsoft |
| `MINIMAL` | Online, a gap. An offline load may also meet it only when the largest database is under 1 TB and bandwidth is good | Minutes to a couple of hours |
| `OFFLINE` | Offline bulk copy | The full load time plus validation |
| `NOT_SURE` | Both families listed, the offline routes `unknown_requires_assessment` | Not stated |

Only the offline family has Microsoft routes (section 5.1).

### 5.5 When the wire is the limit

`OP-SEED` applies when bandwidth is limited or the data is very large. The card recommends exporting to files and shipping them, then loading by `COPY`. The shipped copy is a transport. It is not a method, because it has no cutover of its own, and closing the gap after it needs change capture, which is the `ONLINE_CAPTURE` gap again. Which Azure shipping service to use is `not sourced`: neither Azure Data Box nor Storage Mover has a page in `sources.json`.

### 5.6 Character set and data quality

A source character set other than `AL32UTF8` needs conversion to UTF-8 during the load (`OP-CHARSET`). Characters that do not map are a data-quality finding, not a tool error. PostgreSQL rejects NUL characters in text (`not sourced`). A `NOT_SURE` answer is an unknown. Single-byte legacy sources such as US7ASCII often hide Latin-1 bytes (not sourced).

### 5.7 What this section does not know

- Which products outside Microsoft offer change capture. This knowledge base does not cover them (section 7).
- Throughput. Published load rates are vendor claims and are not repeated here.

---

## 6. Compatibility: what does not convert mechanically

### 6.1 Catalogue classes and weights

The advisor's catalogue lists the Oracle constructs a schema scan looks for. Each entry has a class and a weight. The class says how much human judgement the construct needs on a PostgreSQL target.

| Class | Meaning |
|---|---|
| `CLEAN` | Mechanical. A converter handles it and a reviewer skims it. |
| `PARTIAL` | Converts, but behaviour or performance can drift in an edge case. A human checks each use. |
| `REVIEW` | A design decision or a hand rewrite on any PostgreSQL target. |
| `BLOCKER` | No supported equivalent on Azure Database for PostgreSQL flexible server. Needs a redesign, an external service or a different target. |

The community lab scales its own hard cases as clean, partial and review. Its "review" maps to `REVIEW` and `BLOCKER` here, because the catalogue splits out the constructs that have no in-database answer at all.

**Weights** are effort in cost units (section 4.5). One unit is five minutes, and 84 units make one person-day. Where the published convention scores a construct the weight copies it (origin `ora2pg-25.0`). Elsewhere the weight is the project's estimate (origin `advisor`), and the `BLOCKER` weights are redesign estimates. The published units are far smaller than the cost of a redesign and ignore business-rule risk. Treat every weight as a planning unit, not a quote.

**Limits of the scan.** The scan is a set of text patterns over source with comments removed and string literals masked. It cannot see types (implicit conversion, integer division), overload sets, package-level state or semantic dependencies. It reads the contents of dynamic SQL strings for constructs such as DDL. A count of matches is evidence of presence. A count of zero is not evidence of absence, and a silent trap can sit behind a clean scan.

The two blocks below are generated from `reference/compat-catalog.json`. The first gives counts by category and class. The second lists the `BLOCKER` constructs. The counts in the generated blocks are authoritative. The research behind the catalogue held more entries than the advisor keeps.

<!-- GENERATED:catalog-summary -->
| Category | CLEAN | PARTIAL | REVIEW | BLOCKER | Total |
|---|---|---|---|---|---|
| sql-dialect | 10 | 12 | 13 | 1 | 36 |
| semantics | 1 | 6 | 1 | 0 | 8 |
| plsql | 6 | 28 | 20 | 1 | 55 |
| supplied-package | 4 | 6 | 11 | 11 | 32 |
| datatype | 10 | 22 | 10 | 1 | 43 |
| storage | 13 | 15 | 18 | 2 | 48 |
| integration | 1 | 1 | 7 | 1 | 10 |
| security | 0 | 6 | 6 | 1 | 13 |
| modern | 3 | 3 | 4 | 1 | 11 |
| **All** | **48** | **99** | **90** | **19** | **256** |

54 of 256 weights are Ora2Pg 25.0's own; the others are this project's, marked `advisor`. A weight is in cost units: one unit is five minutes and 84 units are a person-day.
<!-- /GENERATED -->

The `BLOCKER` list is where the answer is most often "a different target", "an Azure service outside the database" or "an application change". A `BLOCKER` on `pg_flex` can be a `workaround` on `pg_vm` or `pg_aks`, where the operator can install other software and owns the risk. The feature matrix in section 6.2 says which.

<!-- GENERATED:catalog-blockers -->
| ID | Construct | What to do instead |
|---|---|---|
| `SQL-MODEL-CLAUSE` | MODEL clause | None. Rewrite as recursive CTE, window functions or PL/pgSQL |
| `PKG-DBMS-AQ` | Advanced Queuing | None in the database. Azure Service Bus, or a queue table with SKIP LOCKED |
| `PKG-UTL-NETWORK` | UTL_HTTP / UTL_TCP / UTL_SMTP / UTL_MAIL | No outbound network from the database on flexible server. Azure Functions, Logic Apps or the application tier |
| `PKG-HTP-APEX` | PL/SQL web toolkit and APEX | None. These render pages from the database; the page tier has to be rebuilt |
| `PKG-SPATIAL-ADVANCED` | Oracle Spatial network / topology / georaster | pgRouting for networks. No topology/georaster equivalent on flexible server |
| `PKG-JAVA` | Java stored procedures | None on flexible server. Move the logic to the application tier |
| `PKG-EXTPROC` | External procedures (C libraries) | None. Untrusted C code is not allowed on a managed service |
| `PKG-EBR` | Edition-based redefinition | None. Use blue/green deployment and expand-contract migrations |
| `PKG-STREAMS-CDC` | Streams / Change Data Capture / Advanced Replication | Logical replication; capture from Oracle needs a product from outside Microsoft |
| `PKG-ORDSYS` | Oracle Multimedia | None. Store media in Blob Storage and metadata in tables |
| `PKG-EBS-SIGNAL` | Oracle E-Business Suite / Applications packages | None. A packaged application that requires Oracle Database cannot be moved by moving the database |
| `TYPE-XMLTYPE-SCHEMA` | Schema-based XML / XML DB repository | None. Validate XML in the application tier |
| `DDL-PARTITION-REFERENCE` | Reference / system / virtual-column partitioning | None. Redesign the partition key onto the table itself |
| `SEC-VAULT-OLS` | Database Vault / Label Security / Data Redaction | None. Redesign with row level security, views and roles |
| `PLSQL-WRAPPED-PL-SQL` | Wrapped PL/SQL (obfuscated source) | Cannot be converted: obtain the original unwrapped source first. Until then the unit is a blocker (converter emits a placeholder that raises an error). |
| `DDL-ORACLE-SHARDING` | Oracle Sharding | No single-database equivalent. Redesign the distribution strategy; Azure flexible server offers elastic clusters (GA per release notes, Nov 2025) as a horizontally distributed option - suitability must be assessed per workload. |
| `OPT-OLAP-OPTION-ANALYTIC-VIEWS` | OLAP option, analytic views, data mining | No PostgreSQL target: rebuild as views/materialised summary tables (OLAP) or move model scoring to Azure ML / the application (data mining). |
| `ORA23-JSON-RELATIONAL-DUALITY-VIEWS` | JSON Relational Duality Views | No equivalent (updatable JSON documents with ETag concurrency over normalised tables, REST/GraphQL). Rebuild as views + INSTEAD OF triggers + jsonb aggregation, or an API/ORM layer in the application. |
| `PKG-SCHEDULER-OS-EXECUTABLE` | DBMS_SCHEDULER jobs that run OS executables or scripts | There is no operating system to run a program on. Move the job to Azure Automation, Azure Functions, a container job or a VM, and call the database from there. |
<!-- /GENERATED -->

### 6.2 The feature matrix

The matrix says how each of the five PostgreSQL targets (flexible server, elastic cluster, HorizonDB, PostgreSQL on VMs and PostgreSQL on AKS) carries each of 27 Oracle features. `OP-FEATURE-MATRIX` reads it for every feature on the customer's list. The Oracle targets carry every feature and are not listed.

| State | Meaning | Effect on the target |
|---|---|---|
| `native` | The target carries it with the same behaviour. | None |
| `workaround` | An extension or a pattern carries it, with caveats a person checks. | `eligible_with_remediation` |
| `redesign` | No equivalent. The application or the data model changes. | `eligible_with_remediation`, or `unsupported` when the application is frozen (`OP-FROZEN-REDESIGN`) |
| `unsupported` | The target cannot carry it at all, even with a redesign. | `unsupported` |
| `unknown` | The vendor documentation does not say. Never read as native. | `eligible_with_remediation`, with the unknown recorded |

How to read it:

- **No cell is `unsupported` in the current data.** "No equivalent" is written `redesign`.
- Flexible server, elastic cluster and HorizonDB share most cells, because they share the managed-service limits: no superuser, no file system, no custom extensions. They differ where an extension differs. HorizonDB marks `DB_LINKS_TO_ORACLE` as `redesign` because `oracle_fdw` is absent. The elastic cluster marks it `unknown` and marks `HEAVY_PARTITIONING` as `redesign`.
- `pg_vm` and `pg_aks` cells are mostly `workaround`. The matrix records that the operator can install any extension and any procedural language, and also owns the risk. Those cells are not claims that a given extension exists or works.
- `RAC_HA_ONLY` is `native` on every target except `pg_vm`: the service's own HA covers the need on the managed targets, and CloudNativePG runs a primary and two replicas across zones. It is `workaround` on `pg_vm`, where the operator builds and tests HA.

<!-- GENERATED:feature-matrix -->
| Oracle feature | Flexible server | Elastic cluster | HorizonDB | PostgreSQL on VMs | PostgreSQL on AKS |
|---|---|---|---|---|---|
| RAC used to scale writes across nodes | workaround | redesign | workaround | workaround | workaround |
| RAC used only for availability | native | native | native | workaround | native |
| Advanced Queuing (DBMS_AQ) | redesign | redesign | redesign | workaround | workaround |
| Java stored procedures | redesign | redesign | redesign | workaround | workaround |
| External procedures (C libraries) | redesign | redesign | redesign | workaround | workaround |
| UTL_HTTP, UTL_SMTP, UTL_TCP, UTL_MAIL | redesign | redesign | redesign | workaround | workaround |
| UTL_FILE and DIRECTORY objects | workaround | workaround | workaround | native | workaround |
| Oracle Spatial: geometry types and operators | workaround | workaround | workaround | workaround | workaround |
| Oracle Spatial: network, topology, georaster | redesign | redesign | redesign | redesign | redesign |
| Oracle Text (CONTAINS, CTX_) | workaround | workaround | workaround | workaround | workaround |
| XML DB, registered schemas, XMLType repository | redesign | redesign | redesign | redesign | redesign |
| Oracle Multimedia (ORDSYS) | redesign | redesign | redesign | redesign | redesign |
| Virtual Private Database (DBMS_RLS) | workaround | workaround | workaround | workaround | workaround |
| Label Security, Database Vault, Data Redaction | redesign | redesign | redesign | redesign | redesign |
| Flashback query, versions, table | redesign | redesign | redesign | redesign | redesign |
| Edition-based redefinition | redesign | redesign | redesign | redesign | redesign |
| Database links whose far end stays on Oracle | workaround | unknown | redesign | workaround | workaround |
| External tables (ORGANIZATION EXTERNAL) | workaround | workaround | workaround | native | workaround |
| DBMS_SCHEDULER chains, windows, job classes, event-based jobs | redesign | redesign | redesign | workaround | workaround |
| PL/SQL web toolkit and APEX | redesign | redesign | redesign | redesign | redesign |
| PRAGMA AUTONOMOUS_TRANSACTION | workaround | workaround | workaround | workaround | workaround |
| Package-level variables that live for the session | workaround | workaround | workaround | workaround | workaround |
| Object types with UNDER and member methods | redesign | redesign | redesign | redesign | redesign |
| Fast-refresh or ON COMMIT materialized views | redesign | redesign | redesign | workaround | workaround |
| Interval, reference, composite or global-index partitioning | workaround | redesign | workaround | workaround | workaround |
| Oracle TDE column encryption | workaround | workaround | workaround | workaround | workaround |
| Workload relies on Smart Scan, storage indexes or Hybrid Columnar Compression | redesign | redesign | redesign | redesign | redesign |

*native* the target carries it with the same behaviour. *workaround* an extension or pattern carries it and a person checks the caveats. *redesign* no equivalent: the application or the data model changes. *unsupported* the target cannot carry it at all. *unknown* the vendor documentation does not say, and it is never read as native. 37 of 135 verdicts cite a source; the rest are the author's judgement and say so in `reference/feature-matrix.json`.
<!-- /GENERATED -->

### 6.3 Silent semantic traps

These are the constructs that compile, run and return a different answer. A converter that reports "Converted" has not seen them. The Oracle and PostgreSQL manual pages behind these behaviours are not in `sources.json`. The last column therefore lists only what `sources.json` can support, usually the workaround on the PostgreSQL side, and says `not sourced` where nothing supports the behaviour. Each behaviour is a well-known documented one, and a reviewer should check it against the Oracle SQL Language Reference and the PostgreSQL manual. The lab column gives the hard case (`H-`) or trap (`T-`) in the Contoso Store lab ([Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab), checked 2026-10-12) where one exists.

| Trap | Oracle against PostgreSQL | Catalogue ID and class | Lab | Support in `sources.json` |
|---|---|---|---|---|
| Empty string is NULL | Oracle stores `''` as NULL. PostgreSQL keeps it as a value. Nothing fails: rows move across `IS NULL` tests, `COUNT(col)`, unique keys and concatenation. No setting changes it. Normalise on load, use orafce's trigger helpers, or audit every predicate | `TYPE-EMPTY-STRING` REVIEW, `TYPE-STRING-NULL-TEST` PARTIAL, `TYPE-STRING-FUNC-IS-NULL` REVIEW | H-38 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12 |
| Concatenation with NULL | Oracle returns the other operand. PostgreSQL returns NULL. Use `concat()` or `COALESCE` per operand | `TYPE-CONCAT-NULL` PARTIAL | T-14 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12 for its null-safe option. Behaviour: `not sourced` |
| ROWNUM and ORDER BY | `ROWNUM` is assigned before `ORDER BY`. `WHERE ROWNUM <= n ... ORDER BY` returns arbitrary rows. With the sort in a subquery it is a top-N. Only the wrapped form converts to `ORDER BY ... LIMIT` | `SQL-ROWNUM` PARTIAL, `SEM-ORDER-BY-INSIDE-DERIVED` PARTIAL | H-30 | `not sourced` |
| DATE has a time part | Oracle `DATE` carries a time. PostgreSQL `date` does not. Map to `timestamp(0)` unless every value is midnight | `TYPE-DATE` PARTIAL | T-02 | `not sourced` |
| SYSDATE and now() | `SYSDATE` is statement time. `now()` is transaction start. orafce's `oracle.sysdate()` returns statement time in its own time zone. The lab's claim that `SYSDATE` does not advance within a statement is `unverified` | `TYPE-SYSDATE` CLEAN | T-09 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12 |
| DECODE with NULL | `DECODE` treats two NULLs as equal. `CASE x WHEN NULL` never matches. Use `IS NOT DISTINCT FROM`. orafce's `decode` must be schema-qualified | `SQL-DECODE-NULL-KEY` PARTIAL | H-31 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12. Oracle behaviour: `not sourced` |
| NUMBER without precision | Unbounded in Oracle. `numeric` is exact but slower. A sized integer is right only after profiling. A `NUMBER(19)` mapped to `bigint` can overflow | `TYPE-NUMBER-NOPREC` PARTIAL | T-01 | [Azure Data Factory Oracle connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-oracle), checked 2026-10-12 for its `Decimal(256,130)` mapping. The rest `not sourced` |
| CHAR blank padding | `char(n)` keeps padding, but comparison against `text` and `varchar` treats trailing blanks differently. Joins can stop matching | `TYPE-CHAR-NCHAR-BLANK-PADDED` PARTIAL | T-04 | `not sourced` |
| Mixed-case quoted identifiers | Oracle folds unquoted names to upper case. PostgreSQL folds to lower. A quoted `"Name"` survives conversion and every unquoted reference then fails. Quoted upper-case names should be lower-cased | `SEM-QUOTED-IDENTIFIERS-CONTAINING-LOWER` PARTIAL (12 units) | T-07 | [Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab), checked 2026-10-12 |
| 63-byte identifiers | Oracle allows 128 bytes from 12.2. PostgreSQL truncates at 63. Rename and watch for collisions | `TYPE-IDENTIFIER-LONGER-THAN-63` PARTIAL | none | `not sourced` |
| Package state | Variables, constants and cursors live for the session. PostgreSQL has no package state. Converters often declare the variable inside the function, which compiles and resets on every call. `session_variable` is allow-listed and blocks in-place major upgrade | `PLSQL-PACKAGE-STATE` REVIEW | H-43 | [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12, [Major version upgrade](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade) |
| Autonomous transactions | No native equivalent. The converter emits a `dblink` loopback, which needs `dblink` on the target and a connection per call. `pg_background` is not on the allow-list | `PLSQL-AUTONOMOUS-TXN` REVIEW | H-02 | [Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), checked 2026-10-12, [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions) |
| SELECT INTO without STRICT | Oracle raises `NO_DATA_FOUND` and `TOO_MANY_ROWS`. PL/pgSQL returns NULLs on no rows and the first row on many, unless `INTO STRICT`. Whether the converter adds `STRICT` consistently is `unverified` | `PLSQL-NO-DATA-FOUND` PARTIAL, `SEM-SELECT-INTO-DATA-FOUND` PARTIAL | none | `not sourced` |
| Exceptions are subtransactions | A block with an `EXCEPTION` clause opens a subtransaction, which costs time and forbids `COMMIT` inside. `COMMIT` is allowed only in procedures called from the top level. `SAVE EXCEPTIONS` has no equivalent: it becomes a per-row loop and a behaviour decision | `PLSQL-WHEN-OTHERS-THEN` PARTIAL, `PLSQL-TXN-CONTROL` PARTIAL, `PLSQL-SAVE-EXCEPTIONS` REVIEW | H-10, H-28, H-29 | `not sourced` |
| Hierarchical queries | `CONNECT BY` becomes `WITH RECURSIVE`. `LEVEL`, path, `NOCYCLE` and `ORDER SIBLINGS BY` are carried by hand | `SQL-CONNECT-BY` PARTIAL, `SQL-CONNECT-BY-PSEUDO` REVIEW | H-06 | [Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), checked 2026-10-12 |
| Outer joins with (+) | Convert to ANSI joins. Hard cases: `(+)` on only some predicates, filters mixed with join predicates, chains of three or more. Check by row counts | `SQL-OUTER-JOIN-PLUS` PARTIAL | H-32 | `not sourced` |
| MERGE | Basic `MERGE` is mechanical. `DELETE WHERE` inside the update branch is evaluated against the updated values in Oracle and against the pre-update row in PostgreSQL. A `MERGE` target may be an updatable view from PostgreSQL 17 | `SQL-MERGE` CLEAN, `SQL-MERGE-DELETE-CLAUSE` REVIEW | H-07 | `not sourced` |
| Sequences and identity | `NOCACHE` becomes `CACHE 1`. `ORDER` is ignored. The sequence cache is per session, so values interleave and leave gaps. Bounds above bigint must be capped. `SCALE`, `EXTEND`, session sequences and `KEEP` have no equivalent | `DDL-SEQUENCE-OPTIONS` PARTIAL, `DDL-SEQUENCE-BOUNDS-BEYOND-BIGINT` PARTIAL, `DDL-IDENTITY` CLEAN | H-22 | `not sourced` |
| Empty LOB and XMLType | `XMLTYPE` becomes `xml` or `jsonb`. Methods and `XMLQUERY` need a rewrite. Registered XML schemas are not extracted, and schema-based XML is a `BLOCKER`. The empty-LOB case (`EMPTY_CLOB()` against NULL) is not catalogued | `TYPE-XMLTYPE` REVIEW, `TYPE-XMLTYPE-SCHEMA` BLOCKER | H-35 | [Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12. Empty LOB: `not sourced` |
| TIMESTAMP WITH LOCAL TIME ZONE | Oracle normalises to the database time zone and renders in the session zone. `timestamptz` stores the instant only and drops the original offset. orafce offers `dbtimezone` and `sessiontimezone` | `TYPE-TSLTZ` PARTIAL, `TYPE-TSTZ` REVIEW | H-37 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12 |
| Global indexes and partition keys | A primary key without the partition key works in Oracle through a global index. PostgreSQL needs every unique key on a partitioned table to include the partition columns, so the key widens and every foreign key follows | `DDL-GLOBAL-INDEX` REVIEW (24 units), `DDL-PARTITION-INTERVAL` REVIEW, `DDL-PARTITION-REFERENCE` BLOCKER | H-19, H-20 | `not sourced` |
| Fast-refresh materialized views | Core PostgreSQL has complete refresh only. `pg_ivm` is allow-listed and maintains a view inside the same transaction. It works on plain tables, not partitioned ones. Otherwise: trigger-maintained summary tables, or a scheduled refresh through `pg_cron` | `DDL-MV-FAST-REFRESH` REVIEW (8 units), `DDL-MV-LOG` REVIEW, `PKG-DBMS-MVIEW` REVIEW | H-15 | [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12 for the extension. `pg_ivm` limits: `not sourced` |
| VPD | Row-level security with `CREATE POLICY`. A policy function that returns WHERE text must become a static boolean expression. Policy types and column masking have no analogue. Owners bypass the policy unless `FORCE` is set. The converter does not convert VPD | `SEC-VPD` REVIEW (8 units) | H-40 | [Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12 |
| Scheduler chains | `pg_cron` fires independent SQL commands. Chains, events, windows and job classes need an external orchestrator. Jobs that run operating-system executables have no in-database answer | `PKG-DBMS-SCHEDULER` REVIEW, `PKG-SCHEDULER-OS-EXECUTABLE` BLOCKER | H-14 | [Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12, [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions) |
| UTL_FILE | No server file system. orafce ships `utl_file` but it needs a server-side directory table. Whether it fails at run time on Azure is `unverified`. `azure_storage` reads and writes blobs | `PKG-UTL-FILE` REVIEW (8 units) | H-13 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12, [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions) |
| DBMS_* packages | orafce covers `DBMS_OUTPUT`, `DBMS_PIPE`, `DBMS_ALERT`, `DBMS_ASSERT`, `DBMS_RANDOM`, `UTL_FILE`, and subsets of `DBMS_UTILITY` and `DBMS_SQL`. It does not list `DBMS_LOB`, `DBMS_CRYPTO`, `DBMS_SCHEDULER`, `UTL_HTTP`, `UTL_SMTP` or `DBMS_AQ`. "Not covered" is by absence from the README | `PKG-DBMS-LOB` PARTIAL, `PKG-DBMS-CRYPTO` REVIEW, `PKG-DBMS-AQ` BLOCKER, `PKG-UTL-NETWORK` BLOCKER | H-12, H-34 | [orafce](https://github.com/orafce/orafce), checked 2026-10-12 |
| Optimizer hints | Hints are comments to PostgreSQL. They are silently ignored, the SQL text is unchanged, and the plan differs. `pg_hint_plan` can force a plan | `SQL-HINT` PARTIAL | T-06 | [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12 |
| ROWID | `ctid` is not stable across `UPDATE` or `VACUUM FULL`. Replace with a real key | `SQL-ENDIAN-ROWID-PSEUDO` REVIEW, `TYPE-ROWID-COLUMN` REVIEW | T-08 | `not sourced` |
| Search path | `pg_catalog` is searched before orafce, so `to_char` and `substr` are quietly not orafce's unless `oracle` is listed first or the call is qualified | not catalogued as a scan pattern | none | [orafce](https://github.com/orafce/orafce), checked 2026-10-12, [Schema conversion best practices](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-best-practices) |
| Implicit conversion | PostgreSQL does not cast `varchar` to number or date in comparisons and calls. Many cases fail loudly. The comparison forms do not | not catalogued as a scan pattern (needs type inference) | T-10 | `not sourced` |

### 6.4 Where the research disagrees with the lab's own predictions

The lab publishes predictions for its 43 hard cases and 14 traps. The lab says nobody has compared its conversion report with them. The research read vendor documentation and the lab's measured conversion runs and disagrees with these nine. The vendor documentation wins in this document.

| Case | The lab says | The vendor documentation says | Effect |
|---|---|---|---|
| T-03 `VARCHAR2` byte and char semantics | Byte-sized lengths overflow after conversion. | PostgreSQL `varchar(n)` counts characters, so limits loosen. The real risks are btree entry size and orafce `varchar2` byte semantics. | `TYPE-VARCHAR2-NVARCHAR2-BYTE-CHAR` is `CLEAN`. [orafce](https://github.com/orafce/orafce), checked 2026-10-12; PostgreSQL side `not sourced` |
| T-14 concatenation with NULL | Both databases return NULL for `'a' \|\| NULL`. | Oracle returns the other operand. PostgreSQL returns NULL. | A silent, high-impact difference. `TYPE-CONCAT-NULL` is `PARTIAL`. `not sourced` |
| T-13 NULL sort order | The order differs and needs `NULLS FIRST` or `NULLS LAST`. | Oracle and PostgreSQL both sort NULLs as largest: last for ascending and first for descending. No work. | The catalogue has no entry, so the assessor charges no effort. `not sourced` |
| H-08 analytic functions | Clean. | `KEEP (DENSE_RANK FIRST/LAST)` and `NTH_VALUE ... FROM LAST` need rewrites. `IGNORE NULLS` is absent in PostgreSQL 18. | `SQL-ANALYTIC-ORACLE-ONLY` is `PARTIAL`. `SQL-IGNORE-NULLS-RESPECT-NULLS` is `REVIEW`. `not sourced` |
| H-31 `NVL`, `NVL2`, `DECODE` | Clean. | `DECODE` treats NULL as equal to NULL. `CASE x WHEN` does not. | `SQL-DECODE-NULL-KEY` is `PARTIAL`. The lab's three NULL-key `DECODE` sites are real traps. `not sourced` |
| H-10 `BULK COLLECT` and `FORALL` | Partial. | The translation is easy. `SAVE EXCEPTIONS` is a behaviour decision, not a translation. | `PLSQL-SAVE-EXCEPTIONS` is `REVIEW`. The lab's own text agrees on the substance. |
| H-15 materialized views | PostgreSQL has no incremental refresh at all, and `FAST ON COMMIT` has no analogue. | Core PostgreSQL has none, but `pg_ivm` is allow-listed on flexible server. It cannot help the lab's view, because the base tables are partitioned. | The conclusion stands and the premise is too strong. [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12 |
| H-19 range partitioning | Partial. | The shape converts. A primary key without the partition key is a redesign across foreign keys. `pg_partman` must be allow-listed, preloaded and the server restarted. | `DDL-GLOBAL-INDEX` is `REVIEW`. [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12 |
| H-34 `CLOB` and `BLOB` | Clean. orafce covers `DBMS_LOB` partially, and a `dbms_lob` schema is on the search path. | Column types map cleanly. orafce has no `DBMS_LOB` package and creates no such schema. The lab's `pkg_etl_export` uses `DBMS_LOB` and stayed unconverted in run 1. | `PKG-DBMS-LOB` is `PARTIAL`. [orafce](https://github.com/orafce/orafce), checked 2026-10-12, [Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab) |

Smaller corrections: attribute-only object types are mechanical (H-03). The remark that PostgreSQL cannot `MERGE` into a view is outdated from PostgreSQL 17 (H-07). Scheduler chains and job classes are more than a review (H-14). Virtual columns in PostgreSQL 18 cannot call user functions (H-17). Two of the lab's trap claims, T-09 and T-12, contain a sub-claim that the research could not verify. All of these are `not sourced` for the PostgreSQL side.

### 6.5 Extension allow-listing on flexible server

Extensions are a two-step choice. First **allow-list** the extension in the `azure.extensions` server parameter, otherwise `CREATE EXTENSION` fails. Then run `CREATE EXTENSION` in each database. An extension that ships a shared library also needs `shared_preload_libraries` and a **restart**. Modules such as `auto_explain`, `pg_failover_slots`, `pg_partman_bgw` and `wal2json` need only the preload entry and no allow-listing ([Extension considerations](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-considerations), checked 2026-10-12). Customers cannot upload their own extensions. No page for flexible server states this outright, so it is an inference from the closed allow-list and is `unverified`.

| Extension | Version and PostgreSQL range | Preload (marked on the page) | Use in an Oracle estate | Caveat |
|---|---|---|---|---|
| `oracle_fdw` | 1.2 on PostgreSQL 12 to 18. General availability announced December 2024 | not marked | Federated reads from Oracle. Basis of `ORACLE_FDW_COPY` and `ORACLE_FDW_COMPARE`. | Needs a network path. Client-library prerequisites are `unverified`. Absent on HorizonDB |
| `orafce` | 4.16 on PostgreSQL 14 to 18 | not marked | Oracle functions, `dual`, `varchar2`, `DBMS_OUTPUT`, `DBMS_PIPE`, `DBMS_ALERT`, `DBMS_RANDOM`, `UTL_FILE` | A subset of each package. Put `oracle` before `pg_catalog` in `search_path`. Whether it can be preloaded for `DBMS_PIPE` and `DBMS_ALERT` capacity is `unverified` |
| `pg_hint_plan` | per PostgreSQL major | yes | Optimizer hints | Blocks a major upgrade when the target is PostgreSQL 14 |
| `plpgsql_check` | 2.8 on PostgreSQL 14 to 18 | yes | Static analysis of converted code | The converter silently skips the check when it is missing |
| `pg_partman` | 5.4.3 on PostgreSQL 16 to 18 (older on 14 and 15) | yes | Interval partitioning | Drop and re-create for every major upgrade. `pg_partman_bgw` is a separate preload module |
| `pg_cron` | 1.6 | yes | `DBMS_SCHEDULER` and `DBMS_JOB` jobs, partition pre-creation, materialized view refresh | Jobs run as the scheduling user. The run-as-user argument needs a superuser and is unsupported |
| `session_variable` | 3.4 | not marked | Package state | Blocks in-place major version upgrade |
| `login_hook` | allow-listed | not marked | Logon triggers | Errors can lock users out |
| `pg_ivm` | allow-listed | yes (research reading) | Incremental views | Plain tables only |
| `azure_storage` | 1.9 | yes | File I/O replacement for `UTL_FILE` and external tables | Blocks an upgrade to PostgreSQL 18 |
| `dblink` | 1.2 | not marked | Autonomous-transaction emulation | Needed on the target, not only the scratch server |
| `postgres_fdw` | allow-listed | not marked | Links to PostgreSQL | On public-access servers outbound reach cannot be restricted |
| `pgaudit` | allow-listed | yes | Audit trail | Not Oracle's `AUDIT` |

Sources for the table: [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions), checked 2026-10-12; the `oracle_fdw` general-availability date from [Release notes](https://learn.microsoft.com/en-us/azure/postgresql/release-notes/release-notes), checked 2026-10-12; upgrade effects from [Major version upgrade](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade), checked 2026-10-12. Versions vary by PostgreSQL major, so check the page for the major in use. Standard extensions that Oracle estates also use are on the same page: `pgcrypto`, `uuid-ossp`, `pg_trgm`, `citext`, `hstore`, `tablefunc`, `fuzzystrmatch`, `unaccent`, `postgis`, `pg_stat_statements`, `btree_gin`, `btree_gist`, `pg_repack` and `pg_squeeze`.

**Absent from the allow-list.** `plperl`, `plpythonu`, `plpython3u`, `pltcl`, `file_fdw`, `mysql_fdw`, `http`, `pgtap` and `pg_background`. The consequence is concrete. There are no untrusted procedural languages and no HTTP callouts from the database, so `UTL_HTTP`, `UTL_SMTP` and `UTL_TCP` become application-tier or Azure-service work. There is no `file_fdw`, so external tables go through `azure_storage`. There is no `pg_background`, so autonomous transactions go through `dblink`. The allow-list may lag the service. The research noted a preview extension in a roundup that the page did not list, so real availability is `unverified`.

**Major upgrades.** `session_variable`, `anon` and `age` block an in-place upgrade on every path. `pg_repack`, `hypopg` and `pg_partman` must be dropped and recreated. Event triggers block the upgrade pre-check. Whether customers can create event triggers on flexible server at all is `unverified` (section 12). There is no automated rollback: restore to a point before the upgrade on a new server ([Major version upgrade](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade), checked 2026-10-12).

---

## 7. Where Microsoft has no product

The advisor is scoped to Microsoft's platform and is not an official Microsoft product. It recommends Microsoft services, Microsoft-published tools and Azure-hosted offerings, and nothing else (`OP-SCOPE`). This knowledge base follows the same rule. Where Microsoft has no product for a step, the card shows a **gap**, says in terms what Microsoft lacks, and names no substitute.

### 7.1 The gaps

| Gap | What Microsoft offers | What the card says |
|---|---|---|
| `SCHEMA_CONVERSION` | The AI-assisted converter, for Oracle 12.1 to 21c, once its prerequisites exist (section 4.3). Nothing for Oracle 11g or older | Microsoft publishes no other schema converter for Oracle to PostgreSQL. Convert by hand to Microsoft's guidance, or with a partner chosen with the Microsoft account team. Upgrading the source to a release the converter lists is the other path (section 4.6) |
| `ONLINE_CAPTURE` | No change-capture service. Offline routes only: the Data Factory Oracle connector and `oracle_fdw` (section 5.1) | Microsoft offers no change-capture service from Oracle to PostgreSQL. A downtime this short needs a product from outside Microsoft. The advisor recommends none (section 5.2) |
| Reverse replication | None. PostgreSQL to Oracle is not a supported Microsoft path | The way back is a retained Oracle copy that is not updated after cutover, or a capture setup from outside Microsoft agreed before cutover (section 9) |
| Data comparison | `oracle_fdw` for row-level comparison and `plpgsql_check` for converted code. No packaged first-party comparison product is in `sources.json` | Differential testing on representative data (section 8) |

The first two appear on the card as `methodGaps[]`. The last two are limits this document states.

### 7.2 Other vendors' products

Other vendors sell converters, change-capture products and PostgreSQL distributions. This knowledge base does not assess, compare, rank or recommend any of them, and no answer in the interview selects one. The advisor never lists one as a target, an alternative, a route, a next action or a cost lever. A customer who needs something Microsoft does not offer can ask the Microsoft account team what options exist.

### 7.3 The Oracle targets

Oracle AI Database@Azure and Oracle Database on Azure virtual machines are Azure-hosted offerings, so they stay in scope. They appear only as the answer to "do not migrate to PostgreSQL" (sections 2.7 and 2.8). How Oracle itself is moved to either of them is done with Oracle's own tooling, which this advisor does not cover.

---

## 8. Validation

Validation is always recommended and never a gate. **Converted is not equivalent.** Microsoft's documentation says so, and the converter can report "Converted" for a routine that is a placeholder raising an error ([Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations), checked 2026-10-12). Microsoft's guidance is to deploy the converted schema to a separate non-production database that is not the scratch database, run procedures and application workloads on representative data, and confirm that business logic and result sets match Oracle. It adds that every AI-converted complex object should be reviewed even when marked Converted, and that the same engine that converted the code can also review it, so review must be independent ([Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview), [Schema conversion best practices](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-best-practices)).

| Route | What it checks | Needs | Limits |
|---|---|---|---|
| `PLPGSQL_CHECK` | Static analysis of PL/pgSQL, including embedded SQL and referenced objects | Version 2.8 on PostgreSQL 14 to 18. Allow-listed, preloaded and the server restarted | Silent when missing. Absent on HorizonDB. Not proof of behaviour. ([plpgsql_check](https://github.com/okbob/plpgsql_check), checked 2026-10-12, [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions)) |
| `DIFFERENTIAL_TESTING` | The same queries and workloads on both sides, result sets diffed | A test database loaded with representative data, and a workload | The only route that catches a converted query that is wrong and quiet. No packaged first-party tool exists in `sources.json` |
| `ORACLE_FDW_COMPARE` | Row-level comparison through foreign tables | A network path, and primary keys | Collation must be `C` or ordering differs. Mind `NUMBER`, `DATE` and empty-string semantics. The 2024 playbook suggests `oracle_fdw` for validation ([Oracle to Azure Postgres Migration Playbook (2024)](https://download.microsoft.com/download/8/f/c/8fc4fe39-7cb1-484a-aaa0-418704b90c0e/Oracle%20to%20Azure%20Postgres%20Migration%20Playbook.pdf), checked 2026-10-12) |
| Plan and workload comparison | Whether the converted query is as fast as the Oracle original | Oracle AWR or ASH statistics, and `pg_stat_statements` on the target | No tool in `sources.json` automates plan equivalence. This approach is `unverified` |

No packaged first-party data-comparison product is in `sources.json`. This knowledge base recommends no product for it; ask the Microsoft account team. Take both sides at one point in time. Comparing a target that has moved on against a source frozen at another SCN reports differences that are not defects. A load from a source that has stopped changing avoids the problem.

---

## 9. Cutover, rollback and operations after the move

This is the thinnest part of the sources. The research found no Microsoft runbook for an Oracle to PostgreSQL cutover. Microsoft's 2024 playbook lists the phases: discovery, assessments, schema, code, data migration, application code, validation and performance tuning ([Oracle to Azure Postgres Migration Playbook (2024)](https://download.microsoft.com/download/8/f/c/8fc4fe39-7cb1-484a-aaa0-418704b90c0e/Oracle%20to%20Azure%20Postgres%20Migration%20Playbook.pdf)). It predates the VS Code converter. Everything below is limited to what a source in `sources.json` says.

**Cutover.**

- Offline: downtime is the full load plus validation (`OP-DOWNTIME`).
- Online: needs change capture, for which Microsoft has no service (section 5.2). This document says nothing more about it. Enabling `ARCHIVELOG` for any capture product needs a restart, which is itself downtime.
- Sequences: set each sequence above the last Oracle value at cutover, or new rows collide with loaded keys (`not sourced`).
- Connections: flexible server offers a built-in PgBouncer. Whether it suits an application that holds session state is `unverified` (section 12).
- Oracle components around the database (Forms, Reports, APEX, OBIEE, ODI, WebLogic, `mod_plsql`) are application work, not database work (`OP-APP-TIER`).

**Rollback.** PostgreSQL to Oracle is not a supported Microsoft path. Microsoft offers no reverse replication. A rollback plan is a retained Oracle copy that is not updated after cutover, or a capture setup from outside Microsoft agreed before cutover, which this knowledge base does not cover. The advisor says which, and does not promise either. No source in `sources.json` documents a bidirectional Oracle and PostgreSQL setup.

**After the move, facts the sources do state** ([Backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore), checked 2026-10-12, [Major version upgrade](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade), [Extended support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support)):

- Backups: daily snapshot plus continuous WAL, point-in-time restore for 7 to 35 days, no manual backups (use `pg_dump`), long-term retention only for databases up to 1 TiB.
- Major upgrades are in place with `pg_upgrade`. All read replicas must be deleted first. HA is off during the upgrade. A restore to a pre-upgrade time is the only rollback.
- Storage only grows, and the server goes read-only at 95% used.
- PostgreSQL 11, 12 and 13 are in paid Extended Support. Never land a new migration on them.
- Retiring the Oracle licence and support is a contract question for Oracle contract and licence management, not a technical step.

**Not covered by any source here:** a cutover rehearsal method, performance tuning after the move, vacuum and statistics practice, monitoring migration from Oracle Enterprise Manager and AWR, and DBA retraining. Each is a real workstream. None can be stated from `sources.json`.

---

## 10. Cost levers and Microsoft programmes

**This document states no cost figure for an estate.** A cost is a lever, not a figure. A figure needs measured sizing and stated pricing assumptions, and the advisor has neither (`OP-COST-LEVERS`). Published prices exist for some items. They are not reproduced.

### 10.1 Levers

| Lever | What the sources say | Support |
|---|---|---|
| Retire Oracle licences and annual support | The saving depends on the customer's Oracle contract. Confirm with Oracle contract and licence management. | `not sourced` (a contract question) |
| Azure Hybrid Benefit | **It does not apply to Azure Database for PostgreSQL.** There is no licence to bring. The benefit hub lists Windows Server, SQL Server, Red Hat and SUSE Linux on VMs, and Azure VMware Solution. | [Azure Hybrid Benefit](https://learn.microsoft.com/en-us/azure/cost-management-billing/azure-hybrid-benefits/), checked 2026-10-12 |
| Reserved capacity | Compute only. Microsoft's pages quote three different maxima, so use the calculator for the region and SKU. | [Reserved capacity for Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-reserved-pricing), checked 2026-10-12, [Azure Database for PostgreSQL flexible server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), checked 2026-10-12 |
| High availability | It doubles compute and storage cost, because the standby is billed like the primary. Use zone-redundant HA only where the availability target needs it. | [Azure Database for PostgreSQL flexible server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), checked 2026-10-12, [Reliability, HA and SLA](https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql) |
| Burstable with stop and start | Dev and test only. Burstable is not for production and has no HA. A stopped server has no compute charge, but storage is still billed and it restarts automatically after 7 days. | [Compute](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), checked 2026-10-12, [Azure Database for PostgreSQL flexible server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/) |
| Storage | Storage can only grow. Premium SSD v2 sets capacity, IOPS and throughput separately. | [Storage](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage), checked 2026-10-12, [Premium SSD v2](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage-premium-ssd-v2) |
| Extended Support | PostgreSQL 11 to 13 carry a per-vCore-hour Extended Support charge. Do not land on them. | [Extended support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support), checked 2026-10-12, [Azure Database for PostgreSQL flexible server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/) |
| Keeping Oracle on Azure VMs as the benchmark | Two Azure vCPUs are one Oracle Processor licence with multithreading on. The Core Factor Table does not apply. | [Oracle licensing for authorized cloud environments](https://www.oracle.com/us/corporate/pricing/cloud-licensing-070579.pdf), checked 2026-10-12 |
| Oracle AI Database@Azure | Counts toward the Microsoft Azure Consumption Commitment. Bring-your-own-licence is supported. | [Oracle AI Database@Azure overview](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/database-overview), checked 2026-10-12 |

### 10.2 Programmes

Microsoft is renaming its migration funding programmes. **Quote both names.** Programme terms are marketing statements, not commitments. Eligibility, scope and approval are Microsoft's to decide.

| Programme | What it is | Terms as stated | Support |
|---|---|---|---|
| **Frontier Accelerate for Azure** and **Frontier Accelerate for Databases** (formerly **Azure Accelerate**) | Partner-nominated delivery funding and Azure credits | Advertised at 50% of year-one usage, subject to application, scope, regional availability and approval. A Partner Center announcement of May 2026 names Oracle to Azure PostgreSQL migration projects for nomination. Engage through the Microsoft account team or a specialised partner. The pages still use both names | [Azure Accelerate](https://azure.microsoft.com/en-us/solutions/azure-accelerate/), checked 2026-10-12, [Azure Accelerate for Databases](https://azure.microsoft.com/solutions/azure-accelerate/databases), checked 2026-10-12, [Partner Center announcements, May 2026](https://learn.microsoft.com/en-us/partner-center/announcements/2026-may), checked 2026-10-12 |
| **Cloud Accelerate Factory** | Zero-cost Microsoft delivery assistance alongside a partner | Nomination is required. Oracle to PostgreSQL is not named. The value is not guaranteed and is not written into a contract | [Cloud Accelerate Factory](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/cloud-accelerate-factory-information-1029314.pdf), checked 2026-10-12 |
| **FastTrack for Azure** | Free remote guidance | Nominated projects above $5,000 a month. Database scope is not stated | [FastTrack for Azure FAQ](https://www.microsoft.com/en-us/fasttrack/faqs), checked 2026-10-12 |

Training is separate from funding. Microsoft Learn publishes a module, "Convert Oracle schemas to Azure Database for PostgreSQL by using AI" ([Learn module: Convert Oracle schemas to Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/training/modules/convert-oracle-schema-azure-database-postgresql-ai/), checked 2026-10-12). Published customer success claims are marketing, not engineering evidence, and none is repeated here.

---

## 11. Never recommended

The advisor never recommends anything on this list, and always says what replaces it. Recommending one of them breaks invariant 18 of the output contract. The table is generated from the `retired` list in `reference/decision-rules.data.json`. It gives the item, its date and its replacement.

<!-- GENERATED:retired -->
| Do not recommend | Use instead, or why not |
|---|---|
| Azure Data Studio and all its extensions | the PostgreSQL extension for VS Code |
| Azure Data Studio Oracle assessment (DMAO) and schema conversion toolkit (DSCT) | the VS Code conversion tool |
| Azure Database for PostgreSQL Single Server | flexible server |
| Azure Arc-enabled PostgreSQL | flexible server |
| Azure Cosmos DB for PostgreSQL, for new deployments | flexible server elastic clusters |
| Azure Database Migration Service for Oracle to PostgreSQL | none: no Microsoft migration service moves Oracle rows to PostgreSQL. The offline routes are the Data Factory copy and oracle_fdw |
| SSMA for Oracle as a route to PostgreSQL | SSMA targets SQL Server and Azure SQL only |
| Azure Migrate as an Oracle database assessor | the VS Code discovery step, the schema scan |
| Azure Data Factory Oracle connector v1.0 | Oracle connector v2.0 |
| PostgreSQL 11, 12 and 13 as a new target | PostgreSQL 16 to 18 |
| PostgreSQL 14 as a new target | PostgreSQL 16 to 18 |
<!-- /GENERATED -->

**Why each item is on the list.**

| Item | Why |
|---|---|
| Azure Data Studio and its extensions | Retired on 2026-02-28. It gets no updates or security fixes. The Oracle migration workflow is available in Visual Studio Code only ([What's happening to Azure Data Studio](https://learn.microsoft.com/en-us/azure-data-studio/whats-happening-azure-data-studio), checked 2026-10-12). |
| ADS Oracle assessment and schema conversion toolkit | Retired on 2024-12-15 ([Retirement of ADS Oracle migration extensions](https://www.microsoft.com/en-us/sql-server/blog/2024/09/12/modernize-your-database-with-the-consolidation-and-retirement-of-azure-database-migration-tools/), checked 2026-10-12). The replacement today is the discovery and conversion workflow in the PostgreSQL extension for VS Code (section 4.3). |
| Single Server | Retired on 2025-03-28 ([Azure service retirement calendar (Advisor)](https://learn.microsoft.com/en-us/azure/advisor/advisor-how-to-use-service-upgrade-retirement-recommendations), checked 2026-10-12). |
| Azure Arc-enabled PostgreSQL | Retired in July 2025. Microsoft points to flexible server ([Azure Arc-enabled PostgreSQL](https://learn.microsoft.com/en-us/azure/azure-arc/data/what-is-azure-arc-enabled-postgresql), checked 2026-10-12). |
| Cosmos DB for PostgreSQL, for new work | New deployments are blocked. Retires 2029-03-31 ([Azure Cosmos DB for PostgreSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/introduction), checked 2026-10-12). |
| DMS for Oracle to PostgreSQL | It never existed. There is no such scenario ([DMS scenario status](https://learn.microsoft.com/en-us/azure/dms/resource-scenario-status), checked 2026-10-12). |
| SSMA for Oracle as a route to PostgreSQL | It targets SQL Server and Azure SQL only ([SSMA for Oracle](https://learn.microsoft.com/en-us/sql/ssma/oracle/sql-server-migration-assistant-for-oracle-oracletosql), checked 2026-10-12). |
| Azure Migrate as an Oracle assessor | Its discovery does not cover Oracle databases ([Azure Migrate discovery methods](https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate), checked 2026-10-12). |
| Data Factory Oracle connector 1.0 | Removed on 2026-03-31 ([ADF connector release stages](https://learn.microsoft.com/en-us/azure/data-factory/connector-release-stages-and-timelines), checked 2026-10-12). |
| PostgreSQL 11, 12, 13 as a new target | Standard support ended on 2026-07-31. They are in paid Extended Support ([Version policy](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-version-policy), checked 2026-10-12, [Extended support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support)). |
| PostgreSQL 14 as a new target | Standard support ends on 2026-12-11, and the version is below the converter's floor of 15 ([Version policy](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-version-policy), checked 2026-10-12). |

---

## 12. What this knowledge base does not know

Each item is an open question, why it matters, and who could settle it. Most volatile items need a person to look at a portal, a vendor, or a pilot database. None can be settled from `sources.json`.

| Open question | Why it matters | Who could settle it |
|---|---|---|
| Which regions currently block or lack zone-redundant HA, and whether Japan West has it (two Microsoft pages disagree) | `OP-REGION-HA`. A 99.99% promise depends on it. The lists change ([Azure Database for PostgreSQL overview (regions, HA, V6)](https://learn.microsoft.com/en-us/azure/postgresql/overview), checked 2026-10-12) | Microsoft, through the portal or a support request |
| General availability date and connection defaults of the V6 SKUs | `OP-V6`. It decides whether 97 to 192 vCores needs a preview | Microsoft |
| HorizonDB: general availability date, SLA, final region list (the Learn and Build lists differ), supported PostgreSQL majors beyond 17 | `OP-PREVIEW`, `OP-HZ-REGION`. All of them are gates | Microsoft's HorizonDB team |
| Whether `orafce` can be preloaded, which affects `DBMS_PIPE` and `DBMS_ALERT` capacity | Section 6.5 | Microsoft documentation, or a test on a flexible server |
| Whether customers can create event triggers on flexible server | Logon triggers, system-event triggers and the upgrade pre-check | A test on a flexible server, or Microsoft |
| `oracle_fdw` client-library prerequisites, wallet and TNS support, firewall needs on a managed server | `ORACLE_FDW_COPY` and `ORACLE_FDW_COMPARE` | A pilot, or Microsoft documentation |
| Whether the built-in PgBouncer breaks session-scoped state such as `session_variable` | Package-state emulation and pooling | A test on a flexible server |
| Whether Microsoft's converter handles Oracle 23ai and 26ai | `OP-CONVERTER-GATE`, `OP-SOURCE-VERSION`. Not listed in the documentation | Microsoft, or a pilot of 10 to 15 objects |
| Whether Microsoft will publish a schema converter for Oracle 11g or older, or a change-capture service for Oracle to PostgreSQL | `OP-SCOPE`. Today both are gaps on the card | Microsoft |
| Whether 23ai becomes 26ai by release update | Section 3 | Oracle, through My Oracle Support |
| Which Exadata shapes Oracle AI Database@Azure supports (the Microsoft page says X9M and is dated 2024) | `OP-STAY-ORACLE` | Oracle |
| RAC on standard Azure VMs | `OP-STAY-ORACLE`. The page speaks only of Bare Metal | Oracle and Microsoft |
| Whether geo-replication and geo-DR are generally available (the release notes show Preview entries in February 2026) | `OP-DR` | Microsoft |
| Elastic clusters: SLA, `oracle_fdw` and PostGIS support, and the roadmap for autogrow and Premium SSD v2 | `OP-SIZE`, `OP-FEATURE-MATRIX` | Microsoft |
| The support boundary for PostgreSQL on plain Azure VMs | `pg_vm` | Microsoft |
| The Oracle and PostgreSQL manual pages behind the semantic traps, and the empty-LOB case | Section 6.3 marks them `not sourced` | The project maintainers, by adding sources |
| Reserved-capacity percentages and programme terms | They differ between pages and are marketing | The Azure pricing calculator and the Microsoft account team |

---

## 13. Sources

Every page this document cites is in `reference/sources.json`. Each was read on 2026-10-12. The list below is generated. It gives the id, the title as a link, the page's own date where it shows one, and the date the page was checked. A fact that needs a page not on the list is marked `not sourced`.

<!-- GENERATED:sources -->
Read on 2026-10-12.

#### Microsoft (62)

- [Azure Database for PostgreSQL limits](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits)
- [Extension versions by PostgreSQL major](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-versions)
- [Supported PostgreSQL versions](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-supported-versions)
- [Azure Database for PostgreSQL overview (regions, HA, V6)](https://learn.microsoft.com/en-us/azure/postgresql/overview)
- [Compute](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute)
- [Storage](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage)
- [Premium SSD v2](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-storage-premium-ssd-v2)
- [Reliability, HA and SLA](https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql)
- [Read replicas](https://learn.microsoft.com/en-us/azure/postgresql/read-replica/concepts-read-replicas)
- [Backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-backup-restore)
- [Data encryption](https://learn.microsoft.com/en-us/azure/postgresql/security/security-data-encryption)
- [Access control and privileges](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control)
- [Private networking](https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private)
- [Extension considerations](https://learn.microsoft.com/en-us/azure/postgresql/extensions/concepts-extensions-considerations)
- [Major version upgrade](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-major-version-upgrade)
- [Version policy](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-version-policy)
- [Extended support](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/extended-support)
- [Release notes](https://learn.microsoft.com/en-us/azure/postgresql/release-notes/release-notes)
- [Elastic clusters](https://learn.microsoft.com/en-us/azure/postgresql/elastic-clusters/concepts-elastic-clusters)
- [Elastic cluster limitations](https://learn.microsoft.com/en-us/azure/postgresql/elastic-clusters/concepts-elastic-clusters-limitations)
- [Azure HorizonDB overview](https://learn.microsoft.com/en-us/azure/horizondb/overview)
- [Azure HorizonDB release notes](https://learn.microsoft.com/en-us/azure/horizondb/release-notes/release-notes)
- [Azure HorizonDB extensions](https://learn.microsoft.com/en-us/azure/horizondb/extensions/concepts-extensions-versions)
- [Azure HorizonDB compute and replicas](https://learn.microsoft.com/en-us/azure/horizondb/configure-maintain/concepts-compute-replicas)
- [Azure HorizonDB public preview (Build)](https://techcommunity.microsoft.com/blog/adforpostgresql/azure-horizondb-enterprise-ready-postgres-engineered-for-the-ai-era/4524094)
- [Azure Cosmos DB for PostgreSQL](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/introduction)
- [Azure service retirement calendar (Advisor)](https://learn.microsoft.com/en-us/azure/advisor/advisor-how-to-use-service-upgrade-retirement-recommendations)
- [Azure Arc-enabled PostgreSQL](https://learn.microsoft.com/en-us/azure/azure-arc/data/what-is-azure-arc-enabled-postgresql)
- [Oracle AI Database@Azure overview](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/database-overview)
- [Oracle AI Database@Azure regions](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/oracle-database-regions)
- [Exadata on Oracle Database@Azure](https://learn.microsoft.com/en-us/azure/oracle/oracle-db/exadata-manage-services)
- [Oracle on Azure virtual machines](https://learn.microsoft.com/en-us/azure/virtual-machines/workloads/oracle/oracle-overview)
- [PostgreSQL HA on AKS (CloudNativePG)](https://learn.microsoft.com/en-us/azure/aks/postgresql-ha-overview)
- [Oracle migration in the PostgreSQL extension for VS Code](https://learn.microsoft.com/en-us/azure/postgresql/development/vs-code-extension/oracle-migration)
- [Schema conversion overview](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-overview)
- [Schema conversion limitations](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-limitations)
- [Schema conversion tutorial and prerequisites](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-tutorial)
- [Schema conversion best practices](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-schema/schema-conversions-best-practices)
- [Application conversion overview (preview)](https://learn.microsoft.com/en-us/azure/postgresql/migrate/oracle-conversions-application/app-conversions-overview)
- [vscode-pgsql changelog](https://github.com/microsoft/vscode-pgsql/blob/main/CHANGELOG.md)
- [Learn module: Convert Oracle schemas to Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/training/modules/convert-oracle-schema-azure-database-postgresql-ai/)
- [AI-assisted Oracle to PostgreSQL schema conversion in VS Code](https://techcommunity.microsoft.com/blog/adforpostgresql/ai-assisted-oracle-to-postgresql-schema-conversion-in-visual-studio-code/4542203)
- [DMS scenario status](https://learn.microsoft.com/en-us/azure/dms/resource-scenario-status)
- [DMS tools matrix](https://learn.microsoft.com/en-us/azure/dms/dms-tools-matrix)
- [Migration service in Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/migrate/migration-service/overview-migration-service-postgresql)
- [What's happening to Azure Data Studio](https://learn.microsoft.com/en-us/azure-data-studio/whats-happening-azure-data-studio)
- [Retirement of ADS Oracle migration extensions](https://www.microsoft.com/en-us/sql-server/blog/2024/09/12/modernize-your-database-with-the-consolidation-and-retirement-of-azure-database-migration-tools/)
- [SSMA for Oracle](https://learn.microsoft.com/en-us/sql/ssma/oracle/sql-server-migration-assistant-for-oracle-oracletosql)
- [Azure Migrate discovery methods](https://learn.microsoft.com/en-us/azure/migrate/discovery-methods-modes?view=migrate)
- [Azure Data Factory Oracle connector](https://learn.microsoft.com/en-us/azure/data-factory/connector-oracle)
- [ADF connector release stages](https://learn.microsoft.com/en-us/azure/data-factory/connector-release-stages-and-timelines)
- [Azure Copilot migration agent](https://learn.microsoft.com/en-us/azure/copilot/migration-agent)
- [Oracle to Azure Postgres Migration Playbook (2024)](https://download.microsoft.com/download/8/f/c/8fc4fe39-7cb1-484a-aaa0-418704b90c0e/Oracle%20to%20Azure%20Postgres%20Migration%20Playbook.pdf)
- [Azure Database for PostgreSQL flexible server pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/)
- [Reserved capacity for Azure Database for PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-reserved-pricing)
- [Azure Hybrid Benefit](https://learn.microsoft.com/en-us/azure/cost-management-billing/azure-hybrid-benefits/)
- [Service Level Agreements for Online Services](https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services?lang=1)
- [Azure Accelerate](https://azure.microsoft.com/en-us/solutions/azure-accelerate/)
- [Azure Accelerate for Databases](https://azure.microsoft.com/solutions/azure-accelerate/databases)
- [Partner Center announcements, May 2026](https://learn.microsoft.com/en-us/partner-center/announcements/2026-may)
- [Cloud Accelerate Factory](https://cdn-dynmedia-1.microsoft.com/is/content/microsoftcorp/microsoft/final/en-us/microsoft-brand/documents/cloud-accelerate-factory-information-1029314.pdf)
- [FastTrack for Azure FAQ](https://www.microsoft.com/en-us/fasttrack/faqs)

#### Oracle (3)

- [Oracle Lifetime Support: Oracle Database technology chart](https://www.oracle.com/us/support/library/lsp-tech-chart-069290.pdf)
- [Oracle licensing for authorized cloud environments](https://www.oracle.com/us/corporate/pricing/cloud-licensing-070579.pdf)
- [Oracle software technical support policies: statement of changes](https://www.oracle.com/contracts/docs/software_technical_support_policies_soc.pdf)

#### Open source and others (6)

- [orafce](https://github.com/orafce/orafce)
- [Ora2Pg manual](https://raw.githubusercontent.com/darold/ora2pg/master/doc/Ora2Pg.pod)
- [Ora2Pg cost tables (lib/Ora2Pg/PLSQL.pm)](https://raw.githubusercontent.com/darold/ora2pg/master/lib/Ora2Pg/PLSQL.pm)
- [plpgsql_check](https://github.com/okbob/plpgsql_check)
- [Contoso Store Oracle to PostgreSQL migration lab](https://github.com/kloba/oracle-to-postgres-migration-lab)
- [fredgis/sql-migration-advisor (design this repository follows)](https://github.com/fredgis/sql-migration-advisor)
<!-- /GENERATED -->
