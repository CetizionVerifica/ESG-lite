// S3-12 screening and extrapolation: GET /scope3/screening, PUT
// /scope3/screening/inputs, POST /scope3/extrapolate (and ?dry_run=1),
// POST /scope3/screening/sector-suggestions. Tenant isolation, the role
// matrix, EXTRAPOLATION_BASIS_INVALID, DUPLICATE_EXISTING, proxy rows never
// used as sources, estimates never saved as rows, audit rows, and the
// migration (with the S3-9 survey backfill) run twice.
//
// Fixture: company 1 (sites 1, 2), company 2 (site 3). Category 3 "Business
// Travel" (Scope 3, site 1) is set to Category 6 here and put back after.
// Rows use pk_id 81500–81599 in 2011 (and 2010), years no other test writes to.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const YEAR = 2011;
const SECTOR = "CI Air transportation (NAICS 481000)";

let saved = null;
const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type IN ('scope3_proxy', 'scope3_screening_input') OR (entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE extra_data ? 'extrapolation'))`);
    await db.query(`DELETE FROM emission WHERE pk_id BETWEEN 81500 AND 81599 OR (extra_data ? 'extrapolation' AND date_of_reporting BETWEEN '2010-01-01' AND '2011-12-31')`);
    await db.query(`DELETE FROM production_data WHERE production_id BETWEEN 81500 AND 81599`);
    await db.query(`DELETE FROM product WHERE product_id BETWEEN 81500 AND 81599`);
    await db.query(`DELETE FROM scope3_screening_input WHERE company_id IN (1, 2) AND year IN (2010, 2011)`);
    await db.query(`DELETE FROM emission_factors WHERE site_id IS NULL AND emission_category_name = $1`, [SECTOR]);
    await db.query(`DELETE FROM site_categories WHERE site_id = 2 AND category_id = 3`);
    await db.query(`UPDATE category SET ghg_category = $1 WHERE category_id = 3`, [saved?.cat ?? null]);
    if (saved) await db.query(`UPDATE company_scope3_category SET relevance = $1 WHERE company_id = 1 AND ghg_category = 6`, [saved.relevance === null ? null : JSON.stringify(saved.relevance)]);
  });

// `method` goes in activity_data["@method"] (S3-9 forms); `methodColumn` in emission.method (S3-3).
const insert = (db, id, kg, { status = "approved", site = 1, method = null, methodColumn = null, extra = {}, proxy = null, year = YEAR } = {}) =>
  db.query(
    `INSERT INTO emission (pk_id, activity_data, total_emission, total_kgco2e, unit, date_of_reporting, status, category_id, site_id, extra_data, proxy, method)
     VALUES ($1, $2, $3, $4, 'tCO2e', $5, $6, 3, $7, $8, $9, $10)`,
    [id, JSON.stringify({ activity_value: 1, ...(method ? { "@method": method } : {}) }), Math.round(kg / 10) / 100, kg.toFixed(4), `${year}-05-31`, status, site, JSON.stringify(extra), proxy && JSON.stringify(proxy), methodColumn],
  );

test.before(async () => {
  saved = await withDb(async (db) => ({
    cat: (await db.query(`SELECT ghg_category FROM category WHERE category_id = 3`)).rows[0]?.ghg_category ?? null,
    relevance: (await db.query(`SELECT relevance FROM company_scope3_category WHERE company_id = 1 AND ghg_category = 6`)).rows[0]?.relevance ?? null,
  }));
  await reset();
  await withDb(async (db) => {
    await db.query(`UPDATE category SET ghg_category = 6 WHERE category_id = 3`);
    await insert(db, 81500, 600, { methodColumn: "distance_based" });
    await insert(db, 81501, 250, { method: "distance_based" });
    await insert(db, 81502, 50, { status: "pending", method: "spend_based" });
    await insert(db, 81503, 999, { status: "rejected" });
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name,
                                     factor_type, geography, dataset, dataset_version, includes_wtt, price_base_year, price_currency)
       VALUES (NULL, NULL, $2, 0.5, 'USD', 'CI', $1, $1, 'eeio_spend', 'US', 'USEEIO', 'CI', false, $2, 'USD')`,
      [SECTOR, YEAR],
    );
  });
});
test.after(reset);

