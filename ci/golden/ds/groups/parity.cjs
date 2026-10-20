// DS-14F golden group "parity" (DS-2): the studio's GHG figures equal the GHG report's.
//   parity/ghg-totals-cy, -fy: per GHG seed company and year, POST /studio/resolve (total, Scope 1,
//     Scope 2 location-based, Scope 3, the scope split and the Scope 3 category split) against
//     POST /user/ghg/tables for the same sites. A difference over 0.01 t throws (it can't be
//     snapshotted away); the golden keeps both sides.
//   parity/ede-intensity: the EDE report for the cement company (its extracted intensity join,
//     src/reporting/intensity.ts) and DS-2's intensity_output on the same approved production.
const { ensureSeed } = require("../lib/seed.cjs");

const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const sum = (pts) => pts.reduce((a, p) => a + (p.value || 0), 0);
const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const YEARS = { "parity/ghg-totals-cy": [["CY", 2025], ["CY", 2024]], "parity/ghg-totals-fy": [["FY", 2026], ["FY", 2025]] };

async function sitesOf(ctx, companyId) {
  return (await ctx.q(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId])).map((r) => r.site_id);
}

async function resolve(ctx, who, body) {
  const r = await ctx.call("POST", "/studio/resolve", who, body);
  if (r.status !== 200) throw new Error(`resolve: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json.values;
}

async function totals(ctx, c, yearType, year) {
  const siteIds = await sitesOf(ctx, c.companyId);
  const tables = await ctx.call("POST", "/user/ghg/tables", c.who, { siteIds, yearType, year });
  if (tables.status !== 200) throw new Error(`ghg/tables ${c.key}: ${tables.status}`);
  const t = tables.json.totals[String(year)] || { total: 0, scope1: 0, scope2: 0, scope3: 0 };
  const [total, s1, s2, s3, byScope, byCat] = await resolve(ctx, c.who, {
    kind: "ghg",
    year,
    yearType,
    sites: "all",
    bindings: [ghg("total"), ghg("scope1"), ghg("scope2_location"), ghg("scope3"), ghg("total", { breakdown: "scope" }), ghg("scope3", { breakdown: "scope3_category" })],
    tokens: [],
  });
  const report = { total: r2(t.total), scope1: r2(t.scope1), scope2: r2(t.scope2), scope3: r2(t.scope3) };
  const studio = { total: r2(total.value ?? 0), scope1: r2(s1.value ?? 0), scope2: r2(s2.value ?? 0), scope3: r2(s3.value ?? 0) };
  const splits = { byScope: r2(sum(byScope.series?.[0]?.values || [])), byScope3Category: r2(sum(byCat.series?.[0]?.values || [])) };
  const off = Object.keys(report).filter((k) => Math.abs(report[k] - studio[k]) > 0.01);
  if (Math.abs(splits.byScope - report.total) > 0.01) off.push("scope split ≠ total");
  if (Math.abs(splits.byScope3Category - report.scope3) > 0.01) off.push("Scope 3 category split ≠ Scope 3");
  if (off.length) throw new Error(`${c.key} ${yearType} ${year}: the studio differs from /user/ghg/tables on ${off.join(", ")}: report ${JSON.stringify(report)} studio ${JSON.stringify(studio)} ${JSON.stringify(splits)}`);
  return { sites: siteIds, report, studio, splits, scope3Categories: (byCat.series?.[0]?.values || []).map((p) => `${p.key}=${r2(p.value)}`), equal: true };
}

module.exports = async function parity(ctx, kase) {
  const { ghg: companies } = await ensureSeed(ctx);
  if (YEARS[kase.id]) {
    const out = {};
    for (const c of companies) for (const [yt, y] of YEARS[kase.id]) out[`${c.key} ${yt} ${y}`] = await totals(ctx, c, yt, y);
    return out;
  }
  // parity/ede-intensity
  const c = companies.find((x) => x.key === "cement");
  const siteIds = await sitesOf(ctx, c.companyId);
  const ede = await ctx.call("POST", "/user/reports/ede", c.who, { siteIds, frequency: "yearly", year: 2025 });
  if (ede.status !== 200) throw new Error(`EDE: ${ede.status} ${JSON.stringify(ede.json).slice(0, 300)}`);
  const production = ede.json.intensityMonthly.reduce((a, m) => a + Number(m.production || 0), 0);
  const t = (await ctx.call("POST", "/user/ghg/tables", c.who, { siteIds, yearType: "CY", year: 2025 })).json.totals["2025"];
  const [inten] = await resolve(ctx, c.who, { kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings: [ghg("intensity_output")], tokens: [] });
  const expected = t.total / production;
  if (!(production > 0) || Math.abs(inten.value - expected) > 1e-6 * Math.max(1, expected)) {
    throw new Error(`intensity_output ${inten.value} ≠ total ${t.total} / EDE production ${production}`);
  }
  return {
    ede: { totals: ede.json.totals, intensityMonthly: ede.json.intensityMonthly, bySite: ede.json.bySite },
    approvedProduction: production,
    studio: { intensity_output: r2(inten.value), display: inten.display, unit: inten.unit },
    equal: true,
  };
};
