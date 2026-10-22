// #191 · widen the ids of the fastest-growing tables, and every column that stores them, from
// integer (max 2,147,483,647) to bigint:
//
//   emission.pk_id, emission.fera_linked_id, emission_document.emission_id, invoice.emission_id,
//   pcf_result.emission_ids_used (int[] → bigint[]), audit_log.id and entity_id, notification.id,
//   mcp_tool_call.id, import_plan_row.id, import_plan_match.id, report_ai_call.id, oauth_token.token_id
//
//   npm run migrate:bigint-ids
//
// Idempotent: a column that is already bigint (or bigint[]) is skipped, and so is a sequence that is
// already bigint, so a second run changes nothing. A table that doesn't exist is skipped
// (invoice is a restored-dump table with no entity: present on production, not in CI).
//
// Widening a column does not widen the sequence behind it (it would still stop at 2^31 − 1), so
// each id's sequence gets `ALTER SEQUENCE … AS bigint` too.
//
// The emission ids change together in one transaction (they reference each other); each log table
// has its own. A table's columns change in one ALTER TABLE, so the table is rewritten once.
// lock_timeout 10s: if the app holds a lock, the step fails instead of queueing every query behind it,
// and the next start retries. statement_timeout is lifted for the rewrite (production's pool sets 30s).
// Only table and column names are logged, never row data.
//
// Rollback: none needed. bigint holds every old value, and the app reads bigint as a number
// (src/config/pgTypes.ts), so the previous release runs on the widened columns.
import "reflect-metadata";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";

type Target = { table: string; column: string; array?: boolean; sequence?: boolean };

export const BIGINT_GROUPS: { name: string; targets: Target[] }[] = [
  {
    name: "emission ids",
    targets: [
      { table: "emission", column: "pk_id", sequence: true },
      { table: "emission", column: "fera_linked_id" },
      { table: "emission_document", column: "emission_id" },
      { table: "invoice", column: "emission_id" },
      { table: "pcf_result", column: "emission_ids_used", array: true },
      { table: "audit_log", column: "entity_id" },
    ],
  },
  { name: "audit_log", targets: [{ table: "audit_log", column: "id", sequence: true }] },
  { name: "notification", targets: [{ table: "notification", column: "id", sequence: true }] },
  { name: "mcp_tool_call", targets: [{ table: "mcp_tool_call", column: "id", sequence: true }] },
  { name: "import_plan_row", targets: [{ table: "import_plan_row", column: "id", sequence: true }] },
  { name: "import_plan_match", targets: [{ table: "import_plan_match", column: "id", sequence: true }] },
  { name: "report_ai_call", targets: [{ table: "report_ai_call", column: "id", sequence: true }] },
  { name: "oauth_token", targets: [{ table: "oauth_token", column: "token_id", sequence: true }] },
];

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The column's type name (int4, int8, _int4, _int8), or null when the table or column doesn't exist. */
async function columnType(m: EntityManager, t: Target): Promise<string | null> {
  const rows: { udt_name: string }[] = await m.query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [t.table, t.column],
  );
  return rows[0]?.udt_name ?? null;
}

type SavedView = { name: string; depth: number; create: string; after: string[] };

/**
 * Views that read a column being widened, and every view built on those, with what it takes to put
 * them back as they were: definition, options, grants, owner and comment. Postgres can't change a
 * column's type under a view, and restored production databases carry views no entity knows about
 * (emission_view, emission_view2 for reporting tools).
 */
