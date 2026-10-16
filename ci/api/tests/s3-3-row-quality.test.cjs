// S3-3 · the method backfill (migrate:scope3-row-quality).
//
// The module spec asks for "the backfill run twice" as an API test: every
// branch of the backfill lands on the method the spec names, Scope 1 and
// Scope 2 rows keep a null method, a row that already names a method is never
// overwritten, and a second run changes nothing.
//
// The migration is run as its own process, the way migrate-all does it, so
// this covers the script that production will run rather than a copy of its
// SQL.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const COMPILED = path.join(ROOT, "dist/scripts/addEmissionRowQualityColumns.js");

// Ids well clear of ci/api/fixture.sql so the fixture's own rows stay as they are.
const PER_UNIT_CATEGORY = 9301;
const PER_METHOD_CATEGORY = 9302;
const PLAIN_CATEGORY = 9303;
const SCOPE1_CATEGORY = 9304;
const FIRST_EMISSION = 93001;

const ROWS = [
  { pk_id: FIRST_EMISSION, category_id: PER_UNIT_CATEGORY, unit: "tonne.km", activity_data_unit: "tonne.km", method: null, expected: "distance_based" },
  { pk_id: FIRST_EMISSION + 1, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "Tonne KM", method: null, expected: "distance_based" },
  { pk_id: FIRST_EMISSION + 2, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "km", method: null, expected: "distance_based" },
  // A currency wins over the form: a per_unit form priced in money is spend-based.
  { pk_id: FIRST_EMISSION + 3, category_id: PER_UNIT_CATEGORY, unit: "kg", activity_data_unit: "usd", method: null, expected: "spend_based" },
  { pk_id: FIRST_EMISSION + 4, category_id: PLAIN_CATEGORY, unit: "INR", activity_data_unit: null, method: null, expected: "spend_based" },
  { pk_id: FIRST_EMISSION + 5, category_id: PER_METHOD_CATEGORY, unit: "kg", activity_data_unit: null, method: null, expected: "direct_use" },
  { pk_id: FIRST_EMISSION + 6, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, method: null, expected: "average_data" },
  // No site, so no form to read: still a Scope 3 row and still gets a method.
  { pk_id: FIRST_EMISSION + 7, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, site: null, method: null, expected: "average_data" },
  // Scope 1 is not a Scope 3 idea.
  { pk_id: FIRST_EMISSION + 8, category_id: SCOPE1_CATEGORY, unit: "kwh", activity_data_unit: null, method: null, expected: null },
  // Already answered: the backfill must leave it alone.
  { pk_id: FIRST_EMISSION + 9, category_id: PLAIN_CATEGORY, unit: "kg", activity_data_unit: null, method: "supplier_specific", expected: "supplier_specific" },
];

