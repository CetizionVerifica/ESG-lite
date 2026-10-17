// SE-2 · Simple data entry form settings (src/forms/formConfig.ts): reading
// them tolerantly, the method order, hidden defaults, the fixed unit, the
// currency fallback and the checks on a Superadmin's write. No database.
// Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const form = require(path.resolve("dist/forms/formConfig.js"));
const schemas = require(path.resolve("dist/scope3/contracts/schemas.js"));

// A transport form in the client's words: "What does your record show?" picks the method.
const shape = {
  columns: [
    { pk_id: 11, column_name: "record_type", column_type: "select" },
    { pk_id: 12, column_name: "Vehicle", column_type: "select" },
    { pk_id: 13, column_name: "Distance", column_type: "number" },
    { pk_id: 14, column_name: "Litres", column_type: "number" },
    { pk_id: 15, column_name: "Trip ref", column_type: "text" },
  ],
  extra_fields: [
    { key: "paid_by", label: "Who paid?", type: "select", required: false, options: ["We paid", "Customer or other"] },
    { key: "po_number", label: "PO number", type: "text", required: false },
  ],
  column_options: {
    11: [
      { id: "fuel_bill", label: "Fuel bill" },
      { id: "trip", label: "Trip distance" },
    ],
    12: [{ id: "hgv", label: "HGV" }],
  },
  dependent_options: {},
  method_options: [
    { method: "fuel_based", units: ["litre"] },
    { method: "distance_based", units: ["km", "tonne.km"] },
  ],
};
const settings = {
  method_by_choice: { column: "record_type", map: { fuel_bill: "fuel_based", trip: "distance_based" } },
  field_settings: { Vehicle: { hidden: true, default: "hgv" }, paid_by: { hidden: true, default: "We paid" }, "Trip ref": { label: "Your reference" } },
  currency: { fixed: "USD" },
};

test("readFormSettings: the choice map by id and by label, fixed unit and currency, extra keys", () => {
  const s = form.readFormSettings(shape, settings);
  assert.equal(form.methodByChoice(s, { record_type: "trip" }), "distance_based");
  assert.equal(form.methodByChoice(s, { record_type: "Fuel bill" }), "fuel_based", "a sheet may give the label");
  assert.equal(form.methodByChoice(s, { RECORD_TYPE: "TRIP" }), "distance_based", "keys and answers match without regard to case");
  assert.equal(form.methodByChoice(s, { record_type: "" }), null);
  assert.equal(form.methodByChoice(s, { record_type: "boat" }), null, "an answer the map doesn't name");
  assert.equal(s.fixed_unit, null);
  assert.equal(form.readFormSettings(shape, { units: { fixed: "km" } }).fixed_unit, "km");
  assert.equal(s.fixed_currency, "USD");
  assert.deepEqual([...s.extra_keys], ["paid_by", "po_number"]);
});

test("readFormSettings skips what doesn't fit its schema, never trusting or refusing rows over it", () => {
  const s = form.readFormSettings(shape, { method_by_choice: { column: "record_type", map: { trip: "teleport" } }, field_settings: "x", units: { fixed: 5 }, currency: { fixed: "rupees" } });
  assert.equal(s.choice, null);
  assert.deepEqual(s.field_settings, {});
  assert.equal(s.fixed_unit, null);
  assert.equal(s.fixed_currency, null);
  assert.deepEqual(form.readFormSettings(null, settings), form.NO_FORM_SETTINGS);
  // A config loaded without its columns still maps choices by id (dependent lists and ids).
  assert.equal(form.methodByChoice(form.readFormSettings({ ...shape, columns: undefined }, settings), { record_type: "trip" }), "distance_based");
});

