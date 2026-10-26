// Copy client setup: the .json bundle of a client's setup, the preview that
// writes nothing, the copy onto another client (create or skip, never
// overwrite), file uploads with unknown names, and Superadmin-only access.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const SRC = 1; // CI Steel Co: sites 1 + 2
const DST = 2; // CI Other Co: site 3 "CI Other Plant" (category 1)
let configId;
let factorIds = [];

test.before(() =>
  withDb(async (db) => {
    await db.query(`INSERT INTO country (country_id, name, code) VALUES (901, 'SC India', 'SCI'), (902, 'SC Oman', 'SCO') ON CONFLICT DO NOTHING`);
    await db.query(`UPDATE site SET country_id = 901 WHERE site_id = 1`);
    await db.query(`UPDATE site SET country_id = 902 WHERE site_id = 3`);
    const cols = await db.query(`INSERT INTO column_entity (column_name, column_type) VALUES ('SC Fuel type', 'select'), ('SC Litres', 'number') RETURNING pk_id`);
    const cfg = await db.query(
      `INSERT INTO column_config (config_name, site_id, category_id, column_options, column_dependencies, dependent_options, emission_category_mapping, extra_fields, calculation)
       VALUES ('SC Diesel form', 1, 1, $1, '{}', '{}', $2, '[]', NULL) RETURNING pk_id`,
      [JSON.stringify({ [cols.rows[0].pk_id]: [{ id: "d", label: "Diesel" }] }), JSON.stringify({ d: "Diesel" })],
    );
    configId = cfg.rows[0].pk_id;
    for (const c of cols.rows) await db.query(`INSERT INTO column_config_columns (column_config_id, column_id) VALUES ($1, $2)`, [configId, c.pk_id]);
    // The form's saved field order (quantity first), not the ids' order: the bundle and the copy keep it.
    await db.query(`UPDATE column_config SET column_order = $2 WHERE pk_id = $1`, [configId, [cols.rows[1].pk_id, cols.rows[0].pk_id]]);
    await db.query(`INSERT INTO unit (unit_name, description, site_id, category_id) VALUES ('SC litre', 'Litres', 1, 1)`);
    const ef = await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
         (1, 1, 2024, 2.68, 'litre', 'SC', 'Diesel', 'Diesel'),
         (1, 1, 2025, 2.70, 'litre', 'SC', 'Diesel', 'Diesel'),
         (2, 2, 2025, 0.71, 'kWh', 'SC', 'Grid', 'Grid') RETURNING emission_factor_id`,
    );
    factorIds = ef.rows.map((r) => r.emission_factor_id);
    await db.query(`INSERT INTO product (name, unit, site_id) VALUES ('SC billet', 'tonnes', 1)`);
    await db.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name) VALUES
         (1, 'CI Steel Co', 1, 1, 'HSD', 'Diesel'), (1, 'CI Steel Co', NULL, 2, 'Grid power', 'Grid')`,
    );
    await db.query(`INSERT INTO emission_threshold (company_id, threshold_percentage) VALUES (1, 3.5) ON CONFLICT DO NOTHING`);
    await db.query(
      `INSERT INTO material_factor (company_id, name, material_group, unit, value_kgco2e, licence) VALUES
         (1, 'SC copper', 'copper', 'kg', '4.1', 'open'), (1, 'SC secret', 'copper', 'kg', '9.9', 'ecoinvent')`,
    );
  }),
);

