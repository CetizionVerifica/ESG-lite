// IN-5 · GET /insights/bridge: the envelope, Σ steps = to − from, production
// missing (Scope 3 + Other only), a year without kWh (Scope 2 folded into Other,
// flagged), compare=base without an SBTi base year (the first approved year),
// no_data, roles, site scope, tenant isolation and switch-off.
//
// Own rows on company 1 site 2 in 2012–2014 (other tests use later years), removed by id.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, q, panel, assertEnvelope } = require("./in-lib.cjs");

const own = { emissions: [], production: [], products: [] };
const reset = async () => {
  await setInsights(1, false);
  await setInsights(2, false);
  if (own.emissions.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [own.emissions]);
  if (own.production.length) await q(`DELETE FROM production_data WHERE production_id = ANY($1::int[])`, [own.production]);
  if (own.products.length) await q(`DELETE FROM product WHERE product_id = ANY($1::int[])`, [own.products]);
  await q(`DELETE FROM company_base_year WHERE company_id IN (1, 2)`);
};
const emission = async (t, date, category, kwh = null) =>
  own.emissions.push(
    (
      await q(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, activity_data_unit)
         VALUES ($1, $2, 'tCO2e', $3, 'approved', 7, $4, 2, 'monthly', $5) RETURNING pk_id`,
        [JSON.stringify({ activity_value: kwh ?? 1 }), t, date, category, kwh === null ? null : "kWh"],
      )
    )[0].pk_id,
  );

test.before(async () => {
  await reset();
  await setInsights(1, true);
  await setInsights(2, true);
  // 2013: S1 100, S2 50 over 62,500 kWh, S3 10. 2014: S1 120, S2 40 with a 0 kWh reading, S3 15.
  await emission(100, "2013-06-30", 1);
  await emission(50, "2013-06-30", 2, 62500);
  await emission(10, "2013-06-30", 3);
  await emission(120, "2014-06-30", 1);
  await emission(40, "2014-06-30", 2, 0);
  await emission(15, "2014-06-30", 3);
});
test.after(reset);

const bridge = async (who, qs) => (await panel(who, `/bridge?${qs}`)).json;

test("production missing: Scope 3 and Other only, with the note; the envelope; Σ steps = change", async () => {
  const b = await bridge("manager", "year=2014&sites=2");
  assertEnvelope(assert, b, "bridge");
  assert.equal(b.availability, "ok");
  assert.deepEqual(b.data.from, { year: 2013, value: 160 });
  assert.deepEqual(b.data.to, { year: 2014, value: 175 });
  assert.equal(b.data.method, "lmdi_additive");
  assert.deepEqual(b.data.steps.map((s) => [s.driver, s.value]), [["scope3", 5], ["other", 10]]);
  assert.ok(b.data.notes.includes("Add production data to split by driver."));
  assert.equal(b.data.steps.reduce((a, s) => a + s.value, 0), 15);
});

test("with production: activity and Scope 1 intensity by LMDI; the 0 kWh year folds Scope 2 into Other (flagged)", async () => {
  own.products.push((await q(`INSERT INTO product (name, unit, site_id) VALUES ('IN-5 bar', 't', 2) RETURNING product_id`))[0].product_id);
  own.production.push(
    ...(
      await q(
        `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
           ($1, 2, 1000, 't', '2013-01-01', '2013-12-31', 'approved', 7), ($1, 2, 1100, 't', '2014-01-01', '2014-12-31', 'approved', 7)
         RETURNING production_id`,
        [own.products[0]],
      )
    ).map((r) => r.production_id),
  );
  const b = await bridge("manager", "year=2014&sites=2");
  assert.deepEqual(b.data.steps.map((s) => s.driver), ["activity", "intensity_s1", "scope3", "other"]);
  // By hand: L(120, 100) = 20 / ln 1.2; activity = L × ln 1.1; intensity = L × ln(0.10909… / 0.1).
  const L = 20 / Math.log(1.2);
  const act = b.data.steps[0].value;
  const int = b.data.steps[1].value;
  assert.ok(Math.abs(act - L * Math.log(1.1)) < 1e-9, `activity ${act}`);
  assert.ok(Math.abs(int - L * Math.log(120 / 1100 / 0.1)) < 1e-9, `intensity ${int}`);
  assert.equal(b.data.steps[2].value, 5);
  assert.equal(b.data.steps[3].value, -10);
  assert.ok(b.data.notes.some((n) => n.includes("no electricity kWh in 2014")), JSON.stringify(b.data.notes));
  assert.ok(Math.abs(b.data.steps.reduce((a, s) => a + s.value, 0) - 15) < 1e-9);
  assert.equal(b.data.steps[0].inputs.q_from, 1000);
  assert.equal(b.data.steps[0].inputs.q_to, 1100);
  assert.equal(b.data.steps[0].label, "More output");
});

test("compare=base without an SBTi base year: the first approved year; with one: the base year", async () => {
  await emission(200, "2012-06-30", 1);
  const first = await bridge("manager", "year=2014&sites=2&compare=base");
  assert.equal(first.data.from.year, 2012);
  assert.equal(first.data.from.value, 200);
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2013, 'CY')`);
  const withBase = await bridge("manager", "year=2014&sites=2&compare=base");
  assert.equal(withBase.data.from.year, 2013);
  await q(`DELETE FROM company_base_year WHERE company_id = 1`);
});

test("no_data: a year without approved emissions, or nothing earlier to compare with", async () => {
  const none = await bridge("manager", "year=2015&sites=2");
  assert.equal(none.availability, "no_data");
  assert.equal(none.data, null);
  assert.ok(none.reason);
  const earliest = await bridge("otherManager", "year=2010&compare=base");
  assert.equal(earliest.availability, "no_data");
});

test("roles, site scope, tenant isolation and switch-off", async () => {
  assert.equal((await call("GET", "/insights/bridge?year=2014", "user")).json.code, "IN_FORBIDDEN");
  for (const [who, qs] of [["manager", "sites=3"], ["otherManager", "sites=2"]]) {
    const r = await call("GET", `/insights/bridge?year=2014&${qs}`, who);
    assert.equal(r.status, 404, `${who} ${qs}`);
    assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
  }
  assert.equal((await call("GET", "/insights/bridge?year=2014&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/insights/bridge?compare=sideways", "manager")).json.code, "IN_VALIDATION");
  // Company 2 never sees company 1's 2013–2014 rows.
  const other = await bridge("otherManager", "year=2014");
  assert.equal(other.availability, "no_data");
  const sa = (await panel("superadmin", "/bridge?year=2014&sites=2", { companyId: 1 })).json;
  assert.equal(sa.data.to.value, 175);
  await setInsights(1, false);
  try {
    assert.equal((await call("GET", "/insights/bridge?year=2014", "manager")).json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