async function dependentViews(m: EntityManager, cols: Target[]): Promise<SavedView[]> {
  if (!cols.length) return [];
  const rows: { name: string; relkind: string; depth: number; create: string; after: string[] }[] = await m.query(
    `WITH RECURSIVE target AS (
       SELECT a.attrelid, a.attnum
         FROM unnest($1::text[], $2::text[]) AS t(tbl, col)
         JOIN pg_attribute a ON a.attrelid = to_regclass(quote_ident(t.tbl)) AND a.attname = t.col
     ), dep AS (
       SELECT DISTINCT r.ev_class AS oid, 1 AS depth
         FROM target t
         JOIN pg_depend d ON d.refobjid = t.attrelid AND d.refobjsubid = t.attnum AND d.classid = 'pg_rewrite'::regclass
         JOIN pg_rewrite r ON r.oid = d.objid
        WHERE r.ev_class <> t.attrelid
       UNION
       SELECT DISTINCT r.ev_class, dep.depth + 1
         FROM dep
         JOIN pg_depend d ON d.refobjid = dep.oid AND d.classid = 'pg_rewrite'::regclass
         JOIN pg_rewrite r ON r.oid = d.objid
        WHERE r.ev_class <> dep.oid AND dep.depth < 20
     )
     SELECT c.oid::regclass::text AS name, c.relkind::text AS relkind, max(dep.depth)::int AS depth,
            format('CREATE VIEW %s%s AS %s', c.oid::regclass,
                   CASE WHEN c.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(c.reloptions, ', ') || ')' END,
                   pg_get_viewdef(c.oid)) AS create,
            array_remove(
              ARRAY(SELECT format('GRANT %s ON %s TO %s%s', g.privilege_type, c.oid::regclass,
                                  CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END,
                                  CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
                      FROM aclexplode(c.relacl) g WHERE g.grantee <> c.relowner)
              || CASE WHEN pg_get_userbyid(c.relowner) <> current_user AND pg_has_role(current_user, c.relowner, 'MEMBER')
                      THEN ARRAY[format('ALTER VIEW %s OWNER TO %s', c.oid::regclass, quote_ident(pg_get_userbyid(c.relowner)))]
                      ELSE ARRAY[]::text[] END
              || ARRAY[CASE WHEN obj_description(c.oid, 'pg_class') IS NOT NULL
                            THEN format('COMMENT ON VIEW %s IS %L', c.oid::regclass, obj_description(c.oid, 'pg_class')) END],
              NULL) AS after
       FROM dep JOIN pg_class c ON c.oid = dep.oid
      GROUP BY c.oid`,
    [cols.map((t) => t.table), cols.map((t) => t.column)],
  );
  const mat = rows.find((r) => r.relkind !== "v");
  if (mat) throw new Error(`${mat.name} is a materialized view on a column to widen; recreate it by hand, then rerun.`);
  return rows.map(({ name, depth, create, after }) => ({ name, depth, create, after }));
}

/** Widens one group in one transaction; returns the "table.column" names it changed. */
export async function widenGroup(m: EntityManager, targets: Target[]): Promise<string[]> {
  await m.query(`SET LOCAL lock_timeout = '10s'`);
  await m.query(`SET LOCAL statement_timeout = 0`);
  const changed: string[] = [];
  const byTable = new Map<string, Target[]>();
  for (const t of targets) {
    const type = await columnType(m, t);
    if (type === null) {
      console.log(`  ${t.table}.${t.column}: not in this database, skipped.`);
      continue;
    }
    if (type === "int8" || type === "_int8") continue;
    if (!byTable.has(t.table)) byTable.set(t.table, []);
    byTable.get(t.table)!.push(t);
  }
  // Views on these columns are taken down (deepest first) and put back unchanged after the widening,
  // inside this transaction: nobody ever sees them missing, and a failure puts everything back.
  const views = await dependentViews(m, [...byTable.values()].flat());
  for (const v of [...views].sort((a, b) => b.depth - a.depth)) {
    // data-loss-reviewed: a view holds no data; it is recreated from its saved definition below, in the same transaction
    await m.query(`DROP VIEW ${v.name}`);
  }
  for (const [table, cols] of byTable) {
    const clauses = cols.map((t) =>
      t.array
        // data-loss-reviewed: int[] to bigint[] widening, lossless (every int4 value is a valid int8)
        ? `ALTER COLUMN ${ident(t.column)} TYPE bigint[] USING ${ident(t.column)}::bigint[]`
        // data-loss-reviewed: int to bigint widening, lossless (every int4 value is a valid int8)
        : `ALTER COLUMN ${ident(t.column)} TYPE bigint`,
    );
    await m.query(`ALTER TABLE ${ident(table)} ${clauses.join(", ")}`);
    for (const t of cols) changed.push(`${t.table}.${t.column}`);
  }
  for (const v of [...views].sort((a, b) => a.depth - b.depth)) {
    await m.query(v.create);
    for (const sql of v.after) await m.query(sql);
    changed.push(`view ${v.name} recreated`);
  }
  for (const t of targets.filter((x) => x.sequence)) {
    const [seq]: { name: string | null; type: string | null }[] = await m.query(
      `SELECT s.seqrelid::regclass::text AS name, s.seqtypid::regtype::text AS type
         FROM pg_sequence s
        WHERE s.seqrelid = pg_get_serial_sequence($1, $2)::regclass`,
      [ident(t.table), t.column],
    );
    if (seq?.name && seq.type !== "bigint") {
      await m.query(`ALTER SEQUENCE ${seq.name} AS bigint`);
      changed.push(`${t.table}.${t.column} sequence`);
    }
  }
  return changed;
}

async function main() {
  await AppDataSource.initialize();
  try {
    for (const group of BIGINT_GROUPS) {
      const present = await AppDataSource.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [group.targets[0].table]);
      if (!present[0]?.present) {
        console.log(`${group.name}: table not in this database, skipped.`);
        continue;
      }
      const changed = await AppDataSource.transaction((m) => widenGroup(m, group.targets));
      console.log(changed.length ? `${group.name}: widened to bigint: ${changed.join(", ")}.` : `${group.name}: already bigint.`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
