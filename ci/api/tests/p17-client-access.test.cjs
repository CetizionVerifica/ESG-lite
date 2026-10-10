// P17 backend gaps: a deactivated client's people can't sign in or use a
// session they already hold, and onboarding can invite the admin by email
// instead of setting a password. CI has no Mailgun, so invites come back as
// "not sent" with a warning.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { call, withDb } = require("../helpers.cjs");

const onboard = async (email, extra = {}) => {
  const f = new FormData();
  f.append("companyName", `CI Access Co ${email}`);
  f.append("contactPerson", "Access Admin");
  f.append("email", email);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return call("POST", "/admin/onboarding/company", "superadmin", f);
};

const bearer = (payload) => ({ Authorization: `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}` });

test("a deactivated client's admin can't sign in or keep using a session; reactivating restores both", async () => {
  const email = "access-admin@ci.example";
  const created = await onboard(email, { password: "Access-pass-1" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const companyId = created.json.company.company_id;
  const session = bearer({ userId: created.json.admin.id, role: "Admin" });

  const login = await call("POST", "/auth/login", null, { email, password: "Access-pass-1" });
  assert.equal(login.status, 200);
  assert.equal((await call("GET", "/auth/me", null, undefined, session)).status, 200);

  const off = await call("PUT", `/admin/companies/${companyId}`, "superadmin", { status: false });
  assert.equal(off.status, 200);

  const refused = await call("POST", "/auth/login", null, { email, password: "Access-pass-1" });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.code, "CLIENT_INACTIVE");
  const blocked = await call("GET", "/auth/me", null, undefined, session);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, "CLIENT_INACTIVE");
  // A wrong password still reads as a wrong password, not as "inactive".
  assert.equal((await call("POST", "/auth/login", null, { email, password: "nope-nope" })).status, 401);

  // Other clients and the Superadmin are unaffected.
  assert.equal((await call("GET", "/auth/me", "admin")).status, 200);
  assert.equal((await call("GET", "/admin/companies", "superadmin")).status, 200);

  assert.equal((await call("PUT", `/admin/companies/${companyId}`, "superadmin", { status: true })).status, 200);
  assert.equal((await call("POST", "/auth/login", null, { email, password: "Access-pass-1" })).status, 200);
  assert.equal((await call("GET", "/auth/me", null, undefined, session)).status, 200);
});

test("status must be a boolean", async () => {
  assert.equal((await call("PUT", "/admin/companies/1", "superadmin", { status: "false" })).status, 400);
});

test("onboarding with sendInvite needs no password and creates an admin nobody can sign in as yet", async () => {
  const email = "invite-admin@ci.example";
  const res = await onboard(email, { sendInvite: "true" });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.invite, { sent: false });
  assert.deepEqual(res.json.warnings, ["Email isn't configured on this server, so the invite wasn't sent."]);

  const hash = await withDb(async (db) =>
    (await db.query(`SELECT password FROM "user" WHERE email = $1`, [email])).rows[0].password,
  );
  assert.match(hash, /^\$2[aby]\$/, "an unusable bcrypt hash, not an empty password");

  // Without sendInvite the password is still required.
  const missing = await onboard("invite-nopw@ci.example");
  assert.equal(missing.status, 400);
  assert.match(missing.json.message, /password/);
});

test("POST /admin/users/:id/invite: Superadmin only, 404 for unknown, 400 for a Superadmin, 503 without email", async () => {
  assert.equal((await call("POST", "/admin/users/1/invite", "admin")).status, 403);
  assert.equal((await call("POST", "/admin/users/999999/invite", "superadmin")).status, 404);
  assert.equal((await call("POST", "/admin/users/5/invite", "superadmin")).status, 400);
  const res = await call("POST", "/admin/users/1/invite", "superadmin");
  assert.equal(res.status, 503);
  assert.match(res.json.message, /Email isn't configured/);
});
