/**
 * DS-2 · the one resolver: every binding and data token of a design, whatever
 * its source, becomes a ResolvedBinding here (`POST /studio/resolve`, DS-5
 * auto-build, DS-9 prompts, DS-11 finals, DS-12 checks).
 *
 *   resolveRequest(caller, body)   checks the request, resolves, hashes; cached 60 s per
 *                                  (company, kind, period, sites, bindings hash, data stamp)
 *   resolveAll(ctx, bindings, tokens)   the dispatcher by `source`
 *   resolveToken(resolved, token)  a DataToken's measure (value, change, share, progress, target, baseline)
 *
 * Tenant: request and binding sites must be sites the caller may read in the
 * company (another company's site → 404 DS_DOC_NOT_FOUND). `sites: 'all'` is
 * every site of the company and needs access to all of them (403
 * DS_SITES_SCOPE). The kind guard runs first (DS_KIND_OFF).
 *
 * Cache: keyed also by a data stamp (newest approved emission/KPI change and
 * the row counts in range) so an approval or a reopen shows at once; entries
 * live 60 s.
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { getPeriodRange } from "../../reporting/ghg-data";
import {
  BindingSchema,
  DataTokenSchema,
  DsError,
  ReportInputsSchema,
  ReportKindSchema,
  SitesSchema,
  YearTypeSchema,
  type Binding,
  type DataToken,
  type NumberFormat,
  type ReportInputs,
  type ReportKind,
} from "../contracts";
import { assertKind, type StudioCaller } from "../guard";
import { parse } from "../http";
import { changeAbs, changePct, share } from "./derived";
import { EMPTY, formatChangeAbs, formatChangePct, formatNumber } from "./format";
import { GhgLoader, resolveGhg } from "./ghg";
import { bindingsHash, dataHash } from "./hash";
import { effectiveInputs, inputDisplay, loadDocInputs, prefillInputs, type Prefill } from "./inputs";
import { KpiLoader, resolveKpi } from "./kpi";
import type { ResolveContext, ResolvedBinding, ResolveResponse } from "./types";

type Row = Record<string, any>;

export const ResolveRequestSchema = z
  .object({
    kind: ReportKindSchema,
    year: z.number().int().min(1990).max(2100),
    yearType: YearTypeSchema,
    sites: SitesSchema,
    bindings: z.array(BindingSchema).max(500).default([]),
    tokens: z.array(DataTokenSchema).max(1000).default([]),
    /** DS-2 addition: read the doc's stored report inputs (input bindings, intensity, exclusions). */
    docId: z.number().int().positive().optional(),
    /** DS-2 addition: unsaved inputs (the new-design flow), over the doc's and the prefill. */
    inputs: ReportInputsSchema.optional(),
    /** Superadmin names the company (studioCompanyFor reads it). */
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/** The company's sites the caller may read; and whether that's every site. */
export async function readableSites(caller: Pick<StudioCaller, "companyId" | "sites">): Promise<{ readable: number[]; all: boolean }> {
  const rows: Row[] = await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [caller.companyId]);
  const company = rows.map((r) => Number(r.site_id));
  const readable = caller.sites ? company.filter((id) => caller.sites!.has(id)) : company;
  return { readable, all: readable.length === company.length };
}

