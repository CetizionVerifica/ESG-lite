// IM4 unit tests: the pure parts of upload-pending notifications (recipient
// rules, message wording, email preference). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { buildUploadNotifications, monthsLabel, batchLink, UPLOAD_PENDING_PREF } = require(path.resolve("dist/services/uploadNotify.js"));
const { NOTIFICATION_GROUPS } = require(path.resolve("dist/services/notificationService.js"));

const event = (over = {}) => ({
  upload_batch_id: "b-1",
  company_id: 1,
  created_by: 1,
  channel: "mcp",
  source_name: "fuel.xlsx",
  site_ids: [1, 2],
  rows: 312,
  tco2e: 41.23,
  months: ["2026-03", "2026-04", "2026-05", "2026-06"],
  ...over,
});

const mgr = (user_id, over = {}) => ({ user_id, name: `M${user_id}`, email: `m${user_id}@example.invalid`, notification_preferences: {}, ...over });

test("months label: one month, a range in one year, a range across years", () => {
  assert.equal(monthsLabel(["2026-03"]), "Mar 2026");
  assert.equal(monthsLabel(["2026-06", "2026-03", "2026-04"]), "Mar–Jun 2026");
  assert.equal(monthsLabel(["2025-11", "2026-02"]), "Nov 2025–Feb 2026");
  assert.equal(monthsLabel([]), "");
});

test("one notification per recipient, never the uploader, with the batch link and meta", () => {
  const out = buildUploadNotifications(event(), [mgr(2), mgr(2), mgr(1), mgr(3)], "Asha", ["Plant 2", "Plant 3"]);
  assert.deepEqual(out.map((n) => n.user_id), [2, 3]);
  const n = out[0];
  assert.equal(n.type, "UPLOAD_PENDING");
  assert.equal(n.title, "Entries waiting for your review");
  assert.equal(n.message, "Asha uploaded 312 entries for Plant 2, Plant 3 (Mar–Jun 2026). 41.230 tCO₂e waiting for review");
  assert.equal(n.link, "/data/approvals?view=batches&batch=b-1");
  assert.deepEqual(n.meta, { upload_batch_id: "b-1", rows: 312, tco2e: 41.23, site_ids: [1, 2], months: event().months, channel: "mcp" });
  assert.deepEqual(n.email, { email: "m2@example.invalid", name: "M2" });
});

test("email is skipped when the preference is off or there is no address; the bell still rings", () => {
  const out = buildUploadNotifications(
    event(),
    [mgr(2, { notification_preferences: { [UPLOAD_PENDING_PREF]: false } }), mgr(3, { email: null }), mgr(4, { notification_preferences: null })],
    "Asha",
    ["Plant 2"]
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].email, null);
  assert.equal(out[1].email, null);
  assert.deepEqual(out[2].email, { email: "m4@example.invalid", name: "M4" });
});

test("singular wording and a batch id that needs escaping", () => {
  const out = buildUploadNotifications(event({ rows: 1, tco2e: 0.05, months: [] }), [mgr(2)], "Asha", []);
  assert.equal(out[0].message, "Asha uploaded 1 entry for your sites. 0.050 tCO₂e waiting for review");
  assert.equal(batchLink("a b&c"), "/data/approvals?view=batches&batch=a%20b%26c");
});

test("UPLOAD_PENDING has its own P13 group", () => {
  assert.deepEqual(NOTIFICATION_GROUPS.uploads, ["UPLOAD_PENDING"]);
});

test("the email template escapes site names and the period", () => {
  const { uploadPendingTemplate } = require(path.resolve("dist/templates/emailTemplates.js"));
  const t = uploadPendingTemplate("Mia", 3, 1.25, ['Plant <b>A</b> & "B"'], "Mar 2026", "/data/approvals?view=batches&batch=x");
  assert.ok(!t.html.includes("<b>A</b>"));
  assert.ok(t.html.includes("Plant &lt;b&gt;A&lt;/b&gt; &amp; &quot;B&quot;"));
  assert.ok(t.html.includes("Review entries"));
});
