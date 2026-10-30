// KPI-9 pure parts: progress towards a target (reduce, increase, maintain, no
// data, achieved, the straight-line path) and the year figures targets,
// the dashboard and the reports read (values/yearly.ts). Worked by hand.
// Runs against the compiled build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { progress, expectedAt } = require(path.resolve("dist/kpi/targets/progress.js"));
const { yearFigure, figureOf } = require(path.resolve("dist/kpi/values/yearly.js"));

const reduce = { baseline_year: 2024, baseline_value: 100, target_year: 2030, target_value: 80, direction: "reduce" };

test("reduce: on track when at or below the straight line; % of the way; achieved", () => {
  assert.equal(Number(expectedAt(reduce, 2026).toFixed(4)), 93.3333, "100 − 20 × 2/6");
  const ok = progress(reduce, [{ year: 2024, value: 100 }, { year: 2025, value: 97 }, { year: 2026, value: 92 }]);
  assert.deepEqual(
    [ok.current_year, ok.current_value, ok.progress_pct, ok.on_track, ok.status, ok.achieved, ok.change_pct],
    [2026, 92, 40, true, "on_track", false, -8],
  );
  const behind = progress(reduce, [{ year: 2026, value: 95 }]);
  assert.deepEqual([behind.progress_pct, behind.status], [25, "behind"]);
  const done = progress(reduce, [{ year: 2027, value: 78 }]);
  assert.deepEqual([done.progress_pct, done.achieved, done.status], [110, true, "on_track"]);
  const wrongWay = progress(reduce, [{ year: 2025, value: 104 }]);
  assert.deepEqual([wrongWay.progress_pct, wrongWay.status], [-20, "behind"]);
  assert.equal(expectedAt(reduce, 2035), 80, "held at the target after the target year");
});

test("increase and maintain", () => {
  const inc = { baseline_year: 2024, baseline_value: 20, target_year: 2030, target_value: 40, direction: "increase" };
  const p = progress(inc, [{ year: 2025, value: 22 }]);
  assert.deepEqual([p.progress_pct, p.status, Number(p.expected_value.toFixed(4))], [10, "behind", 23.3333]);
  assert.equal(progress(inc, [{ year: 2025, value: 24 }]).status, "on_track");

  const keep = { baseline_year: 2024, baseline_value: 100, target_year: 2030, target_value: 100, direction: "maintain" };
  assert.deepEqual([progress(keep, [{ year: 2026, value: 104 }]).status, progress(keep, [{ year: 2026, value: 104 }]).progress_pct], ["on_track", null], "within ±5 %");
  assert.equal(progress(keep, [{ year: 2026, value: 106 }]).status, "behind");
  const zero = { ...keep, baseline_value: 0, target_value: 0 };
  assert.equal(progress(zero, [{ year: 2026, value: 0 }]).status, "on_track", "keep fatalities at 0");
  assert.equal(progress(zero, [{ year: 2026, value: 1 }]).status, "behind");
  assert.equal(progress(zero, [{ year: 2026, value: 1 }]).change_pct, null, "no % change from 0");
});

test("no data: nothing approved after the baseline year", () => {
  const none = progress(reduce, [{ year: 2024, value: 100 }, { year: 2025, value: null }]);
  assert.deepEqual([none.status, none.current_value, none.progress_pct, none.on_track, none.achieved], ["no_data", null, null, null, false]);
});

const v = (id, kpi, site, start, value, extra = {}) => ({ id, kpi_definition_id: kpi, site_id: site, period_start: start, frequency: extra.frequency ?? "monthly", value, text: extra.text ?? null, breakdown: extra.breakdown ?? null, status: "approved" });