test.after(() =>
  withDb(async (db) => {
    // Everything the copy created at company 2 and the fixture rows above.
    const made = await db.query(`SELECT site_id FROM site WHERE company_id = 2 AND site_id <> 3`);
    const newSites = made.rows.map((r) => r.site_id);
    const sites = [1, 3, ...newSites];
    await db.query(`DELETE FROM column_config WHERE config_name LIKE 'SC %' AND site_id = ANY($1)`, [sites]);
    await db.query(`DELETE FROM column_entity WHERE column_name LIKE 'SC %'`);
    await db.query(`DELETE FROM unit WHERE unit_name LIKE 'SC %'`);
    await db.query(`DELETE FROM emission_factors WHERE source = 'SC'`);
    await db.query(`DELETE FROM product WHERE name LIKE 'SC %' OR site_id = ANY($1)`, [[3, ...newSites]]);
    await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name IN ('HSD', 'Grid power')`);
    await db.query(`DELETE FROM emission_threshold WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM material_factor WHERE name LIKE 'SC %' OR company_id = 2`);
    await db.query(`DELETE FROM site_categories WHERE site_id = ANY($1) AND NOT (site_id = 3 AND category_id = 1)`, [[3, ...newSites]]);
    if (newSites.length) await db.query(`DELETE FROM site WHERE site_id = ANY($1)`, [newSites]);
    await db.query(`UPDATE site SET country_id = NULL WHERE site_id IN (1, 3)`);
    await db.query(`DELETE FROM country WHERE country_id IN (901, 902)`);
  }),
);

const count = (db, sql, params = []) => db.query(sql, params).then((r) => Number(r.rows[0].n));

test("the bundle carries setup by name and leaves history, people and licensed factors out", async () => {
  const res = await call("GET", `/admin/companies/${SRC}/setup-bundle`, "superadmin");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="esglite-setup-ci-steel-co-\d{4}-\d{2}-\d{2}\.json"/);
  const b = res.json;
  assert.equal(b.version, 1);
  assert.equal(b.source.company_id, SRC);
  assert.deepEqual(b.sites.map((s) => s.key), ["CI Plant A", "CI Plant B"]);
  const a = b.sites[0];
  assert.equal(a.country_name, "SC India");
  assert.ok(a.categories.includes("Stationary Combustion"));
  const form = a.forms.find((f) => f.config_name === "SC Diesel form");
  assert.equal(form.category_name, "Stationary Combustion");
  assert.deepEqual(form.columns, [{ column_name: "SC Litres", column_type: "number" }, { column_name: "SC Fuel type", column_type: "select" }]);
  assert.deepEqual(form.emission_category_mapping, { d: "Diesel" });
  assert.deepEqual(form.column_options, { "SC Fuel type": [{ id: "d", label: "Diesel" }] }); // keyed by column name, not pk_id
  assert.deepEqual(a.units, [{ category_name: "Stationary Combustion", unit_name: "SC litre", description: "Litres" }]);
  assert.deepEqual(a.factors.map((f) => f.year).sort(), [2024, 2025]);
  assert.ok(a.products.some((p) => p.name === "SC billet" && p.unit === "tonnes"));
  assert.deepEqual(b.mappings.map((m) => [m.site_key, m.company_category_name]), [["CI Plant A", "HSD"], [null, "Grid power"]]);
  assert.equal(b.threshold.threshold_percentage, 3.5);
  // Other tests leave company 1 material factors behind; the licensed one must never appear.
  assert.ok(b.material_factors.some((f) => f.name === "SC copper"));
  assert.ok(!b.material_factors.some((f) => f.name === "SC secret" || f.licence === "ecoinvent"));
  const text = JSON.stringify(b);
  for (const never of ["email", "password", "activity_data", "total_emission", "site_id", "company_id\":1,\"name"]) assert.ok(!text.includes(never), `bundle must not carry ${never}`);

  assert.equal((await call("GET", `/admin/companies/${SRC}/setup-bundle`, "admin")).status, 403);
  assert.equal((await call("GET", `/admin/companies/999/setup-bundle`, "superadmin")).status, 404);
});

test("a preview with no target plans every site as new and writes nothing", async () => {
  const before = await withDb((db) => count(db, `SELECT count(*) AS n FROM site`));
  const res = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { company_id: SRC } });
  assert.equal(res.status, 200);
  const r = res.json;
  assert.equal(r.target.company_id, null);
  assert.deepEqual(r.sites.map((s) => s.target.kind), ["create", "create"]);
  assert.deepEqual(r.sites[0].available_factor_years, [2025, 2024]);
  assert.equal(r.sites[0].counts.forms.create, 1);
  assert.equal(r.sites[0].counts.factors.create, 2);
  assert.ok(r.sites[0].counts.products.create >= 1); // other tests leave products at site 1
  assert.equal(r.mappings.create, 2);
  assert.equal(r.threshold, "create");
  assert.equal(r.material_factors.create, 0); // off by default
  assert.deepEqual(r.errors, []);
  assert.equal(await withDb((db) => count(db, `SELECT count(*) AS n FROM site`)), before);
  assert.equal((await call("POST", "/admin/setup-copy/preview", "admin", { source: { company_id: SRC } })).status, 403);
});

test("copy onto a client: the main site is reused, a site is skipped, one factor year, nothing overwritten, idempotent", async () => {
  const body = {
    source: { company_id: SRC },
    options: {
      sites: [
        { key: "CI Plant A", target: "main" },
        { key: "CI Plant B", target: "skip" },
      ],
      factor_years: [2025],
      include: { material_factors: true },
    },
  };
  const preview = await call("POST", "/admin/setup-copy/preview", "superadmin", { ...body, target_company_id: DST });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.sites[0].target.kind, "reuse");
  assert.equal(preview.json.sites[0].target.site_id, 3);
  assert.equal(preview.json.sites[1].target.kind, "skip");
  assert.match(preview.json.sites[0].warnings.join(" "), /SC India.*SC Oman/);
  assert.equal(await withDb((db) => count(db, `SELECT count(*) AS n FROM column_config WHERE site_id = 3`)), 0);
  // The onboarding shortcut: no site list, the first site fills the target's only site.
  const shortcut = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { company_id: SRC }, target_company_id: DST, options: { first_site: "main" } });
  assert.equal(shortcut.status, 200);
  assert.deepEqual(shortcut.json.sites.map((s) => s.target.kind), ["reuse", "create"]);

  const res = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", body);
  assert.equal(res.status, 200);
  const r = res.json;
  assert.equal(r.target.company_name, "CI Other Co");
  const a = r.sites[0];
  assert.equal(a.counts.categories.skip, 1); // Stationary Combustion was already on site 3
  assert.ok(a.counts.categories.create >= 2);
  assert.equal(a.counts.forms.create, 1);
  assert.equal(a.counts.units.create, 1);
  assert.equal(a.counts.factors.create, 1);
  assert.ok(a.counts.products.create >= 1);
  assert.equal(r.mappings.create, 2);
  assert.equal(r.threshold, "create");
  assert.ok(r.material_factors.create >= 1);
  assert.equal(r.material_factors.licensed_excluded, 0);
  assert.deepEqual(r.columns_created, []); // library columns matched by name
  assert.equal(r.sites[1].target.kind, "skip");

  await withDb(async (db) => {
    const cfg = await db.query(`SELECT pk_id, column_options, emission_category_mapping, column_order FROM column_config WHERE site_id = 3 AND config_name = 'SC Diesel form'`);
    assert.equal(cfg.rows.length, 1);
    const ids = await db.query(`SELECT pk_id, column_name FROM column_entity WHERE column_name IN ('SC Fuel type', 'SC Litres')`);
    const idOf = Object.fromEntries(ids.rows.map((r) => [r.column_name, r.pk_id]));
    assert.deepEqual(cfg.rows[0].column_order, [idOf["SC Litres"], idOf["SC Fuel type"]]); // the source form's field order
    assert.deepEqual(cfg.rows[0].emission_category_mapping, { d: "Diesel" });
    assert.equal(await count(db, `SELECT count(*) AS n FROM column_config_columns WHERE column_config_id = $1`, [cfg.rows[0].pk_id]), 2);
    const fuel = await db.query(`SELECT pk_id FROM column_entity WHERE column_name = 'SC Fuel type' AND column_type = 'select' ORDER BY pk_id LIMIT 1`);
    assert.deepEqual(cfg.rows[0].column_options, { [fuel.rows[0].pk_id]: [{ id: "d", label: "Diesel" }] }); // keyed by the target column id
    assert.equal(await count(db, `SELECT count(*) AS n FROM emission_factors WHERE site_id = 3 AND year = 2024`), 0);
    const ef = await db.query(`SELECT emission_factor_id FROM emission_factors WHERE site_id = 3 AND year = 2025 AND emission_category_name = 'Diesel'`);
    assert.equal(ef.rows.length, 1);
    const maps = await db.query(`SELECT company_name, site_id, emission_factor_id, created_by FROM emission_category_mapping WHERE company_id = 2 ORDER BY id`);
    assert.deepEqual(
      maps.rows.map((m) => [m.company_name, m.site_id, m.created_by]),
      [["CI Other Co", 3, 5], ["CI Other Co", null, 5]],
    );
    assert.equal(maps.rows[0].emission_factor_id, ef.rows[0].emission_factor_id); // re-resolved at the target, not copied
    assert.equal(await count(db, `SELECT count(*) AS n FROM site WHERE company_id = 2`), 1); // Plant B skipped, nothing created
    assert.equal(await count(db, `SELECT count(*) AS n FROM material_factor WHERE company_id = 2 AND name = 'SC copper'`), 1);
    assert.equal(await count(db, `SELECT count(*) AS n FROM "user" WHERE site_id = 3`), 1); // people untouched
  });

  // Running the same copy again creates nothing.
  const again = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", body);
  assert.equal(again.status, 200);
  assert.equal(again.json.totals.create, 0);
  assert.deepEqual(again.json.sites[0].skipped.forms, ["SC Diesel form"]);
  assert.equal(again.json.threshold, "keep");

  // A clashing form can be added under a new name instead.
  const renamed = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", {
    ...body,
    options: { ...body.options, form_conflict: "rename", include: { factors: false, units: false, products: false, mappings: false, threshold: false } },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.sites[0].counts.forms.create, 1);
  assert.match(renamed.json.sites[0].warnings.join(" "), /added as "SC Diesel form \(copy\)"/);
  assert.match(renamed.json.warnings.join(" "), /without their factors/);

  assert.equal((await call("POST", `/admin/companies/${DST}/setup-copy`, "admin", body)).status, 403);
  assert.equal((await call("POST", `/admin/companies/${DST}/setup-copy`, "otherManager", body)).status, 403);
});

test("a second site copied as new gets the source's country and categories", async () => {
  const res = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", {
    source: { company_id: SRC },
    options: { sites: [{ key: "CI Plant A", target: "skip" }, { key: "CI Plant B", target: "create" }], include: { mappings: false, threshold: false } },
  });
  assert.equal(res.status, 200);
  const b = res.json.sites[1];
  assert.equal(b.target.kind, "create");
  assert.equal(b.target.site_name, "CI Plant B");
  assert.equal(b.counts.factors.create, 1);
  await withDb(async (db) => {
    const site = await db.query(`SELECT company_id, country_id FROM site WHERE site_id = $1`, [b.target.site_id]);
    assert.deepEqual(site.rows[0], { company_id: 2, country_id: null }); // site 2 has no country in the fixture
    assert.equal(await count(db, `SELECT count(*) AS n FROM site_categories WHERE site_id = $1`, [b.target.site_id]), 2);
  });
});

test("an uploaded file is applied by its names; unknown names and malformed files are refused before anything is written", async () => {
  const bundle = (await call("GET", `/admin/companies/${SRC}/setup-bundle`, "superadmin")).json;
  const ok = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { bundle }, target_company_id: DST });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.source.company_id, null);
  assert.equal(ok.json.source.company_name, "CI Steel Co");

  // A column renamed in the file is a new library column at the target; its dropdown options must follow the new id.
  const renamed = JSON.parse(JSON.stringify(bundle));
  const rform = renamed.sites[0].forms.find((f) => f.config_name === "SC Diesel form");
  rform.config_name = "SC Renamed form";
  rform.columns[0].column_name = "SC Fuel kind";
  rform.column_options = { "SC Fuel kind": [{ id: "d", label: "Diesel" }], "SC Gone": [{ id: "x", label: "Nothing" }] };
  const applied = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", {
    source: { bundle: renamed },
    options: { sites: [{ key: "CI Plant A", target: 3 }, { key: "CI Plant B", target: "skip" }], include: { forms: true, units: false, factors: false, mappings: false, threshold: false, products: false } },
  });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.json.columns_created, ["SC Fuel kind"]);
  assert.ok(applied.json.sites[0].warnings.some((w) => /SC Gone/.test(w)));
  await withDb(async (db) => {
    const col = await db.query(`SELECT pk_id FROM column_entity WHERE column_name = 'SC Fuel kind'`);
    const cfg = await db.query(`SELECT column_options FROM column_config WHERE site_id = 3 AND config_name = 'SC Renamed form'`);
    assert.deepEqual(cfg.rows[0].column_options, { [col.rows[0].pk_id]: [{ id: "d", label: "Diesel" }] });
  });

  const unknown = JSON.parse(JSON.stringify(bundle));
  unknown.sites[0].forms[0].category_name = "No Such Category";
  const bad = await call("POST", `/admin/companies/${DST}/setup-copy`, "superadmin", { source: { bundle: unknown } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.report.errors[0], /No Such Category/);

  const malformed = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { bundle: { version: 2, sites: "x" } } });
  assert.equal(malformed.status, 400);
  assert.ok(malformed.json.problems.length >= 2);

  const self = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { company_id: SRC }, target_company_id: SRC });
  assert.equal(self.status, 200);
  assert.match(self.json.errors[0], /onto itself/);

  const noSite = await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { company_id: SRC }, target_company_id: DST, options: { sites: [{ key: "CI Plant A", target: 1 }] } });
  assert.equal(noSite.status, 200);
  assert.match(noSite.json.errors[0], /does not belong/);
  assert.equal((await call("POST", "/admin/setup-copy/preview", "superadmin", { source: {} })).status, 400);
  assert.equal((await call("POST", "/admin/setup-copy/preview", "superadmin", { source: { company_id: SRC }, target_company_id: 999 })).status, 404);
});
