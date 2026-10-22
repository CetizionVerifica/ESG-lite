// IN-11 · unit: derive/sites.ts (the Sites tab's completeness sum and row order). Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { siteCompletenessPct, siteOrder } = require(path.resolve("dist/insights/derive/sites.js"));

const cell = (month, ee, ea, ke = 0, ka = 0) => ({ month, emissions_expected: ee, emissions_approved: ea, kpi_expected: ke, kpi_approved: ka });

test("siteCompletenessPct: approved ÷ expected over the months started, emissions and KPI together", () => {
  const cells = [cell("2026-01", 2, 2), cell("2026-02", 2, 1, 1, 1), cell("2026-03", 2, 0), cell("2026-04", 2, 0)];
  // Jan–Mar: (2 + 1 + 1 + 0) ÷ (2 + 3 + 2) = 4 ÷ 7
  assert.equal(siteCompletenessPct(cells, "2026-03"), (4 / 7) * 100);
  assert.equal(siteCompletenessPct(cells, "2026-12"), (4 / 9) * 100);
});

test("siteCompletenessPct: null before the first month or with nothing expected", () => {
  assert.equal(siteCompletenessPct([cell("2026-01", 2, 2)], "2025-12"), null);
  assert.equal(siteCompletenessPct([cell("2026-01", 0, 0)], "2026-06"), null);
  assert.equal(siteCompletenessPct([], "2026-06"), null);
});

test("siteOrder: largest net first, then site id", () => {
  const rows = [{ site_id: 3, net: 5 }, { site_id: 1, net: 9 }, { site_id: 2, net: 5 }];
  assert.deepEqual(rows.sort(siteOrder).map((r) => r.site_id), [1, 2, 3]);
});
