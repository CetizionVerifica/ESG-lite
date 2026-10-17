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
import { CheckCache, findDuplicate, isLowConfidenceAiMatch, modeLockMessage, planIdentity, planModeConflicts } from "./checks";
import { computeTotal, factorSnapshot, feraGap, feraTwinFor, type Computed, type EngineIssue, type FeraTwin } from "./compute";
import { feraFactorTypeWarning, tdLossTwinFor, wttDoubleCountWarning } from "./methods/fera";
import { estimatedDistanceWarning, paidByMismatchWarning } from "./transportWarnings";
import { planMatchFor, resolveActivity, suggestNames, targetYearFor, type ResolvedActivity } from "./resolve";
import { toStoredPeriod, type StoredPeriod } from "./period";
import { refreshChecksSafely } from "../../scope3/review/service";
import { autoDq, dataTypeFor } from "../../scope3/dq/defaults";
import { manualDqFrom, methodAllowedForForm, type ManualDqInput } from "../../scope3/dq/input";
import { SCOPE3_ERRORS } from "../../scope3/contracts/errors";
import { MethodSchema, methodLabel, type Method } from "../../scope3/contracts/ghgCategory";
import { ROW_METHOD_COLUMN } from "../calculationSpec";
import { isSpendRow, rowAsksForSpend, spendInputOf } from "../../scope3/spend/inputs";
import type { EmissionFx, SpendQuote } from "../../scope3/spend/types";
import type { Proxy } from "../../scope3/contracts/schemas";
import { surveyProxy } from "../../scope3/screening/proxyRows";
import {
  loadSupplier,
  parseHybridLines,
  pickFacility,
  pickSupplierFactor,
  type HybridLine,
  type LoadedSupplier,
  type SupplierEngineInput,
} from "../../scope3/suppliers/engineInput";

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
  /**
   * S3-3: how the row was calculated, whether its figure is an estimate, and a
   * data quality judged by hand. The same three fields on every channel
   * (`src/scope3/dq/input.ts`); the engine refuses a method the form does not
   * offer, so no channel can store one.
   */
  method?: Method | null;
  is_estimate?: boolean;
  dq?: ManualDqInput | null;
  /** S3-5: the row's saved `fx`, so a recalculation with the same currency and date reuses its rate. */
  storedFx?: EmissionFx | null;
  /** S3-12: how an estimated row was made (`emission.proxy`, ProxySchema); set by src/scope3/screening and survey rows only. */
  proxy?: Proxy | null;
  /**
   * S3-6: the supplier the goods came from (one of the site's company), and
   * for the supplier-specific method the figure to use when the supplier has
   * several. Hybrid rows carry their input lines in `extra_data.inputs` and,
   * for economic allocation, what was paid in `extra_data.purchased_value`.
   */
  supplier_id?: number | null;
  supplier_factor_id?: number | null;
}

export interface PreparedEntry {
  input: EntryInput;
  /** Null when the entry names no activity or unit (typed entries may; total stays 0). */
  factor: EmissionFactor | null;
  computed: Computed | null;
  fera: FeraTwin | null;
  /** S3-7: the Category 3 T&D-loss twin of a Scope 2 row (3c), linked to the parent one way. */
  tdLoss: FeraTwin | null;
  /**
   * Never block (01-contracts §7): FACTOR_FALLBACK_YEAR, FERA_FACTOR_MISSING (S3-4),
   * FACTOR_TYPE_MISMATCH, WTT_ALREADY_IN_FACTOR (S3-7). Typed entries return them too.
   */
  warnings: EngineIssue[];
  /** When FERA applies but no 3a/3b twin was made: why (an edit puts it on the twin it can't recalculate). */
  feraSkipped?: string;
  /** S3-3: the site's country, so a twin's data quality can be scored where the twin is written. */
  site_country?: string | null;
  /** S3-6: the supplier the row is linked to (checked to be the site's company's), or null. */
  supplier_id?: number | null;
}

export type PrepareResult = { ok: true; entry: PreparedEntry } | { ok: false; issue: EngineIssue };

/**
 * Resolve the factor, compute the total and decide the FERA twin, without
 * writing. Scope, period validation, mode lock and duplicates are the
 * caller's (createEmission keeps its own responses; planRows adds issues).
 */
