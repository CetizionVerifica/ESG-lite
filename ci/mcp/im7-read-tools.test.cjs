// IM7 · Read tools over MCP. Runs inside ci/api/run.cjs (MCP_TEST_TOKENS=true)
// with the SDK client against the built server. Spec: src/mcp/tools/read/CLAUDE.md.
// Audit rows: MCP-07 (every tool needs company_id or a site that names the
// client), MCP-08 (Superadmin only), MCP-20 (summary lines carry no sheet text).
const test = require("node:test");
const assert = require("node:assert/strict");
const { withDb } = require("../api/helpers.cjs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { z } = require("zod");
const { ImportContextSchema, ActivityOptionSchema } = require("../../dist/imports/contracts.js");
const { ReadToolOutputs } = require("../../dist/mcp/tools/read/index.js");

const MCP = `${process.env.API_BASE}/mcp`;
const FE = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

// Fixture users: 5 = Superadmin, 1 = User (company 1). Sites 1, 2 → company 1; site 3 → company 2.
const TOKENS = { superadmin: "mcp-test.5.imports:read,imports:write.im7", user: "mcp-test.1.imports:read,imports:write.im7" };

const CFG = [9401, 9402, 9403];
const COL = [9401, 9402];
const BATCH = "ci-im7-factors";
const MAP = "CI IM7";
// Factor names seeded for site 1 × category 1: 12 "Fuel oil …" names so find_activity has more than 10 to cut.
const FUEL_OILS = Array.from({ length: 12 }, (_, i) => `Fuel oil grade ${String(i + 1).padStart(2, "0")}`);

async function connect(token) {
  const client = new Client({ name: "ci-im7", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

/** Calls a tool; a success result must match the tool's declared output shape (src/mcp/tools/read/index.ts). */
const callTool = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (!r.isError) {
    const parsed = z.object(ReadToolOutputs[name]).strict().safeParse(r.structuredContent);
    assert.equal(parsed.success, true, `${name} output: ${JSON.stringify(parsed.error?.issues)}`);
  }
  return r;
};

// Every seeded name that must never appear in a summary line.
const SHEET_WORDS = [/diesel/i, /petrol/i, /fuel oil/i, /hsd/i, /steel/i, /grid/i];
const noSheetText = (line) => {
  for (const re of SHEET_WORDS) assert.doesNotMatch(line, re, `summary line leaks a name: ${line}`);
};

async function seed() {
  await withDb(async (db) => {
    await cleanup(db);
    await db.query(`UPDATE company SET mcp_enabled = true, status = true WHERE company_id = 1`);
    await db.query(`UPDATE company SET mcp_enabled = false, status = true WHERE company_id = 2`);
    await db.query(`INSERT INTO column_entity (pk_id, column_name, column_type) VALUES ($1, 'Fuel', 'select'), ($2, 'Quantity', 'number')`, COL);
    await db.query(
      `INSERT INTO column_config (pk_id, config_name, site_id, category_id, column_options, column_dependencies, dependent_options, extra_fields) VALUES
         ($1, 'CI IM7 fuel', 1, 1, $4::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb),
         ($2, 'CI IM7 grid', 1, 2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb),
         ($3, 'CI IM7 other', 3, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)`,
      [...CFG, JSON.stringify({ [String(COL[0])]: [{ id: "diesel", label: "Diesel" }, { id: "petrol", label: "Petrol" }] })],
    );
    await db.query(`INSERT INTO column_config_columns (column_config_id, column_id) VALUES ($1, $2), ($1, $3)`, [CFG[0], COL[0], COL[1]]);
    const factorRows = [
      [1, 1, 2024, "L", "Diesel", "Diesel (stationary)"],
      [1, 1, 2023, "litre", "Diesel", null],
      [1, 1, 2024, "L", "Petrol", null],
      ...FUEL_OILS.map((n) => [1, 1, 2024, "L", n, null]),
      [1, 2, 2024, "kWh", "Grid electricity", null],
      [3, 1, 2024, "L", "Other Diesel", null],
    ];
    for (const [site, cat, year, unit, name, global] of factorRows) {
      await db.query(
        `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, upload_batch_id)
         VALUES ($1, $2, $3, 1.0, $4, 'CI', $5, $6, $7)`,
        [site, cat, year, unit, name, global, BATCH],
      );
    }
    await db.query(
      `INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name) VALUES
         (1, 'CI Steel Co', NULL, 1, $1 || ' HSD', 'Diesel'),
         (2, 'CI Other Co', NULL, 1, $1 || ' C2 Fuel', 'Other Diesel')`,
      [MAP],
    );
    // Saved rows make Petrol the most used name for site 1 × category 1 (a rejected row does not count).
    for (const [name, status] of [["Petrol", "approved"], ["Petrol", "pending"], ["Diesel", "approved"], ["Diesel", "rejected"]]) {
      await db.query(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, site_id, category_id, upload_batch_id)
         VALUES ($1::jsonb, 1, 'tCO2e', '2024-01-31', $2, 1, 1, $3)`,
        [JSON.stringify({ emission_category: name, Quantity: 10 }), status, BATCH],
      );
    }
  });
}

async function cleanup(db) {
  await db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [BATCH]);
  await db.query(`DELETE FROM column_config WHERE pk_id = ANY($1::int[])`, [CFG]);
  await db.query(`DELETE FROM column_entity WHERE pk_id = ANY($1::int[])`, [COL]);
  await db.query(`DELETE FROM emission_factors WHERE upload_batch_id = $1`, [BATCH]);
  await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name LIKE $1`, [`${MAP}%`]);
}

let client;
test.before(async () => {
  await seed();
  client = await connect(TOKENS.superadmin);
});
test.after(async () => {
  await client?.close();
  await withDb(cleanup);
});

test("tools/list: every read tool is read-only, closed-world, with the IM0 input schema", async () => {
  const { tools } = await client.listTools();
  for (const name of ["whoami", "list_sites_and_categories", "get_category_form", "find_activity", "check_readiness"]) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.equal(tool.annotations.readOnlyHint, true, name);
    assert.equal(tool.annotations.openWorldHint, false, name);
    assert.ok(tool.description.length > 40, name);
    assert.ok(ReadToolOutputs[name], `${name} declares its output shape`);
  }
  assert.ok(tools.find((t) => t.name === "find_activity").inputSchema.required.includes("query"));
  assert.ok(tools.find((t) => t.name === "list_sites_and_categories").inputSchema.required.includes("company_id"));
});

test("whoami: the Superadmin, the clients with Claude imports on, the limits; no names in the summary", async () => {
  const r = await callTool(client, "whoami", {});
  assert.notEqual(r.isError, true, JSON.stringify(r));
  const d = r.structuredContent;
  assert.equal(d.user.user_id, 5);
  assert.equal(d.user.role, "Superadmin");
  assert.deepEqual(d.scopes, ["imports:read", "imports:write"]);
  assert.deepEqual(d.clients.map((c) => c.company_id), [1]); // company 2 has the switch off
  assert.equal(d.limits.rows_per_request, 2000);
  assert.equal(d.limits.find_activity_matches, 10);
  assert.equal(r.content[0].text, "whoami: user 5, 1 client(s) with Claude imports on");
});

test("list_sites_and_categories: the IM3 context of one client, activity counts but no activity lists", async () => {
  const r = await callTool(client, "list_sites_and_categories", { company_id: 1 });
  assert.notEqual(r.isError, true, JSON.stringify(r));
  const d = r.structuredContent;
  assert.equal(ImportContextSchema.safeParse(d).success, true);
  assert.equal(d.company.company_id, 1);
  assert.equal(d.company.mcp_enabled, true);
  assert.deepEqual(d.sites.map((s) => s.site_id), [1, 2]);
  const fuel = d.sites[0].categories.find((c) => c.category_id === 1);
  assert.equal(fuel.form.calc_mode, "single");
  assert.equal(fuel.form.fields.find((f) => f.key === "Quantity").required, true);
  assert.equal(fuel.activity_count, 16); // Diesel, Diesel (stationary), Petrol, 12 fuel oils, the HSD mapping
  assert.equal(JSON.stringify(d).includes('"activities"'), false);
  assert.equal(r.content[0].text, "list_sites_and_categories: company 1, 2 site(s), 7 site × category pair(s)");
  noSheetText(r.content[0].text);
});

test("MCP-07: list_sites_and_categories without company_id is refused; MCP-06: a client with the switch off is refused", async () => {
  let r = await callTool(client, "list_sites_and_categories", {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /company_id/);
  r = await callTool(client, "check_readiness", { company_id: 2, year: 2024 });
  assert.equal(r.structuredContent.code, "MCP_DISABLED_FOR_CLIENT");
  // A site-addressed tool checks the site's client the same way.
  r = await callTool(client, "get_category_form", { site_id: 3, category_id: 1 });
  assert.equal(r.structuredContent.code, "MCP_DISABLED_FOR_CLIENT");
});

test("get_category_form: form, units, readiness and the most used activity names first", async () => {
  const r = await callTool(client, "get_category_form", { site_id: 1, category_id: 1 });
  assert.notEqual(r.isError, true, JSON.stringify(r));
  const d = r.structuredContent;
  assert.equal(d.company_id, 1);
  assert.equal(d.site_name, "CI Plant A");
  assert.equal(d.category_name, "Stationary Combustion");
  assert.deepEqual(d.period_modes, ["monthly", "yearly"]);
  assert.deepEqual(d.form.fields.find((f) => f.key === "Fuel").options, ["Diesel", "Petrol"]);
  assert.deepEqual(d.units, ["L", "litre"]);
  assert.deepEqual(d.readiness, { form: true, factor_years: [2023, 2024] });
  assert.equal(d.activity_count, 16);
  assert.equal(d.activities.length, 16);
  for (const a of d.activities) assert.equal(ActivityOptionSchema.safeParse(a).success, true, a.name);
  // Petrol (2 saved rows) before Diesel (1; the rejected row does not count), then the unused names alphabetically.
  assert.deepEqual(d.activities.slice(0, 2).map((a) => [a.name, a.uses]), [["Petrol", 2], ["Diesel", 1]]);
  assert.equal(d.activities[2].uses, 0);
  const hsd = d.activities.find((a) => a.name === `${MAP} HSD`);
  assert.equal(hsd.kind, "mapping");
  assert.equal(hsd.maps_to, "Diesel");
  assert.equal(r.content[0].text, "get_category_form: site 1 × category 1, form present, 16 activity name(s)");
  noSheetText(r.content[0].text);

  // Business Travel: no form, no factors.
  const travel = (await callTool(client, "get_category_form", { site_id: 1, category_id: 3 })).structuredContent;
  assert.equal(travel.form, null);
  assert.deepEqual(travel.activities, []);
});

test("MCP-07: get_category_form with a site of another client than company_id → IMPORT_FORBIDDEN; unknown site too", async () => {
  let r = await callTool(client, "get_category_form", { company_id: 1, site_id: 3, category_id: 1 });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.code, "IMPORT_FORBIDDEN");
  r = await callTool(client, "find_activity", { company_id: 1, site_id: 3, category_id: 1, query: "diesel" });
  assert.equal(r.structuredContent.code, "IMPORT_FORBIDDEN");
  r = await callTool(client, "get_category_form", { site_id: 999999, category_id: 1 });
  assert.equal(r.structuredContent.code, "IMPORT_FORBIDDEN");
  // A category the site is not assigned (site 2 has categories 1 and 2 only).
  r = await callTool(client, "get_category_form", { site_id: 2, category_id: 3 });
  assert.equal(r.structuredContent.code, "IMPORT_FORBIDDEN");
  // With a matching company_id the registry's client check runs first (company 2 is switched off).
  r = await callTool(client, "get_category_form", { company_id: 2, site_id: 3, category_id: 1 });
  assert.equal(r.structuredContent.code, "MCP_DISABLED_FOR_CLIENT");
});

test("find_activity: exact → prefix → contains, at most 10, company 2's mappings never appear; the query stays out of the summary", async () => {
  let r = await callTool(client, "find_activity", { site_id: 1, category_id: 1, query: "diesel" });
  assert.notEqual(r.isError, true, JSON.stringify(r));
  let d = r.structuredContent;
  assert.deepEqual(d.matches.map((m) => m.name), ["Diesel", "Diesel (stationary)"]);
  assert.equal(d.matches[0].latest_year, 2024);
  assert.deepEqual(d.matches[0].units, ["L", "litre"]);
  assert.equal(d.truncated, false);
  assert.equal(r.content[0].text, "find_activity: site 1 × category 1, 2 match(es)");
  noSheetText(r.content[0].text);
  // The client's own wording (a P23 mapping) is found by its name and says what it maps to.
  d = (await callTool(client, "find_activity", { site_id: 1, category_id: 1, query: "hsd" })).structuredContent;
  assert.deepEqual(d.matches.map((m) => [m.name, m.kind, m.maps_to]), [[`${MAP} HSD`, "mapping", "Diesel"]]);

  r = await callTool(client, "find_activity", { company_id: 1, site_id: 1, category_id: 1, query: "fuel oil" });
  d = r.structuredContent;
  assert.equal(d.matches.length, 10);
  assert.equal(d.truncated, true);
  assert.deepEqual(d.matches.map((m) => m.name), FUEL_OILS.slice(0, 10));
  assert.match(r.content[0].text, /10 match\(es\), more available$/);

  d = (await callTool(client, "find_activity", { site_id: 1, category_id: 1, query: "C2 Fuel" })).structuredContent;
  assert.deepEqual(d.matches, []);
});

test("check_readiness: ready cells, gaps and the ESGLite page that fixes each gap", async () => {
  const r = await callTool(client, "check_readiness", { company_id: 1, year: 2025 });
  assert.notEqual(r.isError, true, JSON.stringify(r));
  const d = r.structuredContent;
  assert.equal(d.year, 2025);
  assert.equal(d.cells.length, 7);
  const cell = (site, cat) => d.cells.find((c) => c.site_id === site && c.category_id === cat);
  const fuel = cell(1, 1);
  assert.equal(fuel.ready, true);
  assert.equal(fuel.lookup_year, 2024);
  assert.equal(fuel.factor_for_year, true);
  assert.deepEqual(fuel.missing, []);
  const travel = cell(1, 3);
  assert.equal(travel.ready, false);
  assert.deepEqual(
    travel.missing,
    [
      { what: "form", fix_page: `${FE}/capture/forms?site=1&category=3` },
      { what: "factor", fix_page: `${FE}/factors?client=1&site=1&category=3` },
    ],
  );
  assert.equal(d.ready + d.gaps, d.cells.length);
  assert.equal(r.content[0].text, `check_readiness: company 1, year 2025, ${d.ready} of 7 ready, ${d.gaps} gap(s)`);
  noSheetText(r.content[0].text);
});

test("MCP-08: a non-Superadmin token cannot reach the read tools (HTTP 403)", async () => {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${TOKENS.user}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "MCP_SUPERADMIN_ONLY");
});

test("every read call is logged with ids only", async () => {
  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT tool, ok, company_id FROM mcp_tool_call WHERE tool = 'check_readiness' AND company_id = 1 ORDER BY id DESC LIMIT 1`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, true);
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mcp_tool_call'`);
    assert.ok(!cols.rows.some((c) => /input|output|payload|arguments/.test(c.column_name)));
  });
});
