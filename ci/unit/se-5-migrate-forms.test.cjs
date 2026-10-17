// SE-5 · What migrate:entry-forms-data changes on a form (src/forms/migrateForms.ts), and the
// engine's fallback that keeps rows saved before it calculating (calculationSpec.ts). No database.
// Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { planFormMigration, ANSWER_LABELS, QUESTION_COLUMN, QUESTION_LABEL } = require(path.resolve("dist/forms/migrateForms.js"));
const { computeSpecActivityValue } = require(path.resolve("dist/services/calculationSpec.js"));

const QUESTION = { pk_id: 501, column_name: QUESTION_COLUMN };

// S3-9's commuting form as migrateScope3Travel writes it (trimmed): "@method" picks the formula.
const commuting = () => ({
  pk_id: 224,
  ghg_category: 7,
  columns: [
    { pk_id: 95, column_name: "Fuel used (litres)", column_type: "number" },
    { pk_id: 96, column_name: "Commuting mode", column_type: "select" },
    { pk_id: 97, column_name: "Total distance (km)", column_type: "number" },
    { pk_id: 98, column_name: "Total employees", column_type: "number" },
  ],
  column_options: { 96: [{ id: "Bus [passenger.km]", label: "Bus [passenger.km]" }] },
  extra_fields: [],
  calculation: {
    mode: "per_method",
    method_column: "@method",
    standard: "scope3-travel@1",
    standard_hash: "abc",
    methods: {
      fuel_based: { multiply: ["Fuel used (litres)"], activity_unit: "litre" },
      average_data: { multiply: ["Total employees", "Total distance (km)"] },
      distance_based: { multiply: ["Total distance (km)", "Total employees"] },
    },
  },
  method_options: null,
  method_by_choice: null,
  field_settings: {},
  units: ["passenger.km", "vehicle.km", "litre"],
});

test("several methods: a question whose answers are the method keys, the methods offered, the formula follows the question", () => {
  const r = planFormMigration(commuting(), QUESTION);
  assert.equal(r.plan.change, "question");
  assert.equal(r.plan.addQuestion, true);
  const s = r.plan.set;
  assert.deepEqual(s.method_options, [
    { method: "distance_based", units: ["passenger.km", "vehicle.km"] },
    { method: "average_data", units: ["passenger.km", "vehicle.km"] },
    { method: "fuel_based", units: ["litre"] },
  ]);
  assert.deepEqual(s.column_options["501"], [
    { id: "distance_based", label: "Trip distance" },
    { id: "average_data", label: "Average figures" },
    { id: "fuel_based", label: "Fuel used" },
  ]);
  assert.deepEqual(s.column_options["96"], commuting().column_options[96], "other choices stay");
  assert.deepEqual(s.method_by_choice, { column: "Record type", map: { distance_based: "distance_based", average_data: "average_data", fuel_based: "fuel_based" } });
  assert.equal(s.calculation.method_column, "Record type");
  assert.deepEqual(s.calculation.methods, commuting().calculation.methods, "the formula's keys stay");
  assert.equal(s.calculation.standard_hash, "abc", "the old hash stays, so the standard migration leaves the form alone from now on");
  assert.deepEqual(s.field_settings, { "Record type": { label: QUESTION_LABEL } });
  for (const label of Object.values(ANSWER_LABELS)) assert.doesNotMatch(label, /based|specific|method/i, "answers are the record's words, not a method's");
});

test("a moved form needs nothing more; one method only gets its method_options; a form already asking keeps its words", () => {
  const moved = { ...commuting(), ...planFormMigration(commuting(), QUESTION).plan.set, columns: [...commuting().columns, { pk_id: 501, column_name: "Record type", column_type: "select" }] };
  assert.equal(planFormMigration(moved, QUESTION), null, "running twice changes nothing");

  const one = commuting();
  one.calculation.methods = { fuel_based: one.calculation.methods.fuel_based };
  const r = planFormMigration(one, QUESTION);
  assert.equal(r.plan.change, "single_method");
  assert.deepEqual(r.plan.set, { method_options: [{ method: "fuel_based", units: ["litre"] }] });
  assert.equal(planFormMigration({ ...one, method_options: r.plan.set.method_options }, QUESTION), null);

  const worded = commuting();
  worded.field_settings = { "Record type": { label: "How did you measure it?" } };
  assert.deepEqual(planFormMigration(worded, QUESTION).plan.set.field_settings, { "Record type": { label: "How did you measure it?" } });
});

