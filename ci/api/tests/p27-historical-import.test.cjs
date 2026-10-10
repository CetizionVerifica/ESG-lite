// P27 historical import: POST /admin/upload/emissions with a client, site and
// category picked by id. Nothing is created from free text, a dry run saves
// nothing, and new people get an invite (CI has no Mailgun, so it comes back
// as a warning) instead of a password.
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { call, withDb } = require("../helpers.cjs");

const sheet = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

const ROWS = [
  // Recomputed: 1000 kWh x 0.5 kgCO2e/kWh = 0.5 t.
  { year: 2019, month: "January", fuelType: "Grid", unit: "kWh", activity: 1000, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 99, email: "hist-new@ci.example", name: "Hist New" },
  { year: 2019, month: "January", fuelType: "Grid", unit: "kWh", activity: 5, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" },
  { year: 2019, month: "Smarch", fuelType: "Grid", unit: "kWh", activity: 5, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" },
  // Units don't match the factor, so the file's total is used.
  { year: 2019, month: "Feb", fuelType: "Grid", unit: "MWh", activity: 2, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 1.25, email: "ci-user@example.invalid" },
  { year: 2019, month: 3, fuelType: "Grid", unit: "MWh", activity: 2, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", email: "not-an-email" },
];

const form = (fields, rows = ROWS) => {
  const f = new FormData();
  f.append("file", new Blob([sheet(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "history.xlsx");
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  return f;
};

const entries = () =>
  withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission WHERE site_id = 2 AND category_id = 2 AND date_of_reporting < '2020-01-01'`)).rows[0].n));

test("the site must belong to the client and the category must be set up for the site", async () => {
  const otherClient = await call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 3, categoryId: 1, dryRun: true }));
  assert.equal(otherClient.status, 400);
  assert.match(otherClient.json.message, /doesn't belong/);

  const notOnSite = await call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 3, dryRun: true }));
  assert.equal(notOnSite.status, 400);
  assert.match(notOnSite.json.message, /isn't set up/);

  const missing = await call("POST", "/admin/upload/emissions", "superadmin", form({ siteId: 2, categoryId: 2 }));
  assert.equal(missing.status, 400);

  assert.equal((await call("POST", "/admin/upload/emissions", "admin", form({ companyId: 1, siteId: 2, categoryId: 2, dryRun: true }))).status, 403);
});

test("a dry run returns the plan and saves nothing; the import saves it and invites new people", async () => {
  const before = await entries();
  // Without commit=true it only previews; an unknown value is refused.
  assert.equal((await call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 2, commit: "yes" }))).status, 400);
  const preview = await call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 2 }));
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.dryRun, true);
  assert.deepEqual(
    { totalRows: preview.json.summary.totalRows, toImport: preview.json.summary.toImport, toSkip: preview.json.summary.toSkip },
    { totalRows: 5, toImport: 2, toSkip: 3 },
  );
  const [jan, dup, bad, feb, noTotal] = preview.json.rows;
  assert.deepEqual([jan.status, jan.period, jan.total, jan.totalFrom], ["import", "2019-01", 0.5, "calculated"]);
  assert.match(dup.reason, /Same month as row 1/);
  assert.match(bad.reason, /Year or month/);
  assert.deepEqual([feb.status, feb.total, feb.totalFrom], ["import", 1.25, "file"]);
  assert.match(noTotal.reason, /No total/);
  assert.deepEqual(preview.json.people, [
    { email: "hist-new@ci.example", name: "Hist New", exists: false },
    { email: "ci-user@example.invalid", name: "ci-user", exists: true },
  ]);
  assert.deepEqual(preview.json.invalidEmails, ["not-an-email"]);
  assert.equal(await entries(), before);
  await withDb(async (db) => assert.equal((await db.query(`SELECT 1 FROM "user" WHERE email = 'hist-new@ci.example'`)).rowCount, 0));

  // A double submit: the second import waits for the first and skips what it filed.
  const [done, twice] = await Promise.all([
    call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 2, commit: true })),
    call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 2, commit: true })),
  ]).then((both) => both.sort((a, b) => b.json.summary.emissionsCreated - a.json.summary.emissionsCreated));
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(twice.status, 200, JSON.stringify(twice.json));
  assert.equal(twice.json.summary.emissionsCreated, 0);
  assert.equal(twice.json.summary.usersCreated, 0);
  assert.equal(done.json.summary.emissionsCreated, 2);
  assert.equal(done.json.summary.usersCreated, 1);
  assert.equal(done.json.summary.invitesSent, 0);
  assert.match(done.json.summary.inviteWarning, /Email isn't configured/);
  assert.equal(done.json.skippedRows.length, 3);
  assert.doesNotMatch(JSON.stringify(done.json), /password/i);
  assert.equal(await entries(), before + 2);
  await withDb(async (db) => {
    const saved = (await db.query(
      `SELECT status, total_emission FROM emission WHERE site_id = 2 AND category_id = 2 AND date_of_reporting < '2020-01-01' ORDER BY date_of_reporting`,
    )).rows;
    assert.deepEqual(saved.map((r) => [r.status, Number(r.total_emission)]), [["pending", 0.5], ["pending", 1.25]]);
    const user = (await db.query(`SELECT role, site_id FROM "user" WHERE email = 'hist-new@ci.example'`)).rows[0];
    assert.deepEqual([user.role, Number(user.site_id)], ["User", 2]);
  });

  // Running the same sheet again skips the months it already filed.
  const again = await call("POST", "/admin/upload/emissions", "superadmin", form({ companyId: 1, siteId: 2, categoryId: 2, dryRun: true }));
  assert.equal(again.json.summary.toImport, 0);
  assert.match(again.json.rows[0].reason, /already has an entry/);
  assert.equal(again.json.people[0].exists, true);

  // The new person would now owe September 2025 in the reminders test; take
  // them off the site so the shared fixture stays as that test expects.
  await withDb((db) => db.query(`UPDATE "user" SET site_id = NULL WHERE email = 'hist-new@ci.example'`));
});
