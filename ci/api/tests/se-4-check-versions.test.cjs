// SE-4 · Form check and versions (ESG-lite_FE docs/simple-entry, SE-4 spec): a
// Superadmin checks a form (saved or unsaved), publishing refuses one with
// errors and records each version, rows carry the version they were
// calculated with, and a contributor's row with no factor tells the
// Superadmins once per site × category × month. Nobody else reaches any of it.
//
// Adds one Scope 3 category on company 1's site 1 and removes everything it
// created, so other tests' counts don't move.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const SITE = 1; // company 1, the `user` fixture's site
const CAT = 170;
const COLS = { record_type: 9971, Vehicle: 9972, Distance: 9973, Litres: 9974 };
const FACTORS = [9970, 9975];
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const created = [];
let formId;

const formBody = (over = {}) => ({
  config_name: "SE-4 freight",
  site_id: SITE,
  category_id: CAT,
  column_ids: Object.values(COLS),
  column_options: {
    [COLS.record_type]: [
      { id: "fuel_bill", label: "Fuel bill" },
      { id: "trip", label: "Trip distance" },
    ],
    [COLS.Vehicle]: [{ id: "hgv", label: "HGV" }],
  },
  emission_category_mapping: { "fuel_bill|hgv": "SE-4 Diesel used", "trip|hgv": "SE-4 HGV" },
  calculation: { mode: "per_method", method_column: "record_type", methods: { fuel_bill: { multiply: ["Litres"] }, trip: { multiply: ["Distance"] } } },
  method_options: [
    { method: "fuel_based", units: ["litre"] },
    { method: "distance_based", units: ["km"] },
  ],
  method_by_choice: { column: "record_type", map: { fuel_bill: "fuel_based", trip: "distance_based" } },
  ...over,
});
const versionOf = async () => (await q(`SELECT version FROM column_config WHERE pk_id = $1`, [formId]))[0].version;
const versionRows = () => q(`SELECT version, note, published_by FROM column_config_version WHERE column_config_id = $1 ORDER BY version`, [formId]);
const needsFactor = () => q(`SELECT user_id, title, message, link, meta FROM notification WHERE type = 'form_needs_factor' AND (meta->>'category_id')::int = $1 ORDER BY id`, [CAT]);
/** The notification is sent after the response; give it a moment. */
const settle = async (want) => {
  for (let i = 0; i < 40; i++) {
    const rows = await needsFactor();
    if (rows.length >= want) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return needsFactor();
};
const typed = (activity_data, unit, over = {}) =>
  call("POST", "/user/emissions", "user", { site_id: SITE, category_id: CAT, date_of_reporting: "2026-07-31", reporting_period: "monthly", activity_data_unit: unit, activity_data, extra_data: {}, ...over });

test.before(async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${CAT}, 'SE-4 freight', 'Scope 3')`);
  const hasGhg = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`);
  if (hasGhg.length) await q(`UPDATE category SET ghg_category = 4 WHERE category_id = ${CAT}`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${CAT})`);
  await q(
    `INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (${COLS.record_type}, 'record_type', 'select'), (${COLS.Vehicle}, 'Vehicle', 'select'),
       (${COLS.Distance}, 'Distance', 'number'), (${COLS.Litres}, 'Litres', 'number')`,
  );
  // Only the diesel factor at first: the trip path has none.
  await q(
    `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
       (9970, ${SITE}, ${CAT}, 2025, 3.0, 'litre', 'CI', 'SE-4 Diesel used', 'SE-4 Diesel used', 'life_cycle')`,
  );
});

test.after(async () => {
  if (created.length) {
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [created]);
  }
  await q(`DELETE FROM emission WHERE category_id = ${CAT} OR fera_linked_id = ANY($1::int[])`, [created]);
  const configs = (await q(`SELECT pk_id FROM column_config WHERE category_id = ${CAT}`)).map((r) => r.pk_id);
  if (configs.length) {
    await q(`DELETE FROM column_config_version WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [configs]);
  }
  await q(`DELETE FROM notification WHERE type = 'form_needs_factor' AND (meta->>'category_id')::int = ${CAT}`);
  await q(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [Object.values(COLS)]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1::int[])`, [FACTORS]);
  await q(`DELETE FROM site_categories WHERE category_id = ${CAT}`);
  await q(`DELETE FROM category WHERE category_id = ${CAT}`);
});

test("migrate:form-versions: the version table and emission.form_version are there (CI runs every migration twice)", async () => {
  const cols = await q(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns
      WHERE (table_name = 'column_config_version') OR (table_name = 'emission' AND column_name = 'form_version') ORDER BY 1, 2`,
  );
  const names = cols.map((c) => `${c.table_name}.${c.column_name}`);
  for (const c of ["column_config_id", "version", "config", "note", "published_by", "published_at"]) assert.ok(names.includes(`column_config_version.${c}`), c);
  assert.equal(cols.find((c) => c.column_name === "form_version").is_nullable, "YES", "rows from before SE-4 keep null");
  const [idx] = await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_column_config_version_config_version'`);
  assert.match(idx.indexdef, /UNIQUE INDEX .* \(column_config_id, version\)/);
});

