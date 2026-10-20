// DS-8 charts on the API fixture's approved data (no new endpoint; DS-8 adds
// `stacks` to POST /studio/resolve for month and quarter breakdowns):
//   - switch off (DS_STUDIO_OFF), Users (DS_ROLE), another company's sites (404)
//     on the monthly breakdown DS-8 reads;
//   - stacks: one series per scope of the metric, adding back to the month
//     (quarter) breakdown, Scope 2 only for scope2_location;
//   - every GHG chart kind's default binding resolves and the renderer draws a
//     real chart from the server's answer (or "Not reported" with a reason),
//     never "Chart not available".
// Fixture: company 1 (sites 1, 2; manager 2, user 1), company 2 (site 3; otherManager 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call } = require("../helpers.cjs");
const { setStudio } = require("./ds-lib.cjs");

const R = require(path.resolve(__dirname, "../../../dist/reporting/studio/render/index.js"));

const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const body = (bindings, extra = {}) => ({ kind: "ghg", year: 2025, yearType: "CY", sites: "all", bindings, tokens: [], ...extra });
const ok = async (who, b) => {
  const r = await call("POST", "/studio/resolve", who, b);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

test.before(async () => {
  await setStudio(1, true);
  await setStudio(2, false);
});
test.after(async () => {
  await setStudio(1, false);
  await setStudio(2, false);
});

test("switch off, roles and tenant isolation on the monthly breakdown", async () => {
  const b = body([ghg("total", { breakdown: "month" })]);
  await setStudio(1, false);
  let r = await call("POST", "/studio/resolve", "manager", b);
  assert.equal(r.status, 403);
  assert.equal(r.json.code ?? r.json.error?.code, "DS_STUDIO_OFF");
  await setStudio(1, true);
  r = await call("POST", "/studio/resolve", "user", b);
  assert.equal(r.status, 403);
  assert.equal(r.json.code ?? r.json.error?.code, "DS_ROLE");
  r = await call("POST", "/studio/resolve", "manager", body([ghg("total", { breakdown: "month", sites: [3] })], { sites: [1, 2] }));
  assert.equal(r.status, 404, "a site of company 2 is not found");
  r = await call("POST", "/studio/resolve", "manager", body([ghg("total", { breakdown: "month" })], { sites: [3] }));
  assert.equal(r.status, 404);
});

test("stacks: months and quarters by scope add back to the breakdown", async () => {
  for (const yearType of ["CY", "FY"]) {
    const year = yearType === "CY" ? 2025 : 2026;
    const res = await ok("manager", body([ghg("total", { breakdown: "month" }), ghg("total", { breakdown: "quarter" }), ghg("scope2_location", { breakdown: "month" }), ghg("total", { breakdown: "site" })], { year, yearType, sites: [1, 2] }));
    const [month, quarter, s2, site] = res.values;
    for (const v of [month, quarter]) {
      assert.deepEqual(v.stacks.map((s) => s.label), ["Scope 1", "Scope 2", "Scope 3"]);
      const cur = v.series[v.series.length - 1].values;
      for (const s of v.stacks) assert.deepEqual(s.values.map((p) => p.key), cur.map((p) => p.key));
      cur.forEach((p, i) => close(v.stacks.reduce((a, s) => a + s.values[i].value, 0), p.value, `${yearType} ${p.key}`));
    }
    assert.equal(month.stacks[0].values.length, 12);
    assert.equal(quarter.stacks[0].values.length, 4);
    assert.deepEqual(s2.stacks.map((s) => s.label), ["Scope 2"]);
    s2.series[0].values.forEach((p, i) => close(s2.stacks[0].values[i].value, p.value, `scope 2 ${p.key}`));
    // Scope 2 stack over the year equals the total's Scope 2 stack.
    close(s2.stacks[0].values.reduce((a, p) => a + p.value, 0), month.stacks[1].values.reduce((a, p) => a + p.value, 0), "scope 2 year");
    assert.equal(site.stacks, undefined, "only month and quarter breakdowns stack");
  }
});

test("every GHG kind's default binding resolves and draws (or says why not)", async () => {
  const kinds = R.GHG_CHART_KINDS;
  const defaults = kinds.map((k) => R.defaultGhgChart(k, { year: 2025, baseYear: 2024 }));
  const res = await ok("manager", body(defaults.map((d) => d.binding), { sites: [1, 2] }));
  const data = R.renderData(defaults.map((d) => d.binding), [], res);
  const doc = {
    kind: "ghg", format: "a4", meta: { title: "DS-8", year: 2025, yearType: "CY" }, design: { theme: {} }, assets: [],
    pages: [{ id: "p", kind: "freeform", name: "Charts", background: {}, elements: kinds.map((k, i) => ({ id: `c${i}`, type: "chart", z: i, frame: { x: 10, y: 10 + i * 30, w: 120, h: 28, rotation: 0 }, props: { binding: defaults[i].binding, kind: k, options: {} } })) }],
  };
  const html = R.renderSheet(doc.pages[0], doc, data, { mode: "sheet" }).html;
  assert.doesNotMatch(html, /data-chart-unsupported/);
  let drawn = 0;
  kinds.forEach((k, i) => {
    assert.ok(R.chartKindValidity(k, defaults[i].binding).ok, k);
    const v = res.values[i];
    const chunk = html.slice(html.indexOf(`data-el-id="c${i}"`), i + 1 < kinds.length ? html.indexOf(`data-el-id="c${i + 1}"`) : undefined);
    if (v.unavailable) {
      assert.match(chunk, /data-reason="/, `${k}: unavailable carries its reason`);
    } else {
      assert.match(chunk, new RegExp(`data-ghg-chart="${k}"|No data`), k);
      if (chunk.includes(`data-ghg-chart="${k}"`)) drawn += 1;
    }
  });
  // The fixture has approved Scope 1–3 rows: scope split, categories, sites and months draw.
  assert.ok(drawn >= 4, `drawn ${drawn}`);
  for (const k of ["scope_split", "site_bars", "monthly_stack"]) assert.match(html, new RegExp(`data-ghg-chart="${k}"`), k);
});
