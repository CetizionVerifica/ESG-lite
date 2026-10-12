/**
 * Emission write service (IM1): one function set computes and saves an
 * emission entry, for typed entries (createEmission) and every import path
 * (bulk upload, Claude). See CLAUDE.md in this folder.
 *
 *   prepareEntry  → resolve the factor, compute the total and the FERA twin
 *   insertEntry   → write parent (+ twin, linked both ways, + audit row)
 *   planRows      → EmissionWriter.planRows: ImportRow[] → PlannedRow[]
 *   insertRows    → EmissionWriter.insertRows for the ready rows of a plan
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { Emission } from "../../entities/Emission";
import { EmissionFactor } from "../../entities/EmissionFactor";
import { AuditLog } from "../../entities/AuditLog";
import { User } from "../../entities/User";
import { UserRole } from "../../types/type";
import { IMPORT_LIMITS } from "../../imports/limits";
import { ImportError, rowIssueSeverity, type RowIssueCode } from "../../imports/errors";
import type { ActivityMatch, ImportRow, PlannedRow, RowIssue, StrippedTotal } from "../../imports/contracts";
import type { BatchInfo, EmissionWriter, InsertResult, WriterContext } from "../../imports/writer";
import { ContextCache, type LoadedContext } from "./context";
import { CheckCache, findDuplicate, modeLockMessage, planIdentity, planModeConflicts } from "./checks";
import { computeTotal, factorSnapshot, feraTwinFor, type Computed, type EngineIssue, type FeraTwin } from "./compute";
import { planMatchFor, resolveActivity, suggestNames, targetYearFor, type ResolvedActivity } from "./resolve";
import { toStoredPeriod, type StoredPeriod } from "./period";

export { ContextCache } from "./context";
export { CheckCache, findDuplicate, modeLockMessage } from "./checks";
export { toStoredPeriod, monthsCovered, monthOf } from "./period";
export { targetYearFor } from "./resolve";
export { getConversionFactor, unitsMatchExact } from "./units";
export type { EngineIssue } from "./compute";

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

export interface EntryInput {
  site_id: number;
  category_id: number;
  /** The form's values, with `emission_category` naming the activity. */
  activity_data: Record<string, any>;
  activity_data_unit: string | null | undefined;
  period: StoredPeriod;
  extra_data?: Record<string, any>;
}

export interface PreparedEntry {
  input: EntryInput;
  /** Null when the entry names no activity or unit (typed entries may; total stays 0). */
  factor: EmissionFactor | null;
  computed: Computed | null;
  fera: FeraTwin | null;
}

export type PrepareResult = { ok: true; entry: PreparedEntry } | { ok: false; issue: EngineIssue };

/**
 * Resolve the factor, compute the total and decide the FERA twin, without
 * writing. Scope, period validation, mode lock and duplicates are the
 * caller's (createEmission keeps its own responses; planRows adds issues).
 */
export const prepareEntry = async (ctx: LoadedContext, checks: CheckCache, input: EntryInput): Promise<PrepareResult> => {
  const { activity_data } = input;
  let unit = input.activity_data_unit;
  let factor: EmissionFactor | null = null;
  let computed: Computed | null = null;
  const targetYear = targetYearFor(input.period.date_of_reporting);

  if (activity_data.emission_category && unit) {
    const match = ctx.factors.find(activity_data.emission_category, targetYear);
    if (!match) {
      return {
        ok: false,
        issue: { code: "NO_FACTOR_FOR_YEAR", message: `No emission factor found for emission category "${activity_data.emission_category}" (year ${targetYear})` },
      };
    }
    factor = match.factor;
    const result = computeTotal(ctx, factor, activity_data, unit);
    if (!result.ok) return result;
    computed = result.computed;
    unit = computed.activity_unit;
  }

  let fera: FeraTwin | null = null;
  if (activity_data.emission_category) {
    fera = feraTwinFor(ctx, activity_data.emission_category, activity_data, unit, targetYear);
    if (fera) {
      const conflict = await checks.modeLock(input.site_id, fera.category_id, input.period);
      if (conflict) fera = null; // the twin respects the lock on its own category; skipped, never fatal
    }
  }

  return { ok: true, entry: { input: { ...input, activity_data_unit: unit }, factor, computed, fera } };
};

