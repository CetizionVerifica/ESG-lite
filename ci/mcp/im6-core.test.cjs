// IM6 · MCP server core protocol tests. Runs inside ci/api/run.cjs against the
// built server (API_BASE) with MCP_TEST_TOKENS=true, using the official SDK
// client over Streamable HTTP. Spec: docs/mcp-import/mcp/IM6-mcp-core/CLAUDE.md.
// Audit rows: MCP-01 (401 header), MCP-06, MCP-08, MCP-15, MCP-18, MCP-19.
const test = require("node:test");
const assert = require("node:assert/strict");
const { withDb } = require("../api/helpers.cjs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const BASE = process.env.API_BASE;
const MCP = `${BASE}/mcp`;

// Test tokens: mcp-test.<user_id>.<scopes>[.<label>] (src/mcp/auth.ts).
// Fixture users: 5 = Superadmin, 1 = User (company 1), 3 = Admin, 2 = Manager.
const TOKENS = {
  superadmin: "mcp-test.5.imports:read,imports:write",
  readOnly: "mcp-test.5.imports:read.ro",
  noScope: "mcp-test.5..none",
  user: "mcp-test.1.imports:read,imports:write",
  admin: "mcp-test.3.imports:read,imports:write",
  manager: "mcp-test.2.imports:read,imports:write",
  rateLimit: "mcp-test.5.imports:read,imports:write.rl",
};

const headers = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

async function connect(token) {
  const client = new Client({ name: "ci", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), { requestInit: { headers: headers(token) } });
  await client.connect(transport);
  return client;
}

const rawPost = (token, body, extra = {}) =>
  fetch(MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers(token), ...extra.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "0" } } };
const callTool = (name, args = {}, id = 2) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

const setCompany = (companyId, fields) =>
  withDb(async (db) => {
    const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
    await db.query(`UPDATE company SET ${sets.join(", ")} WHERE company_id = $1`, [companyId, ...Object.values(fields)]);
  });

test.before(async () => {
  // company.mcp_enabled is IM5's column (migrate:oauth); until that merges the
  // throwaway database gets it here so the switch can be tested.
  await withDb((db) => db.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS mcp_enabled boolean NOT NULL DEFAULT false`));
  // Company 1 has Claude imports on, company 2 keeps the default (off).
  await setCompany(1, { mcp_enabled: true, status: true });
  await setCompany(2, { mcp_enabled: false, status: true });
});

test("MCP-01: no token → 401 with WWW-Authenticate pointing at the protected-resource metadata", async () => {
  const res = await rawPost(null, initialize);
  assert.equal(res.status, 401);
  const www = res.headers.get("www-authenticate");
  assert.match(www, /^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
  const json = await res.json();
  assert.equal(json.error, "unauthorized");
});

test("a token the verifier does not know → 401 invalid_token", async () => {
  const res = await rawPost("not-a-real-token", initialize);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate"), /error="invalid_token"/);
  // An app JWT is not an MCP token either.
  const jwt = require("jsonwebtoken").sign({ userId: 5, role: "Superadmin" }, process.env.JWT_SECRET);
  assert.equal((await rawPost(jwt, initialize)).status, 401);
});

test("stateless: GET and DELETE /mcp → 405 with Allow", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(MCP, { method, headers: { ...headers(TOKENS.superadmin), Accept: "application/json, text/event-stream" } });
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get("allow"), /POST/);
  }
});

test("MCP-08: a token of a User, Admin or Manager account → 403 MCP_SUPERADMIN_ONLY", async () => {
  for (const who of ["user", "admin", "manager"]) {
    const res = await rawPost(TOKENS[who], initialize);
    assert.equal(res.status, 403, who);
    const json = await res.json();
    assert.equal(json.code, "MCP_SUPERADMIN_ONLY");
  }
});

test("MCP-08: a Superadmin demoted after connecting is refused on the next call", async () => {
  await withDb((db) => db.query(`UPDATE "user" SET role = 'Admin' WHERE user_id = 5`));
  try {
    const res = await rawPost(TOKENS.superadmin, initialize);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "MCP_SUPERADMIN_ONLY");
  } finally {
    await withDb((db) => db.query(`UPDATE "user" SET role = 'Superadmin' WHERE user_id = 5`));
  }
  assert.equal((await rawPost(TOKENS.superadmin, initialize)).status, 200);
});

test("a token with none of the MCP scopes → 403 insufficient_scope", async () => {
  const res = await rawPost(TOKENS.noScope, initialize);
  assert.equal(res.status, 403);
  assert.match(res.headers.get("www-authenticate"), /insufficient_scope/);
});

test("initialize returns the esglite server with instructions; tools/list is filtered by scope (MCP-19)", async () => {
  const full = await connect(TOKENS.superadmin);
  try {
    const info = full.getServerVersion();
    assert.equal(info.name, "esglite");
    assert.ok(full.getInstructions().length > 20);
    const { tools } = await full.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "cancel_import_plan", "check_readiness", "commit_import", "find_activity", "get_category_form", "get_import_plan",
      "list_sites_and_categories", "list_upload_batches", "ping", "plan_import", "update_import_plan", "whoami",
    ]);
    // MCP-19: nothing that approves, rejects, edits or deletes, or manages users, sites, factors or forms.
    for (const n of names) assert.doesNotMatch(n, /approve|reject|edit|delete|remove|user|factor|create_|update_site|update_form/);
    const commit = tools.find((t) => t.name === "commit_import");
    assert.equal(commit.annotations.destructiveHint, false);
    assert.equal(commit.annotations.idempotentHint, true);
    assert.equal(commit.inputSchema.required.includes("confirm"), true);
  } finally {
    await full.close();
  }

  const ro = await connect(TOKENS.readOnly);
  try {
    const { tools } = await ro.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("ping") && names.includes("whoami") && names.includes("get_import_plan"));
    for (const w of ["plan_import", "update_import_plan", "commit_import", "cancel_import_plan"]) assert.ok(!names.includes(w), w);
  } finally {
    await ro.close();
  }
});

test("ping works and is logged without payload (MCP-15)", async () => {
  const client = await connect(TOKENS.superadmin);
  try {
    const result = await client.callTool({ name: "ping", arguments: {} });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.ok, true);
    assert.deepEqual(result.structuredContent.scopes, ["imports:read", "imports:write"]);
    assert.equal(result.content[0].text, "ping: ok");
  } finally {
    await client.close();
  }
  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT * FROM mcp_tool_call WHERE tool = 'ping' ORDER BY id DESC LIMIT 1`);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.user_id, 5);
    assert.equal(row.ok, true);
    assert.equal(row.error_code, null);
    assert.equal(row.company_id, null);
    assert.match(row.grant_id, /^test-[0-9a-f]{24}$/);
    assert.ok(row.duration_ms >= 0);
    assert.deepEqual(
      Object.keys(row).sort(),
      ["company_id", "created_at", "duration_ms", "error_code", "grant_id", "id", "ok", "plan_id", "tool", "user_id"],
      "the log table must have no payload column",
    );
  });
});

