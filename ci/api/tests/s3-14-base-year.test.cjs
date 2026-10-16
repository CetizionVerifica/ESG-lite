// S3-14 base year and recalculation: GET/PUT /scope3/base-year,
// GET/POST /scope3/recalculations and dismiss. Freeze, the role matrix,
// tenant isolation, BASE_YEAR_NO_DATA, RECALCULATION_REASON_REQUIRED, one
// open proposal, approve re-freezes without touching emission rows, a
// dismissed proposal is not raised again, and the migration runs twice.
//
// Fixture: company 1 (sites 1, 2), company 2 (site 3). Category 3 "Business
// Travel" (Scope 3) is set to Category 6 here. Rows use pk_id 81400–81499 in
// 2012 and 2013, years no other test writes to.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const BASE = 2012;

const reset = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM emission WHERE pk_id BETWEEN 81400 AND 81499`);
    await db.query(`DELETE FROM recalculation_event WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM company_base_year WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM audit_log WHERE entity_type IN ('scope3_base_year', 'scope3_recalculation')`);
    await db.query(`UPDATE category SET ghg_category = NULL WHERE category_id = 3`);
    await db.query(`UPDATE site SET lease_role = NULL, lease_type = NULL WHERE site_id IN (1, 2, 3)`);
  });

const insert = (db, id, tonnes, year = BASE, status = "approved") =>
  db.query(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, category_id, site_id)
     VALUES ($1, '{"activity_value": 1}', $2, 'tCO2e', $3, $4, 3, 1)`,
    [id, tonnes, `${year}-05-01`, status],
  );

test.before(async () => {
  await reset();
  await withDb(async (db) => {
    await db.query(`UPDATE category SET ghg_category = 6 WHERE category_id = 3`);
    await insert(db, 81400, 6);
    await insert(db, 81401, 4);
    await insert(db, 81402, 50, BASE, "pending"); // never frozen
    await insert(db, 81410, 3, BASE + 1);
  });
});
test.after(reset);

const emissionTotals = () =>
  withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_emission), 0)::float AS t FROM emission`)).rows[0]);

test("GET before any freeze: no base year, any role with access", async () => {
  const r = await call("GET", "/scope3/base-year", "user");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.base_year, null);
  assert.equal(r.json.can_edit, false);
  assert.equal((await call("GET", "/scope3/base-year", "admin")).json.can_edit, true);
});

test("PUT: Admin and Superadmin only; a year without approved Scope 3 rows is BASE_YEAR_NO_DATA", async () => {
  assert.equal((await call("PUT", "/scope3/base-year", "manager", { base_year: BASE })).status, 403);
  assert.equal((await call("PUT", "/scope3/base-year", "user", { base_year: BASE })).status, 403);
  const empty = await call("PUT", "/scope3/base-year", "admin", { base_year: BASE - 1 });
  assert.equal(empty.status, 422);
  assert.equal(empty.json.code, "BASE_YEAR_NO_DATA");
  assert.equal((await call("PUT", "/scope3/base-year", "admin", { base_year: "x" })).status, 400);
  assert.equal((await call("PUT", "/scope3/base-year", "admin", { base_year: BASE, significance_pct: 101 })).status, 400);
  assert.equal((await call("PUT", "/scope3/base-year", "admin", { base_year: BASE, scope: "Scope 1" })).status, 400);
  assert.equal((await call("PUT", "/scope3/base-year", "admin", { base_year: new Date().getFullYear() + 1 })).status, 400);
});

test("preview shows what a freeze would store, without saving", async () => {
  const r = await call("GET", `/scope3/base-year/preview?base_year=${BASE}`, "manager");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.total_tco2e, 10);
  assert.equal(r.json.categories.find((c) => c.n === 6).tco2e, 10);
  assert.equal(r.json.rows, 2);
  assert.equal((await call("GET", `/scope3/base-year/preview?base_year=${BASE - 1}`, "admin")).json.code, "BASE_YEAR_NO_DATA");
  assert.equal((await call("GET", "/scope3/base-year/preview?base_year=abc", "admin")).status, 400);
  assert.equal((await call("GET", `/scope3/base-year/preview?base_year=${BASE}&company_id=1`, "otherManager")).status, 404);
  const count = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM company_base_year WHERE company_id = 1`));
  assert.equal(count.rows[0].n, 0);
});