const emissionCount = () => withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM emission`)).rows[0].n);

// ── GET /scope3/screening ────────────────────────────────────────────────────

test("GET: 15 categories with recorded (approved + pending) tCO₂e, any role with access", async () => {
  const r = await call("GET", `/scope3/screening?year=${YEAR}`, "user");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.categories.length, 15);
  assert.equal(r.json.can_edit, false);
  assert.equal(r.json.can_extrapolate, false);
  const c6 = r.json.categories.find((c) => c.n === 6);
  assert.equal(c6.recorded_tco2e, 0.9, "600 + 250 approved + 50 pending kg; rejected rows never count");
  assert.equal(c6.pending_tco2e, 0.05);
  assert.equal(c6.estimate_tco2e, null);
  assert.equal(c6.size_basis, "recorded");
  assert.equal(c6.share_pct, 100);
  assert.ok(c6.suggestion.status);
  const c9 = r.json.categories.find((c) => c.n === 9);
  assert.deepEqual(c9.suggestion, { status: "not_relevant", reason: `No activity in this category in ${YEAR}` });
  const admin = await call("GET", `/scope3/screening?year=${YEAR}`, "admin");
  assert.equal(admin.json.can_edit, true);
  const manager = await call("GET", `/scope3/screening?year=${YEAR}`, "manager");
  assert.equal(manager.json.can_extrapolate, true);
  assert.deepEqual(manager.json.sites.map((s) => s.site_id).sort(), [1, 2], "the caller's sites for the Extrapolate dialog");
  assert.ok(manager.json.sites.find((s) => s.site_id === 1).ghg_categories.includes(6));
  assert.deepEqual(r.json.sites.map((s) => s.site_id), [1], "a User sees only their own site");
});

test("GET: tenant isolation, Superadmin needs company_id, bad year is 400", async () => {
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}&company_id=1`, "otherManager")).status, 404);
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}&company_id=1`, "otherUser")).status, 404);
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}`, "superadmin")).status, 400);
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}&company_id=1`, "superadmin")).status, 200);
  assert.equal((await call("GET", `/scope3/screening?year=abc`, "admin")).status, 400);
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}&year_type=XX`, "admin")).status, 400);
  const other = await call("GET", `/scope3/screening?year=${YEAR}`, "otherManager");
  assert.equal(other.status, 200);
  assert.equal(other.json.categories.find((c) => c.n === 6).recorded_tco2e, 0, "company 2 never sees company 1 rows");
  assert.equal((await call("GET", `/scope3/screening?year=${YEAR}`)).status, 401);
});

// ── PUT /scope3/screening/inputs ─────────────────────────────────────────────

test("PUT inputs: Admin and Superadmin only; company 2 on company 1 → 404; validation", async () => {
  const body = { year: YEAR, inputs: [{ ghg_category: 6, basis: "spend", amount: 1000, currency: "USD", eeio_sector: "481000" }] };
  assert.equal((await call("PUT", "/scope3/screening/inputs", "manager", body)).status, 403);
  assert.equal((await call("PUT", "/scope3/screening/inputs", "user", body)).status, 403);
  assert.equal((await call("PUT", "/scope3/screening/inputs", "otherManager", { ...body, company_id: 1 })).status, 404);
  assert.equal((await call("PUT", "/scope3/screening/inputs", "superadmin", body)).status, 400, "Superadmin passes company_id");
  const noCurrency = await call("PUT", "/scope3/screening/inputs", "admin", { year: YEAR, inputs: [{ ghg_category: 6, basis: "spend", amount: 10 }] });
  assert.equal(noCurrency.status, 400);
  assert.equal(noCurrency.json.code, "SCOPE3_VALIDATION");
  assert.equal((await call("PUT", "/scope3/screening/inputs", "admin", { year: YEAR, inputs: [{ ghg_category: 16, basis: "spend", amount: 1, currency: "USD" }] })).status, 400);
  assert.equal((await call("PUT", "/scope3/screening/inputs", "admin", { year: YEAR, inputs: [{ ghg_category: 6, basis: "floor_area", amount: 1 }] })).status, 400);
  assert.equal((await call("PUT", "/scope3/screening/inputs", "admin", { year: YEAR, inputs: [{ ghg_category: 6, basis: "spend", amount: -1, currency: "USD" }] })).status, 400);
  const twice = { year: YEAR, inputs: [body.inputs[0], body.inputs[0]] };
  assert.equal((await call("PUT", "/scope3/screening/inputs", "admin", twice)).status, 400);
});

