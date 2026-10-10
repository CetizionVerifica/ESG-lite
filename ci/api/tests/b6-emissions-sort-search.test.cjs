// B6: server-side sort + search on paginated GET /user/emissions.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const page = (q) => call("GET", `/user/emissions?siteIds=1,2&page=1&limit=50${q}`, "manager");
const ids = (res) => res.json.data.map((e) => e.pk_id);

test("without sort/search the response is unchanged (newest id first)", async () => {
  const res = await page("");
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res), [14, 13, 12, 11, 10, 9, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(res.json.total, 13);
  assert.deepEqual(Object.keys(res.json).sort(), ["data", "summary", "total"]);
  // Plain (non-paginated) form still returns an array.
  const plain = await call("GET", "/user/emissions?siteId=2", "manager");
  assert.ok(Array.isArray(plain.json));
});

test("sort by total_emission, both directions", async () => {
  const desc = await page("&sort=total_emission&order=desc");
  const totals = desc.json.data.map((e) => Number(e.total_emission));
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
  assert.equal(desc.json.data[0].pk_id, 2); // 312.4

  const asc = await page("&sort=total_emission&order=asc");
  const ascTotals = asc.json.data.map((e) => Number(e.total_emission));
  assert.deepEqual(ascTotals, [...ascTotals].sort((a, b) => a - b));
});

test("sort by joined columns and dates, with pages that do not overlap", async () => {
  const byCat = await page("&sort=category&order=asc");
  const names = byCat.json.data.map((e) => e.category.category_name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  const bySite = await page("&sort=site&order=desc");
  assert.equal(bySite.json.data[0].site.name, "CI Plant B");

  const byDate = await page("&sort=date&order=asc");
  const dates = byDate.json.data.map((e) => e.date_of_reporting);
  assert.deepEqual(dates, [...dates].sort());

  const p1 = await call("GET", "/user/emissions?siteIds=1,2&page=1&limit=5&sort=date&order=asc", "manager");
  const p2 = await call("GET", "/user/emissions?siteIds=1,2&page=2&limit=5&sort=date&order=asc", "manager");
  assert.deepEqual([...ids(p1), ...ids(p2)], ids(byDate).slice(0, 10));
});

test("search matches category, comment, submitter, activity values and id; summary follows", async () => {
  const travel = await page("&search=travel");
  assert.deepEqual(ids(travel).sort((a, b) => a - b), [3, 4, 14]);
  assert.equal(travel.json.total, 3);
  assert.deepEqual(
    { ...travel.json.summary, total_emission: undefined },
    { total_emission: undefined, pending_count: 0, pending_review_count: 0, approved_count: 2, rejected_count: 1 },
  );
  assert.equal(travel.json.summary.total_emission, 14);

  assert.deepEqual(ids(await page("&search=WRONG%20UNIT")), [4]);
  assert.deepEqual(ids(await page("&search=Mumbai")), [3]);
  assert.deepEqual(ids(await page("&search=ci%20multi")).sort((a, b) => a - b), [6, 7, 11, 12]);
  assert.ok(ids(await page("&search=12")).includes(12));
  // LIKE wildcards are literal.
  assert.equal((await page("&search=%25")).json.total, 0);
  // Search combines with the other filters.
  assert.deepEqual(ids(await page("&search=travel&status=approved&sort=total_emission&order=asc")), [3, 14]);
});

test("invalid sort or order is a 400", async () => {
  assert.equal((await page("&sort=password")).status, 400);
  assert.equal((await page("&sort=date&order=sideways")).status, 400);
});

test("inherited object keys are not sort keys (400, and the server keeps working)", async () => {
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal((await page(`&sort=${key}`)).status, 400, key);
  }
  const after = await page("&sort=date&order=asc");
  assert.equal(after.status, 200);
  assert.equal(after.json.total, 13);
});

test("search matches activity values, not key names", async () => {
  // Every fixture row has an "activity_value" key; none has it as a value.
  assert.equal((await page("&search=activity_value")).json.total, 0);
  assert.equal((await page("&search=Fuel")).json.total, 0);
  assert.equal((await page("&search=Meter")).json.total, 0);
  assert.deepEqual(ids(await page("&search=diesel")), [1]);
  assert.deepEqual(ids(await page("&search=441242")), [2]);
});
