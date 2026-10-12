// Unit tests for the category filter parser shared by the emissions list,
// batches, export and overview. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseCategoryIds, hasInvalidCategoryIds } = require(path.resolve("dist/utils/parseCategoryIds.js"));

test("reads categoryIds, else categoryId, as a de-duplicated list", () => {
  assert.deepEqual(parseCategoryIds({ categoryIds: "3, 1,3" }), [3, 1]);
  assert.deepEqual(parseCategoryIds({ categoryIds: ["2", "4,5"] }), [2, 4, 5]);
  assert.deepEqual(parseCategoryIds({ categoryId: "7" }), [7]);
  assert.deepEqual(parseCategoryIds({ categoryIds: "", categoryId: "7" }), [7]);
  assert.deepEqual(parseCategoryIds({}), []);
});

test("flags ids that aren't usable, and overlong lists", () => {
  assert.equal(hasInvalidCategoryIds({}), false);
  assert.equal(hasInvalidCategoryIds({ categoryIds: "", categoryId: "" }), false);
  assert.equal(hasInvalidCategoryIds({ categoryIds: "1,2" }), false);
  assert.equal(hasInvalidCategoryIds({ categoryIds: "2147483647" }), false);
  for (const bad of ["0", "abc", "1,-2", "1,", "1.5", "2147483648"]) {
    assert.equal(hasInvalidCategoryIds({ categoryIds: bad }), true, bad);
  }
  assert.equal(hasInvalidCategoryIds({ categoryId: "0" }), true);
  assert.equal(hasInvalidCategoryIds({ categoryIds: Array.from({ length: 101 }, (_, i) => i + 1).join(",") }), true);
});
