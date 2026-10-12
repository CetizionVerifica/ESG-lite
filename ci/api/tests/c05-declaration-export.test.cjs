// C05: declaration export (GET /pcf/studies/:id/export?format=pdf-data|pact|csv).
// Uses site 2 in 2019 with its own plant data, removed afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const ids = { emissions: [], production: [] };
let product, open, licensed, country;

test.before(async () => {
  await withDb(async (db) => {
    product = (
      await db.query(
        `INSERT INTO product (name, description, unit, site_id, declared_unit, declared_unit_qty, mass_per_unit_kg)
         VALUES ('Export rod', 'Aluminium rod, 9.5 mm', 'tonnes', 2, 'kg', 1, 1) RETURNING product_id`,
      )
    ).rows[0].product_id;
    ids.production = (
      await db.query(
        `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by)
         VALUES ($1, 2, 1000, 't', '2019-01-01', '2019-12-31', 'approved', 7) RETURNING production_id`,
        [product],
      )
    ).rows.map((r) => r.production_id);
    ids.emissions = (
      await db.query(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type)
         VALUES ('{}', 500, 'tCO2e', '2019-12-31', 'approved', 7, 2, 2, 'yearly', 'CY') RETURNING pk_id`,
      )
    ).rows.map((r) => r.pk_id);
    country = (await db.query(`INSERT INTO country (name, code) VALUES ('Exportland', 'XE') RETURNING country_id`)).rows[0].country_id;
    await db.query("UPDATE site SET country_id = $1 WHERE site_id = 2", [country]);
  });
  open = (await call("POST", "/pcf/material-factors", "manager", { name: "Export alu", material_group: "aluminium", unit: "kg", value_kgco2e: 8.6, source: "IAI", source_year: 2021 })).json
    .material_factor_id;
  licensed = (
    await call("POST", "/pcf/material-factors", "superadmin", { name: "Export licensed film", material_group: "plastic", unit: "kg", value_kgco2e: 3.917, licence: "ecoinvent", source: "ecoinvent" })
  ).json.material_factor_id;
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query("DELETE FROM pcf_study WHERE product_id = $1", [product]);
    await db.query("DELETE FROM emission WHERE pk_id = ANY($1)", [ids.emissions]);
    await db.query("DELETE FROM production_data WHERE production_id = ANY($1)", [ids.production]);
    await db.query("DELETE FROM product WHERE product_id = $1", [product]);
    await db.query("DELETE FROM material_factor WHERE material_factor_id = ANY($1)", [[open, licensed]]);
    await db.query("UPDATE site SET country_id = NULL WHERE site_id = 2");
    await db.query("DELETE FROM country WHERE country_id = $1", [country]);
  });
});

const lines = (withLicensed) => [
  { stage: "A1", name: "Aluminium", unit: "kg", quantity: 1, material_factor_id: open },
  ...(withLicensed ? [{ stage: "A3_packaging", name: "Wrap film", unit: "kg", quantity: 1, material_factor_id: licensed }] : []),
];

async function study(withLicensed, from) {
  const res = await call("POST", "/pcf/studies", "manager", from ? { copy_from_id: from } : { product_id: product, reference_start: "2019-01-01", reference_end: "2019-12-31", pcr_tag: "EN 15804" });
  assert.equal(res.status, 201);
  const id = res.json.pcf_study_id;
  if (!from) assert.equal((await call("PUT", `/pcf/studies/${id}/inputs`, "manager", { inputs: lines(withLicensed) })).status, 200);
  return id;
}
const calc = async (id) => assert.equal((await call("POST", `/pcf/studies/${id}/calculate`, "manager", {})).status, 200);
const approve = async (id) => {
  assert.equal((await call("POST", `/pcf/studies/${id}/submit`, "manager")).status, 200);
  assert.equal((await call("POST", `/pcf/studies/${id}/approve`, "superadmin")).status, 200);
};
const exp = async (id, format, who = "manager") => {
  const res = await call("GET", `/pcf/studies/${id}/export?format=${format}`, who);
  return { ...res, text: res.json ? JSON.stringify(res.json) : res.buffer.toString("utf8") };
};

test("access, format and draft rules", async () => {
  const id = await study(false);
  assert.equal((await exp(id, "pdf-data")).status, 409); // not calculated yet
  await calc(id);
  assert.equal((await exp(id, "xml")).status, 400);
  assert.equal((await exp(id, "pdf-data", "otherManager")).status, 404);
  assert.equal((await exp(id, "pdf-data", "user")).status, 403);
  assert.equal((await exp(999999, "pdf-data")).status, 404);

  const pact = await exp(id, "pact");
  assert.equal(pact.status, 409);
  assert.match(pact.json.message, /approved or published/);

  const pdf = await exp(id, "pdf-data");
  assert.equal(pdf.status, 200);
  const d = pdf.json.declaration;
  assert.equal(d.draft, true);
  assert.equal(d.product.name, "Export rod");
  assert.equal(d.site.country, "Exportland");
  assert.equal(d.method.pcr, "EN 15804");
  assert.match(pdf.json.file_name, /^Export-rod-\d+-v1\.pdf$/);
  assert.ok(Math.abs(d.total_kg_per_unit - (8.6 + 0.5)) < 1e-9, `total ${d.total_kg_per_unit}`);

  const csv = await exp(id, "csv");
  assert.equal(csv.status, 200);
  assert.match(csv.text, /^\uFEFF"DRAFT"/);
  assert.match(csv.text, /"Product","Export rod"/);
});

test("approved and published export as an Active PACT footprint that passes the schema", async () => {
  const id = await study(false);
  await calc(id);
  await approve(id);
  const res = await exp(id, "pact");
  assert.equal(res.status, 200, res.text);
  const pf = res.json;
  assert.equal(pf.specVersion, "3.0.3");
  assert.equal(pf.status, "Active");
  assert.match(pf.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal((await exp(id, "pact")).json.id, pf.id); // stable per study
  assert.equal(pf.companyName, "CI Steel Co");
  assert.match(pf.companyIds[0], /^urn:pact:[^:]+:company-id:1$/);
  assert.match(pf.productIds[0], new RegExp(`^urn:pact:[^:]+:supplier-id:${product}$`));
  assert.equal(pf.productDescription, "Aluminium rod, 9.5 mm");
  const c = pf.pcf;
  assert.equal(c.declaredUnitOfMeasurement, "kilogram");
  assert.equal(c.declaredUnitAmount, "1");
  assert.equal(c.productMassPerDeclaredUnit, "1");
  assert.equal(c.referencePeriodStart, "2019-01-01T00:00:00Z");
  assert.equal(c.referencePeriodEnd, "2020-01-01T00:00:00Z");
  assert.equal(c.geographyCountry, "XE");
  assert.equal(c.pcfExcludingBiogenicUptake, "9.1");
  assert.equal(c.fossilGhgEmissions, "9.1");
  assert.deepEqual(c.ipccCharacterizationFactors, ["AR6"]);
  assert.deepEqual(c.crossSectoralStandards, ["ISO14067", "PACT-3.0"]);
  assert.deepEqual(c.secondaryEmissionFactorSources, [{ name: "IAI", version: "2021" }]);
  assert.deepEqual(c.productOrSectorSpecificRules, [{ operator: "Other", otherOperatorName: "EN 15804", ruleNames: ["EN 15804"] }]);
  assert.equal(c.primaryDataShare !== undefined && c.dqi !== undefined, true);
  assert.match(res.headers.get("content-disposition"), /\.pact\.json"$/);

  const csv = await exp(id, "csv");
  assert.equal(/DRAFT/.test(csv.text), false);
  assert.equal((await exp(id, "pdf-data")).json.declaration.draft, false);

  // Publishing a second version deprecates the first and links back to it.
  assert.equal((await call("POST", `/pcf/studies/${id}/publish`, "manager")).status, 200);
  const v2 = await study(false, id);
  await calc(v2);
  await approve(v2);
  assert.equal((await call("POST", `/pcf/studies/${v2}/publish`, "manager")).status, 200);
  const old = (await exp(id, "pact")).json;
  assert.equal(old.status, "Deprecated");
  const next = (await exp(v2, "pact")).json;
  assert.equal(next.status, "Active");
  assert.deepEqual(next.precedingPfIds, [pf.id]);
});

test("licensed factor values never leave the platform, not even for a superadmin", async () => {
  const id = await study(true);
  await calc(id);
  await approve(id);
  for (const who of ["manager", "superadmin"]) {
    for (const format of ["pdf-data", "pact", "csv"]) {
      const res = await exp(id, format, who);
      assert.equal(res.status, 200, `${who} ${format}: ${res.text}`);
      assert.equal(res.text.includes("3.917"), false, `${who} ${format} leaks the licensed value`);
    }
  }
  const d = (await exp(id, "pdf-data", "superadmin")).json.declaration;
  assert.equal(d.licensed_values_withheld, true);
  assert.equal(d.by_stage.A3_packaging, null);
  assert.deepEqual(d.hidden_stages, ["A3_packaging"]);
  assert.equal(d.lines.find((l) => l.name === "Wrap film").kgco2e_per_unit, null);
  assert.equal(d.lines.find((l) => l.name === "Aluminium").kgco2e_per_unit, 8.6);
  assert.equal(d.primary_data_share_pct, null);
  assert.equal(d.dqr, null);
  assert.ok(Math.abs(d.total_kg_per_unit - (8.6 + 3.917 + 0.5)) < 1e-9);
  const pf = (await exp(id, "pact", "superadmin")).json;
  assert.equal(pf.pcf.packagingGhgEmissions, undefined);
  assert.equal(pf.pcf.primaryDataShare, undefined);
  assert.equal(pf.pcf.dqi, undefined);
});

test("a declared unit with no PACT equivalent is refused; PDF and CSV still work", async () => {
  const id = await study(false);
  await calc(id);
  await approve(id);
  await withDb((db) => db.query("UPDATE product SET declared_unit = 'bag' WHERE product_id = $1", [product]));
  try {
    const res = await exp(id, "pact");
    assert.equal(res.status, 400);
    assert.match(res.json.message, /no PACT equivalent/);
    assert.equal((await exp(id, "csv")).status, 200);
  } finally {
    await withDb((db) => db.query("UPDATE product SET declared_unit = 'kg' WHERE product_id = $1", [product]));
  }
});
