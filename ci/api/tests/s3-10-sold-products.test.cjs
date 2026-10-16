// S3-10 sold products: product sales (create, CSV-size bulk upsert, edit),
// the use profile (EOL mix must add up to 100 %), the Category 10 / 11 / 12
// plans (rows per product, per material × treatment, no totals sent, a second
// plan for a committed year leaves the saved rows out), roles (User 403),
// tenant isolation (company 2 tokens on company 1 ids → 404), and both
// migrations run twice (columns, Category 10, forms, AR6 refrigerant rows).
//
// Fixture: company 1 (sites 1, 2), company 2 (site 3). This file adds
// categories 941 "CI Processing" (Category 10), 942 "CI Use of sold" (11) and
// 943 "CI End of life" (12) on site 1, products 9401–9403 on sites 1 and 3, a
// PCF study for 9401 and end-of-life factors, and removes all of it afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const CAT10 = 941;
const CAT11 = 942;
const CAT12 = 943;
const CATS = `${CAT10}, ${CAT11}, ${CAT12}`;
const CABLE = 9401; // site 1, 2 kg per drum, with a PCF study
const CHILLER = 9402; // site 1, contains R134a
const OTHER = 9403; // company 2, site 3

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM emission WHERE category_id IN (${CATS})`);
    await db.query(`DELETE FROM import_plan WHERE source_name LIKE 'Category 1_ sold products%'`);
    await db.query(`DELETE FROM product_sale WHERE product_id IN (${CABLE}, ${CHILLER}, ${OTHER})`);
    await db.query(`DELETE FROM pcf_study WHERE product_id IN (${CABLE}, ${CHILLER}, ${OTHER})`);
    await db.query(`DELETE FROM product WHERE product_id IN (${CABLE}, ${CHILLER}, ${OTHER})`);
    await db.query(`DELETE FROM site_categories WHERE category_id IN (${CATS})`);
    await db.query(`DELETE FROM emission_factors WHERE category_id IN (${CATS})`);
    await db.query(`DELETE FROM unit WHERE category_id IN (${CATS})`);
    await db.query(`DELETE FROM column_config WHERE category_id IN (${CATS})`);
    await db.query(`DELETE FROM category WHERE category_id IN (${CATS})`);
    // The Category 10 migrate:scope3-sold-products creates when this file's 941 is gone.
    await db.query(`DELETE FROM category WHERE category_id > 100 AND ghg_category = 10 AND category_name = 'Processing of sold products'`);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'scope3_use_profile'`);
  });

const EOL = (material, treatment) => `End of life - ${material} - ${treatment} [kg]`;

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, 'CI Processing', 'Scope 3', 10), ($2, 'CI Use of sold', 'Scope 3', 11), ($3, 'CI End of life', 'Scope 3', 12)`,
      [CAT10, CAT11, CAT12],
    );
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (1, $1), (1, $2), (1, $3)`, [CAT10, CAT11, CAT12]);
    await db.query(
      `INSERT INTO product (product_id, name, unit, site_id, mass_per_unit_kg) VALUES ($1, 'CI Cable drum', 'drum', 1, 2), ($2, 'CI Chiller', 'unit', 1, 80), ($3, 'CI Other product', 'unit', 3, 1)`,
      [CABLE, CHILLER, OTHER],
    );
    // The cable's study: 60 % aluminium, 40 % XLPE by mass; packaging is a wooden drum.
    const study = await db.query(
      `INSERT INTO pcf_study (company_id, product_id, site_id, reference_start, reference_end, status) VALUES (1, $1, 1, '2024-01-01', '2024-12-31', 'approved') RETURNING pcf_study_id`,
      [CABLE],
    );
    const sid = study.rows[0].pcf_study_id;
    await db.query(
      `INSERT INTO pcf_input (pcf_study_id, stage, name, quantity, unit) VALUES ($1, 'A1', 'Aluminium rod', 1.2, 'kg'), ($1, 'A1', 'XLPE insulation', 800, 'g'), ($1, 'A3_packaging', 'Wooden drum', 0.5, 'kg'), ($1, 'A1', 'Electricity', 3, 'kWh')`,
      [sid],
    );
    // End-of-life factors for the cable's materials (1 and 2 kgCO₂e per kg), and a processing factor.
    for (const m of ["Aluminium", "Plastics", "Wood"]) {
      await db.query(
        `INSERT INTO emission_factors (site_id, category_id, emission_category_name, global_category_name, factor_value, denominator_unit, year, source, factor_type)
         VALUES (1, $1, $2, $2, 1, 'kg', 2024, 'CI', 'process'), (1, $1, $3, $3, 2, 'kg', 2024, 'CI', 'process')`,
        [CAT12, EOL(m, "Landfill"), EOL(m, "Incineration")],
      );
    }
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, emission_category_name, global_category_name, factor_value, denominator_unit, year, source, factor_type)
       VALUES (1, $1, 'Processing of sold products [kg]', 'Processing of sold products [kg]', 1.5, 'kg', 2024, 'CI', 'process')`,
      [CAT10],
    );
    // Category 11: the seed's AR4 refrigerant row (2025) and the grid factor.
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, emission_category_name, global_category_name, factor_value, denominator_unit, year, source, gwp_set)
       VALUES (1, $1, 'R134a - GWP', 'R134a - GWP', 1430, 'kg', 2025, 'IPCC AR4 GWP100', NULL), (1, $1, 'R134a - GWP', 'R134a - GWP', 1430, 'kg', 2024, 'IPCC AR4 GWP100', NULL)`,
      [CAT11],
    );
  });
});
test.after(reset);

