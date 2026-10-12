// Unit tests for the declaration export helpers (C05). Runs against the build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { decimal, uuidV5, pactUnit, toCsv, DeclarationError } = require(path.resolve("dist/pcf/declaration.js"));

test("decimals are plain strings without an exponent", () => {
  assert.equal(decimal(9.1), "9.1");
  assert.equal(decimal(1), "1");
  assert.equal(decimal(1e-7), "0.0000001");
  assert.equal(decimal(-0), "0");
  assert.equal(decimal(12345678.5), "12345678.5");
  assert.throws(() => decimal(NaN), DeclarationError);
});

test("uuidV5 matches the RFC 4122 reference value", () => {
  assert.equal(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
});

test("declared units map to PACT units", () => {
  assert.deepEqual(pactUnit("kg", 1, null), { unit: "kilogram", amount: 1, mass: 1 });
  assert.deepEqual(pactUnit("t", 2, null), { unit: "kilogram", amount: 2000, mass: 2000 });
  assert.deepEqual(pactUnit("g", 500, null), { unit: "kilogram", amount: 0.5, mass: 0.5 });
  assert.deepEqual(pactUnit("kWh", 1, null), { unit: "kilowatt hour", amount: 1, mass: 0 });
  assert.deepEqual(pactUnit("piece", 1, 0.25), { unit: "piece", amount: 1, mass: 0.25 });
  assert.throws(() => pactUnit("piece", 1, null), (e) => e.status === 409);
  assert.throws(() => pactUnit("bag", 1, 1), (e) => e.status === 400);
  assert.throws(() => pactUnit(null, 1, 1), (e) => e.status === 400);
});

test("CSV quotes text and defuses spreadsheet formulas", () => {
  const csv = toCsv({
    draft: false,
    company: { name: 'Acme "Metals"' },
    product: { name: "=HYPERLINK(1)" },
    site: { name: "Plant" },
    declared_unit: { label: "1 kg" },
    reference_period: { start: "2024-01-01", end: "2024-12-31" },
    status: "approved",
    version: 1,
    method: { standard: "ISO14067", boundary: "cradle_to_gate", pcr: null, gwp_sets: ["AR6"] },
    total_kg_per_unit: 2.5,
    primary_data_share_pct: 50,
    dqr: { overall: 1.5 },
    pact_id: "x",
    licensed_values_withheld: false,
    by_stage: { A1: 2.5, A2: 0, A3_energy: 0, A3_packaging: 0, A3_waste: 0 },
    lines: [{ stage: "A1", name: "-1+1", data_type: "secondary", kgco2e_per_unit: 2.5 }],
  });
  assert.match(csv, /"Company","Acme ""Metals"""/);
  assert.match(csv, /"Product","'=HYPERLINK\(1\)"/);
  assert.match(csv, /"A1","'-1\+1","secondary",2\.5/);
  assert.equal(csv.includes("DRAFT"), false);
});
