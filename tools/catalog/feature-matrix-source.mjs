// Authoring source for reference/feature-matrix.json.
//
// One row per Oracle feature an estate can depend on, one cell per PostgreSQL target. A cell says how
// that target carries the feature, so the eligibility rules read a table instead of an if-chain.
//
//   native      the target carries it with the same behaviour
//   workaround  the target carries it through an extension or a pattern, with caveats a person checks
//   redesign    no equivalent. The application or the data model changes. This is the expensive state
//   unsupported the target cannot carry it at all, even with a redesign
//   unknown     the vendor documentation does not say. Never read as native
//
// `sources` ids resolve in reference/sources.json. A cell with no source is the author's judgement
// and says so in `note`; the test suite counts them.

const S = {
  fsExt: 'ms-fs-extensions-versions',
  fsLimits: 'ms-fs-limits',
  fsAccess: 'ms-fs-access-control',
  fsExtCons: 'ms-fs-extensions-considerations',
  fsMvu: 'ms-fs-mvu',
  hzExt: 'ms-horizondb-extensions',
  convLimits: 'ms-oracle-schema-limitations',
  orafce: 'orafce-readme',
  elastic: 'ms-fs-elastic-limits',
};

const TARGETS = ['pg_flex', 'pg_elastic', 'horizondb', 'pg_vm', 'pg_aks'];
const rows = [];

/** cells: [flex, elastic, horizondb, vm, aks], each [state, note, sources?] or a bare state. */
function f(featureId, label, scan, cells) {
  const targets = {};
  TARGETS.forEach((t, i) => {
    const c = cells[i];
    const [state, note, sources] = Array.isArray(c) ? c : [c];
    targets[t] = { state, note: note || null, sources: sources || [] };
  });
  rows.push({ featureId, label, scanConstructs: scan, targets });
}

const SELF = 'The operator can install any extension and any procedural language. They also own the risk';

