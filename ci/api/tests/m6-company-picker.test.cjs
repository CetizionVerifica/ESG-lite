// M6: a person with sites at several clients picks the company in the account menu; the app sends
// it as X-Company-Id. The server honours it only for a company the person belongs to.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const as = (company) => (company === undefined ? {} : { "X-Company-Id": String(company) });
const brandName = async (who, company) => (await call("GET", "/brands/mine", who, undefined, as(company))).json?.name;

test.before(async () => {
  // multiSiteUser has sites 1 + 2 (company 1); site 3 makes them work for company 2 as well.
  await withDb((db) => db.query("INSERT INTO user_sites (user_id, site_id) VALUES (7, 3) ON CONFLICT DO NOTHING"));
});

test.after(async () => {
  await withDb((db) => db.query("DELETE FROM user_sites WHERE user_id = 7 AND site_id = 3"));
});

test("the chosen company is used where the person belongs to it", async () => {
  assert.equal(await brandName("multiSiteUser"), "CI Steel", "no choice: the first site's company, as before");
  assert.equal(await brandName("multiSiteUser", 2), "CI Other Co");
  assert.equal(await brandName("multiSiteUser", 1), "CI Steel");
  const kpi = await call("GET", "/kpi/status", "multiSiteUser", undefined, as(2));
  assert.equal(kpi.status, 200, JSON.stringify(kpi.json));
});

test("a company the person doesn't belong to, or a malformed header, is ignored", async () => {
  for (const header of [99, 0, -2, "2abc", "1,2", ""]) {
    assert.equal(await brandName("multiSiteUser", header), "CI Steel", `header ${JSON.stringify(header)}`);
  }
  // A one-company user can't borrow another company by naming it.
  assert.equal(await brandName("user", 2), "CI Steel");
  assert.equal(await brandName("otherUser", 1), "CI Other Co");
  // An Admin stays in their own company.
  assert.equal(await brandName("admin", 2), "CI Steel");
});

test("the choice never widens site access", async () => {
  const other = await call("GET", "/user/emissions?siteIds=3", "user", undefined, as(2));
  assert.equal(other.status, 403);
});
