/**
 * Scope 3 in the GHG report (S3-13): one row per GHG Protocol category 1–15
 * plus "Unmapped", with the category's boundary status and reason, the method
 * mix, the share of supplier and value-chain data, data quality, datasets and
 * GWP sets. It feeds `GET /reports/ghg/scope3`, the Scope 3 PDF pages and the
 * FE Scope 3 and Methodology tabs. Scope 3 Standard ch. 11.1 is the checklist
 * (src/reporting/S3-13.CLAUDE.md).
 *
 * Nothing here calculates an emission: it sums the kgCO₂e the engine stored on
 * approved rows, then rounds to tCO₂e (D5).
 *
 * Columns from modules that are not merged yet (S3-3 method/dq/data_type, S3-4
 * total_kgco2e, S3-12 proxy, the engine's biogenic_kg) are read when the
 * column exists and reported as not recorded until then, so this file needs
 * no change when they land.
 */
import { AppDataSource } from "../config/data-source";
import { GHG_CATEGORIES, ghgCategory, type GhgCategoryNumber, type Method, METHOD_KEYS } from "../scope3/contracts/ghgCategory";
import { GWP_SETS, isFactorType, type FactorType, type GwpSet } from "../scope3/contracts/factor";
import { ensureBoundaryRows, isScope3Sql, type Queryable } from "../scope3/taxonomy/service";
import { getPeriodRange, type GhgFilters } from "./ghg-data";
import type { Scope3ReportRow as ContractScope3ReportRow } from "../scope3/contracts/schemas";
import type { Block } from "./types";

// ---------------------------------------------------------------------------
// Row shape (01-contracts.md §5) comes from S3-0's `Scope3ReportRowSchema`.
// `rf` and `proxy_basis` are S3-13 additions the contract doesn't carry yet
// (S3-0 follow-up: add them to the schema, then drop the intersection here).
// ---------------------------------------------------------------------------

export type BoundaryStatus = NonNullable<ContractScope3ReportRow["status"]>;

export type Scope3ReportRow = ContractScope3ReportRow & {
  /** Air travel radiative forcing (Standard L4218): null = no flight entries. */
  rf: "with" | "without" | "mixed" | null;
  /** How extrapolated or proxy data was made (survey scaling, S3-12 proxy basis). */
  proxy_basis: string[];
};

/** Which optional inputs this database records yet. false → the report says "Not recorded" / "Not tracked". */
export interface Scope3Tracked {
  method: boolean;
  dq: boolean;
  data_type: boolean;
  proxy: boolean;
  biogenic: boolean;
  gases: boolean;
  total_kgco2e: boolean;
}

export interface Scope3Report {
  company_id: number;
  consolidation_approach: string;
  period: { label: string; year: number; year_type: "CY" | "FY" };
  total_tco2e: number;
  gwp_sets: GwpSet[];
  tracked: Scope3Tracked;
  rows: Scope3ReportRow[];
}

/** One aggregated group from SQL: a category × method × DQ × data type × proxy × factor dataset. */
export interface Scope3Group {
  category_id: number;
  category_name: string;
  n: number | null;
  method: string | null;
  dq_overall: number | null;
  data_type: string | null;
  is_proxy: boolean;
  dataset: string | null;
  dataset_version: string | null;
  factor_type: string | null;
  gwp_set: string | null;
  kg: number;
  biogenic_kg: number | null;
  /** "with" / "without" radiative forcing for flight factors; null otherwise. */
  rf?: "with" | "without" | null;
  proxy_basis?: string | null;
}

export interface BoundaryRow {
  n: number;
  status: BoundaryStatus;
  reason: string | null;
  method_note: string | null;
}

/** Methods whose data comes from suppliers or value-chain partners (ch. 11.1, last item). */
const VALUE_CHAIN_METHODS = new Set<string>([
  "supplier_specific",
  "hybrid",
  "site_specific",
  "asset_specific",
  "lessor_specific",
  "lessee_specific",
  "franchise_specific",
  "investment_specific",
]);

