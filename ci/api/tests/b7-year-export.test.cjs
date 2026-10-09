// B7: GET /user/emissions/export?year= exports a whole year (CY or FY).
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { call } = require("../helpers.cjs");

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
  // Apr 2024 - Mar 2025 on sites 1-2: ids 9, 10 (May 24), 11 (Nov 24), 12 (Dec 24), 13 (CY yearly, Dec 24), 14 (Feb 25).
  assert.deepEqual(col(header, rows, "Emission (tCO2e)").sort((a, b) => a - b), [3, 5, 7, 11, 50, 80]);
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
