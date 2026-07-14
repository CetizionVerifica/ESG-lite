// GHG report generator for ESG-Lite — formal, board-ready structure
// (Introduction + Scope Definitions + Data Notes -> Executive Summary ->
// Overview by location -> detailed per-Scope analysis -> Results & Key Findings
// -> Conclusion) rendered in the client's brand. Every number comes from
// final_emission (exact, no LLM); OpenRouter writes only prose + a relevant
// cover image.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { AppDataSource } from "../config/data-source";
import { getBrandTheme } from "./brands";
import { renderDocument } from "./render";
import { htmlToPdf } from "./print";
import { buildVariety } from "./variety";
import { generateImage, brandImagePrompt } from "./imagery";
import { writeNarrative } from "./ai-narrative";
import type { Block, Report } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const fmt1 = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
type Freq = "monthly" | "quarterly" | "yearly";

export interface GhgResult { path: string; filename: string; pages: number; companyName: string; total: number; year: number; }

export async function generateGhgReport(companyId: number, year: number, frequency: Freq = "yearly"): Promise<GhgResult> {
  const q = <T = any>(sql: string, p: any[]) => AppDataSource.query(sql, p) as Promise<T[]>;
  const W = "WHERE company_id=$1 AND reporting_year=$2";

  const co = await q(`SELECT DISTINCT company_name FROM final_emission WHERE company_id=$1`, [companyId]);
  const companyName = co[0]?.company_name ?? `Company ${companyId}`;

  const scopes = await q(`SELECT scope, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY scope ORDER BY scope`, [companyId, year]);
  const bySite = await q(`SELECT site_name, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY site_name ORDER BY t DESC`, [companyId, year]);
  const siteScope = await q(`SELECT site_name, scope, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY site_name, scope`, [companyId, year]);
  const cats = await q(`SELECT emission_category, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY emission_category ORDER BY t DESC`, [companyId, year]);
  const scopeCat = await q(`SELECT scope, emission_category, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY scope, emission_category`, [companyId, year]);
  const months = await q(`SELECT reporting_month::int m, MAX(month_name) mn, SUM(total_emission)::float t FROM final_emission ${W} GROUP BY reporting_month ORDER BY reporting_month`, [companyId, year]);
  const renew = await q(`SELECT SUM(total_emission)::float t FROM final_emission ${W} AND (emission_category ILIKE '%renew%' OR emission_category ILIKE '%solar%' OR emission_category ILIKE '%wind%')`, [companyId, year]);
  const allSites = await q(`SELECT name FROM site WHERE company_id=$1 ORDER BY name`, [companyId]);
  const prev = await q(`SELECT SUM(total_emission)::float t FROM final_emission WHERE company_id=$1 AND reporting_year=$2`, [companyId, year - 1]);

  const sitesWithData = new Set(bySite.map((r) => r.site_name));
  const total = scopes.reduce((s, r) => s + r.t, 0);
  const scopeVal = (n: string) => scopes.find((s) => (s.scope || "").toLowerCase() === n)?.t ?? 0;
  const s1 = scopeVal("scope 1"), s2 = scopeVal("scope 2");
  const siteNames = bySite.map((r) => r.site_name);
  const scopeNames = [...new Set(siteScope.map((r) => r.scope))].filter(Boolean).sort();
  const renewable = renew[0]?.t ?? 0;
  const missingSites = allSites.map((s) => s.name).filter((n) => !sitesWithData.has(n));
  const coverage = allSites.length ? Math.round((sitesWithData.size / allSites.length) * 100) : 100;
  const prevTotal = prev[0]?.t ?? 0;
  const yoy = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
  const freqLabel = frequency[0].toUpperCase() + frequency.slice(1);
  const topSite = bySite[0], topCat = cats[0];

  const nar = await writeNarrative({
    companyName, year, total, scope1: s1, scope2: s2, coverage,
    sites: bySite.map((r) => ({ name: r.site_name, t: r.t })),
    categories: cats.map((c) => ({ name: c.emission_category || "Unspecified", t: c.t })),
    missingSites, renewable, months: months.length,
  }).catch(() => null);

  const summary = nar?.summary ?? [
    `In CY${year}, ${companyName} reported total greenhouse-gas emissions of ${fmt1(total)} tCO₂e across Scope 1 and Scope 2, based on ${sitesWithData.size} of ${allSites.length} operational sites.`,
    `Scope 2 (purchased electricity) contributes ${fmt(s2)} tCO₂e (${pct(s2, total)}) and Scope 1 (direct combustion and fugitive sources) ${fmt(s1)} tCO₂e (${pct(s1, total)}), showing where reduction effort is best focused.`,
    `Data coverage stands at ${coverage}%${missingSites.length ? `, with ${missingSites.length} site(s) yet to report` : ""}, which the recommendations address.`,
  ];
  const note = (v: string | undefined, fb: string) => (v && v.length > 4 ? v : fb);

  const B: Block[] = [];

  B.push({
    type: "cover", style: "document", title: `${companyName} Carbon Accounting Report`,
    subtitle: `Greenhouse Gas Emissions Inventory · CY${year}`,
    caption: `${freqLabel} reporting · Prepared to the GHG Protocol Corporate Standard`,
    infoCards: [
      { label: "Reporting Period", value: `CY${year}` },
      { label: "Sites Covered", value: `${sitesWithData.size} of ${allSites.length} sites` },
      { label: "Standard & Boundary", value: "GHG Protocol · Operational Control" },
      { label: "Prepared By", value: `${companyName} — ESG Office` },
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
    `This report presents the greenhouse gas (GHG) emissions inventory of ${companyName} for the calendar year ${year}. It quantifies direct and energy-indirect emissions across the organisation's operational control boundary and is prepared in accordance with the GHG Protocol Corporate Accounting and Reporting Standard.`,
    `Emissions are expressed in tonnes of carbon-dioxide equivalent (tCO₂e). Figures are aggregated from site-level activity data and applicable emission factors; all values in this report are drawn directly from the recorded inventory.`,
  ] });
  B.push({
    type: "table", title: "Scope Definitions", columns: ["Scope", "Definition"], align: ["left", "left"],
    rows: [
      ["Scope 1", "Direct emissions from owned or controlled sources — stationary and mobile combustion and fugitive releases."],
      ["Scope 2", "Indirect emissions from the generation of purchased electricity, steam, heating and cooling consumed by the organisation."],
      ["Scope 3", "Other indirect emissions occurring across the value chain (assessed where data is available)."],
    ],
  });
  B.push({ type: "callout", variant: "info", title: "Notes on Data & Assumptions", body: `Emissions are calculated from metered/recorded activity data multiplied by recognised emission factors. This inventory covers ${sitesWithData.size} of ${allSites.length} operational sites for CY${year}; any site or period without entered data is flagged in Section 06 and excluded from totals rather than estimated.` });

  B.push({ type: "section", title: "Executive Summary", kicker: "02 · OVERVIEW" });
  B.push({
    type: "statBoard", badge: "EMISSIONS AT A GLANCE", title: `CY${year} Performance Summary`,
    kpis: [
      { value: fmt(total), label: "Total Emissions (tCO₂e)", sub: `CY${year} · all reported scopes` },
      ...(yoy !== null ? [{ value: `${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy).toFixed(1)}%`, label: "YoY Change", sub: `vs CY${year - 1}` }] : []),
      { value: fmt(s1), label: "Scope 1 · Direct", sub: pct(s1, total) },
      { value: fmt(s2), label: "Scope 2 · Energy Indirect", sub: pct(s2, total) },
      { value: `${coverage}%`, label: "Data Coverage", sub: `${sitesWithData.size}/${allSites.length} sites` },
    ],
    tiles: [
      { label: "Largest Site", value: topSite ? `${topSite.site_name} (${pct(topSite.t, total)})` : "—" },
      { label: "Largest Source", value: topCat ? `${topCat.emission_category} (${pct(topCat.t, total)})` : "—" },
      { label: "Renewable Energy", value: renewable > 0 ? `${fmt(renewable)} tCO₂e` : "Not entered" },
    ],
  });
  B.push({ type: "narrative", body: summary });
  B.push({ type: "chart", title: "Emissions by Scope", chartType: "pie", categories: scopes.map((s) => s.scope), series: [{ name: "tCO₂e", data: scopes.map((s) => Math.round(s.t)) }], caption: "Share of total emissions by GHG scope." });
  B.push({ type: "chart", title: "Emissions by Category", chartType: "bar", unit: "tCO₂e", categories: cats.slice(0, 8).map((c) => c.emission_category || "—"), series: [{ name: "tCO₂e", data: cats.slice(0, 8).map((c) => Math.round(c.t)) }], caption: "Top emission sources across the organisation." });

  B.push({ type: "section", title: "Emissions Overview by Location", kicker: "03 · SITES" });
  B.push({ type: "narrative", body: [note(nar?.siteNote, `Emissions are distributed across ${sitesWithData.size} reporting site(s), led by ${siteNames[0] ?? "—"}. Site-level visibility lets management prioritise the highest-impact locations.`)] });
  B.push({ type: "chart", title: "Total emissions — site-wise", chartType: "bar", unit: "tCO₂e", categories: siteNames, series: [{ name: "tCO₂e", data: bySite.map((r) => Math.round(r.t)) }], caption: "Gross emissions by site." });
  B.push({ type: "narrative", body: [note(nar?.scopeNote, `Splitting each site by scope shows whether direct combustion (Scope 1) or purchased energy (Scope 2) dominates locally, guiding site-specific abatement.`)] });
  B.push({
    type: "chart", title: "Site-wise & scope-wise", chartType: "bar", unit: "tCO₂e", categories: siteNames,
    series: scopeNames.map((sc) => ({ name: sc, data: siteNames.map((sn) => Math.round(siteScope.find((r) => r.site_name === sn && r.scope === sc)?.t ?? 0)) })),
    caption: "Each site split by GHG scope.",
  });
  B.push({
    type: "table", title: "Site × Scope (tCO₂e)", columns: ["Site", ...scopeNames, "Total"], align: ["left", ...scopeNames.map(() => "right" as const), "right"],
    rows: siteNames.map((sn) => {
      const vals = scopeNames.map((sc) => siteScope.find((r) => r.site_name === sn && r.scope === sc)?.t ?? 0);
      return [sn, ...vals.map((v) => fmt(v)), fmt(vals.reduce((a, b) => a + b, 0))];
    }),
  });

  B.push({ type: "section", title: "Detailed Analysis by Scope", kicker: "04 · CATEGORIES & FUEL TYPES" });
  B.push({ type: "narrative", body: [note(nar?.categoryNote, `Within each scope, emissions are broken down by category and fuel type (e.g. Diesel, Coal, Electricity, refrigerants), linking every figure to the activity that drives it — the basis for fuel-switching and efficiency decisions.`)] });
  const scopeLabel: Record<string, string> = { "scope 1": "Direct GHG Emissions: Scope 1", "scope 2": "Indirect GHG Emissions: Scope 2", "scope 3": "Indirect GHG Emissions: Scope 3" };
  for (const sc of scopeNames) {
    const rows = scopeCat.filter((r) => r.scope === sc && r.t > 0).sort((a, b) => b.t - a.t);
    if (!rows.length) continue;
    const scTotal = rows.reduce((a, b) => a + b.t, 0);
    B.push({ type: "section", title: scopeLabel[(sc || "").toLowerCase()] ?? sc, kicker: `${sc.toUpperCase()} · ${fmt(scTotal)} tCO₂e` });
    B.push({ type: "chart", title: `${sc} — category distribution`, chartType: "pie", categories: rows.map((r) => r.emission_category || "—"), series: [{ name: "tCO₂e", data: rows.map((r) => Math.round(r.t)) }], caption: `${sc} emissions by category/fuel type.` });
    B.push({
      type: "table", title: `${sc} category detail`, columns: ["Category / Fuel", "Emissions", "Share of scope"], align: ["left", "right", "right"],
      rows: rows.map((r) => [r.emission_category || "Unspecified", fmt(r.t), pct(r.t, scTotal)]),
    });
  }

  if (months.length > 0 && frequency !== "yearly") {
    if (frequency === "quarterly") {
      const qd = [0, 0, 0, 0];
      months.forEach((m) => { qd[Math.floor((m.m - 1) / 3)] += m.t; });
      B.push({ type: "chart", title: `Quarterly emissions — CY${year}`, subtitle: "Reporting frequency coverage", chartType: "bar", unit: "tCO₂e", categories: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "tCO₂e", data: qd.map((v) => Math.round(v)) }], caption: "Quarterly aggregation." });
    } else {
      B.push({ type: "chart", title: `Monthly emissions — CY${year}`, subtitle: "Reporting frequency coverage", chartType: "line", unit: "tCO₂e", categories: months.map((m) => (m.mn || String(m.m)).slice(0, 3)), series: [{ name: "tCO₂e", data: months.map((m) => Math.round(m.t)) }], caption: `${months.length} of 12 months have data.` });
    }
  }

  B.push({ type: "section", title: "Results & Key Findings", kicker: "05 · WHAT THE DATA SHOWS" });
  const findings = [
    `Total CY${year} emissions were ${fmt1(total)} tCO₂e${yoy !== null ? ` (${yoy >= 0 ? "up" : "down"} ${Math.abs(yoy).toFixed(1)}% vs CY${year - 1})` : ""}.`,
    topSite ? `${topSite.site_name} is the largest contributing site at ${fmt(topSite.t)} tCO₂e (${pct(topSite.t, total)} of total).` : "",
    `${s2 >= s1 ? "Scope 2 (purchased energy)" : "Scope 1 (direct)"} dominates the footprint at ${pct(Math.max(s1, s2), total)}, indicating the highest-leverage reduction pathway.`,
    topCat ? `${topCat.emission_category} is the single largest emission source (${pct(topCat.t, total)}).` : "",
  ].filter(Boolean);
  findings.forEach((f, i) => B.push({ type: "callout", variant: i === 0 ? "success" : "info", title: `Finding ${i + 1}`, body: f }));

  B.push({ type: "section", title: "Data Availability & Renewables", kicker: "06 · COVERAGE" });
  B.push({ type: "narrative", body: [note(nar?.coverageNote, `Data completeness determines the confidence management can place in these figures. Any site marked below has not been entered by the user and is excluded from totals.`)] });
  B.push(renewable > 0
    ? { type: "callout", variant: "success", title: "Renewable energy", body: `${fmt1(renewable)} tCO₂e of renewable-linked activity recorded in CY${year}.` }
    : { type: "callout", variant: "warning", title: "Renewable energy — data not available", body: "No renewable energy data has been entered for this period. Recording renewable consumption will let the report quantify avoided emissions." });
  B.push({
    type: "table", title: "Site reporting status", columns: ["Site", "Status", "Emissions (tCO₂e)"], align: ["left", "left", "right"],
    rows: allSites.map((s) => sitesWithData.has(s.name)
      ? [s.name, "Reported ✓", fmt(bySite.find((r) => r.site_name === s.name)?.t ?? 0)]
      : [s.name, "Not entered by user", "—"]),
    caption: missingSites.length ? `${missingSites.length} site(s) have no data entered for CY${year}.` : "All sites have reported data.",
  });

  B.push({ type: "section", title: "Conclusion & Recommended Actions", kicker: "07 · NEXT STEPS" });
  B.push({ type: "narrative", body: [
    `This report provides a structured view of ${companyName}'s CY${year} greenhouse-gas footprint across sites, scopes and emission categories. The results give management a clear, defensible basis for prioritising reduction effort and improving data quality.`,
    `The recommended actions below sequence the next steps by impact — closing data gaps first, then addressing the largest emission sources.`,
  ] });
  const recs = nar?.recommendations ?? [
    "Close data gaps at non-reporting sites to reach full coverage before the next cycle.",
    "Prioritise Scope 2 reduction through renewable electricity procurement or on-site generation.",
    "Set a validated, science-based reduction target aligned to a 1.5 °C pathway.",
    "Begin capturing renewable-energy consumption to quantify avoided emissions.",
  ];
  recs.slice(0, 4).forEach((r, i) => B.push({ type: "callout", variant: i % 2 === 0 ? "info" : "success", title: `Action ${i + 1}`, body: r }));

  const doc: Report = { client: `co-${companyId}`, slug: `ghg-${companyId}-${year}`, docTitle: `${companyName} — GHG Report CY${year}`, blocks: B };
  const theme = await getBrandTheme(companyId, companyName);
  const heroPrompt = brandImagePrompt(
    `A clean, professional, photographic cover image representing corporate sustainability and clean energy for ${companyName} — solar panels, wind turbines or a modern industrial facility at golden hour, calm and premium`,
    theme
  );
  const hero = await generateImage(heroPrompt).catch(() => null);
  const variety = buildVariety(theme, companyId * 1000 + year, hero);
  variety.docCoverMode = "split"; // clean, professional cover (real logo + hero panel)
  const html = renderDocument(doc, theme, variety);

  const outDir = join(process.cwd(), "generated-reports");
  mkdirSync(outDir, { recursive: true });
  const filename = `ghg-${companyId}-${year}-${frequency}.pdf`;
  const path = join(outDir, filename);
  writeFileSync(join(outDir, `ghg-${companyId}-${year}.html`), html, "utf8");
  const res = await htmlToPdf(html, path, []);
  return { path, filename, pages: res.pageCount, companyName, total, year };
}
