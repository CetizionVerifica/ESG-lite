// S3-5: spend rows. A typed entry "from the amount spent" converts at the
// stored rate of its invoice date, deflates to the factor's price year and
// stores the rate (emission.fx) and the deflator (snapshot); fallbacks warn;
// an unsupported currency is refused; a recalculation reuses the stored rate;
// bulk/Claude rows in a currency unit go the same way; the read endpoints,
// the Superadmin deflator upload and the USEEIO library copy keep to their
// roles and companies; migrate:scope3-spend runs twice.
//
// The local golden case: INR 1,000,000 on 2026-09-03 at the seeded rate,
// deflated 2026 → 2022 with the seeded index. Expected values are computed
// here from the seeded figures, never from a live API.
//
// Runs on company 2 / site 3 and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { planRows, insertRows, prepareEntry, ContextCache, CheckCache } = require(path.resolve("dist/services/emissionWrite/index.js"));

const SITE = 3;
const CAT1 = 150; // a Scope 3 Category 1 category, added below
const LIB = 951; // a USEEIO library factor (no site)
const PER_USD = 954; // a factor per USD with no factor_type and no price year (an older library row)
const FACTORS = [950, 952, 953, PER_USD, LIB];
const RATE = 88.9; // INR per USD on 2026-09-03 (seeded)
const RATE_AUG = 87.6; // on 2026-08-07
const IDX_2022 = 292.655;
const IDX_2026 = 330.2; // a test figure for 2026
const CTX = { user_id: 4, role: "User", company_id: 2, allowed_site_ids: [SITE], allowed_category_ids_by_site: {} };

const kgFor = (amountInr, factor) => (amountInr / RATE) * (IDX_2022 / IDX_2026) * factor;

const typed = (date, activity_data, extra_data = {}, unit) =>
  call("POST", "/user/emissions", "otherUser", { site_id: SITE, category_id: CAT1, date_of_reporting: date, activity_data_unit: unit, activity_data, extra_data });