test("PUT inputs saves, upserts and audits; GET estimates spend × USEEIO and headcount × the commute, never as rows", async () => {
  const before = await emissionCount();
  const r = await call("PUT", "/scope3/screening/inputs", "admin", {
    year: YEAR,
    inputs: [
      { ghg_category: 6, basis: "spend", amount: 1000, currency: "USD", eeio_sector: "481000", note: "Travel agency invoices" },
      { ghg_category: 7, basis: "headcount", amount: 10 },
      { ghg_category: 10, basis: "mass_sold", amount: 5000 },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.inputs.length, 3);
  // Same values again: nothing changes, no new audit row.
  const again = await call("PUT", "/scope3/screening/inputs", "superadmin", { company_id: 1, year: YEAR, inputs: [{ ghg_category: 7, basis: "headcount", amount: 12 }] });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.inputs.find((i) => i.ghg_category === 7).amount, 12);
  const audits = await withDb((db) => db.query(`SELECT action, changed_fields FROM audit_log WHERE entity_type = 'scope3_screening_input' ORDER BY id`));
  assert.deepEqual(audits.rows.map((a) => a.action), ["create", "create", "create", "update"]);
  assert.deepEqual(audits.rows[3].changed_fields.amount, { old: "10.0000", new: "12.0000" });

  const g = await call("GET", `/scope3/screening?year=${YEAR}`, "admin");
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const c6 = g.json.categories.find((c) => c.n === 6);
  assert.equal(c6.estimate_tco2e, 0.5, "1,000 USD × 0.5 kgCO₂e/USD, same currency and price year");
  assert.equal(c6.basis, "spend");
  assert.equal(c6.inputs[0].sector.code, "481000");
  const c7 = g.json.categories.find((c) => c.n === 7);
  assert.equal(c7.estimate_tco2e, Math.round(12 * 15 * 2 * 230 * 0.16725 / 10) / 100, "12 employees × 15 km × 2 × 230 days × DEFRA average car");
  assert.equal(c7.basis, "headcount");
  const c10 = g.json.categories.find((c) => c.n === 10);
  assert.equal(c10.estimate_tco2e, null);
  assert.equal(c10.suggestion.status, "screening", "an input without an estimate keeps screening");
  assert.ok(g.json.totals.estimate_tco2e > 0);
  assert.equal(await emissionCount(), before, "estimates are never saved as emission rows");
});

test("Sector suggestions: Admin only, validated, and unavailable AI is not an error", async () => {
  const line = { description: "Flights to Mumbai", amount: 1200, currency: "USD" };
  assert.equal((await call("POST", "/scope3/screening/sector-suggestions", "manager", line)).status, 403);
  assert.equal((await call("POST", "/scope3/screening/sector-suggestions", "otherManager", { ...line, company_id: 1 })).status, 404);
  assert.equal((await call("POST", "/scope3/screening/sector-suggestions", "admin", { amount: 1 })).status, 400);
  const r = await call("POST", "/scope3/screening/sector-suggestions", "admin", line);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.confirm_below, 80);
  assert.ok(Array.isArray(r.json.suggestions));
});