/**
 * The year a row is reported in, for the S3-3 data quality time rule. Not
 * `targetYearFor`, which is this year minus one because that is the factor
 * year convention; comparing a factor against that would shift every time
 * score by a year.
 */
export const reportingYearFor = (dateOfReporting: string | Date): number =>
  typeof dateOfReporting === "string"
    ? parseInt(dateOfReporting.substring(0, 4), 10)
    : new Date(dateOfReporting).getUTCFullYear();

/**
 * S3-3 for a FERA or T&D-loss twin. A twin is always a Scope 3 row (Cat 3),
 * calculated as the activity figure times a published factor, which is the
 * average-data method. Its quality is read from its own factor, not the
 * parent's.
 */
const twinQuality = (siteCountry: string | null | undefined, factor: EmissionFactor, dateOfReporting: string | Date) => {
  const method: Method = "average_data";
  return {
    method,
    dq: autoDq({
      method,
      factor: { geography: factor.geography, year: factor.year, factor_type: factor.factor_type },
      siteCountry,
      reportingYear: reportingYearFor(dateOfReporting),
    }),
    data_type: dataTypeFor({ method }),
  };
};

type SupplierPrep = { ok: true; supplier: LoadedSupplier | null; engine: SupplierEngineInput | null; warnings: EngineIssue[] } | { ok: false; issue: EngineIssue };

const supplierIssue = (code: RowIssueCode, message: string, field: string): SupplierPrep => ({ ok: false, issue: { code, message, field } });

/**
 * S3-6: loads the row's supplier (only ever one of the site's company) and,
 * for the supplier-specific and hybrid methods, the figures the engine needs:
 * the supplier factor to use, or the facility data and the resolved input
 * lines. The maths stays in `methods/supplier.ts` and `methods/hybrid.ts`.
 */
const prepareSupplier = async (ctx: LoadedContext, checks: CheckCache, input: EntryInput, method: Method | null, targetYear: number): Promise<SupplierPrep> => {
  const wanted = input.supplier_id ?? null;
  const supplierMethod = method === "supplier_specific" || method === "hybrid";
  let supplier: LoadedSupplier | null = null;
  if (wanted !== null) {
    supplier = ctx.company_id ? await loadSupplier(checks.manager, ctx.company_id, Number(wanted)) : null;
    // Another company's supplier reads exactly like one that doesn't exist.
    if (!supplier) return supplierIssue("FIELD_INVALID", "This supplier wasn't found for this company.", "supplier_id");
  }
  if (!supplierMethod) return { ok: true, supplier, engine: null, warnings: [] };
  if (!supplier) {
    return supplierIssue("FIELD_REQUIRED", `Choose the supplier to use "${methodLabel(method)}".`, "supplier_id");
  }

  const reportingYear = reportingYearFor(input.period.date_of_reporting);
  if (method === "supplier_specific") {
    const pick = pickSupplierFactor(supplier.factors, reportingYear, input.activity_data.emission_category, input.supplier_factor_id ?? null);
    if (!pick.ok) {
      switch (pick.reason) {
        case "ambiguous":
          return supplierIssue("FIELD_REQUIRED", "This supplier has figures for several items. Choose which one this purchase is.", "supplier_factor_id");
        case "future_year":
          return supplierIssue("FIELD_INVALID", `That supplier figure is from after ${reportingYear}, so it can't be used for this period.`, "supplier_factor_id");
        case "none_for_year":
          return supplierIssue("NO_FACTOR_FOR_YEAR", `This supplier has no figure from ${reportingYear} or earlier. Request one or use an average.`, "supplier_factor_id");
        default:
          return input.supplier_factor_id
            ? supplierIssue("FIELD_INVALID", "That figure isn't one of this supplier's.", "supplier_factor_id")
            : supplierIssue("NO_FACTOR_FOR_YEAR", "No figure from this supplier yet. Request one or use an average.", "supplier_factor_id");
      }
    }
    return { ok: true, supplier, engine: { supplier_id: supplier.supplier_id, country: supplier.country, factor: pick.factor }, warnings: [] };
  }

  // Hybrid: input lines × the factors of this site × category, and the facility data.
  const extra = input.extra_data ?? {};
  const parsed = parseHybridLines(extra.inputs);
  if (!parsed.ok) return supplierIssue("FIELD_INVALID", parsed.message, parsed.field);
  const warnings: EngineIssue[] = [];
  const lines: HybridLine[] = [];
  for (let i = 0; i < parsed.lines.length; i++) {
    const line = parsed.lines[i];
    const match = ctx.factors.find(line.name, targetYear);
    if (!match) {
      return supplierIssue("NO_FACTOR_FOR_YEAR", `Input line ${i + 1}: no emission factor named "${line.name}" for this category (year ${targetYear}).`, `extra_data.inputs[${i}].name`);
    }
    if (match.fallback_year) {
      warnings.push({ code: "FACTOR_FALLBACK_YEAR", message: `No ${targetYear} factor for "${match.factor.emission_category_name}"; the ${match.factor.year} factor was used.` });
    }
    lines.push({ ...line, factor: match.factor });
  }
  let purchasedValue: number | null = null;
  if (extra.purchased_value !== undefined && extra.purchased_value !== null && extra.purchased_value !== "") {
    purchasedValue = Number(extra.purchased_value);
    if (!Number.isFinite(purchasedValue) || purchasedValue <= 0) return supplierIssue("FIELD_INVALID", "What was paid must be a number greater than 0.", "extra_data.purchased_value");
  }
  return {
    ok: true,
    supplier,
    engine: {
      supplier_id: supplier.supplier_id,
      country: supplier.country,
      facility: pickFacility(supplier.facilities, reportingYear),
      lines,
      purchased_value: purchasedValue,
    },
    warnings,
  };
};

