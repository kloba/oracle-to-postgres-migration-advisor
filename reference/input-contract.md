# Input contract

The single source of truth for what the interview may produce. The rules in
[`decision-rules.md`](decision-rules.md) match on **stable IDs only**, never on displayed wording: a label can be
translated or reworded, an ID cannot drift. If an answer arrives as free text, map it to an ID before any rule runs. If it
maps to none, the field is `UNKNOWN`.

Every field below is either a **single-select**, a **typed value**, or a **list of IDs**. There are no multi-select
controls anywhere in the interview, for the reason recorded in the skill: a multi-select that returns empty cannot be
told apart from "none".

---

## 1. Three states for every answer

| State | Meaning | Effect |
|---|---|---|
| a stated ID | The user answered | Rules may read it |
| `NONE_CONFIRMED` | The user said, in terms, that there are none | Clears a blocker. Only valid on fields that carry a "none" option |
| `UNKNOWN` | Not asked, declined, empty, or unrecognised | Never clears anything. Raises `unknown_requires_assessment` where a rule consumes it, and the field goes into `unknowns[]` and `evidenceRequired[]` |

**"I have none of these" and "I have not checked" are opposite answers.** One clears a blocker, the other raises one. Every
list field is therefore asked as a single-select that names the intent first: `None, confirmed` / `Let me list them` /
`Not checked yet`. Only `Let me list them` opens the free-text list.

A free-text list that matches nothing is `UNKNOWN`, not `NONE_CONFIRMED`. The user committed to listing, and failing to
recognise their words is the skill's problem, not evidence of absence.

---

## 2. Canonical fields

29 fields. The `Rules` column names the rules that consume each one, so a field nobody reads is visible as such.

### 2.1 Scope and source

| Field | Allowed IDs | Rules |
|---|---|---|
| `scope` | `SINGLE_DB` · `FEW_DATABASES` · `LARGE_ESTATE` | `OP-ESTATE` |
| `source_location` | `ON_PREM` · `AZURE_VM` · `AWS_EC2` · `AWS_RDS_ORACLE` · `GCP_COMPUTE` · `OCI_OR_AUTONOMOUS` · `ORACLE_DB_AT_AZURE` · `EXADATA_ON_PREM` | `OP-STAY-REGION` |
| `source_version` | `ORA_11G_OR_OLDER` · `ORA_12C` · `ORA_18C` · `ORA_19C` · `ORA_21C` · `ORA_23AI_26AI` | `OP-SOURCE-VERSION`, `OP-CONVERTER-GATE`, `OP-LIFECYCLE` |
| `topology` | `SINGLE_INSTANCE` · `RAC` · `EXADATA` | `OP-RAC`, `OP-STAY-ORACLE` |
| `edition` | `SE2` · `EE` · `NOT_SURE` | `OP-LICENSE-NOTE` |
| `character_set` | `AL32UTF8` · `SINGLE_BYTE_LEGACY` · `OTHER_MULTIBYTE` · `NOT_SURE` | `OP-CHARSET` |

`ORA_12C` covers 12.1 and 12.2. The Microsoft converter lists 12.1, 12.2, 18c, 19c and 21c; it does not list 11g or 23ai/26ai
(see `OP-CONVERTER-GATE`). Oracle 23ai was renamed 26ai; both IDs are one option.

### 2.2 Intent and constraints

