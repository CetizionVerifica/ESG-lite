// SE-6 · Form templates and copy (ESG-lite_FE docs/simple-entry, SE-6 spec): a Superadmin saves a
// form as a template (for its client, or every client), lists, renames and deletes it, and applies a
// template or a form to many sites: each target shows the SE-4 check first, the ones that pass are
// written and published as a new version, the others are refused with their check (never skipped),
// and a client's template or form never reaches another client's sites. Global templates seed a
// client's sites that have no form. Nobody else reaches any of it.
//
// Adds one category on sites 1, 2, 3 and a fourth site of company 1, and removes everything it made.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const CAT = 180;
const NEW_SITE = 9101; // company 1, no factors: its check fails
const COLS = { fuel: 9991, litres: 9992 };
const FACTORS = [9990, 9993, 9994, 9995, 9996];
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
let sourceForm;
let clientTemplate;
let globalTemplate;

const formsAt = (site) => q(`SELECT pk_id, config_name, version, emission_category_mapping FROM column_config WHERE site_id = $1 AND category_id = $2`, [site, CAT]);

test.before(async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${CAT}, 'SE-6 fuel', 'Scope 1')`);
  await q(`INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES (${NEW_SITE}, 'CI Plant C', 'Plot 9', 'CI', 1)`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (1, ${CAT}), (2, ${CAT}), (3, ${CAT}), (${NEW_SITE}, ${CAT})`);
  await q(`INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (${COLS.fuel}, 'SE-6 Fuel', 'select'), (${COLS.litres}, 'SE-6 Litres', 'number')`);
  await q(
    `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
       (9990, 1, ${CAT}, 2025, 2.6, 'litre', 'CI', 'SE-6 Diesel', 'SE-6 Diesel'), (9993, 1, ${CAT}, 2025, 2.1, 'litre', 'CI', 'SE-6 Petrol', 'SE-6 Petrol'),
       (9994, 2, ${CAT}, 2025, 2.6, 'litre', 'CI', 'SE-6 Diesel', 'SE-6 Diesel'), (9995, 2, ${CAT}, 2025, 2.1, 'litre', 'CI', 'SE-6 Petrol', 'SE-6 Petrol'),
       (9996, 3, ${CAT}, 2025, 2.6, 'litre', 'CI', 'SE-6 Diesel', 'SE-6 Diesel')`,
  );
  await q(`INSERT INTO unit (unit_name, site_id, category_id) VALUES ('litre', 1, ${CAT})`);
  const r = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "SE-6 fuel use",
    site_id: 1,
    category_id: CAT,
    column_ids: [COLS.fuel, COLS.litres],
    column_options: { [COLS.fuel]: [{ id: "diesel", label: "Diesel" }, { id: "petrol", label: "Petrol" }] },
    emission_category_mapping: { diesel: "SE-6 Diesel", petrol: "SE-6 Petrol" },
    field_settings: { "SE-6 Litres": { label: "Litres on the bill" } },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  sourceForm = r.json.columnConfig.pk_id;
});

test.after(async () => {
  const forms = (await q(`SELECT pk_id FROM column_config WHERE category_id = ${CAT}`)).map((r) => r.pk_id);
  if (forms.length) {
    await q(`DELETE FROM column_config_version WHERE column_config_id = ANY($1::int[])`, [forms]);
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [forms]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [forms]);
  }
  await q(`DELETE FROM form_template WHERE category_id = ${CAT}`);
  await q(`DELETE FROM unit WHERE category_id = ${CAT}`);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1::int[])`, [FACTORS]);
  await q(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [Object.values(COLS)]);
  await q(`DELETE FROM site_categories WHERE category_id = ${CAT}`);
  await q(`DELETE FROM site WHERE site_id = ${NEW_SITE}`);
  await q(`DELETE FROM category WHERE category_id = ${CAT}`);
});

test("migrate:form-templates: the table is there (CI runs every migration twice)", async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'form_template' ORDER BY 1`)).map((c) => c.column_name);
  assert.deepEqual(cols, ["category_id", "category_name", "company_id", "config", "created_at", "created_by", "id", "name"]);
});

test("only a Superadmin reaches templates", async () => {
  for (const who of ["admin", "manager", "user", "otherManager", "otherUser"]) {
    assert.equal((await call("GET", "/admin/form-templates", who)).status, 403, who);
    assert.equal((await call("POST", "/admin/form-templates", who, { form_id: sourceForm, name: "x" })).status, 403, who);
    assert.equal((await call("POST", "/admin/form-templates/apply/preview", who, { form_id: sourceForm, site_ids: [2] })).status, 403, who);
    assert.equal((await call("POST", "/admin/form-templates/apply", who, { form_id: sourceForm, site_ids: [2] })).status, 403, who);
    assert.equal((await call("POST", "/admin/form-templates/seed", who, { company_id: 1 })).status, 403, who);
  }
});

