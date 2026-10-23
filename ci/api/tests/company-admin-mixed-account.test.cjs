// An older account can still hold two clients' sites (new ones can't: p20-users). Company 1's
// Admin sees and changes only company 1's sites of it; company 2's stay, unseen (bug hunt 23 Oct
// 2026, issue 4). Sites 1 and 2 are company 1's, site 3 company 2's.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const ID = 970;
const sitesOf = async () => (await q("SELECT site_id FROM user_sites WHERE user_id = $1 ORDER BY site_id", [ID])).map((r) => r.site_id);
const cleanUp = async () => {
  await q("DELETE FROM user_sites WHERE user_id = $1", [ID]);
  await q("DELETE FROM user_categories WHERE user_id = $1", [ID]);
  await q(`DELETE FROM "user" WHERE user_id = $1`, [ID]);
};

test.before(async () => {
  await cleanUp();
  await q(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES ($1, 'CI Mixed', 'ci-mixed@example.invalid', 'x', 'User', NULL)`, [ID]);
  await q("INSERT INTO user_sites (user_id, site_id) VALUES ($1, 1), ($1, 3)", [ID]);
});
test.after(cleanUp);

test("the company Admin's list shows only their company's sites of an older mixed account", async () => {
  const list = await call("GET", "/company-admin/users", "admin");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const mixed = list.json.find((u) => u.user_id === ID);
  assert.deepEqual(mixed.sites.map((s) => s.site_id), [1]);
  assert.ok(!JSON.stringify(mixed).includes("CI Other Plant"), "company 2's site name never reaches company 1's Admin");
});

test("the company Admin changes their own sites of it; the other client's site stays", async () => {
  const added = await call("PATCH", `/company-admin/users/${ID}`, "admin", { site_ids: [1, 2] });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.deepEqual(added.json.user.sites.map((s) => s.site_id).sort(), [1, 2]);
  assert.deepEqual(await sitesOf(), [1, 2, 3]);
  // Naming another company's site is still refused.
  assert.equal((await call("PATCH", `/company-admin/users/${ID}`, "admin", { site_ids: [1, 3] })).status, 403);
  assert.deepEqual(await sitesOf(), [1, 2, 3]);

  // Taking them off every company 1 site leaves company 2's, and they're no longer the Admin's.
  assert.equal((await call("PATCH", `/company-admin/users/${ID}`, "admin", { site_ids: [] })).status, 200);
  assert.deepEqual(await sitesOf(), [3]);
  const cats = (await q("SELECT category_id FROM user_categories WHERE user_id = $1", [ID])).map((r) => r.category_id);
  assert.deepEqual(cats, [1], "site 3's category stays with it");
  assert.equal((await call("PATCH", `/company-admin/users/${ID}`, "admin", { name: "Renamed" })).status, 404);
});