/** A valid method key in `activity_data["@method"]`, or null (S3-3). */
const rowMethodOf = (activity_data: Record<string, any>): Method | null => {
  const parsed = MethodSchema.safeParse(String(activity_data?.[ROW_METHOD_COLUMN] ?? "").trim());
  return parsed.success && parsed.data !== "unknown" ? parsed.data : null;
};

export const prepareEntry = async (ctx: LoadedContext, checks: CheckCache, input: EntryInput): Promise<PrepareResult> => {
  const { activity_data } = input;
  // An entry without a unit is in the form's unit only when the form has exactly one (S3-4).
  let unit = input.activity_data_unit || (ctx.formUnits?.length === 1 ? ctx.formUnits[0] : input.activity_data_unit);
  let factor: EmissionFactor | null = null;
  let computed: Computed | null = null;
  const warnings: EngineIssue[] = [];
  const targetYear = targetYearFor(input.period.date_of_reporting);

  // S3-3: the method the row names: its `method`, else `activity_data["@method"]`
  // (S3-9 forms and rows sent before rows had a method). A key ESGLite doesn't
  // know in "@method" is left to the spec, as before.
  const named = input.method ?? rowMethodOf(activity_data);

  // S3-3: the form decides which methods its category offers. Checked here so
  // typed entries, bulk upload, smart import and MCP all refuse the same ones.
  if (!methodAllowedForForm(named, ctx.method_options)) {
    const offered = (ctx.method_options ?? []).map((m) => methodLabel(m)).join(", ");
    return {
      ok: false,
      issue: {
        code: "METHOD_NOT_ALLOWED",
        message: `${SCOPE3_ERRORS.METHOD_NOT_ALLOWED.message}${offered ? ` This form offers: ${offered}.` : ""}`,
        field: "method",
      },
    };
  }
  // S3-6: supplier-specific and hybrid are real methods. A row gets one when it
  // names it (`method` or `@method`), or when the form offers one first and
  // the row names a supplier. A form defaulting to one, on a row naming no
  // supplier, is calculated (and recorded) as average data, as it was before
  // S3-6, so no saved total moves.
  const isSupplierMethodKey = (m: Method | null | undefined): m is "supplier_specific" | "hybrid" => m === "supplier_specific" || m === "hybrid";
  const formDefault = ctx.method_options?.[0] ?? null;
  const supplierMethodWanted: Method | null = isSupplierMethodKey(named)
    ? named
    : !named && isSupplierMethodKey(formDefault) && input.supplier_id != null
      ? formDefault
      : null;
  const recordAs: Method | null = !named && isSupplierMethodKey(formDefault) && !supplierMethodWanted ? "average_data" : null;
  const supplierMethod = supplierMethodWanted !== null;
  const prep = await prepareSupplier(ctx, checks, input, supplierMethodWanted, targetYear);
  if (!prep.ok) return prep;
  warnings.push(...prep.warnings);

  // S3-5 asks for an amount and a currency when the row's method is spend_based: the
  // one it names, else the form's default (01-contracts §6: row → method_options[0]).
  const spendMethod = named ?? ctx.method_options?.[0] ?? null;

  // S3-5: a row entered as an amount and a currency is in that currency.
  if (!unit && rowAsksForSpend(activity_data, spendMethod)) {
    unit = spendInputOf(activity_data, input.extra_data, null, input.period.date_of_reporting, undefined, spendMethod)?.currency;
  }

  if (activity_data.emission_category && unit) {
    const match = ctx.factors.find(activity_data.emission_category, targetYear);
    // A supplier's own figure (or a hybrid row's lines) stands in for the
    // activity's factor, so the activity needs none of its own.
    if (!match && !supplierMethod) {
      return {
        ok: false,
        issue: { code: "NO_FACTOR_FOR_YEAR", message: `No emission factor found for emission category "${activity_data.emission_category}" (year ${targetYear})` },
      };
    }
    factor = match?.factor ?? null;
    if (match?.fallback_year && !supplierMethod) {
      warnings.push({ code: "FACTOR_FALLBACK_YEAR", message: `No ${targetYear} factor for "${match.factor.emission_category_name}"; the ${match.factor.year} factor was used.` });
    }
    // S3-5: a spend row gets its stored rate and deflator before the (pure) engine runs. That includes
    // an amount in another currency than its factor's (INR on a factor per USD), so its rate is stored too.
    let spend: SpendQuote | undefined;
    if (!supplierMethod && factor && isSpendRow(activity_data, factor, spendMethod, unit)) {
      const spendInput = spendInputOf(activity_data, input.extra_data, unit, input.period.date_of_reporting, ctx.selectColumns, spendMethod);
      if (spendInput && ctx.rates) {
        const quoted = await ctx.rates.quote(spendInput, factor, input.storedFx);
        if (!quoted.ok) return { ok: false, issue: { code: quoted.code, message: quoted.message, field: quoted.field } };
        spend = quoted.quote;
      } else if (!spendInput && rowAsksForSpend(activity_data, spendMethod)) {
        return { ok: false, issue: { code: "FIELD_REQUIRED", message: "Give the amount spent and its currency.", field: "spent_value" } };
      }
    }
    // S3-3: the method and quality the engine records; S3-5: the spend quote that picks the spend file.
    const result = computeTotal(ctx, factor, activity_data, unit, {
      method: supplierMethodWanted ?? recordAs ?? input.method,
      rowMethod: input.method ? null : rowMethodOf(activity_data),
      reportingYear: reportingYearFor(input.period.date_of_reporting),
      manualDq: input.dq ? manualDqFrom(input.dq) : null,
      spend,
      // S3-12: a proxy row (a survey sample) scores completeness 3; its total is its form's own.
      proxy: input.proxy ?? undefined,
      supplier: prep.engine,
    });
    if (!result.ok) return result;
    computed = result.computed;
    unit = computed.activity_unit;
  }
  const methodWarnings = computed?.warnings ?? [];

  let fera: FeraTwin | null = null;
  let feraSkipped: string | undefined;
  let tdLoss: FeraTwin | null = null;
  if (activity_data.emission_category) {
    fera = feraTwinFor(ctx, activity_data.emission_category, activity_data, unit, targetYear);
    tdLoss = tdLossTwinFor(ctx, activity_data.emission_category, activity_data, unit, targetYear);
    const twinCategory = fera?.category_id ?? tdLoss?.category_id;
    if (twinCategory) {
      const conflict = await checks.modeLock(input.site_id, twinCategory, input.period);
      if (conflict) {
        // The twins respect the lock on their own category; skipped, never fatal.
        if (fera) feraSkipped = `the FERA category is filed ${conflict.conflicting_period} for this period`;
        fera = tdLoss = null;
      }
    }
    if (!fera && !feraSkipped) feraSkipped = feraGap(ctx, activity_data.emission_category, unit, targetYear) ?? undefined;
    // FERA applies (the site has it and the activity has upstream FERA factors) but no 3a/3b twin was
    // made: say why, never silently (S3-4): no factor for the year, a unit that doesn't convert (LSHS
    // per litre vs a FERA factor per kWh), or the FERA category filed the other way. A missing td_loss
    // factor (3c) is normal and raises nothing (S3-7).
    if (feraSkipped) {
      const name = activity_data.emission_category;
      warnings.push({
        code: "FERA_FACTOR_MISSING",
        message: feraSkipped.startsWith("there is no ")
          ? `No ${targetYear} FERA factor for "${name}", so no fuel- and energy-related (Category 3) row was added.`
          : `No fuel- and energy-related (Category 3) row was added: ${feraSkipped}.`,
      });
    }
    for (const w of [feraFactorTypeWarning(fera), feraFactorTypeWarning(tdLoss)]) if (w) warnings.push(w);
  }
  const wtt = supplierMethod ? null : wttDoubleCountWarning(ctx, factor);
  if (wtt) warnings.push(wtt);
  warnings.push(...methodWarnings);
  // S3-8: an estimated distance, and a Category 9 row the company says it paid for.
  for (const w of [estimatedDistanceWarning(input.is_estimate, unit), paidByMismatchWarning(ctx, input.extra_data)]) if (w) warnings.push(w);

  return {
    ok: true,
    entry: {
      input: { ...input, activity_data_unit: unit },
      factor,
      computed,
      fera,
      tdLoss,
      warnings,
      site_country: ctx.site_country ?? null,
      supplier_id: computed?.supplier_id ?? prep.supplier?.supplier_id ?? null,
      ...(feraSkipped ? { feraSkipped } : {}),
    },
  };
};

