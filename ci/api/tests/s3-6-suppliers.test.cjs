// S3-6 · the supplier backfill (migrate:scope3-suppliers).
//
// Suppliers come from the two places a client already names them: the C06
// requests it has sent, and the `supplier_name` extra field on its own rows.
// What matters here is what the backfill must never do — merge two spellings,
// or let one company's supplier list reach another's.
//
// The migration runs as its own process, the way migrate-all runs it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const COMPILED = path.join(ROOT, "dist/scripts/createScope3SupplierTables.js");

// Ids well clear of ci/api/fixture.sql.
const FIRST_EMISSION = 96001;
const FIRST_REQUEST = 9601;
const EXACT = "Gulf Smelter Co.";
const SAME_FOLDED = "gulf smelter co.";
const DIFFERENT = "Gulf Smelter Company";

async function seed(db) {
  // A C06 request names a supplier and carries its email.
  await db.query(
    `INSERT INTO supplier_request
       (supplier_request_id, material, unit, supplier_name, supplier_email, subject, message,
        token_hash, token_expires_at, company_id)
     VALUES ($1, 'Aluminium ingot', 'kg', $2, 'data@gulfsmelter.example', 'Data request', 'Please share',
             's3-6-test-hash', now() + interval '30 days', 1)`,
    [FIRST_REQUEST, EXACT],
  );

  const rows = [
    { pk_id: FIRST_EMISSION, site: 1, name: EXACT },
    { pk_id: FIRST_EMISSION + 1, site: 1, name: SAME_FOLDED },
    { pk_id: FIRST_EMISSION + 2, site: 1, name: `  ${EXACT}  ` }, // padded: same supplier
    { pk_id: FIRST_EMISSION + 3, site: 1, name: DIFFERENT }, // similar, must stay separate
    { pk_id: FIRST_EMISSION + 4, site: 3, name: EXACT }, // company 2
    { pk_id: FIRST_EMISSION + 5, site: 1, name: null }, // no supplier named
  ];
  for (const row of rows) {
    await db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting,
                             category_id, site_id, extra_data)
       VALUES ($1, '{"activity_value": 1}', 1, 'kg', '2026-01-31', 3, $2, $3)`,
      [row.pk_id, row.site, row.name === null ? "{}" : JSON.stringify({ supplier_name: row.name })],
    );
  }
}

async function cleanUp(db) {
  await db.query(`DELETE FROM emission WHERE pk_id >= $1`, [FIRST_EMISSION]);
  await db.query(`DELETE FROM supplier_request WHERE supplier_request_id >= $1`, [FIRST_REQUEST]);
  await db.query(`DELETE FROM "supplier" WHERE lower(name) = ANY($1)`, [
    [EXACT.toLowerCase(), DIFFERENT.toLowerCase()],
  ]);
}

function runMigration() {
  const run = fs.existsSync(COMPILED)
    ? spawnSync(process.execPath, [COMPILED], { cwd: ROOT, env: process.env, encoding: "utf8" })
    : spawnSync("npm", ["run", "--silent", "migrate:scope3-suppliers"], {
        cwd: ROOT,
        env: process.env,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  assert.equal(run.status, 0, `migrate:scope3-suppliers failed:\n${output}`);
  return output;
}

const suppliersOf = async (db, company) => {
  const { rows } = await db.query(
    `SELECT supplier_id, name, email FROM "supplier" WHERE company_id = $1 ORDER BY supplier_id`,
    [company],
  );
  return rows;
};

test("the supplier backfill folds case, keeps companies apart and merges nothing", async (t) => {
  await withDb(async (db) => {
    await cleanUp(db);
    await seed(db);
    t.after(() => withDb(cleanUp));

    runMigration();

    // Company 1: one supplier for the three spellings that fold together, and
    // a separate one for the name that only looks similar.
    const company1 = await suppliersOf(db, 1);
    const names = company1.map((row) => row.name.toLowerCase()).sort();
    assert.deepEqual(names, [EXACT.toLowerCase(), DIFFERENT.toLowerCase()].sort(), "company 1 suppliers");

    const gulf = company1.find((row) => row.name.toLowerCase() === EXACT.toLowerCase());
    assert.equal(gulf.email, "data@gulfsmelter.example", "the email comes from the C06 request");

    // Company 2 names the same firm: it gets its own row, never company 1's.
    const company2 = await suppliersOf(db, 2);
    assert.equal(company2.length, 1, "company 2 has its own supplier");
    assert.notEqual(company2[0].supplier_id, gulf.supplier_id, "a supplier is never shared between companies");

    const { rows: linked } = await db.query(
      `SELECT pk_id, supplier_id FROM emission WHERE pk_id >= $1 ORDER BY pk_id`,
      [FIRST_EMISSION],
    );
    const byId = new Map(linked.map((row) => [Number(row.pk_id), row.supplier_id]));
    for (const pk of [FIRST_EMISSION, FIRST_EMISSION + 1, FIRST_EMISSION + 2]) {
      assert.equal(byId.get(pk), gulf.supplier_id, `row ${pk} links to the folded supplier`);
    }
    const different = company1.find((row) => row.name === DIFFERENT);
    assert.equal(byId.get(FIRST_EMISSION + 3), different.supplier_id, "the similar name keeps its own supplier");
    assert.equal(byId.get(FIRST_EMISSION + 4), company2[0].supplier_id, "company 2's row links within company 2");
    assert.equal(byId.get(FIRST_EMISSION + 5), null, "a row naming no supplier stays unlinked");

    // Run twice: nothing new, nothing moved.
    const second = runMigration();
    assert.match(second, /Created 0 supplier\(s\); linked 0 emission row\(s\)/, second);

    const afterSecond = await suppliersOf(db, 1);
    assert.deepEqual(
      afterSecond.map((row) => row.supplier_id),
      company1.map((row) => row.supplier_id),
      "a second run creates no duplicate supplier",
    );
  });
});
