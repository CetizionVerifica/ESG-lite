// Several categories at once: categoryIds=1,2 on the emissions list, its
// summary, upload batches and the manager overview; categoryId=1 still works.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

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
  const res = await call("GET", "/user/emissions/batches?siteIds=1,2&categoryIds=1,2", "manager");
  assert.equal(res.status, 200);
  for (const b of res.json) assert.ok([1, 2].includes(b.category_id));
});

test("manager overview takes several categories and rejects bad ids", async () => {
  const one = (await call("GET", "/manager/overview?period=2025&categoryId=1", "manager")).json;
  const two = (await call("GET", "/manager/overview?period=2025&categoryId=2", "manager")).json;
  const both = await call("GET", "/manager/overview?period=2025&categoryIds=1,2", "manager");
  assert.equal(both.status, 200);
  assert.equal(both.json.category_id, null);
  assert.deepEqual(both.json.category_ids, [1, 2]);
  assert.equal(Math.round(both.json.kpis.gross * 1000), Math.round((one.kpis.gross + two.kpis.gross) * 1000));
  assert.equal(one.category_id, 1);
  for (const bad of ["1,0", "1,abc", "2,-1"]) {
    assert.equal((await call("GET", `/manager/overview?categoryIds=${bad}`, "manager")).status, 400, bad);
  }
});
