/**
 * Historical sheets through the emission write service (S3-4): the P27
 * historical import, the legacy free-text upload and `seed:emissions`. Every
 * row's factor, unit check and totals come from the engine, as a typed
 * entry's do (prepareEntry / insertEntry), never from the sheet's own
 * emissionFactor or calculatedEmission. A row whose units don't line up or
 * that has no factor for the site is a skipped row with the engine's reason.
 */
import type { EntityManager } from "typeorm";
import { Emission } from "../entities/Emission";
import { CheckCache, ContextCache, insertEntry, prepareEntry, type AuditInfo, type PreparedEntry } from "./emissionWrite";
import { activityDataFor, rowPeriod, type EngineResult, type HistoricalPlan, type HistoricalRow } from "./historicalImport";
import { refreshChecksSafely } from "../scope3/review/service";
import { lockedSiteMonths, siteMonthOf } from "../scope3/review/periodLock";

/** Stored as `extra_data.import.channel` on every row these paths write. */
export const HISTORICAL_CHANNEL = "historical";

/** The engine's answer for every row with a recognised month (row number → result), and the prepared entries to insert. */
export const engineResults = async (
  m: EntityManager,
  rows: HistoricalRow[],
  siteId: number,
  categoryId: number,
): Promise<{ results: Map<number, EngineResult>; entries: Map<number, PreparedEntry> }> => {
  const ctx = await new ContextCache(m).context(siteId, categoryId);
  const checks = new CheckCache(m);
  const results = new Map<number, EngineResult>();
  const entries = new Map<number, PreparedEntry>();
  // S3-15 part 2: months closed for the site (review workflow v2) are skipped, never written.
  const closed = new Set(
    (await lockedSiteMonths(m, rows.map((r) => { const p = rowPeriod(r); return p ? siteMonthOf(siteId, `${p}-15`) : null; }))).map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const row = i + 1;
    const period = rowPeriod(r);
    if (!period) continue;
    if (closed.has(period)) {
      results.set(row, { ok: false, reason: "This month is closed (PERIOD_LOCKED). Reopen it with a reason before importing into it." });
      continue;
    }
    // The quantity is the sheet's activity column, nothing else: a blank, 0 or
    // non-numeric activity is skipped here, so the engine's quantity pick never
    // falls through to spend or the sheet's own emissionFactor (S3-4).
    const quantity = parseFloat(String(r.activity ?? "").trim());
    if (!Number.isFinite(quantity) || quantity <= 0) {
      results.set(row, { ok: false, reason: "No activity greater than 0." });
      continue;
    }
    const prepared = await prepareEntry(ctx, checks, {
      site_id: siteId,
      category_id: categoryId,
      activity_data: activityDataFor(r),
      activity_data_unit: String(r.unit ?? "").trim() || null,
      // The 15th of the month, as the old import stored it.
      period: { date_of_reporting: `${period}-15`, reporting_period: "monthly", year_type: null },
      extra_data: { import: { channel: HISTORICAL_CHANNEL, row_ref: `Row ${row}` } },
    });
    if (!prepared.ok) {
      results.set(row, { ok: false, reason: prepared.issue.message });
      continue;
    }
    const { entry } = prepared;
    if (!entry.factor || !entry.computed) {
      const reason = String(r.fuelType ?? "").trim() ? "No unit: the activity's unit is needed to apply the site's emission factor." : "No fuel type: there is no emission factor to apply.";
      results.set(row, { ok: false, reason });
      continue;
    }
    if (!(entry.computed.activityValue > 0)) {
      results.set(row, { ok: false, reason: "No activity greater than 0." });
      continue;
    }
    results.set(row, { ok: true, total: entry.computed.total, ...(entry.warnings.length ? { warnings: entry.warnings.map((w) => w.message) } : {}) });
    entries.set(row, entry);
  }
  return { results, entries };
};

/**
 * Writes the rows the plan imports, each with its FERA twin and audit rows
 * (insertEntry), inside `m`. The sheet's notes become the review comment.
 * @returns the number of rows written (twins not counted).
 */
export const insertHistoricalRows = async (
  m: EntityManager,
  plan: HistoricalPlan,
  entries: ReadonlyMap<number, PreparedEntry>,
  rows: HistoricalRow[],
  audit: AuditInfo | null,
  createdBy: (row: HistoricalRow) => number | null = () => null,
): Promise<number> => {
  let inserted = 0;
  const ids: number[] = [];
  for (const p of plan.rows) {
    if (p.status !== "import") continue;
    const entry = entries.get(p.row);
    if (!entry) continue;
    const row = rows[p.row - 1];
    const { emission, fera } = await insertEntry(m, createdBy(row), entry, null, audit, { deferChecks: true });
    const notes = row.notes == null ? "" : String(row.notes).trim();
    if (notes) await m.getRepository(Emission).update(emission.pk_id, { review_comment: notes });
    ids.push(emission.pk_id, ...(fera ? [fera.pk_id] : []));
    inserted++;
  }
  // The review checks (S3-15) once for the whole sheet, as insertRows does.
  await refreshChecksSafely(m, ids);
  return inserted;
};