test("PUT freezes approved base-year rows by category (kg then round); freezing twice keeps one row", async () => {
  const r = await call("PUT", "/scope3/base-year", "admin", { base_year: BASE, rationale: "First year with supplier data", significance_pct: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.base_year, BASE);
  assert.equal(r.json.year_type, "CY");
  assert.equal(r.json.snapshot.version, 1);
  assert.equal(r.json.snapshot.total_tco2e, 10);
  assert.equal(r.json.snapshot.categories.length, 16);
  assert.equal(r.json.snapshot.categories.find((c) => c.n === 6).tco2e, 10);
  assert.equal(r.json.snapshot.rows, 2);

  const again = await call("PUT", "/scope3/base-year", "superadmin", { company_id: 1, base_year: BASE, rationale: "Supplier data from 2012" });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(again.json.snapshot.version, 1); // same year: policy only, no silent re-freeze
  assert.equal(again.json.rationale, "Supplier data from 2012");
  const count = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM company_base_year WHERE company_id = 1`));
  assert.equal(count.rows[0].n, 1);
  const audits = await withDb((db) => db.query(`SELECT action FROM audit_log WHERE entity_type = 'scope3_base_year' ORDER BY id`));
  assert.deepEqual(audits.rows.map((a) => a.action), ["freeze", "update"]);

  const got = await call("GET", "/scope3/base-year", "manager");
  assert.equal(got.json.base_year.base_year, BASE);
  assert.equal(got.json.drift.delta_tco2e, 0);
  assert.equal(got.json.open_proposal, null);
});

test("tenant isolation: company 2 callers get 404 on company 1's base year and recalculations", async () => {
  assert.equal((await call("GET", "/scope3/base-year?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/scope3/recalculations?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/scope3/recalculations?company_id=1", "otherUser")).status, 404);
  assert.equal((await call("PUT", "/scope3/base-year?company_id=1", "otherManager", { base_year: BASE })).status, 404);
  assert.equal((await call("POST", "/scope3/recalculations?company_id=1", "otherManager", { reason: "error" })).status, 404);
  // Company 2's own view has no base year.
  assert.equal((await call("GET", "/scope3/base-year", "otherManager")).json.base_year, null);
  assert.equal((await call("GET", "/scope3/base-year", "superadmin")).status, 400);
  assert.equal((await call("GET", "/scope3/base-year")).status, 401);
});

test("a significant correction makes one proposal; approve needs a reason and never edits emission rows", async () => {
  assert.deepEqual((await call("GET", "/scope3/recalculations", "admin")).json.events, []);
  await withDb((db) => db.query(`UPDATE emission SET total_emission = 6.8 WHERE pk_id = 81400`)); // +0.8 t = 8 %
  const first = await call("GET", "/scope3/recalculations?status=proposed", "manager");
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.events.length, 1);
  const p = first.json.events[0];
  assert.equal(p.reason, "error");
  assert.equal(p.delta_tco2e, 0.8);
  assert.equal(p.delta_pct, 8);
  assert.equal(p.largest_category, 6);
  assert.equal(p.changes[0].kind, "edited");
  assert.equal((await call("GET", "/scope3/recalculations?status=proposed", "admin")).json.events.length, 1); // still one
  assert.equal((await call("GET", "/scope3/recalculations?status=nope", "admin")).status, 400);

  const noReason = await call("POST", "/scope3/recalculations", "admin", { note: "Invoice keyed twice" });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, "RECALCULATION_REASON_REQUIRED");
  assert.equal((await call("POST", "/scope3/recalculations", "admin", { reason: "typo" })).json.code, "RECALCULATION_REASON_REQUIRED");
  assert.equal((await call("POST", "/scope3/recalculations", "manager", { reason: "error" })).status, 403);

  const before = await emissionTotals();
  const ok = await call("POST", "/scope3/recalculations", "admin", { reason: "error", note: "Invoice keyed twice" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.event.status, "approved");
  assert.equal(ok.json.event.id, p.id);
  assert.equal(ok.json.event.note, "Invoice keyed twice");
  assert.equal(ok.json.base_year.snapshot.version, 2);
  assert.equal(ok.json.base_year.snapshot.total_tco2e, 10.8);
  assert.deepEqual(await emissionTotals(), before);
  assert.deepEqual((await call("GET", "/scope3/recalculations?status=proposed", "admin")).json.events, []);
  const audits = await withDb((db) => db.query(`SELECT entity_type, action FROM audit_log WHERE entity_type IN ('scope3_base_year', 'scope3_recalculation') ORDER BY id`));
  assert.deepEqual(audits.rows.slice(-2).map((a) => [a.entity_type, a.action]), [["scope3_recalculation", "approve"], ["scope3_base_year", "refreeze"]]);
  // Nothing left to approve.
  assert.equal((await call("POST", "/scope3/recalculations", "admin", { reason: "error" })).status, 404);
});

test("dismiss keeps the snapshot and the same changes are not proposed again", async () => {
  await withDb((db) => db.query(`DELETE FROM emission WHERE pk_id = 81401`)); // −4 t
  const open = (await call("GET", "/scope3/recalculations?status=proposed", "admin")).json.events;
  assert.equal(open.length, 1);
  assert.equal(open[0].changes[0].kind, "deleted");
  assert.equal((await call("POST", `/scope3/recalculations/${open[0].id}/dismiss`, "manager", {})).status, 403);
  assert.equal((await call("POST", `/scope3/recalculations/${open[0].id}/dismiss?company_id=1`, "otherManager", {})).status, 404);
  const d = await call("POST", `/scope3/recalculations/${open[0].id}/dismiss`, "admin", { note: "Row moved to 2013" });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.event.status, "dismissed");
  assert.deepEqual((await call("GET", "/scope3/recalculations?status=proposed", "admin")).json.events, []);
  const by = await call("GET", "/scope3/base-year", "admin");
  assert.equal(by.json.base_year.snapshot.version, 2);
  assert.equal(by.json.drift.significant, true);
  assert.equal((await call("POST", `/scope3/recalculations/${open[0].id}/dismiss`, "admin", {})).status, 404);
  await withDb((db) => insert(db, 81401, 4)); // put it back for the next test
});

test("changing the base year needs a note and records an approved methodology event", async () => {
  const no = await call("PUT", "/scope3/base-year", "admin", { base_year: BASE + 1 });
  assert.equal(no.status, 400);
  assert.equal(no.json.code, "RECALCULATION_REASON_REQUIRED");
  const ok = await call("PUT", "/scope3/base-year", "admin", { base_year: BASE + 1, note: "Acquired site data starts in 2013" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.base_year, BASE + 1);
  assert.equal(ok.json.snapshot.version, 3);
  assert.equal(ok.json.snapshot.total_tco2e, 3);
  const approved = (await call("GET", "/scope3/recalculations?status=approved", "user")).json.events;
  assert.equal(approved[0].reason, "methodology");
  assert.deepEqual(approved[0].affected_years, [BASE, BASE + 1]);
  assert.equal(approved[0].note, "Acquired site data starts in 2013");
  assert.equal(approved[0].approved_by_name !== undefined, true);
  const count = await withDb((db) => db.query(`SELECT COUNT(*)::int AS n FROM company_base_year WHERE company_id = 1`));
  assert.equal(count.rows[0].n, 1);
});

const runScript = (name) =>
  spawnSync(process.execPath, [path.join(ROOT, `dist/scripts/${name}.js`)], {
    cwd: ROOT,
    env: { ...process.env, TYPEORM_SYNC: "false" },
    encoding: "utf8",
  });

test("migrate:scope3-base-year runs twice and keeps existing rows", async () => {
  const count = () => withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM company_base_year`)).rows[0].n);
  const before = await count();
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateScope3BaseYear");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  assert.equal(await count(), before);
});
