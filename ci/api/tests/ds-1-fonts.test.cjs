// DS-1 GET /studio/fonts/:file: the bundled WOFF2 faces behind the studio
// guard. Switch off → 403 DS_STUDIO_OFF for every role; Users → 403 DS_ROLE;
// Admins, Managers and Superadmins (naming the company) get the file with an
// immutable cache header; unknown names and path tricks → 404; another
// company's id → 404; no token → 401.
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setStudio } = require("./ds-lib.cjs");

const FILE = "/studio/fonts/source-sans-3-400.woff2";

test.before(async () => {
  await setStudio(1, false);
  await setStudio(2, false);
});
test.after(async () => {
  await setStudio(1, false);
  await setStudio(2, false);
});

test("switch off: every role gets 403 DS_STUDIO_OFF", async () => {
  for (const who of ["user", "manager", "admin"]) {
    const r = await call("GET", FILE, who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "DS_STUDIO_OFF", who);
  }
  const sa = await call("GET", `${FILE}?company_id=1`, "superadmin");
  assert.equal(sa.status, 403);
  assert.equal(sa.json.code, "DS_STUDIO_OFF");
  assert.equal((await call("GET", FILE)).status, 401);
});

test("switch on: Admins, Managers and Superadmins get the WOFF2; Users get DS_ROLE", async () => {
  await setStudio(1, true);
  try {
    for (const [who, url] of [["manager", FILE], ["admin", FILE], ["superadmin", `${FILE}?company_id=1`]]) {
      const r = await call("GET", url, who);
      assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
      assert.match(r.headers.get("content-type"), /font\/woff2/);
      assert.match(r.headers.get("cache-control"), /immutable/);
      assert.equal(r.buffer.subarray(0, 4).toString("latin1"), "wOF2", who);
      assert.ok(r.buffer.length > 10000, who);
    }
    for (const f of ["fraunces-600.woff2", "dm-serif-display-400.woff2", "noto-sans-700.woff2", "ibm-plex-serif-400.woff2", "archivo-700.woff2"]) {
      assert.equal((await call("GET", `/studio/fonts/${f}`, "manager")).status, 200, f);
    }
    const user = await call("GET", FILE, "user");
    assert.equal(user.status, 403);
    assert.equal(user.json.code, "DS_ROLE");
  } finally {
    await setStudio(1, false);
  }
});

test("only bundled names are served: anything else is 404", async () => {
  await setStudio(1, true);
  try {
    for (const f of ["comic-sans-400.woff2", "source-sans-3-900.woff2", "dm-serif-display-700.woff2", "..%2F..%2Fpackage.json", "source-sans-3-400.woff", "%2Fetc%2Fpasswd"]) {
      const r = await call("GET", `/studio/fonts/${f}`, "manager");
      assert.equal(r.status, 404, f);
    }
  } finally {
    await setStudio(1, false);
  }
});

test("tenant isolation: another company's manager can't use company 1's switch", async () => {
  await setStudio(1, true);
  try {
    const r = await call("GET", `${FILE}?company_id=1`, "otherManager");
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
    // Company 2's own switch is off.
    const own = await call("GET", FILE, "otherManager");
    assert.equal(own.status, 403);
    assert.equal(own.json.code, "DS_STUDIO_OFF");
  } finally {
    await setStudio(1, false);
  }
});