export const UNMAPPED_NAME = "Unmapped";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
/** kgCO₂e → tCO₂e, rounded once at the end (D5). */
export const kgToT = (kg: number) => round2(kg / 1000);
const share = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0);

const isMethod = (v: unknown): v is Method => typeof v === "string" && (METHOD_KEYS as readonly string[]).includes(v);
const isGwp = (v: unknown): v is GwpSet => typeof v === "string" && (GWP_SETS as readonly string[]).includes(v);

/**
 * Builds the 16 report rows (15 categories + Unmapped) from the aggregated
 * groups, the company's boundary rows and the company's mapped categories.
 * Pure: unit tested in ci/unit/scope3-report.test.cjs.
 */
export function buildScope3Rows(
  groups: Scope3Group[],
  boundary: BoundaryRow[],
  mapped: { category_id: number; category_name: string; ghg_category: number | null }[],
  tracked: Pick<Scope3Tracked, "biogenic">,
): { rows: Scope3ReportRow[]; total_tco2e: number; gwp_sets: GwpSet[] } {
  const keyOf = (n: number | null) => (n !== null && ghgCategory(n) ? n : null);
  const byKey = new Map<number | null, Scope3Group[]>();
  for (const g of groups) {
    const k = keyOf(g.n);
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  const totalKg = groups.reduce((a, g) => a + g.kg, 0);
  const allGwp = new Set<GwpSet>();

  const rowFor = (n: GhgCategoryNumber | null): Scope3ReportRow => {
    const gs = byKey.get(n) ?? [];
    const kg = gs.reduce((a, g) => a + g.kg, 0);
    const sumWhere = (pred: (g: Scope3Group) => boolean) => gs.filter(pred).reduce((a, g) => a + g.kg, 0);

    const methodKg = new Map<Method, number>();
    for (const g of gs) {
      const m: Method = isMethod(g.method) ? g.method : "unknown";
      methodKg.set(m, (methodKg.get(m) ?? 0) + g.kg);
    }
    const methods: Partial<Record<Method, number>> = {};
    [...methodKg.entries()].sort((a, b) => b[1] - a[1]).forEach(([m, v]) => (methods[m] = share(v, kg)));

    const dqKg = sumWhere((g) => g.dq_overall !== null);
    const dqWeighted = gs.reduce((a, g) => a + (g.dq_overall !== null ? g.dq_overall * g.kg : 0), 0);

    const ds = new Map<string, { dataset: string; version: string | null; factor_type: FactorType; kg: number }>();
    const gwp = new Set<GwpSet>();
    for (const g of gs) {
      if (isGwp(g.gwp_set)) {
        gwp.add(g.gwp_set);
        allGwp.add(g.gwp_set);
      }
      if (!g.dataset) continue;
      const factor_type: FactorType = isFactorType(g.factor_type) ? g.factor_type : "other";
      const key = `${g.dataset}|${g.dataset_version ?? ""}|${factor_type}`;
      const cur = ds.get(key);
      if (cur) cur.kg += g.kg;
      else ds.set(key, { dataset: g.dataset, version: g.dataset_version, factor_type, kg: g.kg });
    }

    const cat = n === null ? null : ghgCategory(n)!;
    const b = n === null ? undefined : boundary.find((r) => r.n === n);
    const biogenic = tracked.biogenic ? gs.reduce((a, g) => a + (g.biogenic_kg ?? 0), 0) : null;
    const rfs = new Set(gs.map((g) => g.rf).filter((v): v is "with" | "without" => v === "with" || v === "without"));
    const proxyBasis = [...new Set(gs.filter((g) => g.is_proxy && g.proxy_basis).map((g) => g.proxy_basis as string))].sort();

    return {
      n,
      name: cat ? cat.name : UNMAPPED_NAME,
      direction: cat ? cat.direction : null,
      status: cat ? (b?.status ?? "screening") : null,
      reason: b?.reason ?? null,
      method_note: b?.method_note ?? null,
      tco2e: kgToT(kg),
      share_pct: share(kg, totalKg),
      methods,
      primary_pct: share(sumWhere((g) => g.data_type === "primary"), kg),
      value_chain_pct: share(sumWhere((g) => !!g.method && VALUE_CHAIN_METHODS.has(g.method)), kg),
      proxy_pct: share(sumWhere((g) => g.is_proxy), kg),
      dq: {
        overall: dqKg > 0 ? round1(dqWeighted / dqKg) : null,
        good_pct: share(sumWhere((g) => g.dq_overall !== null && Math.round(g.dq_overall) <= 1), kg),
        fair_pct: share(sumWhere((g) => g.dq_overall !== null && Math.round(g.dq_overall) === 2), kg),
        poor_pct: share(sumWhere((g) => g.dq_overall !== null && Math.round(g.dq_overall) >= 3), kg),
      },
      datasets: [...ds.values()].sort((a, b2) => b2.kg - a.kg).map(({ dataset, version, factor_type }) => ({ dataset, version, factor_type })),
      gwp_sets: GWP_SETS.filter((s) => gwp.has(s)),
      biogenic_tco2e: biogenic === null ? null : kgToT(biogenic),
      mapped_categories: mapped
        .filter((m) => keyOf(m.ghg_category) === n)
        .map((m) => ({ category_id: m.category_id, name: m.category_name })),
      rf: rfs.size === 0 ? null : rfs.size > 1 ? "mixed" : [...rfs][0],
      proxy_basis: proxyBasis,
    };
  };

  const rows = [...GHG_CATEGORIES.map((c) => rowFor(c.n)), rowFor(null)];
  return { rows, total_tco2e: kgToT(totalKg), gwp_sets: GWP_SETS.filter((s) => allGwp.has(s)) };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const OPTIONAL_COLUMNS = ["method", "dq", "data_type", "total_kgco2e", "proxy", "biogenic_kg", "gas_kg"] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

let columnCache: { at: number; cols: Set<string> } | null = null;
const COLUMN_TTL_MS = 5 * 60 * 1000;

/** Which of the not-yet-merged emission columns exist (cached for 5 minutes). */
export async function emissionColumns(q: Queryable = AppDataSource): Promise<Set<OptionalColumn>> {
  if (!columnCache || Date.now() - columnCache.at > COLUMN_TTL_MS) {
    const rows: any[] = await q.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'emission' AND column_name = ANY($1)`,
      [OPTIONAL_COLUMNS as unknown as string[]],
    );
    columnCache = { at: Date.now(), cols: new Set(rows.map((r) => String(r.column_name))) };
  }
  return columnCache.cols as Set<OptionalColumn>;
}

/** One emission row's kgCO₂e (alias `e`): the stored kg once S3-4 adds it, else tonnes × 1000. Shared with S3-14. */
export const kgSql = (cols: Set<OptionalColumn>) =>
  cols.has("total_kgco2e") ? `COALESCE(e.total_kgco2e, e.total_emission::numeric * 1000)` : `e.total_emission::numeric * 1000`;

/** Approved Scope 3 rows in the filters' period, aggregated for buildScope3Rows. */
async function loadGroups(filters: GhgFilters, cols: Set<OptionalColumn>, q: Queryable): Promise<Scope3Group[]> {
  const range = getPeriodRange(filters.yearType, filters.year, filters.frequency ?? "yearly", filters.month, filters.quarter);
  const kg = kgSql(cols);
  const params: any[] = [filters.siteIds, range.startDate, range.endDate];
  let catFilter = "";
  if (filters.categoryIds?.length) {
    params.push(filters.categoryIds);
    catFilter = `AND c.category_id = ANY($${params.length}::int[])`;
  }
  const surveyBasis = `CASE WHEN COALESCE(e.extra_data ? 'survey', false) THEN 'Commuting survey scaled to all employees' END`;
  const proxyBasisExpr = cols.has("proxy") ? `COALESCE(e.proxy ->> 'basis', ${surveyBasis})` : surveyBasis;
  const proxyExpr = cols.has("proxy")
    ? `(e.proxy IS NOT NULL OR COALESCE(e.extra_data ? 'survey', false))`
    : `COALESCE(e.extra_data ? 'survey', false)`; // S3-9 survey scaling until S3-12 backfills emission.proxy
  const rows: any[] = await q.query(
    `SELECT c.category_id, c.category_name, c.ghg_category AS n,
            ${cols.has("method") ? "e.method" : "NULL"} AS method,
            ${cols.has("dq") ? "(e.dq ->> 'overall')::numeric" : "NULL"} AS dq_overall,
            ${cols.has("data_type") ? "e.data_type" : "NULL"} AS data_type,
            ${proxyExpr} AS is_proxy,
            e.emission_factor_snapshot ->> 'dataset' AS dataset,
            e.emission_factor_snapshot ->> 'dataset_version' AS dataset_version,
            e.emission_factor_snapshot ->> 'factor_type' AS factor_type,
            e.emission_factor_snapshot ->> 'gwp_set' AS gwp_set,
            SUM(${kg}) AS kg,
            ${cols.has("biogenic_kg") ? "SUM(e.biogenic_kg)" : "NULL"} AS biogenic_kg,
            CASE WHEN e.emission_factor_snapshot ->> 'emission_category_name' ILIKE '% - With RF %' THEN 'with'
                 WHEN e.emission_factor_snapshot ->> 'emission_category_name' ILIKE '% - Without RF %' THEN 'without' END AS rf,
            ${proxyBasisExpr} AS proxy_basis
       FROM emission e
       JOIN category c ON c.category_id = e.category_id
      WHERE e.status = 'approved'
        AND e.site_id = ANY($1::int[])
        AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        AND ${isScope3Sql("c")}
        ${catFilter}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15`,
    params,
  );
  return rows.map((r) => ({
    category_id: Number(r.category_id),
    category_name: r.category_name,
    n: r.n === null ? null : Number(r.n),
    method: r.method ?? null,
    dq_overall: r.dq_overall === null ? null : Number(r.dq_overall),
    data_type: r.data_type ?? null,
    is_proxy: Boolean(r.is_proxy),
    dataset: r.dataset ?? null,
    dataset_version: r.dataset_version ?? null,
    factor_type: r.factor_type ?? null,
    gwp_set: r.gwp_set ?? null,
    kg: Number(r.kg) || 0,
    biogenic_kg: r.biogenic_kg === null ? null : Number(r.biogenic_kg),
    rf: r.rf === "with" || r.rf === "without" ? r.rf : null,
    proxy_basis: r.proxy_basis ?? null,
  }));
}

/**
 * The Scope 3 section of the GHG report for one company and the report's
 * filters (sites, categories, period). `filters.siteIds` must already be
 * checked against the caller (guardQuerySites) and belong to `companyId`.
 */
export async function computeScope3(filters: GhgFilters, companyId: number, q: Queryable = AppDataSource): Promise<Scope3Report> {
  const cols = await emissionColumns(q);
  // Categories "included" per row: the company's Scope 3 categories on the selected sites (and in the category filter).
  const mapParams: any[] = [filters.siteIds];
  let mapFilter = "";
  if (filters.categoryIds?.length) {
    mapParams.push(filters.categoryIds);
    mapFilter = "AND c.category_id = ANY($2::int[])";
  }
  const mapped: any[] = await q.query(
    `SELECT DISTINCT c.category_id, c.category_name, c.ghg_category
       FROM category c
       JOIN site_categories sc ON sc.category_id = c.category_id
      WHERE sc.site_id = ANY($1::int[]) AND ${isScope3Sql("c")} ${mapFilter}
      ORDER BY c.category_name`,
    mapParams,
  );
  const groups = await loadGroups(filters, cols, q);
  // Same seed as GET /scope3/categories, so the report never shows a category without a status;
  // only for a company that has Scope 3, so rendering a Scope 1/2-only report writes nothing.
  if (groups.length || mapped.length) await ensureBoundaryRows(companyId, q);
  const [company]: any[] = await q.query(`SELECT consolidation_approach FROM company WHERE company_id = $1`, [companyId]);
  const boundary: BoundaryRow[] = (
    await q.query(`SELECT ghg_category, status, reason, method_note FROM company_scope3_category WHERE company_id = $1`, [companyId])
  ).map((r: any) => ({ n: Number(r.ghg_category), status: r.status, reason: r.reason ?? null, method_note: r.method_note ?? null }));
  const tracked: Scope3Tracked = {
    method: cols.has("method"),
    dq: cols.has("dq"),
    data_type: cols.has("data_type"),
    proxy: cols.has("proxy"),
    biogenic: cols.has("biogenic_kg"),
    gases: cols.has("gas_kg"),
    total_kgco2e: cols.has("total_kgco2e"),
  };
  const built = buildScope3Rows(
    groups,
    boundary,
    mapped.map((m) => ({ category_id: Number(m.category_id), category_name: m.category_name, ghg_category: m.ghg_category === null ? null : Number(m.ghg_category) })),
    tracked,
  );
  const range = getPeriodRange(filters.yearType, filters.year, filters.frequency ?? "yearly", filters.month, filters.quarter);
  return {
    company_id: companyId,
    consolidation_approach: company?.consolidation_approach ?? "operational_control",
    period: { label: range.label, year: filters.year, year_type: filters.yearType },
    total_tco2e: built.total_tco2e,
    gwp_sets: built.gwp_sets,
    tracked,
    rows: built.rows,
  };
}

/** The report has Scope 3 to show: approved Scope 3 emissions, or a Scope 3 category used on its sites. */
export const hasScope3 = (r: Scope3Report | null): r is Scope3Report =>
  !!r && (r.total_tco2e > 0 || r.rows.some((x) => x.tco2e > 0 || x.mapped_categories.length > 0));

// ---------------------------------------------------------------------------
// Wording shared by the PDF pages
// ---------------------------------------------------------------------------

export const CONSOLIDATION_LABELS: Record<string, string> = {
  operational_control: "Operational control",
  financial_control: "Financial control",
  equity_share: "Equity share",
};
export const consolidationLabel = (v: string | null | undefined) => CONSOLIDATION_LABELS[v ?? ""] ?? CONSOLIDATION_LABELS.operational_control;

export const STATUS_LABELS: Record<BoundaryStatus, string> = {
  included: "Included",
  excluded: "Excluded",
  not_relevant: "Not relevant",
  screening: "Screening",
};

export const FACTOR_TYPE_LABELS: Record<FactorType, string> = {
  combustion: "Combustion",
  wtt: "Well-to-tank",
  td_loss: "T&D losses",
  life_cycle: "Life cycle",
  cradle_to_gate: "Cradle-to-gate",
  eeio_spend: "Spend (EEIO)",
  supplier: "Supplier-specific",
  process: "Process",
  other: "Other",
};

/** "AR6" or "AR4 and AR6"; "not recorded" when no factor carries a GWP set. */
export const gwpText = (sets: GwpSet[]) =>
  sets.length === 0 ? "not recorded on the factors used" : sets.length === 1 ? sets[0] : `${sets.slice(0, -1).join(", ")} and ${sets[sets.length - 1]}`;

// ---------------------------------------------------------------------------
// PDF pages (placed after "03 · Detailed analysis by scope" by ghg.ts)
// ---------------------------------------------------------------------------

/** The company's Scope 3 base year as the report shows it. S3-14 provides it; null = none set. */
export interface Scope3BaseYearSummary {
  base_year: number;
  year_type: "CY" | "FY" | null;
  rationale: string | null;
  policy_note: string | null;
  significance_pct: number;
  frozen_at: string | null;
  version: number;
  /** Frozen base-year tCO₂e per category (n null = Unmapped). */
  categories: { n: number | null; tco2e: number }[];
  /** Approved recalculations, newest first. */
  events: { reason: string; delta_tco2e: number; note: string | null; created_at: string }[];
}

/** Air travel radiative forcing, as the methodology table discloses it (Standard L4218). */
export const RF_TEXT = { with: "flights with radiative forcing", without: "flights without radiative forcing", mixed: "flights with and without radiative forcing" } as const;

const fmtT = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const label = (r: Scope3ReportRow) => (r.n === null ? UNMAPPED_NAME : `${r.n} · ${r.name}`);

/** "Supplier's own figure 60%, From the amount spent 40%". */
export const methodMixText = (r: Scope3ReportRow) => {
  const parts = Object.entries(r.methods).map(([k, v]) => {
    const name = k === "unknown" ? "Not recorded" : (r.n !== null ? ghgCategory(r.n)?.methods.find((o) => o.key === k)?.label : undefined) ?? k.replace(/_/g, " ");
    return `${name} ${Math.round(v as number)}%`;
  });
  return parts.length ? parts.join(", ") : "—";
};

export const datasetText = (r: Scope3ReportRow) =>
  r.datasets.length
    ? r.datasets.map((d) => `${d.dataset}${d.version ? ` ${d.version}` : ""} (${FACTOR_TYPE_LABELS[d.factor_type].toLowerCase()})`).join("; ")
    : "Factor dataset not recorded";

const REASON_LABELS: Record<string, string> = {
  methodology: "Methodology change",
  data_quality: "Better data",
  structural: "Structural change",
  error: "Correction of errors",
};

/**
 * The Scope 3 pages of the GHG PDF (Scope 3 Standard ch. 11.1): by category,
 * exclusions, methodology, data quality and the base-year block.
 */
export function scope3Blocks(r: Scope3Report, baseYear: Scope3BaseYearSummary | null, source: string): Block[] {
  const B: Block[] = [];
  const unit = "tCO₂e";
  const withData = r.rows.filter((x) => x.tco2e > 0).sort((a, b) => b.tco2e - a.tco2e);
  const top = withData[0];
  const unmapped = r.rows.find((x) => x.n === null)!;
  const biogenicCell = (x: Scope3ReportRow) => (x.biogenic_tco2e === null ? "Not tracked" : fmtT(x.biogenic_tco2e));
  const vcCell = (x: Scope3ReportRow) => (r.tracked.method ? fmtPct(x.value_chain_pct) : "Not recorded");

  // ---- Scope 3 by category (R2, R3, R4, R7, R10) ----
  B.push({
    type: "section",
    kicker: "03 · Scope 3 by category",
    title: top
      ? `${top.n === null ? "Unmapped Scope 3 entries are" : `Category ${top.n} · ${top.name} is`} ${fmtPct(top.share_pct)} of Scope 3.`
      : `No approved Scope 3 emissions for ${r.period.label}.`,
  });
  const shown = r.rows.filter((x) => x.n !== null || x.tco2e > 0 || x.mapped_categories.length > 0);
  B.push({
    type: "table",
    title: "Scope 3 emissions by GHG Protocol category",
    subtitle: unit,
    columns: ["Category", "Status", "Emissions", "Share", "Value-chain data", "Biogenic CO₂", "Included activities"],
    align: ["left", "left", "right", "right", "right", "right", "left"],
    rows: [
      ...shown.map((x) => [
        label(x),
        x.n === null
          ? { text: "Needs a category", pill: "warn" as const }
          : x.status === "included"
          ? { text: STATUS_LABELS.included, pill: "ok" as const }
          : (x.status === "excluded" || x.status === "not_relevant") && x.tco2e > 0
          ? { text: `${STATUS_LABELS[x.status]}, but ${fmtT(x.tco2e)} ${unit} reported`, pill: "warn" as const }
          : { text: STATUS_LABELS[x.status ?? "screening"], pill: x.status === "screening" ? ("warn" as const) : ("medium" as const) },
        x.tco2e > 0 ? fmtT(x.tco2e) : "—",
        x.tco2e > 0 ? fmtPct(x.share_pct) : "—",
        x.tco2e > 0 ? vcCell(x) : "—",
        x.tco2e > 0 ? biogenicCell(x) : "—",
        x.mapped_categories.map((m) => m.name).join(", ") || "—",
      ]),
      ["Total Scope 3", "", fmtT(r.total_tco2e), "100.0%", "", "", ""],
    ],
    totalRow: true,
    caption:
      `Gross emissions of CO₂, CH₄, N₂O, HFCs, PFCs and SF₆ in metric tons of CO₂e, excluding biogenic CO₂ and not reduced by offsets, allowances or other GHG trades. ` +
      `Value-chain data is the share calculated from supplier or other value-chain partner data. ` +
      (r.tracked.biogenic ? "" : "Biogenic CO₂ is not tracked per entry yet. ") +
      (unmapped.tco2e > 0 ? `${fmtT(unmapped.tco2e)} ${unit} sits in Scope 3 categories without a GHG Protocol category number yet. ` : "") +
      source,
  });

  // ---- Excluded and not relevant categories (R5) ----
  const excluded = r.rows.filter((x) => x.n !== null && (x.status === "excluded" || x.status === "not_relevant"));
  const screening = r.rows.filter((x) => x.n !== null && x.status === "screening");
  B.push({
    type: "section",
    kicker: "03 · Scope 3 boundary",
    title: excluded.length
      ? `${excluded.length} of 15 categories are excluded or not relevant, each with a justification.`
      : "No Scope 3 category is excluded.",
    flow: true,
  });
  if (excluded.length) {
    B.push({
      type: "table",
      title: "Excluded and not relevant categories",
      columns: ["Category", "Status", "Justification"],
      align: ["left", "left", "left"],
      rows: excluded.map((x) => [label(x), STATUS_LABELS[x.status!], x.reason ?? "—"]),
      caption: "Justifications as recorded by the company on its Scope 3 boundary.",
    });
  }
  if (screening.length) {
    B.push({
      type: "paragraph",
      body: `Still being screened for relevance: ${screening.map((x) => `Category ${x.n}`).join(", ")}. Emissions reported for these categories are included in the total.`,
    });
  }

  // ---- Methodology by category (R8, R9, O4, O5) ----
  const method = r.rows.filter((x) => x.tco2e > 0 || !!x.method_note);
  B.push({
    type: "section",
    kicker: "03 · Scope 3 methodology",
    title: method.length
      ? `Methods, data sources and assumptions for ${method.length} categor${method.length === 1 ? "y" : "ies"}.`
      : "No category has Scope 3 emissions or a method note yet.",
  });
  if (method.length) {
    B.push({
      type: "table",
      title: "Methodology by category",
      columns: ["Category", "Method mix", "Activity data and emission factors", "GWP", "Allocation and assumptions"],
      align: ["left", "left", "left", "left", "left"],
      rows: method.map((x) => [
        label(x),
        r.tracked.method ? methodMixText(x) : "Not recorded",
        `${datasetText(x)}${x.proxy_pct > 0 ? `; ${fmtPct(x.proxy_pct)} extrapolated or proxy data${x.proxy_basis.length ? ` (${x.proxy_basis.join("; ")})` : ""}` : ""}${x.rf ? `; ${RF_TEXT[x.rf]}` : ""}`,
        x.gwp_sets.join(", ") || "—",
        x.method_note ?? "—",
      ]),
      caption:
        "Every figure is activity data multiplied by an emission factor in ESGLite's calculation engine; no client-supplied total is used. " +
        "Allocation methods, where used, are described in the company's method note for the category.",
    });
  }
  B.push({
    type: "notes",
    items: [
      { heading: "Organisational boundary", body: `${consolidationLabel(r.consolidation_approach)} approach.` },
      { heading: "GWP values", body: r.gwp_sets.length ? `100-year GWP values from IPCC ${gwpText(r.gwp_sets)}.` : "The GWP set is not recorded on the emission factors used." },
      {
        heading: "Biogenic CO₂ and individual gases",
        body: r.tracked.biogenic
          ? "Biogenic CO₂ is reported separately per category and excluded from the totals."
          : "Biogenic CO₂ and per-gas totals are not tracked per entry yet; the factors used report CO₂e only.",
      },
      { heading: "Avoided emissions and offsets", body: "Avoided emissions and renewable energy are reported separately and never deducted from Scope 3." },
    ],
  });

  // ---- Data quality (R8, R10) ----
  const dqRows = r.rows.filter((x) => x.tco2e > 0);
  B.push({ type: "section", kicker: "03 · Scope 3 data quality", title: "Data quality of Scope 3 emissions, by category.", flow: true });
  if (dqRows.length) {
    B.push({
      type: "table",
      title: "Data quality",
      subtitle: "share of each category's tCO₂e",
      columns: ["Category", "Overall score", "Good", "Fair", "Poor", "Primary data", "Value-chain data"],
      align: ["left", "right", "right", "right", "right", "right", "right"],
      rows: dqRows.map((x) => [
        label(x),
        x.dq.overall === null ? "Not scored" : x.dq.overall.toFixed(1),
        r.tracked.dq ? fmtPct(x.dq.good_pct) : "—",
        r.tracked.dq ? fmtPct(x.dq.fair_pct) : "—",
        r.tracked.dq ? fmtPct(x.dq.poor_pct) : "—",
        r.tracked.data_type ? fmtPct(x.primary_pct) : "Not recorded",
        vcCell(x),
      ]),
      caption:
        "Score 1 = good, 2 = fair, 3 = poor, weighted by emissions, from technology, geography, time, completeness and reliability. " +
        (r.tracked.dq ? "Entries without a score are left out of the shares." : "Entries are not scored for data quality yet."),
    });
  }

  // ---- Base year (R6) ----
  B.push({ type: "section", kicker: "03 · Scope 3 base year", title: baseYear ? `Scope 3 base year ${baseYear.base_year}.` : "No Scope 3 base year set.", flow: true });
  if (!baseYear) {
    B.push({ type: "paragraph", body: "The company has not set a Scope 3 base year yet, so there is no base-year comparison or recalculation history." });
  } else {
    B.push({
      type: "notes",
      items: [
        { heading: "Base year", body: `${baseYear.year_type ?? "CY"} ${baseYear.base_year}${baseYear.frozen_at ? `, frozen ${baseYear.frozen_at.slice(0, 10)} (version ${baseYear.version})` : ""}.` },
        { heading: "Rationale", body: baseYear.rationale || "—" },
        {
          heading: "Recalculation policy",
          body: `The base year is recalculated when structural changes, changes in methodology or data accuracy, or errors change base-year Scope 3 emissions by ${baseYear.significance_pct}% or more.${baseYear.policy_note ? ` ${baseYear.policy_note}` : ""}`,
        },
      ],
    });
    const baseOf = (n: number | null) => baseYear.categories.find((c) => c.n === n)?.tco2e ?? 0;
    const cmp = r.rows.filter((x) => x.tco2e > 0 || baseOf(x.n) > 0);
    if (cmp.length) {
      B.push({
        type: "table",
        title: "Scope 3 by category, base year and reporting year",
        subtitle: unit,
        columns: ["Category", `Base year ${baseYear.base_year}`, r.period.label, "Change"],
        align: ["left", "right", "right", "right"],
        rows: cmp.map((x) => {
          const b = baseOf(x.n);
          return [label(x), fmtT(b), fmtT(x.tco2e), b > 0 ? `${x.tco2e >= b ? "+" : "−"}${Math.abs(((x.tco2e - b) / b) * 100).toFixed(1)}%` : "—"];
        }),
      });
    }
    if (baseYear.events.length) {
      B.push({
        type: "table",
        title: "Base-year recalculations",
        columns: ["Date", "Reason", `Change (${unit})`, "Context"],
        align: ["left", "left", "right", "left"],
        rows: baseYear.events.map((e) => [e.created_at.slice(0, 10), REASON_LABELS[e.reason] ?? e.reason, `${e.delta_tco2e >= 0 ? "+" : "−"}${fmtT(Math.abs(e.delta_tco2e))}`, e.note ?? "—"]),
      });
    }
  }
  return B;
}
