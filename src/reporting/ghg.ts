// GHG report generator for ESG-Lite — formal, board-ready structure
// (Introduction + Scope Definitions + Data Notes -> Executive Summary ->
// Overview by location -> detailed per-Scope analysis -> Results & Key Findings
// -> Conclusion) rendered in the client's brand.
//
// Every number comes from the SAME computation the on-screen tables / plain
// "Download PDF" use (computeGhgTables in ./ghg-data — the `Emission` entity,
// status=APPROVED, filtered by site/category/date range), so the branded PDF
// matches the screen exactly. OpenRouter writes only prose + a cover image.
import { mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { AppDataSource } from "../config/data-source";
import { Company } from "../entities/Company";
import { Emission, EmissionStatus } from "../entities/Emission";
import { getBrandTheme } from "./brands";
import { renderDocument } from "./render";
import { htmlToPdf } from "./print";
import { buildVariety } from "./variety";
import { writeNarrative } from "./ai-narrative";
import { computeGhgTables, computeGhgByFuelType, getPeriodRange, type GhgFilters, type Frequency } from "./ghg-data";
import type { Block, Report } from "./types";
import { baseYearSummary } from "../scope3/baseYear/service"; // S3-14
import { computeScope3, consolidationLabel, hasScope3, gwpText, scope3Blocks, type Scope3BaseYearSummary, type Scope3Report } from "./ghg-scope3";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }); // #209: tCO₂e to 3 dp
const fmt1 = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

export interface GhgResult { path: string; filename: string; pages: number; companyName: string; total: number; year: number; }

const RENEW_RE = /renew|solar|wind|hydro|geotherm/i;

