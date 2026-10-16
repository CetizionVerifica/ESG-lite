// S3-13 Scope 3 reporting: GET /reports/ghg/scope3 (shape, kg-then-round
// totals, Unmapped row, exclusion reasons, approved rows only, tenant
// isolation as /reports/ghg) and the PDF still renders with the Scope 3 pages.
//
// Fixture: company 1 has Scope 3 categories 3 "Business Travel" and 5 "FERA"
// on site 1; company 2 (site 3) has none. Rows here use pk_id 81300–81399.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");

const YEAR = 2031; // a year no other test writes to

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM emission WHERE pk_id BETWEEN 81300 AND 81399`);
    await db.query(`DELETE FROM company_scope3_category WHERE company_id IN (1, 2)`);
    await db.query(`UPDATE category SET ghg_category = NULL WHERE category_id IN (3, 5)`);
    await db.query(`UPDATE company SET consolidation_approach = 'operational_control' WHERE company_id = 1`);
  });

const insert = (db, id, categoryId, tonnes, status = "approved", snapshot = null) =>
  db.query(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, category_id, site_id, emission_factor_snapshot)
     VALUES ($1, '{"activity_value": 1}', $2, 'tCO2e', $3, $4, $5, 1, $6)`,
    [id, tonnes, `${YEAR}-03-01`, status, categoryId, snapshot],
  );

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await db.query(`UPDATE category SET ghg_category = 6 WHERE category_id = 3`); // Business Travel → Cat 6; FERA stays unmapped
    const snap = { emission_factor_id: 1, emission_category_name: "Air", factor_value: 0.25, denominator_unit: "km", source: "DEFRA", year: 2025, factor_type: "life_cycle", gwp_set: "AR6", geography: "GB", dataset: "DEFRA", dataset_version: "2025" };
    await insert(db, 81300, 3, 1.25, "approved", JSON.stringify(snap));
    await insert(db, 81301, 3, 0.75, "approved", JSON.stringify(snap));
    await insert(db, 81302, 3, 100, "pending"); // not approved: never counted
    await insert(db, 81303, 5, 2, "approved"); // Unmapped
    await insert(db, 81304, 1, 50, "approved"); // Scope 1: never in Scope 3
  });
});
test.after(reset);

const q = `siteIds=1&year=${YEAR}&yearType=CY`;

test("GET /reports/ghg/scope3: 15 categories + Unmapped, approved Scope 3 rows only, kg then round", async () => {
  const r = await call("GET", `/reports/ghg/scope3?${q}`, "user");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const body = r.json;
  assert.equal(body.company_id, 1);
  assert.equal(body.consolidation_approach, "operational_control");
  assert.equal(body.period.label, `CY${YEAR}`);
  assert.equal(body.rows.length, 16);
  assert.equal(body.total_tco2e, 4);
  const cat6 = body.rows.find((x) => x.n === 6);
  assert.equal(cat6.name, "Business travel");
  assert.equal(cat6.tco2e, 2);
  assert.equal(cat6.share_pct, 50);
  assert.deepEqual(cat6.datasets, [{ dataset: "DEFRA", version: "2025", factor_type: "life_cycle" }]);
  assert.deepEqual(cat6.gwp_sets, ["AR6"]);
  assert.deepEqual(body.gwp_sets, ["AR6"]);
  assert.deepEqual(cat6.mapped_categories, [{ category_id: 3, name: "Business Travel" }]);
  const un = body.rows[15];
  assert.equal(un.n, null);
  assert.equal(un.name, "Unmapped");
  assert.equal(un.tco2e, 2);
  assert.deepEqual(un.mapped_categories, [{ category_id: 5, name: "FERA" }]);
  // Every row has the §5 fields.
  for (const k of ["n", "name", "direction", "status", "reason", "method_note", "tco2e", "share_pct", "methods", "primary_pct", "value_chain_pct", "proxy_pct", "dq", "datasets", "gwp_sets", "biogenic_tco2e", "mapped_categories"]) {
    assert.ok(k in cat6, k);
  }
  assert.equal(typeof body.tracked.biogenic, "boolean");
});

test("excluded and not relevant categories carry their reasons", async () => {
  await withDb((db) =>
    db.query(
      `UPDATE company_scope3_category SET status = 'excluded', reason = 'Customers collect at the gate' WHERE company_id = 1 AND ghg_category = 9`,
    ),
  );
  const r = await call("GET", `/reports/ghg/scope3?${q}`, "manager");
  assert.equal(r.status, 200);
  const nine = r.json.rows.find((x) => x.n === 9);
  assert.equal(nine.status, "excluded");
  assert.equal(nine.reason, "Customers collect at the gate");
  const thirteen = r.json.rows.find((x) => x.n === 13);
  assert.equal(thirteen.status, "not_relevant"); // D10 default
  assert.match(thirteen.reason, /No leased-out assets/);
});

