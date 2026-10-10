// P16: GET /admin/console — totals across every client, per-client entries
// entered this month, and recent bulk uploads, factor uploads and onboarding.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const BATCH = "ci-p16-console-batch";
const FACTOR_BATCH = "ci-p16-console-factors";

async function seed() {
  await withDb(async (db) => {
    await cleanup(db);
    // Two entries entered now from one bulk upload at site 3 (company 2): one pending, one approved.
    await db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by,
                             category_id, site_id, reporting_period, upload_batch_id, created_at)
       VALUES (9601, '{"activity_value": 1}', 1, 'tCO2e', '2025-09-30', 'pending', 4, 1, 3, 'monthly', $1, now() - interval '2 minutes'),
              (9602, '{"activity_value": 2}', 2, 'tCO2e', '2025-09-30', 'approved', 4, 1, 3, 'monthly', $1, now() - interval '2 minutes')`,
      [BATCH],
    );
    await db.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, upload_batch_id, created_at)
       VALUES (1, 1, 2025, 2.5, 'kWh', 'CI', 'CI P16 factor', $1, now() - interval '1 minute')`,
      [FACTOR_BATCH],
    );
    // Only company 2 has an onboarding date; the others predate the column.
    await db.query(`UPDATE company SET created_at = NULL`);
    await db.query(`UPDATE company SET created_at = now() WHERE company_id = 2`);
  });
}

async function cleanup(db) {
  await db.query(`DELETE FROM emission WHERE pk_id IN (9601, 9602)`);
  await db.query(`DELETE FROM emission_factors WHERE upload_batch_id = $1`, [FACTOR_BATCH]);
  await db.query(`UPDATE company SET created_at = NULL WHERE company_id = 2`);
}

test("Superadmin only", async () => {
  assert.equal((await call("GET", "/admin/console")).status, 401);
  for (const who of ["user", "manager", "admin"]) {
    assert.equal((await call("GET", "/admin/console", who)).status, 403, who);
  }
  assert.equal((await call("GET", "/admin/console?limit=0", "superadmin")).status, 400);
  assert.equal((await call("GET", "/admin/console?limit=abc", "superadmin")).status, 400);
});

test("totals, per-client month counts and activity", async () => {
  await seed();
  try {
    const res = await call("GET", "/admin/console", "superadmin");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const now = new Date();
    assert.equal(res.json.month, `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`);

    const expected = await withDb(async (db) => {
      const one = async (sql) => Number((await db.query(sql)).rows[0].n);
      return {
        clients: await one(`SELECT COUNT(*) n FROM company`),
        active_clients: await one(`SELECT COUNT(*) n FROM company WHERE status IS DISTINCT FROM false`),
        sites: await one(`SELECT COUNT(*) n FROM site`),
        users: await one(`SELECT COUNT(*) n FROM "user" WHERE role <> 'Superadmin'`),
        emission_factors: await one(`SELECT COUNT(*) n FROM emission_factors`),
        entries_this_month: await one(`SELECT COUNT(*) n FROM emission WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')`),
        pending_entries: await one(`SELECT COUNT(*) n FROM emission WHERE status = 'pending'`),
      };
    });
    assert.deepEqual(res.json.totals, expected);
    assert.ok(res.json.totals.entries_this_month >= 2);

    const company2 = res.json.clients.find((c) => c.company_id === 2);
    assert.ok(company2.entries_this_month >= 2);
    assert.ok(company2.pending_this_month >= 1);
    assert.ok(company2.pending >= company2.pending_this_month);
    // Fixture entries for company 1 were entered in 2025: none this month unless another test added some.
    const company1 = res.json.clients.find((c) => c.company_id === 1);
    assert.ok(company1.pending >= 2);

    const [first, second, third] = res.json.activity;
    assert.equal(first.kind, "onboarding");
    assert.equal(first.company_id, 2);
    assert.equal(typeof first.company_name, "string");
    assert.equal(first.rows, null);
    // Clients without an onboarding date are left out.
    assert.equal(res.json.activity.filter((a) => a.kind === "onboarding").length, 1);
    assert.equal(second.kind, "factor_upload");
    assert.equal(second.batch_id, FACTOR_BATCH);
    assert.equal(second.site_id, 1);
    assert.equal(second.company_id, 1);
    assert.equal(second.rows, 1);
    assert.equal(second.pending, null);
    assert.equal(third.kind, "bulk_upload");
    assert.equal(third.batch_id, BATCH);
    assert.equal(third.site_id, 3);
    assert.equal(third.company_id, 2);
    assert.equal(third.category_name, "Stationary Combustion");
    assert.equal(third.rows, 2);
    assert.equal(third.pending, 1);
    assert.equal(typeof third.by, "string");
    // Newest first.
    const times = res.json.activity.map((a) => a.at);
    assert.deepEqual(times, [...times].sort().reverse());

    const limited = await call("GET", "/admin/console?limit=2", "superadmin");
    assert.deepEqual(limited.json.activity.map((a) => a.kind), ["onboarding", "factor_upload"]);
  } finally {
    await withDb(cleanup);
  }
});