test("year figures: months summed, missing never 0, sites rolled up, the breakdown added up", () => {
  const water = { id: 1, level: "site", aggregation: "sum", frequency: "monthly" };
  const values = [
    v(1, 1, 1, "2026-01-01", 100, { breakdown: { groundwater: 60, surface: 40 } }),
    v(2, 1, 1, "2026-02-01", 50, { breakdown: { groundwater: 50 } }),
    ...Array.from({ length: 12 }, (_, i) => v(10 + i, 1, 2, `2026-${String(i + 1).padStart(2, "0")}-01`, 10)),
    v(99, 1, 1, "2025-12-01", 999),
  ];
  const site1 = yearFigure(water, values, { year: 2026, yearType: "CY", sites: [1, 2], site: 1 });
  assert.deepEqual([site1.value, site1.complete, site1.missing_periods.length, site1.value_ids], [150, false, 10, [1, 2]]);
  assert.deepEqual(site1.breakdown, { groundwater: 110, surface: 40 });
  const company = yearFigure(water, values, { year: 2026, yearType: "CY", sites: [1, 2, 3] });
  assert.deepEqual([company.value, company.complete, company.missing_sites, company.sites], [270, false, [3], [1, 2]]);
  assert.equal(company.missing_periods.length, 12, "site 3 has none at all");
  const fy = yearFigure(water, values, { year: 2026, yearType: "FY", sites: [1, 2] });
  assert.equal(fy.value, 150 + 999 + 30, "FY 2026 = Apr 2025–Mar 2026: site 1 Dec 2025, Jan, Feb; site 2 Jan–Mar");
  assert.equal(yearFigure(water, [], { year: 2026, yearType: "CY", sites: [1] }).value, null, "nothing at all: no value");
});

test("year figures: company-level values, latest headcount, text answers, LTIFR weighted by hours", () => {
  const revenue = { id: 2, level: "company", aggregation: "none", frequency: "annual" };
  assert.equal(yearFigure(revenue, [v(1, 2, null, "2026-01-01", 1200, { frequency: "annual" })], { year: 2026, yearType: "CY", sites: [1] }).value, 1200);
  const heads = { id: 3, level: "company", aggregation: "latest", frequency: "quarterly" };
  const hv = [v(1, 3, null, "2026-01-01", 400, { frequency: "quarterly" }), v(2, 3, null, "2026-07-01", 420, { frequency: "quarterly" })];
  const h = yearFigure(heads, hv, { year: 2026, yearType: "CY", sites: [] });
  assert.deepEqual([h.value, h.complete, h.missing_periods], [420, false, ["2026-04-01", "2026-10-01"]]);
  const policy = { id: 4, level: "company", aggregation: "latest", frequency: "annual" };
  assert.equal(yearFigure(policy, [v(1, 4, null, "2026-01-01", null, { frequency: "annual", text: "Yes, since 2024" })], { year: 2026, yearType: "CY", sites: [] }).text, "Yes, since 2024");

  const ltifr = { id: 5, code: "LTIFR", level: "site", aggregation: "weighted_average", frequency: "annual" };
  const hours = { id: 6, code: "HOURS_WORKED", level: "site", aggregation: "sum", frequency: "annual" };
  const vals = [
    v(1, 5, 1, "2026-01-01", 2, { frequency: "annual" }), v(2, 5, 2, "2026-01-01", 5, { frequency: "annual" }),
    v(3, 6, 1, "2026-01-01", 3000000, { frequency: "annual" }), v(4, 6, 2, "2026-01-01", 1000000, { frequency: "annual" }),
  ];
  const byCode = new Map([["LTIFR", ltifr], ["HOURS_WORKED", hours]]);
  assert.equal(figureOf(ltifr, vals, byCode, { year: 2026, yearType: "CY", sites: [1, 2] }).value, 2.75, "(2×3m + 5×1m) / 4m");
});