test("save a form as a template for its client and for every client; names are unique; rename; list by client", async () => {
  const mine = await call("POST", "/admin/form-templates", "superadmin", { form_id: sourceForm, name: "  Fuel use (CI Steel)  " });
  assert.equal(mine.status, 201, JSON.stringify(mine.json));
  clientTemplate = mine.json.template.id;
  assert.deepEqual(mine.json.template, { id: clientTemplate, name: "Fuel use (CI Steel)", company_id: 1, category_id: CAT, category_name: "SE-6 fuel" });
  const [stored] = await q(`SELECT config FROM form_template WHERE id = $1`, [clientTemplate]);
  assert.deepEqual(stored.config.emission_category_mapping, { diesel: "SE-6 Diesel", petrol: "SE-6 Petrol" });
  assert.deepEqual(stored.config.columns.map((c) => c.column_name), ["SE-6 Fuel", "SE-6 Litres"]);
  assert.deepEqual(stored.config.unit_names, ["litre"]);
  assert.equal(stored.config.units, null, "the form's own fixed-unit setting, none here");

  assert.equal((await call("POST", "/admin/form-templates", "superadmin", { form_id: sourceForm, name: "fuel use (ci steel)" })).status, 409, "the same name for the client and category");
  assert.equal((await call("POST", "/admin/form-templates", "superadmin", { form_id: sourceForm, name: " " })).status, 400);
  assert.equal((await call("POST", "/admin/form-templates", "superadmin", { form_id: 999999, name: "x" })).status, 404);
  const global = await call("POST", "/admin/form-templates", "superadmin", { form_id: sourceForm, name: "Fuel use", company_id: null });
  assert.equal(global.status, 201);
  globalTemplate = global.json.template.id;
  assert.equal(global.json.template.company_id, null);

  const renamed = await call("PUT", `/admin/form-templates/${clientTemplate}`, "superadmin", { name: "Fuel use (bills)" });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  const forClient1 = await call("GET", `/admin/form-templates?company_id=1&category_id=${CAT}`, "superadmin");
  assert.deepEqual(forClient1.json.templates.map((t) => [t.name, t.company_id, t.fields, t.created_by?.name]), [
    ["Fuel use", null, 2, "CI Superadmin"],
    ["Fuel use (bills)", 1, 2, "CI Superadmin"],
  ]);
  const forClient2 = await call("GET", `/admin/form-templates?company_id=2&category_id=${CAT}`, "superadmin");
  assert.deepEqual(forClient2.json.templates.map((t) => t.name), ["Fuel use"], "another client sees only the global template");
});