test("the check finds the trip path's missing factor, by field; saving still works; nobody else may check", async () => {
  const create = await call("POST", "/admin/column-configs", "superadmin", formBody());
  assert.equal(create.status, 201, "saving a form with a problem works, as today");
  formId = create.json.columnConfig.pk_id;

  const check = await call("GET", `/admin/column-configs/${formId}/check?year=2025`, "superadmin");
  assert.equal(check.status, 200, JSON.stringify(check.json));
  assert.equal(check.json.ok, false);
  assert.deepEqual(
    check.json.errors.map((e) => [e.code, e.field]),
    [["NO_FACTOR_FOR_YEAR", "emission_category_mapping.trip|hgv"]],
  );
  assert.match(check.json.errors[0].message, /trip › hgv points to "SE-4 HGV", which has no emission factor/);
  assert.equal(check.json.version, 1);
  assert.equal(check.json.year, 2025);

  for (const who of ["admin", "manager", "user", "otherManager", "otherUser"]) {
    assert.equal((await call("GET", `/admin/column-configs/${formId}/check`, who)).status, 403, `${who} may not check a form`);
    assert.equal((await call("POST", `/admin/column-configs/${formId}/publish`, who, {})).status, 403, `${who} may not publish`);
    assert.equal((await call("GET", `/admin/column-configs/${formId}/versions`, who)).status, 403, `${who} may not read versions`);
    assert.equal((await call("GET", `/admin/column-configs/checks`, who)).status, 403, `${who} may not list checks`);
    assert.equal((await call("POST", `/admin/column-configs/check`, who, formBody())).status, 403, `${who} may not check a draft`);
  }
  assert.equal((await call("GET", `/admin/column-configs/${formId}/check?year=nineteen`, "superadmin")).status, 400);
  assert.equal((await call("GET", `/admin/column-configs/999999/check`, "superadmin")).status, 404);
});

test("publishing refuses a form with errors (409 FORM_CHECK_FAILED) and writes no version", async () => {
  const r = await call("POST", `/admin/column-configs/${formId}/publish?year=2025`, "superadmin", { note: "first go" });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "FORM_CHECK_FAILED");
  assert.equal(r.json.message, "Fix 1 thing before publishing this form.");
  assert.equal(r.json.check.errors[0].code, "NO_FACTOR_FOR_YEAR");
  assert.deepEqual(await versionRows(), []);
  assert.equal(await versionOf(), 1);
});

