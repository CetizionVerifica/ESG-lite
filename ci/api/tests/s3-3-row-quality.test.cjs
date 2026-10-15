// S3-3 · the method backfill (migrate:scope3-row-quality).
//
// The module spec asks for "the backfill run twice" as an API test: every
// branch of the backfill lands on the method the spec names, Scope 1 and
// Scope 2 rows keep a null method, a row that already names a method is never
// overwritten, and a second run changes nothing.
//
// The migration is run as its own process, the way migrate-all does it, so
// this covers the script that production will run rather than a copy of its
// SQL.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const COMPILED = path.join(ROOT, "dist/scripts/addEmissionRowQualityColumns.js");

// Ids well clear of ci/api/fixture.sql so the fixture's own rows stay as they are.
const PER_UNIT_CATEGORY = 9301;
const PER_METHOD_CATEGORY = 9302;
const PLAIN_CATEGORY = 9303;
const SCOPE1_CATEGORY = 9304;
const FIRST_EMISSION = 93001;

const ROWS = [
  { pk_id: FIRST_EMISSION, category_id: PER_UNIT_CATEGORY, unit: "tonne.km", activity_data_unit: "tonne.km", method: null, expected: "distance_based" },
  { pk_id: FIRST_EMISSION + 1, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "Tonne KM", method: null, expected: "distance_based" },
  { pk_id: FIRST_EMISSION + 2, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "km", method: null, expected: "distance_based" },
  // A currency wins over the form: a per_unit form priced in money is spend-based.
  { pk_id: FIRST_EMISSION + 3, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "usd", method: null, expected: "spend_based" },
  { pk_id: FIRST_EMISSION + 4, category_id: PLAIN_CATEGORY, unit: "INR", activity_data_unit: null, method: null, expected: "spend_based" },
  { pk_id: FIRST_EMISSION + 5, category_id: PER_METHOD_CATEGORY, unit: "kg", activity_data_unit: null, method: null, expected: "direct_use" },
  { pk_id: FIRST_EMISSION + 6, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, method: null, expected: "average_data" },
  // No site, so no form to read: still a Scope 3 row and still gets a method.
  { pk_id: FIRST_EMISSION + 7, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, site: null, method: null, expected: "average_data" },
  // Scope 1 is not a Scope 3 idea.
  { pk_id: FIRST_EMISSION + 8, category_id: SCOPE1_CATEGORY, unit: "kwh", activity_data_unit: null, method: null, expected: null },
  // Already answered: the backfill must leave it alone.
  { pk_id: FIRST_EMISSION + 9, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, method: "supplier_specific", expected: "supplier_specific" },
];

async function seed(db) {
  await db.query(
    `INSERT INTO category (category_id, category_name, scope) VALUES
       ($1, 'S3-3 transport form', 'Scope 3'),
       ($2, 'S3-3 use of sold form', 'Scope 3'),
       ($3, 'S3-3 no form', 'Scope 3'),
       ($4, 'S3-3 scope 1', 'Scope 1')
     ON CONFLICT (category_id) DO NOTHING`,
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY, PLAIN_CATEGORY, SCOPE1_CATEGORY],
  );
  // Two forms for the same site × category: the backfill must read the first
  // one and must not multiply the row.
  await db.query(
    `INSERT INTO column_config (config_name, site_id, category_id, calculation) VALUES
       ('s3-3 per_unit', 1, $1, '{"mode":"per_unit","methods":{}}'),
       ('s3-3 per_unit twin', 1, $1, '{"mode":"per_method","methods":{}}'),
       ('s3-3 per_method', 1, $2, '{"mode":"per_method","methods":{}}')`,
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY],
  );
  for (const row of ROWS) {
    await db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, activity_data_unit,
                             date_of_reporting, category_id, site_id, method)
       VALUES ($1, '{"activity_value": 1}', 1, $2, $3, '2026-01-31', $4, $5, $6)`,
      [row.pk_id, row.unit, row.activity_data_unit, row.category_id, row.site === null ? null : 1, row.method],
    );
  }
}

async function cleanUp(db) {
  await db.query(`DELETE FROM emission WHERE pk_id >= $1`, [FIRST_EMISSION]);
  await db.query(`DELETE FROM column_config WHERE category_id = ANY($1)`, [[PER_UNIT_CATEGORY, PER_METHOD_CATEGORY]]);
  await db.query(`DELETE FROM category WHERE category_id = ANY($1)`, [
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY, PLAIN_CATEGORY, SCOPE1_CATEGORY],
  ]);
}

function runMigration() {
  const run = fs.existsSync(COMPILED)
    ? spawnSync(process.execPath, [COMPILED], { cwd: ROOT, env: process.env, encoding: "utf8" })
    : spawnSync("npm", ["run", "--silent", "migrate:scope3-row-quality"], {
        cwd: ROOT,
        env: process.env,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  assert.equal(run.status, 0, `migrate:scope3-row-quality failed:\n${output}`);
  const backfilled = /Backfilled method on (\d+) Scope 3 emission row\(s\)/.exec(output);
  assert.ok(backfilled, `migration did not report its backfill:\n${output}`);
  return Number(backfilled[1]);
}

const methodsById = async (db) => {
  const { rows } = await db.query(`SELECT pk_id, method, is_estimate, dq, data_type FROM emission WHERE pk_id >= $1`, [
    FIRST_EMISSION,
  ]);
  return new Map(rows.map((row) => [Number(row.pk_id), row]));
};

test("the method backfill reads the form and the unit, and runs twice unchanged", async (t) => {
  await withDb(async (db) => {
    await cleanUp(db);
    await seed(db);
    t.after(() => withDb(cleanUp));

    const firstPass = runMigration();
    // Every seeded Scope 3 row without a method, plus any fixture Scope 3 row
    // the suite has not already backfilled.
    assert.ok(firstPass >= 8, `expected at least the 8 seeded rows, got ${firstPass}`);

    const afterFirst = await methodsById(db);
    for (const row of ROWS) {
      assert.equal(afterFirst.get(row.pk_id).method, row.expected, `row ${row.pk_id}`);
    }

    // New columns are additive: nothing else is written by the backfill.
    for (const row of ROWS) {
      const stored = afterFirst.get(row.pk_id);
      assert.equal(stored.is_estimate, false, `row ${row.pk_id} is_estimate`);
      assert.equal(stored.dq, null, `row ${row.pk_id} dq`);
      assert.equal(stored.data_type, null, `row ${row.pk_id} data_type`);
    }

    const secondPass = runMigration();
    assert.equal(secondPass, 0, "a second run must have nothing left to backfill");

    const afterSecond = await methodsById(db);
    for (const row of ROWS) {
      assert.equal(afterSecond.get(row.pk_id).method, row.expected, `row ${row.pk_id} after the second run`);
    }
  });
});