export interface AuditInfo {
  changed_by: number;
  reason: string;
}

/** Writes the parent row, its FERA twin (linked both ways) and audit rows, inside `tx`. */
export const insertEntry = async (
  tx: EntityManager,
  userId: number | null | undefined,
  entry: PreparedEntry,
  batch: BatchInfo | null,
  audit: AuditInfo | null,
): Promise<{ emission: Emission; fera: Emission | null }> => {
  const repo = tx.getRepository(Emission);
  const { input } = entry;
  const base = {
    site: { site_id: input.site_id },
    category: { category_id: input.category_id },
    unit: "tCO2e",
    date_of_reporting: new Date(input.period.date_of_reporting),
    reporting_period: input.period.reporting_period,
    year_type: input.period.year_type,
    activity_data_unit: (input.activity_data_unit || null) as any,
    created_by: userId ? ({ user_id: userId } as any) : null,
    upload_batch_id: batch?.upload_batch_id ?? undefined,
  };
  const emission = repo.create({
    ...base,
    activity_data: input.activity_data,
    extra_data: input.extra_data || {},
    total_emission: entry.computed?.total ?? 0,
    emission_factor_snapshot: entry.factor ? factorSnapshot(entry.factor) : null,
  });
  await repo.save(emission);

  let fera: Emission | null = null;
  if (entry.fera) {
    fera = repo.create({
      ...base,
      category: { category_id: entry.fera.category_id },
      activity_data: input.activity_data,
      total_emission: entry.fera.total,
      fera_linked_id: emission.pk_id,
      emission_factor_snapshot: factorSnapshot(entry.fera.factor),
    });
    await repo.save(fera);
    emission.fera_linked_id = fera.pk_id;
    await repo.save(emission);
  }

  if (audit) {
    const auditRepo = tx.getRepository(AuditLog);
    for (const row of [emission, fera]) {
      if (!row) continue;
      await auditRepo.save(
        auditRepo.create({
          entity_type: "emission",
          entity_id: row.pk_id,
          action: "import",
          changed_fields: { upload_batch_id: { old: null, new: batch?.upload_batch_id ?? null }, status: { old: null, new: row.status ?? "pending" } },
          reason: audit.reason,
          changed_by: { user_id: audit.changed_by } as any,
        }),
      );
    }
  }
  return { emission, fera };
};

// ---------------------------------------------------------------------------
// Plans (EmissionWriter)
// ---------------------------------------------------------------------------

export interface PlanOptions {
  planMatches: ActivityMatch[];
  /** Rows that carried total-like keys (from parseImportRows), for CLIENT_TOTAL_IGNORED. */
  stripped?: StrippedTotal[];
  /** Duplicate scope against saved rows: imports match by month (default), typed entries by date. */
  duplicateScope?: "month" | "date";
}

const issue = (code: RowIssueCode, message: string, field?: string): RowIssue => ({ code, severity: rowIssueSeverity(code), message, field });

/** Builds the stored activity_data of an import row. */
const activityDataFor = (row: ImportRow, factorName: string): Record<string, any> => {
  const data: Record<string, any> = { ...(row.fields ?? {}) };
  data.emission_category = factorName;
  if (row.activity_value !== undefined) data.activity_value = String(row.activity_value);
  return data;
};

const PLACE_FIELD = /^(origin|destination|from|to)(?![a-z])|place|city|location/i;
const DISTANCE_FIELD = /distance|km/i;

interface RowWork {
  row: ImportRow;
  period: StoredPeriod;
  ctx: LoadedContext;
  resolved: ResolvedActivity;
  activity_data: Record<string, any>;
  issues: RowIssue[];
}

interface DetailedPlan {
  planned: PlannedRow[];
  /** The prepared entry of each ready row (null for issue rows), for insertRows. */
  entries: Array<PreparedEntry | null>;
}

/**
 * planRows: every row gets a PlannedRow; errors make it an `issue` row,
 * warnings ride on ready rows. Nothing is written.
 */
export const planRows = async (writerCtx: WriterContext, rows: ImportRow[], opts: PlanOptions, manager: EntityManager = AppDataSource.manager): Promise<PlannedRow[]> =>
  (await planRowsDetailed(writerCtx, rows, opts, manager)).planned;