test("preview: each site's action and check; a client's template doesn't reach another client's site", async () => {
  const r = await call("POST", "/admin/form-templates/apply/preview?year=2025", "superadmin", { template_id: clientTemplate, site_ids: [2, NEW_SITE, 3] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [b, c, other] = r.json.targets;
  assert.deepEqual([b.site_name, b.action, b.check.ok, b.saved_rows], ["CI Plant B", "create", true, 0]);
  assert.deepEqual([c.site_name, c.action, c.check.ok], ["CI Plant C", "create", false]);
  assert.deepEqual(c.check.errors.map((e) => e.code), ["NO_FACTOR_FOR_YEAR", "NO_FACTOR_FOR_YEAR"], "the site has no factor for either choice");
  assert.match(other.refused, /belongs to another client/);
  assert.equal(other.action, null);
  assert.equal((await call("POST", "/admin/form-templates/apply/preview", "superadmin", { template_id: clientTemplate, site_ids: [] })).status, 400);
  assert.equal((await call("POST", "/admin/form-templates/apply/preview", "superadmin", { template_id: 999999, site_ids: [2] })).status, 404);
  assert.deepEqual(await formsAt(2), [], "a preview writes nothing");
});

test("apply: sites that pass get the form as version 1 with its units; the others are refused, not skipped", async () => {
  const r = await call("POST", "/admin/form-templates/apply?year=2025", "superadmin", { template_id: clientTemplate, site_ids: [2, NEW_SITE, 3] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.message, "Applied to 1 of 3 sites.");
  assert.deepEqual(r.json.targets.map((t) => [t.site_id, t.status]), [[2, "applied"], [NEW_SITE, "refused"], [3, "refused"]]);
  const [made] = await formsAt(2);
  assert.equal(made.config_name, "SE-6 fuel use");
  assert.equal(made.version, 1);
  assert.deepEqual(made.emission_category_mapping, { diesel: "SE-6 Diesel", petrol: "SE-6 Petrol" }, "choices and rules keep their names");
  assert.equal(r.json.targets[0].form_id, made.pk_id);
  assert.equal(r.json.targets[0].version, 1);
  const [v] = await q(`SELECT note FROM column_config_version WHERE column_config_id = $1`, [made.pk_id]);
  assert.equal(v.note, 'From template "Fuel use (bills)"');
  assert.deepEqual((await q(`SELECT unit_name FROM unit WHERE site_id = 2 AND category_id = ${CAT}`)).map((u) => u.unit_name), ["litre"]);
  assert.equal((await q(`SELECT units FROM column_config WHERE pk_id = $1`, [made.pk_id]))[0].units, null, "the site's unit list doesn't become a fixed unit");
  assert.deepEqual(await formsAt(NEW_SITE), []);
  assert.deepEqual(await formsAt(3), []);

  // A User at site 2 enters on the copied form: 100 L of diesel × 2.6.
  const row = await call("POST", "/user/emissions", "manager", { site_id: 2, category_id: CAT, date_of_reporting: "2026-08-31", reporting_period: "monthly", activity_data_unit: "litre", activity_data: { "SE-6 Fuel": "diesel", "SE-6 Litres": "100", emission_category: "SE-6 Diesel" }, extra_data: {} });
  assert.equal(row.status, 201, JSON.stringify(row.json));
  const [saved] = await q(`SELECT total_kgco2e::text AS kg, form_version FROM emission WHERE pk_id = $1`, [row.json.emission.pk_id]);
  assert.deepEqual(saved, { kg: "260.0000", form_version: 1 });
  await q(`DELETE FROM emission WHERE pk_id = $1 OR fera_linked_id = $1`, [row.json.emission.pk_id]);
});

test("a form copied again updates the site's form: its name stays, an unchanged copy adds no version, a changed one does", async () => {
  const again = await call("POST", "/admin/form-templates/apply?year=2025", "superadmin", { form_id: sourceForm, site_ids: [2] });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.deepEqual([again.json.targets[0].action, again.json.targets[0].status, again.json.targets[0].version], ["update", "applied", 1]);
  await call("PUT", `/admin/column-configs/${sourceForm}`, "superadmin", { field_settings: { "SE-6 Litres": { label: "Litres on the fuel bill" } } });
  const changed = await call("POST", "/admin/form-templates/apply?year=2025", "superadmin", { form_id: sourceForm, site_ids: [2, 1] });
  assert.deepEqual(changed.json.targets.map((t) => [t.site_id, t.status, t.version ?? null, t.refused ?? null]), [
    [2, "applied", 2, null],
    [1, "refused", null, "This is the form's own site."],
  ]);
  const [f] = await q(`SELECT config_name, field_settings FROM column_config WHERE site_id = 2 AND category_id = ${CAT}`);
  assert.deepEqual(f, { config_name: "SE-6 fuel use", field_settings: { "SE-6 Litres": { label: "Litres on the fuel bill" } } });
  // A form stays with its client too.
  const cross = await call("POST", "/admin/form-templates/apply/preview", "superadmin", { form_id: sourceForm, site_ids: [3] });
  assert.match(cross.json.targets[0].refused, /another client/);
});

test("global templates seed a client's sites that have no form; a dry run writes nothing", async () => {
  const dry = await call("POST", "/admin/form-templates/seed?year=2025", "superadmin", { company_id: 2, dry_run: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.deepEqual(dry.json.targets.map((t) => [t.site_id, t.template_name, t.action, t.check.ok]), [[3, "Fuel use", "create", false]]);
  assert.deepEqual(await formsAt(3), []);
  // Site 3 lacks the petrol factor; once it's there the seed creates the form.
  await q(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES (9997, 3, ${CAT}, 2025, 2.1, 'litre', 'CI', 'SE-6 Petrol', 'SE-6 Petrol')`);
  FACTORS.push(9997);
  const seeded = await call("POST", "/admin/form-templates/seed?year=2025", "superadmin", { company_id: 2 });
  assert.deepEqual(seeded.json.targets.map((t) => [t.site_id, t.status, t.version]), [[3, "applied", 1]]);
  assert.equal((await formsAt(3)).length, 1);
  const twice = await call("POST", "/admin/form-templates/seed?year=2025", "superadmin", { company_id: 2 });
  assert.deepEqual(twice.json.targets, [], "a site with a form is left alone");
});

test("deleting a template leaves the forms made from it", async () => {
  const del = await call("DELETE", `/admin/form-templates/${globalTemplate}`, "superadmin");
  assert.equal(del.status, 200);
  assert.equal((await call("DELETE", `/admin/form-templates/${globalTemplate}`, "superadmin")).status, 404);
  assert.equal((await formsAt(3)).length, 1);
});
