// Two people entering the same site, category and month (CI User and CI Multi
// User both enter site 1 / Stationary Combustion). Sent at the same moment,
// only one is saved and the others get the duplicate answer; the answer says
// who entered the saved row; a User can't Replace someone else's entry or an
// approved one. Each test removes what it creates.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const MONTH = "2025-03-31"; // nothing filed for site 1 / category 1 in March 2025
const diesel = (litres) => ({
  site_id: 1, category_id: 1, activity_data: { activity_value: litres, emission_category: "Diesel" }, activity_data_unit: "litre",
  date_of_reporting: MONTH, reporting_period: "monthly",
});
const saved = () => q("SELECT pk_id, created_by, status FROM emission WHERE site_id=1 AND category_id=1 AND date_of_reporting=$1 ORDER BY pk_id", [MONTH]);

// March 2025 entries take the 2024 factor (year N−1).
test.before(() => q(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id)
                     VALUES (951, 'Diesel', 2.68, 'litre', 2024, 1, 1)`));
test.after(() => q("DELETE FROM emission_factors WHERE emission_factor_id = 951"));
const cleanUp = async () => {
  const ids = (await q("SELECT pk_id FROM emission WHERE site_id=1 AND date_of_reporting=$1", [MONTH])).map((r) => r.pk_id);
  if (ids.length) {
    await q("DELETE FROM emission WHERE fera_linked_id = ANY($1::bigint[])", [ids]);
    await q("DELETE FROM emission WHERE pk_id = ANY($1::bigint[])", [ids]);
    await q("DELETE FROM audit_log WHERE entity_type='emission' AND entity_id = ANY($1::bigint[])", [ids]);
  }
};

test("the same entry sent by two people at the same moment is saved once", async () => {
  try {
    const sends = await Promise.all([
      call("POST", "/user/emissions", "user", diesel(100)),
      call("POST", "/user/emissions", "multiSiteUser", diesel(100)),
      call("POST", "/user/emissions", "user", diesel(100)),
      call("POST", "/user/emissions", "multiSiteUser", diesel(100)),
      call("POST", "/user/emissions", "user", diesel(100)),
      call("POST", "/user/emissions", "multiSiteUser", diesel(100)),
    ]);
    const statuses = sends.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409], JSON.stringify(sends.map((r) => [r.status, r.json?.message])));
    assert.equal((await saved()).length, 1);
    for (const r of sends.filter((r) => r.status === 409)) assert.equal(r.json.duplicate, true);
  } finally {
    await cleanUp();
  }
});

test("the duplicate answer names who entered the saved row, and only by name", async () => {
  try {
    assert.equal((await call("POST", "/user/emissions", "user", diesel(100))).status, 201);
    const other = await call("POST", "/user/emissions", "multiSiteUser", diesel(120));
    assert.equal(other.status, 409);
    assert.deepEqual(other.json.entered_by, { name: "CI User", you: false });
    assert.equal(other.json.can_replace, false);
    assert.deepEqual(Object.keys(other.json.existing_emission.created_by).sort(), ["last_name", "name", "user_id"]);
    assert.equal(other.json.existing_emission.created_by.email, undefined);

    const mine = await call("POST", "/user/emissions", "user", diesel(130));
    assert.equal(mine.status, 409);
    assert.deepEqual(mine.json.entered_by, { name: "CI User", you: true });
    assert.equal(mine.json.can_replace, true);
  } finally {
    await cleanUp();
  }
});

test("a User can't Replace someone else's entry; Keep both still works", async () => {
  try {
    assert.equal((await call("POST", "/user/emissions", "user", diesel(100))).status, 201);
    const [first] = await saved();

    const replace = await call("POST", "/user/emissions?replace=true", "multiSiteUser", diesel(120));
    assert.equal(replace.status, 403);
    assert.equal(replace.json.code, "REPLACE_NOT_ALLOWED");
    assert.match(replace.json.message, /Someone else entered this/);
    assert.deepEqual((await saved()).map((r) => r.pk_id), [first.pk_id], "the colleague's entry is still there, nothing new");

    const keep = await call("POST", "/user/emissions?keep_both=true", "multiSiteUser", diesel(120));
    assert.equal(keep.status, 201);
    assert.equal((await saved()).length, 2);
  } finally {
    await cleanUp();
  }
});

test("a User can't Replace their own approved entry, but can replace their own pending one", async () => {
  try {
    assert.equal((await call("POST", "/user/emissions", "user", diesel(100))).status, 201);
    const [first] = await saved();

    const own = await call("POST", "/user/emissions?replace=true", "user", diesel(110));
    assert.equal(own.status, 201, "own pending entry: replaced as before");
    const [second] = await saved();
    assert.notEqual(second.pk_id, first.pk_id);

    await q("UPDATE emission SET status='approved' WHERE pk_id=$1", [second.pk_id]);
    const approved = await call("POST", "/user/emissions?replace=true", "user", diesel(120));
    assert.equal(approved.status, 403);
    assert.match(approved.json.message, /already approved/);
    assert.deepEqual((await saved()).map((r) => [r.pk_id, r.status]), [[second.pk_id, "approved"]]);
  } finally {
    await cleanUp();
  }
});

test("a Manager can still Replace a User's entry", async () => {
  try {
    assert.equal((await call("POST", "/user/emissions", "user", diesel(100))).status, 201);
    const asked = await call("POST", "/user/emissions", "manager", diesel(140));
    assert.equal(asked.status, 409);
    assert.equal(asked.json.can_replace, true);
    assert.equal((await call("POST", "/user/emissions?replace=true", "manager", diesel(140))).status, 201);
    const rows = await saved();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].created_by), 2);
  } finally {
    await cleanUp();
  }
});

test("a save waits only a few seconds for another save, upload or import on the site and category", async () => {
  try {
    await withDb(async (db) => {
      // Another writer holds site 1 / category 1 (the lock uploads and imports take).
      await db.query("SELECT pg_advisory_lock(1, 1)");
      try {
        const started = Date.now();
        const busy = await call("POST", "/user/emissions", "user", diesel(100));
        assert.equal(busy.status, 409, JSON.stringify(busy.json));
        assert.equal(busy.json.code, "ENTRY_BUSY");
        assert.match(busy.json.message, /Try again/);
        assert.ok(Date.now() - started < 15_000, "the wait is bounded");
        assert.equal((await saved()).length, 0, "nothing written");
      } finally {
        await db.query("SELECT pg_advisory_unlock(1, 1)");
      }
    });
    assert.equal((await call("POST", "/user/emissions", "user", diesel(100))).status, 201, "once it's free the save goes through");
  } finally {
    await cleanUp();
  }
});
