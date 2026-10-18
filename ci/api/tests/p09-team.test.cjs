// P09 Team access: a manager's team is the contributors (role User) on their
// sites. Admins and other managers on those sites are not listed, and their
// category access can't be read or changed from here (bug 8).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test("the Team list holds only contributors on the manager's sites", async () => {
  // Fixture: manager 2 has sites 1 and 2; on site 1 are User 1, Admin 3 and User 7.
  // Give Manager 6 (site 3) site 1 as well, so a fellow manager shares a site too.
  await q("INSERT INTO user_sites (user_id, site_id) VALUES (6, 1) ON CONFLICT DO NOTHING");
  try {
    const res = await call("GET", "/manager/users", "manager");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.map((u) => u.user_id), [1, 7]);
    assert.ok(res.json.every((u) => u.role === "User"));
  } finally {
    await q("DELETE FROM user_sites WHERE user_id = 6 AND site_id = 1");
  }
});

test("a manager can't read or change an Admin's or another manager's category access", async () => {
  await q("INSERT INTO user_sites (user_id, site_id) VALUES (6, 1) ON CONFLICT DO NOTHING");
  const before = await q("SELECT user_id, category_id FROM user_categories WHERE user_id IN (3, 6) ORDER BY 1, 2");
  try {
    for (const id of [3, 6]) {
      const read = await call("GET", `/manager/users/${id}/categories`, "manager");
      assert.equal(read.status, 403, `read ${id}`);
      // An Admin is no one's site colleague (they belong to the company), another Manager isn't a User.
      assert.match(read.json.message, /User role|not on your sites/);
      const write = await call("PUT", `/manager/users/${id}/categories`, "manager", { category_ids: [] });
      assert.equal(write.status, 403, `write ${id}`);
    }
    assert.deepEqual(await q("SELECT user_id, category_id FROM user_categories WHERE user_id IN (3, 6) ORDER BY 1, 2"), before);
  } finally {
    await q("DELETE FROM user_sites WHERE user_id = 6 AND site_id = 1");
  }
});

test("a manager still reads and changes a contributor's category access", async () => {
  const before = await q("SELECT category_id FROM user_categories WHERE user_id = 7 ORDER BY 1");
  try {
    const read = await call("GET", "/manager/users/7/categories", "manager");
    assert.equal(read.status, 200);
    assert.equal(read.json.user_id, 7);
    const write = await call("PUT", "/manager/users/7/categories", "manager", { category_ids: [1] });
    assert.equal(write.status, 200, JSON.stringify(write.json));
    assert.deepEqual((await q("SELECT category_id FROM user_categories WHERE user_id = 7")).map((r) => r.category_id), [1]);
    // Someone not on the manager's sites stays out of reach (User 4, site 3),
    // and a manager elsewhere gets the same answer, so their role isn't revealed.
    assert.equal((await call("GET", "/manager/users/4/categories", "manager")).status, 403);
    const elsewhere = await call("GET", "/manager/users/6/categories", "manager");
    assert.equal(elsewhere.status, 403);
    assert.match(elsewhere.json.message, /not on your sites/);
  } finally {
    await q("DELETE FROM user_categories WHERE user_id = 7");
    for (const r of before) await q("INSERT INTO user_categories (user_id, category_id) VALUES (7, $1)", [r.category_id]);
  }
});

test("the team's internal accounts are not on a client manager's Team page", async () => {
  // User 7 is a contributor on the manager's sites 1 and 2; mark it internal.
  await q('UPDATE "user" SET is_internal = true WHERE user_id = 7');
  try {
    const list = await call("GET", "/manager/users", "manager");
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((u) => u.user_id), [1]);
    const read = await call("GET", "/manager/users/7/categories", "manager");
    assert.equal(read.status, 403);
    assert.match(read.json.message, /User role/);
    assert.equal((await call("PUT", "/manager/users/7/categories", "manager", { category_ids: [] })).status, 403);
  } finally {
    await q('UPDATE "user" SET is_internal = false WHERE user_id = 7');
  }
});
