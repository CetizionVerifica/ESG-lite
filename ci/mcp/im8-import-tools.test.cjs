// IM8 · MCP import tools (docs/mcp-import/mcp/IM8-import-tools/CLAUDE.md).
// Runs inside ci/api/run.cjs against the built server with MCP_TEST_TOKENS=true,
// after im6-core.test.cjs. Full flow plan → append → update → commit → batch
// listed, plus the refusals: no confirm, stale version, repeat commit, client
// totals ignored, another client's site, another client's plan, switched-off
// client. Audit rows: MCP-09 to MCP-14, MCP-17, MCP-19, MCP-21.
const test = require("node:test");
const assert = require("node:assert/strict");
const { withDb } = require("../api/helpers.cjs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const MCP = `${process.env.API_BASE}/mcp`;
const SUPERADMIN = "mcp-test.5.imports:read,imports:write.im8";
const READ_ONLY = "mcp-test.5.imports:read.im8-ro";

async function connect(token) {
  const client = new Client({ name: "ci-im8", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return client;
}

const setCompany = (companyId, fields) =>
  withDb(async (db) => {
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
    await db.query(`UPDATE company SET ${sets.join(", ")} WHERE company_id = $1`, [companyId, ...Object.values(fields)]);
  });

// Factors for the flow: Diesel 2680 kg/litre on sites 1 and 2 (company 1),
// Grid Electricity 708 kg/kWh on site 1. Removed again in after().
test.before(async () => {
  await setCompany(1, { mcp_enabled: true, status: true });
  await setCompany(2, { mcp_enabled: false, status: true });
  await withDb((db) =>
    db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (930, 1, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (931, 2, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (932, 1, 2, 2024, 708.0000, 'kwh', 'CI', 'Grid Electricity', 'Grid Electricity')`),
  );
});

const batches = new Set();
const planIds = new Set();

test.after(async () => {
  await withDb(async (db) => {
    for (const id of batches) await db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [id]);
    for (const id of planIds) {
      await db.query(`DELETE FROM import_plan_match WHERE plan_id = $1`, [id]);
      await db.query(`DELETE FROM import_plan_row WHERE plan_id = $1`, [id]);
      await db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [id]);
    }
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (930, 931, 932)`);
  });
  await setCompany(2, { mcp_enabled: false, status: true });
});

let seq = 0;
// Months Mar–Aug 2025: no fixture rows there on site 1, so rows are not duplicates of existing data.
const row = (over = {}) => ({
  row_ref: `Fuel!B${++seq}`,
  site_id: 1,
  category_id: 1,
  period: { kind: "monthly", date: `2025-0${3 + (seq % 6)}-01` },
  activity_name: "Diesel",
  activity_value: 1000,
  activity_unit: "litre",
  ...over,
});

const call = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { ok: r.isError !== true, text: r.content?.[0]?.text, data: r.structuredContent, code: r.structuredContent?.code };
};

let client;
test.before(async () => {
  client = await connect(SUPERADMIN);
});
test.after(async () => {
  await client.close();
});

let plan; // the flow's plan, carried between tests

test("MCP-09: plan_import plans rows on the real engine; totals come from the writer, client totals are ignored, another client's site is refused per row", async () => {
  const mar = { kind: "monthly", date: "2025-03-01" };
  const r = await call(client, "plan_import", {
    company_id: 1,
    source_name: "fuel 2025.xlsx",
    rows: [
      row({ row_ref: "r1", period: mar }),
      row({ row_ref: "r2", activity_value: 500, period: { kind: "monthly", date: "2025-04-01" }, total_emission: 5, tco2e: 1 }),
      row({ row_ref: "r3", activity_name: "Unknown fuel", period: { kind: "monthly", date: "2025-05-01" } }),
      row({ row_ref: "r4", site_id: 3, period: mar }),
      row({ row_ref: "r5", category_id: 2, activity_name: "Grid Electricity", activity_value: 200, activity_unit: "kWh", period: mar }),
    ],
  });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.text, "plan_import: ok", "the summary line carries no sheet text");
  plan = r.data;
  planIds.add(plan.plan_id);
  assert.equal(plan.status, "draft");
  assert.equal(plan.version, 1);
  assert.equal(plan.company_id, 1);
  assert.equal(plan.channel, "mcp");
  assert.equal(plan.created_by, 5);
  assert.deepEqual([plan.counts.rows, plan.counts.ready, plan.counts.issue, plan.counts.skipped], [5, 3, 2, 0]);
  // 1000 l × 2.68 + 500 l × 2.68 + 200 kWh × 0.708; nothing from total_emission / tco2e.
  assert.equal(plan.totals.tco2e, 4161.6);
  assert.deepEqual(plan.totals.by_category.map((c) => [c.category_id, c.tco2e, c.rows]), [[1, 4020, 2], [2, 141.6, 1]]);
  assert.deepEqual(plan.totals.by_month.map((m) => m.month), ["2025-03", "2025-04"]);
  const codes = plan.issues_summary.map((i) => i.code);
  assert.ok(codes.includes("CLIENT_TOTAL_IGNORED"), `CLIENT_TOTAL_IGNORED in ${codes}`);
  assert.ok(codes.includes("UNKNOWN_ACTIVITY"));
  assert.ok(codes.includes("SITE_NOT_ALLOWED"), `site 3 is company 2's: ${codes}`);
  // Only the rows with issues come back inline.
  assert.deepEqual(plan.rows.map((x) => [x.row_ref, x.state]).sort(), [["r3", "issue"], ["r4", "issue"]]);
  assert.equal(plan.total_rows, 5);
  assert.equal(plan.rows.find((x) => x.row_ref === "r4").issues[0].code, "SITE_NOT_ALLOWED");
});

test("plan_import with plan_id appends and needs the version; the plan's version moves", async () => {
  const missing = await call(client, "plan_import", { company_id: 1, source_name: "fuel 2025.xlsx", plan_id: plan.plan_id, rows: [row({ row_ref: "r6" })] });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "IMPORT_VALIDATION");
  assert.match(missing.text, /version/);

  const r = await call(client, "plan_import", {
    company_id: 1,
    source_name: "fuel 2025.xlsx",
    plan_id: plan.plan_id,
    version: 1,
    rows: [row({ row_ref: "r6", activity_value: 300, period: { kind: "monthly", date: "2025-06-01" } })],
  });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.plan_id, plan.plan_id);
  assert.equal(r.data.version, 2);
  assert.deepEqual([r.data.counts.rows, r.data.counts.ready, r.data.counts.issue], [6, 4, 2]);
  assert.equal(r.data.totals.tco2e, 4965.6);
  plan = r.data;
});