// #209 review: the target words print a tCO2e KPI's figure with 3 decimals and thousands
// separators, as every tCO₂e figure in the app; other units keep the stored number.
test("target words: a tCO2e figure has 3 decimals and separators; other units as stored", () => {
  const { targetLabel, targetFigure } = require(path.resolve("dist/kpi/targets/service.js"));
  const zero = { baseline_year: 2024, baseline_value: 0, target_year: 2030, target_value: 1000, direction: "increase" };
  const keep = { baseline_year: 2024, baseline_value: 1234.5, target_year: 2030, target_value: 1234.5, direction: "maintain" };
  assert.equal(targetLabel(zero, "tCO2e"), "1,000.000 tCO2e by 2030");
  assert.equal(targetLabel(keep, "tCO2e"), "Keep at 1,234.500 tCO2e to 2030");
  for (const u of ["tCO₂e", "t CO2e", "tonnes CO2e"]) assert.equal(targetLabel(keep, u), `Keep at 1,234.500 ${u} to 2030`, u);
  assert.equal(targetLabel({ ...keep, baseline_value: 33102.0885, target_value: 33102.0885 }, "tCO2e"), "Keep at 33,102.089 tCO2e to 2030", "half away from zero, as display");
  // Other units, and no unit, keep the stored number.
  assert.equal(targetLabel(zero, "kL"), "1000 kL by 2030");
  assert.equal(targetLabel(keep, "kgCO2e"), "Keep at 1234.5 kgCO2e to 2030");
  assert.equal(targetLabel(keep, null), "Keep at 1234.5 to 2030");
  assert.equal(targetLabel({ ...keep, baseline_value: 12.5, target_value: 12.5 }, "tCO2e per INR crore"), "Keep at 12.5 tCO2e per INR crore to 2030");
  // A percentage target is unchanged.
  assert.equal(targetLabel(reduce, "tCO2e"), "−20 % by 2030 from 2024");
  assert.equal(targetFigure(-0.0001, "tCO2e"), "0.000");
  assert.equal(targetFigure(-12.5, "tCO2e"), "−12.500");
});

// D14 review fix: GHG auto values keep their rows' kg (auto_snapshot.kg); a sum
// of them adds the kg and rounds once, as the GHG report does. By hand: Scope 1
// rows of 1,000.4 kg at site 1 in January and February and at site 2 in
// January: each site-month 1,000.4 kg → 1.0 t; the company's year 3,001.2 kg
// → 3.001 t (not 1 + 1 + 1 = 3.0); site 1's year 2,000.8 kg → 2.001 t; January
// across both sites 2,000.8 kg → 2.001 t.
test("year figures: GHG auto values add their kg and round once (D14); values without kg add as before", () => {
  const { combineValues } = require(path.resolve("dist/kpi/values/yearly.js"));
  const ghg = { id: 7, level: "site", aggregation: "sum", frequency: "monthly" };
  const kg = (id, site, start) => ({ ...v(id, 7, site, start, 1), kg: 1000.4 });
  const values = [kg(1, 1, "2026-01-01"), kg(2, 1, "2026-02-01"), kg(3, 2, "2026-01-01")];
  assert.equal(yearFigure(ghg, values, { year: 2026, yearType: "CY", sites: [1, 2] }).value, 3.001, "3,001.2 kg");
  assert.equal(yearFigure(ghg, values, { year: 2026, yearType: "CY", sites: [1, 2], site: 1 }).value, 2.001, "2,000.8 kg");
  assert.equal(combineValues(values.filter((x) => x.period_start === "2026-01-01"), "sum"), 2.001, "January, both sites");

  // A value without kg (written before D14, or not in tCO2e) or whose kg isn't its own: the values are added.
  const mixed = [values[0], values[1], { ...values[2], kg: null }];
  assert.equal(yearFigure(ghg, mixed, { year: 2026, yearType: "CY", sites: [1, 2] }).value, 3);
  assert.equal(yearFigure(ghg, [values[0], { ...values[2], kg: 2000 }], { year: 2026, yearType: "CY", sites: [1, 2] }).value, 2, "kg 2,000 doesn't round to 1");
  assert.equal(combineValues([values[0], { ...values[2], kg: null }], "sum"), 2);
  // Other rules never read kg.
  assert.equal(yearFigure({ ...ghg, aggregation: "max" }, values, { year: 2026, yearType: "CY", sites: [1, 2] }).value, 1);
  assert.equal(combineValues(values, "average"), 1);
});
