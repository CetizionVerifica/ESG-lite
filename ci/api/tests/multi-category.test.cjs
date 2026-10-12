// Several categories at once: categoryIds=1,2 on the emissions list, its
// summary, upload batches, the Excel export and the manager overview;
// categoryId=1 still works, and a bad id is a 400, never "all categories".
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { call, withDb } = require("../helpers.cjs");

const list = (q) => call("GET", `/user/emissions?siteIds=1,2&page=1&limit=50${q}`, "manager");
const cats = (res) => [...new Set(res.json.data.map((e) => e.category.category_id))].sort((a, b) => a - b);

test("emissions list and summary take several categories", async () => {
  const one = await list("&categoryId=1");
  const two = await list("&categoryId=2");
  const both = await list("&categoryIds=1,2");
  assert.equal(both.status, 200);
  assert.deepEqual(cats(both), [1, 2]);
  assert.equal(both.json.total, one.json.total + two.json.total);
  assert.equal(both.json.summary.approved_count, one.json.summary.approved_count + two.json.summary.approved_count);
  // The single form and a one-item list agree.
  assert.deepEqual((await list("&categoryIds=1")).json.data.map((e) => e.pk_id), one.json.data.map((e) => e.pk_id));
});

test("upload batches take several categories", async () => {
  // Fixture rows carry no batch id: put entries 1, 2, 3 (categories 1, 2, 3) in batches.
  await withDb((db) => db.query("UPDATE emission SET upload_batch_id = 'ci-batch-' || pk_id WHERE pk_id IN (1, 2, 3)"));
  try {
    const res = await call("GET", "/user/emissions/batches?siteIds=1,2&categoryIds=1,2", "manager");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.map((b) => b.category_id).sort(), [1, 2]);
    const one = await call("GET", "/user/emissions/batches?siteIds=1,2&categoryId=3", "manager");
    assert.deepEqual(one.json.map((b) => b.upload_batch_id), ["ci-batch-3"]);
  } finally {
    await withDb((db) => db.query("UPDATE emission SET upload_batch_id = NULL WHERE pk_id IN (1, 2, 3)"));
  }
});

test("the year export takes several categories", async () => {
  const res = await call("GET", "/user/emissions/export?siteIds=1&year=2025&categoryIds=1,3", "manager");
  assert.equal(res.status, 200);
  const wb = XLSX.read(res.buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const header = rows.findIndex((r) => r[0] === "#");
  const data = [];
  for (let i = header + 1; i < rows.length && rows[i].length && rows[i][0] !== ""; i++) data.push(rows[i]);
  // Site 1, 2025: ids 1 (category 1, 4.29) and 3, 4, 14 (category 3); id 2 (category 2) is left out.
  const emission = data.map((r) => r[rows[header].indexOf("Emission (tCO2e)")]);
  assert.deepEqual(emission.sort((a, b) => a - b), [1, 2, 4.29, 11]);
});

test("bad category ids are rejected, not read as all categories", async () => {
  const tooMany = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
  const routes = [
    (q) => `/user/emissions?siteIds=1,2&page=1&limit=5${q}`,
    (q) => `/user/emissions/batches?siteIds=1,2${q}`,
    (q) => `/user/emissions/export?siteIds=1&year=2025${q}`,
    (q) => `/manager/overview?period=2025${q}`,
  ];
  for (const route of routes) {
    for (const q of ["&categoryIds=abc", "&categoryIds=0", "&categoryId=0", "&categoryIds=1,-2", "&categoryIds=2147483648", `&categoryIds=${tooMany}`]) {
      assert.equal((await call("GET", route(q), "manager")).status, 400, route(q));
    }
  }
  // An empty categoryIds falls back to categoryId.
  assert.deepEqual(cats(await list("&categoryIds=&categoryId=1")), [1]);
});

test("manager overview takes several categories", async () => {
  const one = (await call("GET", "/manager/overview?period=2025&categoryId=1", "manager")).json;
  const three = (await call("GET", "/manager/overview?period=2025&categoryId=3", "manager")).json;
  const both = await call("GET", "/manager/overview?period=2025&categoryIds=1,3", "manager");
  assert.equal(both.status, 200);
  assert.equal(both.json.category_id, null);
  assert.deepEqual(both.json.category_ids, [1, 3]);
  // Both categories have approved 2025 entries, so the sum checks something.
  assert.ok(one.kpis.gross > 0 && three.kpis.gross > 0);
  assert.equal(Math.round(both.json.kpis.gross * 1000), Math.round((one.kpis.gross + three.kpis.gross) * 1000));
  assert.equal(one.category_id, 1);
});
