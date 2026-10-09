// B2: User.appearance with get/update on the signed-in user.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

test("appearance defaults to system and shows on /auth/me", async () => {
  const res = await call("GET", "/auth/me/appearance", "user");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { appearance: "system" });

  const me = await call("GET", "/auth/me", "user");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.appearance, "system");
  assert.ok(!("password" in me.json.user));
});

test("PUT /auth/me/appearance validates and only changes the caller", async () => {
  assert.equal((await call("PUT", "/auth/me/appearance", "user", { appearance: "sepia" })).status, 400);
  assert.equal((await call("PUT", "/auth/me/appearance", "user", {})).status, 400);

  const saved = await call("PUT", "/auth/me/appearance", "user", { appearance: "dark" });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { appearance: "dark" });
  assert.equal((await call("GET", "/auth/me/appearance", "user")).json.appearance, "dark");

  // Other users are untouched, and nothing else on the row changed.
  assert.equal((await call("GET", "/auth/me/appearance", "manager")).json.appearance, "system");
  const row = await withDb((db) => db.query(`SELECT name, email, role, site_id FROM "user" WHERE user_id = 1`));
  assert.deepEqual(row.rows[0], { name: "CI User", email: "ci-user@example.invalid", role: "User", site_id: 1 });
});

test("every role can set its own appearance; anonymous cannot", async () => {
  for (const who of ["manager", "admin", "superadmin"]) {
    const res = await call("PUT", "/auth/me/appearance", who, { appearance: "light" });
    assert.equal(res.status, 200, who);
  }
  assert.equal((await call("GET", "/auth/me/appearance", null)).status, 401);
  assert.equal((await call("PUT", "/auth/me/appearance", null, { appearance: "dark" })).status, 401);
});
