// A bulk approve or reject of several people's entries tells each person about
// their own entries only. The email can't be read here (no broker in CI), so
// this checks the in-app notification queued beside it, which takes the same
// per-person count. Each test restores what it changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const latest = async (userId, type) =>
  (await q("SELECT message FROM notification WHERE user_id=$1 AND type=$2 ORDER BY id DESC LIMIT 1", [userId, type]))[0]?.message;

// Entry 2 is CI User's (site 1), entry 11 is CI Multi User's (site 2): both pending, both the CI Manager's sites.
const restore = async () => {
  await q("UPDATE emission SET status='pending', reviewed_by=NULL, reviewed_at=NULL, review_comment=NULL WHERE pk_id IN (2, 11)");
  await q("DELETE FROM notification WHERE user_id IN (1, 7) AND type IN ('BULK_APPROVED', 'BULK_REJECTED')");
  await q("DELETE FROM audit_log WHERE entity_type='emission' AND entity_id = ANY($1::bigint[])", [[2, 11]]);
};

test("bulk approve: each person is told about their own entries, not the whole selection", async () => {
  try {
    const r = await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [2, 11] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(await latest(1, "BULK_APPROVED"), /^1 emission\(s\) approved by CI Manager/);
    assert.match(await latest(7, "BULK_APPROVED"), /^1 emission\(s\) approved by CI Manager/);
  } finally {
    await restore();
  }
});

test("bulk reject: each person is told about their own entries, with the reason", async () => {
  try {
    const r = await call("PUT", "/user/emissions/bulk-reject", "manager", { ids: [2, 11], comment: "Check the unit" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(await latest(1, "BULK_REJECTED"), /^1 emission\(s\) rejected by CI Manager\. Reason: Check the unit/);
    assert.match(await latest(7, "BULK_REJECTED"), /^1 emission\(s\) rejected by CI Manager\. Reason: Check the unit/);
  } finally {
    await restore();
  }
});