test("forms it can't move are named with a reason, never half-changed", () => {
  const odd = commuting();
  odd.calculation.methods = { Bus: { multiply: ["Total distance (km)"] }, fuel_based: { multiply: ["Fuel used (litres)"] } };
  assert.match(planFormMigration(odd, QUESTION).skip, /aren't all methods/);
  const clash = commuting();
  clash.columns.push({ pk_id: 77, column_name: "Record type", column_type: "text" });
  assert.match(planFormMigration(clash, QUESTION).skip, /another "Record type"/);
  assert.match(planFormMigration(commuting(), null).skip, /no "Record type" column/);
  const unitless = commuting();
  unitless.ghg_category = 15;
  assert.match(planFormMigration(unitless, QUESTION).skip, /units can't be told/, "average_data has no unit in the formula or the category's list");
});

test("transport forms get the category's methods, kept to the units their formula calculates", () => {
  const smart = {
    ...commuting(),
    pk_id: 207,
    ghg_category: 4,
    calculation: { mode: "per_unit", methods: { km: { multiply: ["Distance travelled"] }, "tonne.km": { multiply: ["Weight (tonne)", "Distance travelled"] } } },
  };
  assert.deepEqual(planFormMigration(smart, QUESTION).plan, { form_id: 207, change: "transport_methods", set: { method_options: [{ method: "distance_based", units: ["tonne.km", "km"] }] }, addQuestion: false });
  assert.equal(planFormMigration({ ...smart, method_options: [{ method: "distance_based", units: ["km"] }] }, QUESTION), null, "a form with methods is left alone");
  assert.equal(planFormMigration({ ...smart, ghg_category: 1 }, QUESTION), null, "only Categories 4 and 9");
});

test("spend forms with bare method keys get each method's units: the currencies for spend, the form's units otherwise", () => {
  const goods = { ...commuting(), pk_id: 300, ghg_category: 1, calculation: null, method_options: ["average_data", "spend_based"], extra_fields: [{ key: "spent_value" }, { key: "currency" }], units: ["kg", "tonne"] };
  const r = planFormMigration(goods, QUESTION);
  assert.equal(r.plan.change, "spend_units");
  assert.deepEqual(r.plan.set.method_options, [
    { method: "average_data", units: ["kg", "tonne"] },
    { method: "spend_based", units: ["INR", "USD", "EUR", "GBP", "BHD", "SAR", "AED"] },
  ]);
  assert.match(planFormMigration({ ...goods, units: [] }, QUESTION).skip, /no units for average_data/);
  assert.equal(planFormMigration({ ...goods, extra_fields: [] }, QUESTION), null, "not a spend form");
});

test("the engine: a row saved before the question keeps its formula; an answer picks one; nothing else moves", () => {
  const moved = { ...commuting().calculation, method_column: "Record type" };
  const old = { "@method": "fuel_based", "Fuel used (litres)": "300", "Total distance (km)": "50", "Total employees": "4" };
  assert.deepEqual(computeSpecActivityValue(commuting().calculation, old, "litre"), { ok: true, value: 300, unitKey: undefined });
  assert.deepEqual(computeSpecActivityValue(moved, old, "litre"), { ok: true, value: 300, unitKey: undefined }, "from its @method, as before");
  assert.deepEqual(computeSpecActivityValue(moved, { ...old, "@method": undefined }, "litre", "fuel_based"), { ok: true, value: 300, unitKey: undefined }, "or the row's method");
  assert.deepEqual(computeSpecActivityValue(moved, { ...old, "Record type": "distance_based" }, "km"), { ok: true, value: 200, unitKey: undefined }, "an answer decides");
  const none = computeSpecActivityValue(moved, { "Fuel used (litres)": "300" }, "litre");
  assert.equal(none.ok, false);
  assert.match(none.message, /Please choose a value for "Record type"/);
  // A form whose own column picks the formula (Use of sold products) doesn't take "@method".
  const use = { mode: "per_method", method_column: "Method", methods: { "Fuel sold to customers": { multiply: ["Units"] } } };
  assert.equal(computeSpecActivityValue(use, { "@method": "direct_use", Units: "3" }, "litre").ok, false);
});

test("a row that names an answer in @method instead (saved before the move, or an older screen or sheet) has answered the question", () => {
  const form = require(path.resolve("dist/forms/formConfig.js"));
  const moved = { ...commuting(), ...planFormMigration(commuting(), QUESTION).plan.set, columns: [...commuting().columns, { pk_id: 501, column_name: "Record type", column_type: "select" }] };
  const s = form.readFormSettings(moved, moved);
  assert.equal(form.methodByChoice(s, { "Record type": "fuel_based" }), "fuel_based");
  assert.equal(form.methodByChoice(s, { "Record type": "Trip distance" }), "distance_based", "by label too");
  assert.equal(form.methodByChoice(s, { "@method": "average_data" }), "average_data", "no answer: @method answers");
  assert.equal(form.methodByChoice(s, { "Record type": "fuel_based", "@method": "average_data" }), "fuel_based", "an answer wins");
  assert.equal(form.methodByChoice(s, { "@method": "spend_based" }), null, "not one of the answers");
  // A builder-made question (answer ids aren't methods) keeps SE-2's rule: @method doesn't answer it.
  const built = form.readFormSettings(
    { columns: [{ pk_id: 11, column_name: "record_type", column_type: "select" }], column_options: { 11: [{ id: "fuel_bill", label: "Fuel bill" }] }, method_options: [{ method: "fuel_based", units: ["litre"] }] },
    { method_by_choice: { column: "record_type", map: { fuel_bill: "fuel_based" } } },
  );
  assert.equal(form.methodByChoice(built, { "@method": "fuel_based" }), null);
});