test("namedMethodFor: importers name the method; for a User the form decides where it fixes one", () => {
  const offered = ["fuel_based", "distance_based"];
  const caller = (named, choice) => form.namedMethodFor({ source: "caller", named, choice, offered });
  const user = (named, choice, offer = offered) => form.namedMethodFor({ source: "contributor", named, choice, offered: offer });
  // Caller (Admin/Superadmin/Manager import, MCP, recalculation): its method wins, else the choice.
  assert.equal(caller("fuel_based", "distance_based"), "fuel_based");
  assert.equal(caller(null, "distance_based"), "distance_based");
  assert.equal(caller(null, null), null);
  // Contributor: the choice wins over whatever the row sends.
  assert.equal(user("fuel_based", "distance_based"), "distance_based");
  // One method: the form's, as for a row naming none (null → method_options[0] downstream).
  assert.equal(user("spend_based", null, ["fuel_based"]), null);
  // Several methods, no choice map: the form fixes none, so today's rule (S3-3 refuses one it doesn't offer).
  assert.equal(user("distance_based", null), "distance_based");
  assert.equal(user("spend_based", null), "spend_based");
  // A choice map fixes the method even for an answer it doesn't map: the row's own is ignored (null → the form's default).
  assert.equal(form.namedMethodFor({ source: "contributor", named: "fuel_based", choice: null, offered, hasChoiceMap: true }), null);
  assert.equal(form.namedMethodFor({ source: "caller", named: "fuel_based", choice: null, offered, hasChoiceMap: true }), "fuel_based");
  // No method_options at all (S3-9 "@method" forms): the row's own method, as before.
  assert.equal(user("distance_based", null, null), "distance_based");
});

test("applyHiddenDefaults fills hidden fields the row leaves empty, columns in activity_data and extras in extra_data", () => {
  const s = form.readFormSettings(shape, settings);
  const activity = { record_type: "trip", Distance: "120", vehicle: "" };
  const out = form.applyHiddenDefaults(s, activity, { po_number: "PO-1" });
  assert.equal(out.activity_data.vehicle, "hgv", "the row's own key, matched without regard to case");
  assert.equal(out.extra_data.paid_by, "We paid");
  assert.equal(out.extra_data.po_number, "PO-1");
  assert.deepEqual(out.filled.sort(), ["Vehicle", "paid_by"]);
  assert.equal(activity.vehicle, "", "the caller's object is left as it was");
  // A value the row has is never overwritten; a field that isn't hidden is the browser's to prefill.
  const kept = form.applyHiddenDefaults(s, { Vehicle: "van" }, { paid_by: "Customer or other" });
  assert.equal(kept.activity_data.Vehicle, "van");
  assert.equal(kept.extra_data.paid_by, "Customer or other");
  assert.deepEqual(kept.filled, []);
  const notHidden = form.readFormSettings(shape, { field_settings: { Vehicle: { default: "hgv" } } });
  assert.deepEqual(form.applyHiddenDefaults(notHidden, {}, {}).activity_data, {});
});

test("fixedUnitFor: fills a missing unit, keeps the same unit written another way, refuses another", () => {
  const s = form.readFormSettings(shape, { units: { fixed: "litre" } });
  assert.deepEqual(form.fixedUnitFor(s, ""), { ok: true, unit: "litre" });
  assert.deepEqual(form.fixedUnitFor(s, null), { ok: true, unit: "litre" });
  assert.deepEqual(form.fixedUnitFor(s, "Litres"), { ok: true, unit: "Litres" });
  const refused = form.fixedUnitFor(s, "kWh");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /takes litre only; the row is in kWh/);
  assert.deepEqual(form.fixedUnitFor(form.NO_FORM_SETTINGS, "kg"), { ok: true, unit: "kg" });
});

test("defaultCurrencyFor: the form's fixed currency, else the company's (INR for current clients)", () => {
  assert.equal(form.defaultCurrencyFor(form.readFormSettings(shape, settings), "INR"), "USD");
  assert.equal(form.defaultCurrencyFor(form.NO_FORM_SETTINGS, "INR"), "INR");
  assert.equal(form.defaultCurrencyFor(form.NO_FORM_SETTINGS, "XYZ"), null, "a currency ESGLite doesn't convert is no default");
  assert.equal(form.defaultCurrencyFor(form.NO_FORM_SETTINGS, null), null);
  assert.equal(form.hasValue({ Currency: "EUR" }, null, "currency"), true);
  assert.equal(form.hasValue({ currency: " " }, { currency: "INR" }, "currency"), true);
  assert.equal(form.hasValue({}, {}, "currency"), false);
});

