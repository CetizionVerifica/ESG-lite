// #191 · widen the fast-growing ids from integer to bigint. An integer id stops at
// 2,147,483,647; the log tables are never purged and every id burnt by a rollback
// or an ON CONFLICT counts, so they are widened now, while the tables are small.
//
//   npm run migrate:bigint-ids
//
// npm start runs it (scripts/migrate-all.cjs) before the API starts, after every
// script that creates these tables (its package.json entry follows theirs). Idempotent:
// each column is read from information_schema first and skipped when it is
// already bigint, so a second run changes nothing. Lossless: every integer fits
// a bigint, and the values are not touched.
//
// For a serial id the sequence is moved to AS bigint too: widening the column
// leaves its sequence AS integer, which would still stop at 2^31 - 1.
//
// Widening rewrites the table and its indexes under an ACCESS EXCLUSIVE lock
// (seconds at today's sizes). Each group is one transaction that takes all its
// locks first, each with lock_timeout 10s, so traffic never queues behind it for long.
// A group that can't get its locks is retried; if it still can't, the run fails
// and the API doesn't start rather than run with entities and schema apart.
// The emission ids (emission.pk_id and every column that stores one) are one
// group, so they always agree; each log table is a group of its own.
// The build that serves traffic meanwhile must have #199: older code matches
// pcf_result.emission_ids_used with `&& int[]`, which fails on bigint[].
//
// Logs table and column names only, never row data.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export type BigintColumn = { table: string; column: string; array?: true };
export type BigintGroup = { name: string; columns: BigintColumn[] };

export const BIGINT_ID_GROUPS: BigintGroup[] = [
  {
    name: "emission ids",
    columns: [
      { table: "emission", column: "pk_id" },
      { table: "emission", column: "fera_linked_id" },
      { table: "emission_document", column: "emission_id" },
      { table: "pcf_result", column: "emission_ids_used", array: true },
      { table: "audit_log", column: "id" },
      { table: "audit_log", column: "entity_id" },
      // Legacy table from the restored dump (no entity, no DDL in any repo);
      // site delete clears it. Skipped where the column doesn't exist.
      { table: "invoice", column: "emission_id" },
    ],
  },
  { name: "notification", columns: [{ table: "notification", column: "id" }] },
  { name: "mcp_tool_call", columns: [{ table: "mcp_tool_call", column: "id" }] },
  { name: "import_plan_row", columns: [{ table: "import_plan_row", column: "id" }] },
  { name: "import_plan_match", columns: [{ table: "import_plan_match", column: "id" }] },
  { name: "report_ai_call", columns: [{ table: "report_ai_call", column: "id" }] },
  { name: "oauth_token", columns: [{ table: "oauth_token", column: "token_id" }] },
];

const LOCK_TIMEOUT = "10s";
const ATTEMPTS = 5;
const RETRY_WAIT_MS = 5000;
// lock_not_available (lock_timeout) and deadlock_detected: someone else held a lock; try again.
const RETRYABLE = new Set(["55P03", "40P01"]);
const BIGINT_MAX = "9223372036854775807";

type Querier = { query: (sql: string, params?: unknown[]) => Promise<any[]> };

