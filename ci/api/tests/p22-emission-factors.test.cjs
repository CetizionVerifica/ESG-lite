// P22: GET /admin/emission-factors (and /batches) filter by client and year.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const NAME = "P22 filter check";
const created = [];

test.before(async () => {
  const rows = [
    { site_id: 1, category_id: 1, year: 2024 },
    { site_id: 2, category_id: 1, year: 2023 },
    { site_id: 3, category_id: 1, year: 2024 },
  ];
  for (const r of rows) {
    const res = await call("POST", "/admin/emission-factors", "superadmin", {
      ...r,
      factor_value: 1.5,
      denominator_unit: "kg",
      emission_category_name: NAME,
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    created.push(res.json.emissionFactor.emission_factor_id);
  }
});

test.after(async () => {
  for (const id of created) await call("DELETE", `/admin/emission-factors/${id}`, "superadmin");
});

const list = (q) => call("GET", `/admin/emission-factors?search=${encodeURIComponent(NAME)}${q}`, "superadmin");
const sites = (res) => res.json.data.map((f) => f.site.site_id).sort();

test("without the new params every match comes back", async () => {
  const res = await list("");
  assert.equal(res.status, 200);
  assert.deepEqual(sites(res), [1, 2, 3]);
});

test("company_id keeps only that client's sites", async () => {
  assert.deepEqual(sites(await list("&company_id=1")), [1, 2]);
  assert.deepEqual(sites(await list("&company_id=2")), [3]);
});

test("year filters, and combines with company_id", async () => {
  assert.deepEqual(sites(await list("&year=2024")), [1, 3]);
  const both = await list("&year=2024&company_id=1");
  assert.deepEqual(sites(both), [1]);
  assert.equal(both.json.total, 1);
});

test("batches accept company_id", async () => {
  const res = await call("GET", "/admin/emission-factors/batches?company_id=2", "superadmin");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json));
  assert.ok(res.json.every((b) => b.site_id === 3));
});

test("non-superadmins are refused", async () => {
  const res = await call("GET", "/admin/emission-factors?company_id=1", "admin");
  assert.ok(res.status === 401 || res.status === 403);
});