test("parseFormSettingsInput accepts settings that fit the form; null clears; absent keeps", () => {
  const ok = form.parseFormSettingsInput(settings, shape);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.value.method_by_choice, settings.method_by_choice);
  assert.equal(ok.value.units, undefined);
  // A fixed unit the form's default method offers, written another way.
  assert.deepEqual(form.parseFormSettingsInput({ units: { fixed: "Litres" } }, shape).value, { units: { fixed: "Litres" } });
  // With a choice map, every mapped method must offer it.
  const tripOnly = { column: "record_type", map: { trip: "distance_based" } };
  assert.equal(form.parseFormSettingsInput({ method_by_choice: tripOnly, units: { fixed: "km" } }, shape).ok, true);
  const cleared = form.parseFormSettingsInput({ method_by_choice: null, field_settings: null, units: null, currency: null }, shape);
  assert.deepEqual(cleared.value, { method_by_choice: null, field_settings: {}, units: null, currency: null });
  assert.deepEqual(form.parseFormSettingsInput({ config_name: "x" }, shape).value, {});
});

test("parseFormSettingsInput refuses settings that don't fit the form, naming the field", () => {
  const refuse = (body, over = {}) => form.parseFormSettingsInput(body, { ...shape, ...over });
  const cases = [
    [{ method_by_choice: { column: "Boat", map: { a: "fuel_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.column", /isn't a field of this form/],
    [{ method_by_choice: { column: "Distance", map: { a: "fuel_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.column", /isn't a choice field/],
    [{ method_by_choice: { column: "record_type", map: { boat: "fuel_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.map.boat", /isn't one of record_type's choices/],
    [{ method_by_choice: { column: "record_type", map: { trip: "spend_based" } } }, "FORM_CHECK_FAILED", "method_by_choice.map.trip", /isn't one of the form's methods/],
    [{ method_by_choice: { column: "record_type", map: { trip: "teleport" } } }, "FIELD_INVALID", "method_by_choice.map.trip", /./],
    [{ field_settings: { Colour: { hidden: true } } }, "FORM_CHECK_FAILED", "field_settings.Colour", /isn't a field of this form/],
    [{ field_settings: { Distance: { default: "far" } } }, "FORM_CHECK_FAILED", "field_settings.Distance.default", /must be a number/],
    [{ field_settings: { Vehicle: { default: "bike" } } }, "FORM_CHECK_FAILED", "field_settings.Vehicle.default", /isn't one of the field's choices/],
    [{ field_settings: { paid_by: { default: "Nobody" } } }, "FORM_CHECK_FAILED", "field_settings.paid_by.default", /isn't one of the field's choices/],
    [{ field_settings: { Vehicle: { colour: "red" } } }, "FIELD_INVALID", "field_settings.Vehicle", /./],
    [{ units: { fixed: "kWh" } }, "FORM_CHECK_FAILED", "units.fixed", /offers litre; "kWh" isn't one of them/],
    [{ ...settings, units: { fixed: "litre" } }, "FORM_CHECK_FAILED", "units.fixed", /Distance travelled offers km, tonne.km/],
    [{ currency: { fixed: "JPY" } }, "FORM_CHECK_FAILED", "currency.fixed", /can't be converted yet/],
    [{ currency: { fixed: "inr" } }, "FIELD_INVALID", "currency.fixed", /three-letter currency code/],
  ];
  for (const [body, code, field, message] of cases) {
    const r = refuse(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.equal(r.code, code, JSON.stringify(body));
    assert.equal(r.field, field, JSON.stringify(body));
    assert.match(r.message, message, JSON.stringify(body));
  }
  // A choice map needs the form's methods first.
  const noMethods = refuse({ method_by_choice: settings.method_by_choice }, { method_options: null });
  assert.equal(noMethods.field, "method_by_choice.map");
  assert.match(noMethods.message, /set the form's methods \(method_options\) first/);
});

test("the contracts: SE-2 schemas sit beside MethodOptionsSchema; entry_detail is total or full", () => {
  assert.deepEqual([...schemas.ENTRY_DETAILS], ["total", "full"]);
  assert.equal(schemas.EntryDetailSchema.safeParse("full").success, true);
  assert.equal(schemas.EntryDetailSchema.safeParse("half").success, false);
  assert.equal(schemas.FieldSettingSchema.safeParse({ label: "Your reference", hidden: false, required: true }).success, true);
  assert.equal(schemas.FormUnitsSchema.safeParse({ fixed: "km", allowed: ["km"] }).success, false, "allowed units live in method_options");
  assert.equal(schemas.CurrencyCodeSchema.safeParse("INR").success, true);
});