test("an unsaved form is checked as it would be saved: the body over the saved form, renames and all", async () => {
  const fixed = await call("POST", "/admin/column-configs/check?year=2025", "superadmin", { pk_id: formId, emission_category_mapping: { "fuel_bill|hgv": "SE-4 Diesel used", "trip|hgv": "SE-4 Diesel used" } });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  assert.equal(fixed.json.ok, true);
  assert.equal(fixed.json.form_id, formId);

  const renamed = await call("POST", "/admin/column-configs/check?year=2025", "superadmin", { pk_id: formId, rename_map: { Litres: "Litres used" } });
  assert.deepEqual(
    renamed.json.errors.map((e) => e.code),
    ["NO_FACTOR_FOR_YEAR", "FIELD_MISSING"],
    "the formula still says Litres, which the rename takes away",
  );
  const fresh = await call("POST", "/admin/column-configs/check?year=2025", "superadmin", formBody({ method_by_choice: { column: "record_type", map: { fuel_bill: "fuel_based" } } }));
  assert.equal(fresh.status, 200);
  assert.equal(fresh.json.form_id, null, "a new form");
  assert.deepEqual(fresh.json.errors.map((e) => e.code).sort(), ["METHOD_UNMAPPED", "NO_FACTOR_FOR_YEAR"]);
  assert.equal((await call("POST", "/admin/column-configs/check", "superadmin", { config_name: "x" })).status, 400, "a new form names its site and category");
  assert.equal((await call("POST", "/admin/column-configs/check", "superadmin", { pk_id: 999999 })).status, 404);
  assert.equal((await call("POST", "/admin/column-configs/check", "superadmin", { pk_id: formId, column_ids: [999998] })).status, 400);
});

test("the forms list's check counts each form's errors", async () => {
  const r = await call("GET", `/admin/column-configs/checks?year=2025&site_id=${SITE}&category_id=${CAT}`, "superadmin");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.forms, [{ form_id: formId, site_id: SITE, category_id: CAT, version: 1, errors: 1, warnings: 0, first_error: r.json.forms[0].first_error }]);
  assert.match(r.json.forms[0].first_error, /SE-4 HGV/);
  assert.equal((await call("GET", `/admin/column-configs/checks?site_id=abc`, "superadmin")).status, 400);
});

test("once the factor is there it publishes: the history starts at version 1, each later publish adds one", async () => {
  await q(
    `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
       (9975, ${SITE}, ${CAT}, 2025, 1.0, 'km', 'CI', 'SE-4 HGV', 'SE-4 HGV', 'life_cycle')`,
  );
  const first = await call("POST", `/admin/column-configs/${formId}/publish?year=2025`, "superadmin", { note: "  First published  " });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.version.version, 1);
  assert.equal(first.json.message, "Form version 1 published.");
  assert.equal(await versionOf(), 1);

  const again = await call("POST", `/admin/column-configs/${formId}/publish?year=2025`, "superadmin", { note: "Nothing new" });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.deepEqual([again.json.unchanged, again.json.version.version, again.json.message], [true, 1, "Nothing changed since version 1, which stays live."]);
  assert.equal(await versionOf(), 1, "an unchanged form adds no version");

  const put = await call("PUT", `/admin/column-configs/${formId}`, "superadmin", { field_settings: { Vehicle: { hidden: true, default: "hgv" } } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const second = await call("POST", `/admin/column-configs/${formId}/publish?year=2025`, "superadmin", { note: "Vehicle hidden" });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.version.version, 2);
  assert.equal(await versionOf(), 2);
  assert.deepEqual(await versionRows(), [
    { version: 1, note: "First published", published_by: 5 },
    { version: 2, note: "Vehicle hidden", published_by: 5 },
  ]);

  const list = await call("GET", `/admin/column-configs/${formId}/versions`, "superadmin");
  assert.equal(list.status, 200);
  assert.equal(list.json.version, 2);
  assert.deepEqual(list.json.versions.map((v) => [v.version, v.note, v.published_by?.name]), [
    [2, "Vehicle hidden", "CI Superadmin"],
    [1, "First published", "CI Superadmin"],
  ]);
  assert.deepEqual(list.json.versions[0].config.field_settings, { Vehicle: { hidden: true, default: "hgv" } });
  assert.deepEqual(list.json.versions[1].config.field_settings, {}, "version 1 as it went live");
  assert.deepEqual(list.json.versions[0].config.columns.map((c) => c.column_name), ["record_type", "Vehicle", "Distance", "Litres"]);
  assert.equal("pk_id" in list.json.versions[0].config, false, "the form's own id isn't in the snapshot");

  // Warnings publish: 2026 has no factors, so both paths fall back to 2025.
  await call("PUT", `/admin/column-configs/${formId}`, "superadmin", { config_name: "SE-4 freight (v3)" });
  const warned = await call("POST", `/admin/column-configs/${formId}/publish?year=2026`, "superadmin", {});
  assert.equal(warned.status, 200, JSON.stringify(warned.json));
  assert.deepEqual(warned.json.check.warnings.map((w) => w.code), ["FACTOR_FALLBACK_YEAR", "FACTOR_FALLBACK_YEAR"]);
  assert.equal(warned.json.version.version, 3);
  assert.equal((await call("POST", `/admin/column-configs/${formId}/publish`, "superadmin", { note: 5 })).status, 400);
});