f('RAC_WRITE_SCALE', 'RAC used to scale writes across nodes', [], [
  ['workaround', 'One writer. Scale up inside the ceilings; reads scale out through replicas'],
  ['redesign', 'Writes scale by sharding on a distribution key, which changes the data model', [S.elastic]],
  ['workaround', 'One writer, up to 192 vCores per replica; shared-storage read replicas', ['ms-horizondb-compute']],
  ['workaround', 'One writer. Scale up the VM'],
  ['workaround', 'One writer. Scale up the node'],
]);
f('RAC_HA_ONLY', 'RAC used only for availability', [], [
  ['native', 'Zone-redundant HA, 99.99% SLA, typically 60 to 120 seconds to fail over', ['ms-fs-reliability']],
  ['native', 'Per-node HA', [S.elastic]],
  ['native', 'Zone-redundant replicas. No published SLA', ['ms-horizondb-overview']],
  ['workaround', 'The operator builds and tests HA'],
  ['native', 'CloudNativePG runs one primary and two replicas across zones', ['ms-aks-cnpg']],
]);
f('ADVANCED_QUEUING', 'Advanced Queuing (DBMS_AQ)', ['PKG-DBMS-AQ'], [
  ['redesign', 'Azure Service Bus, or a queue table read with SKIP LOCKED. Producers and consumers change', [S.convLimits]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['workaround', `A queue extension such as pgmq. ${SELF}`],
  ['workaround', `A queue extension such as pgmq. ${SELF}`],
]);
f('JAVA_IN_DATABASE', 'Java stored procedures', ['PKG-JAVA'], [
  ['redesign', 'There is no in-database Java runtime. The logic moves to the application tier', [S.convLimits]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['workaround', `PL/Java. ${SELF}`],
  ['workaround', `PL/Java in a custom image. ${SELF}`],
]);
f('EXTERNAL_PROCEDURES_C', 'External procedures (C libraries)', ['PKG-EXTPROC'], [
  ['redesign', 'Untrusted C code is not allowed on a managed service', [S.fsAccess]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['workaround', `A C extension. ${SELF}`],
  ['workaround', `A C extension in a custom image. ${SELF}`],
]);
f('NETWORK_FROM_DATABASE', 'UTL_HTTP, UTL_SMTP, UTL_TCP, UTL_MAIL', ['PKG-UTL-NETWORK'], [
  ['redesign', 'The http extension and the untrusted languages are absent from the allow-list. Azure Functions, Logic Apps or the application tier', [S.fsExt]],
  ['redesign', 'As flexible server'],
  ['redesign', 'The extension list has no http or untrusted language', [S.hzExt]],
  ['workaround', `The http extension or plpython3u. ${SELF}`],
  ['workaround', `The http extension or plpython3u. ${SELF}`],
]);
f('FILE_ACCESS_FROM_DATABASE', 'UTL_FILE and DIRECTORY objects', ['PKG-UTL-FILE'], [
  ['workaround', 'azure_storage reads and writes blobs. There is no server file system to write to', [S.fsExt]],
  ['workaround', 'As flexible server'],
  ['workaround', 'azure_storage 1.9 is present', [S.hzExt]],
  ['native', 'orafce UTL_FILE, or server-side file access, on a disk the operator owns', [S.orafce]],
  ['workaround', 'A mounted volume or object storage'],
]);
f('SPATIAL_BASIC', 'Oracle Spatial: geometry types and operators', ['PKG-SPATIAL'], [
  ['workaround', 'PostGIS. Geometry maps. Spatial operators and index hints do not', [S.fsExt]],
  ['workaround', 'PostGIS on an elastic cluster is not confirmed', []],
  ['workaround', 'PostGIS 3.5.2 is present', [S.hzExt]],
  ['workaround', 'PostGIS'],
  ['workaround', 'PostGIS'],
]);
f('SPATIAL_ADVANCED', 'Oracle Spatial: network, topology, georaster', ['PKG-SPATIAL-ADVANCED'], [
  ['redesign', 'pgRouting and postgis_topology exist but do not reproduce the Oracle network and topology data models', [S.fsMvu]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'The same data-model gap on a self-managed server'],
  ['redesign', 'The same data-model gap'],
]);
f('ORACLE_TEXT', 'Oracle Text (CONTAINS, CTX_)', ['PKG-CTX'], [
  ['workaround', 'tsvector full-text search and pg_trgm. Ranking and stemming differ, so results differ', [S.fsExt]],
  ['workaround', 'As flexible server'],
  ['workaround', 'As flexible server'],
  ['workaround', 'tsvector and pg_trgm'],
  ['workaround', 'tsvector and pg_trgm'],
]);
f('XML_SCHEMA_BASED', 'XML DB, registered schemas, XMLType repository', ['TYPE-XMLTYPE-SCHEMA'], [
  ['redesign', 'XQuery and schema-based XML are not supported. Validate in the application tier', [S.convLimits]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('MULTIMEDIA', 'Oracle Multimedia (ORDSYS)', ['PKG-ORDSYS'], [
  ['redesign', 'Store media in Blob Storage and metadata in tables'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('VPD', 'Virtual Private Database (DBMS_RLS)', ['SEC-VPD', 'SEC-VPD-CALL'], [
  ['workaround', 'Row level security with CREATE POLICY. Policy functions become USING expressions', [S.convLimits]],
  ['workaround', 'As flexible server'],
  ['workaround', 'As flexible server'],
  ['workaround', 'Row level security'],
  ['workaround', 'Row level security'],
]);
f('LABEL_OR_VAULT', 'Label Security, Database Vault, Data Redaction', ['SEC-VAULT-OLS'], [
  ['redesign', 'No equivalent. Row level security, views and roles replace the design'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('FLASHBACK_USE', 'Flashback query, versions, table', ['SQL-FLASHBACK-QUERY'], [
  ['redesign', 'No AS OF. Point-in-time restore creates a new server. temporal_tables is on the allow-list for row history', [S.fsExt, S.convLimits]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('EDITION_BASED_REDEFINITION', 'Edition-based redefinition', ['PKG-EBR'], [
  ['redesign', 'Blue/green deployment and expand-contract migrations', [S.convLimits]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('DB_LINKS_TO_ORACLE', 'Database links whose far end stays on Oracle', ['DDL-DB-LINK', 'DDL-DB-LINK-OBJECT'], [
  ['workaround', 'oracle_fdw 1.2 is on the allow-list. A foreign table is not a database link: no distributed transactions, different pushdown', [S.fsExt, 'ms-fs-release-notes']],
  ['unknown', 'oracle_fdw on an elastic cluster is not confirmed'],
  ['redesign', 'oracle_fdw is absent from the HorizonDB extension list', [S.hzExt]],
  ['workaround', `oracle_fdw. ${SELF}`],
  ['workaround', `oracle_fdw in a custom image. ${SELF}`],
]);
f('EXTERNAL_TABLES', 'External tables (ORGANIZATION EXTERNAL)', ['DDL-EXTERNAL-TABLE'], [
  ['workaround', 'azure_storage foreign reads. file_fdw is not on the allow-list', [S.fsExt]],
  ['workaround', 'As flexible server'],
  ['workaround', 'azure_storage is present', [S.hzExt]],
  ['native', 'file_fdw against a disk the operator owns'],
  ['workaround', 'A mounted volume or object storage'],
]);
f('SCHEDULER_ADVANCED', 'DBMS_SCHEDULER chains, windows, job classes, event-based jobs', ['PKG-DBMS-SCHEDULER'], [
  ['redesign', 'pg_cron runs a schedule and nothing more. Chains and events move to Azure Automation, Logic Apps or Functions', [S.fsExt]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['workaround', 'pg_cron or pgAgent, plus an external orchestrator for chains'],
  ['workaround', 'A Kubernetes CronJob plus an orchestrator'],
]);
f('WEB_FROM_DATABASE', 'PL/SQL web toolkit and APEX', ['PKG-HTP-APEX'], [
  ['redesign', 'These render pages from the database. The page tier is rebuilt'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('AUTONOMOUS_TRANSACTIONS', 'PRAGMA AUTONOMOUS_TRANSACTION', ['PLSQL-AUTONOMOUS-TXN'], [
  ['workaround', 'dblink self-connection, or move the write outside the transaction. The converter emits the dblink form', [S.fsExt, 'ms-oracle-schema-conversion']],
  ['workaround', 'As flexible server'],
  ['workaround', 'dblink 1.2 is present', [S.hzExt]],
  ['workaround', 'dblink'],
  ['workaround', 'dblink'],
]);
f('PACKAGE_STATE', 'Package-level variables that live for the session', ['PLSQL-PACKAGE-STATE'], [
  ['workaround', 'Session settings (set_config), or session_variable, which blocks in-place major version upgrade', [S.fsExt, S.fsMvu]],
  ['workaround', 'As flexible server'],
  ['workaround', 'Session settings. session_variable is absent', [S.hzExt]],
  ['workaround', 'Session settings, or session_variable'],
  ['workaround', 'Session settings'],
]);
f('OBJECT_TYPE_INHERITANCE', 'Object types with UNDER and member methods', ['PLSQL-OBJECT-INHERITANCE', 'PLSQL-OBJECT-TYPE'], [
  ['redesign', 'Composite types carry no methods and no substitutability. Flatten with a discriminator', ['ms-oracle-schema-conversion']],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);
f('MV_FAST_REFRESH', 'Fast-refresh or ON COMMIT materialized views', ['DDL-MV-FAST-REFRESH'], [
  ['redesign', 'Core PostgreSQL refreshes completely. pg_ivm is on the allow-list and may cover simple views; test each', [S.fsExt]],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['workaround', 'pg_ivm, or complete refresh on a schedule'],
  ['workaround', 'pg_ivm, or complete refresh on a schedule'],
]);
f('HEAVY_PARTITIONING', 'Interval, reference, composite or global-index partitioning', ['DDL-PARTITION-INTERVAL', 'DDL-SUBPARTITION', 'DDL-PARTITION-REFERENCE', 'DDL-GLOBAL-INDEX'], [
  ['workaround', 'Declarative partitioning with pg_partman for interval. Reference partitioning and global indexes have no equivalent, so the key is redesigned', [S.fsExt]],
  ['redesign', 'Partitioning and distribution interact. Redesign the key', [S.elastic]],
  ['workaround', 'pg_partman is present', [S.hzExt]],
  ['workaround', 'Declarative partitioning with pg_partman'],
  ['workaround', 'Declarative partitioning with pg_partman'],
]);
f('COLUMN_ENCRYPTION', 'Oracle TDE column encryption', ['SEC-ENCRYPT-COLUMN'], [
  ['workaround', 'pgcrypto or application-level encryption. Storage is encrypted by the service. Legacy algorithms are removed by default', ['ms-fs-encryption', S.fsExtCons]],
  ['workaround', 'As flexible server'],
  ['workaround', 'As flexible server'],
  ['workaround', 'pgcrypto or a TDE-capable distribution'],
  ['workaround', 'pgcrypto'],
]);
f('EXADATA_OFFLOAD', 'Workload relies on Smart Scan, storage indexes or Hybrid Columnar Compression', [], [
  ['redesign', 'No storage offload. Queries need indexes, partitioning and tuning. Measure before committing'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
  ['redesign', 'As flexible server'],
]);

export const FEATURES = rows;
export const FEATURE_TARGETS = TARGETS;
