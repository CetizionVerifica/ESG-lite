// #209 · migrate:kpi-tonnes-decimals (src/scripts/migrateKpiTonnesDecimals.ts) on a stub manager:
//   - the applySeed rule: only rows no person saved (`edited_at` null), in the read and again in
//     the update; `edited_at` is never stamped; only `decimals` is written;
//   - only units the KPI registry reads as tonnes of CO₂e (normaliseUnit → "tco2e"): not kg, not
//     an intensity, not a row without a unit;
//   - nothing to do → no update; a database without kpi_definition → a clear error.
// The database run (twice clean, edited rows kept, a re-seed keeping it) is in
// ci/api/tests/kpi-209-tonnes-decimals.test.cjs.
//   npm run build && node --test ci/unit/kpi-209-tonnes-decimals.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.resolve("dist/scripts/migrateKpiTonnesDecimals.js"));
const { TONNES_DP } = require(path.resolve("dist/services/emissionWrite/round.js"));

test("the SQL keeps a person's decimals and writes nothing but decimals", () => {
  assert.equal(M.TONNES_UNIT_KEY, "tco2e");
  for (const sql of [M.TONNES_DECIMALS_CANDIDATES, M.SET_TONNES_DECIMALS]) {
    assert.match(sql, /"edited_at" IS NULL/, "only rows no person saved");
    assert.match(sql, /"decimals" <> \$1/, "only rows not there yet: a second run finds nothing");
    assert.doesNotMatch(sql, /SET[^]*"edited_at"\s*=/, "edited_at is never stamped");
  }
  assert.match(M.SET_TONNES_DECIMALS, /^UPDATE "kpi_definition" SET "decimals" = \$1 WHERE /);
  assert.match(M.SET_TONNES_DECIMALS, /"id" = ANY\(\$2::int\[\]\)/);
});

// A stub of the rows the candidate query would return (edited_at null, decimals <> 3).
const stub = (rows, { table = true } = {}) => {
  const calls = [];
  const m = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("to_regclass")) return [{ ok: table }];
      if (sql === M.TONNES_DECIMALS_CANDIDATES) return rows;
      if (sql.includes(M.SET_TONNES_DECIMALS)) return [{ n: params[1].length }];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  return { m, calls };
};

test("only tonnes-of-CO₂e units move, whatever their spelling", async () => {
  const { m, calls } = stub([
    { id: 1, canonical_unit: "tCO2e" },
    { id: 2, canonical_unit: "tCO₂e" },
    { id: 3, canonical_unit: "t CO2e" },
    { id: 4, canonical_unit: "tonnes CO2e" },
    { id: 5, canonical_unit: "kgCO2e" },
    { id: 6, canonical_unit: "tCO2e per INR crore" },
    { id: 7, canonical_unit: "kL" },
    { id: 8, canonical_unit: "" },
  ]);
  assert.equal(await M.setTonnesDecimals(m), 4);
  const cand = calls.find((c) => c.sql === M.TONNES_DECIMALS_CANDIDATES);
  assert.deepEqual(cand.params, [TONNES_DP]);
  const upd = calls.find((c) => c.sql.includes(M.SET_TONNES_DECIMALS));
  assert.deepEqual(upd.params, [TONNES_DP, [1, 2, 3, 4]]);
});

test("nothing to move → no update; no table → a clear error", async () => {
  const none = stub([{ id: 9, canonical_unit: "kWh" }]);
  assert.equal(await M.setTonnesDecimals(none.m), 0);
  assert.ok(!none.calls.some((c) => c.sql.startsWith("WITH") || c.sql.startsWith("UPDATE")), "no update issued");
  const empty = stub([]);
  assert.equal(await M.setTonnesDecimals(empty.m), 0);
  const missing = stub([], { table: false });
  await assert.rejects(M.setTonnesDecimals(missing.m), /kpi_definition is missing: run migrate:kpi-library first/);
  assert.equal(missing.calls.length, 1, "nothing read or written");
});

test("the script is registered after the library seed, so a fresh database ends at 3 too", () => {
  const pkg = require(path.resolve("package.json"));
  const names = Object.keys(pkg.scripts).filter((k) => k.startsWith("migrate:"));
  assert.equal(pkg.scripts["migrate:kpi-tonnes-decimals"], "ts-node src/scripts/migrateKpiTonnesDecimals.ts");
  assert.ok(names.indexOf("migrate:kpi-tonnes-decimals") > names.indexOf("migrate:kpi-library-seed"), "runs after migrate:kpi-library-seed");
});
