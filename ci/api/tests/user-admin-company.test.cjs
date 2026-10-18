// An Admin belongs to a company, not a site (user.company_id, migrate:user-company): the
// Superadmin's create and update, site-linked rows from the migration, the session and users
// list, and company Admin access. (KPI company-level ownership by Admin 3: kpi-d17-topics.)
//
// Fixture: company 1 (sites 1, 2), Admin 3 with company_id 1 and no site; company 2 (site 3);
// superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const EMAILS = ["uac-admin@example.invalid", "uac-legacy@example.invalid", "uac-none@example.invalid", "uac-promote@example.invalid"];
const cleanup = () => q(`DELETE FROM "user" WHERE email = ANY($1)`, [EMAILS]);
const row = async (email) => (await q(`SELECT user_id, role, site_id, company_id, (SELECT count(*)::int FROM user_sites us WHERE us.user_id = u.user_id) AS n_sites FROM "user" u WHERE email = $1`, [email]))[0];

test.before(cleanup);
test.after(cleanup);

test("the fixture Admin works for their company without a site", async () => {
  const me = await call("GET", "/auth/me", "admin");
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const user = me.json.user ?? me.json;
  assert.equal(user.company?.company_id, 1, JSON.stringify(user).slice(0, 300));
  assert.equal(user.site ?? null, null);
  // Company Admin routes and company-wide site scope still answer.
  assert.equal((await call("GET", "/company-admin/users", "admin")).status, 200);
  const list = await call("GET", "/admin/users", "superadmin");
  const admin = list.json.find((u) => u.user_id === 3);
  assert.deepEqual(admin.company, { company_id: 1, name: "CI Steel Co" });
  assert.equal(admin.site, null);
});

test("Superadmin creates an Admin for a client: company_id, or the company of an older client's site_id", async () => {
  const made = await call("POST", "/admin/users", "superadmin", { email: EMAILS[0], name: "UAC Admin", role: "Admin", company_id: 1 });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(await row(EMAILS[0]), { user_id: (await row(EMAILS[0])).user_id, role: "Admin", site_id: null, company_id: 1, n_sites: 0 });
  assert.equal(made.json.user.company.company_id, 1);

  const legacy = await call("POST", "/admin/users", "superadmin", { email: EMAILS[1], role: "Admin", site_id: 3 });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.json));
  const l = await row(EMAILS[1]);
  assert.deepEqual([l.company_id, l.site_id], [2, null], "the site's company, not the site");

  const none = await call("POST", "/admin/users", "superadmin", { email: EMAILS[2], role: "Admin" });
  assert.equal(none.status, 400);
  assert.equal(none.json.field, "company_id");
  assert.equal((await call("POST", "/admin/users", "superadmin", { email: EMAILS[2], role: "Admin", company_id: 999999 })).status, 400, "unknown company");
});

test("promoting to Admin keeps the company and drops the sites; demoting drops the company", async () => {
  const made = await call("POST", "/admin/users", "superadmin", { email: EMAILS[3], role: "Manager", site_ids: [1, 2] });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.user.user_id;
  const up = await call("PATCH", `/admin/users/${id}`, "superadmin", { role: "Admin" });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  let r = await row(EMAILS[3]);
  assert.deepEqual([r.role, r.company_id, r.site_id, r.n_sites], ["Admin", 1, null, 0]);
  // Moving the Admin to another client.
  assert.equal((await call("PATCH", `/admin/users/${id}`, "superadmin", { company_id: 2 })).status, 200);
  assert.equal((await row(EMAILS[3])).company_id, 2);
  // Back to Manager of site 3: their company comes from the site again.
  assert.equal((await call("PATCH", `/admin/users/${id}`, "superadmin", { role: "Manager", site_ids: [3] })).status, 200);
  r = await row(EMAILS[3]);
  assert.deepEqual([r.role, r.company_id, r.n_sites], ["Manager", null, 1]);
});

test("migrate:user-company gives site-linked Admins their site's company, clears the site, twice clean", async () => {
  const [{ user_id }] = await q(
    `INSERT INTO "user" (name, email, password, role, site_id) VALUES ('UAC Old', $1, 'x', 'Admin', 3) RETURNING user_id`,
    [EMAILS[2]],
  );
  const run = () => spawnSync(process.execPath, [path.join(ROOT, "dist/scripts/addUserCompanyColumn.js")], { cwd: ROOT, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.deepEqual(await q(`SELECT company_id, site_id FROM "user" WHERE user_id = $1`, [user_id]), [{ company_id: 2, site_id: null }]);
  // Managers and Users keep their sites.
  assert.equal((await q(`SELECT site_id FROM "user" WHERE user_id = 1`))[0].site_id, 1);
  const second = run();
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stdout, /0 Admin\(s\) given their site's company; 0 Admin site link\(s\) cleared/);
});