async function seed(db) {
  await db.query(
    `INSERT INTO category (category_id, category_name, scope) VALUES
       ($1, 'S3-3 transport form', 'Scope 3'),
       ($2, 'S3-3 use of sold form', 'Scope 3'),
       ($3, 'S3-3 no form', 'Scope 3'),
       ($4, 'S3-3 scope 1', 'Scope 1')
     ON CONFLICT (category_id) DO NOTHING`,
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY, PLAIN_CATEGORY, SCOPE1_CATEGORY],
  );
  // Two forms for the same site × category: the backfill must read the first
  // one and must not multiply the row.
  await db.query(
    `INSERT INTO column_config (config_name, site_id, category_id, calculation) VALUES
       ('s3-3 per_unit', 1, $1, '{"mode":"per_unit","methods":{}}'),
       ('s3-3 per_unit twin', 1, $1, '{"mode":"per_method","methods":{}}'),
       ('s3-3 per_method', 1, $2, '{"mode":"per_method","methods":{}}')`,
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY],
  );
  for (const row of ROWS) {
    await db.query(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, activity_data_unit,
                             date_of_reporting, category_id, site_id, method)
       VALUES ($1, '{"activity_value": 1}', 1, $2, $3, '2026-01-31', $4, $5, $6)`,
      [row.pk_id, row.unit, row.activity_data_unit, row.category_id, row.site === null ? null : 1, row.method],
    );
  }
}

async function cleanUp(db) {
  await db.query(`DELETE FROM emission WHERE pk_id >= $1`, [FIRST_EMISSION]);
  await db.query(`DELETE FROM column_config WHERE category_id = ANY($1)`, [[PER_UNIT_CATEGORY, PER_METHOD_CATEGORY]]);
  await db.query(`DELETE FROM category WHERE category_id = ANY($1)`, [
    [PER_UNIT_CATEGORY, PER_METHOD_CATEGORY, PLAIN_CATEGORY, SCOPE1_CATEGORY],
  ]);
}

function runMigration() {
  const run = fs.existsSync(COMPILED)
    ? spawnSync(process.execPath, [COMPILED], { cwd: ROOT, env: process.env, encoding: "utf8" })
    : spawnSync("npm", ["run", "--silent", "migrate:scope3-row-quality"], {
        cwd: ROOT,
        env: process.env,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  assert.equal(run.status, 0, `migrate:scope3-row-quality failed:\n${output}`);
  const backfilled = /Backfilled method on (\d+) Scope 3 emission row\(s\)/.exec(output);
  assert.ok(backfilled, `migration did not report its backfill:\n${output}`);
  return Number(backfilled[1]);
}

const methodsById = async (db) => {
  const { rows } = await db.query(`SELECT pk_id, method, is_estimate, dq, data_type FROM emission WHERE pk_id >= $1`, [
    FIRST_EMISSION,
  ]);
  return new Map(rows.map((row) => [Number(row.pk_id), row]));
};

test("the method backfill reads the form and the unit, and runs twice unchanged", async (t) => {
  await withDb(async (db) => {
    await cleanUp(db);
    await seed(db);
    t.after(() => withDb(cleanUp));

    const firstPass = runMigration();
    // Every seeded Scope 3 row without a method, plus any fixture Scope 3 row
    // the suite has not already backfilled.
    assert.ok(firstPass >= 8, `expected at least the 8 seeded rows, got ${firstPass}`);

    const afterFirst = await methodsById(db);
    for (const row of ROWS) {
      assert.equal(afterFirst.get(row.pk_id).method, row.expected, `row ${row.pk_id}`);
    }

    // New columns are additive: nothing else is written by the backfill.
    for (const row of ROWS) {
      const stored = afterFirst.get(row.pk_id);
      assert.equal(stored.is_estimate, false, `row ${row.pk_id} is_estimate`);
      assert.equal(stored.dq, null, `row ${row.pk_id} dq`);
      assert.equal(stored.data_type, null, `row ${row.pk_id} data_type`);
    }

    const secondPass = runMigration();
    assert.equal(secondPass, 0, "a second run must have nothing left to backfill");

    const afterSecond = await methodsById(db);
    for (const row of ROWS) {
      assert.equal(afterSecond.get(row.pk_id).method, row.expected, `row ${row.pk_id} after the second run`);
    }
  });
});

// ---------------------------------------------------------------------------
// The engine fill: a new row records how it was calculated and how good its
// data is, without changing what it calculates.

const S3_FACTOR = 9610;
const S1_FACTOR = 9611;
const S3_ACTIVITY = "S3-3 Flight";
const S1_ACTIVITY = "S3-3 Diesel";

test("a new Scope 3 row carries its method, data quality and data type", async (t) => {
  const created = [];
  await withDb(async (db) => {
    // Site 1 in the UAE, and a 2025 UAE factor: the reporting year is 2026, so
    // the factor is one year old — good on time, good on geography.
    await db.query(`INSERT INTO country (country_id, name, code) VALUES (961, 'S3-3 Testland', 'AE')
                    ON CONFLICT (code) DO NOTHING`);
    const { rows: country } = await db.query(`SELECT country_id FROM country WHERE code = 'AE'`);
    await db.query(`UPDATE site SET country_id = $1 WHERE site_id = 1`, [country[0].country_id]);
    await db.query(
      `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value,
                                     denominator_unit, source, emission_category_name, global_category_name,
                                     geography, factor_type, gwp_set)
       VALUES ($1, 1, 3, 2025, 1.00000000, 'km', 'CI', $2, $2, 'AE', 'life_cycle', 'AR6'),
              ($3, 1, 1, 2025, 2.00000000, 'litre', 'CI', $4, $4, 'AE', 'combustion', 'AR6')`,
      [S3_FACTOR, S3_ACTIVITY, S1_FACTOR, S1_ACTIVITY],
    );
  });
  t.after(() =>
    withDb(async (db) => {
      if (created.length) await db.query(`DELETE FROM emission WHERE pk_id = ANY($1)`, [created]);
      await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = ANY($1)`, [[S3_FACTOR, S1_FACTOR]]);
    }),
  );

  const scope3 = await call("POST", "/user/emissions", "user", {
    site_id: 1,
    category_id: 3,
    date_of_reporting: "2026-06-30",
    activity_data_unit: "km",
    activity_data: { emission_category: S3_ACTIVITY, activity_value: "100" },
  });
  assert.equal(scope3.status, 201, JSON.stringify(scope3.json));
  created.push(scope3.json.emission.pk_id);

  await withDb(async (db) => {
    const { rows } = await db.query(
      `SELECT method, dq, data_type, is_estimate, total_emission FROM emission WHERE pk_id = $1`,
      [scope3.json.emission.pk_id],
    );
    const row = rows[0];
    // No method named and no form methods offered, so the average-data method.
    assert.equal(row.method, "average_data");
    assert.equal(row.data_type, "secondary", "no evidence and not a specific method");
    assert.equal(row.is_estimate, false);
    assert.deepEqual(row.dq, {
      technology: 2, // a life-cycle factor, not the supplier's own
      geography: 1, // the site's own country
      time: 1, // a 2025 factor for a 2026 row
      completeness: 1, // not an estimate
      reliability: 2, // capped: no evidence document
      overall: 1, // the rounded mean of 2, 1, 1, 1, 2
      source: "auto",
    });
    // The quality never touches the figure: 100 km × 1 kg = 0.1 t.
    assert.equal(Number(row.total_emission), 0.1);
  });

  // A Scope 1 row carries none of it: a method is a Scope 3 idea.
  const scope1 = await call("POST", "/user/emissions", "user", {
    site_id: 1,
    category_id: 1,
    date_of_reporting: "2026-06-30",
    activity_data_unit: "litre",
    activity_data: { emission_category: S1_ACTIVITY, activity_value: "100" },
  });
  assert.equal(scope1.status, 201, JSON.stringify(scope1.json));
  created.push(scope1.json.emission.pk_id);

  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT method, dq, data_type FROM emission WHERE pk_id = $1`, [
      scope1.json.emission.pk_id,
    ]);
    assert.deepEqual(rows[0], { method: null, dq: null, data_type: null });
  });
});

// ---------------------------------------------------------------------------
// Part 3: what a caller may say, what comes back, and what evidence changes.

const FORM_CATEGORY = 3; // Business Travel, Scope 3

const postRow = (body) =>
  call("POST", "/user/emissions", "user", {
    site_id: 1,
    category_id: FORM_CATEGORY,
    activity_data_unit: "km",
    activity_data: { emission_category: S3_ACTIVITY, activity_value: "100" },
    ...body,
  });

async function withFactorAndForm(t, methodOptions) {
  const created = [];
  await withDb(async (db) => {
    await db.query(`INSERT INTO country (country_id, name, code) VALUES (961, 'S3-3 Testland', 'AE')
                    ON CONFLICT (code) DO NOTHING`);
    const { rows: country } = await db.query(`SELECT country_id FROM country WHERE code = 'AE'`);
    await db.query(`UPDATE site SET country_id = $1 WHERE site_id = 1`, [country[0].country_id]);
    await db.query(
      `INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value,
                                     denominator_unit, source, emission_category_name, global_category_name,
                                     geography, factor_type, gwp_set)
       VALUES ($1, 1, $2, 2025, 1.00000000, 'km', 'CI', $3, $3, 'AE', 'life_cycle', 'AR6')
       ON CONFLICT DO NOTHING`,
      [S3_FACTOR, FORM_CATEGORY, S3_ACTIVITY],
    );
    if (methodOptions) {
      await db.query(
        `INSERT INTO column_config (config_name, site_id, category_id, method_options)
         VALUES ('s3-3 methods', 1, $1, $2::jsonb)`,
        [FORM_CATEGORY, JSON.stringify(methodOptions)],
      );
    }
  });
  t.after(() =>
    withDb(async (db) => {
      if (created.length) await db.query(`DELETE FROM emission WHERE pk_id = ANY($1)`, [created]);
      await db.query(`DELETE FROM column_config WHERE config_name = 's3-3 methods'`);
      await db.query(`DELETE FROM emission_factors WHERE emission_factor_id = $1`, [S3_FACTOR]);
    }),
  );
  return created;
}

// column_config.method_options as 01-contracts §6 has it: [{method, units}].
const DISTANCE_AND_SPEND = [
  { method: "distance_based", units: ["km"] },
  { method: "spend_based", units: ["USD"] },
];

test("a method the form does not offer is refused, on the one engine", async (t) => {
  const created = await withFactorAndForm(t, DISTANCE_AND_SPEND);

  const refused = await postRow({ date_of_reporting: "2026-07-31", method: "supplier_specific" });
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "METHOD_NOT_ALLOWED");
  assert.match(refused.json.message, /This form offers: Distance travelled, From the amount spent\./, "it names the methods the form does offer");

  // A method ESGLite does not know at all is refused by name, never ignored.
  const nonsense = await postRow({ date_of_reporting: "2026-07-31", method: "teleportation" });
  assert.equal(nonsense.status, 400);
  assert.equal(nonsense.json.code, "FIELD_INVALID");
  assert.equal(nonsense.json.field, "method");

  // One the form does offer is stored as sent.
  const allowed = await postRow({ date_of_reporting: "2026-07-31", method: "spend_based", is_estimate: true });
  assert.equal(allowed.status, 201, JSON.stringify(allowed.json));
  created.push(allowed.json.emission.pk_id);
  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT method, is_estimate, dq FROM emission WHERE pk_id = $1`, [
      allowed.json.emission.pk_id,
    ]);
    assert.equal(rows[0].method, "spend_based");
    assert.equal(rows[0].is_estimate, true, "the estimate flag is saved (it never was before)");
    assert.equal(rows[0].dq.reliability, 3, "spend data is poor on reliability");
    assert.equal(rows[0].dq.source, "auto");
  });
});