const sale = (over = {}) => ({ product_id: CABLE, period: "2025-03", quantity: 1000, unit: "drum", region: "India", ...over });

test("sales: a Manager adds, re-imports (upsert) and edits; Admin and Superadmin read; User gets 403", async () => {
  const one = await call("POST", "/scope3/product-sales", "manager", sale());
  assert.equal(one.status, 201, JSON.stringify(one.json));
  assert.deepEqual(one.json, { created: 1, updated: 0, unchanged: 0 });

  // The CSV import: same product, month, unit and region replaces the quantity.
  const bulk = await call("POST", "/scope3/product-sales", "manager", {
    sales: [sale({ period: "2025-03-15" }), sale({ period: "2025-04", quantity: 500 }), { product_id: CHILLER, period: "2025-06", quantity: 10, unit: "unit", region: null }],
  });
  assert.equal(bulk.status, 201, JSON.stringify(bulk.json));
  assert.deepEqual(bulk.json, { created: 2, updated: 0, unchanged: 1 });

  const list = await call("GET", "/scope3/product-sales?year=2025", "manager");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.deepEqual(
    list.json.sales.map((s) => [s.product, s.period, s.quantity, s.unit, s.mass_kg]),
    [
      ["CI Chiller", "2025-06-01", 10, "unit", 800],
      ["CI Cable drum", "2025-03-01", 1000, "drum", 2000],
      ["CI Cable drum", "2025-04-01", 500, "drum", 1000],
    ].sort((a, b) => a[0].localeCompare(b[0])),
  );
  const site1 = list.json.sites.find((s) => s.site_id === 1);
  assert.deepEqual(site1.categories, { 10: CAT10, 11: CAT11, 12: CAT12 });
  assert.ok(list.json.products.some((p) => p.product_id === CABLE && p.mass_per_unit_kg === 2));
  // FY 2026 = April 2025 to March 2026.
  const fy = await call("GET", "/scope3/product-sales?year=2026&year_type=FY", "admin");
  assert.deepEqual(fy.json.sales.map((s) => s.period).sort(), ["2025-04-01", "2025-06-01"]);

  const april = list.json.sales.find((s) => s.period === "2025-04-01");
  const edit = await call("PUT", `/scope3/product-sales/${april.id}`, "manager", { quantity: 600 });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal(edit.json.quantity, 600);
  assert.equal(edit.json.mass_kg, 1200);
  await call("PUT", `/scope3/product-sales/${april.id}`, "manager", { quantity: 500 });

  // A sale typed by mistake can be removed.
  const typo = await call("POST", "/scope3/product-sales", "manager", sale({ period: "2025-05", quantity: 9999 }));
  assert.equal(typo.status, 201);
  const typoId = (await call("GET", "/scope3/product-sales?year=2025", "manager")).json.sales.find((s) => s.period === "2025-05-01").id;
  assert.equal((await call("DELETE", `/scope3/product-sales/${typoId}`, "user")).status, 403);
  assert.equal((await call("DELETE", `/scope3/product-sales/${typoId}`, "otherManager")).status, 404);
  const del = await call("DELETE", `/scope3/product-sales/${typoId}`, "manager");
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await call("DELETE", `/scope3/product-sales/${typoId}`, "manager")).status, 404);
  assert.equal((await call("GET", "/scope3/product-sales?year=2025", "manager")).json.sales.length, 3);

  assert.equal((await call("GET", "/scope3/product-sales?company_id=1", "superadmin")).status, 200);
  assert.equal((await call("GET", "/scope3/product-sales", "superadmin")).json.code, "SCOPE3_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/scope3/product-sales", "user")).status, 403);
  assert.equal((await call("POST", "/scope3/product-sales", "user", sale())).status, 403);
  assert.equal((await call("PUT", `/scope3/product-sales/${april.id}`, "user", { quantity: 1 })).status, 403);
  assert.equal((await call("PUT", `/scope3/products/${CABLE}/use-profile`, "user", { lifetime_uses: 3 })).status, 403);
  assert.equal((await call("POST", "/scope3/sold-products/plan", "user", { site_id: 1, year: 2025, year_type: "CY", ghg_category: 12 })).status, 403);
  assert.equal((await call("GET", "/scope3/product-sales")).status, 401);
});

