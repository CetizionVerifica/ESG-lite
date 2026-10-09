// B5: GET /user/my-month — the contributor's checklist for a month.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");

const byName = (site) => Object.fromEntries(site.categories.map((c) => [c.category_name, c]));

test("statuses per category for a single-site user (Sep 2025)", async () => {
  const res = await call("GET", "/user/my-month?month=2025-09", "user");
  assert.equal(res.status, 200);
  assert.equal(res.json.month, "2025-09");
  assert.equal(res.json.due_date, "2025-10-10");
  assert.equal(res.json.escalation_date, "2025-10-15");
  assert.equal(res.json.sites.length, 1);

  const site = res.json.sites[0];
  assert.equal(site.site_id, 1);
  const cats = byName(site);
  // FERA is generated from its parent entry, never owed directly.
  assert.deepEqual(Object.keys(cats).sort(), ["Business Travel", "Purchased Electricity", "Renewable Electricity", "Stationary Combustion"]);

  assert.equal(cats["Stationary Combustion"].status, "approved");
  assert.equal(cats["Stationary Combustion"].total_emission, 4.29);
  assert.equal(cats["Purchased Electricity"].status, "pending");
  assert.equal(cats["Renewable Electricity"].status, "todo");
  assert.equal(cats["Renewable Electricity"].last_entry_at, null);

  const travel = cats["Business Travel"];
  assert.equal(travel.status, "rejected");
  assert.deepEqual(travel.entries, { total: 2, pending: 0, approved: 1, rejected: 1 });
  assert.equal(travel.total_emission, 1); // rejected entry does not count
  assert.equal(travel.rejections.length, 1);
  assert.equal(travel.rejections[0].review_comment, "Wrong unit, should be km");
  assert.equal(travel.rejections[0].reviewed_by, "CI Manager");
  assert.equal(travel.last_entry_at, "2025-10-05T09:00:00.000Z");

  assert.deepEqual(res.json.summary, { total: 4, due: 1, done: 1, pending: 1, rejected: 1 });
});

test("yearly batches: covered in other months, due in their period-end month", async () => {
  const sep = await call("GET", "/user/my-month?month=2025-09", "multiSiteUser");
  assert.equal(sep.status, 200);
  assert.deepEqual(sep.json.sites.map((s) => s.site_id), [1, 2]);
  // Grants (categories 1 + 2) narrow every site's list.
  for (const site of sep.json.sites) {
    assert.deepEqual(site.categories.map((c) => c.category_id).sort(), [1, 2]);
  }
  const plantB = byName(sep.json.sites[1]);
  assert.equal(plantB["Stationary Combustion"].status, "todo");
  const covered = plantB["Purchased Electricity"];
  assert.equal(covered.status, "covered");
  assert.equal(covered.filing, "yearly");
  assert.equal(covered.year_type, "FY");
  assert.deepEqual(covered.period, { start: "2025-04-01", end: "2026-03-31" });
  assert.equal(covered.entries.total, 0);

  const mar = await call("GET", "/user/my-month?month=2026-03", "multiSiteUser");
  const due = byName(mar.json.sites[1])["Purchased Electricity"];
  assert.equal(due.status, "approved");
  assert.equal(due.filing, "yearly");
  assert.equal(due.total_emission, 120);
});

test("months with monthly data in the same year are not hidden by a yearly filing elsewhere", async () => {
  const aug = await call("GET", "/user/my-month?month=2025-08", "multiSiteUser");
  const plantB = byName(aug.json.sites[1]);
  assert.equal(plantB["Stationary Combustion"].status, "approved");
  assert.equal(plantB["Stationary Combustion"].filing, "monthly");
});

test("only the caller's own sites appear", async () => {
  const res = await call("GET", "/user/my-month?month=2025-09", "otherUser");
  assert.deepEqual(res.json.sites.map((s) => s.site_id), [3]);
  assert.equal(res.json.sites[0].categories[0].status, "approved");
  const mine = await call("GET", "/user/my-month?month=2025-09", "user");
  assert.ok(!mine.json.sites.some((s) => s.site_id === 3));
});

test("validation, default month and role checks", async () => {
  assert.equal((await call("GET", "/user/my-month?month=2025-13", "user")).status, 400);
  assert.equal((await call("GET", "/user/my-month?month=Sept", "user")).status, 400);

  const def = await call("GET", "/user/my-month", "user");
  assert.equal(def.status, 200);
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  assert.equal(def.json.month, `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`);

  assert.equal((await call("GET", "/user/my-month?month=2025-09", "manager")).status, 200);
  assert.equal((await call("GET", "/user/my-month?month=2025-09", "admin")).status, 403);
  assert.equal((await call("GET", "/user/my-month?month=2025-09", "superadmin")).status, 403);
  assert.equal((await call("GET", "/user/my-month?month=2025-09", null)).status, 401);
});
