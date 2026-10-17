// SE-2 · Simple data entry form settings (src/forms/CLAUDE.md): a Superadmin
// sets what a form fixes (a choice that picks the method, hidden defaults, a
// fixed unit and currency) and the company's default currency and entry
// detail; anyone else is refused, settings that don't fit the form are refused
// by field, and the engine applies them to typed entries and bulk upload alike.
//
// Adds two Scope 3 categories on company 1's site 1 and removes everything it
// created, so other tests' counts don't move.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const SITE = 1; // company 1, the `user` fixture's site
const CAT = 160; // a transport-like category: a choice picks fuel_based or distance_based
const SPEND = 161; // a purchased-goods category priced from spend
const COLS = { record_type: 9961, Vehicle: 9962, Distance: 9963, Litres: 9964 };
const FACTORS = [9960, 9965, 9966];
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const created = [];
let formId;
let spendFormId;

const methodOptions = [
  { method: "fuel_based", units: ["litre"] },
  { method: "distance_based", units: ["km"] },
];
const choice = { column: "record_type", map: { fuel_bill: "fuel_based", trip: "distance_based" } };
const formBody = (over = {}) => ({
  config_name: "SE-2 freight",
  site_id: SITE,
  category_id: CAT,
  column_ids: Object.values(COLS),
  column_options: {
    [COLS.record_type]: [
      { id: "fuel_bill", label: "Fuel bill" },
      { id: "trip", label: "Trip distance" },
    ],
    [COLS.Vehicle]: [
      { id: "hgv", label: "HGV" },
      { id: "van", label: "Van" },
    ],
  },
  extra_fields: [{ key: "paid_by", label: "Who paid?", type: "select", required: false, options: ["We paid", "Customer or other"] }],
  method_options: methodOptions,
  ...over,
});

const typed = (who, activity_data, unit, over = {}) =>
  call("POST", "/user/emissions", who, {
    site_id: SITE,
    category_id: CAT,
    date_of_reporting: "2026-07-31",
    reporting_period: "monthly",
    activity_data_unit: unit,
    activity_data,
    extra_data: {},
    ...over,
  });
const saved = async (r) => {
  assert.equal(r.status, 201, JSON.stringify(r.json));
  created.push(r.json.emission.pk_id);
  return (await q(`SELECT method, activity_data, extra_data, activity_data_unit, total_emission::float8 AS total, fx FROM emission WHERE pk_id = $1`, [r.json.emission.pk_id]))[0];
};
const putForm = (who, body, id = formId) => call("PUT", `/admin/column-configs/${id}`, who, body);

test.before(async () => {
  await q(`INSERT INTO category (category_id, category_name, scope) VALUES (${CAT}, 'SE-2 freight', 'Scope 3'), (${SPEND}, 'SE-2 purchased goods', 'Scope 3')`);
  const hasGhg = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'category' AND column_name = 'ghg_category'`);
  if (hasGhg.length) await q(`UPDATE category SET ghg_category = CASE category_id WHEN ${CAT} THEN 4 ELSE 1 END WHERE category_id IN (${CAT}, ${SPEND})`);
  await q(`INSERT INTO site_categories (site_id, category_id) VALUES (${SITE}, ${CAT}), (${SITE}, ${SPEND})`);
  await q(
    `INSERT INTO column_entity (pk_id, column_name, column_type) VALUES (${COLS.record_type}, 'record_type', 'select'), (${COLS.Vehicle}, 'Vehicle', 'select'),
       (${COLS.Distance}, 'Distance', 'number'), (${COLS.Litres}, 'Litres', 'number')`,
  );
  await q(
    `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
       (9960, ${SITE}, ${CAT}, 2025, 3.0, 'litre', 'CI', 'SE-2 Diesel used', 'SE-2 Diesel used', 'life_cycle'),
       (9965, ${SITE}, ${CAT}, 2025, 1.0, 'km', 'CI', 'SE-2 HGV', 'SE-2 HGV', 'life_cycle'),
       (9966, ${SITE}, ${SPEND}, 2025, 0.5, 'USD', 'CI', 'SE-2 Steel spend', 'SE-2 Steel spend', 'eeio_spend')`,
  );
  await q(`INSERT INTO fx_rate (currency, date, rate_to_usd, source) VALUES ('INR', '2026-07-15', 80, 'CI-SE2') ON CONFLICT DO NOTHING`);
});

test.after(async () => {
  if (created.length) {
    await q(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1::int[])`, [created]);
    await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[]) OR fera_linked_id = ANY($1::int[])`, [created]);
  }
  await q(`DELETE FROM emission WHERE category_id IN (${CAT}, ${SPEND})`);
  const configs = (await q(`SELECT pk_id FROM column_config WHERE category_id IN (${CAT}, ${SPEND})`)).map((r) => r.pk_id);
  if (configs.length) {
    await q(`DELETE FROM column_config_columns WHERE column_config_id = ANY($1::int[])`, [configs]);
    await q(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [configs]);
  }
  await q(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [Object.values(COLS)]);
  await q(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1::int[])`, [FACTORS]);
  await q(`DELETE FROM site_categories WHERE category_id IN (${CAT}, ${SPEND})`);
  await q(`DELETE FROM category WHERE category_id IN (${CAT}, ${SPEND})`);
  await q(`DELETE FROM fx_rate WHERE source = 'CI-SE2'`);
  await q(`UPDATE company SET default_currency = 'INR', entry_detail = 'total' WHERE company_id = 1`);
});