test("get_import_plan pages rows and filters by state and code (read scope is enough)", async () => {
  const ro = await connect(READ_ONLY);
  try {
    const issues = await call(ro, "get_import_plan", { plan_id: plan.plan_id, state: "issue" });
    assert.equal(issues.ok, true, issues.text);
    assert.deepEqual(issues.data.rows.map((x) => x.row_ref).sort(), ["r3", "r4"]);
    assert.equal(issues.data.total_rows, 2);
    assert.equal(issues.data.page, 1);
    const site = await call(ro, "get_import_plan", { plan_id: plan.plan_id, code: "SITE_NOT_ALLOWED" });
    assert.deepEqual(site.data.rows.map((x) => x.row_ref), ["r4"]);
    const all = await call(ro, "get_import_plan", { plan_id: plan.plan_id });
    assert.equal(all.data.total_rows, 6);
    assert.deepEqual(all.data.rows.slice(0, 2).map((x) => x.state), ["issue", "issue"], "issues first");
    const ready = all.data.rows.find((x) => x.row_ref === "r1");
    assert.deepEqual([ready.result.activity.matched_by, ready.result.factor.emission_factor_id, ready.result.total_tco2e], ["factor", 930, 2680]);
    const unknown = await call(ro, "get_import_plan", { plan_id: "00000000-0000-4000-8000-000000000000" });
    assert.equal(unknown.code, "IMPORT_PLAN_NOT_FOUND");
  } finally {
    await ro.close();
  }
});