/** Mix two #rrggbb colours; `t` is the weight of `a`. */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => { const n = parseInt(h.replace("#", "").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

const SCOPE_LABEL: Record<string, string> = { "scope 1": "Direct emissions", "scope 2": "Energy indirect", "scope 3": "Value chain" };
const scopeLabel = (sc: string) => SCOPE_LABEL[sc.toLowerCase()] ?? sc;

/** Drop a repeated category prefix: ("Stationary Combustion - Diesel", "Stationary Combustion") → "Diesel". */
function fuelName(fuel: string, category: string): string {
  const prefix = `${category.toLowerCase()} - `;
  return fuel.toLowerCase().startsWith(prefix) && fuel.length > prefix.length ? fuel.slice(prefix.length) : fuel;
}

/** "Stationary Combustion - Natural gas" → "Natural gas" for headlines. */
const shortLabel = (s: string) => (s.includes(" - ") ? s.split(" - ").pop()!.trim() : s);

/**
 * Build the branded GHG PDF for a set of on-screen filters. `companyId` is used
 * only for the brand theme / company name; every emissions figure comes from
 * computeGhgTables(filters).
 */
export async function generateGhgReport(filters: GhgFilters, companyId: number): Promise<GhgResult> {
  const selectedYear = filters.year;
  const yearType = filters.yearType;

  // Exact same figures as the on-screen tables / plain Download PDF.
  const data = await computeGhgTables(filters);
  // Fuel type within each category (Stationary Combustion -> Diesel, ...).
  const fuelRows = await computeGhgByFuelType(filters).catch(() => []);
  const compYear = data.filters.compareYear;

  // Frequency NARROWS the whole report to a single period inside the reporting
  // year (a month or a quarter); yearly keeps the full year. The same resolution
  // computeGhgTables used for its date filter is repeated here for the labels.
  const frequency: Frequency = filters.frequency ?? "yearly";
  const freqLabel = frequency === "monthly" ? "Monthly" : frequency === "quarterly" ? "Quarterly" : "Yearly";
  const periodSel = getPeriodRange(yearType, selectedYear, frequency, filters.month, filters.quarter);
  const periodComp = getPeriodRange(yearType, compYear, frequency, filters.month, filters.quarter);

  const totalsSel = data.totals[String(selectedYear)];
  const totalsComp = data.totals[String(compYear)];
  const overviewRows = data.tables.table_overviewByLocations_selectedYear.rows;
  const overviewSites = data.tables.table_overviewByLocations_selectedYear.siteTotals;

  const total = totalsSel.total;
  const s1 = totalsSel.scope1, s2 = totalsSel.scope2, s3 = totalsSel.scope3;
  const prevTotal = totalsComp.total;
  // Rounded to the one decimal every label prints, so a change shown as 0.0%
  // reads as "unchanged" everywhere instead of "fell 0.0%" or "▲ +0.0%".
  const yoy = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null;
  const yoyBadge = (v: number) => (v === 0 ? "unchanged" : `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`);

  // Company name (brand row may still override inside getBrandTheme).
  const company = await AppDataSource.getRepository(Company)
    .findOne({ where: { company_id: companyId } })
    .catch(() => null);
  const companyName = company?.name ?? `Company ${companyId}`;

  // S3-13: Scope 3 by GHG Protocol category, boundary approach and GWP sets.
  let scope3: Scope3Report | null = null;
  try {
    // Scope 1/2-only reports stay as they were: the Scope 3 pages only when the report has Scope 3.
    const computed = await computeScope3(filters, companyId);
    scope3 = hasScope3(computed) ? computed : null;
  } catch (e: any) {
    console.error("GHG report: Scope 3 section skipped:", e?.code ?? e?.message ?? e);
  }
  // S3-14: the company's frozen Scope 3 base year and approved recalculations (null = none set).
  let scope3BaseYear: Scope3BaseYearSummary | null = null;
  if (scope3) {
    try {
      scope3BaseYear = await baseYearSummary(companyId);
    } catch (e: any) {
      console.error("GHG report: Scope 3 base year skipped:", e?.code ?? e?.message ?? e);
    }
  }
  const boundaryText = consolidationLabel(scope3?.consolidation_approach ?? company?.consolidation_approach);

  // Period labels reflect the CY/FY filter AND the selected month/quarter, so a
  // narrowed report never describes itself as covering the whole year.
  const yearLabel = periodSel.label;                 // e.g. "FY2025" | "June 2024"
  const compLabel = periodComp.label;                // same period, prior year
  const fullYearName = yearType === "FY"
    ? `Financial Year (FY) ${selectedYear}`
    : `Calendar Year (CY) ${selectedYear}`;
  const periodName = frequency === "yearly" ? fullYearName : periodSel.label;
  // Reads correctly in prose for both "the financial year (fy) 2025" and "June 2024".
  const periodPhrase = frequency === "yearly" ? `the ${fullYearName.toLowerCase()}` : periodSel.label;

  // Aggregate the overview rows into the shapes the branded blocks expect.
  const siteTotals = new Map<string, number>();      // siteName -> total
  const siteScopeMap = new Map<string, number>();    // `${siteName}||${scope}` -> total
  const catTotals = new Map<string, number>();       // category -> total
  const scopeSet = new Set<string>();

  // Only Scope 1/2/3 rows feed the charts/tables so every visual reconciles with
  // the on-screen Table 1 totals (which sum by scope). Rows with no scope — e.g.
  // "Renewable Electricity" — are excluded here and reported separately below,
  // exactly like the screen (their tCO₂e is NOT part of total emissions).
  const CORE_SCOPES = new Set(["Scope 1", "Scope 2", "Scope 3"]);
  for (const row of overviewRows) {
    if (!CORE_SCOPES.has(row.scope)) continue;
    scopeSet.add(row.scope);
    catTotals.set(row.category, (catTotals.get(row.category) ?? 0) + row.total);
  }
  // D14: a site's figures are its own kg rounded once (computeGhgTables
  // siteTotals), never its category cells added up, so they are the figures
  // EDE and Overview show for the site.
  const SCOPE_FIELD = { "Scope 1": "scope1", "Scope 2": "scope2", "Scope 3": "scope3" } as const;
  for (const s of overviewSites) {
    siteTotals.set(s.siteName, s.total);
    for (const sc of scopeSet) siteScopeMap.set(`${s.siteName}||${sc}`, s[SCOPE_FIELD[sc as keyof typeof SCOPE_FIELD]]);
  }
  // A scope's figure is Table 1's (its kg rounded once), never its categories added up.
  const scopeTotal = (sc: string) => (sc === "Scope 1" ? s1 : sc === "Scope 2" ? s2 : sc === "Scope 3" ? s3 : 0);

  const scopeNames = [...scopeSet].filter(Boolean).sort();
  const bySite = [...siteTotals.entries()]
    .map(([site_name, t]) => ({ site_name, t }))
    .sort((a, b) => b.t - a.t);
  const siteNames = bySite.map((r) => r.site_name);
  const cats = [...catTotals.entries()]
    .map(([emission_category, t]) => ({ emission_category, t }))
    .sort((a, b) => b.t - a.t);
  const scopeCat = overviewRows
    .filter((r) => CORE_SCOPES.has(r.scope))
    .map((r) => ({ scope: r.scope, emission_category: r.category, t: r.total }));

  // Scopes for the pie / split (fixed order, only non-zero shown).
  const scopes = [
    { scope: "Scope 1", t: s1 },
    { scope: "Scope 2", t: s2 },
    { scope: "Scope 3", t: s3 },
  ].filter((x) => x.t > 0);

  // Renewable energy is reported from ALL rows (incl. no-scope ones excluded
  // from the totals above) — it appears in its own callout, never in totals.
  const renewable = overviewRows.filter((r) => RENEW_RE.test(r.category)).reduce((a, b) => a + b.total, 0);

  // Coverage is measured against the SELECTED sites.
  const selSites = await AppDataSource.query(
    `SELECT site_id, name FROM site WHERE site_id = ANY($1) ORDER BY name`,
    [filters.siteIds],
  ).catch(() => [] as { site_id: number; name: string }[]);
  const allSiteNames: string[] = selSites.length
    ? selSites.map((s: any) => s.name)
    : siteNames;
  const sitesWithData = new Set(siteNames);
  const missingSites = allSiteNames.filter((n) => !sitesWithData.has(n));
  const coverage = allSiteNames.length ? Math.round((sitesWithData.size / allSiteNames.length) * 100) : 100;

  // Months with data (qualitative — feeds the narrative only, never rendered as a figure).
  const rangeSel = periodSel;
  let monthsWithData = 0;
  try {
    const monthQb = AppDataSource.getRepository(Emission)
      .createQueryBuilder("emission")
      .leftJoin("emission.site", "site")
      .leftJoin("emission.category", "category")
      .where("emission.status = :status", { status: EmissionStatus.APPROVED })
      .andWhere("site.site_id IN (:...siteIds)", { siteIds: filters.siteIds })
      .andWhere("emission.date_of_reporting >= :startDate", { startDate: rangeSel.startDate })
      .andWhere("emission.date_of_reporting <= :endDate", { endDate: rangeSel.endDate });
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      monthQb.andWhere("category.category_id IN (:...categoryIds)", { categoryIds: filters.categoryIds });
    }
    const monthRows = await monthQb
      .select("DATE_TRUNC('month', emission.date_of_reporting)", "m")
      .distinct(true)
      .getRawMany();
    monthsWithData = monthRows.length;
  } catch {
    monthsWithData = 0;
  }

  const topSite = bySite[0], topCat = cats[0];
  const catCount = filters.categoryIds?.length ?? 0;
  const catText = catCount > 0 ? `${catCount} selected categor${catCount === 1 ? "y" : "ies"}` : "All categories";

  const nar = await writeNarrative({
    companyName, year: selectedYear, total, scope1: s1, scope2: s2, coverage,
    sites: bySite.map((r) => ({ name: r.site_name, t: r.t })),
    categories: cats.map((c) => ({ name: c.emission_category || "Unspecified", t: c.t })),
    missingSites, renewable, months: monthsWithData,
  }).catch(() => null);

  const note = (v: string | undefined, fb: string) => (v && v.length > 4 ? v : fb);

  const theme = await getBrandTheme(companyId, companyName);

  // One colour per scope on every chart: brand primary, accent, and a light tint
  // of the accent. The comparison period is always neutral grey.
  const SCOPE_COLOR: Record<string, string> = {
    "Scope 1": theme.colors.primary,
    "Scope 2": theme.colors.accent,
    "Scope 3": mixHex(theme.colors.accent, "#ffffff", 0.5),
  };
  const PRIOR_GREY = "#B9C1CC";
  const unit = "tCO₂e";
  const source = `Source: ESGLite, approved emission entries, ${yearLabel}.`;
  const siteCount = `${sitesWithData.size} of ${allSiteNames.length}`;

  const B: Block[] = [];

  // ---- Cover ----
  const coverSites = allSiteNames.length <= 3
    ? allSiteNames.join(", ").replace(/, ([^,]*)$/, " and $1")
    : `${allSiteNames.length} sites`;
  B.push({
    type: "cover", style: "band",
    kicker: "Greenhouse Gas Emissions Report",
    eyebrow: `${freqLabel} report · ${periodName}`,
    title: "Carbon Accounting Report",
    subtitle: `Scope 1, 2 and 3 emissions across ${coverSites}${catCount > 0 ? ` · ${catText.toLowerCase()}` : ""}`,
    hero: {
      value: fmt(total),
      unit: `${unit} total emissions`,
      delta: yoy !== null ? `${yoyBadge(yoy)} vs ${compLabel}` : undefined,
    },
    meta: [
      { label: "Sites covered", value: siteCount },
      { label: "Boundary", value: boundaryText },
      { label: "Standard", value: "GHG Protocol Corporate" },
      { label: "Issued", value: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }) },
    ],
  });

  // A period with no approved emissions gets one plain page saying so, then the
  // data-availability page, instead of empty charts and header-only tables.
  const hasData = total > 0;
  if (!hasData) {
    B.push({ type: "section", kicker: "01 · Summary", title: `No approved emissions were found for ${yearLabel}.` });
    B.push({
      type: "paragraph",
      body: `The selected sites and categories have no approved emission entries for ${periodName}. Entries that are still in draft or awaiting approval are not included in this report. The page that follows shows which sites have reported.`,
    });
  } else {
    // ---- 01 Executive summary ----
    const topScope = scopes.slice().sort((a, b) => b.t - a.t)[0];
    const scopeWhat: Record<string, string> = { "Scope 1": "direct combustion", "Scope 2": "purchased electricity", "Scope 3": "the value chain" };
    const headline = [
      yoy !== null
        ? yoy === 0
          ? `Emissions were unchanged at ${fmt(total)} ${unit}.`
          : `Emissions ${yoy < 0 ? "fell" : "rose"} ${Math.abs(yoy).toFixed(1)}% to ${fmt(total)} ${unit}.`
        : `Total emissions were ${fmt(total)} ${unit}.`,
      topScope ? `${topScope.scope} (${scopeWhat[topScope.scope] ?? topScope.scope}) is ${pct(topScope.t, total)} of the footprint.` : "",
    ].filter(Boolean).join(" ");
    B.push({ type: "section", kicker: "01 · Executive summary", title: headline });
    B.push({
      type: "kpiRow",
      tiles: [
        { label: "Total emissions", value: fmt(total), sub: yoy !== null ? `${unit} · ${yoyBadge(yoy)} vs ${compLabel}` : unit },
        { label: "Scope 1 · direct", value: fmt(s1), sub: `${pct(s1, total)} of total`, swatch: SCOPE_COLOR["Scope 1"] },
        { label: "Scope 2 · electricity", value: fmt(s2), sub: `${pct(s2, total)} of total`, swatch: SCOPE_COLOR["Scope 2"] },
        { label: "Scope 3 · value chain", value: fmt(s3), sub: `${pct(s3, total)} of total`, swatch: SCOPE_COLOR["Scope 3"] },
      ],
    });
    if (scopes.length > 1) {
      B.push({
        type: "shareBar", title: topScope ? `${topScope.scope} drives the footprint` : "Emissions by scope", subtitle: `Share of total emissions by scope, ${unit}`,
        parts: scopes.map((s) => ({ label: s.scope, value: s.t, color: SCOPE_COLOR[s.scope] })), unit, caption: source,
      });
    }
    if (prevTotal > 0) {
      const diff = total - prevTotal;
      B.push({
        type: "hbar", title: yoy === 0 ? `Unchanged on ${compLabel}` : `${diff < 0 ? "Down" : "Up"} ${fmt(Math.abs(diff))} ${unit} on ${compLabel}`, subtitle: "Total emissions, same period prior year",
        rows: [{ label: compLabel, value: prevTotal, color: PRIOR_GREY }, { label: yearLabel, value: total }], color: theme.colors.primary, unit,
        caption: `${compLabel} uses the same sites, categories and period. ${source}`,
      });
    }
    const messages: { lead?: string; text: string }[] = [];
    if (topScope) messages.push({ lead: "Biggest lever.", text: `${topScope.scope} is ${fmt(topScope.t)} ${unit} (${pct(topScope.t, total)}), the largest reduction lever.` });
    if (topSite && bySite.length > 1) messages.push({ lead: "Largest site.", text: `${topSite.site_name} emits ${fmt(topSite.t)} ${unit}, ${pct(topSite.t, total)} of the total.` });
    if (topCat && !(topScope && Math.abs(topCat.t - topScope.t) < 0.5)) messages.push({ lead: "Largest source.", text: `${topCat.emission_category || "Unspecified"} accounts for ${pct(topCat.t, total)} of emissions.` });
    messages.push(missingSites.length
      ? { lead: "Coverage gap.", text: `${missingSites.length} of ${allSiteNames.length} selected site(s) have not reported for ${yearLabel}.` }
      : { lead: "Complete coverage.", text: `All ${allSiteNames.length} selected site(s) reported${renewable > 0 ? "" : "; renewable energy has not been entered yet"}.` });
    B.push({ type: "bullets", title: "Key messages", items: messages });

    // ---- 02 Emissions by site ----
    const topSiteScope = topSite
      ? scopeNames.map((sc) => ({ sc, v: siteScopeMap.get(`${topSite.site_name}||${sc}`) ?? 0 })).sort((a, b) => b.v - a.v)[0]
      : undefined;
    B.push({
      type: "section", kicker: "02 · Emissions by site",
      title: topSite && bySite.length > 1
        ? `${topSite.site_name} accounts for ${pct(topSite.t, total)} of emissions${topSiteScope && topSiteScope.v > topSite.t / 2 ? `, mostly ${scopeWhat[topSiteScope.sc] ?? topSiteScope.sc}` : ""}.`
        : `Emissions by site for ${yearLabel}.`,
    });
    // D14: the chart's total and the table's Total row are the report's own
    // figures (Table 1), not the rounded site figures added up.
    B.push({
      type: "stackedBars", title: "Emissions by site and scope", subtitle: `${unit}; bar labels show each site's total and share`,
      series: scopeNames.map((sc) => ({ name: sc, color: SCOPE_COLOR[sc] ?? theme.colors.primary })),
      rows: siteNames.map((sn) => ({ label: sn, values: scopeNames.map((sc) => siteScopeMap.get(`${sn}||${sc}`) ?? 0) })),
      total, caption: source,
    });
    B.push({
      type: "table", title: "Site × scope", subtitle: unit,
      columns: ["Site", ...scopeNames, "Total", "Share"], align: ["left", ...scopeNames.map(() => "right" as const), "right", "right"],
      rows: [
        ...siteNames.map((sn) => {
          const vals = scopeNames.map((sc) => siteScopeMap.get(`${sn}||${sc}`) ?? 0);
          const t = siteTotals.get(sn) ?? 0;
          return [sn, ...vals.map((v) => fmt(v)), fmt(t), pct(t, total)];
        }),
        ...(siteNames.length > 1
          ? [["Total", ...scopeNames.map((sc) => fmt(scopeTotal(sc))), fmt(total), "100.0%"]]
          : []),
      ],
      totalRow: siteNames.length > 1,
      caption: `${source} Rows are rounded, so totals can differ from their sum by 1.`,
    });
    B.push({ type: "paragraph", body: note(nar?.siteNote, `Splitting each site by scope shows where abatement belongs: whether on-site combustion (Scope 1) or purchased energy (Scope 2) dominates locally.`) });

    // ---- 03 Detailed analysis by scope ----
    // For each scope: the category mix, or (when the scope has one category) the
    // fuel / source mix inside it, so every scope gets one ranked chart.
    const NO_FUEL_BREAKDOWN = /purchased electricity/i;
    const scopeParts = scopeNames.map((sc) => {
      const rows = scopeCat.filter((r) => r.scope === sc && r.t > 0).sort((a, b) => b.t - a.t);
      const scTotal = scopeTotal(sc); // Table 1's figure (D14)
      const fuels = fuelRows
        .filter((f) => f.scope === sc && f.emissions > 0 && !NO_FUEL_BREAKDOWN.test(f.category))
        .sort((a, b) => b.emissions - a.emissions);
      let bars: { label: string; value: number }[];
      let what: string;
      if (rows.length > 1) {
        bars = rows.map((r) => ({ label: r.emission_category || "Unspecified", value: r.t }));
        what = "by category";
      } else if (fuels.length > 1) {
        bars = fuels.map((f) => ({ label: fuelName(f.fuelType, f.category), value: f.emissions }));
        what = `${rows[0]?.emission_category ?? sc}, by fuel / source`;
      } else if (sc === "Scope 2" && bySite.length > 1) {
        bars = siteNames.map((sn) => ({ label: sn, value: siteScopeMap.get(`${sn}||${sc}`) ?? 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
        what = `${rows[0]?.emission_category ?? "Purchased electricity"}, by site`;
      } else {
        bars = rows.map((r) => ({ label: r.emission_category || "Unspecified", value: r.t }));
        what = "by category";
      }
      return { sc, rows, scTotal, fuels, bars, what };
    }).filter((p) => p.scTotal > 0);

    const leads = scopeParts
      .filter((p) => p.bars.length > 1)
      .map((p) => `${shortLabel(p.bars[0].label)} is ${pct(p.bars[0].value, p.scTotal)} of ${p.sc}`);
    B.push({
      type: "section", kicker: "03 · Detailed analysis by scope",
      title: leads.length ? `${leads.slice(0, 2).join("; ")}.` : "Where each scope's emissions come from.",
    });
    for (const p of scopeParts) {
      B.push({
        type: "groupBars", name: p.sc, color: SCOPE_COLOR[p.sc] ?? theme.colors.primary,
        subtitle: `${scopeLabel(p.sc)} · ${p.what}`, total: `${fmt(p.scTotal)} ${unit} · ${pct(p.scTotal, total)}`,
        rows: p.bars, shareOf: p.scTotal, unit, caption: `Bar labels: ${unit} and share of ${p.sc}.`,
      });
    }
    // Fuel / source detail for every category that has a breakdown.
    const fuelTable: (string)[][] = [];
    for (const p of scopeParts) {
      let firstOfScope = true;
      for (const r of p.rows) {
        const catName = r.emission_category || "Unspecified";
        if (NO_FUEL_BREAKDOWN.test(catName)) continue;
        const fuels = p.fuels.filter((f) => f.category.toLowerCase() === catName.toLowerCase());
        if (!fuels.length) continue;
        // Same denominator as the page headline and the scope bars: the category's total.
      const catTotal = r.t;
        fuels.forEach((f, i) => {
          fuelTable.push([firstOfScope ? p.sc : "", i === 0 ? catName : "", fuelName(f.fuelType, catName), fmt(f.emissions), pct(f.emissions, catTotal)]);
          firstOfScope = false;
        });
      }
    }
    if (fuelTable.length) {
      B.push({
        type: "table", title: "Fuel and source detail", subtitle: unit,
        columns: ["Scope", "Category", "Fuel / source", "Emissions", "Share of category"], align: ["left", "left", "left", "right", "right"],
        rows: fuelTable, caption: note(nar?.categoryNote, "Fuel or spend source driving each reporting category. Purchased electricity is a single energy stream and has no fuel breakdown."),
      });
    }

    // ---- 03 Scope 3 by category, boundary, methodology, data quality, base year (S3-13) ----
    if (scope3) B.push(...scope3Blocks(scope3, scope3BaseYear, source));

    // ---- 04 Findings and recommended actions ----
    B.push({ type: "section", kicker: "04 · Findings and recommended actions", title: topScope ? `The findings point to ${scopeWhat[topScope.scope] ?? topScope.scope} as the first priority.` : "What the data shows, and where to act first." });
    const findings: { value: string; text: string }[] = [];
    if (yoy !== null) {
      findings.push(yoy === 0
        ? { value: "0.0%", text: `Total emissions were unchanged at ${fmt(total)} ${unit} against ${compLabel}.` }
        : { value: `${yoy > 0 ? "+" : "−"}${Math.abs(yoy).toFixed(1)}%`, text: `Total emissions ${yoy < 0 ? "fell" : "rose"} from ${fmt(prevTotal)} to ${fmt(total)} ${unit} against ${compLabel}.` });
    }
    if (topSite) findings.push({ value: pct(topSite.t, total), text: `${topSite.site_name} is the largest site at ${fmt(topSite.t)} ${unit}.` });
    if (topScope) findings.push({ value: pct(topScope.t, total), text: `${topScope.scope} (${scopeWhat[topScope.scope] ?? topScope.scope}) dominates the footprint.` });
    // The largest category often IS the largest scope (e.g. purchased electricity);
    // then the fourth finding is the main source inside another scope instead.
    const sameAsScope = topCat && topScope && Math.abs(topCat.t - topScope.t) < 0.5;
    if (topCat && !sameAsScope) findings.push({ value: pct(topCat.t, total), text: `${topCat.emission_category || "Unspecified"} is the single largest emission source.` });
    else {
      const other = scopeParts.find((p) => p.sc !== topScope?.scope && p.bars.length > 1);
      if (other) findings.push({ value: pct(other.bars[0].value, other.scTotal), text: `${shortLabel(other.bars[0].label)} is the main source in ${other.sc}, at ${fmt(other.bars[0].value)} ${unit}.` });
    }
    B.push({ type: "figures", items: findings.slice(0, 4) });
    const recs = (nar?.recommendations ?? [
      "Close data gaps at non-reporting sites to reach full coverage before the next cycle.",
      "Prioritise Scope 2 reduction through renewable electricity procurement or on-site generation.",
      "Set a validated, science-based reduction target aligned to a 1.5 °C pathway.",
      "Begin capturing renewable-energy consumption to quantify avoided emissions.",
    ]).slice(0, 4);
    B.push({
      type: "table", title: "Recommended actions", subtitle: "ordered by expected impact",
      columns: ["Priority", "Action"], align: ["left", "left"],
      rows: recs.map((r, i) => [i < 2 ? { text: "High", pill: "high" as const } : { text: "Medium", pill: "medium" as const }, r]),
    });
  }

  // ---- 05 Data availability and methodology ----
  B.push({
    type: "section", kicker: `${hasData ? "05" : "02"} · Data availability and methodology`,
    title: missingSites.length
      ? `${missingSites.length} of ${allSiteNames.length} selected sites have not reported for ${yearLabel}.`
      : `All selected sites reported.${renewable > 0 ? "" : " Renewable energy is the one open data gap."}`,
  });
  B.push({
    type: "table", title: "Site reporting status", subtitle: yearLabel,
    columns: ["Site / data stream", "Status", `Emissions (${unit})`], align: ["left", "left", "right"],
    rows: [
      ...allSiteNames.map((n) => sitesWithData.has(n)
        ? [n, { text: "✓ Reported", pill: "ok" as const }, fmt(siteTotals.get(n) ?? 0)]
        : [n, { text: "! Not entered", pill: "warn" as const }, "—"]),
      renewable > 0
        ? ["Renewable energy", { text: "✓ Reported", pill: "ok" as const }, `${fmt(renewable)} (not in totals)`]
        : ["Renewable energy", { text: "! Not entered", pill: "warn" as const }, "—"],
    ],
    caption: note(nar?.coverageNote, missingSites.length ? `Sites without entered data are excluded from totals rather than estimated.` : "All selected sites have reported data."),
  });
  B.push({
    type: "notes", items: [
      { heading: "Boundary and scopes", body: `${boundaryText} approach across ${siteCount} selected site(s). Scope 1 covers direct combustion and fugitive sources; Scope 2 covers purchased electricity; Scope 3 covers value-chain categories where data exists.` },
      { heading: "Exclusions", body: "Sites without entered data are flagged above and excluded from totals rather than estimated. Renewable energy is reported separately and never netted from totals." },
      { heading: "Calculation", body: `Recorded activity data multiplied by the emission factor assigned to each category, restricted to approved entries, reported in tonnes of CO₂-equivalent${scope3?.gwp_sets.length ? ` using 100-year GWP values from IPCC ${gwpText(scope3.gwp_sets)}` : ""}.${scope3 ? " Scope 3 methods, data sources and data quality are set out per category in section 03." : ""}` },
      prevTotal > 0
        ? { heading: "Comparisons", body: `${compLabel} figures use the same sites, categories and period, so changes reflect activity rather than a change of scope.` }
        : { heading: "Comparisons", body: `No approved data exists for ${compLabel}, so this report shows no year-on-year change.` },
    ],
  });

  // The period is part of the file identity — two months of the same year must
  // not overwrite each other in generated-reports/.
  const periodSuffix = frequency === "monthly" && filters.month
    ? `-m${String(filters.month).padStart(2, "0")}`
    : frequency === "quarterly" && filters.quarter
    ? `-q${filters.quarter}`
    : "";
  const slug = `ghg-${companyId}-${selectedYear}-${yearType}${periodSuffix}`;

  const doc: Report = {
    client: `co-${companyId}`, slug, docTitle: `GHG Emissions Report · ${yearLabel}`, blocks: B,
    runningLeft: companyName,
    runningFooter: "GHG Protocol Corporate Standard · approved data",
  };
  const variety = buildVariety(theme, companyId * 1000 + selectedYear);
  variety.sectionStyle = "headline";
  const html = renderDocument(doc, theme, variety);

  const outDir = join(process.cwd(), "generated-reports");
  mkdirSync(outDir, { recursive: true });
  // The download name stays readable; the file on disk gets a random suffix so
  // two requests with different sites, categories or compare year (which the
  // slug does not encode) never write to or serve the same file. The caller
  // deletes it once it has been sent.
  const filename = `${slug}.pdf`;
  const path = join(outDir, `${slug}-${randomBytes(8).toString("hex")}.pdf`);
  const res = await htmlToPdf(html, path, []);
  return { path, filename, pages: res.pageCount, companyName, total, year: selectedYear };
}
