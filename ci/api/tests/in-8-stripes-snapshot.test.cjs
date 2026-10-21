// IN-8 · GET /insights/stripes and GET /insights/snapshot.pdf: stripes by hand (company 1,
// site 2, own rows 2007–2013 removed by id; the fixture company's June-only rows give no_data),
// the 72-month cap, null months, yearly batches left out; roles, site scope, tenant and
// switch-off for both; the snapshot's timeout path (504 IN_SNAPSHOT_TIMEOUT); the PDF is one
// page when Chromium can launch here, else 503 IN_SNAPSHOT_UNAVAILABLE.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setInsights, q, panel, assertEnvelope } = require("./in-lib.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const own = [];
// Site 2, approved, monthly: Jan 2012 – Feb 2013 except May 2012 (null); Scope 1 t = 10 + month index;
// July 2012 also has a 4 t renewable (saved) row; a 500 t CY 2012 yearly batch (left out of stripes).
const MONTHS = [];
for (let i = 0; i < 14; i++) {
  const y = 2012 + Math.floor(i / 12);
  const m = (i % 12) + 1;
  if (y === 2012 && m === 5) continue;
  MONTHS.push({ day: `${y}-${String(m).padStart(2, "0")}-28`, t: 10 + i });
}
const insert = async (rows) => {
  for (const [day, t, cat, period] of rows) {
    own.push(
      (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, year_type) VALUES ('{}', $1, 'tCO2e', $2, 'approved', 7, $3, 2, $4, $5) RETURNING pk_id`, [t, day, cat, period, period === "yearly" ? "CY" : null]))[0].pk_id,
    );
  }
};
const cleanup = async () => {
  if (own.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [own]);
  own.length = 0;
  await setInsights(1, false);
  await setInsights(2, false);
};

test.before(async () => {
  await cleanup();
  await setInsights(1, true);
  await insert([...MONTHS.map((r) => [r.day, r.t, 1, "monthly"]), ["2012-07-15", 4, 4, "monthly"], ["2012-12-31", 500, 1, "yearly"]]);
});
test.after(cleanup);

test("stripes by hand: months from the first value to the period end, null months, saved rows, yearly batches left out", async () => {
  const r = (await panel("manager", "/stripes?year=2013&sites=2")).json;
  assertEnvelope(assert, r, "stripes");
  assert.equal(r.availability, "ok");
  const d = r.data;
  assert.equal(d.unit, "tCO2e");
  assert.equal(d.months.length, 24); // 2012-01 … 2013-12
  assert.equal(d.months[0], "2012-01");
  assert.equal(d.months[23], "2013-12");
  const at = (m) => d.values[d.months.indexOf(m)];
  assert.equal(at("2012-01"), 10);
  assert.equal(at("2012-05"), null);
  assert.equal(at("2012-07"), 16 - 4); // 16 t Scope 1 − 4 t saved
  assert.equal(at("2012-12"), 21); // the 500 t yearly batch is not in the monthly band
  assert.equal(at("2013-02"), 23);
  assert.equal(at("2013-03"), null);
  assert.equal(d.values.filter((v) => v !== null).length, 13);
  assert.equal(d.min, 10);
  assert.equal(d.max, 23);
});

test("stripes: at most 72 months ending at the period end; fewer than 12 months with values is no_data", async () => {
  await insert([["2008-01-15", 7, 1, "monthly"], ["2007-06-15", 99, 1, "monthly"]]);
  const d = (await panel("manager", "/stripes?year=2013&sites=2")).json.data;
  assert.equal(d.months.length, 72);
  assert.equal(d.months[0], "2008-01");
  assert.equal(d.values[0], 7);
  assert.ok(!d.values.includes(99), "June 2007 is outside the 72 months");
  assert.equal(d.max, 23);
  assert.equal(d.min, 7);
  // 2011 alone: nothing (no_data), and a year with only 2 months of data.
  const none = (await panel("manager", "/stripes?year=2009&sites=2")).json;
  assert.equal(none.availability, "no_data");
  assert.equal(none.data, null);
  assert.match(none.reason, /twelve months/);
  // FY: FY 2013 ends Mar 2013; the window holds the 2012–13 values.
  const fy = (await panel("manager", "/stripes?year=2013&yearType=FY&sites=2")).json.data;
  assert.equal(fy.months[fy.months.length - 1], "2013-03");
  assert.equal(fy.values[fy.values.length - 1], null);
});

test("stripes and snapshot: roles, site scope, tenant isolation and switch-off", async () => {
  for (const url of ["/insights/stripes?year=2013", "/insights/snapshot.pdf?year=2013"]) {
    for (const who of ["user", "multiSiteUser"]) {
      const r = await call("GET", url, who);
      assert.equal(r.status, 403, `${who} ${url}`);
      assert.equal(r.json.code, "IN_FORBIDDEN");
    }
    for (const [who, qs] of [["manager", "&sites=3"], ["otherManager", "&company_id=1"], ["admin", "&company_id=2"]]) {
      const r = await call("GET", url + qs, who);
      assert.equal(r.status, 404, `${who} ${url}${qs}`);
      assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
    }
    assert.equal((await call("GET", url, "superadmin")).json.code, "IN_COMPANY_REQUIRED");
    const bad = await call("GET", url.replace("year=2013", "year=abc"), "manager");
    assert.equal(bad.status, 400);
    await setInsights(1, false);
    try {
      for (const who of ["manager", "admin"]) assert.equal((await call("GET", url, who)).json.code, "IN_OFF", `${who} ${url}`);
      assert.equal((await call("GET", `${url}&company_id=1`, "superadmin")).json.code, "IN_OFF");
    } finally {
      await setInsights(1, true);
    }
  }
  // Company 2's Manager reads only company 2 (its switch is off: IN_OFF).
  assert.equal((await call("GET", "/insights/stripes?year=2013", "otherManager")).json.code, "IN_OFF");
  // The stripes read the caller's sites only: company 2's site never appears.
  const admin = (await panel("admin", "/stripes?year=2013&sites=2")).json;
  assert.equal(admin.data.max, 23);
});

test("snapshot: the time limit answers 504 IN_SNAPSHOT_TIMEOUT", async () => {
  const r = await call("GET", "/insights/snapshot.pdf?year=2013&sites=2", "manager", undefined, { "x-insights-snapshot-timeout-ms": "1" });
  assert.equal(r.status, 504);
  assert.equal(r.json.code, "IN_SNAPSHOT_TIMEOUT");
});

test("snapshot: one A4 landscape page from approved data; 503 IN_SNAPSHOT_UNAVAILABLE without Chromium", async () => {
  let browser;
  let chromium = true;
  try {
    browser = await require("playwright").chromium.launch();
  } catch {
    chromium = false; // CI sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
  } finally {
    if (browser) await browser.close();
  }
  const r = await call("GET", "/insights/snapshot.pdf?year=2013&sites=2", "manager");
  if (!chromium) {
    assert.equal(r.status, 503, JSON.stringify(r.json));
    assert.equal(r.json.code, "IN_SNAPSHOT_UNAVAILABLE");
    return;
  }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition"), /Insights-CY2013\.pdf/);
  const { PDFDocument } = require("pdf-lib");
  const doc = await PDFDocument.load(r.buffer);
  assert.equal(doc.getPageCount(), 1);
  const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  assert.ok(w > h, "landscape");
  void fs;
  void ROOT;
  void withDb;
});
