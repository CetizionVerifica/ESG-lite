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
import { generateImage, brandImagePrompt } from "./imagery";
import { writeNarrative } from "./ai-narrative";
import { computeGhgTables, computeGhgByFuelType, getPeriodRange, type GhgFilters, type Frequency } from "./ghg-data";
import type { Block, Report } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmt1 = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

export interface GhgResult { path: string; filename: string; pages: number; companyName: string; total: number; year: number; }

const RENEW_RE = /renew|solar|wind|hydro|geotherm/i;

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

  const total = totalsSel.total;
  const s1 = totalsSel.scope1, s2 = totalsSel.scope2, s3 = totalsSel.scope3;
  const prevTotal = totalsComp.total;
  const yoy = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  // Company name (brand row may still override inside getBrandTheme).
  const company = await AppDataSource.getRepository(Company)
    .findOne({ where: { company_id: companyId } })
    .catch(() => null);
  const companyName = company?.name ?? `Company ${companyId}`;

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
    for (const bs of row.bySite) {
      siteTotals.set(bs.siteName, (siteTotals.get(bs.siteName) ?? 0) + bs.value);
      const k = `${bs.siteName}||${row.scope}`;
      siteScopeMap.set(k, (siteScopeMap.get(k) ?? 0) + bs.value);
    }
  }

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

  const summary = nar?.summary ?? [
    `In ${yearLabel}, ${companyName} reported total greenhouse-gas emissions of ${fmt1(total)} tCO₂e across Scope 1, 2 and 3, based on ${sitesWithData.size} of ${allSiteNames.length} selected site(s).`,
    `Scope 2 (purchased electricity) contributes ${fmt(s2)} tCO₂e (${pct(s2, total)}), Scope 1 (direct combustion and fugitive sources) ${fmt(s1)} tCO₂e (${pct(s1, total)}) and Scope 3 ${fmt(s3)} tCO₂e (${pct(s3, total)}), showing where reduction effort is best focused.`,
    `Data coverage stands at ${coverage}%${missingSites.length ? `, with ${missingSites.length} site(s) yet to report` : ""}, which the recommendations address.`,
  ];
  const note = (v: string | undefined, fb: string) => (v && v.length > 4 ? v : fb);

  // Theme + all report imagery up-front, generated IN PARALLEL so the two
  // section banners (used to fill short pages tastefully) add no extra latency
  // over the single cover image we already waited for.
  const theme = await getBrandTheme(companyId, companyName);
  const heroPrompt = brandImagePrompt(
    `A clean, professional, photographic cover image representing corporate sustainability and clean energy for ${companyName} — solar panels, wind turbines or a modern industrial facility at golden hour, calm and premium`,
    theme
  );
  const sitesPrompt = brandImagePrompt(
    `A wide cinematic aerial photograph of a modern industrial campus and logistics site at dawn, clean architecture, calm premium mood, no text`,
    theme
  );
  const renewPrompt = brandImagePrompt(
    `A wide serene photograph of renewable energy infrastructure — solar farm rows and distant wind turbines in soft morning light, hopeful and premium, no text`,
    theme
  );
  const [hero, sitesImg, renewImg] = await Promise.all([
    generateImage(heroPrompt).catch(() => null),
    generateImage(sitesPrompt).catch(() => null),
    generateImage(renewPrompt).catch(() => null),
  ]);

  const B: Block[] = [];

  const coverSubtitle = siteNames.length === 1
    ? `Greenhouse Gas Emissions Inventory · ${siteNames[0]} · ${yearLabel}`
    : `Greenhouse Gas Emissions Inventory · ${allSiteNames.length} site(s) · ${yearLabel}`;

  B.push({
    type: "cover", style: "document", title: `${companyName} Carbon Accounting Report`,
    subtitle: coverSubtitle,
    caption: `${freqLabel} · ${periodName} · ${catText} · Prepared to the GHG Protocol Corporate Standard`,
    infoCards: [
      { label: "Reporting Period", value: periodName },
      { label: "Sites Covered", value: `${sitesWithData.size} of ${allSiteNames.length} site(s)` },
      { label: "Categories", value: catText },
      { label: "Standard & Boundary", value: "GHG Protocol · Operational Control" },
    ],
  });

  B.push({ type: "section", title: "Contents", kicker: "REPORT STRUCTURE" });
  B.push({
    type: "table", columns: ["#", "Section"], align: ["left", "left"],
    rows: [
      ["01", "Introduction, Scope Definitions & Data Notes"],
      ["02", "Executive Summary — Emissions at a Glance"],
      ["03", "Emissions Overview by Location"],
      ["04", "Detailed Analysis by Scope"],
      ["05", "Results & Key Findings"],
      ["06", "Data Availability & Renewables"],
      ["07", "Conclusion & Recommended Actions"],
    ],
  });

  B.push({ type: "section", title: "Introduction", kicker: "01 · ABOUT THIS REPORT" });
  B.push({ type: "narrative", body: [
    `This report presents the greenhouse gas (GHG) emissions inventory of ${companyName} for ${periodPhrase}. It quantifies direct and energy-indirect emissions across the selected operational boundary and is prepared in accordance with the GHG Protocol Corporate Accounting and Reporting Standard.`,
    `Emissions are expressed in tonnes of carbon-dioxide equivalent (tCO₂e). Figures are aggregated from site-level activity data and applicable emission factors; all values in this report are drawn directly from the recorded, approved inventory for the selected filters.`,
  ] });
  B.push({
    type: "table", title: "Scope Definitions", columns: ["Scope", "Definition"], align: ["left", "left"],
    rows: [
      ["Scope 1", "Direct emissions from owned or controlled sources — stationary and mobile combustion and fugitive releases."],
      ["Scope 2", "Indirect emissions from the generation of purchased electricity, steam, heating and cooling consumed by the organisation."],
      ["Scope 3", "Other indirect emissions occurring across the value chain (assessed where data is available)."],
    ],
  });
  B.push({ type: "callout", variant: "info", title: "Notes on Data & Assumptions", body: `Emissions are calculated from metered/recorded activity data multiplied by recognised emission factors, restricted to approved entries. This inventory covers ${sitesWithData.size} of ${allSiteNames.length} selected site(s) for ${yearLabel}; any selected site without entered data is flagged in Section 06 and excluded from totals rather than estimated.` });

  B.push({ type: "section", title: "Executive Summary", kicker: "02 · OVERVIEW" });
  B.push({
    type: "statBoard", badge: "EMISSIONS AT A GLANCE", title: `${yearLabel} Performance Summary`,
    kpis: [
      { value: fmt(total), label: "Total Emissions (tCO₂e)", sub: `${yearLabel} · all reported scopes` },
      ...(yoy !== null ? [{ value: `${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy).toFixed(1)}%`, label: "YoY Change", sub: `vs ${compLabel}` }] : []),
      { value: fmt(s1), label: "Scope 1 · Direct", sub: pct(s1, total) },
      { value: fmt(s2), label: "Scope 2 · Energy Indirect", sub: pct(s2, total) },
      { value: fmt(s3), label: "Scope 3 · Value Chain", sub: pct(s3, total) },
      { value: `${coverage}%`, label: "Data Coverage", sub: `${sitesWithData.size}/${allSiteNames.length} sites` },
    ],
    tiles: [
      { label: "Largest Site", value: topSite ? `${topSite.site_name} (${pct(topSite.t, total)})` : "—" },
      { label: "Largest Source", value: topCat ? `${topCat.emission_category} (${pct(topCat.t, total)})` : "—" },
      { label: "Renewable Energy", value: renewable > 0 ? `${fmt(renewable)} tCO₂e` : "Not entered" },
    ],
  });
  B.push({ type: "narrative", body: summary });
  B.push({ type: "chart", title: "Emissions by Scope", chartType: "pie", categories: scopes.map((s) => s.scope), series: [{ name: "tCO₂e", data: scopes.map((s) => Math.round(s.t)) }], caption: "Share of total emissions by GHG scope." });
  B.push({ type: "chart", title: "Emissions by Category", chartType: "bar", unit: "tCO₂e", categories: cats.slice(0, 8).map((c) => c.emission_category || "—"), series: [{ name: "tCO₂e", data: cats.slice(0, 8).map((c) => Math.round(c.t)) }], caption: "Top emission sources across the selected boundary." });

  B.push({ type: "section", title: "Emissions Overview by Location", kicker: "03 · SITES" });
  B.push({ type: "narrative", body: [note(nar?.siteNote, `Emissions are distributed across ${sitesWithData.size} reporting site(s), led by ${siteNames[0] ?? "—"}. Site-level visibility lets management prioritise the highest-impact locations.`)] });
  B.push({ type: "chart", title: "Total emissions — site-wise", chartType: "bar", unit: "tCO₂e", categories: siteNames, series: [{ name: "tCO₂e", data: bySite.map((r) => Math.round(r.t)) }], caption: "Gross emissions by site." });
  B.push({ type: "narrative", body: [note(nar?.scopeNote, `Splitting each site by scope shows whether direct combustion (Scope 1) or purchased energy (Scope 2) dominates locally, guiding site-specific abatement.`)] });
  B.push({
    type: "chart", title: "Site-wise & scope-wise", chartType: "bar", unit: "tCO₂e", categories: siteNames,
    series: scopeNames.map((sc) => ({ name: sc, data: siteNames.map((sn) => Math.round(siteScopeMap.get(`${sn}||${sc}`) ?? 0)) })),
    caption: "Each site split by GHG scope.",
  });
  B.push({
    type: "table", title: "Site × Scope (tCO₂e)", columns: ["Site", ...scopeNames, "Total"], align: ["left", ...scopeNames.map(() => "right" as const), "right"],
    rows: siteNames.map((sn) => {
      const vals = scopeNames.map((sc) => siteScopeMap.get(`${sn}||${sc}`) ?? 0);
      return [sn, ...vals.map((v) => fmt(v)), fmt(vals.reduce((a, b) => a + b, 0))];
    }),
  });
  if (sitesImg) B.push({ type: "image", prompt: sitesPrompt, layout: "banner", src: sitesImg, caption: "Operational sites — illustrative imagery." });

  B.push({ type: "section", title: "Detailed Analysis by Scope", kicker: "04 · CATEGORIES & FUEL TYPES" });
  B.push({ type: "narrative", body: [note(nar?.categoryNote, `Within each scope, emissions are broken down by category and fuel type (e.g. Diesel, Coal, Electricity, refrigerants), linking every figure to the activity that drives it — the basis for fuel-switching and efficiency decisions.`)] });
  const scopeLabel: Record<string, string> = { "scope 1": "Direct GHG Emissions: Scope 1", "scope 2": "Indirect GHG Emissions: Scope 2", "scope 3": "Indirect GHG Emissions: Scope 3" };
  for (const sc of scopeNames) {
    const rows = scopeCat.filter((r) => r.scope === sc && r.t > 0).sort((a, b) => b.t - a.t);
    if (!rows.length) continue;
    const scTotal = rows.reduce((a, b) => a + b.t, 0);
    B.push({ type: "section", title: scopeLabel[(sc || "").toLowerCase()] ?? sc, kicker: `${sc.toUpperCase()} · ${fmt(scTotal)} tCO₂e`, flow: true });
    B.push({ type: "chart", title: `${sc} — category distribution`, chartType: "pie", categories: rows.map((r) => r.emission_category || "—"), series: [{ name: "tCO₂e", data: rows.map((r) => Math.round(r.t)) }], caption: `${sc} emissions by emission category.` });
    B.push({
      type: "table", title: `${sc} category detail`, columns: ["Category", "Emissions", "Share of scope"], align: ["left", "right", "right"],
      rows: rows.map((r) => [r.emission_category || "Unspecified", fmt(r.t), pct(r.t, scTotal)]),
    });

    // One level deeper: the fuel type driving each category (e.g. Stationary
    // Combustion -> Diesel / Coal), so every figure ties back to an activity.
    const scopeFuels = fuelRows.filter((f) => f.scope === sc && f.emissions > 0);
    if (scopeFuels.length) {
      // Categories with no meaningful fuel-type breakdown (e.g. Purchased
      // Electricity is a single energy stream, not a mix of fuels) are excluded
      // from the fuel-type section in both the web report and the branded PDF.
      const NO_FUEL_BREAKDOWN = /purchased electricity/i;
      const fuelTableRows: string[][] = [];
      for (const r of rows) {
        const catName = r.emission_category || "Unspecified";
        if (NO_FUEL_BREAKDOWN.test(catName)) continue;
        const fuels = scopeFuels
          .filter((f) => f.category.toLowerCase() === catName.toLowerCase())
          .sort((a, b) => b.emissions - a.emissions);
        if (!fuels.length) continue;
        const catTotal = fuels.reduce((a, b) => a + b.emissions, 0);
        fuels.forEach((f, i) => {
          fuelTableRows.push([
            i === 0 ? catName : "",
            f.fuelType,
            fmt(f.emissions),
            pct(f.emissions, catTotal),
          ]);
        });
      }
      if (fuelTableRows.length) {
        B.push({
          type: "table",
          title: `${sc} — fuel / source within each category`,
          columns: ["Category", "Fuel / source", "Emissions", "Share of category"],
          align: ["left", "left", "right", "right"],
          rows: fuelTableRows,
          caption: "Fuel or spend source driving each reporting category.",
        });
      }
    }
  }

  B.push({ type: "section", title: "Results & Key Findings", kicker: "05 · WHAT THE DATA SHOWS" });
  const findings = [
    `Total ${yearLabel} emissions were ${fmt1(total)} tCO₂e${yoy !== null ? ` (${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(1)}% vs ${compLabel})` : ""}.`,
    topSite ? `${topSite.site_name} is the largest contributing site at ${fmt(topSite.t)} tCO₂e (${pct(topSite.t, total)} of total).` : "",
    `${s2 >= s1 ? "Scope 2 (purchased energy)" : "Scope 1 (direct)"} dominates the footprint at ${pct(Math.max(s1, s2), total)}, indicating the highest-leverage reduction pathway.`,
    topCat ? `${topCat.emission_category} is the single largest emission source (${pct(topCat.t, total)}).` : "",
  ].filter(Boolean);
  findings.forEach((f, i) => B.push({ type: "callout", variant: i === 0 ? "success" : "info", title: `Finding ${i + 1}`, body: f }));

  B.push({ type: "section", title: "Data Availability & Renewables", kicker: "06 · COVERAGE" });
  B.push({ type: "narrative", body: [note(nar?.coverageNote, `Data completeness determines the confidence management can place in these figures. Any selected site marked below has not been entered by the user and is excluded from totals.`)] });
  B.push(renewable > 0
    ? { type: "callout", variant: "success", title: "Renewable energy", body: `${fmt1(renewable)} tCO₂e of renewable-linked activity recorded in ${yearLabel}.` }
    : { type: "callout", variant: "warning", title: "Renewable energy — data not available", body: "No renewable energy data has been entered for this period. Recording renewable consumption will let the report quantify avoided emissions." });
  B.push({
    type: "table", title: "Site reporting status", columns: ["Site", "Status", "Emissions (tCO₂e)"], align: ["left", "left", "right"],
    rows: allSiteNames.map((n) => sitesWithData.has(n)
      ? [n, "Reported ✓", fmt(siteTotals.get(n) ?? 0)]
      : [n, "Not entered by user", "—"]),
    caption: missingSites.length ? `${missingSites.length} selected site(s) have no data entered for ${yearLabel}.` : "All selected sites have reported data.",
  });
  if (renewImg) B.push({ type: "image", prompt: renewPrompt, layout: "banner", src: renewImg, caption: "Renewable energy — illustrative imagery." });

  B.push({ type: "section", title: "Conclusion & Recommended Actions", kicker: "07 · NEXT STEPS" });
  B.push({ type: "narrative", body: [
    `This report provides a structured view of ${companyName}'s ${yearLabel} greenhouse-gas footprint across the selected sites, scopes and emission categories. The results give management a clear, defensible basis for prioritising reduction effort and improving data quality.`,
    `The recommended actions below sequence the next steps by impact — closing data gaps first, then addressing the largest emission sources.`,
  ] });
  const recs = nar?.recommendations ?? [
    "Close data gaps at non-reporting sites to reach full coverage before the next cycle.",
    "Prioritise Scope 2 reduction through renewable electricity procurement or on-site generation.",
    "Set a validated, science-based reduction target aligned to a 1.5 °C pathway.",
    "Begin capturing renewable-energy consumption to quantify avoided emissions.",
  ];
  recs.slice(0, 4).forEach((r, i) => B.push({ type: "callout", variant: i % 2 === 0 ? "info" : "success", title: `Action ${i + 1}`, body: r }));

  // The period is part of the file identity — two months of the same year must
  // not overwrite each other in generated-reports/.
  const periodSuffix = frequency === "monthly" && filters.month
    ? `-m${String(filters.month).padStart(2, "0")}`
    : frequency === "quarterly" && filters.quarter
    ? `-q${filters.quarter}`
    : "";
  const slug = `ghg-${companyId}-${selectedYear}-${yearType}${periodSuffix}`;

  const doc: Report = { client: `co-${companyId}`, slug, docTitle: `${companyName} — GHG Report ${yearLabel}`, blocks: B };
  const variety = buildVariety(theme, companyId * 1000 + selectedYear, hero);
  variety.docCoverMode = "split"; // clean, professional cover (real logo + hero panel)
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
