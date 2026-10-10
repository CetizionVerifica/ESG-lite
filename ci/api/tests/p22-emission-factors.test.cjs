// P22: GET /admin/emission-factors (and /batches) filter by client and year.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const NAME = "P22 filter check";
const created = [];
const batches = [];

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
  // One import batch on a client-1 site and one on client 2's site.
  for (const site_id of [1, 3]) {
    const res = await call("POST", "/admin/emission-factors/bulk", "superadmin", {
      factors: [{ site_id, category_id: 1, year: 2019, factor_value: 2, denominator_unit: "kg", emission_category_name: "P22 batch check" }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.ok(res.json.upload_batch_id, JSON.stringify(res.json));
    batches.push(res.json.upload_batch_id);
  }
});

test.after(async () => {
  for (const id of created) await call("DELETE", `/admin/emission-factors/${id}`, "superadmin");
  for (const id of batches) await call("DELETE", `/admin/emission-factors/batch/${id}`, "superadmin");
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
  const ours = (res) => res.json.filter((b) => batches.includes(b.upload_batch_id)).map((b) => b.site_id).sort();
  const all = await call("GET", "/admin/emission-factors/batches", "superadmin");
  assert.equal(all.status, 200);
  assert.deepEqual(ours(all), [1, 3]);
  const two = await call("GET", "/admin/emission-factors/batches?company_id=2", "superadmin");
  assert.equal(two.status, 200);
  assert.deepEqual(ours(two), [3]);
  assert.ok(two.json.every((b) => b.site_id === 3));
  assert.deepEqual(ours(await call("GET", "/admin/emission-factors/batches?company_id=1", "superadmin")), [1]);
});

test("editing only the name checks duplicates by name", async () => {
  // Two factors on site 1, category 1, 2024 may coexist when their names differ.
  const res = await call("POST", "/admin/emission-factors", "superadmin", {
    site_id: 1, category_id: 1, year: 2024, factor_value: 3, denominator_unit: "kg", emission_category_name: "P22 rename check",
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = res.json.emissionFactor.emission_factor_id;
  created.push(id);
  const rename = await call("PUT", `/admin/emission-factors/${id}`, "superadmin", { emission_category_name: "P22 rename check 2" });
  assert.equal(rename.status, 200, JSON.stringify(rename.json));
  const clash = await call("PUT", `/admin/emission-factors/${id}`, "superadmin", { emission_category_name: NAME });
  assert.equal(clash.status, 400);
  const yearOnly = await call("PUT", `/admin/emission-factors/${id}`, "superadmin", { year: 2024 });
  assert.equal(yearOnly.status, 200, JSON.stringify(yearOnly.json));
});

test("non-superadmins are refused", async () => {
  const res = await call("GET", "/admin/emission-factors?company_id=1", "admin");
  assert.ok(res.status === 401 || res.status === 403);
});
