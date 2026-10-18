// KPI-7 part 3: GET /kpi/my/template (XLSX of what the caller owns and still
// owes) and POST /kpi/my/template (plan with row issues, then commit as
// drafts). Template round trip, ownership (D17), tenant isolation, switch off.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, ROOT } = require("./kpi-lib.cjs");
const XLSX = require(require.resolve("xlsx", { paths: [ROOT] }));

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wipe = async () => {
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'kpi_value'`);
  await clearSetup();
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI"] });
  await setupCompany(2, { frameworks: ["GRI"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const sheetRows = (buffer) => XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: "buffer" }).Sheets["My KPIs"], { defval: null });
const fileOf = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "My KPIs");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};
const upload = (who, rows, { commit, query = "" } = {}) => {
  const form = new FormData();
  form.append("file", new Blob([fileOf(rows)]), "my-kpis.xlsx");
  if (commit !== undefined) form.append("commit", String(commit));
  return call("POST", `/kpi/my/template${query}`, who, form);
};

test("download: one row per due item the caller owns, as My KPIs lists it; auto and others' items left out", async () => {
  const r = await call("GET", "/kpi/my/template?period=2026-09", "user");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /spreadsheetml/);
  assert.match(r.headers.get("content-disposition"), /My-KPIs-2026-09\.xlsx/);
  const rows = sheetRows(r.buffer);
  const my = (await call("GET", "/kpi/my?period=2026-09", "user")).json;
  const due = my.items.filter((i) => i.source === "manual" && (i.group === "due" || i.group === "sent_back"));
  assert.equal(rows.length, due.length);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((x) => x["Site ID"] === 1 && x.Status === "Due"));
  assert.deepEqual(Object.keys(rows[0]).slice(0, 6), ["KPI code", "KPI", "Question", "Site ID", "Site", "Period start"]);
  assert.ok(!rows.some((x) => x["KPI code"] === "ENERGY_TOTAL"), "auto items aren't typed");
  const wb = XLSX.read(r.buffer, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["My KPIs", "How to fill in"]);
  // The Manager owns nothing here: an empty template. A User of company 2 sees only company 2.
  assert.equal(sheetRows((await call("GET", "/kpi/my/template?period=2026-09", "manager")).buffer).length, 0);
  assert.ok(sheetRows((await call("GET", "/kpi/my/template?period=2026-09", "otherUser")).buffer).every((x) => x["Site ID"] === 3));
  assert.equal((await call("GET", "/kpi/my/template?period=2026-09&site=2", "user")).status, 404);
  assert.equal((await call("GET", "/kpi/my/template?period=Sept", "user")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/my/template?period=2026-09", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
});

test("upload: plan first (row issues with codes, nothing stored), then commit the ready rows as drafts", async () => {
  const rows = sheetRows((await call("GET", "/kpi/my/template?period=2026-09", "user")).buffer);
  const pick = (code) => ({ ...rows.find((x) => x["KPI code"] === code) });
  const withdrawal = { ...pick("WATER_WITHDRAWAL"), Value: 1200, Unit: "kL", Breakdown: null, Comment: "From the meter" };
  const lti = { ...pick("LOST_TIME_INJURIES"), Value: "2", Estimate: "yes" };
  const badUnit = { ...pick("WATER_DISCHARGE"), Value: 30, Unit: "kWh" };
  const blank = { ...pick("FATALITIES"), Value: null };
  const notMine = { ...withdrawal, "Site ID": 2, Site: "CI Plant B" };
  const otherCompany = { ...withdrawal, "Site ID": 3 };
  const dup = { ...withdrawal, Value: 5 };
  const text = { ...lti, Value: "two" };
  const file = [withdrawal, lti, badUnit, blank, notMine, otherCompany, dup, text, {}];

  const plan = await upload("user", file);
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.equal(plan.json.dry_run, true);
  assert.equal(plan.json.file_name, "my-kpis.xlsx");
  const byRow = (n) => plan.json.plan.rows.find((r) => r.row === n);
  assert.deepEqual([byRow(2).status, byRow(2).value, byRow(2).unit, byRow(2).period_label, byRow(2).site_name], ["ready", 1200, "kL", "Sep 2026", "CI Plant A"]);
  assert.equal(byRow(3).status, "ready");
  assert.deepEqual([byRow(4).status, byRow(4).issues[0].code], ["error", "KPI_UNIT_NOT_ALLOWED"]);
  assert.equal(byRow(5).status, "skipped");
  assert.deepEqual([byRow(6).status, byRow(6).issues[0].code], ["error", "KPI_NOT_ASSIGNED"], "site 2 is user 7's");
  assert.deepEqual([byRow(7).status, byRow(7).issues[0].code], ["error", "KPI_NOT_FOUND"], "another company's site");
  assert.deepEqual([byRow(8).issues[0].code, byRow(8).issues[0].details.rule], ["KPI_VALIDATION", "duplicate_row"]);
  assert.deepEqual([byRow(9).issues[0].code, byRow(9).issues[0].details.rule], ["KPI_VALUE_INVALID", "a_number"]);
  assert.equal(byRow(10), undefined, "an empty line isn't a row");
  assert.deepEqual(plan.json.plan.counts, { total: 8, ready: 2, error: 5, skipped: 1 });
  assert.ok(!("item" in byRow(2)));
  assert.equal((await q(`SELECT 1 FROM kpi_value WHERE company_id = 1`)).length, 0, "a plan stores nothing");
  assert.equal((await q(`SELECT 1 FROM audit_log WHERE entity_type = 'kpi_value'`)).length, 0, "and audits nothing");

  const done = await upload("user", file, { commit: true });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual([done.json.dry_run, done.json.saved], [false, 2]);
  assert.deepEqual(done.json.results.map((r) => [r.row, r.ok]), [[2, true], [3, true]]);
  const stored = await q(`SELECT v.status, v.value_numeric::float AS v, v.unit, v.value_canonical::float AS c, v.is_estimate, v.comment, v.entered_by, d.code FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = 1 ORDER BY d.code`);
  assert.deepEqual(stored.map((s) => [s.code, s.status, s.v, s.unit, s.is_estimate, s.entered_by]), [["LOST_TIME_INJURIES", "draft", 2, "count", true, 1], ["WATER_WITHDRAWAL", "draft", 1200, "kL", false, 1]]);
  assert.equal(stored.find((s) => s.code === "WATER_WITHDRAWAL").comment, "From the meter");
  // The drafts are in the next download, filled in.
  const again = sheetRows((await call("GET", "/kpi/my/template?period=2026-09", "user")).buffer);
  assert.deepEqual([again.find((x) => x["KPI code"] === "WATER_WITHDRAWAL").Value, again.find((x) => x["KPI code"] === "WATER_WITHDRAWAL").Status], [1200, "Draft"]);
  // Submitted values aren't editable: a re-upload is refused per row.
  const ids = (await q(`SELECT id FROM kpi_value WHERE company_id = 1`)).map((r) => r.id);
  await q(`UPDATE kpi_value SET status = 'pending' WHERE id = ANY($1::int[])`, [ids]);
  const late = await upload("user", [withdrawal]);
  assert.equal(late.json.plan.rows[0].issues[0].code, "KPI_NOT_DRAFT");
});

test("bad files and requests; tenant isolation; the Superadmin passes company_id in the query; switch off", async () => {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from("not a spreadsheet at all")]), "x.xlsx");
  const junk = await call("POST", "/kpi/my/template", "user", form);
  assert.equal(junk.status, 400);
  assert.equal(junk.json.code, "KPI_VALIDATION");
  assert.equal((await upload("user", [{ Foo: 1 }])).json.code, "KPI_VALIDATION", "no template columns");
  assert.equal((await call("POST", "/kpi/my/template", "user", new FormData())).json.code, "KPI_VALIDATION", "no file");
  assert.equal((await upload("user", [], { commit: "maybe" })).status, 400);
  // Company 2's User uploading company 1's rows: nothing of company 1 is found or written.
  const row = { "KPI code": "WATER_WITHDRAWAL", "Site ID": 1, "Period start": "2026-10-01", Value: 1 };
  const other = await upload("otherUser", [row], { commit: true });
  assert.equal(other.json.plan.rows[0].issues[0].code, "KPI_NOT_FOUND");
  assert.equal(other.json.saved, 0);
  assert.equal((await upload("otherManager", [row], { query: "?company_id=1" })).status, 404);
  // The Superadmin owns nothing, so every row is not theirs; the route answers for the client.
  const sa = await upload("superadmin", [row], { query: "?company_id=1" });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.equal(sa.json.plan.rows[0].issues[0].code, "KPI_NOT_ASSIGNED");
  assert.equal((await upload("superadmin", [row])).json.code, "KPI_COMPANY_REQUIRED");
  await setSwitch(1, false);
  try {
    assert.equal((await call("GET", "/kpi/my/template?period=2026-09", "user")).json.code, "KPI_TRACKING_OFF");
    assert.equal((await upload("user", [row])).json.code, "KPI_TRACKING_OFF");
  } finally {
    await setSwitch(1, true);
  }
});
