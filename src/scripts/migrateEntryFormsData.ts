// SE-5 · Move existing forms to the simple-entry model (ESG-lite_FE docs/simple-entry, SE-5 spec;
// what changes per form: src/forms/migrateForms.ts).
//
//   npm run migrate:entry-forms-data              (migrate-all runs it on every start)
//   npm run migrate:entry-forms-data -- --dry-run lists what it would change, changes nothing
//
// Only column_config rows (and the "Record type" library column) change; no emission row is
// written. Before committing, every saved row of each changed form is calculated with the old and
// the new form, in memory: any difference rolls the whole run back and logs the form ids. The script
// always exits 0 (migrate-all stops at the first failure, which would keep the API from starting);
// the next start tries again. Listed after the migrations that write the standard Scope 3 forms.
import "reflect-metadata";
import type { DataSource, EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { CheckCache, ContextCache, prepareEntry } from "../services/emissionWrite";
import { type FormPlan, type FormToMigrate, planFormMigration, QUESTION_COLUMN } from "../forms/migrateForms";

const LOCK = "se-5:migrate-entry-forms-data";

/** Thrown inside the transaction to roll it back. */
class Rollback extends Error {
  constructor(
    readonly reason: "totals_changed" | "dry_run",
    readonly forms: number[],
  ) {
    super(reason);
  }
}

export interface MigrationReport {
  changed: Array<{ form_id: number; change: FormPlan["change"] }>;
  skipped: Array<{ form_id: number; reason: string }>;
  /** Forms whose rows would calculate differently: nothing was written. */
  rolledBack: number[];
  dryRun: boolean;
  rows_checked: number;
}

const ymd = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Every saved row of the forms' site × category pairs, calculated with the forms as they are in `tx` now. */
async function calculateRows(tx: EntityManager, pairs: Array<{ form_id: number; site_id: number; category_id: number }>): Promise<Map<number, Map<number, string>>> {
  const contexts = new ContextCache(tx);
  const checks = new CheckCache(tx);
  const out = new Map<number, Map<number, string>>();
  for (const p of pairs) {
    const rows: Array<Record<string, any>> = await tx.query(
      `SELECT pk_id, activity_data, activity_data_unit, date_of_reporting, reporting_period, year_type, extra_data, fx, method, supplier_id, proxy, emission_factor_snapshot
         FROM emission WHERE site_id = $1 AND category_id = $2 ORDER BY pk_id`,
      [p.site_id, p.category_id],
    );
    const ctx = await contexts.context(p.site_id, p.category_id);
    const results = new Map<number, string>();
    for (const r of rows) {
      const yearly = r.reporting_period === "yearly";
      const supplierRow = r.method === "supplier_specific" || r.method === "hybrid";
      const prepared = await prepareEntry(ctx, checks, {
        site_id: p.site_id,
        category_id: p.category_id,
        activity_data: { ...(r.activity_data ?? {}) },
        activity_data_unit: r.activity_data_unit,
        period: { date_of_reporting: ymd(r.date_of_reporting), reporting_period: yearly ? "yearly" : "monthly", year_type: yearly ? (r.year_type ?? null) : null },
        extra_data: r.extra_data ?? {},
        storedFx: r.fx ?? null,
        proxy: r.proxy ?? null,
        method_source: "caller",
        // As a recalculation does (emission.controller recalculateEntry): a supplier row keeps its supplier and figure.
        ...(supplierRow ? { method: r.method, supplier_id: r.supplier_id ?? null, supplier_factor_id: Number(r.emission_factor_snapshot?.supplier_factor_id) || null } : {}),
      });
      results.set(r.pk_id, prepared.ok ? `ok ${prepared.entry.computed?.total_kgco2e ?? "none"}` : `refused ${prepared.issue.code}`);
    }
    out.set(p.form_id, results);
  }
  return out;
}

/** The forms in a shape the planner reads, with their category's GHG number and units. */
async function loadForms(tx: EntityManager): Promise<Array<FormToMigrate & { site_id: number; category_id: number }>> {
  return tx.query(
    `SELECT cc.pk_id, cc.site_id, cc.category_id, c.ghg_category, cc.column_options, cc.extra_fields, cc.calculation, cc.method_options, cc.method_by_choice, cc.field_settings,
            COALESCE((SELECT json_agg(json_build_object('pk_id', col.pk_id, 'column_name', col.column_name, 'column_type', col.column_type) ORDER BY col.pk_id)
                        FROM column_config_columns x JOIN column_entity col ON col.pk_id = x.column_id WHERE x.column_config_id = cc.pk_id), '[]'::json) AS columns,
            COALESCE((SELECT json_agg(u.unit_name) FROM unit u WHERE u.site_id = cc.site_id AND u.category_id = cc.category_id), '[]'::json) AS units
       FROM column_config cc JOIN category c ON c.category_id = cc.category_id
      ORDER BY cc.pk_id`,
  );
}

/** The library's "Record type" select column, created when a form needs it and none exists. */
async function questionColumn(tx: EntityManager, create: boolean): Promise<{ pk_id: number; column_name: string } | null> {
  const [found] = await tx.query(`SELECT pk_id, column_name, column_type FROM column_entity WHERE lower(column_name) = lower($1) ORDER BY pk_id LIMIT 1`, [QUESTION_COLUMN]);
  if (found) return found.column_type === "select" ? { pk_id: found.pk_id, column_name: found.column_name } : null;
  if (!create) return { pk_id: -1, column_name: QUESTION_COLUMN };
  const [made] = await tx.query(`INSERT INTO column_entity (column_name, column_type) VALUES ($1, 'select') RETURNING pk_id, column_name`, [QUESTION_COLUMN]);
  return made;
}

async function applyPlan(tx: EntityManager, plan: FormPlan, questionId: number | null) {
  const cols = Object.keys(plan.set) as Array<keyof FormPlan["set"]>;
  if (cols.length) {
    const sets = cols.map((c, i) => `"${c}" = $${i + 2}::jsonb`).join(", ");
    await tx.query(`UPDATE column_config SET ${sets} WHERE pk_id = $1`, [plan.form_id, ...cols.map((c) => JSON.stringify(plan.set[c] ?? null))]);
  }
  if (plan.addQuestion && questionId) {
    await tx.query(`INSERT INTO column_config_columns (column_config_id, column_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [plan.form_id, questionId]);
  }
}

/** The whole run, in one transaction. */
export async function migrateEntryFormsData(ds: DataSource, opts: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  const report: MigrationReport = { changed: [], skipped: [], rolledBack: [], dryRun: !!opts.dryRun, rows_checked: 0 };
  try {
    await ds.transaction(async (tx) => {
      // One run at a time when several instances start together.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK]);
      const forms = await loadForms(tx);
      // The planner needs the question column's id; resolve it (without creating) first.
      let question = await questionColumn(tx, false);
      const planned: Array<{ plan: FormPlan; site_id: number; category_id: number }> = [];
      for (const f of forms) {
        const r = planFormMigration(f, question);
        if (!r) continue;
        if ("skip" in r) report.skipped.push({ form_id: f.pk_id, reason: r.skip });
        else planned.push({ plan: r.plan, site_id: f.site_id, category_id: f.category_id });
      }
      if (!planned.length) return;

      const pairs = planned.map((p) => ({ form_id: p.plan.form_id, site_id: p.site_id, category_id: p.category_id }));
      const before = await calculateRows(tx, pairs);

      if (planned.some((p) => p.plan.addQuestion) && question?.pk_id === -1) {
        question = await questionColumn(tx, true);
        // Re-plan with the real id (the column didn't exist yet).
        for (const p of planned) {
          const f = forms.find((x) => x.pk_id === p.plan.form_id)!;
          const r = planFormMigration(f, question);
          if (r && "plan" in r) p.plan = r.plan;
        }
      }
      for (const p of planned) await applyPlan(tx, p.plan, question?.pk_id ?? null);

      const after = await calculateRows(tx, pairs);
      const differ: number[] = [];
      for (const { form_id } of pairs) {
        const a = before.get(form_id) ?? new Map();
        const b = after.get(form_id) ?? new Map();
        report.rows_checked += a.size;
        if (a.size !== b.size || [...a].some(([id, v]) => b.get(id) !== v)) differ.push(form_id);
      }
      report.changed = planned.map((p) => ({ form_id: p.plan.form_id, change: p.plan.change }));
      if (differ.length) throw new Rollback("totals_changed", differ);
      if (opts.dryRun) throw new Rollback("dry_run", report.changed.map((c) => c.form_id));
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
    if (err.reason === "totals_changed") {
      report.rolledBack = err.forms;
      report.changed = [];
    }
  }
  return report;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  try {
    await AppDataSource.initialize();
    const r = await migrateEntryFormsData(AppDataSource, { dryRun });
    if (r.rolledBack.length) {
      console.warn(`[SE-5] WARNING: form(s) ${r.rolledBack.join(", ")} would calculate saved rows differently; nothing was changed. The next start tries again.`);
    } else if (dryRun) {
      console.log(`[SE-5] dry run: would change ${r.changed.length} form(s)${r.changed.length ? ": " + r.changed.map((c) => `${c.form_id} (${c.change})`).join(", ") : ""}; ${r.rows_checked} row(s) checked, none would move.`);
    } else {
      console.log(`[SE-5] ${r.changed.length} form(s) moved to the simple-entry model${r.changed.length ? ": " + r.changed.map((c) => `${c.form_id} (${c.change})`).join(", ") : ""}; ${r.rows_checked} saved row(s) calculate the same.`);
    }
    if (r.skipped.length) console.warn(`[SE-5] left as they are: ${r.skipped.map((s) => `${s.form_id} (${s.reason})`).join("; ")}`);
  } catch (err) {
    // Never stop the API from starting: report and try again next time.
    console.warn(`[SE-5] WARNING: migrate:entry-forms-data didn't run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy().catch(() => undefined);
  }
}

if (require.main === module) {
  void main().then(() => {
    // Exit 0 once everything has closed (exiting while a handle closes trips libuv on Windows);
    // whatever the engine's modules leave open can't hold the start up for more than a moment.
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
