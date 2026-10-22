// IN-11 · GET /insights/site-compare (the Sites tab): figures by hand on company 1, CY 2010
// (own rows, removed by id): net, prior and change, share, scope split, intensity, completeness
// and pending per site, largest first; equal to /manager/overview's by_site; roles, site scope,
// tenant isolation and switch-off.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, q, panel, assertEnvelope } = require("./in-lib.cjs");

const own = { emissions: [], production: [], products: [] };
// [site, category, date, t, status]. Categories: 1 Scope 1, 2 Scope 2, 3 Scope 3, 4 renewable (saved).
const ROWS = [
  [1, 1, "2010-03-15", 100, "approved"],
  [1, 2, "2010-04-15", 50, "approved"],
  [1, 3, "2010-05-15", 30, "approved"],
  [1, 4, "2010-06-15", 10, "approved"],
  [1, 1, "2010-07-15", 5, "pending"],
  [2, 1, "2010-02-15", 60, "approved"],
  [2, 2, "2010-02-20", 20, "approved"],
  [1, 1, "2009-03-15", 200, "approved"],
  [2, 1, "2009-02-15", 100, "approved"],
];
const cleanup = async () => {
  if (own.emissions.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [own.emissions]);
  if (own.production.length) await q(`DELETE FROM production_data WHERE production_id = ANY($1::int[])`, [own.production]);
  if (own.products.length) await q(`DELETE FROM product WHERE product_id = ANY($1::int[])`, [own.products]);
  own.emissions.length = 0;
  own.production.length = 0;
  own.products.length = 0;
  await setInsights(1, false);
  await setInsights(2, false);
};

test.before(async () => {
  await cleanup();
  await setInsights(1, true);
  for (const [site, cat, day, t, status] of ROWS) {
    own.emissions.push(
      (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES ('{}', $1, 'tCO2e', $2, $3, 7, $4, $5, 'monthly') RETURNING pk_id`, [t, day, status, cat, site]))[0].pk_id,
    );
  }
  own.products.push((await q(`INSERT INTO product (name, unit, site_id) VALUES ('IN-11 bar', 't', 2) RETURNING product_id`))[0].product_id);
  own.production.push(
    ...(
      await q(
        `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
           ($1, 2, 40, 't', '2010-01-01', '2010-12-31', 'approved', 7), ($1, 2, 50, 't', '2009-01-01', '2009-12-31', 'approved', 7)
         RETURNING production_id`,
        [own.products[0]],
      )
    ).map((r) => r.production_id),
  );
});
test.after(cleanup);

test("site compare by hand: largest net first, prior and change, share, scopes, intensity, completeness, pending", async () => {
  const r = (await panel("manager", "/site-compare?year=2010")).json;
  assertEnvelope(assert, r, "site_compare");
  assert.equal(r.availability, "ok");
  const [a, b] = r.data.rows;
  assert.deepEqual(r.data.rows.map((x) => x.site_id), [1, 2]);
  // Site 1: 100 + 50 + 30 − 10 saved = 170; last year 200 → −15 %.
  assert.equal(a.site, "CI Plant A");
  assert.equal(a.net, 170);
  assert.equal(a.prior, 200);
  assert.equal(a.change_pct, -15);
  assert.equal(a.good, true);
  assert.deepEqual([a.scope_1, a.scope_2, a.scope_3], [100, 50, 30]);
  assert.equal(a.pending, 1);
  assert.equal(a.share_pct, (170 / 250) * 100);
  assert.deepEqual(a.intensity, { value: null, unit: null, change_pct: null, good: null });
  // Site 1 expects categories 1–4 (FERA left out) × 12 months; one approved in each of Mar–Jun.
  assert.equal(a.completeness_pct, (4 / 48) * 100);
  assert.equal(a.link, "/overview?period=2010&siteIds=1");
  // Site 2: 60 + 20 = 80; last year 100 → −20 %; 80 t ÷ 40 t = 2, last year 100 ÷ 50 = 2 → 0 % (flat).
  assert.equal(b.net, 80);
  assert.equal(b.prior, 100);
  assert.equal(b.change_pct, -20);
  assert.equal(b.share_pct, (80 / 250) * 100);
  assert.deepEqual(b.intensity, { value: 2, unit: "t", change_pct: 0, good: null });
  assert.equal(b.completeness_pct, (2 / 24) * 100);
  assert.equal(b.pending, 0);
  assert.equal(r.links["site:2"], "/overview?period=2010&siteIds=2");
});

test("site compare equals /manager/overview's by_site; one site asked reads that site only; empty year is no_data", async () => {
  const ov = (await call("GET", "/manager/overview?period=2010", "manager")).json;
  const r = (await panel("manager", "/site-compare?year=2010")).json;
  for (const row of r.data.rows) {
    const s = ov.by_site.find((x) => x.site_id === row.site_id);
    assert.equal(row.net, s.net);
    assert.equal(row.change_pct, s.net_vs_last_year_pct);
  }
  const one = (await panel("manager", "/site-compare?year=2010&sites=2")).json;
  assert.deepEqual(one.data.rows.map((x) => x.site_id), [2]);
  assert.equal(one.data.rows[0].share_pct, 100);
  const none = (await panel("manager", "/site-compare?year=2004")).json;
  assert.equal(none.availability, "no_data");
  assert.equal(none.data, null);
});

test("site compare: roles, site scope, tenant isolation and switch-off", async () => {
  const url = "/insights/site-compare?year=2010";
  for (const who of ["user", "multiSiteUser"]) {
    const r = await call("GET", url, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "IN_FORBIDDEN");
  }
  for (const [who, qs] of [["manager", "&sites=3"], ["otherManager", "&company_id=1"], ["admin", "&company_id=2"]]) {
    const r = await call("GET", url + qs, who);
    assert.equal(r.status, 404, `${who}${qs}`);
    assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
  }
  assert.equal((await call("GET", url, "superadmin")).json.code, "IN_COMPANY_REQUIRED");
  const sa = (await panel("superadmin", "/site-compare?year=2010")).json;
  assert.deepEqual(sa.data.rows.map((x) => x.site_id), [1, 2], "company 1 only: company 2's site never appears");
  assert.equal((await call("GET", url, "otherManager")).json.code, "IN_OFF");
  await setInsights(1, false);
  try {
    for (const who of ["manager", "admin"]) assert.equal((await call("GET", url, who)).json.code, "IN_OFF", who);
    assert.equal((await call("GET", `${url}&company_id=1`, "superadmin")).json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