| Field | Allowed IDs | Rules |
|---|---|---|
| `intent` | `MIGRATE_NOW` · `ASSESSMENT_ONLY` · `REHOST_FIRST` | `OP-INTENT` |
| `driver` | `ORACLE_LICENSE_COST` · `SUPPORT_LIFECYCLE` · `APP_MODERNIZATION` · `OPEN_SOURCE_STRATEGY` · `DATACENTER_EXIT` · `PERFORMANCE_SCALE` | `OP-LIFECYCLE`, `OP-RANK` |
| `management_model` | `MANAGED_PAAS` · `OS_CONTROL` · `KUBERNETES` | `OP-MANAGEMENT` |
| `app_changeability` | `APP_CHANGEABLE` · `APP_LIMITED` · `APP_FROZEN` · `PACKAGED_ISV` | `OP-ISV`, `OP-FROZEN-REDESIGN`, `OP-RANK` |
| `isv_supports_postgres` | `YES` · `NO` · `NOT_SURE` | `OP-ISV` (asked only when `app_changeability = PACKAGED_ISV`) |
| `compliance` | `STANDARD_COMMERCIAL` · `EU_DATA_BOUNDARY` · `GOVERNMENT_SOVEREIGN` · `EDGE_AIR_GAPPED` | `OP-REGION`, `OP-STAY-REGION` |
| `region` | an Azure region name, or `NOT_SURE` | `OP-REGION-HA`, `OP-HZ-REGION`, `OP-STAY-REGION` |
| `preview_acceptable` | `PREVIEW_ACCEPTED` · `PREVIEW_REFUSED` · `NOT_SURE` | `OP-PREVIEW`, `OP-V6`, `OP-HZ-GATE` |
| `cmk_required` | `CMK_YES` · `CMK_NO` · `NOT_SURE` | `OP-HZ-GATE`, `OP-CMK` |

`PACKAGED_ISV` means the schema belongs to a vendor application (E-Business Suite, PeopleSoft, JD Edwards, Siebel, a
core-banking or retail suite) whose vendor certifies it on Oracle Database. Moving the database does not move the
application, and the vendor decides what is supported.

### 2.3 Size, performance and availability

| Field | Allowed IDs | Rules |
|---|---|---|
| `largest_db_size` | `UNDER_1_TB` · `FROM_1_TO_8_TB` · `FROM_8_TO_32_TB` · `FROM_32_TO_64_TB` · `FROM_64_TO_128_TB` · `OVER_128_TB` · `NOT_SURE` | `OP-SIZE` |
| `peak_io` | `UNDER_20K_IOPS` · `FROM_20K_TO_80K_IOPS` · `OVER_80K_IOPS` · `NOT_SURE` | `OP-IO` |
| `peak_compute` | `UP_TO_96_VCORES` · `FROM_97_TO_192_VCORES` · `OVER_192_VCORES` · `NOT_SURE` | `OP-COMPUTE`, `OP-V6` |
| `availability_target` | `STANDARD_99_9` · `HIGH_99_95` · `HIGHEST_99_99` · `NOT_SURE` | `OP-AVAILABILITY`, `OP-REGION-HA` |
| `dr_requirement` | `NO_CROSS_REGION_DR` · `ASYNC_CROSS_REGION` · `ZERO_RPO_CROSS_REGION` · `NOT_SURE` | `OP-DR` |

The size classes do not overlap. They are chosen at the real limits: Premium SSD tops out near 32 TiB, Premium SSD v2 at
64 TiB, and HorizonDB at 128 TB. `largest_db_size` is the **planned** size at the end of the planning horizon, not today's
size, and the skill says so when it asks. A database at 30 TiB growing 20% a year does not fit a 32 TiB ceiling for long.

### 2.4 Oracle features in use

| Field | Allowed IDs | Rules |
|---|---|---|
| `feature_dependencies` | `NONE_CONFIRMED` · `LIST_FEATURES` · `NOT_SURE` | `OP-FEATURE-GATE` |
| `oracle_features` | a list of the feature IDs in section 3 | `OP-FEATURE-*` |
| `plsql_volume` | `NONE_OR_LIGHT` · `MODERATE` · `HEAVY` · `VERY_HEAVY` · `NOT_SURE` | `OP-PLSQL`, `OP-RANK` |
| `app_tier_oracle` | `NONE_CONFIRMED` · `LIST_APP_TIER` · `NOT_SURE` | `OP-APP-TIER` |

`oracle_features` is only read when `feature_dependencies = LIST_FEATURES`. `NOT_SURE` holds the feature-dependent verdicts of
`pg_flex`, `pg_elastic`, `horizondb` and `pg_aks` at `unknown_requires_assessment` until a scan runs (`OP-FEATURE-GATE`). `pg_vm`
is broader and stays eligible, with the unknown recorded.

`plsql_volume` bands, in lines of PL/SQL code (comments and blank lines excluded): `NONE_OR_LIGHT` under 5,000;
`MODERATE` 5,000 to 50,000; `HEAVY` 50,000 to 250,000; `VERY_HEAVY` over 250,000. When a schema scan is available, the
skill fills this from the scan instead of asking.