/**
 * The snapshot a row stores: the method's own (a supplier's figure, a hybrid
 * row's components; S3-6) or the row's emission factor with a spend row's
 * deflator (S3-5), as before.
 */
export const entryFactorSnapshot = (entry: Pick<PreparedEntry, "factor" | "computed">): Record<string, unknown> | null =>
  entry.computed?.snapshot ?? (entry.factor ? factorSnapshot(entry.factor, entry.computed?.deflator) : null);

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
  opts: { deferChecks?: boolean } = {},
): Promise<{ emission: Emission; fera: Emission | null; tdLoss: Emission | null }> => {
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
    total_kgco2e: entry.computed?.total_kgco2e ?? "0.0000",
    gas_kg: entry.computed?.gas_kg ?? null,
    biogenic_kg: entry.computed?.biogenic_kg ?? null,
    emission_factor_snapshot: entryFactorSnapshot(entry),
    // S3-6: the supplier the goods came from, when the entry names one.
    supplier: entry.supplier_id ? ({ supplier_id: entry.supplier_id } as any) : null,
    fx: entry.computed?.fx ?? null,
    proxy: input.proxy ?? null,
    // S3-3: null on Scope 1 and Scope 2 rows, where a method means nothing.
    method: entry.computed?.method ?? null,
    dq: entry.computed?.dq ?? null,
    data_type: entry.computed?.data_type ?? null,
    is_estimate: input.is_estimate ?? false,
  });
  await repo.save(emission);

  let fera: Emission | null = null;
  if (entry.fera) {
    fera = repo.create({
      ...base,
      category: { category_id: entry.fera.category_id },
      activity_data: input.activity_data,
      total_emission: entry.fera.total,
      total_kgco2e: entry.fera.total_kgco2e,
      gas_kg: entry.fera.gas_kg ?? null,
      biogenic_kg: entry.fera.biogenic_kg ?? null,
      fera_linked_id: emission.pk_id,
      emission_factor_snapshot: factorSnapshot(entry.fera.factor),
      scope3_sub: entry.fera.scope3_sub,
      ...twinQuality(entry.site_country, entry.fera.factor, input.period.date_of_reporting),
    });
    await repo.save(fera);
    emission.fera_linked_id = fera.pk_id;
    await repo.save(emission);
  }

  // S3-7: the T&D-loss twin points at its parent only (the parent's own link
  // stays on the upstream twin), so it approves, rejects and deletes with the
  // parent through the reverse link.
  let tdLoss: Emission | null = null;
  if (entry.tdLoss) {
    tdLoss = repo.create({
      ...base,
      category: { category_id: entry.tdLoss.category_id },
      activity_data: input.activity_data,
      total_emission: entry.tdLoss.total,
      total_kgco2e: entry.tdLoss.total_kgco2e,
      gas_kg: entry.tdLoss.gas_kg ?? null,
      biogenic_kg: entry.tdLoss.biogenic_kg ?? null,
      fera_linked_id: emission.pk_id,
      emission_factor_snapshot: factorSnapshot(entry.tdLoss.factor),
      scope3_sub: entry.tdLoss.scope3_sub,
      ...twinQuality(entry.site_country, entry.tdLoss.factor, input.period.date_of_reporting),
    });
    await repo.save(tdLoss);
  }

  if (audit) {
    const auditRepo = tx.getRepository(AuditLog);
    for (const row of [emission, fera, tdLoss]) {
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
  // S3-15 review checks; insertRows defers them and refreshes the whole batch once.
  if (!opts.deferChecks) await refreshChecksSafely(tx, [emission.pk_id, ...(fera ? [fera.pk_id] : []), ...(tdLoss ? [tdLoss.pk_id] : [])]);
  return { emission, fera, tdLoss };
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
    // S3-3: the row's own method, estimate flag and hand-judged quality ride along, so
    // plan and commit store the same method, dq and is_estimate a typed entry would.
    const result = await prepareEntry(ctx, checks, {
      site_id: row.site_id,
      category_id: row.category_id,
      activity_data,
      activity_data_unit: row.activity_unit,
      period,
      method: row.method ?? null,
      is_estimate: row.is_estimate,
      dq: row.dq ?? null,
      // S3-12: a survey-scaled row is a proxy (basis sample), so plan and commit score it alike.
      proxy: row.survey ? surveyProxy(row.survey) : null,
    });
    if (!result.ok) {
      errors.push(issue(result.issue.code, result.issue.message, result.issue.field));
    } else if (!result.entry.computed || result.entry.computed.activityValue <= 0) {
      errors.push(issue("MISSING_VALUE", "No quantity greater than 0 was found for this row.", "activity_value"));
    } else {
      // FACTOR_FALLBACK_YEAR is already on the row from the resolution above.
      for (const w of result.entry.warnings) if (w.code !== "FACTOR_FALLBACK_YEAR") issues.push(issue(w.code, w.message, w.field));
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
    if (isLowConfidenceAiMatch(row.meta)) issues.push(issue("LOW_CONFIDENCE_MATCH", "Matched by the AI below 80 %; the uploader confirmed it."));

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
        fera: entry.fera ? { category_id: entry.fera.category_id, total_tco2e: entry.fera.total, scope3_sub: entry.fera.scope3_sub } : undefined,
        td_loss: entry.tdLoss ? { category_id: entry.tdLoss.category_id, total_tco2e: entry.tdLoss.total } : undefined,
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
      return now.factor.emission_factor_id !== r.factor.emission_factor_id || now.total_tco2e !== r.total_tco2e || (now.fera?.total_tco2e ?? null) !== (r.fera?.total_tco2e ?? null) ||
        (now.td_loss?.total_tco2e ?? null) !== (r.td_loss?.total_tco2e ?? null);
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
    // Smart-import provenance for Review rows' "Matched by" (XI5): how the row
    // was mapped and how sure the mapper was. Never the pre-commit edit flag,
    // which the attention filter reads from the plan row.
    if (row.meta) extra_data.import.meta = { source: row.meta.source, confidence: row.meta.confidence };
    if (row.notes) extra_data.notes = row.notes;
    if (row.survey) extra_data.survey = row.survey; // S3-9 commuting survey scaling
    // S3-12: a survey row is a proxy too (basis sample), as the backfill writes for older rows.
    const proxy = row.survey ? surveyProxy(row.survey) : null;
    const { emission, fera, tdLoss } = await insertEntry(tx, writerCtx.user_id, { ...entry, input: { ...entry.input, extra_data, proxy } }, batch, audit, { deferChecks: true });
    inserted += 1;
    ids.push(emission.pk_id);
    for (const twin of [fera, tdLoss]) {
      if (!twin) continue;
      fera_inserted += 1;
      ids.push(twin.pk_id);
    }
  }
  await refreshChecksSafely(tx, ids);
  return { inserted, fera_inserted, ids };
};

export const emissionWriter: EmissionWriter = {
  planRows: (ctx, rows, opts) => planRows(ctx, rows, opts),
  insertRows,
};

export default emissionWriter;
