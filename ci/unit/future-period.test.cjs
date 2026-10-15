// The future-period check shared by the manager edit and the contributor update:
// months and CY/FY years that haven't started are refused, judged by the
// earliest timezone (UTC+14) so nobody is refused their own current month.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { futurePeriodError } = require(path.resolve("dist/services/reportingPeriod.js"));

const at = (iso) => new Date(iso);

test("a month that has started anywhere is allowed; a later one is refused", () => {
  const now = at("2026-10-15T08:00:00Z");
  assert.equal(futurePeriodError("monthly", null, at("2026-10-31"), now), null);
  assert.equal(futurePeriodError("monthly", null, at("2025-02-28"), now), null);
  assert.match(futurePeriodError("monthly", null, at("2026-11-30"), now), /2026-11 is in the future/);
});

test("in Dubai just after midnight on the 1st, the new month already counts", () => {
  // 01:00 on 1 Nov in Asia/Dubai is 21:00 on 31 Oct in UTC.
  assert.equal(futurePeriodError("monthly", null, at("2026-11-01"), at("2026-10-31T21:00:00Z")), null);
});

test("a CY or FY year that hasn't started is refused", () => {
  const now = at("2026-10-15T08:00:00Z");
  assert.equal(futurePeriodError("yearly", "CY", at("2026-12-31"), now), null);
  assert.match(futurePeriodError("yearly", "CY", at("2027-12-31"), now), /CY 2027 has not started yet/);
  assert.equal(futurePeriodError("yearly", "FY", at("2027-03-31"), now), null);   // FY 2026-27 started in April 2026
  assert.match(futurePeriodError("yearly", "FY", at("2028-03-31"), now), /FY 2028 has not started yet/);
});

test("an invalid date is left to the other checks", () => {
  assert.equal(futurePeriodError("monthly", null, new Date("nope")), null);
});