`app_tier_oracle` names Oracle components around the database that do not migrate with it: Oracle Forms, Reports, APEX,
OBIEE, ODI, WebLogic, mod_plsql. They are application work, not database work, and the skill says so.

### 2.5 Migration constraints

| Field | Allowed IDs | Rules |
|---|---|---|
| `downtime` | `NEAR_ZERO` · `MINIMAL` · `OFFLINE` · `NOT_SURE` | `OP-METHOD-DATA`, `OP-DOWNTIME` |
| `network_bandwidth` | `GOOD_BANDWIDTH` · `LIMITED_WAN` · `VERY_LARGE_MULTI_TB` · `NOT_SURE` | `OP-METHOD-DATA`, `OP-SEED` |
| `private_connectivity` | `PRIVATE_LINK_READY` · `PUBLIC_ONLY` · `NOT_SURE` | `OP-ORACLE-FDW-PATH` |
| `converter_prereqs` | `FOUNDRY_AND_COPILOT_READY` · `FOUNDRY_OR_COPILOT_MISSING` · `NOT_SURE` | `OP-CONVERTER-GATE` |

`private_connectivity` decides whether `oracle_fdw` and a Data Factory self-hosted runtime can reach the Oracle listener. Change
capture is not asked about: Microsoft publishes no change-capture service for Oracle (`OP-SCOPE`), so there is no capture
product to gate. The plan still lists ARCHIVELOG mode, supplemental logging and a private path as what any capture product needs.

`converter_prereqs` covers what Microsoft's converter needs beyond the database: a Microsoft Foundry deployment of `gpt-5.2`
with more than 1,000,000 tokens per minute of quota, and a GitHub Copilot seat (Pro+, Business or Enterprise).

### 2.6 Evidence already in hand

| Field | Allowed IDs | Rules |
|---|---|---|
| `evidence` | a list of: `EFFORT_ESTIMATE` · `VSCODE_DISCOVERY` · `SCHEMA_SCAN` · `AWR_SIZING` · `NONE` | `OP-EVIDENCE` |

Each is recorded as a **claim to verify elsewhere**, never as proof. They do not raise `recommendationStatus` or
`confidence`: this skill reads no artefact from the user's estate, so it cannot confirm one. A `SCHEMA_SCAN` produced by
this repository's own `oracle-assess-schema` skill is the exception only in the sense that the skill may read it: it
supplies `plsql_volume` and `oracle_features`, and nothing else.

---

## 3. Oracle feature IDs

The values `oracle_features` may hold. Most of them are produced automatically by the schema scan, which maps its
construct IDs onto these (the mapping is the `featureId` column of [`feature-matrix.json`](feature-matrix.json)).

