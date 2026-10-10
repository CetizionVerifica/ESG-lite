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

test("a deactivated client's notification stream is ended and can't be reopened", async () => {
  const created = await onboard("stream-admin@ci.example", { password: "Stream-pass-1" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const companyId = created.json.company.company_id;
  const token = jwt.sign({ userId: created.json.admin.id, role: "Admin" }, process.env.JWT_SECRET);
  const url = `${process.env.API_BASE}/notifications/stream?token=${token}`;

  const open = await fetch(url);
  assert.equal(open.status, 200);
  const reader = open.body.getReader();
  await reader.read(); // the initial unread count
  const ended = (async () => {
    for (;;) if ((await reader.read()).done) return true;
  })();

  assert.equal((await call("PUT", `/admin/companies/${companyId}`, "superadmin", { status: false })).status, 200);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 5000));
  assert.equal(await Promise.race([ended, timeout]), true, "the open stream ends on deactivation");

  const again = await call("GET", `/notifications/stream?token=${token}`, null);
  assert.equal(again.status, 403);
  assert.equal(again.json.code, "CLIENT_INACTIVE");
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

test("a client with reporting history can't be deleted: 409 with the counts", async () => {
  const res = await call("DELETE", "/admin/companies/1", "superadmin");
  assert.equal(res.status, 409);
  assert.equal(res.json.code, "CLIENT_HAS_HISTORY");
  assert.ok(res.json.history.entries > 0);
  assert.match(res.json.message, /^This client has reporting history \(\d+ entr/);
  assert.equal((await call("GET", "/admin/companies", "superadmin")).json.some((c) => c.company_id === 1), true);
  assert.equal((await call("DELETE", "/admin/companies/999999", "superadmin")).status, 404);
  assert.equal((await call("DELETE", "/admin/companies/abc", "superadmin")).status, 400);
  assert.equal((await call("DELETE", "/admin/companies/1", "admin")).status, 403);
});

async function deleteWithoutHistory() {
  const created = await onboard("delete-admin@ci.example", { password: "Delete-pass-1" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const companyId = created.json.company.company_id;
  const siteId = created.json.site.site_id;
  const adminId = created.json.admin.id;

  const shared = await withDb(async (db) => {
    // A second site, a person who also works at client 1 (kept, unlinked) and
    // one whose own site is here but who manages a client-1 site (kept too).
    const s2 = (await db.query(
      `INSERT INTO site (name, address, contact_person, company_id) VALUES ('Delete Plant 2', 'x', 'x', $1) RETURNING site_id`,
      [companyId],
    )).rows[0].site_id;
    const both = (await db.query(
      `INSERT INTO "user" (name, email, password, role) VALUES ('Both', 'delete-both@ci.example', 'x', 'Manager') RETURNING user_id`,
    )).rows[0].user_id;
    await db.query(`INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2), ($1, 1)`, [both, s2]);
    const own = (await db.query(
      `INSERT INTO "user" (name, email, password, role, site_id) VALUES ('Own', 'delete-own@ci.example', 'x', 'User', $1) RETURNING user_id`,
      [siteId],
    )).rows[0].user_id;
    await db.query(`INSERT INTO user_sites (user_id, site_id) VALUES ($1, 2)`, [own]);
    // A Superadmin linked only to this client's site is never deleted with it.
    const admin = (await db.query(
      `INSERT INTO "user" (name, email, password, role, site_id) VALUES ('Super', 'delete-super@ci.example', 'x', 'Superadmin', $1) RETURNING user_id`,
      [siteId],
    )).rows[0].user_id;
    await db.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name) VALUES ($1, 'Delete Co', $2, 1, 'Fuel here', 'Fuel')`,
      [companyId, siteId],
    );
    await db.query(`INSERT INTO brand (company_id, name) VALUES ($1, 'Delete Co')`, [companyId]);
    return { both, own, admin };
  });

  const res = await call("DELETE", `/admin/companies/${companyId}`, "superadmin");
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json.removed, { sites: 2, people: 1, mappings: 1, brand: true });

  await withDb(async (db) => {
    const left = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
    assert.equal(await left(`SELECT count(*) AS n FROM company WHERE company_id = $1`, [companyId]), 0);
    assert.equal(await left(`SELECT count(*) AS n FROM site WHERE company_id = $1`, [companyId]), 0);
    assert.equal(await left(`SELECT count(*) AS n FROM "user" WHERE user_id = $1`, [adminId]), 0);
    assert.equal(await left(`SELECT count(*) AS n FROM brand WHERE company_id = $1`, [companyId]), 0);
    assert.equal(await left(`SELECT count(*) AS n FROM emission_category_mapping WHERE company_id = $1`, [companyId]), 0);
    const both = (await db.query(`SELECT site_id FROM user_sites WHERE user_id = $1`, [shared.both])).rows.map((r) => r.site_id);
    assert.deepEqual(both, [1]);
    // A kept person whose own site was here moves to a site they still have.
    const own = (await db.query(`SELECT site_id FROM "user" WHERE user_id = $1`, [shared.own])).rows;
    assert.deepEqual(own, [{ site_id: 2 }]);
    const admin = (await db.query(`SELECT site_id FROM "user" WHERE user_id = $1`, [shared.admin])).rows;
    assert.deepEqual(admin, [{ site_id: null }]);
  });
}

test("deleting a client without history removes its setup and only its own people", async () => {
  // The extra people are linked to client 1's sites; never leave them behind
  // for the reminder tests.
  try {
    await deleteWithoutHistory();
  } finally {
    await withDb((db) => db.query(`DELETE FROM "user" WHERE email IN ('delete-both@ci.example', 'delete-own@ci.example', 'delete-super@ci.example')`));
  }
});