const planRowsDetailed = async (writerCtx: WriterContext, rows: ImportRow[], opts: PlanOptions, manager: EntityManager): Promise<DetailedPlan> => {
  const contexts = new ContextCache(manager);
  const checks = new CheckCache(manager);
  const strippedByRef = new Map((opts.stripped ?? []).map((s) => [s.row_ref, s.keys]));
  const scope = opts.duplicateScope ?? "month";
  const allowedSites = new Set(writerCtx.allowed_site_ids);

  const work: Array<RowWork | null> = [];
  const planned: PlannedRow[] = [];
  const entries: Array<PreparedEntry | null> = rows.map(() => null);

  // Pass 1: scope, period, activity, totals.
  for (const row of rows) {
    const issues: RowIssue[] = [];
    const stripped = strippedByRef.get(row.row_ref);
    if (stripped?.length) issues.push(issue("CLIENT_TOTAL_IGNORED", `The row's ${stripped.join(", ")} ${stripped.length === 1 ? "was" : "were"} ignored; ESGLite calculates every total.`));

    const site = await contexts.site(row.site_id);
    if (!site || !allowedSites.has(row.site_id) || (site.company?.company_id ?? null) !== writerCtx.company_id) {
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue("SITE_NOT_ALLOWED", "This site is unknown or not in your scope.", "site_id")], input: row });
      work.push(null);
      continue;
    }
    const ctx = await contexts.context(row.site_id, row.category_id);
    const userCats = writerCtx.allowed_category_ids_by_site[row.site_id];
    if (!ctx.assigned || (writerCtx.role === UserRole.USER && userCats && !userCats.includes(row.category_id))) {
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue("CATEGORY_NOT_ASSIGNED", `Category ${row.category_id} is not assigned to ${site.name}${ctx.assigned ? " for you" : ""}.`, "category_id")], input: row });
      work.push(null);
      continue;
    }
    const periodResult = toStoredPeriod(row.period, row.category_id);
    if (!periodResult.ok) {
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue("PERIOD_INVALID", periodResult.message, "period")], input: row });
      work.push(null);
      continue;
    }
    const period = periodResult.period;
    const targetYear = targetYearFor(period.date_of_reporting);

    const resolved = resolveActivity(ctx.factors, ctx.mappings, planMatchFor(opts.planMatches, row.site_id, row.category_id, row.activity_name), row.activity_name, targetYear);
    if (!resolved) {
      const suggestions = suggestNames(ctx.factors, row.activity_name, IMPORT_LIMITS.ACTIVITY_SUGGESTIONS);
      const hint = suggestions.length ? ` Did you mean: ${suggestions.join("; ")}?` : ` No emission factors are loaded for this category at ${site.name}.`;
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue("UNKNOWN_ACTIVITY", `"${row.activity_name}" matches no emission factor or mapping.${hint}`, "activity_name")], input: row });
      work.push(null);
      continue;
    }
    if (resolved.match.fallback_year) {
      issues.push(issue("FACTOR_FALLBACK_YEAR", `No ${targetYear} factor for "${resolved.match.factor.emission_category_name}"; the ${resolved.match.factor.year} factor was used.`));
    }

    if (row.activity_value === undefined && !ctx.spec) {
      const keys = Object.keys(row.fields ?? {});
      const code: RowIssueCode = keys.some((k) => PLACE_FIELD.test(k)) && !keys.some((k) => DISTANCE_FIELD.test(k)) ? "DISTANCE_REQUIRED" : !ctx.hasForm ? "NO_FORM" : "MISSING_VALUE";
      const message =
        code === "DISTANCE_REQUIRED"
          ? "This row gives places but no distance. Send the distance in km as activity_value."
          : code === "NO_FORM"
            ? `${ctx.category_name} at ${site.name} has no data-entry form, so only activity_value can be imported. Send the quantity as activity_value.`
            : "activity_value is required for this category.";
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue(code, message, "activity_value")], input: row });
      work.push(null);
      continue;
    }
    if (row.activity_value !== undefined && row.activity_value <= 0) {
      planned.push({ row_ref: row.row_ref, state: "issue", issues: [...issues, issue("NON_POSITIVE_VALUE", "activity_value must be greater than 0.", "activity_value")], input: row });
      work.push(null);
      continue;
    }

    work.push({ row, period, ctx, resolved, activity_data: activityDataFor(row, resolved.match.factor.emission_category_name || resolved.name), issues });
    planned.push({ row_ref: row.row_ref, state: "ready", issues, input: row });
  }

  // Pass 2: in-plan mode conflicts and duplicates.
  const planConflicts = planModeConflicts(work.map((w) => (w ? { site_id: w.row.site_id, category_id: w.row.category_id, period: w.period } : null)));
  const seenIdentity = new Map<string, string>();

  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    if (!w) continue;
    const { row, period, ctx, resolved, activity_data, issues } = w;
    const errors: RowIssue[] = [];

    const planConflict = planConflicts.get(i);
    if (planConflict) errors.push(issue("MODE_LOCK", planConflict, "period"));
    else {
      const conflict = await checks.modeLock(row.site_id, row.category_id, period);
      if (conflict) errors.push(issue("MODE_LOCK", modeLockMessage(conflict, period.reporting_period), "period"));
    }

    // Totals (unit, spec fields).
    const result = await prepareEntry(ctx, checks, { site_id: row.site_id, category_id: row.category_id, activity_data, activity_data_unit: row.activity_unit, period });
    if (!result.ok) {
      errors.push(issue(result.issue.code, result.issue.message, result.issue.field));
    } else if (!result.entry.computed || result.entry.computed.activityValue <= 0) {
      errors.push(issue("MISSING_VALUE", "No quantity greater than 0 was found for this row.", "activity_value"));
    }

    // Duplicates: saved rows (monthly only, as a yearly batch has many rows per activity) and this plan.
    if (period.reporting_period === "monthly") {
      const existing = await checks.existingRows(row.site_id, row.category_id, period.date_of_reporting, scope);
      const dup = findDuplicate(existing, activity_data, ctx.spec);
      if (dup) errors.push(issue("DUPLICATE_EXISTING", `${site_name(ctx, dup)} already has "${activity_data.emission_category}" for ${period.date_of_reporting.slice(0, 7)} (entry ${dup.pk_id}, ${dup.status}).`));
    }
    const identity = planIdentity(row.site_id, row.category_id, period, activity_data.emission_category, activity_data, ctx.spec);
    const first = seenIdentity.get(identity);
    if (first) issues.push(issue("DUPLICATE_IN_PLAN", `Same site, category, period and activity as row ${first}.`));
    else seenIdentity.set(identity, row.row_ref);

    const all = [...issues, ...errors];
    if (errors.length) {
      planned[i] = { row_ref: row.row_ref, state: "issue", issues: all, input: row };
      continue;
    }
    const entry = (result as { ok: true; entry: PreparedEntry }).entry;
    const computed = entry.computed!;
    entries[i] = entry;
    planned[i] = {
      row_ref: row.row_ref,
      state: "ready",
      issues: all,
      input: row,
      result: {
        activity: { name: row.activity_name, matched_by: resolved.matched_by, factor_name: entry.factor!.emission_category_name },
        factor: {
          emission_factor_id: entry.factor!.emission_factor_id,
          year: entry.factor!.year,
          value: Number(entry.factor!.factor_value),
          unit: entry.factor!.denominator_unit,
          fallback_year: resolved.match.fallback_year,
        },
        activity_value: computed.activityValue,
        activity_unit: computed.activity_unit,
        conversion: computed.conversion,
        total_tco2e: computed.total,
        fera: entry.fera ? { category_id: entry.fera.category_id, total_tco2e: entry.fera.total } : undefined,
        reporting_date: period.date_of_reporting,
        reporting_period: period.reporting_period,
        year_type: period.year_type ?? undefined,
      },
    };
  }
  return { planned, entries };
};