test("a row records the form version it was calculated with, and an edit the version it now follows", async () => {
  const r = await typed({ record_type: "trip", Vehicle: "hgv", Distance: 40, emission_category: "SE-4 HGV" }, "km");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.emission.pk_id;
  created.push(id);
  const [row] = await q(`SELECT form_version, total_emission::float8 AS total FROM emission WHERE pk_id = $1`, [id]);
  assert.deepEqual(row, { form_version: 3, total: 0.04 });

  await call("PUT", `/admin/column-configs/${formId}`, "superadmin", { config_name: "SE-4 freight (v4)" });
  assert.equal((await call("POST", `/admin/column-configs/${formId}/publish?year=2025`, "superadmin", {})).json.version.version, 4);
  const edit = await call("PUT", `/user/emissions/${id}`, "user", { activity_data: { record_type: "trip", Vehicle: "hgv", Distance: 50, emission_category: "SE-4 HGV" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.deepEqual((await q(`SELECT form_version FROM emission WHERE pk_id = $1`, [id]))[0], { form_version: 4 });
});

test("a contributor's row with no factor tells every Superadmin, once per site × category × month", async () => {
  const [{ n: admins }] = await q(`SELECT count(*)::int AS n FROM "user" WHERE role = 'Superadmin'`);
  const bad = { record_type: "trip", Vehicle: "hgv", Distance: 10, emission_category: "SE-4 Ferry" };
  const r = await typed(bad, "km");
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "NO_FACTOR_FOR_YEAR");
  const once = await settle(admins);
  assert.equal(once.length, admins);
  assert.equal(once[0].title, "A form needs an emission factor");
  assert.match(once[0].message, /SE-4 freight: a contributor's Jul 2026 row asks for "SE-4 Ferry", which has no emission factor on this site/);
  assert.equal(once[0].link, `/capture/forms/${formId}?tab=check`);
  assert.equal(once[0].meta.needs_factor_key, `${SITE}:${CAT}:2026-07`);

  // The same month again, by save or by the live check: nothing new.
  assert.equal((await typed(bad, "km")).status, 400);
  const live = await call("POST", "/user/emissions/check", "user", { rows: [{ ref: "r1", site_id: SITE, category_id: CAT, activity_data: bad, activity_data_unit: "km", date_of_reporting: "2026-07-15" }] });
  assert.equal(live.status, 200, JSON.stringify(live.json));
  assert.equal(live.json.results[0].issue.code, "NO_FACTOR_FOR_YEAR");
  await new Promise((res) => setTimeout(res, 300));
  assert.equal((await needsFactor()).length, admins);

  // Another month, from the live check: one more each.
  await call("POST", "/user/emissions/check", "user", { rows: [{ ref: "r2", site_id: SITE, category_id: CAT, activity_data: bad, activity_data_unit: "km", date_of_reporting: "2026-08-15" }] });
  const twice = await settle(admins * 2);
  assert.equal(twice.length, admins * 2);
  assert.equal(twice[twice.length - 1].meta.month, "2026-08");

  // A Superadmin's own row with no factor tells nobody (they can fix it).
  await call("POST", "/user/emissions", "superadmin", { site_id: SITE, category_id: CAT, date_of_reporting: "2026-09-30", reporting_period: "monthly", activity_data_unit: "km", activity_data: bad, extra_data: {} });
  await new Promise((res) => setTimeout(res, 300));
  assert.equal((await needsFactor()).length, admins * 2);
});
