// P13 Notifications: GET /notifications filters by type group across every
// page, and notifications carry structured meta (reviewer, reason).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call } = require("../helpers.cjs");

const dist = path.resolve(__dirname, "../../../dist");
const { AppDataSource } = require(path.join(dist, "config/data-source.js"));
const { createNotification } = require(path.join(dist, "services/notificationService.js"));

// Superadmin (user 5): no other test reads its notifications.
const WHO = "superadmin";
const USER_ID = 5;

test.before(async () => {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  // Oldest first, so the newest is DEADLINE_ESCALATION.
  const rows = [
    ["APPROVED", "Emission Approved", "Your Diesel emission for Plant A was approved by Mia Manager", { reviewer: "Mia Manager" }],
    ["REJECTED", "Emission Rejected", "Your Diesel emission for Plant A was rejected by Mia Manager. Reason: Wrong unit", { reviewer: "Mia Manager", reason: "Wrong unit" }],
    ["BULK_APPROVED", "Emissions Approved", "3 emission(s) approved by Mia Manager", { reviewer: "Mia Manager" }],
    ["PRODUCTION_REJECTED", "Production Data Rejected", "Your Rod production data was rejected by Mia Manager", { reviewer: "Mia Manager", reason: null }],
    ["DEADLINE_REMINDER", "Submission Reminder", "You haven't submitted data for September 2025 (Plant A)", null],
    ["SYSTEM", "Welcome", "Welcome to ESGLite", null],
    ["DEADLINE_ESCALATION", "Pending Submissions", "2 user(s) haven't submitted data for September 2025", null],
  ];
  for (const [type, title, message, meta] of rows) {
    await createNotification(USER_ID, type, title, message, "/my-emissions", meta);
  }
});
test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

const types = (res) => res.json.notifications.map((n) => n.type);

test("no type returns everything, newest first (unchanged)", async () => {
  const res = await call("GET", "/notifications?limit=50", WHO);
  assert.equal(res.status, 200);
  assert.equal(res.json.total, 7);
  assert.equal(types(res)[0], "DEADLINE_ESCALATION");
});

test("type groups filter server-side and count the whole set", async () => {
  const approvals = await call("GET", "/notifications?type=approvals", WHO);
  assert.deepEqual(types(approvals), ["BULK_APPROVED", "APPROVED"]);
  assert.equal(approvals.json.total, 2);

  const rejections = await call("GET", "/notifications?type=rejections", WHO);
  assert.deepEqual(types(rejections), ["PRODUCTION_REJECTED", "REJECTED"]);

  // REMINDER, DEADLINE and ESCALATION all count as reminders.
  const reminders = await call("GET", "/notifications?type=reminders", WHO);
  assert.deepEqual(types(reminders), ["DEADLINE_ESCALATION", "DEADLINE_REMINDER"]);

  // Paging applies after the filter.
  const page2 = await call("GET", "/notifications?type=approvals&page=2&limit=1", WHO);
  assert.deepEqual(types(page2), ["APPROVED"]);
  assert.equal(page2.json.total, 2);
});

test("type combines with unread, and unknown types are rejected", async () => {
  const unread = await call("GET", "/notifications?type=rejections&unread=true", WHO);
  assert.equal(unread.json.total, 2);
  assert.equal((await call("GET", "/notifications?type=everything", WHO)).status, 400);
  assert.equal((await call("GET", "/notifications?type=approvals", null)).status, 401);
});

test("meta carries reviewer and reason; null where there is none", async () => {
  const res = await call("GET", "/notifications?type=rejections", WHO);
  const byType = Object.fromEntries(res.json.notifications.map((n) => [n.type, n.meta]));
  assert.deepEqual(byType.REJECTED, { reviewer: "Mia Manager", reason: "Wrong unit" });
  assert.deepEqual(byType.PRODUCTION_REJECTED, { reviewer: "Mia Manager", reason: null });
  const reminders = await call("GET", "/notifications?type=reminders", WHO);
  assert.ok(reminders.json.notifications.every((n) => n.meta === null));
});

test("other users never see these notifications", async () => {
  const res = await call("GET", "/notifications?type=approvals", "user");
  assert.equal(res.status, 200);
  assert.ok(res.json.notifications.every((n) => n.title !== "Emissions Approved" || n.message !== "3 emission(s) approved by Mia Manager"));
});