test("migrate:entry-forms columns are there with their defaults (CI runs every migration twice)", async () => {
  const cols = await q(
    `SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
      WHERE (table_name = 'column_config' AND column_name IN ('method_by_choice', 'field_settings', 'units', 'currency', 'version'))
         OR (table_name = 'company' AND column_name IN ('default_currency', 'entry_detail')) ORDER BY 1, 2`,
  );
  assert.equal(cols.length, 7);
  const by = Object.fromEntries(cols.map((c) => [`${c.table_name}.${c.column_name}`, c]));
  assert.match(by["company.default_currency"].column_default, /INR/);
  assert.match(by["company.entry_detail"].column_default, /total/);
  assert.equal(by["column_config.field_settings"].is_nullable, "NO");
  const [company] = await q(`SELECT default_currency, entry_detail FROM company WHERE company_id = 1`);
  assert.deepEqual(company, { default_currency: "INR", entry_detail: "total" }, "current clients: INR and the total only");
});

test("a Superadmin sets what the form fixes; the User's form returns it; anyone else is refused; company 2 can't read it", async () => {
  const create = await call("POST", "/admin/column-configs", "superadmin", formBody({ method_by_choice: choice, field_settings: { Vehicle: { hidden: true, default: "hgv" }, paid_by: { hidden: true, default: "We paid" } } }));
  assert.equal(create.status, 201, JSON.stringify(create.json));
  formId = create.json.columnConfig.pk_id;
  assert.deepEqual(create.json.columnConfig.method_by_choice, choice);

  const read = await call("GET", `/user/column-configs/site/${SITE}/category/${CAT}`, "user");
  assert.equal(read.status, 200, JSON.stringify(read.json));
  const form = (Array.isArray(read.json) ? read.json : read.json.data ?? [])[0];
  assert.deepEqual(form.method_by_choice, choice);
  assert.deepEqual(form.field_settings.Vehicle, { hidden: true, default: "hgv" });
  assert.equal(form.version, 1);

  for (const who of ["admin", "manager", "user", "otherManager"]) {
    assert.equal((await putForm(who, { units: { fixed: "km" } })).status, 403, `${who} may not change a form`);
  }
  assert.equal((await call("GET", `/user/column-configs/site/${SITE}/category/${CAT}`, "otherUser")).status, 403, "company 2 reads no company 1 form");
});