test("boundary approach comes from the company setting", async () => {
  await withDb((db) => db.query(`UPDATE company SET consolidation_approach = 'financial_control' WHERE company_id = 1`));
  const r = await call("GET", `/reports/ghg/scope3/1?${q}`, "admin");
  assert.equal(r.status, 200);
  assert.equal(r.json.consolidation_approach, "financial_control");
});

test("tenant isolation: company 2 callers can't read company 1's Scope 3", async () => {
  assert.equal((await call("GET", `/reports/ghg/scope3?${q}`, "otherUser")).status, 403);
  assert.equal((await call("GET", `/reports/ghg/scope3?${q}`, "otherManager")).status, 403);
  assert.equal((await call("GET", `/reports/ghg/scope3/1?siteIds=3&year=${YEAR}`, "otherManager")).status, 403);
  // A company 2 site under company 1's path is refused, as on /reports/ghg.
  assert.equal((await call("GET", `/reports/ghg/scope3/1?siteIds=3&year=${YEAR}`, "superadmin")).status, 400);
  assert.equal((await call("GET", `/reports/ghg/scope3?${q}`)).status, 401);
});

test("filters: a category filter narrows the rows; bad month is a 400 like /reports/ghg", async () => {
  const r = await call("GET", `/reports/ghg/scope3?${q}&categoryIds=5`, "user");
  assert.equal(r.status, 200);
  assert.equal(r.json.total_tco2e, 2);
  assert.equal(r.json.rows.find((x) => x.n === 6).tco2e, 0);
  assert.equal((await call("GET", `/reports/ghg/scope3?${q}&frequency=monthly&month=13`, "user")).status, 400);
  const march = await call("GET", `/reports/ghg/scope3?${q}&frequency=monthly&month=3`, "user");
  assert.equal(march.json.total_tco2e, 4);
  const april = await call("GET", `/reports/ghg/scope3?${q}&frequency=monthly&month=4`, "user");
  assert.equal(april.json.total_tco2e, 0);
});

test("a company with no Scope 3 gets no boundary rows seeded by the report (Scope 1/2 PDFs unchanged)", async () => {
  const r = await call("GET", `/reports/ghg/scope3?siteIds=3&year=${YEAR}`, "otherManager");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.total_tco2e, 0);
  assert.ok(r.json.rows.every((x) => x.mapped_categories.length === 0));
  const seeded = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM company_scope3_category WHERE company_id = 2`));
  assert.equal(seeded.rows[0].n, 0);
});

test("a category filter also narrows the included activities", async () => {
  const r = await call("GET", `/reports/ghg/scope3?${q}&categoryIds=5`, "user");
  assert.deepEqual(r.json.rows.find((x) => x.n === 6).mapped_categories, []);
  assert.deepEqual(r.json.rows[15].mapped_categories, [{ category_id: 5, name: "FERA" }]);
});

test("golden report cases (ci/golden/scope3/report.json): category totals = Σ case kg / 1000", async () => {
  const fs = require("fs");
  const path = require("path");
  const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../golden/scope3/report.json"), "utf8"));
  const cases = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../golden/scope3/cases.json"), "utf8")).cases;
  const kgOf = (id) => cases.find((c) => c.id === id).expected_kgco2e;
  const year = YEAR + 1;
  for (const rc of golden.cases.filter((c) => c.status === "run")) {
    let pk = 81350;
    let cat = 81350;
    await withDb(async (db) => {
      for (const [n, ids] of Object.entries(rc.categories)) {
        const categoryId = cat++;
        await db.query(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, $2, 'Scope 3', $3)`, [categoryId, `CI S3-13 golden ${n}`, Number(n)]);
        await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (1, $1)`, [categoryId]);
        for (const id of ids) {
          await db.query(
            `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, category_id, site_id)
             VALUES ($1, '{}', $2, 'tCO2e', $3, 'approved', $4, 1)`,
            [pk++, kgOf(id) / 1000, `${year}-06-01`, categoryId],
          );
        }
      }
    });
    try {
      const r = await call("GET", `/reports/ghg/scope3?siteIds=1&year=${year}`, "user");
      assert.equal(r.status, 200, JSON.stringify(r.json));
      for (const [n, t] of Object.entries(rc.expected_tco2e)) {
        if (n === "scope3") assert.equal(r.json.total_tco2e, t, `${rc.id} Scope 3`);
        else assert.equal(r.json.rows.find((x) => x.n === Number(n)).tco2e, t, `${rc.id} Cat ${n}`);
      }
    } finally {
      await withDb(async (db) => {
        await db.query(`DELETE FROM emission WHERE pk_id BETWEEN 81350 AND 81399`);
        await db.query(`DELETE FROM site_categories WHERE category_id BETWEEN 81350 AND 81399`);
        await db.query(`DELETE FROM category WHERE category_id BETWEEN 81350 AND 81399`);
      });
    }
  }
});