| ID | Means | Typical evidence |
|---|---|---|
| `RAC_WRITE_SCALE` | RAC used to scale writes across nodes | `topology = RAC` plus a throughput argument |
| `RAC_HA_ONLY` | RAC used only for availability | |
| `ADVANCED_QUEUING` | DBMS_AQ / DBMS_AQADM | `PKG-DBMS-AQ` |
| `JAVA_IN_DATABASE` | Java stored procedures, `LANGUAGE JAVA` | `PKG-JAVA` |
| `EXTERNAL_PROCEDURES_C` | C libraries called from the database | `PKG-EXTPROC` |
| `NETWORK_FROM_DATABASE` | UTL_HTTP, UTL_SMTP, UTL_TCP, UTL_MAIL | `PKG-UTL-NETWORK` |
| `FILE_ACCESS_FROM_DATABASE` | UTL_FILE and DIRECTORY objects | `PKG-UTL-FILE` |
| `SPATIAL_BASIC` | SDO_GEOMETRY, point and polygon operations | `PKG-SPATIAL` |
| `SPATIAL_ADVANCED` | Network, topology, georaster | `PKG-SPATIAL-ADVANCED` |
| `ORACLE_TEXT` | CONTAINS, CTX_ packages | `PKG-CTX` |
| `XML_SCHEMA_BASED` | XML DB, registered schemas, XMLType repository | `TYPE-XMLTYPE-SCHEMA` |
| `MULTIMEDIA` | ORDSYS types | `PKG-ORDSYS` |
| `VPD` | DBMS_RLS row policies | `SEC-VPD`, `SEC-VPD-CALL` |
| `LABEL_OR_VAULT` | Label Security, Database Vault, Data Redaction | `SEC-VAULT-OLS` |
| `FLASHBACK_USE` | Flashback query, versions, table | `SQL-FLASHBACK-QUERY` |
| `EDITION_BASED_REDEFINITION` | Editions | `PKG-EBR` |
| `DB_LINKS_TO_ORACLE` | Database links whose far end stays on Oracle | `DDL-DB-LINK` |
| `EXTERNAL_TABLES` | ORGANIZATION EXTERNAL | `DDL-EXTERNAL-TABLE` |
| `SCHEDULER_ADVANCED` | Chains, windows, job classes, event-based jobs | `PKG-DBMS-SCHEDULER` |
| `WEB_FROM_DATABASE` | PL/SQL web toolkit, APEX | `PKG-HTP-APEX` |
| `AUTONOMOUS_TRANSACTIONS` | PRAGMA AUTONOMOUS_TRANSACTION | `PLSQL-AUTONOMOUS-TXN` |
| `PACKAGE_STATE` | Package-level variables that live for the session | `PLSQL-PACKAGE-STATE` |
| `OBJECT_TYPE_INHERITANCE` | Object types with UNDER, member methods | `PLSQL-OBJECT-INHERITANCE` |
| `MV_FAST_REFRESH` | Fast-refresh or ON COMMIT materialized views | `DDL-MV-FAST-REFRESH` |
| `HEAVY_PARTITIONING` | Interval, reference, composite or global-index partitioning | `DDL-PARTITION-INTERVAL`, `DDL-SUBPARTITION`, `DDL-PARTITION-REFERENCE` |
| `COLUMN_ENCRYPTION` | Oracle TDE column encryption | `SEC-ENCRYPT-COLUMN` |
| `EXADATA_OFFLOAD` | Smart Scan, storage indexes, HCC that the workload relies on | measured, not scanned |

---

## 4. Asking rules

Each records a failure seen in a real session of the SQL Server advisor this repository is modelled on.

- **Never use a multi-select.** Single-selects, free text and typed values only.
- **Never let an empty answer carry meaning.** Ask the intent first (`None, confirmed` / `Let me list them` / `Not checked yet`).
- **Ask each question at most once.** If the answer comes back empty, or the user declines, do not re-ask it and never re-ask it in a stricter form.
- **An empty answer is `UNKNOWN`**, never `NONE_CONFIRMED`. Record it in `unknowns[]` and `evidenceRequired[]`, keep the recommendation `provisional`, and carry on.
- **Compact profile first.** If the user can supply a profile in prose, a JSON object, or a schema scan, take it, normalise it against this contract, show the normalised profile back, and ask only for the fields that are both missing and capable of changing a surviving candidate.
- **No identifiers in the output.** If the user supplies real server names, schema names or credentials, use them to answer but do not echo them into summaries, tables or the JSON. Placeholders keep the card shareable.

---

## 5. Normalised profile

What the skill shows back, and what `normalizedProfile` in the output carries. Every canonical field appears, with either an
ID or `UNKNOWN`. A field the interview never asked still appears, as `UNKNOWN`, so a reader can see what the skill thinks it
was told and what it assumed.

```json
{
  "scope": "SINGLE_DB",
  "source_location": "ON_PREM",
  "source_version": "ORA_19C",
  "topology": "SINGLE_INSTANCE",
  "app_changeability": "APP_LIMITED",
  "plsql_volume": "HEAVY",
  "oracle_features": ["AUTONOMOUS_TRANSACTIONS", "PACKAGE_STATE", "MV_FAST_REFRESH"],
  "largest_db_size": "UNDER_1_TB",
  "downtime": "MINIMAL",
  "availability_target": "HIGHEST_99_99",
  "region": "swedencentral",
  "preview_acceptable": "PREVIEW_REFUSED",
  "converter_prereqs": "NOT_SURE"
}
```