test("a data quality sent by hand is stored as sent, with its overall derived", async (t) => {
  const created = await withFactorAndForm(t, null);
  const sent = await postRow({
    date_of_reporting: "2026-08-31",
    dq: { technology: 1, geography: 2, time: 2, completeness: 1, reliability: 1 },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  created.push(sent.json.emission.pk_id);

  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT dq FROM emission WHERE pk_id = $1`, [sent.json.emission.pk_id]);
    assert.deepEqual(rows[0].dq, {
      technology: 1,
      geography: 2,
      time: 2,
      completeness: 1,
      reliability: 1,
      overall: 1, // the rounded mean of 1, 2, 2, 1, 1
      source: "manual",
    });
  });

  const bad = await postRow({ date_of_reporting: "2026-09-30", dq: { technology: 9, geography: 1, time: 1, completeness: 1, reliability: 1 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.field, "dq.technology");
});

test("the list returns the fields and filters on them, within the caller's sites", async (t) => {
  const created = await withFactorAndForm(t, null);
  const row = await postRow({ date_of_reporting: "2026-10-31" });
  assert.equal(row.status, 201, JSON.stringify(row.json));
  created.push(row.json.emission.pk_id);

  const listed = await call("GET", "/user/emissions?categoryIds=3", "user");
  assert.equal(listed.status, 200);
  const mine = listed.json.find((e) => e.pk_id === row.json.emission.pk_id);
  assert.ok(mine, "the row is in the list");
  for (const field of ["method", "dq", "data_type", "is_estimate"]) {
    assert.ok(field in mine, `the list returns ${field}`);
  }
  assert.equal(mine.method, "average_data");
  assert.equal(mine.dq.overall, 1);

  const byMethod = await call("GET", "/user/emissions?method=average_data", "user");
  assert.equal(byMethod.status, 200);
  assert.ok(byMethod.json.some((e) => e.pk_id === row.json.emission.pk_id), "method= finds it");
  assert.ok(byMethod.json.every((e) => e.method === "average_data"), "and only rows with that method");

  const other = await call("GET", "/user/emissions?method=spend_based", "user");
  assert.ok(!other.json.some((e) => e.pk_id === row.json.emission.pk_id), "another method does not");

  const good = await call("GET", "/user/emissions?dq_max=1", "user");
  assert.ok(good.json.some((e) => e.pk_id === row.json.emission.pk_id), "dq_max=1 finds a good row");
  assert.ok(good.json.every((e) => e.dq && e.dq.overall <= 1), "and nothing worse, nor a row with no quality");

  assert.equal((await call("GET", "/user/emissions?method=teleportation", "user")).status, 400);
  assert.equal((await call("GET", "/user/emissions?dq_max=9", "user")).status, 400);

  // Tenant isolation: company 2 filtering never reaches company 1's rows.
  const crossed = await call("GET", "/user/emissions?method=average_data", "otherManager");
  assert.ok(!crossed.json.some((e) => e.pk_id === row.json.emission.pk_id), "company 2 cannot see it");
  assert.equal((await call("GET", "/user/emissions?method=average_data&siteIds=1", "otherManager")).status, 403);
});

test("attaching evidence lifts reliability, removing it lowers it again, and the total never moves", async (t) => {
  const created = await withFactorAndForm(t, [
    { method: "supplier_specific", units: ["km"] },
    { method: "average_data", units: ["km"] },
  ]);
  // S3-6: the supplier-specific method calculates from a supplier's own
  // figure, so the row names a supplier that has one (same unit and year as
  // the factor, so the total and the other indicators read the same).
  const supplierId = await withDb(async (db) => {
    const { rows } = await db.query(`INSERT INTO "supplier" (company_id, name, country) VALUES (1, 'S3-3 evidence supplier', 'AE') RETURNING supplier_id`);
    await db.query(
      `INSERT INTO supplier_factor (company_id, supplier_id, item, unit, kgco2e_per_unit, reference_year, gwp_set) VALUES (1, $1, $2, 'km', 1, 2026, 'AR6')`,
      [rows[0].supplier_id, S3_ACTIVITY],
    );
    return rows[0].supplier_id;
  });
  t.after(() => withDb((db) => db.query(`DELETE FROM "supplier" WHERE supplier_id = $1`, [supplierId])));
  const row = await postRow({ date_of_reporting: "2026-11-30", method: "supplier_specific", supplier_id: supplierId });
  assert.equal(row.status, 201, JSON.stringify(row.json));
  const pk = row.json.emission.pk_id;
  created.push(pk);

  const before = await withDb(async (db) => (await db.query(`SELECT dq, total_emission FROM emission WHERE pk_id = $1`, [pk])).rows[0]);
  assert.equal(before.dq.reliability, 2, "no document yet, so capped at fair");

  const form = new FormData();
  form.append("file", new Blob([`evidence for ${pk}`], { type: "application/pdf" }), "invoice.pdf");
  form.append("emission_id", String(pk));
  const upload = await call("POST", "/user/documents", "user", form);
  assert.equal(upload.status, 201, JSON.stringify(upload.json));
  const documentId = upload.json.document.document_id;

  const after = await withDb(async (db) => (await db.query(`SELECT dq, total_emission FROM emission WHERE pk_id = $1`, [pk])).rows[0]);
  assert.equal(after.dq.reliability, 1, "the document lifts a supplier figure to good");
  assert.equal(after.dq.overall, 1);
  assert.equal(Number(after.total_emission), Number(before.total_emission), "the total is untouched");
  for (const indicator of ["technology", "geography", "time", "completeness"]) {
    assert.equal(after.dq[indicator], before.dq[indicator], `${indicator} is untouched`);
  }

  if (documentId) {
    const removed = await call("DELETE", `/user/documents/${documentId}`, "user");
    assert.ok([200, 204].includes(removed.status), JSON.stringify(removed.json));
    const back = await withDb(async (db) => (await db.query(`SELECT dq FROM emission WHERE pk_id = $1`, [pk])).rows[0]);
    assert.equal(back.dq.reliability, 2, "with the file gone the score stops claiming it");
  }
});

test("a form that still holds bare method keys is read the same way", async (t) => {
  // The first cut of the column stored ["distance_based", …]; the engine reads
  // each key as {method, units: []} rather than refusing every row.
  const created = await withFactorAndForm(t, ["distance_based", "spend_based"]);
  const refused = await postRow({ date_of_reporting: "2026-07-31", method: "supplier_specific" });
  assert.equal(refused.json.code, "METHOD_NOT_ALLOWED");
  assert.match(refused.json.message, /This form offers: Distance travelled, From the amount spent\./);
  const defaulted = await postRow({ date_of_reporting: "2026-07-31" });
  assert.equal(defaulted.status, 201, JSON.stringify(defaulted.json));
  created.push(defaulted.json.emission.pk_id);
  const stored = await withDb(async (db) => (await db.query(`SELECT method FROM emission WHERE pk_id = $1`, [defaulted.json.emission.pk_id])).rows[0]);
  assert.equal(stored.method, "distance_based", "no method sent: the form's first");
});

test("column-config writes take method_options as [{method, units}] and refuse anything else by name", async (t) => {
  const made = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "s3-3 method options",
    site_id: 1,
    category_id: FORM_CATEGORY,
    method_options: DISTANCE_AND_SPEND,
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.columnConfig.pk_id;
  t.after(() => withDb((db) => db.query(`DELETE FROM column_config WHERE pk_id = $1`, [id])));
  assert.deepEqual(made.json.columnConfig.method_options, DISTANCE_AND_SPEND);

  const bad = await call("POST", "/admin/column-configs", "superadmin", {
    config_name: "s3-3 bad options",
    site_id: 1,
    category_id: FORM_CATEGORY,
    method_options: [{ method: "teleportation", units: ["km"] }],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "FIELD_INVALID");
  assert.equal(bad.json.field, "method_options[0].method");
  assert.equal(await withDb(async (db) => (await db.query(`SELECT count(*)::int AS n FROM column_config WHERE config_name = 's3-3 bad options'`)).rows[0].n), 0, "nothing stored");

  const refusals = [
    [["distance_based"], "method_options[0]"], // bare keys are read, never written
    [[{ method: "spend_based", units: [] }], "method_options[0].units"],
    [[{ method: "unknown", units: ["km"] }], "method_options[0].method"],
    [[{ method: "spend_based", units: ["USD"] }, { method: "spend_based", units: ["EUR"] }], "method_options"],
    ["spend_based", "method_options"],
  ];
  for (const [value, field] of refusals) {
    const res = await call("PUT", `/admin/column-configs/${id}`, "superadmin", { method_options: value });
    assert.equal(res.status, 400, `${JSON.stringify(value)} → ${JSON.stringify(res.json)}`);
    assert.equal(res.json.code, "FIELD_INVALID");
    assert.equal(res.json.field, field, JSON.stringify(value));
  }

  // A PUT without method_options keeps them; a new list replaces them; null clears.
  assert.equal((await call("PUT", `/admin/column-configs/${id}`, "superadmin", { config_name: "s3-3 method options" })).status, 200);
  const read = async () => (await withDb((db) => db.query(`SELECT method_options FROM column_config WHERE pk_id = $1`, [id]))).rows[0].method_options;
  assert.deepEqual(await read(), DISTANCE_AND_SPEND);
  const next = [{ method: "supplier_specific", units: ["kg"] }];
  const put = await call("PUT", `/admin/column-configs/${id}`, "superadmin", { method_options: next });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.deepEqual(await read(), next);
  assert.equal((await call("PUT", `/admin/column-configs/${id}`, "superadmin", { method_options: null })).status, 200);
  assert.equal(await read(), null);

  // Column configs are Superadmin-only.
  assert.equal((await call("PUT", `/admin/column-configs/${id}`, "manager", { method_options: next })).status, 403);
});
