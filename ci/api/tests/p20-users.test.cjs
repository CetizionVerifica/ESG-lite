// P20: the Superadmin Users list (/admin/users) with client, categories and
// last login, profile fields on create/update, and a one-time temporary
// password when an account is created without one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const cleanup = (emails) =>
  withDb((db) => db.query(`DELETE FROM "user" WHERE email = ANY($1)`, [emails]));

test("GET /admin/users carries client, categories and no password", async () => {
  const res = await call("GET", "/admin/users", "superadmin");
  assert.equal(res.status, 200);
  const multi = res.json.find((u) => u.user_id === 7);
  assert.deepEqual(
    multi.sites.map((s) => s.company).sort((a, b) => a.company_id - b.company_id),
    [
      { company_id: 1, name: "CI Steel Co" },
      { company_id: 1, name: "CI Steel Co" },
    ],
  );
  assert.deepEqual(multi.categories.map((c) => c.category_id).sort(), [1, 2]);
  const user = res.json.find((u) => u.user_id === 1);
  assert.deepEqual(user.site.company, { company_id: 1, name: "CI Steel Co" });
  assert.ok("last_login_at" in user);
  for (const u of res.json) assert.ok(!("password" in u), `password leaked for ${u.user_id}`);

  assert.equal((await call("GET", "/admin/users", "admin")).status, 403);
});

test("create without a password returns a temporary password once, and it logs in", async () => {
  const email = "p20-temp@example.invalid";
  await cleanup([email]);
  try {
    const res = await call("POST", "/admin/users", "superadmin", {
      name: "Temp",
      last_name: "Person",
      phone_number: " +971 50 000 0000 ",
      timezone: "Asia/Dubai",
      email: "P20-Temp@example.invalid",
      role: "User",
      site_ids: [1],
      category_ids: [1, 3, 99],
    });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(typeof res.json.temporary_password, "string");
    assert.ok(res.json.temporary_password.length >= 10);
    const u = res.json.user;
    assert.equal(u.email, email);
    assert.equal(u.last_name, "Person");
    assert.equal(u.phone_number, "+971 50 000 0000");
    assert.equal(u.timezone, "Asia/Dubai");
    // Only categories site 1 has; 99 is dropped.
    assert.deepEqual(u.categories.map((c) => c.category_id).sort(), [1, 3]);
    assert.equal(u.last_login_at, null);

    // Not returned again anywhere.
    const list = await call("GET", "/admin/users", "superadmin");
    const listed = list.json.find((x) => x.email === email);
    assert.ok(!("temporary_password" in listed));

    const login = await call("POST", "/auth/login", null, { email, password: res.json.temporary_password });
    assert.equal(login.status, 200);
    const after = await call("GET", "/admin/users", "superadmin");
    assert.ok(after.json.find((x) => x.email === email).last_login_at, "login sets last_login_at");

    // A given password is used as is and nothing is returned.
    const withPw = await call("POST", "/admin/users", "superadmin", {
      email: "p20-given@example.invalid",
      password: "Given-pass-1",
      role: "Admin",
      site_id: 1,
    });
    assert.equal(withPw.status, 201);
    assert.ok(!("temporary_password" in withPw.json));
  } finally {
    await cleanup([email, "p20-given@example.invalid"]);
  }
});

test("update sets profile fields and narrows categories within the person's sites", async () => {
  const email = "p20-edit@example.invalid";
  await cleanup([email]);
  try {
    const created = await call("POST", "/admin/users", "superadmin", {
      email,
      password: "Edit-pass-1",
      role: "Manager",
      site_ids: [1, 2],
    });
    assert.equal(created.status, 201);
    const id = created.json.user.user_id;
    assert.deepEqual(created.json.user.categories.map((c) => c.category_id).sort(), [1, 2, 3, 4, 5]);

    const res = await call("PATCH", `/admin/users/${id}`, "superadmin", {
      last_name: "Edited",
      timezone: "Europe/Rome",
      category_ids: [2, 4],
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.user.last_name, "Edited");
    assert.equal(res.json.user.timezone, "Europe/Rome");
    assert.deepEqual(res.json.user.categories.map((c) => c.category_id).sort(), [2, 4]);
    assert.deepEqual(res.json.user.sites.map((s) => s.site_id).sort(), [1, 2]);

    // Clearing optional text with "" stores null.
    const cleared = await call("PATCH", `/admin/users/${id}`, "superadmin", { last_name: "", timezone: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.user.last_name, null);
    assert.equal(cleared.json.user.timezone, null);

    assert.equal((await call("PATCH", `/admin/users/${id}`, "superadmin", { timezone: "Mars/Base" })).status, 400);
    assert.equal((await call("PATCH", `/admin/users/${id}`, "superadmin", { category_ids: 3 })).status, 400);
  } finally {
    await cleanup([email]);
  }
});

test("create still requires email and role", async () => {
  assert.equal((await call("POST", "/admin/users", "superadmin", { role: "User" })).status, 400);
  assert.equal((await call("POST", "/admin/users", "superadmin", { email: "x@example.invalid" })).status, 400);
});

test("removing someone with entries is refused with 409 and keeps them", async () => {
  const res = await call("DELETE", "/admin/users/1", "superadmin");
  assert.equal(res.status, 409);
  assert.match(res.json.message, /can't be removed/);
  const row = await withDb((db) => db.query(`SELECT user_id FROM "user" WHERE user_id = 1`));
  assert.equal(row.rows.length, 1);
});

test("removing someone without history works", async () => {
  const created = await call("POST", "/admin/users", "superadmin", { email: "p20-remove@example.invalid", role: "Admin" });
  assert.equal(created.status, 201);
  const res = await call("DELETE", `/admin/users/${created.json.user.user_id}`, "superadmin");
  assert.equal(res.status, 200);
});