/** Request or binding sites → ids. Unknown or unreadable ids → 404; 'all' without all-site access → 403. */
export function checkSites(sites: "all" | number[], readable: number[], all: boolean): number[] {
  if (sites === "all") {
    if (!all) throw new DsError("DS_SITES_SCOPE");
    return readable;
  }
  const ids = [...new Set(sites)].sort((a, b) => a - b);
  const missing = ids.filter((id) => !readable.includes(id));
  if (missing.length) throw new DsError("DS_DOC_NOT_FOUND", { sites: missing });
  return ids;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface Loaders {
  ghg: GhgLoader;
  kpi: KpiLoader;
}
export const loadersFor = (companyId: number, yearType: "CY" | "FY"): Loaders => ({ ghg: new GhgLoader(companyId, yearType), kpi: new KpiLoader(companyId) });

export async function resolveBinding(L: Loaders, ctx: ResolveContext, b: Binding, idx: number, format: NumberFormat = "auto"): Promise<ResolvedBinding> {
  switch (b.source) {
    case "ghg":
      return resolveGhg(L.ghg, ctx, b, idx, format);
    case "kpi":
      return resolveKpi(L.kpi, ctx, b, idx, format);
    case "input": {
      const entry = ctx.inputs[b.key];
      const text = entry ? inputDisplay(b.key, entry.value) : "";
      const num = entry && typeof entry.value === "number" ? entry.value : null;
      return {
        source: "input",
        display: text,
        value: num,
        unit: null,
        approvedAt: null,
        ...(entry ? {} : { unavailable: { reason: "NO_INPUT" as const } }),
      };
    }
    case "custom":
      return { source: "custom", display: "Unlinked data", value: null, unit: null, series: [{ label: b.columns[0] ?? "", values: [] }] };
  }
}

/** A token's measure from its resolved binding, formatted once (format.ts). */
export function resolveToken(r: ResolvedBinding, token: DataToken): ResolvedBinding {
  const { measure, format } = token.attrs;
  const fmt: NumberFormat = format ?? "auto";
  if (r.unavailable) return r;
  const base = { ...r };
  const year = token.attrs.year;
  // A specific year (or "prior") reads that point of the series when it has one.
  if (measure === "value" && year !== undefined && year !== "current" && r.series?.length === 1) {
    const key = year === "prior" ? String(Number(r.series[0].values[r.series[0].values.length - 1]?.key) - 1) : year === "base" ? String(r.compare?.year ?? "") : String(year);
    const p = r.series[0].values.find((v) => v.key === key);
    return { ...base, value: p?.value ?? null, display: formatNumber(p?.value ?? null, fmt) };
  }
  switch (measure) {
    case "value":
      return { ...base, display: r.value === null ? r.display : formatNumber(r.value, fmt) };
    case "change_abs": {
      const v = r.compare?.change_abs ?? null;
      return { ...base, value: v, display: v === null ? EMPTY : formatChangeAbs(v, fmt) };
    }
    case "change_pct": {
      const v = r.compare?.change_pct ?? null;
      return { ...base, value: v, unit: "%", display: v === null ? EMPTY : formatChangePct(v, fmt === "pct0" ? "pct0" : "pct1") };
    }
    case "share": {
      const total = r.total ?? null;
      const d = share(r.value, total);
      return { ...base, value: d.value, unit: "%", display: formatNumber(d.value, fmt === "auto" ? "pct1" : fmt) };
    }
    case "progress": {
      const v = r.target?.progress_pct ?? null;
      return { ...base, value: v, unit: "%", display: formatNumber(v, fmt === "auto" ? "pct0" : fmt) };
    }
    case "target": {
      const v = r.target?.target_value ?? null;
      return { ...base, value: v, display: formatNumber(v, fmt) };
    }
    case "baseline": {
      const v = r.target?.baseline_value ?? r.compare?.value ?? null;
      return { ...base, value: v, display: formatNumber(v, fmt) };
    }
  }
  return base;
}

/** The token's binding with what its measure needs (a change measure needs `compare`). */
const tokenBinding = (t: DataToken): Binding => {
  const b = t.attrs.binding;
  if ((t.attrs.measure === "change_abs" || t.attrs.measure === "change_pct") && !b.compare) {
    return { ...b, compare: t.attrs.year === "base" ? "base" : "prior" } as Binding;
  }
  return b;
};

export async function resolveAll(L: Loaders, ctx: ResolveContext, bindings: Binding[], tokens: DataToken[]): Promise<ResolveResponse> {
  const values: ResolvedBinding[] = [];
  for (let i = 0; i < bindings.length; i++) values.push(await resolveBinding(L, ctx, bindings[i], i));
  const resolvedTokens: ResolvedBinding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const r = await resolveBinding(L, ctx, tokenBinding(tokens[i]), i, tokens[i].attrs.format ?? "auto");
    resolvedTokens.push(resolveToken(r, tokens[i]));
  }
  const unavailable = [
    ...values.flatMap((v, i) => (v.unavailable ? [{ bindingIdx: i, reason: v.unavailable.reason }] : [])),
    ...resolvedTokens.flatMap((v, i) => (v.unavailable ? [{ bindingIdx: i, reason: v.unavailable.reason, token: true }] : [])),
  ];
  return {
    values,
    tokens: resolvedTokens,
    dataHash: dataHash({ year: ctx.year, yearType: ctx.yearType, siteIds: ctx.siteIds, values: [...values, ...resolvedTokens], inputs: ctx.inputs }),
    unavailable,
  };
}

// ---------------------------------------------------------------------------
// Cache (60 s) and the request
// ---------------------------------------------------------------------------

export const RESOLVE_CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: ResolveResponse }>();
export const clearResolveCache = () => cache.clear();