test("stub tools answer NOT_IMPLEMENTED as a tool error in the contracts §9 shape, and are logged with the client id", async () => {
  const client = await connect(TOKENS.superadmin);
  try {
    const result = await client.callTool({ name: "list_sites_and_categories", arguments: { company_id: 1 } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^NOT_IMPLEMENTED: /);
    assert.equal(result.structuredContent.code, "NOT_IMPLEMENTED");
  } finally {
    await client.close();
  }
  await withDb(async (db) => {
    const { rows } = await db.query(`SELECT * FROM mcp_tool_call WHERE tool = 'list_sites_and_categories' ORDER BY id DESC LIMIT 1`);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error_code, "NOT_IMPLEMENTED");
    assert.equal(rows[0].company_id, 1);
  });
});

test("MCP-06: a client with the switch off → MCP_DISABLED_FOR_CLIENT; a deactivated client → CLIENT_INACTIVE; unknown → CLIENT_NOT_FOUND", async () => {
  const client = await connect(TOKENS.superadmin);
  try {
    let r = await client.callTool({ name: "list_sites_and_categories", arguments: { company_id: 2 } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.code, "MCP_DISABLED_FOR_CLIENT");
    assert.equal(r.structuredContent.details.company_id, 2);

    await setCompany(2, { mcp_enabled: true, status: false });
    r = await client.callTool({ name: "check_readiness", arguments: { company_id: 2, year: 2025 } });
    assert.equal(r.structuredContent.code, "CLIENT_INACTIVE");
    await setCompany(2, { mcp_enabled: false, status: true });

    r = await client.callTool({ name: "list_upload_batches", arguments: { company_id: 9999 } });
    assert.equal(r.structuredContent.code, "CLIENT_NOT_FOUND");
  } finally {
    await client.close();
  }
});

test("input validation errors come back as tool errors, not HTTP errors", async () => {
  const client = await connect(TOKENS.superadmin);
  try {
    const r = await client.callTool({ name: "check_readiness", arguments: { company_id: "one", year: 2025 } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /company_id/);
  } finally {
    await client.close();
  }
});

test("MCP-18: a body over 5 MB → 413", async () => {
  const big = JSON.stringify(callTool("plan_import", { company_id: 1, source_name: "big", rows: [], pad: "x".repeat(5 * 1024 * 1024 + 1024) }));
  const res = await rawPost(TOKENS.superadmin, big);
  assert.equal(res.status, 413);
  const json = await res.json();
  assert.match(json.error.message, /5mb/i);
});

test("CORS: claude.ai may call /mcp; an unknown origin gets no allow header", async () => {
  const ok = await fetch(MCP, { method: "OPTIONS", headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://claude.ai");
  assert.match(ok.headers.get("access-control-allow-headers"), /Authorization/i);
  const bad = await fetch(MCP, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("MCP-18: 60 tool calls per minute per grant, then 429 with Retry-After; initialize is not counted", async () => {
  const max = Number(process.env.MCP_RATE_LIMIT_MAX) || 60;
  const statuses = [];
  for (let i = 0; i < max + 1; i++) statuses.push((await rawPost(TOKENS.rateLimit, callTool("ping"))).status);
  assert.ok(statuses.slice(0, max).every((s) => s === 200), `statuses: ${statuses.join(",")}`);
  assert.equal(statuses[max], 429);
  const blocked = await rawPost(TOKENS.rateLimit, callTool("ping"));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  // Not a tool call: still answered.
  assert.equal((await rawPost(TOKENS.rateLimit, initialize)).status, 200);
  // Another grant of the same user is not affected.
  assert.equal((await rawPost(TOKENS.superadmin, callTool("ping"))).status, 200);
});