const site_name = (ctx: LoadedContext, e: Emission): string => e.site?.name ?? `Site ${ctx.site_id}`;

const CHANNEL_LABEL: Record<BatchInfo["channel"], string> = { mcp: "Claude", bulk_upload: "Bulk upload", api: "API" };

/**
 * insertRows: writes the ready rows of a plan inside `tx`. The rows are
 * planned again, inside the transaction and under the caller's context, so
 * scope, mode lock, duplicates and totals are checked against what the
 * database holds now and never trusted from an earlier plan. A row whose
 * site or category is outside the caller's scope throws IMPORT_FORBIDDEN;
 * one that no longer computes (new duplicate, mode lock, factor gone) or whose
 * factor or total differs from the confirmed plan (reason PLAN_STALE) throws
 * IMPORT_PLAN_HAS_ISSUES with its row_ref. Either way the transaction rolls
 * back and nothing is written.
 */
export const insertRows = async (tx: EntityManager, writerCtx: WriterContext, rows: PlannedRow[], batch: BatchInfo): Promise<InsertResult> => {
  const ready = rows.filter((p) => p.state === "ready" && p.result);
  if (!ready.length) return { inserted: 0, fera_inserted: 0, ids: [] };

  // The plan's activity resolution is kept as a plan match (a confirmed match must not re-resolve differently); the
  // stale check below catches a factor that changed under it. `stripped` is not needed (warnings only) and the
  // duplicate scope is the plans' default, month.
  const planMatches: ActivityMatch[] = ready.map((p) => ({ site_id: p.input.site_id, category_id: p.input.category_id, sheet_name: p.input.activity_name, factor_name: p.result!.activity.factor_name }));
  const { planned, entries } = await planRowsDetailed(writerCtx, ready.map((p) => p.input), { planMatches }, tx);

  const forbidden = planned.filter((p) => p.issues.some((i) => i.code === "SITE_NOT_ALLOWED" || i.code === "CATEGORY_NOT_ASSIGNED")).map((p) => p.row_ref);
  if (forbidden.length) throw new ImportError("IMPORT_FORBIDDEN", { row_refs: forbidden });
  const blocked = planned.filter((p) => p.state !== "ready").map((p) => p.row_ref);
  if (blocked.length) throw new ImportError("IMPORT_PLAN_HAS_ISSUES", { row_refs: blocked });

  // What the user confirmed is what gets stored: a factor edited or re-resolved
  // (a mapping now pointing elsewhere) since the plan changes the total, so the
  // commit stops and the plan has to be made and confirmed again.
  const stale = planned
    .filter((p, i) => {
      const r = ready[i].result!;
      const now = p.result!;
      return now.factor.emission_factor_id !== r.factor.emission_factor_id || now.total_tco2e !== r.total_tco2e || (now.fera?.total_tco2e ?? null) !== (r.fera?.total_tco2e ?? null);
    })
    .map((p) => p.row_ref);
  if (stale.length) {
    throw new ImportError("IMPORT_PLAN_HAS_ISSUES", { row_refs: stale, reason: "PLAN_STALE" }, "The factor or total of some rows changed since the plan was made. Plan the rows again and confirm the new totals.");
  }

  const user = await tx.getRepository(User).findOne({ where: { user_id: writerCtx.user_id } });
  const who = user ? [user.name, user.last_name].filter(Boolean).join(" ") : `user ${writerCtx.user_id}`;
  const audit: AuditInfo = { changed_by: writerCtx.user_id, reason: `Imported via ${CHANNEL_LABEL[batch.channel]} by ${who} (batch ${batch.upload_batch_id}, ${batch.source_name})` };

  let inserted = 0;
  let fera_inserted = 0;
  const ids: number[] = [];
  for (let i = 0; i < ready.length; i++) {
    const row = ready[i].input;
    const entry = entries[i];
    if (!entry || !entry.factor) throw new ImportError("IMPORT_PLAN_HAS_ISSUES", { row_refs: [row.row_ref] });
    const extra_data: Record<string, any> = { import: { channel: batch.channel, row_ref: row.row_ref } };
    if (row.notes) extra_data.notes = row.notes;
    const { emission, fera } = await insertEntry(tx, writerCtx.user_id, { ...entry, input: { ...entry.input, extra_data } }, batch, audit);
    inserted += 1;
    ids.push(emission.pk_id);
    if (fera) {
      fera_inserted += 1;
      ids.push(fera.pk_id);
    }
  }
  return { inserted, fera_inserted, ids };
};

export const emissionWriter: EmissionWriter = {
  planRows: (ctx, rows, opts) => planRows(ctx, rows, opts),
  insertRows,
};

export default emissionWriter;