/** Changes whenever an approved emission row or KPI value in range is approved, edited, reopened or removed. */
async function dataStamp(companyId: number, siteIds: number[], from: Date, to: Date): Promise<string> {
  const [e]: Row[] = await AppDataSource.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'approved') AS n, MAX(updated_at) AS at FROM emission WHERE site_id = ANY($1::int[]) AND date_of_reporting >= $2 AND date_of_reporting <= $3`,
    [siteIds, from, to],
  );
  const [k]: Row[] = await AppDataSource.query(`SELECT COUNT(*) FILTER (WHERE status = 'approved') AS n, MAX(updated_at) AS at FROM kpi_value WHERE company_id = $1`, [companyId]).catch(() => [{}]);
  const [t]: Row[] = await AppDataSource.query(`SELECT MAX(updated_at) AS at FROM company_scope3_category WHERE company_id = $1`, [companyId]).catch(() => [{}]);
  const [b]: Row[] = await AppDataSource.query(`SELECT MAX(updated_at) AS at FROM company_base_year WHERE company_id = $1`, [companyId]).catch(() => [{}]);
  const ts = (v: unknown) => (v ? new Date(v as string).getTime() : 0);
  return [e?.n, ts(e?.at), k?.n, ts(k?.at), ts(t?.at), ts(b?.at)].join(":");
}

/** The years a request can touch: generous range for the stamp (bindings reach back up to 20 years). */
const stampRange = (yearType: "CY" | "FY", year: number) => ({ from: getPeriodRange(yearType, year - 21, "yearly").startDate, to: getPeriodRange(yearType, year + 1, "yearly").endDate });

export async function buildContext(caller: StudioCaller, req: { kind: ReportKind; year: number; yearType: "CY" | "FY"; sites: "all" | number[]; docId?: number; inputs?: ReportInputs }, L: Loaders) {
  assertKind(caller, req.kind);
  const { readable, all } = await readableSites(caller);
  const siteIds = checkSites(req.sites, readable, all);
  let stored: ReportInputs = {};
  if (req.docId) {
    const doc = await loadDocInputs(caller.companyId, req.docId);
    assertKind(caller, doc.kind);
    assertDocSitesReadable(doc.sites, readable, all);
    stored = doc.inputs;
  }
  if (req.inputs) stored = { ...stored, ...req.inputs };
  const prefill: Prefill = await prefillInputs({ companyId: caller.companyId, kind: req.kind, year: req.year, yearType: req.yearType, siteIds, kpiEnabled: caller.kpiEnabled }, L.ghg, L.kpi);
  const ctx: ResolveContext = {
    companyId: caller.companyId,
    kind: req.kind,
    year: req.year,
    yearType: req.yearType,
    siteIds,
    allSiteIds: readable,
    kpiEnabled: caller.kpiEnabled,
    inputs: effectiveInputs(stored, prefill),
  };
  return { ctx, readable, all, prefill };
}

/** A design whose sites the caller can't all read is not found (as loadDocRow: 'all' needs every site). */
export function assertDocSitesReadable(sites: "all" | number[], readable: number[], all: boolean): void {
  if (sites === "all" ? !all : !sites.every((s) => readable.includes(s))) throw new DsError("DS_DOC_NOT_FOUND");
}

/** Every site a binding names must be readable too (404 otherwise; 'all' is the doc's sites). */
function checkBindingSites(bindings: Binding[], readable: number[]) {
  for (const b of bindings) {
    if ((b.source === "ghg" || b.source === "kpi") && b.sites !== "all") checkSites(b.sites, readable, false);
  }
}

export async function resolveRequest(caller: StudioCaller, body: unknown): Promise<ResolveResponse> {
  const req = parse(ResolveRequestSchema, body ?? {});
  const L = loadersFor(caller.companyId, req.yearType);
  const { ctx, readable } = await buildContext(caller, req, L);
  checkBindingSites([...req.bindings, ...req.tokens.map((t) => t.attrs.binding)], readable);

  const range = stampRange(req.yearType, req.year);
  const key = [
    caller.companyId,
    req.kind,
    req.year,
    req.yearType,
    ctx.siteIds.join(","),
    caller.kpiEnabled ? 1 : 0,
    bindingsHash({ b: req.bindings, t: req.tokens, i: ctx.inputs }),
    await dataStamp(caller.companyId, ctx.allSiteIds.length ? ctx.allSiteIds : [0], range.from, range.to),
  ].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_CACHE_MS) return hit.value;
  const value = await resolveAll(L, ctx, req.bindings, req.tokens);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at >= RESOLVE_CACHE_MS) cache.delete(k);
  return value;
}