test("MCP-10: update_import_plan skips, sets and matches activities, then recalculates; stale versions conflict", async () => {
  const stale = await call(client, "update_import_plan", { plan_id: plan.plan_id, version: 1, changes: [{ row_ref: "r4", skip: true }] });
  assert.equal(stale.code, "IMPORT_PLAN_VERSION_CONFLICT");
  assert.equal(stale.data.details.current_version, 2);

  const empty = await call(client, "update_import_plan", { plan_id: plan.plan_id, version: 2 });
  assert.equal(empty.code, "IMPORT_VALIDATION");

  const r = await call(client, "update_import_plan", {
    plan_id: plan.plan_id,
    version: 2,
    changes: [
      { row_ref: "r4", skip: true },
      { row_ref: "r2", set: { activity_value: 600, total_emission: 99 } },
    ],
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Unknown fuel", factor_name: "Diesel" }],
  });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.version, 3);
  assert.deepEqual([r.data.counts.rows, r.data.counts.ready, r.data.counts.issue, r.data.counts.skipped], [6, 5, 0, 1]);
  // r1 2680 + r2 (600 l) 1608 + r3 (now Diesel) 2680 + r5 141.6 + r6 804
  assert.equal(r.data.totals.tco2e, 7913.6);
  const r3 = r.data.rows.find((x) => x.row_ref === "r3");
  assert.deepEqual([r3.state, r3.result.activity.matched_by, r3.result.activity.factor_name], ["ready", "plan_match", "Diesel"]);
  const r2 = r.data.rows.find((x) => x.row_ref === "r2");
  assert.equal(r2.result.total_tco2e, 1608);
  assert.equal("total_emission" in r2.input, false, "a total in a change is dropped");
  assert.ok(r2.issues.some((i) => i.code === "CLIENT_TOTAL_IGNORED"));
  plan = r.data;
});

