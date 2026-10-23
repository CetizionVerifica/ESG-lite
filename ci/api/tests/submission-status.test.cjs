// GET /manager/submission-status counts what a User filed for the caller's sites only, without
// automatic FERA twins, and names only the caller's sites (bug hunt 23 Oct 2026, issue 2).
// Counts are compared before and after adding rows, so other tests' rows don't matter.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const status = async (who, month) => {
  const res = await call("GET", `/manager/submission-status?month=${month}`, who);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return new Map(res.json.users.map((u) => [u.user_id, u]));
};
const count = async (who, month, userId) => (await status(who, month)).get(userId)?.submission_count;
const entry = (pk, { createdBy, site, category = 1, date, linked = null }) =>
  q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, fera_linked_id)
     VALUES ($1, '{"activity_value": 1}', 1, 'tCO2e', $2, 'pending', $3, $4, $5, 'monthly', $6)`,
    [pk, date, createdBy, category, site, linked],
  );
const IDS = [9301, 9302, 9303, 9304, 9305, 9306];
const cleanUp = () => q("DELETE FROM emission WHERE pk_id = ANY($1)", [IDS]);

test("an automatic FERA twin isn't an entry of its own; a FERA row typed in is", async () => {
  const before = await count("manager", "2023-03", 1);
  // Diesel at Plant A with its twin (category 5 is FERA), plus a FERA row entered by hand.
  await entry(9301, { createdBy: 1, site: 1, date: "2023-03-31", linked: 9302 });
  await entry(9302, { createdBy: 1, site: 1, category: 5, date: "2023-03-31", linked: 9301 });
  await entry(9303, { createdBy: 1, site: 1, category: 5, date: "2023-03-15" });
  try {
    const user = (await status("manager", "2023-03")).get(1);
    assert.equal(user.submission_count, before + 2);
    assert.equal(user.status, "submitted");
    assert.equal(user.site_name, "CI Plant A");
  } finally {
    await cleanUp();
  }
});

test("filing for another site doesn't count, and that site's name isn't shown", async () => {
  // CI Multi User also works on company 2's plant, and files April 2023 for Plant A only.
  await q("INSERT INTO user_sites (user_id, site_id) VALUES (7, 3)");
  try {
    const otherBefore = await count("otherManager", "2023-04", 7);
    const ownBefore = await count("manager", "2023-04", 7);
    await entry(9304, { createdBy: 7, site: 1, date: "2023-04-30" });

    const other = (await status("otherManager", "2023-04")).get(7);
    assert.equal(other.submission_count, otherBefore, "nothing more was filed for CI Other Plant");
    assert.equal(other.site_name, "CI Other Plant", "company 1's plants stay hidden from company 2");

    const own = (await status("manager", "2023-04")).get(7);
    assert.equal(own.submission_count, ownBefore + 1);
    assert.equal(own.status, "submitted");
    assert.equal(own.site_name, "CI Plant A, CI Plant B", "both of the manager's plants, in site order");
    // The company Admin (M5) reads the same.
    assert.equal(await count("admin", "2023-04", 7), ownBefore + 1);
  } finally {
    await cleanUp();
    await q("DELETE FROM user_sites WHERE user_id = 7 AND site_id = 3");
  }
});

test("the month runs from its first to its last calendar day", async () => {
  const may = await count("manager", "2023-05", 7);
  const june = await count("manager", "2023-06", 7);
  await entry(9305, { createdBy: 7, site: 2, date: "2023-05-31" });
  await entry(9306, { createdBy: 7, site: 2, date: "2023-06-01" });
  try {
    assert.equal(await count("manager", "2023-05", 7), may + 1);
    assert.equal(await count("manager", "2023-06", 7), june + 1);
  } finally {
    await cleanUp();
  }
  assert.equal((await call("GET", "/manager/submission-status?month=2023-5", "manager")).status, 400);
});