test("sales: validation (bad month, quantity, too many rows, unknown keys)", async () => {
  for (const bad of [sale({ period: "2025-13" }), sale({ period: "March" }), sale({ quantity: 0 }), sale({ unit: "" }), { ...sale(), colour: "red" }]) {
    const r = await call("POST", "/scope3/product-sales", "manager", bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "SCOPE3_VALIDATION");
  }
  const tooMany = await call("POST", "/scope3/product-sales", "manager", { sales: Array.from({ length: 5001 }, () => sale()) });
  assert.equal(tooMany.status, 400);
  assert.equal((await call("PUT", "/scope3/product-sales/abc", "manager", { quantity: 1 })).status, 404);
});

test("use profile: EOL shares must add up to 100 %; changes are audited", async () => {
  for (const eol_mix of [[{ treatment: "landfill", share: 0.6 }], [{ treatment: "burying", share: 1 }], [{ treatment: "landfill", share: 0.5 }, { treatment: "landfill", share: 0.5 }]]) {
    const r = await call("PUT", `/scope3/products/${CABLE}/use-profile`, "manager", { eol_mix });
    assert.equal(r.status, 400, JSON.stringify(eol_mix));
    assert.equal(r.json.code, "SCOPE3_VALIDATION");
  }
  const badOption = await call("PUT", `/scope3/products/${CHILLER}/use-profile`, "manager", { use_profile: { use_type: "gas", use_option: "India" } });
  assert.equal(badOption.status, 400);

  const ok = await call("PUT", `/scope3/products/${CABLE}/use-profile`, "manager", {
    eol_mix: [
      { treatment: "landfill", share: 0.9 },
      { treatment: "incineration", share: 0.1 },
      { treatment: "recycling", share: 0 },
    ],
    use_profile: { packaging_kg_per_unit: 0.5 },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.eol_mix.length, 3);
  assert.equal(ok.json.use_profile.packaging_kg_per_unit, 0.5);
  const chiller = await call("PUT", `/scope3/products/${CHILLER}/use-profile`, "admin", { use_profile: { use_type: "gas", use_option: "R134a", gas_per_product_kg: 2 } });
  assert.equal(chiller.status, 200, JSON.stringify(chiller.json));
  // lifetime_uses kept when not sent.
  const again = await call("PUT", `/scope3/products/${CABLE}/use-profile`, "manager", { lifetime_uses: 12 });
  assert.equal(again.json.lifetime_uses, 12);
  assert.equal(again.json.use_profile.packaging_kg_per_unit, 0.5);
  const audit = await withDb((db) => db.query(`SELECT changed_fields FROM audit_log WHERE entity_type = 'scope3_use_profile' AND entity_id = $1 ORDER BY id`, [CABLE]));
  assert.equal(audit.rows.length, 2);
  assert.deepEqual(Object.keys(audit.rows[1].changed_fields), ["lifetime_uses"]);
});

test("tenant isolation: company 2 tokens on company 1 ids, and company 1 on company 2's, give 404", async () => {
  const [own] = (await call("GET", "/scope3/product-sales?year=2025", "manager")).json.sales;
  assert.equal((await call("GET", "/scope3/product-sales?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("PUT", `/scope3/product-sales/${own.id}`, "otherManager", { quantity: 1 })).status, 404);
  assert.equal((await call("POST", "/scope3/product-sales", "otherManager", sale())).status, 404);
  assert.equal((await call("PUT", `/scope3/products/${CABLE}/use-profile`, "otherManager", { lifetime_uses: 99 })).status, 404);
  assert.equal((await call("POST", "/scope3/sold-products/plan", "otherManager", { site_id: 1, year: 2025, year_type: "CY", ghg_category: 12 })).status, 404);
  // Company 1 on company 2's product and site.
  assert.equal((await call("POST", "/scope3/product-sales", "admin", sale({ product_id: OTHER }))).status, 404);
  assert.equal((await call("PUT", `/scope3/products/${OTHER}/use-profile`, "admin", { lifetime_uses: 3 })).status, 404);
  assert.equal((await call("POST", "/scope3/sold-products/plan", "admin", { site_id: 3, year: 2025, year_type: "CY", ghg_category: 10 })).status, 404);
  // Nothing changed.
  const row = await withDb((db) => db.query(`SELECT quantity FROM product_sale WHERE id = $1`, [own.id]));
  assert.equal(Number(row.rows[0].quantity), own.quantity);
  const other = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM product_sale WHERE product_id = $1`, [OTHER]));
  assert.equal(other.rows[0].n, 0);
  const lu = await withDb((db) => db.query(`SELECT lifetime_uses FROM product WHERE product_id = $1`, [CABLE]));
  assert.equal(Number(lu.rows[0].lifetime_uses), 12);
});

const plan = (who, ghg_category, extra = {}) => call("POST", "/scope3/sold-products/plan", who, { site_id: 1, year: 2025, year_type: "CY", ghg_category, ...extra });

test("Category 12 plan: product × material × treatment, packaging included, the engine calculates; re-planning a committed year leaves the saved rows out", async () => {
  const r = await plan("manager", 12);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.plan.channel, "bulk_upload");
  assert.equal(r.json.plan.source_name, "Category 12 sold products CY 2025");
  // Cable: 1,500 drums × 2 kg = 3,000 kg (60 % aluminium, 40 % plastics) + 750 kg wooden drums;
  // 90 % landfill, 10 % incineration, the 0 % recycling rows are not created.
  // Chiller: no EOL mix → one average_data Mixed row (no factor yet: an issue to fix).
  const rows = r.json.plan.rows;
  const cable = rows.filter((x) => x.input.fields["Product name"] === "CI Cable drum");
  assert.equal(cable.length, 6, JSON.stringify(rows.map((x) => x.input.activity_name)));
  const mass = Object.fromEntries(cable.map((x) => [`${x.input.activity_name}`, [x.input.fields["Mass at end of life (kg)"], x.input.fields["Share treated this way (%)"]]]));
  assert.deepEqual(mass, {
    "Aluminium|Landfill": [1800, 90],
    "Aluminium|Incineration": [1800, 10],
    "Plastics|Landfill": [1200, 90],
    "Plastics|Incineration": [1200, 10],
    "Wood|Landfill": [750, 90],
    "Wood|Incineration": [750, 10],
  });
  for (const x of cable) {
    assert.equal(x.state, "ready", JSON.stringify(x.issues));
    assert.equal(x.input.fields["@method"], "waste_type_specific");
    for (const k of ["total", "total_emission", "total_tco2e", "total_kgco2e"]) assert.equal(k in x.input, false);
  }
  // 3,750 kg × (90 % × 1 + 10 % × 2) = 4,125 kg.
  const t = cable.reduce((s, x) => s + x.result.total_tco2e, 0);
  assert.ok(Math.abs(t - 4.125) <= 0.03, String(t));
  const chiller = rows.filter((x) => x.input.fields["Product name"] === "CI Chiller");
  assert.deepEqual(chiller.map((x) => [x.input.activity_name, x.input.fields["@method"], x.state]), [["Mixed|Average (treatment unknown)", "average_data", "issue"]]);
  assert.equal(chiller[0].issues[0].code, "UNKNOWN_ACTIVITY");

  // Nothing saved until commit; then a second plan for 2025 leaves the saved rows out
  // (emissionWrite flags DUPLICATE_EXISTING for monthly rows only).
  const before = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE category_id = $1`, [CAT12]));
  assert.equal(before.rows[0].n, 0);
  const commit = await call("POST", `/imports/plans/${r.json.plan.plan_id}/commit`, "manager", {
    version: r.json.plan.version,
    skip_rows_with_issues: true,
    idempotency_key: `s3-10-${r.json.plan.plan_id}`,
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  const saved = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM emission WHERE category_id = $1`, [CAT12]));
  assert.equal(saved.rows[0].n, 6);
  const second = await plan("manager", 12);
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.equal(second.json.plan.rows.filter((x) => x.input.fields["Product name"] === "CI Cable drum").length, 0);
  assert.deepEqual(second.json.skipped, [{ product_id: CABLE, product: "CI Cable drum", reason: "already_imported" }]);
  // The chiller's row was not saved (it had an issue), so it is planned again.
  assert.equal(second.json.plan.rows.length, 1);
  await withDb((db) => db.query(`DELETE FROM import_plan WHERE source_name LIKE 'Category 1_ sold products%' AND status = 'draft'`));
});

test("Category 10 and 11 plans: one row per product; products without the data are listed as skipped", async () => {
  const p10 = await plan("admin", 10);
  assert.equal(p10.status, 201, JSON.stringify(p10.json));
  const rows10 = p10.json.plan.rows;
  assert.deepEqual(rows10.map((x) => [x.input.fields["Product name"], x.input.fields["Mass sold (kg)"], x.state]).sort(), [
    ["CI Cable drum", 3000, "ready"],
    ["CI Chiller", 800, "ready"],
  ]);
  // 3,000 kg × 1.5 = 4.5 t (formula 10.2).
  assert.equal(rows10.find((x) => x.input.fields["Product name"] === "CI Cable drum").result.total_tco2e, 4.5);
  await withDb((db) => db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [p10.json.plan.plan_id]));

  // Category 11: the chiller's gas profile (10 × 2 kg × 100 % × GWP 1,430 for 2025 rows: factor year 2024).
  const p11 = await plan("manager", 11);
  assert.equal(p11.status, 201, JSON.stringify(p11.json));
  assert.deepEqual(p11.json.skipped.map((s) => [s.product_id, s.reason]), [[CABLE, "missing_use_profile"]]);
  const [row] = p11.json.plan.rows;
  assert.equal(row.input.activity_name, "Product containing gas|R134a");
  assert.equal(row.state, "ready", JSON.stringify(row.issues));
  assert.equal(row.result.total_tco2e, 28.6);
  await withDb((db) => db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [p11.json.plan.plan_id]));

  // No sales in the year: no plan.
  const empty = await plan("manager", 10, { year: 2023 });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.plan, null);
});

test("plan: a newer plan for the same site, category and year cancels the older draft, so the year can't be imported twice", async () => {
  const first = await plan("admin", 10);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const second = await plan("manager", 10);
  assert.equal(second.status, 201, JSON.stringify(second.json));
  const status = (id) => withDb((db) => db.query(`SELECT status FROM import_plan WHERE plan_id = $1`, [id])).then((r) => r.rows[0].status);
  assert.equal(await status(first.json.plan.plan_id), "cancelled");
  assert.equal(await status(second.json.plan.plan_id), "draft");
  const late = await call("POST", `/imports/plans/${first.json.plan.plan_id}/commit`, "admin", {
    version: first.json.plan.version,
    skip_rows_with_issues: true,
    idempotency_key: `s3-10-late-${first.json.plan.plan_id}`,
  });
  assert.equal(late.status, 409, JSON.stringify(late.json));
  // Another category's draft for the same site and year is left alone.
  const other = await plan("admin", 11);
  assert.equal(other.status, 201, JSON.stringify(other.json));
  assert.equal(await status(second.json.plan.plan_id), "draft");
  await withDb((db) => db.query(`DELETE FROM import_plan WHERE plan_id = ANY($1::uuid[])`, [[first.json.plan.plan_id, second.json.plan.plan_id, other.json.plan.plan_id]]));
});

test("Category 11 rows dated 2026 use the AR6 refrigerant value (D7)", async () => {
  const add = await call("POST", "/scope3/product-sales", "manager", { product_id: CHILLER, period: "2026-02", quantity: 10, unit: "unit" });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  try {
    const p = await plan("admin", 11, { year: 2026 });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    const [row] = p.json.plan.rows;
    assert.equal(row.state, "ready", JSON.stringify(row.issues));
    // 10 × 2 kg × 100 % × 1,530 (factor year 2025, raised from the seed's AR4 1,430) = 30.6 t.
    assert.equal(row.result.total_tco2e, 30.6);
    await withDb((db) => db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [p.json.plan.plan_id]));
  } finally {
    await withDb((db) => db.query(`DELETE FROM product_sale WHERE product_id = $1 AND period = '2026-02-01'`, [CHILLER]));
  }
});

test("plan: a site without the category, a bad body, a customised form give 400", async () => {
  const r = await call("POST", "/scope3/sold-products/plan", "admin", { site_id: 2, year: 2025, year_type: "CY", ghg_category: 12 });
  assert.equal(r.status, 400);
  assert.equal(r.json.details.reason, "CATEGORY_12_NOT_ASSIGNED");
  for (const bad of [{ site_id: 1, year: 2025, year_type: "CY", ghg_category: 9 }, { site_id: 1, year: 2025, ghg_category: 10 }, { site_id: 1, year: 2025, year_type: "Q1", ghg_category: 10 }]) {
    assert.equal((await call("POST", "/scope3/sold-products/plan", "admin", bad)).status, 400, JSON.stringify(bad));
  }
  await withDb((db) => db.query(`UPDATE column_config SET config_name = 'A client form', emission_category_mapping = '{}' WHERE category_id = $1`, [CAT10]));
  const custom = await plan("admin", 10);
  assert.equal(custom.status, 400);
  assert.equal(custom.json.details.reason, "SOLD_PRODUCTS_FORM_CUSTOMISED");
});

const runScript = (name, args = []) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`), ...args], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

test("migrate:scope3-sold-products runs twice: columns present, Category 10 once", async () => {
  await withDb((db) => db.query(`UPDATE category SET ghg_category = NULL WHERE category_id = $1`, [CAT10]));
  try {
    const first = runScript("migrateScope3SoldProducts");
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const second = runScript("migrateScope3SoldProducts");
    assert.equal(second.status, 0, second.stderr + second.stdout);
    const cats = await withDb((db) => db.query(`SELECT category_name, scope FROM category WHERE ghg_category = 10`));
    assert.deepEqual(cats.rows, [{ category_name: "Processing of sold products", scope: "Scope 3" }]);
    const cols = await withDb((db) =>
      db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'product' AND column_name IN ('lifetime_uses', 'eol_mix', 'use_profile') ORDER BY column_name`),
    );
    assert.deepEqual(cols.rows.map((r) => r.column_name), ["eol_mix", "lifetime_uses", "use_profile"]);
  } finally {
    await withDb((db) => db.query(`UPDATE category SET ghg_category = 10 WHERE category_id = $1`, [CAT10]));
  }
});

test("migrate:scope3-sold-product-forms runs twice: forms, units, AR6 for rows dated 2026 on (factor years 2025, 2026), older rows marked AR4", async () => {
  await withDb((db) => db.query(`DELETE FROM column_config WHERE category_id = $1`, [CAT10]));
  const counts = () =>
    withDb(async (db) => {
      const q = (sql) => db.query(sql).then((r) => r.rows[0].n);
      return {
        configs: await q(`SELECT COUNT(*)::int AS n FROM column_config WHERE category_id IN (${CATS})`),
        units: await q(`SELECT COUNT(*)::int AS n FROM unit WHERE category_id IN (${CATS})`),
        factors: await q(`SELECT COUNT(*)::int AS n FROM emission_factors WHERE category_id IN (${CATS})`),
      };
    });
  const first = runScript("migrateScope3SoldProductForms", ["1"]);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const after1 = await counts();
  const second = runScript("migrateScope3SoldProductForms", ["1"]);
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.deepEqual(await counts(), after1);
  assert.equal(after1.configs, 3);

  const r134a = await withDb((db) =>
    db.query(`SELECT year, factor_value, gwp_set FROM emission_factors WHERE category_id = $1 AND emission_category_name = 'R134a - GWP' ORDER BY year`, [CAT11]),
  );
  assert.deepEqual(r134a.rows.map((r) => [r.year, Number(r.factor_value), r.gwp_set]), [
    [2024, 1430, "AR4"],
    [2025, 1530, "AR6"],
    [2026, 1530, "AR6"],
  ]);
  const cfg11 = await withDb((db) => db.query(`SELECT config_name, calculation FROM column_config WHERE category_id = $1`, [CAT11]));
  assert.equal(cfg11.rows[0].config_name, "Use of Sold Products - Standard");
  assert.ok(cfg11.rows[0].calculation.methods["Part of a customer's product"]);
  const cfg12 = await withDb((db) => db.query(`SELECT calculation FROM column_config WHERE category_id = $1`, [CAT12]));
  assert.equal(cfg12.rows[0].calculation.method_column, "@method");
  // The module logs nothing but the error name.
  for (const file of ["service.js", "controller.js", "forms.js", "bom.js", "rows.js"]) {
    const src = fs.readFileSync(path.join(ROOT, "dist/scope3/soldProducts", file), "utf8");
    for (const line of src.split("\n").filter((l) => /console\./.test(l))) assert.match(line, /\.name\)/, `${file}: ${line.trim()}`);
  }
});
