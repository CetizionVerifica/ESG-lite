// #191: node-postgres hands bigint (int8) and bigint[] to the code as numbers,
// not strings, so widened ids and count(*) stay JSON numbers. Pure parser
// checks; ci/api/tests/bigint-ids.test.cjs runs them against Postgres.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseBigint, bigintArrayParser, installPgTypeParsers, PG_INT8_OID, PG_INT8_ARRAY_OID } = require(path.resolve("dist/config/pgTypes.js"));

test("int8 text becomes a number, null stays null", () => {
  assert.equal(parseBigint("0"), 0);
  assert.equal(parseBigint("5"), 5);
  assert.equal(parseBigint("-12"), -12);
  assert.equal(parseBigint("3000000001"), 3000000001);
  assert.equal(parseBigint("9007199254740"), 9007199254740);
  assert.equal(parseBigint("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseBigint(null), null);
});

test("an int8 beyond 2^53 - 1 is kept as its exact string, never rounded", () => {
  assert.equal(parseBigint("9007199254740993"), "9007199254740993");
  assert.equal(parseBigint("-9223372036854775808"), "-9223372036854775808");
});

test("int8[] entries become numbers, nulls and nesting are kept", () => {
  const { types } = require("pg");
  const parse = bigintArrayParser(types.getTypeParser(PG_INT8_ARRAY_OID));
  assert.deepEqual(parse("{1,2,3000000001}"), [1, 2, 3000000001]);
  assert.deepEqual(parse("{1,NULL,3}"), [1, null, 3]);
  assert.deepEqual(parse("{{1,2},{3,4}}"), [[1, 2], [3, 4]]);
  assert.deepEqual(parse("{}"), []);
  assert.equal(parse(null), null);
});

test("installPgTypeParsers sets both parsers once", () => {
  const set = new Map();
  const fake = { setTypeParser: (oid, fn) => set.set(oid, fn), getTypeParser: () => (v) => v.slice(1, -1).split(",") };
  installPgTypeParsers(fake);
  assert.deepEqual([...set.keys()].sort((a, b) => a - b), [PG_INT8_OID, PG_INT8_ARRAY_OID]);
  assert.equal(set.get(PG_INT8_OID)("42"), 42);
  assert.deepEqual(set.get(PG_INT8_ARRAY_OID)("{7,8}"), [7, 8]);
  set.clear();
  installPgTypeParsers(fake);
  assert.equal(set.size, 0);
});

test("loading the data source installs them on the pg the server uses", () => {
  require(path.resolve("dist/config/data-source.js"));
  const { types } = require("pg");
  assert.equal(types.getTypeParser(PG_INT8_OID)("9007199254740"), 9007199254740);
  assert.deepEqual(types.getTypeParser(PG_INT8_ARRAY_OID)("{1,2}"), [1, 2]);
});

test("a generated bigint id keeps its number: the transformer undoes TypeORM's String() after save()", () => {
  const { bigintId } = require(path.resolve("dist/entities/bigintId.js"));
  assert.equal(bigintId.from("3000000001"), 3000000001);
  assert.equal(bigintId.from(42), 42);
  assert.equal(bigintId.from(null), null);
  assert.equal(bigintId.from("9007199254740993"), "9007199254740993");
  assert.equal(bigintId.to(7), 7);
});

test("PrimaryGeneratedBigintColumn is a BIGSERIAL primary key, and a relation to it gets a bigint join column", async () => {
  const typeorm = require("typeorm");
  const { PrimaryGeneratedBigintColumn, bigintId } = require(path.resolve("dist/entities/bigintId.js"));
  class BigParent {}
  class BigChild {}
  PrimaryGeneratedBigintColumn()(BigParent.prototype, "id");
  typeorm.Entity("ci_big_parent")(BigParent);
  PrimaryGeneratedBigintColumn()(BigChild.prototype, "id");
  typeorm.ManyToOne(() => BigParent)(BigChild.prototype, "parent");
  typeorm.JoinColumn({ name: "parent_id" })(BigChild.prototype, "parent");
  typeorm.Entity("ci_big_child")(BigChild);
  const ds = new typeorm.DataSource({ type: "postgres", entities: [BigParent, BigChild] });
  await ds.buildMetadatas();
  const [pk] = ds.getMetadata(BigParent).primaryColumns;
  assert.equal(pk.type, "bigint");
  assert.equal(pk.generationStrategy, "increment");
  assert.equal(pk.transformer, bigintId);
  const join = ds.getMetadata(BigChild).columns.find((c) => c.databaseName === "parent_id");
  assert.equal(join.type, "bigint");
});
