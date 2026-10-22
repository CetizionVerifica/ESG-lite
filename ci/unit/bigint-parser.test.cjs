// #191 PR 1: node-postgres returns bigint (int8, OID 20) as a string unless told otherwise.
// The app registers a parser so widened ids and uncast count(*) come back as numbers.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { types } = require("pg");
const { parseBigint, registerPgTypeParsers } = require(path.resolve("dist/config/pgTypes.js"));

test("a bigint value is read as an exact number", () => {
  assert.equal(parseBigint("9007199254740"), 9007199254740);
  assert.equal(parseBigint("3000000000"), 3000000000);
  assert.equal(parseBigint("0"), 0);
  assert.equal(parseBigint("-42"), -42);
  assert.equal(parseBigint(null), null);
  assert.equal(Number.isSafeInteger(parseBigint(String(Number.MAX_SAFE_INTEGER))), true);
});

test("registering puts the parsers on pg's int8 and int8[] types, the ones every pool connection reads", () => {
  registerPgTypeParsers();
  const parse = types.getTypeParser(types.builtins.INT8, "text");
  assert.equal(parse("9007199254740"), 9007199254740);
  assert.equal(typeof parse("12"), "number");
  // bigint[] (pcf_result.emission_ids_used after part 2): every element a number, nulls kept.
  const parseArray = types.getTypeParser(1016, "text");
  assert.deepEqual(parseArray("{3000000001,7,NULL}"), [3000000001, 7, null]);
  assert.deepEqual(parseArray("{}"), []);
  // Registering twice doesn't wrap twice.
  registerPgTypeParsers();
  assert.deepEqual(types.getTypeParser(1016, "text")("{1,2}"), [1, 2]);
  // Other types are left alone: numeric (factors, totals) stays a string for exact decimals.
  assert.equal(typeof types.getTypeParser(types.builtins.NUMERIC, "text")("1.25"), "string");
});