test("MCP-11: commit_import needs confirm and the current version", async () => {
  // A missing or false confirm is refused by the SDK's input validation before the registry wrapper runs,
  // so it comes back as the SDK's -32602 text (not the §9 shape) and writes no mcp_tool_call row; see src/mcp/CLAUDE.md "Validation".
  const before = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM mcp_tool_call WHERE tool = 'commit_import'`));
  const noConfirm = await call(client, "commit_import", { plan_id: plan.plan_id, version: 3, skip_rows_with_issues: false });
  assert.equal(noConfirm.ok, false);
  assert.match(noConfirm.text, /confirm/);
  const after = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM mcp_tool_call WHERE tool = 'commit_import'`));
  assert.equal(after.rows[0].n, before.rows[0].n, "input validation failures are not logged (documented gap)");
  const falseConfirm = await call(client, "commit_import", { plan_id: plan.plan_id, version: 3, skip_rows_with_issues: false, confirm: false });
  assert.equal(falseConfirm.ok, false);
  assert.match(falseConfirm.text, /confirm/);

  const stale = await call(client, "commit_import", { plan_id: plan.plan_id, version: 2, skip_rows_with_issues: false, confirm: true });
  assert.equal(stale.code, "IMPORT_PLAN_VERSION_CONFLICT");
  assert.equal(stale.data.details.current_version, 3);
  // Nothing was saved by any of those.
  const saved = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM emission WHERE extra_data->'import'->>'channel' = 'mcp'`));
  assert.equal(saved.rows[0].n, 0);
});

test("MCP-12/13: commit_import saves one pending batch by the Superadmin with the Claude audit text; a repeat returns the same batch", async () => {
  const r = await call(client, "commit_import", { plan_id: plan.plan_id, version: 3, skip_rows_with_issues: false, confirm: true });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.status, "committed");
  assert.equal(r.data.committed.inserted, 5);
  assert.equal(r.data.committed.fera_inserted, 0);
  const batchId = r.data.committed.upload_batch_id;
  assert.match(batchId, /^[0-9a-f-]{36}$/);
  batches.add(batchId);
  const committedVersion = r.data.version;
  assert.equal(committedVersion, 4);

  await withDb(async (db) => {
    const rows = (await db.query(`SELECT status, created_by, total_emission::float AS total, extra_data FROM emission WHERE upload_batch_id = $1 ORDER BY total`, [batchId])).rows;
    assert.equal(rows.length, 5);
    for (const e of rows) {
      assert.equal(e.status, "pending");
      assert.equal(e.created_by, 5);
      assert.equal(e.extra_data.import.channel, "mcp");
    }
    assert.deepEqual(rows.map((e) => e.total), [141.6, 804, 1608, 2680, 2680]);
    const audit = await db.query(`SELECT reason FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE upload_batch_id = $1)`, [batchId]);
    assert.equal(audit.rowCount, 5);
    for (const a of audit.rows) assert.match(a.reason, /^Imported via Claude by CI Superadmin \(batch /);
    const log = (await db.query(`SELECT * FROM mcp_tool_call WHERE tool = 'commit_import' AND ok = true ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(log.plan_id, plan.plan_id);
    assert.equal(log.user_id, 5);
  });

  // Same version again: the stored result, no new rows.
  const again = await call(client, "commit_import", { plan_id: plan.plan_id, version: 3, skip_rows_with_issues: false, confirm: true });
  assert.equal(again.ok, true, again.text);
  assert.equal(again.data.committed.upload_batch_id, batchId);
  assert.equal(again.data.version, committedVersion);
  // With the version after the commit: no longer a draft, still nothing new.
  const later = await call(client, "commit_import", { plan_id: plan.plan_id, version: committedVersion, skip_rows_with_issues: false, confirm: true });
  assert.equal(later.code, "IMPORT_PLAN_NOT_DRAFT");
  const n = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM emission WHERE upload_batch_id = $1`, [batchId]));
  assert.equal(n.rows[0].n, 5);

  const cancel = await call(client, "cancel_import_plan", { plan_id: plan.plan_id });
  assert.equal(cancel.code, "IMPORT_PLAN_NOT_DRAFT");
  plan.upload_batch_id = batchId;
});

test("MCP-14: list_upload_batches shows the batch with its pending / approved / rejected counts", async () => {
  const r = await call(client, "list_upload_batches", { company_id: 1, status: "pending" });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.text, "list_upload_batches: ok");
  assert.equal(r.data.page, 1);
  const b = r.data.batches.find((x) => x.upload_batch_id === plan.upload_batch_id);
  assert.ok(b, "batch listed");
  assert.deepEqual([b.channel, b.source_name, b.plan_id, b.rows, b.pending, b.approved, b.rejected, b.tco2e], ["mcp", "fuel 2025.xlsx", plan.plan_id, 5, 5, 0, 0, 7913.6]);
  assert.deepEqual(b.created_by, { user_id: 5, name: "CI Superadmin" });
  assert.deepEqual(b.site_ids, [1]);

  // Once a manager approves two rows, the counts say so.
  await withDb((db) => db.query(`UPDATE emission SET status = 'approved' WHERE upload_batch_id = $1 AND pk_id IN (SELECT pk_id FROM emission WHERE upload_batch_id = $1 ORDER BY pk_id LIMIT 2)`, [plan.upload_batch_id]));
  const after = await call(client, "list_upload_batches", { company_id: 1 });
  const b2 = after.data.batches.find((x) => x.upload_batch_id === plan.upload_batch_id);
  assert.deepEqual([b2.pending, b2.approved, b2.rejected], [3, 2, 0]);
  const approvedOnly = await call(client, "list_upload_batches", { company_id: 1, status: "approved" });
  assert.equal(approvedOnly.data.batches.some((x) => x.upload_batch_id === plan.upload_batch_id), false, "not fully approved yet");
});

test("MCP-17 tenant isolation: another client's plan cannot be appended to, and a switched-off client's plan cannot be read, updated, committed or cancelled", async () => {
  const draft = await call(client, "plan_import", { company_id: 1, source_name: "second.xlsx", rows: [row({ row_ref: "s1", period: { kind: "monthly", date: "2025-07-01" } })] });
  assert.equal(draft.ok, true, draft.text);
  planIds.add(draft.data.plan_id);
  const id = draft.data.plan_id;

  // Company 2 switched on, so the refusal is about the plan, not the switch.
  await setCompany(2, { mcp_enabled: true });
  try {
    const cross = await call(client, "plan_import", { company_id: 2, source_name: "second.xlsx", plan_id: id, version: 1, rows: [row({ row_ref: "s2" })] });
    assert.equal(cross.code, "IMPORT_FORBIDDEN");
    assert.equal(cross.data.details.company_id, 2);
    // The other way round, with the plan's real owner switched off: still IMPORT_FORBIDDEN about the named client, nothing about client 1.
    await setCompany(1, { mcp_enabled: false });
    const theirPlan = await call(client, "plan_import", { company_id: 2, source_name: "mine.xlsx", rows: [row({ row_ref: "m1", site_id: 3 })] });
    assert.equal(theirPlan.ok, true, theirPlan.text);
    planIds.add(theirPlan.data.plan_id);
    await setCompany(1, { mcp_enabled: true });
    await setCompany(2, { mcp_enabled: false });
    const hidden = await call(client, "plan_import", { company_id: 1, source_name: "x.xlsx", plan_id: theirPlan.data.plan_id, version: 1, rows: [row({ row_ref: "m2" })] });
    assert.equal(hidden.code, "IMPORT_FORBIDDEN");
    assert.equal(hidden.data.details.company_id, 1);
    assert.doesNotMatch(JSON.stringify(hidden.data), /"company_id":2/);
    await setCompany(2, { mcp_enabled: true });
    assert.equal((await call(client, "cancel_import_plan", { plan_id: theirPlan.data.plan_id })).data.status, "cancelled");
    // Company 2's own plan with a site of company 1: the row is refused, the plan is not.
    const theirs = await call(client, "plan_import", { company_id: 2, source_name: "theirs.xlsx", rows: [row({ row_ref: "t1", site_id: 1 }), row({ row_ref: "t2", site_id: 3 })] });
    assert.equal(theirs.ok, true, theirs.text);
    planIds.add(theirs.data.plan_id);
    assert.equal(theirs.data.company_id, 2);
    assert.equal(theirs.data.rows.find((x) => x.row_ref === "t1").issues[0].code, "SITE_NOT_ALLOWED");
    const gone = await call(client, "cancel_import_plan", { plan_id: theirs.data.plan_id });
    assert.equal(gone.data.status, "cancelled");
  } finally {
    await setCompany(2, { mcp_enabled: false });
  }

  // Claude imports switched off for company 1 after planning: every plan tool refuses.
  await setCompany(1, { mcp_enabled: false });
  try {
    for (const [name, args] of [
      ["get_import_plan", { plan_id: id }],
      ["update_import_plan", { plan_id: id, version: 1, changes: [{ row_ref: "s1", skip: true }] }],
      ["commit_import", { plan_id: id, version: 1, skip_rows_with_issues: false, confirm: true }],
      ["cancel_import_plan", { plan_id: id }],
    ]) {
      const r = await call(client, name, args);
      assert.equal(r.code, "MCP_DISABLED_FOR_CLIENT", name);
      assert.equal(r.data.details.company_id, 1);
    }
    const list = await call(client, "list_upload_batches", { company_id: 1 });
    assert.equal(list.code, "MCP_DISABLED_FOR_CLIENT");
  } finally {
    await setCompany(1, { mcp_enabled: true });
  }
  const still = await call(client, "get_import_plan", { plan_id: id });
  assert.equal(still.data.status, "draft");
  assert.equal(still.data.version, 1);

  const cancel = await call(client, "cancel_import_plan", { plan_id: id });
  assert.equal(cancel.ok, true, cancel.text);
  assert.equal(cancel.data.status, "cancelled");
  const twice = await call(client, "cancel_import_plan", { plan_id: id });
  assert.equal(twice.code, "IMPORT_PLAN_NOT_DRAFT");
  const n = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM emission WHERE extra_data->'import'->>'row_ref' = 's1'`));
  assert.equal(n.rows[0].n, 0, "a cancelled plan saved nothing");
});