test("settings that don't fit the form are refused, by field, and nothing is stored", async () => {
  const before = (await q(`SELECT method_by_choice, field_settings, units, currency FROM column_config WHERE pk_id = $1`, [formId]))[0];
  const cases = [
    [{ method_by_choice: { column: "Boat", map: { a: "fuel_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.column"],
    [{ method_by_choice: { column: "record_type", map: { boat: "fuel_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.map.boat"],
    [{ method_by_choice: { column: "record_type", map: { trip: "spend_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.map.trip"],
    [{ field_settings: { Colour: { hidden: true } } }, "FORM_CHECK_FAILED", "field_settings.Colour"],
    [{ field_settings: { Vehicle: { default: "bike" } } }, "FORM_CHECK_FAILED", "field_settings.Vehicle.default"],
    [{ units: { fixed: "kWh" } }, "FORM_CHECK_FAILED", "units.fixed"],
    [{ currency: { fixed: "JPY" } }, "FORM_CHECK_FAILED", "currency.fixed"],
    [{ field_settings: { Vehicle: { colour: "red" } } }, "FIELD_INVALID", "field_settings.Vehicle"],
  ];
  for (const [body, code, field] of cases) {
    const r = await putForm("superadmin", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, code, JSON.stringify(r.json));
    assert.equal(r.json.field, field, JSON.stringify(r.json));
  }
  const after = (await q(`SELECT method_by_choice, field_settings, units, currency FROM column_config WHERE pk_id = $1`, [formId]))[0];
  assert.deepEqual(after, before);
});

test("a User's row: the choice decides the method whatever the row sends; an importer's method wins; totals as before", async () => {
  // The User sends a method of their own; the form's choice says trip, so distance_based.
  const user = await saved(await typed("user", { record_type: "trip", "@method": "fuel_based", emission_category: "SE-2 HGV", activity_value: "100" }, "km"));
  assert.equal(user.method, "distance_based");
  assert.equal(user.activity_data["@method"], "distance_based", "the User's own @method is replaced by the form's");
  assert.equal(user.total, 0.1, "100 km × 1 kg");
  // The answer as a label (a sheet) maps too.
  const label = await saved(await typed("user", { record_type: "Fuel bill", emission_category: "SE-2 Diesel used", activity_value: "10" }, "litre", { date_of_reporting: "2026-06-30" }));
  assert.equal(label.method, "fuel_based");
  assert.equal(label.total, 0.03, "10 L × 3 kg");
  // A Manager's typed entry names a method: it wins over the choice (importers may name one).
  const manager = await saved(await typed("manager", { record_type: "trip", emission_category: "SE-2 HGV", activity_value: "100" }, "km", { method: "fuel_based", date_of_reporting: "2026-05-31" }));
  assert.equal(manager.method, "fuel_based");
  assert.equal(manager.total, user.total, "the method is a label here; the total doesn't move");
  // Only field values, no choice answered: the form's default by unit, as before SE-2.
  const plain = await saved(await typed("user", { emission_category: "SE-2 HGV", activity_value: "100" }, "km", { date_of_reporting: "2026-04-30" }));
  assert.equal(plain.method, "distance_based");
  assert.equal(plain.total, 0.1);
});

test("hidden defaults are filled by the server on typed entries and bulk upload; a value the row has is kept", async () => {
  const filled = await saved(await typed("user", { record_type: "trip", emission_category: "SE-2 HGV", activity_value: "50" }, "km", { date_of_reporting: "2026-03-31" }));
  assert.equal(filled.activity_data.Vehicle, "hgv");
  assert.equal(filled.extra_data.paid_by, "We paid");
  const own = await saved(await typed("user", { record_type: "trip", Vehicle: "van", emission_category: "SE-2 HGV", activity_value: "50" }, "km", { date_of_reporting: "2026-02-28", extra_data: { paid_by: "Customer or other" } }));
  assert.equal(own.activity_data.Vehicle, "van");
  assert.equal(own.extra_data.paid_by, "Customer or other");

  // A User's manual bulk upload goes through the same engine.
  const plan = await call("POST", "/imports/plans", "user", {
    source_name: "freight.xlsx",
    channel: "bulk_upload",
    rows: [{ row_ref: "r1", site_id: SITE, category_id: CAT, activity_name: "SE-2 HGV", activity_value: 70, activity_unit: "km", fields: { record_type: "trip" }, period: { kind: "monthly", date: "2026-01-01" } }],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.json));
  assert.equal(plan.json.rows[0].state, "ready", JSON.stringify(plan.json.rows[0]));
  const commit = await call("POST", `/imports/plans/${plan.json.plan_id}/commit`, "user", { version: plan.json.version, skip_rows_with_issues: false, idempotency_key: `se-2-${plan.json.plan_id}` });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  const [row] = await q(`SELECT pk_id, method, activity_data FROM emission WHERE upload_batch_id = $1`, [commit.json.committed.upload_batch_id]);
  created.push(row.pk_id);
  assert.equal(row.activity_data.Vehicle, "hgv");
  assert.equal(row.method, "distance_based");
});

test("a fixed unit fills a row with none and refuses another (UNIT_NOT_ALLOWED), never converting it", async () => {
  // Fixing km needs a form whose rows can only be distance_based.
  const put = await putForm("superadmin", { method_by_choice: { column: "record_type", map: { trip: "distance_based" } }, units: { fixed: "km" } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const none = await saved(await typed("user", { record_type: "trip", emission_category: "SE-2 HGV", activity_value: "20" }, "", { date_of_reporting: "2025-12-31" }));
  assert.equal(none.activity_data_unit, "km");
  assert.equal(none.total, 0.02);
  const same = await saved(await typed("user", { record_type: "trip", emission_category: "SE-2 HGV", activity_value: "20" }, "KM", { date_of_reporting: "2025-11-30" }));
  assert.equal(same.total, 0.02);
  const other = await typed("user", { record_type: "trip", emission_category: "SE-2 HGV", activity_value: "20" }, "litre", { date_of_reporting: "2025-10-31" });
  assert.equal(other.status, 400, JSON.stringify(other.json));
  assert.equal(other.json.code, "UNIT_NOT_ALLOWED");
  assert.equal(other.json.field, "activity_data_unit");
  assert.match(other.json.message, /takes km only/);
  // Cleared again for the other tests.
  assert.equal((await putForm("superadmin", { units: null, method_by_choice: choice })).status, 200);
});

test("a spend row that names no currency takes the form's, else the company's default", async () => {
  const create = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "SE-2 spend",
    site_id: SITE,
    category_id: SPEND,
    column_ids: [],
    method_options: [{ method: "spend_based", units: ["INR", "USD"] }],
  });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  spendFormId = create.json.columnConfig.pk_id;
  const spendRow = (date) =>
    call("POST", "/user/emissions", "user", {
      site_id: SITE, category_id: SPEND, date_of_reporting: date, reporting_period: "monthly",
      activity_data: { emission_category: "SE-2 Steel spend", spent_value: "80000" }, extra_data: { invoice_date: "2026-07-15" },
    });
  // The company's default (INR for current clients).
  const inr = await saved(await spendRow("2026-07-31"));
  assert.equal(inr.activity_data.currency, "INR");
  assert.equal(inr.activity_data_unit, "INR");
  assert.equal(inr.fx.currency, "INR");
  // The form's fixed currency wins over the company's.
  assert.equal((await putForm("superadmin", { currency: { fixed: "USD" } }, spendFormId)).status, 200);
  const usd = await saved(await spendRow("2026-08-31"));
  assert.equal(usd.activity_data.currency, "USD");
  assert.equal(usd.activity_data_unit, "USD");
  // A currency the row gives is kept.
  const own = await saved(
    await call("POST", "/user/emissions", "user", {
      site_id: SITE, category_id: SPEND, date_of_reporting: "2026-09-30", reporting_period: "monthly",
      activity_data: { emission_category: "SE-2 Steel spend", spent_value: "80000", currency: "INR" }, extra_data: { invoice_date: "2026-07-15" },
    }),
  );
  assert.equal(own.activity_data_unit, "INR");
});

test("company settings: a Superadmin sets entry_detail and default_currency; bad values and other roles are refused", async () => {
  for (const who of ["admin", "manager", "user"]) {
    assert.equal((await call("PUT", "/admin/companies/1", who, { entry_detail: "full" })).status, 403);
  }
  const bad = await call("PUT", "/admin/companies/1", "superadmin", { entry_detail: "everything" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.field, "entry_detail");
  const badCurrency = await call("PUT", "/admin/companies/1", "superadmin", { default_currency: "JPY" });
  assert.equal(badCurrency.status, 400);
  assert.equal(badCurrency.json.field, "default_currency");
  const ok = await call("PUT", "/admin/companies/1", "superadmin", { entry_detail: "full", default_currency: "USD" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual((await q(`SELECT default_currency, entry_detail FROM company WHERE company_id = 1`))[0], { default_currency: "USD", entry_detail: "full" });
  // The session's company carries it, so the FE reads it (SE-1 showCalcDetail).
  const me = await call("GET", "/auth/me", "user");
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const sites = me.json.user?.sites?.length ? me.json.user.sites : [me.json.user?.site].filter(Boolean);
  assert.ok(sites.some((s) => s.company?.entry_detail === "full"), JSON.stringify(me.json).slice(0, 400));
  await q(`UPDATE company SET default_currency = 'INR', entry_detail = 'total' WHERE company_id = 1`);
});