test("Ticks and Apply go through the boundary: Manager 403, Admin may tick Table II 'spending or revenue analysis'", async () => {
  assert.equal((await call("PUT", "/scope3/categories/6", "manager", { status: "included" })).status, 403);
  const r = await call("PUT", "/scope3/categories/6", "admin", { status: "included", relevance: { stakeholders: true, spend_analysis: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = await call("GET", `/scope3/screening?year=${YEAR}`, "manager");
  const c6 = g.json.categories.find((c) => c.n === 6);
  assert.deepEqual(c6.relevance, { stakeholders: true, spend_analysis: true });
  assert.equal(c6.suggestion.status, "included");
  assert.equal(c6.suggestion.reason, "Relevant: stakeholders, spending or revenue analysis");
});

// ── POST /scope3/extrapolate ─────────────────────────────────────────────────

const coverage = (over = {}) => ({ ghg_category: 6, site_id: 1, year: YEAR, year_type: "CY", basis: "coverage", coverage_pct: 85, ...over });

test("extrapolate: roles and tenant isolation", async () => {
  assert.equal((await call("POST", "/scope3/extrapolate", "user", coverage())).status, 403);
  assert.equal((await call("POST", "/scope3/extrapolate", "otherManager", { ...coverage(), company_id: 1 })).status, 404);
  assert.equal((await call("POST", "/scope3/extrapolate", "otherManager", coverage())).status, 404, "site 1 is not company 2's");
  assert.equal((await call("POST", "/scope3/extrapolate", "otherManager", coverage({ site_id: 3, source_filter: { site_ids: [1] } }))).status, 404);
  assert.equal((await call("POST", "/scope3/extrapolate", "manager", coverage({ basis: "intensity", output_site_ids: [3] }))).status, 404);
});

test("extrapolate: EXTRAPOLATION_BASIS_INVALID for a coverage outside 1–99, no source rows, a site without the category", async () => {
  for (const pct of [0, 100, 0.5, undefined]) {
    const r = await call("POST", "/scope3/extrapolate", "manager", coverage({ coverage_pct: pct }));
    assert.equal(r.status, 400, String(pct));
    assert.equal(r.json.code, "EXTRAPOLATION_BASIS_INVALID", String(pct));
  }
  const none = await call("POST", "/scope3/extrapolate", "manager", coverage({ year: YEAR - 1 }));
  assert.equal(none.json.code, "EXTRAPOLATION_BASIS_INVALID");
  assert.equal(none.json.details.reason, "no_source_rows");
  const noCat = await call("POST", "/scope3/extrapolate", "manager", coverage({ site_id: 2 }));
  assert.equal(noCat.json.code, "EXTRAPOLATION_BASIS_INVALID");
  assert.equal(noCat.json.details.reason, "category_not_on_site");
  assert.equal((await call("POST", "/scope3/extrapolate", "manager", coverage({ basis: "mystery" }))).status, 400);
  assert.equal((await call("POST", "/scope3/extrapolate", "manager", coverage({ source_filter: { anything: 1 } }))).status, 400);
});

test("extrapolate coverage: dry run saves nothing; the row is Pending, secondary, estimated, with its basis and sources; audited", async () => {
  const before = await emissionCount();
  const dry = await call("POST", "/scope3/extrapolate?dry_run=1", "manager", coverage());
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.total_kgco2e, "150.0000", "850 kg approved at 85 % → 150 kg (pending and rejected rows are not sources)");
  assert.equal(dry.json.sources.rows, 2);
  assert.match(dry.json.formula, /^850 kgCO₂e × \(100 − 85\) ÷ 85 = 150 kgCO₂e$/);
  assert.equal(await emissionCount(), before);

  const r = await call("POST", "/scope3/extrapolate", "manager", coverage());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, "pending");
  assert.equal(r.json.method, "distance_based");
  const row = await withDb(async (db) => (await db.query(`SELECT * FROM emission WHERE pk_id = $1`, [r.json.id])).rows[0]);
  assert.equal(row.status, "pending");
  assert.equal(row.reporting_period, "yearly");
  assert.equal(row.year_type, "CY");
  assert.equal(row.total_kgco2e, "150.0000");
  assert.equal(Number(row.total_emission), 0.15);
  assert.deepEqual(row.proxy, { basis: "coverage", coverage_pct: 85, from: [81500, 81501] });
  // The S3-3 columns: secondary, estimated, the sources' method (one in emission.method, one in @method), completeness 3.
  assert.equal(row.data_type, "secondary");
  assert.equal(row.is_estimate, true);
  assert.equal(row.method, "distance_based");
  assert.equal(row.dq.completeness, 3);
  assert.equal(row.activity_data["@method"], "distance_based");
  assert.equal(row.emission_factor_snapshot.factor_type, "other");
  const audit = await withDb((db) => db.query(`SELECT entity_type, action FROM audit_log WHERE entity_id = $1 AND entity_type IN ('emission', 'scope3_proxy') ORDER BY entity_type`, [r.json.id]));
  assert.deepEqual(audit.rows, [{ entity_type: "emission", action: "create" }, { entity_type: "scope3_proxy", action: "extrapolate" }]);
});

test("a second pending proxy for the same category, site, year and basis → DUPLICATE_EXISTING with the existing id", async () => {
  const existing = await withDb(async (db) => (await db.query(`SELECT pk_id FROM emission WHERE site_id = 1 AND status = 'pending' AND proxy ->> 'basis' = 'coverage'`)).rows[0].pk_id);
  const r = await call("POST", "/scope3/extrapolate", "admin", coverage({ coverage_pct: 50 }));
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "DUPLICATE_EXISTING");
  assert.equal(r.json.details.existing_id, existing);
});

test("a proxy row is never a source, even once approved", async () => {
  await withDb((db) => db.query(`UPDATE emission SET status = 'approved' WHERE proxy ->> 'basis' = 'coverage' AND site_id = 1 AND date_of_reporting = $1`, [`${YEAR}-12-31`]));
  // A survey-scaled row (S3-9) is a sample proxy and never a source either.
  await withDb((db) => insert(db, 81510, 7000, { method: "distance_based", extra: { survey: { basis: "sample", respondents: 4, total_employees: 10, coverage_pct: 40 } } }));
  const dry = await call("POST", "/scope3/extrapolate?dry_run=1", "manager", coverage());
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.sources.rows, 2);
  assert.equal(dry.json.total_kgco2e, "150.0000");
});