export type ColumnState = BigintColumn & {
  found: boolean;
  isBigint: boolean;
  sequence: string | null; // the sequence behind a serial id, as regclass text
  sequenceIsBigint: boolean; // AS bigint with the bigint maximum
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Where each column stands now: missing, still integer, or already bigint (and its sequence). */
export async function inspect(db: Querier, columns: BigintColumn[]): Promise<ColumnState[]> {
  const out: ColumnState[] = [];
  for (const c of columns) {
    const [row] = await db.query(
      `SELECT data_type, udt_name, column_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
      [c.table, c.column],
    );
    if (!row) {
      out.push({ ...c, found: false, isBigint: false, sequence: null, sequenceIsBigint: true });
      continue;
    }
    const type = c.array ? row.udt_name : row.data_type;
    const [wide, narrow] = c.array ? [["_int8"], ["_int2", "_int4"]] : [["bigint"], ["smallint", "integer"]];
    if (!wide.includes(type) && !narrow.includes(type)) {
      throw new Error(`${c.table}.${c.column} is ${type}, not an integer type; not widened`);
    }
    let sequence: string | null = null;
    let sequenceIsBigint = true;
    if (!c.array) {
      const [seq] = await db.query(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [ident(c.table), c.column]);
      // A restored dump can keep the nextval() default without the OWNED BY link.
      sequence = seq?.seq ?? /^nextval\('(.+)'::regclass\)$/.exec(row.column_default || "")?.[1] ?? null;
      if (sequence) {
        const [s] = await db.query(
          `SELECT format_type(seqtypid, NULL) AS type, seqmax::text AS max FROM pg_sequence WHERE seqrelid = $1::regclass`,
          [sequence],
        );
        sequenceIsBigint = s?.type === "bigint" && s?.max === BIGINT_MAX;
      }
    }
    out.push({ ...c, found: true, isBigint: wide.includes(type), sequence, sequenceIsBigint });
  }
  return out;
}

export const pending = (states: ColumnState[]) => states.filter((s) => s.found && (!s.isBigint || !s.sequenceIsBigint));

/** The statements that widen what `inspect` found still narrow: one ALTER TABLE per table, then the sequences. */
export function widenStatements(states: ColumnState[]): string[] {
  const byTable = new Map<string, string[]>();
  for (const s of states) {
    if (!s.found || s.isBigint) continue;
    const clause = s.array
      ? `ALTER COLUMN ${ident(s.column)} TYPE bigint[] USING ${ident(s.column)}::bigint[]` // data-loss-reviewed: int to bigint widening, lossless
      : `ALTER COLUMN ${ident(s.column)} TYPE bigint`; // data-loss-reviewed: int to bigint widening, lossless
    byTable.set(s.table, [...(byTable.get(s.table) || []), clause]);
  }
  const statements = [...byTable].map(([table, clauses]) => `ALTER TABLE ${ident(table)} ${clauses.join(", ")}`);
  for (const s of states) {
    if (s.found && s.sequence && !s.sequenceIsBigint) statements.push(`ALTER SEQUENCE ${s.sequence} AS bigint NO MAXVALUE`);
  }
  return statements;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function widenGroup(group: BigintGroup): Promise<void> {
  const before = await inspect(AppDataSource, group.columns);
  for (const s of before.filter((x) => !x.found)) console.log(`${group.name}: ${s.table}.${s.column} not found, skipped.`);
  if (pending(before).length === 0) {
    console.log(`${group.name}: already bigint.`);
    return;
  }
  const tables = [...new Set(pending(before).map((s) => s.table))].sort();
  for (let attempt = 1; ; attempt++) {
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      await runner.query(`SET LOCAL statement_timeout = 0`);
      await runner.query(`LOCK TABLE ${tables.map(ident).join(", ")} IN ACCESS EXCLUSIVE MODE`);
      // Read again under the locks: another instance may have widened it meanwhile.
      const states = await inspect(runner, group.columns);
      for (const sql of widenStatements(states)) await runner.query(sql);
      await runner.commitTransaction();
      const done = pending(states).map((s) => `${s.table}.${s.column}`);
      console.log(`${group.name}: widened to bigint: ${done.length ? done.join(", ") : "nothing left to do"}.`);
      return;
    } catch (err: any) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      if (!RETRYABLE.has(err?.code) || attempt >= ATTEMPTS) throw err;
      console.log(`${group.name}: tables busy (${err.code}), attempt ${attempt} of ${ATTEMPTS}; retrying in ${RETRY_WAIT_MS / 1000}s.`);
      await sleep(RETRY_WAIT_MS);
    } finally {
      await runner.release();
    }
  }
}

async function main() {
  await AppDataSource.initialize();
  try {
    for (const group of BIGINT_ID_GROUPS) await widenGroup(group);
    const left = pending(await inspect(AppDataSource, BIGINT_ID_GROUPS.flatMap((g) => g.columns)));
    if (left.length) throw new Error(`still not bigint: ${left.map((s) => `${s.table}.${s.column}`).join(", ")}`);
    console.log("#191 bigint ids present.");
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
