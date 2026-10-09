// B7: GET /user/emissions/export?year= exports a whole year (CY or FY).
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { call, withDb } = require("../helpers.cjs");

const readSheet = (buffer) => {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const name = wb.SheetNames[0];
  return { name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) };
};
// Data rows sit between the header row ("#", "Category", ...) and the blank line before TOTAL.
const dataRows = (rows) => {
  const header = rows.findIndex((r) => r[0] === "#");
  const out = [];
  for (let i = header + 1; i < rows.length && rows[i].length && rows[i][0] !== ""; i++) out.push(rows[i]);
  return { header: rows[header], rows: out };
};
const col = (header, rows, name) => rows.map((r) => r[header.indexOf(name)]);

test("calendar year export covers Jan-Dec and leaves out FERA rows", async () => {
  const res = await call("GET", "/user/emissions/export?siteIds=1&year=2025", "manager");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /spreadsheetml/);
  assert.match(res.headers.get("content-disposition"), /CI_Plant_A_2025\.xlsx/);

  const sheet = readSheet(res.buffer);
  assert.equal(sheet.name, "2025");
  assert.deepEqual(sheet.rows[2].slice(3, 5), ["Year:", "2025"]);
  const { header, rows } = dataRows(sheet.rows);
  // Site 1, 2025: ids 1, 2, 3, 4 (Sep) and 14 (Feb); FERA row 5 is shown inline, not as a row.
  assert.equal(rows.length, 5);
  assert.deepEqual(col(header, rows, "Emission (tCO2e)").sort((a, b) => a - b), [1, 2, 4.29, 11, 312.4]);
  // FERA pending row 5 is linked to entry 1 (Stationary Combustion, 4.29).
  const fera = col(header, rows, "FERA (tCO2e)");
  assert.equal(fera.filter((v) => v !== "").length, 1);
  assert.equal(fera.find((v) => v !== ""), 0.5);
});

test("financial year export uses Apr-Mar ending in the given year", async () => {
  const res = await call("GET", "/user/emissions/export?siteIds=1,2&year=2025&yearType=FY", "manager");
  assert.equal(res.status, 200);
  const sheet = readSheet(res.buffer);
  assert.equal(sheet.name, "FY 2024-25");
  const { header, rows } = dataRows(sheet.rows);
  // Apr 2024 - Mar 2025 on sites 1-2: ids 9, 10 (May 24), 11 (Nov 24), 12 (Dec 24), 14 (Feb 25).
  // Id 13 is a CY 2024 yearly batch dated Dec 31: it is CY data, not FY data.
  assert.deepEqual(col(header, rows, "Emission (tCO2e)").sort((a, b) => a - b), [3, 5, 7, 11, 50]);
  assert.equal(res.headers.get("x-export-truncated"), "false");
});

test("yearly batches appear only in the export of their own year type", async () => {
  const cy24 = dataRows(readSheet((await call("GET", "/user/emissions/export?siteIds=1&year=2024", "manager")).buffer).rows);
  assert.ok(col(cy24.header, cy24.rows, "Emission (tCO2e)").includes(80), "CY 2024 batch in CY 2024");

  // Id 7: FY 2025-26 batch on site 2, dated 2026-03-31.
  const fy26 = await call("GET", "/user/emissions/export?siteIds=2&year=2026&yearType=FY", "manager");
  const fy = dataRows(readSheet(fy26.buffer).rows);
  assert.ok(col(fy.header, fy.rows, "Emission (tCO2e)").includes(120), "FY batch in its FY");
  // Site 2 has nothing else in CY 2026, so the CY export is empty.
  assert.equal((await call("GET", "/user/emissions/export?siteIds=2&year=2026", "manager")).status, 404);
});

test("a year export over the row cap says it was truncated", async () => {
  // 50,001 monthly rows on site 2 in 2031, removed afterwards.
  await withDb((db) =>
    db.query(`INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status,
                                    created_by, category_id, site_id, reporting_period, created_at)
              SELECT 200000 + g, '{"activity_value": 1}', 0.001, 'tCO2e', DATE '2031-01-31', 'approved', 7, 1, 2, 'monthly', now()
                FROM generate_series(1, 50001) AS g`),
  );
  try {
    const res = await call("GET", "/user/emissions/export?siteIds=2&year=2031", "manager");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-export-truncated"), "true");
    const sheet = readSheet(res.buffer);
    assert.ok(sheet.rows.some((r) => String(r[0]).startsWith("Truncated: only the first 50,000 entries")));
    assert.equal(sheet.rows.find((r) => r[0] === "Total Entries:")[1], 50000);
  } finally {
    await withDb((db) => db.query("DELETE FROM emission WHERE pk_id > 200000 AND pk_id <= 250001"));
  }
});

test("status filter applies to the year export", async () => {
  const res = await call("GET", "/user/emissions/export?siteIds=1&year=2025&status=approved", "manager");
  const { header, rows } = dataRows(readSheet(res.buffer).rows);
  assert.deepEqual(col(header, rows, "Status"), ["Approved", "Approved", "Approved"]);
});

test("monthly export is unchanged", async () => {
  const res = await call("GET", "/user/emissions/export?siteIds=1&year=2025&month=9", "manager");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /CI_Plant_A_September_2025\.xlsx/);
  const sheet = readSheet(res.buffer);
  assert.equal(sheet.name, "Sep 2025");
  assert.deepEqual(sheet.rows[2].slice(3, 5), ["Month:", "September 2025"]);
  assert.equal(dataRows(sheet.rows).rows.length, 4);
});

test("validation", async () => {
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1", "manager")).status, 400);
  assert.equal((await call("GET", "/user/emissions/export?year=2025", "manager")).status, 400);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1&year=2025&yearType=QY", "manager")).status, 400);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1&year=2019", "manager")).status, 404);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1&year=2025", null)).status, 401);
});

test("year export is limited to sites the caller can access", async () => {
  // Users: their own site(s). Managers: their sites. Admins: their company. Superadmin: any.
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1&year=2025", "user")).status, 200);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=2&year=2025", "user")).status, 403);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=1,3&year=2025", "manager")).status, 403);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=2&year=2025", "admin")).status, 200);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=3&year=2025", "admin")).status, 403);
  assert.equal((await call("GET", "/user/emissions/export?siteIds=3&year=2025", "superadmin")).status, 200);
});