test("extrapolate intensity: kg per output at sites with data × output at the site without", async () => {
  const body = { ghg_category: 6, site_id: 2, year: YEAR, year_type: "CY", basis: "intensity" };
  await withDb((db) => db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (2, 3)`));
  const noProduction = await call("POST", "/scope3/extrapolate", "manager", body);
  assert.equal(noProduction.json.code, "EXTRAPOLATION_BASIS_INVALID");
  assert.equal(noProduction.json.details.reason, "no_production");
  await withDb(async (db) => {
    await db.query(`INSERT INTO product (product_id, name, unit, site_id) VALUES (81500, 'CI S3-12 rod', 't', 1), (81501, 'CI S3-12 rod B', 't', 2)`);
    await db.query(
      `INSERT INTO production_data (production_id, product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
         (81500, 81500, 1, 500, 't', '${YEAR}-01-01', '${YEAR}-12-31', 'approved', 2),
         (81501, 81501, 2, 250, 't', '${YEAR}-01-01', '${YEAR}-12-31', 'approved', 2),
         (81502, 81501, 2, 999, 't', '${YEAR}-01-01', '${YEAR}-12-31', 'pending', 2)`,
    );
  });
  const r = await call("POST", "/scope3/extrapolate", "manager", body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  // 850 kg ÷ 500 t × 250 t; the approved coverage proxy and the survey row are not sources.
  assert.equal(r.json.total_kgco2e, "425.0000");
  assert.equal(r.json.production.source, 500);
  assert.equal(r.json.production.missing, 250);
  const row = await withDb(async (db) => (await db.query(`SELECT proxy, site_id, activity_data_unit FROM emission WHERE pk_id = $1`, [r.json.id])).rows[0]);
  assert.equal(row.site_id, 2);
  assert.equal(row.proxy.basis, "intensity");
  assert.deepEqual(row.proxy.from, [81500, 81501]);
  assert.equal(row.activity_data_unit, "t");

  // A site that already has data can't be a site without data.
  await withDb((db) => insert(db, 81520, 10, { site: 2 }));
  const covered = await call("POST", "/scope3/extrapolate", "admin", { ...body, basis: "intensity", source_filter: { site_ids: [1] }, output_site_ids: [2] });
  assert.equal(covered.status, 409, "the pending intensity row is still waiting");
  await withDb((db) => db.query(`UPDATE emission SET status = 'rejected' WHERE proxy ->> 'basis' = 'intensity' AND site_id = 2`));
  const again = await call("POST", "/scope3/extrapolate", "admin", { ...body, source_filter: { site_ids: [1] }, output_site_ids: [2] });
  assert.equal(again.json.code, "EXTRAPOLATION_BASIS_INVALID");
  assert.equal(again.json.details.reason, "output_site_has_data");
});

test("two extrapolations at once: one Pending row, the other DUPLICATE_EXISTING", async () => {
  // The site 1 coverage row was approved above, so nothing is pending for this key.
  const [a, b] = await Promise.all([call("POST", "/scope3/extrapolate", "manager", coverage()), call("POST", "/scope3/extrapolate", "admin", coverage())]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.json, b.json]));
  const pending = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE site_id = 1 AND status = 'pending' AND proxy ->> 'basis' = 'coverage'`));
  assert.equal(pending.rows[0].n, 1);
});

// ── migrate:scope3-screening ─────────────────────────────────────────────────

const runScript = (name) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`)], { cwd: ROOT, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });

test("migrate:scope3-screening runs twice and backfills survey rows into emission.proxy (basis sample)", async () => {
  await withDb((db) => insert(db, 81530, 100, { extra: { survey: { basis: "sample", respondents: 1, total_employees: 3 } } }));
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateScope3Screening");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const rows = await withDb(async (db) => (await db.query(`SELECT pk_id, proxy FROM emission WHERE pk_id IN (81510, 81530) ORDER BY pk_id`)).rows);
  assert.deepEqual(rows[0].proxy, { basis: "sample", coverage_pct: 40, from: [] });
  assert.deepEqual(rows[1].proxy, { basis: "sample", from: [] }, "no coverage_pct in the survey → none in the proxy");
  const untouched = await withDb(async (db) => (await db.query(`SELECT proxy FROM emission WHERE pk_id = 81500`)).rows[0].proxy);
  assert.equal(untouched, null, "measured rows stay without a proxy");
});
