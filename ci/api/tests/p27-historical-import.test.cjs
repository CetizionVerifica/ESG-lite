// P27 historical import: POST /admin/upload/emissions with a client, site and
// category picked by id. Nothing is created from free text, a dry run saves
// nothing, and new people get an invite (CI has no Mailgun, so it comes back
// as a warning) instead of a password. Totals come from the engine and the
// site's factors (S3-4), never from the sheet's emissionFactor or
// calculatedEmission.
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
  // The site's 2018 "Grid" factor (0.5 kg/kWh): 1000 kWh = 0.5 t; the sheet's 99 is ignored.
  { year: 2019, month: "January", fuelType: "Grid", unit: "kWh", activity: 1000, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 99, email: "hist-new@ci.example", name: "Hist New" },
  { year: 2019, month: "January", fuelType: "Grid", unit: "kWh", activity: 5, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" },
  { year: 2019, month: "Smarch", fuelType: "Grid", unit: "kWh", activity: 5, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh" },
  // MWh converts to the factor's kWh: 2 MWh = 1 t, not the sheet's 1.25.
  { year: 2019, month: "Feb", fuelType: "Grid", unit: "MWh", activity: 2, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", calculatedEmission: 1.25, email: "ci-user@example.invalid" },
  { year: 2019, month: 3, fuelType: "Grid", unit: "MWh", activity: 2, emissionFactor: 0.5, emissionFactorUnit: "kgCO2e/kWh", email: "not-an-email" },
  // Refused by the engine: a unit that doesn't convert, and a fuel the site has no factor for.
  { year: 2019, month: "April", fuelType: "Grid", unit: "litre", activity: 9, calculatedEmission: 4 },
  { year: 2019, month: "May", fuelType: "Moon dust", unit: "kWh", activity: 9, calculatedEmission: 4 },
];

// The site's own factor, as the engine resolves it for 2019 rows (reporting year − 1).
test.before(() =>
  withDb((db) => db.query(`INSERT INTO emission_factors (emission_factor_id, emission_category_name, factor_value, denominator_unit, year, site_id, category_id) VALUES (9927, 'Grid', 0.5, 'kWh', 2018, 2, 2)`)),
);
test.after(() => withDb((db) => db.query(`DELETE FROM emission_factors WHERE emission_factor_id = 9927`)));

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
    { totalRows: 7, toImport: 3, toSkip: 4 },
  );
  const [jan, dup, bad, feb, mar, litre, unknown] = preview.json.rows;
  assert.deepEqual([jan.status, jan.period, jan.total, jan.totalFrom], ["import", "2019-01", 0.5, "calculated"]);
  assert.match(dup.reason, /Same month as row 1/);
  assert.match(bad.reason, /Year or month/);
  assert.deepEqual([feb.status, feb.total, feb.totalFrom], ["import", 1, "calculated"]);
  assert.deepEqual([mar.status, mar.total], ["import", 1]); // no sheet total needed any more
  assert.deepEqual([litre.status, litre.total], ["skip", null]);
  assert.match(litre.reason, /Unit mismatch/);
  assert.match(unknown.reason, /No emission factor found/);
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
  assert.equal(done.json.summary.emissionsCreated, 3);
  assert.equal(done.json.summary.usersCreated, 1);
  assert.equal(done.json.summary.invitesSent, 0);
  assert.match(done.json.summary.inviteWarning, /Email isn't configured/);
  assert.equal(done.json.skippedRows.length, 4);
  assert.doesNotMatch(JSON.stringify(done.json), /password/i);
  assert.equal(await entries(), before + 3);
  await withDb(async (db) => {
    const saved = (await db.query(
      `SELECT status, total_emission, total_kgco2e, emission_factor_snapshot->>'emission_factor_id' AS factor_id, extra_data->'import'->>'channel' AS channel
         FROM emission WHERE site_id = 2 AND category_id = 2 AND date_of_reporting < '2020-01-01' ORDER BY date_of_reporting`,
    )).rows;
    // Engine rows: the site's factor snapshot, the kg total and the historical channel.
    assert.deepEqual(
      saved.map((r) => [r.status, Number(r.total_emission), r.total_kgco2e, r.factor_id, r.channel]),
      [["pending", 0.5, "500.0000", "9927", "historical"], ["pending", 1, "1000.0000", "9927", "historical"], ["pending", 1, "1000.0000", "9927", "historical"]],
    );
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
