/**
 * KPI-4's system writer, used by KPI-5 (auto values) and KPI-6 (formula
 * values): the only way a value gets `source` auto or formula. Nobody types
 * these (KPI_AUTO_READ_ONLY on PUT /kpi/values).
 *
 *   writeSystemValue(w)    insert or update one value (its own transaction, KPI lease held)
 *   removeSystemValue(r)   delete one when its source has gone (an emission row rejected, an input
 *                          no longer submitted)
 *
 * Both leave a locked period alone (`locked`), never touch a manual value with
 * the same key (`manual_value`), and audit every change (`kpi_value`,
 * `auto_refresh` / `formula_recompute` / `auto_removed` / `formula_removed`).
 * A write that changes nothing but the read time keeps the row as it is,
 * except that it clears a KPI_AUTO_STALE hold.
 */
import { AppDataSource } from "../../config/data-source";
import type { KpiPeriod } from "./period";
import { auditValue, holdKpiLease, lockedPeriod } from "./service";

type Row = Record<string, any>;

export type SystemSource = "auto" | "formula";

export interface SystemWrite {
  companyId: number;
  siteId: number | null;
  kpi: { id: number; code: string; canonical_unit: string | null };
  period: KpiPeriod;
  /** In the KPI's canonical unit; null only with a breakdown and no total (auto production in mixed units). */
  value: number | null;
  breakdown?: Record<string, number> | null;
  source: SystemSource;
  status: "approved" | "pending";
  /** What the value was read or calculated from; the time fields are `read_at` / `computed_at`. */
  snapshot: Record<string, unknown>;
  comment?: string | null;
}

export type WriteOutcome = { outcome: "created" | "updated" | "unchanged" | "locked" | "manual_value"; id: number | null };

const TIME_KEYS = new Set(["read_at", "computed_at"]);
const stable = (o: unknown): string =>
  JSON.stringify(o, (k, v) => (TIME_KEYS.has(k) ? undefined : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
const round6 = (v: number | null) => (v === null ? null : Number(v.toFixed(6)));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function writeSystemValue(w: SystemWrite): Promise<WriteOutcome> {
  return AppDataSource.transaction(async (m) => {
    await holdKpiLease(m, w.companyId);
    if (await lockedPeriod(m, w.companyId, w.siteId, w.period)) return { outcome: "locked", id: null };
    const value = round6(w.value);
    const breakdown = w.breakdown && Object.keys(w.breakdown).length ? w.breakdown : null;
    const existing: Row[] = await m.query(
      `SELECT * FROM kpi_value WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND kpi_definition_id = $3 AND period_start = $4 AND frequency = $5 FOR UPDATE`,
      [w.companyId, w.siteId, w.kpi.id, w.period.start, w.period.frequency],
    );
    const action = w.source === "auto" ? "auto_refresh" : "formula_recompute";
    if (!existing.length) {
      const rows: Row[] = await m.query(
        `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, value_text, unit, value_canonical, breakdown, source, status, is_estimate, comment, entered_by, auto_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $8, $10, $11, $12, false, $13, NULL, $14) RETURNING id`,
        [w.companyId, w.siteId, w.kpi.id, w.period.start, w.period.end, w.period.frequency, w.period.year_type, value, w.kpi.canonical_unit, breakdown ? JSON.stringify(breakdown) : null, w.source, w.status, w.comment ?? null, JSON.stringify(w.snapshot)],
      );
      const id = Number(rows[0].id);
      await auditValue(m, id, action, { value_canonical: { old: null, new: value }, breakdown: { old: null, new: breakdown }, status: { old: null, new: w.status } }, 0);
      return { outcome: "created", id };
    }
    const old = existing[0];
    const id = Number(old.id);
    if (old.source !== w.source) return { outcome: "manual_value", id };
    const changed: Record<string, { old: unknown; new: unknown }> = {};
    if (num(old.value_canonical) !== value) changed.value_canonical = { old: num(old.value_canonical), new: value };
    if (stable(old.breakdown ?? null) !== stable(breakdown)) changed.breakdown = { old: old.breakdown ?? null, new: breakdown };
    if (old.status !== w.status) changed.status = { old: old.status, new: w.status };
    if ((old.comment ?? null) !== (w.comment ?? null)) changed.comment = { old: old.comment ?? null, new: w.comment ?? null };
    const sameSource = stable(old.auto_snapshot ?? null) === stable(w.snapshot);
    if (!Object.keys(changed).length && sameSource) {
      if (old.checks) await m.query(`UPDATE kpi_value SET checks = NULL, auto_snapshot = $2 WHERE id = $1`, [id, JSON.stringify(w.snapshot)]);
      return { outcome: "unchanged", id };
    }
    await m.query(
      `UPDATE kpi_value SET value_numeric = $2, value_canonical = $2, unit = $3, breakdown = $4, status = $5, comment = $6, auto_snapshot = $7, checks = NULL, year_type = $8, updated_at = now() WHERE id = $1`,
      [id, value, w.kpi.canonical_unit, breakdown ? JSON.stringify(breakdown) : null, w.status, w.comment ?? null, JSON.stringify(w.snapshot), w.period.year_type],
    );
    if (Object.keys(changed).length) await auditValue(m, id, action, changed, 0);
    return { outcome: Object.keys(changed).length ? "updated" : "unchanged", id };
  });
}

export interface SystemRemove {
  companyId: number;
  siteId: number | null;
  kpiId: number;
  period: KpiPeriod;
  source: SystemSource;
}

export async function removeSystemValue(r: SystemRemove): Promise<"removed" | "absent" | "locked" | "manual_value"> {
  return AppDataSource.transaction(async (m) => {
    await holdKpiLease(m, r.companyId);
    const existing: Row[] = await m.query(
      `SELECT * FROM kpi_value WHERE company_id = $1 AND site_id IS NOT DISTINCT FROM $2 AND kpi_definition_id = $3 AND period_start = $4 AND frequency = $5 FOR UPDATE`,
      [r.companyId, r.siteId, r.kpiId, r.period.start, r.period.frequency],
    );
    if (!existing.length) return "absent";
    const old = existing[0];
    if (old.source !== r.source) return "manual_value";
    if (await lockedPeriod(m, r.companyId, r.siteId, r.period)) return "locked";
    await auditValue(m, Number(old.id), r.source === "auto" ? "auto_removed" : "formula_removed", { value_canonical: { old: num(old.value_canonical), new: null }, status: { old: old.status, new: null } }, 0);
    await m.query(`DELETE FROM kpi_value_evidence WHERE kpi_value_id = $1`, [old.id]);
    await m.query(`DELETE FROM kpi_value WHERE id = $1`, [old.id]);
    return "removed";
  });
}
