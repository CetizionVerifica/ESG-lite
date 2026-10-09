// Deadline reminders (workers/deadlineScheduler.ts): who still owes data for a
// month. Runs the scheduler's query in-process against the fixture database;
// it must agree with the "todo" categories of GET /user/my-month.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call } = require("../helpers.cjs");

const dist = path.resolve(__dirname, "../../../dist");
const { AppDataSource } = require(path.join(dist, "config/data-source.js"));
const { getUsersWithNoSubmissions } = require(path.join(dist, "workers/deadlineScheduler.js"));

test.before(async () => {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
});
test.after(async () => {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

const owed = (pending) =>
  pending
    .map((p) => `${p.user_id}@${p.siteId}: ${[...p.categories].sort().join(", ")}`)
    .sort();

test("a colleague's entries clear the site; missing categories still owe (Sep 2025)", async () => {
  const pending = await getUsersWithNoSubmissions(2025, 9);
  assert.deepEqual(owed(pending), [
    // Filed 3 of 4 categories; Renewable Electricity is still missing.
    "1@1: Renewable Electricity",
    // Filed nothing themselves, but user 1 filed both their granted categories at
    // Plant A; at Plant B the FY batch covers electricity, combustion is missing.
    "7@2: Stationary Combustion",
  ]);
});

test("reminders match the todo categories of /user/my-month", async () => {
  const pending = await getUsersWithNoSubmissions(2025, 9);
  for (const [who, userId] of [["user", 1], ["multiSiteUser", 7], ["otherUser", 4]]) {
    const res = await call("GET", "/user/my-month?month=2025-09", who);
    assert.equal(res.status, 200);
    const todo = res.json.sites
      .map((s) => ({ siteId: s.site_id, categories: s.categories.filter((c) => c.status === "todo").map((c) => c.category_name) }))
      .filter((s) => s.categories.length)
      .map((s) => `${userId}@${s.siteId}: ${s.categories.sort().join(", ")}`);
    assert.deepEqual(todo.sort(), owed(pending.filter((p) => p.user_id === userId)), who);
  }
});

test("a yearly batch covers the months of its period", async () => {
  // Purchased Electricity at site 1 is filed as CY 2024 (pk 13), so in May
  // 2024 user 1 owes only Business Travel and Purchased Electricity is clear.
  const pending = await getUsersWithNoSubmissions(2024, 5);
  assert.deepEqual(owed(pending.filter((p) => p.user_id === 1)), ["1@1: Business Travel"]);
});
