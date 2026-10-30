// Unit tests for strict id parsing in the scope guards: an id the guard can't
// read must refuse the request, never slip past it to a handler that reads it
// differently (parseInt "7x" = 7; Postgres 16 "1_0" = 10).
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { strictId, strictIdList } = require(path.resolve("dist/utils/ids.js"));
const scope = require(path.resolve("dist/middlewares/scope.middleware.js"));
const { auditReview, guardApprovedDelete } = require(path.resolve("dist/middlewares/audit.middleware.js"));
const { guardPeriodOpen } = require(path.resolve("dist/scope3/review/guard.js"));

const MALFORMED = ["7x", "7.5", 7.5, "1e3", "1_0", "0x7", "", " ", "-3", -3, 0, "0", true, null, {}, [], "9007199254740993", " 7", "﻿7"];

test("strictId accepts whole positive numbers and digit-only strings", () => {
  assert.equal(strictId(7), 7);
  assert.equal(strictId("7"), 7);
  assert.equal(strictId(" 42 "), 42);
  assert.equal(strictId("007"), 7);
});

test("strictId refuses everything a lenient parser would misread", () => {
  for (const v of MALFORMED) assert.equal(strictId(v), null, JSON.stringify(v));
});

test("strictIdList reads arrays, comma lists and repeated query keys", () => {
  assert.deepEqual(strictIdList(undefined), []);
  assert.deepEqual(strictIdList(""), []);
  assert.deepEqual(strictIdList([1, "2"]), [1, 2]);
  assert.deepEqual(strictIdList("1, 2"), [1, 2]);
  assert.deepEqual(strictIdList(["1,2", "3"]), [1, 2, 3]);
});

test("blank and placeholder entries are skipped, as before: no reader takes them for a row", () => {
  assert.deepEqual(strictIdList("1,"), [1]);
  assert.deepEqual(strictIdList("1,,2"), [1, 2]);
  assert.deepEqual(strictIdList(","), []);
  assert.deepEqual(strictIdList("undefined"), []);
  assert.deepEqual(strictIdList([1, null, "NaN", "null"]), [1]);
});

test("one bad entry makes the whole list null", () => {
  assert.equal(strictIdList([5, "7x"]), null);
  assert.equal(strictIdList("1,9x"), null);
  assert.equal(strictIdList([5, "1_0"]), null);
});

// The guards answer 400 before any database read, so they run without one.
const outcome = ({ status, nextCalled }) => ({ status, nextCalled });
const run = async (guard, req) => {
  let status = null;
  let nextCalled = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  const r = { user: { userId: 1, role: "User" }, params: {}, query: {}, body: {}, ...req };
  await guard(r, res, () => { nextCalled = true; });
  return { status, nextCalled, req: r };
};

test("body id lists with a malformed id are refused (bulk delete, approve, reject)", async () => {
  for (const ids of [["7x"], [5, "7x"], [7.9], ["1e3"], [5, "1_0"]]) {
    for (const guard of [scope.guardEmissionIds, scope.guardEmissionIdsReview("approve"), scope.guardProductionIdsReview]) {
      assert.deepEqual(outcome(await run(guard, { body: { ids } })), { status: 400, nextCalled: false }, JSON.stringify(ids));
    }
  }
});

test("a path id must be exactly one whole number", async () => {
  for (const id of ["7x", "7,8", "1_0", "undefined"]) {
    assert.deepEqual(outcome(await run(scope.guardEmissionParam(), { params: { id } })), { status: 400, nextCalled: false }, id);
  }
});

test("query site ids with a malformed entry are refused", async () => {
  for (const query of [{ siteIds: "9x" }, { siteIds: "1,9x" }, { siteId: "1_0" }, { site_id: "9.0" }]) {
    assert.deepEqual(outcome(await run(scope.guardQuerySites("siteIds"), { query })), { status: 400, nextCalled: false }, JSON.stringify(query));
  }
});

test("body site ids with a malformed entry are refused", async () => {
  assert.deepEqual(outcome(await run(scope.guardBodySites("siteIds"), { body: { siteIds: [1, "1_0"] } })), { status: 400, nextCalled: false });
  assert.deepEqual(outcome(await run(scope.guardBodySites("site_id"), { body: { site_id: "1_0" } })), { status: 400, nextCalled: false });
  assert.deepEqual(outcome(await run(scope.guardBodySites("site_id"), { body: { site_id: "1,2" } })), { status: 400, nextCalled: false });
  assert.deepEqual(outcome(await run(scope.guardBodyEntrySites, { body: { entries: [{ site_id: 1 }, { site_id: "9x" }] } })), { status: 400, nextCalled: false });
});

test("path site and company ids are checked strictly, Superadmins included", async () => {
  const superadmin = { userId: 1, role: "Superadmin" };
  assert.deepEqual(outcome(await run(scope.guardSiteParam("siteId"), { user: superadmin, params: { siteId: "9x" } })), { status: 400, nextCalled: false });
  assert.deepEqual(outcome(await run(scope.guardCompanyParam("companyId"), { user: superadmin, params: { companyId: "1_0" } })), { status: 400, nextCalled: false });
});

test("an empty body id list still reaches the handler, which reports it", async () => {
  assert.deepEqual(outcome(await run(scope.guardEmissionIds, { body: {} })), { status: null, nextCalled: true });
});

test("audit history names one record: a list can't pass as its allowed member", async () => {
  for (const entity_id of ["999,5", ["999", "5"], "5x"]) {
    const r = await run(scope.guardAuditEntity, { query: { entity_type: "emission", entity_id } });
    assert.deepEqual(outcome(r), { status: 400, nextCalled: false }, JSON.stringify(entity_id));
  }
});

test("the period lock and the audit trail refuse ids they can't read instead of skipping them", async () => {
  for (const guard of [guardPeriodOpen("ids"), auditReview("emission", "ids"), guardApprovedDelete("emission", "ids")]) {
    assert.deepEqual(outcome(await run(guard, { body: { ids: [5, "7x"] } })), { status: 400, nextCalled: false });
  }
  for (const guard of [guardPeriodOpen("param"), auditReview("emission", "param")]) {
    assert.deepEqual(outcome(await run(guard, { params: { id: "7,8" } })), { status: 400, nextCalled: false });
  }
});

test("checked ids reach the handler as numbers, in the shape they were sent", async () => {
  const superadmin = { userId: 1, role: "Superadmin" };
  let r = await run(scope.guardBodySites("siteIds"), { user: superadmin, body: { siteIds: ["1", " 2"] } });
  assert.deepEqual(r.req.body.siteIds, [1, 2]);
  r = await run(scope.guardBodySites("site_id"), { user: superadmin, body: { site_id: "007" } });
  assert.equal(r.req.body.site_id, 7);
  r = await run(scope.guardQuerySites(), { user: superadmin, query: { siteIds: "1, 2,", siteId: " 3" } });
  assert.deepEqual([r.req.query.siteIds, r.req.query.siteId], ["1,2", "3"]);
  r = await run(scope.guardBodyEntrySites, { user: superadmin, body: { entries: [{ site_id: "4" }, { site_id: undefined }] } });
  assert.deepEqual(r.req.body.entries.map((e) => e.site_id), [4, undefined]);
});

test("one site where one is named: site_id and siteId refuse a list", async () => {
  assert.deepEqual(outcome(await run(scope.guardQuerySites(), { query: { siteId: "1,2" } })), { status: 400, nextCalled: false });
  assert.deepEqual(outcome(await run(scope.guardBodyEntrySites, { body: { entries: [{ site_id: "1,2" }] } })), { status: 400, nextCalled: false });
});