test("MCP-19/21: the write tools need imports:write; the read token cannot see or call them", async () => {
  const ro = await connect(READ_ONLY);
  try {
    const { tools } = await ro.listTools();
    const names = tools.map((t) => t.name);
    for (const w of ["plan_import", "update_import_plan", "commit_import", "cancel_import_plan"]) assert.ok(!names.includes(w), w);
    assert.ok(names.includes("get_import_plan") && names.includes("list_upload_batches"));
    // The SDK answers an unregistered tool with an error result (or throws, depending on its version); either way nothing runs.
    const refused = await ro.callTool({ name: "commit_import", arguments: { plan_id: plan.plan_id, version: 4, skip_rows_with_issues: false, confirm: true } }).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e.message) }] }));
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /not found|unknown tool/i);
  } finally {
    await ro.close();
  }
  const { tools } = await client.listTools();
  const commit = tools.find((t) => t.name === "commit_import");
  assert.equal(commit.inputSchema.properties.confirm.const, true);
  assert.match(commit.description, /explicit yes/);
  const planTool = tools.find((t) => t.name === "plan_import");
  assert.equal(planTool.inputSchema.properties.rows.maxItems, 2000);
  assert.ok(planTool.inputSchema.properties.rows.items.properties.activity_value, "row fields are documented in the schema");
});

test("MCP-08: a non-Superadmin token cannot reach the import tools: 403 MCP_SUPERADMIN_ONLY before any tool runs", async () => {
  const userToken = "mcp-test.1.imports:read,imports:write.im8-user";
  const rpc = (name, args) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  for (const [name, args] of [
    ["plan_import", { company_id: 1, source_name: "x.xlsx", rows: [row({ row_ref: "u1" })] }],
    ["commit_import", { plan_id: plan.plan_id, version: 4, skip_rows_with_issues: false, confirm: true }],
  ]) {
    const res = await fetch(MCP, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify(rpc(name, args)),
    });
    assert.equal(res.status, 403, name);
    assert.equal((await res.json()).code, "MCP_SUPERADMIN_ONLY", name);
  }
  const logged = await withDb((db) => db.query(`SELECT count(*)::int AS n FROM mcp_tool_call WHERE user_id = 1`));
  assert.equal(logged.rows[0].n, 0, "nothing ran for the User token");
});
