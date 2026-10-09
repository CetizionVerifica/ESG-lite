// Site access on entry and document reads, and no password hashes in any
// response. Users and Managers see their own sites, company Admins their
// company's, Superadmins everything.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { call, withDb } = require("../helpers.cjs");

const sitesOf = (rows) => [...new Set(rows.map((r) => r.site.site_id))].sort();
const noSecrets = (json) => {
  const text = JSON.stringify(json);
  assert.ok(!text.includes('"password"'), "response carries a password field");
  assert.ok(!text.includes("password_reset"), "response carries a reset token field");
};

test("/user/emissions: only the caller's sites, 403 for anyone else's", async () => {
  const expected = { user: [1], multiSiteUser: [1, 2], manager: [1, 2], admin: [1, 2], otherUser: [3] };
  for (const [who, sites] of Object.entries(expected)) {
    const all = await call("GET", "/user/emissions", who);
    assert.equal(all.status, 200, who);
    assert.deepEqual(sitesOf(all.json), sites, who);
    noSecrets(all.json);

    const paged = await call("GET", "/user/emissions?page=1&limit=50", who);
    assert.equal(paged.status, 200, who);
    assert.deepEqual(sitesOf(paged.json.data), sites, who);
    assert.equal(paged.json.total, paged.json.data.length, who);
  }
  assert.deepEqual(sitesOf((await call("GET", "/user/emissions", "superadmin")).json), [1, 2, 3]);

  assert.equal((await call("GET", "/user/emissions?siteIds=3", "user")).status, 403);
  assert.equal((await call("GET", "/user/emissions?siteIds=1,3&page=1&limit=10", "manager")).status, 403);
  assert.equal((await call("GET", "/user/emissions?siteId=2", "user")).status, 403);
  assert.equal((await call("GET", "/user/emissions?siteIds=2", "multiSiteUser")).status, 200);
  assert.equal((await call("GET", "/user/emissions?siteIds=3", "superadmin")).status, 200);
});

test("other emission reads check the site", async () => {
  assert.equal((await call("GET", "/user/emissions/site/3/category/1", "user")).status, 403);
  assert.equal((await call("GET", "/user/emissions/site/1/category/1", "user")).status, 200);

  const pending = await call("GET", "/user/emissions/pending", "manager");
  assert.equal(pending.status, 200);
  assert.ok(pending.json.length > 0);
  assert.ok(pending.json.every((r) => [1, 2].includes(r.site.site_id)));
  noSecrets(pending.json);
  assert.equal((await call("GET", "/user/emissions/pending?siteId=3", "manager")).status, 403);
  assert.ok((await call("GET", "/user/emissions/pending", "otherManager")).json.every((r) => r.site.site_id === 3));

  assert.equal((await call("GET", "/user/emissions/download?siteId=3&year=2025", "user")).status, 403);
});

test("the monthly export checks the site like the year export", async () => {
  assert.equal((await call("GET", "/user/emissions/export?siteIds=3&year=2025&month=9", "user")).status, 403);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1,3&year=2025&month=9", "admin")).status, 403);
  const own = await call("GET", "/user/emissions/export?siteIds=1&year=2025&month=9", "user");
  assert.equal(own.status, 200);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=3&year=2025&month=9", "superadmin")).status, 200);
});

test("documents: only the caller's sites or own uploads; no password hashes", async () => {
  // 901 on a site-1 entry, 902 on a site-3 entry, 903 with no entry uploaded by user 4.
  await withDb((db) =>
    db.query(`INSERT INTO emission_document (document_id, file_name, original_name, cloudinary_public_id, cloudinary_url, file_type, emission_id, uploaded_by) VALUES
      (901, 'a.pdf', 'a.pdf', 'ci/a', 'https://x.invalid/a', 'application/pdf', 1, 1),
      (902, 'b.pdf', 'b.pdf', 'ci/b', 'https://x.invalid/b', 'application/pdf', 8, 4),
      (903, 'c.pdf', 'c.pdf', 'ci/c', 'https://x.invalid/c', 'application/pdf', NULL, 4)`),
  );
  try {
    const ids = async (who) => (await call("GET", "/user/documents", who)).json.map((d) => d.document_id).sort();
    assert.deepEqual(await ids("user"), [901]);
    assert.deepEqual(await ids("admin"), [901]);
    assert.deepEqual(await ids("otherUser"), [902, 903]);
    assert.deepEqual(await ids("superadmin"), [901, 902, 903]);

    const list = await call("GET", "/user/documents", "user");
    assert.equal(list.json[0].uploaded_by.user_id, 1);
    noSecrets(list.json);

    assert.equal((await call("GET", "/user/documents/902", "user")).status, 404);
    const own = await call("GET", "/user/documents/901", "user");
    assert.equal(own.status, 200);
    noSecrets(own.json);
    assert.deepEqual((await call("GET", "/user/documents/emission/8", "user")).json, []);
    assert.equal((await call("GET", "/user/documents/emission/8", "otherUser")).json.length, 1);

    assert.equal((await call("PUT", "/user/documents/902", "user", { description: "x" })).status, 404);
    assert.equal((await call("PUT", "/user/documents/901", "user", { emission_id: 8 })).status, 404);
    assert.equal((await call("DELETE", "/user/documents/902", "user")).status, 404);

    const bulk = await call("DELETE", "/user/documents/bulk-delete", "user", { ids: [902, 903] });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.json.deleted, 0);
    const left = await withDb((db) => db.query("SELECT document_id FROM emission_document WHERE document_id IN (901, 902, 903) ORDER BY 1"));
    assert.deepEqual(left.rows.map((r) => r.document_id), [901, 902, 903]);
  } finally {
    await withDb((db) => db.query("DELETE FROM emission_document WHERE document_id IN (901, 902, 903)"));
  }
});

test("login and session responses carry no password hash", async () => {
  const hash = await bcrypt.hash("ci-login-check", 4);
  await withDb((db) => db.query(`UPDATE "user" SET password = $1 WHERE user_id = 1`, [hash]));
  try {
    const ok = await call("POST", "/auth/login", null, { email: "ci-user@example.invalid", password: "ci-login-check" });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.equal(ok.json.user.user_id, 1);
    noSecrets(ok.json);

    const bad = await call("POST", "/auth/login", null, { email: "ci-user@example.invalid", password: "wrong" });
    assert.equal(bad.status, 401);
  } finally {
    await withDb((db) => db.query(`UPDATE "user" SET password = 'x' WHERE user_id = 1`));
  }
});