const rowOf = (id) =>
  withDb(async (db) => (await db.query(`SELECT total_emission::float8 AS total, fx, emission_factor_snapshot AS snap, activity_data_unit FROM emission WHERE pk_id = $1`, [id])).rows[0]);

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES (${CAT1}, 'Purchased goods and services S3-5', 'Scope 3', 1) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${CAT1}) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type, dataset, price_base_year, price_currency) VALUES
      (950, ${SITE}, ${CAT1}, 2025, 0.42, 'USD', 'CI', 'Steel mills S3-5', 'Steel mills S3-5', 'eeio_spend', 'USEEIO', 2022, 'USD'),
      (952, ${SITE}, ${CAT1}, 2025, 0.30, 'USD', 'CI', 'Old prices S3-5', 'Old prices S3-5', 'eeio_spend', 'USEEIO', 2017, 'USD'),
      (953, ${SITE}, ${CAT1}, 2025, 2.10, 'kg', 'CI', 'Steel per kg S3-5', 'Steel per kg S3-5', 'cradle_to_gate', 'CI', NULL, NULL),
      (${PER_USD}, ${SITE}, ${CAT1}, 2025, 0.50, 'USD', 'CI', 'Per USD untyped S3-5', 'Per USD untyped S3-5', NULL, NULL, NULL, NULL),
      (${LIB}, NULL, NULL, 2022, 0.55, 'USD', 'CI', 'Library sector S3-5 (NAICS 999999)', 'Library sector S3-5 (NAICS 999999)', 'eeio_spend', 'USEEIO', 2022, 'USD')`);
    await db.query(`INSERT INTO fx_rate (currency, date, rate_to_usd, source) VALUES ('INR', '2026-09-03', ${RATE}, 'ecb'), ('INR', '2026-08-07', ${RATE_AUG}, 'ecb') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO price_deflator (country, year, "index", source) VALUES ('US', 2022, ${IDX_2022}, 'CI'), ('US', 2026, ${IDX_2026}, 'CI') ON CONFLICT (country, year) DO UPDATE SET "index" = EXCLUDED."index"`);
  });
  await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE site_id = ${SITE} AND category_id = ${CAT1})`);
    await db.query(`DELETE FROM emission WHERE site_id = ${SITE} AND category_id = ${CAT1}`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1) OR (site_id = ${SITE} AND category_id = ${CAT1})`, [FACTORS]);
    await db.query(`DELETE FROM site_categories WHERE site_id = ${SITE} AND category_id = ${CAT1}`);
    await db.query(`DELETE FROM category WHERE category_id = ${CAT1}`);
    await db.query(`DELETE FROM fx_rate WHERE source IN ('ecb', 'CI')`);
    await db.query(`DELETE FROM price_deflator WHERE source IN ('CI', 'CI upload')`);
  });
  await AppDataSource.destroy();
});

test("local golden case: INR 1,000,000 on 3 Sep 2026, deflated 2026 → 2022, stores its rate and deflator", async () => {
  const res = await typed("2026-09-30", { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "1000000", currency: "INR" }, { invoice_date: "2026-09-03" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const kg = kgFor(1000000, 0.42);
  assert.equal(Number(res.json.emission.total_emission), Math.round((kg / 1000) * 100) / 100);
  assert.deepEqual(res.json.warnings ?? [], []);
  const row = await rowOf(res.json.emission.pk_id);
  assert.equal(row.activity_data_unit, "INR");
  assert.deepEqual(row.fx, { currency: "INR", to: "USD", rate: 1 / RATE, as_of: "2026-09-03", source: "ecb", spend_date: "2026-09-03" });
  assert.deepEqual(row.snap.deflator, { country: "US", base_year: 2022, spend_year: 2026, base_index: IDX_2022, spend_index: IDX_2026, source: "CI" });
  assert.equal(row.snap.factor_type, "eeio_spend");
});

test("S3-3 on spend rows: method spend_based, the engine's data quality and data type; the same total from `method` or `@method`", async () => {
  const quality = (id) => withDb(async (db) => (await db.query(`SELECT method, dq, data_type, total_emission::float8 AS total FROM emission WHERE pk_id = $1`, [id])).rows[0]);
  // The S3-5 stand-in: "@method" in activity_data.
  const viaAt = await typed("2026-01-31", { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "2000", currency: "INR" }, { invoice_date: "2026-09-03" });
  assert.equal(viaAt.status, 201, JSON.stringify(viaAt.json));
  // The S3-3 field: `method` on the row.
  const viaMethod = await call("POST", "/user/emissions", "otherUser", {
    site_id: SITE, category_id: CAT1, date_of_reporting: "2026-02-28", method: "spend_based",
    activity_data: { emission_category: "Steel mills S3-5", spent_value: "2000", currency: "INR" }, extra_data: { invoice_date: "2026-09-03" },
  });
  assert.equal(viaMethod.status, 201, JSON.stringify(viaMethod.json));
  const ids = [viaAt.json.emission.pk_id, viaMethod.json.emission.pk_id];
  for (const id of ids) {
    const q = await quality(id);
    assert.equal(q.method, "spend_based");
    assert.equal(q.data_type, "secondary");
    assert.equal(q.dq.source, "auto");
    assert.equal(q.dq.technology, 3, "a spend factor describes the purchase least");
    assert.equal(q.dq.reliability, 3, "spend is the least reliable method");
    assert.equal(q.total, Math.round((kgFor(2000, 0.42) / 1000) * 100) / 100, "S3-3 never moves the S3-5 total");
  }
  // A quantity in a currency unit with no method (bulk and Claude rows) is a spend row too, and recorded as one.
  const bulk = await typed("2026-12-31", { emission_category: "Steel mills S3-5", activity_value: "3000" }, { invoice_date: "2026-09-03" }, "INR");
  assert.equal(bulk.status, 201, JSON.stringify(bulk.json));
  assert.equal((await quality(bulk.json.emission.pk_id)).method, "spend_based");
});

test("a weekend purchase uses the nearest earlier stored day, with no warning", async () => {
  const res = await typed("2026-09-15", { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "500", currency: "INR" }, { invoice_date: "2026-09-06" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.warnings ?? [], []);
  assert.equal((await rowOf(res.json.emission.pk_id)).fx.as_of, "2026-09-03");
});

test("FX_RATE_FALLBACK: no rate within 7 days uses the latest stored one and warns", async () => {
  const res = await typed("2026-07-31", { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "250000", currency: "INR" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.warnings.map((w) => w.code), ["FX_RATE_FALLBACK"]);
  assert.equal((await rowOf(res.json.emission.pk_id)).fx.as_of, "2026-09-03");
});

test("NO_DEFLATOR: a factor priced in 2017 with no 2017 index is not deflated, with a warning", async () => {
  const res = await typed("2026-08-31", { emission_category: "Old prices S3-5", "@method": "spend_based", spent_value: "1000", currency: "USD" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.warnings.map((w) => w.code), ["NO_DEFLATOR"]);
  assert.equal(Number(res.json.emission.total_emission), Math.round(((1000 * 0.3) / 1000) * 100) / 100);
  const row = await rowOf(res.json.emission.pk_id);
  assert.equal(row.fx.source, "same currency");
  assert.equal(row.snap.deflator, undefined);
});

test("CURRENCY_NOT_SUPPORTED: a currency without rates is refused; a per-kg factor can't take an amount spent", async () => {
  const jpy = await typed("2026-06-30", { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "1000", currency: "JPY" });
  assert.equal(jpy.status, 400);
  assert.equal(jpy.json.code, "CURRENCY_NOT_SUPPORTED");
  assert.equal(jpy.json.field, "currency");
  const perKg = await typed("2026-06-30", { emission_category: "Steel per kg S3-5", "@method": "spend_based", spent_value: "1000", currency: "USD" });
  assert.equal(perKg.status, 400);
  assert.equal(perKg.json.code, "FIELD_INVALID");
  const noAmount = await typed("2026-06-30", { emission_category: "Steel mills S3-5", "@method": "spend_based" }, {}, "kg");
  assert.equal(noAmount.status, 400);
  assert.equal(noAmount.json.code, "FIELD_REQUIRED");
});

test("the average-data method on the same form is unchanged (kg × factor, no fx)", async () => {
  const res = await typed("2026-05-31", { emission_category: "Steel per kg S3-5", activity_value: "1000" }, {}, "kg");
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(Number(res.json.emission.total_emission), 2.1);
  assert.equal((await rowOf(res.json.emission.pk_id)).fx, null);
});

test("recalculating with the stored fx gives the same total, whatever the table says now", async () => {
  const contexts = new ContextCache(AppDataSource.manager);
  const ctx = await contexts.context(SITE, CAT1);
  const input = {
    site_id: SITE,
    category_id: CAT1,
    activity_data: { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "1000000", currency: "INR" },
    activity_data_unit: "INR",
    period: { date_of_reporting: "2026-09-30", reporting_period: "monthly", year_type: null },
    extra_data: { invoice_date: "2026-09-03" },
  };
  const first = await prepareEntry(ctx, new CheckCache(AppDataSource.manager), input);
  assert.equal(first.ok, true);
  const stored = first.entry.computed.fx;
  // A different rate for that day can't appear (stored days never change), so prove reuse with a different stored rate.
  const again = await prepareEntry(ctx, new CheckCache(AppDataSource.manager), { ...input, storedFx: { ...stored, rate: 1 / 80 } });
  assert.equal(again.entry.computed.total_kgco2e, ((1000000 / 80) * (IDX_2022 / IDX_2026) * 0.42).toFixed(4));
  const same = await prepareEntry(ctx, new CheckCache(AppDataSource.manager), { ...input, storedFx: stored });
  assert.equal(same.entry.computed.total_kgco2e, first.entry.computed.total_kgco2e);
});

const round2 = (kg) => Math.round((kg / 1000) * 100) / 100;

test("editing a spend row (user and manager) recalculates through the engine and reuses its stored rate", async () => {
  const data = { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "1000000", currency: "INR" };
  const res = await typed("2026-09-20", data, { invoice_date: "2026-09-03" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = res.json.emission.pk_id;
  // Rewrite the stored day's rate: an edit with the same currency and date must keep the row's own rate.
  await withDb((db) => db.query(`UPDATE fx_rate SET rate_to_usd = 50 WHERE currency = 'INR' AND date = '2026-09-03'`));
  try {
    const edit = await call("PUT", `/user/emissions/${id}`, "otherUser", { activity_data: { ...data, spent_value: "2000000" }, extra_data: { invoice_date: "2026-09-03" } });
    assert.equal(edit.status, 200, JSON.stringify(edit.json));
    const row = await rowOf(id);
    assert.equal(row.total, round2(kgFor(2000000, 0.42)));
    assert.equal(row.fx.rate, 1 / RATE);
    assert.equal(row.snap.deflator.base_index, IDX_2022);
  } finally {
    await withDb((db) => db.query(`UPDATE fx_rate SET rate_to_usd = ${RATE} WHERE currency = 'INR' AND date = '2026-09-03'`));
  }
  // A manager edit that moves the purchase date takes that day's stored rate.
  const moved = await call("PUT", `/user/emissions/manager-edit/${id}`, "otherManager", {
    activity_data: { ...data, spent_value: "2000000", invoice_date: "2026-08-07" },
    reason: "Invoice date corrected",
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  const after = await rowOf(id);
  assert.equal(after.fx.as_of, "2026-08-07");
  assert.equal(after.total, round2((2000000 / RATE_AUG) * (IDX_2022 / IDX_2026) * 0.42));
});

test("spent value and currency extras count only when the row asks for spend; otherwise the quantity in its currency unit", async () => {
  const res = await typed("2026-04-30", { emission_category: "Steel mills S3-5", quantity: "1000" }, { spent_value: "1000", currency: "INR" }, "USD");
  assert.equal(res.status, 201, JSON.stringify(res.json));
  // 1,000 USD (the row's unit), deflated 2026 → 2022; not 1,000 INR from the informational extras.
  assert.equal(Number(res.json.emission.total_emission), round2(1000 * (IDX_2022 / IDX_2026) * 0.42));
  assert.equal((await rowOf(res.json.emission.pk_id)).fx.currency, "USD");
});

test("bulk and Claude rows: an amount in a currency unit is a spend row, stored with its fx", async () => {
  const rows = [{ row_ref: "r1", site_id: SITE, category_id: CAT1, period: { kind: "monthly", date: "2026-08-10" }, activity_name: "Steel mills S3-5", activity_value: 2000000, activity_unit: "INR" }];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.equal(planned[0].state, "ready", JSON.stringify(planned[0].issues));
  const kg = (2000000 / RATE_AUG) * (IDX_2022 / IDX_2026) * 0.42;
  assert.equal(planned[0].result.total_tco2e, Math.round((kg / 1000) * 100) / 100);
  const batch = { upload_batch_id: "s3-5-ci-batch", channel: "api", source_name: "CI", company_id: 2 };
  const out = await AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, batch));
  assert.equal(out.inserted, 1);
  const row = await rowOf(out.ids[0]);
  assert.equal(row.fx.currency, "INR");
  assert.equal(row.fx.as_of, "2026-08-07", "a row with no invoice date converts at its reporting date (10 Aug → nearest earlier stored day)");
  const unsupported = await planRows(CTX, [{ ...rows[0], row_ref: "r2", activity_unit: "JPY", period: { kind: "monthly", date: "2026-04-10" } }], { planMatches: [] });
  assert.equal(unsupported[0].state, "issue");
  assert.ok(unsupported[0].issues.some((i) => i.code === "CURRENCY_NOT_SUPPORTED" && i.severity === "error"));
});

test("GET /fx-rates and /fx-rates/currencies: any signed-in user; read only", async () => {
  assert.equal((await call("GET", "/fx-rates/currencies")).status, 401);
  const cur = await call("GET", "/fx-rates/currencies", "user");
  assert.equal(cur.status, 200);
  assert.deepEqual(cur.json.currencies.map((c) => c.code), ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"]);
  const r = await call("GET", "/fx-rates?currency=INR&date=2026-09-03&to=USD&price_year=2022", "otherUser");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rate, 1 / RATE);
  assert.equal(r.json.as_of, "2026-09-03");
  assert.equal(r.json.deflator.base_index, IDX_2022);
  const bad = await call("GET", "/fx-rates?currency=JPY&date=2026-09-03", "user");
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, "CURRENCY_NOT_SUPPORTED");
  assert.equal((await call("GET", "/fx-rates?currency=INR&date=yesterday", "user")).status, 400);
});

test("POST /scope3/deflators: Superadmin only; validated; GET lists them", async () => {
  const body = { country: "in", source: "CI upload", values: [{ year: 2030, index: 150.5 }] };
  assert.equal((await call("POST", "/scope3/deflators", "admin", body)).status, 403);
  assert.equal((await call("POST", "/scope3/deflators", "otherManager", body)).status, 403);
  assert.equal((await call("POST", "/scope3/deflators", "superadmin", { ...body, values: [{ year: 2030, index: -1 }] })).status, 400);
  const ok = await call("POST", "/scope3/deflators", "superadmin", body);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.deflators, [{ country: "IN", year: 2030, index: 150.5, source: "CI upload" }]);
  const list = await call("GET", "/scope3/deflators?country=US", "user");
  assert.deepEqual(list.json.deflators.map((d) => d.year), [2022, 2026]);
});

test("USEEIO library: listed for anyone; copied to own sites by Manager and above only", async () => {
  const lib = await call("GET", "/scope3/spend/library?q=Library sector S3-5", "otherUser");
  assert.equal(lib.status, 200);
  assert.deepEqual(lib.json.factors.map((f) => f.emission_factor_id), [LIB]);
  const body = { site_id: SITE, category_id: CAT1, factor_ids: [LIB], year: 2026 };
  assert.equal((await call("POST", "/scope3/spend/library/copy", "otherUser", body)).status, 403);
  // Company 1's manager can't copy into company 2's site (tenant isolation): 404, like an unknown site.
  assert.equal((await call("POST", "/scope3/spend/library/copy", "manager", body)).status, 404);
  assert.equal((await call("POST", "/scope3/spend/library/copy", "manager", { ...body, company_id: 2 })).status, 404);
  const first = await call("POST", "/scope3/spend/library/copy", "otherManager", body);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.deepEqual(first.json, { copied: 1, skipped: 0, year: 2026 });
  const again = await call("POST", "/scope3/spend/library/copy", "otherManager", body);
  assert.deepEqual(again.json, { copied: 0, skipped: 1, year: 2026 });
  const copy = await withDb(async (db) => (await db.query(`SELECT factor_type, price_base_year, price_currency, dataset FROM emission_factors WHERE site_id = $1 AND category_id = $2 AND emission_category_name LIKE 'Library sector S3-5%'`, [SITE, CAT1])).rows);
  assert.deepEqual(copy, [{ factor_type: "eeio_spend", price_base_year: 2022, price_currency: "USD", dataset: "USEEIO" }]);
  const notScope3 = await call("POST", "/scope3/spend/library/copy", "otherManager", { ...body, category_id: 1 });
  assert.equal(notScope3.status, 400);
});

test("migrate:scope3-spend runs twice and loads the EPA USEEIO file once; the second run changes nothing", async () => {
  const script = path.resolve("dist/scripts/migrateScope3Spend.js");
  // Fixtures insert factor ids by hand: start the sequence past them so the library rows never collide.
  await withDb((db) => db.query(`SELECT setval(pg_get_serial_sequence('emission_factors', 'emission_factor_id'), (SELECT max(emission_factor_id) FROM emission_factors))`));
  const outputs = [];
  for (let pass = 1; pass <= 2; pass++) {
    const run = spawnSync(process.execPath, [script], { env: process.env, encoding: "utf8" });
    assert.equal(run.status, 0, `pass ${pass}: ${run.stderr}`);
    outputs.push(run.stdout);
  }
  assert.match(outputs[1], /US CPI-U: 0 year\(s\) added/);
  assert.match(outputs[0], /SupplyChainGHGEmissionFactors_v1\.3\.0_NAICS_CO2e_USD2022\.csv: 1016 sector\(s\), 1016 added/);
  assert.match(outputs[1], /1016 sector\(s\), 0 added/);
  const steel = await withDb(async (db) => (await db.query(`SELECT factor_value::float8 AS v, price_base_year, dataset_version FROM emission_factors WHERE site_id IS NULL AND emission_category_name = 'Iron and Steel Mills and Ferroalloy Manufacturing (NAICS 331110)'`)).rows);
  assert.deepEqual(steel, [{ v: 0.787, price_base_year: 2022, dataset_version: "SEF v1.3.0" }]);
  await withDb((db) => db.query(`DELETE FROM emission_factors WHERE site_id IS NULL AND dataset_version = 'SEF v1.3.0'`));
  const cpi = await withDb(async (db) => (await db.query(`SELECT "index"::float8 AS i FROM price_deflator WHERE country = 'US' AND year = 2022`)).rows[0].i);
  assert.equal(cpi, IDX_2022, "a stored index is never changed");
  await withDb((db) => db.query(`DELETE FROM price_deflator WHERE source = 'BLS CPI-U annual average (1982-84=100)'`));
});

test("the Emission factors page lists the USEEIO library only when asked", async () => {
  const q = "/admin/emission-factors?search=Library%20sector%20S3-5";
  const plain = await call("GET", q, "superadmin");
  assert.equal(plain.status, 200, JSON.stringify(plain.json));
  assert.equal(plain.json.data.filter((f) => f.emission_factor_id === LIB).length, 0);
  const lib = await call("GET", `${q}&library=1`, "superadmin");
  assert.equal(lib.json.data.filter((f) => f.emission_factor_id === LIB).length, 1);
});

test("a currency row on a factor per USD with no factor type takes the spend path: rate stored, no deflation", async () => {
  // Bulk / Claude: INR on a per-USD factor converts at the stored rate (10 Aug → 7 Aug), not the live unit table.
  const rows = [{ row_ref: "u1", site_id: SITE, category_id: CAT1, period: { kind: "monthly", date: "2026-08-10" }, activity_name: "Per USD untyped S3-5", activity_value: 1000000, activity_unit: "INR" }];
  const planned = await planRows(CTX, rows, { planMatches: [] });
  assert.equal(planned[0].state, "ready", JSON.stringify(planned[0].issues));
  assert.equal(planned[0].result.total_tco2e, round2((1000000 / RATE_AUG) * 0.5));
  assert.deepEqual(planned[0].issues.map((i) => i.code), [], "no price year: no deflation and no NO_DEFLATOR");
  const out = await AppDataSource.transaction((tx) => insertRows(tx, CTX, planned, { upload_batch_id: "s3-5-ci-untyped", channel: "mcp", source_name: "CI", company_id: 2 }));
  const row = await rowOf(out.ids[0]);
  assert.deepEqual(row.fx, { currency: "INR", to: "USD", rate: 1 / RATE_AUG, as_of: "2026-08-07", source: "ecb", spend_date: "2026-08-10" });
  assert.equal(row.snap.deflator, undefined);
  // Typed: the same.
  const typedRes = await typed("2026-09-03", { emission_category: "Per USD untyped S3-5", quantity: "500000" }, {}, "INR");
  assert.equal(typedRes.status, 201, JSON.stringify(typedRes.json));
  assert.equal(Number(typedRes.json.emission.total_emission), round2((500000 / RATE) * 0.5));
  assert.equal((await rowOf(typedRes.json.emission.pk_id)).fx.rate, 1 / RATE);
  // Already in the factor's currency: left to the factor, unchanged (no fx).
  const usd = await typed("2026-03-31", { emission_category: "Per USD untyped S3-5", quantity: "1000" }, {}, "USD");
  assert.equal(usd.status, 201, JSON.stringify(usd.json));
  assert.equal(Number(usd.json.emission.total_emission), 0.5);
  assert.equal((await rowOf(usd.json.emission.pk_id)).fx, null);
});

test("recalculation: a stored live or fallback rate is replaced by the stored rate of the purchase day", async () => {
  const ctx = await new ContextCache(AppDataSource.manager).context(SITE, CAT1);
  const input = {
    site_id: SITE,
    category_id: CAT1,
    activity_data: { emission_category: "Steel mills S3-5", "@method": "spend_based", spent_value: "1000000", currency: "INR" },
    activity_data_unit: "INR",
    period: { date_of_reporting: "2026-09-30", reporting_period: "monthly", year_type: null },
    extra_data: { invoice_date: "2026-09-03" },
  };
  const live = { currency: "INR", to: "USD", rate: 1 / 95, as_of: "2026-09-03", source: "live", spend_date: "2026-09-03", fallback: true };
  const again = await prepareEntry(ctx, new CheckCache(AppDataSource.manager), { ...input, storedFx: live });
  assert.equal(again.ok, true);
  assert.deepEqual(again.entry.computed.fx, { currency: "INR", to: "USD", rate: 1 / RATE, as_of: "2026-09-03", source: "ecb", spend_date: "2026-09-03" });
  assert.deepEqual(again.entry.warnings.map((w) => w.code), []);
  // A row saved with the latest stored day (no flag) is quoted again too.
  const latest = { ...live, source: "ecb", as_of: "2026-10-01", rate: 1 / 70 };
  delete latest.fallback;
  const fromLatest = await prepareEntry(ctx, new CheckCache(AppDataSource.manager), { ...input, storedFx: latest });
  assert.equal(fromLatest.entry.computed.fx.rate, 1 / RATE);
});
