// Unit tests for src/services/duplicateEntry.ts: who may Replace a saved entry
// (Replace deletes it) and what the duplicate answer says about who entered it.
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { replaceRefusal, duplicateOwner, duplicateView } = require(path.resolve("dist/services/duplicateEntry.js"));

const asha = { user_id: 1, name: "Asha", last_name: "Rao", email: "asha@x.test" };
const pending = { status: "pending", created_by: asha };

test("a User replaces only their own entry that isn't approved", () => {
  assert.equal(replaceRefusal(pending, 1, "User"), null);
  assert.equal(replaceRefusal({ status: "rejected", created_by: asha }, 1, "User"), null);
  assert.match(replaceRefusal(pending, 2, "User"), /Someone else entered this/);
  assert.match(replaceRefusal({ status: "approved", created_by: asha }, 1, "User"), /already approved/);
  assert.match(replaceRefusal({ status: "pending", created_by: null }, 1, "User"), /Someone else/);
});

test("Managers, Admins and Superadmins replace as before", () => {
  for (const role of ["Manager", "Admin", "Superadmin"]) {
    assert.equal(replaceRefusal({ status: "approved", created_by: asha }, 9, role), null, role);
  }
});

test("the answer says who entered it and whether the caller may replace it", () => {
  assert.deepEqual(duplicateOwner(pending, 2, "User"), { entered_by: { name: "Asha Rao", you: false }, can_replace: false });
  assert.deepEqual(duplicateOwner(pending, 1, "User"), { entered_by: { name: "Asha Rao", you: true }, can_replace: true });
  assert.deepEqual(duplicateOwner({ status: "pending", created_by: null }, 1, "Manager"), { entered_by: { name: null, you: false }, can_replace: true });
});

test("the saved entry shows the person by name only, never their email", () => {
  const view = duplicateView({ pk_id: 5, status: "pending", total_emission: 2.5, created_by: asha });
  assert.deepEqual(view.created_by, { user_id: 1, name: "Asha", last_name: "Rao" });
  assert.equal(view.total_emission, 2.5);
  assert.equal(JSON.stringify(view).includes("asha@x.test"), false);
});
