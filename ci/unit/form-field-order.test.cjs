// Unit tests for a form's field order (src/forms/columnOrder.ts). Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { orderColumns, orderFromIds, orderWithAdded, orderWithSwap } = require(path.resolve("dist/forms/columnOrder.js"));

const col = (pk_id) => ({ pk_id, column_name: `c${pk_id}` });
const ids = (cols) => cols.map((c) => c.pk_id);

test("fields read back in the saved order, whatever order the database gave", () => {
  assert.deepEqual(ids(orderColumns([col(3), col(1), col(2)], [2, 3, 1])), [2, 3, 1]);
});

test("no saved order keeps the fields as read (forms saved before the column)", () => {
  const read = [col(3), col(1), col(2)];
  assert.deepEqual(ids(orderColumns(read, null)), [3, 1, 2]);
  assert.deepEqual(ids(orderColumns(read, [])), [3, 1, 2]);
});

test("a field the order doesn't name goes after the named ones; a named field that's gone is ignored", () => {
  assert.deepEqual(ids(orderColumns([col(5), col(1), col(4), col(2)], [2, 9, 1])), [2, 1, 5, 4]);
});

test("the order to store is the ids as sent, numbers only, without repeats", () => {
  assert.deepEqual(orderFromIds([3, "1", 3, 2, null, "x", 0]), [3, 1, 2]);
});

test("added fields go last; a swapped field takes the old one's place", () => {
  assert.deepEqual(orderWithAdded([col(2), col(1)], [col(7)]), [2, 1, 7]);
  assert.deepEqual(orderWithSwap([2, 1, 7], 1, 8), [2, 8, 7]);
  assert.equal(orderWithSwap(null, 1, 8), null);
});
