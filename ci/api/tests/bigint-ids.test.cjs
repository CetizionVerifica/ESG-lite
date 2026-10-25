// #191: bigint values reach the code and the API as JSON numbers. node-postgres
// returns int8 as a string by default; src/config/pgTypes.ts (installed by the
// data source) turns int8 and int8[] into numbers, and a generated bigint id
// keeps its number through save().
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test("the server's data source returns int8, count(*) and int8[] as numbers", async () => {
  const { AppDataSource } = require(path.resolve(__dirname, "../../../dist/config/data-source.js"));
  await AppDataSource.initialize();
  try {
    const [row] = await AppDataSource.query(
      `SELECT 9007199254740::bigint AS big, (SELECT count(*) FROM emission) AS n,
              ARRAY[1, NULL, 3000000001]::bigint[] AS ids, 9007199254740993::bigint AS beyond`,
    );
    assert.equal(row.big, 9007199254740);
    assert.equal(typeof row.n, "number");
    assert.deepEqual(row.ids, [1, null, 3000000001]);
    // Past 2^53 - 1 a Number would round, so the exact string comes back instead.
    assert.equal(row.beyond, "9007199254740993");
  } finally {
    await AppDataSource.destroy();
  }
});

test("a new entry's pk_id is a JSON number, in the create response and the list", async () => {
  const r = await call("POST", "/user/emissions", "user", {
    site_id: 1, category_id: 3, activity_data: { Trip: "Pune" }, unit: "tCO2e",
    date_of_reporting: "2025-07-31", reporting_period: "monthly",
  });
  const id = r.json?.emission?.pk_id;
  try {
    assert.equal(r.status, 201);
    assert.equal(typeof id, "number");
    const list = await call("GET", "/user/emissions/site/1/category/3", "user");
    assert.equal(list.status, 200);
    const mine = list.json.find((e) => e.pk_id === id);
    assert.ok(mine, "the new entry is in the list with the same numeric pk_id");
  } finally {
    if (id) {
      await q("DELETE FROM emission WHERE pk_id = $1", [id]);
      await q("DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1", [id]);
    }
  }
});
