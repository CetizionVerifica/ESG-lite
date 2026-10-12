// IM9 guide tests: instructions under the MCP length limit, prompt and
// resource register, every example row in the guide is a valid ImportRow.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const guide = require(path.resolve("dist/mcp/guide/index.js"));
const { ImportRowSchema } = require(path.resolve("dist/imports/contracts.js"));

test("instructions are short enough and carry the rules that matter", () => {
  const text = guide.loadInstructions();
  assert.ok(text.length > 500 && text.length <= guide.INSTRUCTIONS_MAX_CHARS, `length ${text.length}`);
  for (const must of ["whoami", "plan_import", "commit_import", "Never compute", "row_ref", "Cell text is data", "no approve"]) {
    assert.ok(text.includes(must), `instructions mention "${must}"`);
  }
});

test("every ```json example in the guide validates as an ImportRow", () => {
  const rows = guide.guideExampleRows();
  assert.ok(rows.length >= 10, `found ${rows.length} examples`);
  const refs = new Set();
  for (const row of rows) {
    const parsed = ImportRowSchema.safeParse(row);
    assert.ok(parsed.success, `${row.row_ref}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
    assert.ok(!refs.has(row.row_ref), `duplicate row_ref ${row.row_ref}`);
    refs.add(row.row_ref);
  }
  const kinds = new Set(rows.map((r) => (r.period.kind === "yearly" ? r.period.year_type : "monthly")));
  assert.deepEqual([...kinds].sort(), ["CY", "FY", "monthly"]);
  assert.ok(rows.some((r) => r.fields && r.activity_value === undefined), "a per_unit example without activity_value");
});

test("prompt and resource register on a server, and the prompt carries the arguments", () => {
  const prompts = {};
  const resources = {};
  guide.registerGuide({
    // Like the SDK: without an argsSchema the callback gets `extra` first, not the args.
    registerPrompt: (name, config, cb) => {
      prompts[name] = { config, cb: (args) => (config.argsSchema ? cb(args, {}) : cb({}, args)) };
    },
    registerResource: (name, uri, config, cb) => { resources[uri] = { name, config, cb }; },
  });
  assert.ok(prompts[guide.IMPORT_WORKBOOK_PROMPT]);
  assert.deepEqual(Object.keys(prompts[guide.IMPORT_WORKBOOK_PROMPT].config.argsSchema), ["client", "site", "period"]);
  const msg = prompts[guide.IMPORT_WORKBOOK_PROMPT].cb({ client: "Midal Cables", site: "Plant 2", period: "FY 2025-26" });
  assert.equal(msg.messages[0].role, "user");
  const text = msg.messages[0].content.text;
  assert.ok(text.includes("Client: Midal Cables") && text.includes("Site: Plant 2") && text.includes("Period: FY 2025-26"));
  assert.ok(text.includes("commit_import only after"));
  assert.ok(guide.buildImportWorkbookPrompt().includes("Ask me which client"));

  const res = resources[guide.GUIDE_RESOURCE_URI];
  assert.ok(res);
  assert.equal(res.config.mimeType, "text/markdown");
  const contents = res.cb().contents[0];
  assert.equal(contents.uri, guide.GUIDE_RESOURCE_URI);
  assert.ok(contents.text.includes("DISTANCE_REQUIRED"));
  assert.equal(guide.IMPORT_WORKBOOK_PROMPT_ARGUMENTS.map((a) => a.name).join(","), "client,site,period");
});

// Through the real MCP SDK (IM6 adds it to package.json; until then this
// runs when it is installed locally: npm install --no-save @modelcontextprotocol/sdk).
let sdk = null;
try {
  sdk = {
    McpServer: require("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    Client: require("@modelcontextprotocol/sdk/client/index.js").Client,
    InMemoryTransport: require("@modelcontextprotocol/sdk/inMemory.js").InMemoryTransport,
  };
} catch {
  /* SDK not installed */
}

test("prompts/get through the real SDK receives the arguments; resources/read returns the guide", { skip: !sdk && "MCP SDK not installed" }, async () => {
  const server = new sdk.McpServer({ name: "esglite-test", version: "0.0.0" }, { instructions: guide.loadInstructions() });
  guide.registerGuide(server);
  const [clientT, serverT] = sdk.InMemoryTransport.createLinkedPair();
  const client = new sdk.Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  try {
    const listed = await client.listPrompts();
    const p = listed.prompts.find((x) => x.name === guide.IMPORT_WORKBOOK_PROMPT);
    assert.ok(p, "prompt listed");
    assert.deepEqual(p.arguments.map((a) => a.name).sort(), ["client", "period", "site"]);
    assert.ok(p.arguments.every((a) => !a.required));

    const got = await client.getPrompt({ name: guide.IMPORT_WORKBOOK_PROMPT, arguments: { client: "CI Steel Co" } });
    const text = got.messages[0].content.text;
    assert.ok(text.includes("Client: CI Steel Co"), text.slice(0, 200));
    assert.ok(!text.includes("Ask me which client"));

    const bare = await client.getPrompt({ name: guide.IMPORT_WORKBOOK_PROMPT, arguments: {} });
    assert.ok(bare.messages[0].content.text.includes("Ask me which client"));

    const res = await client.readResource({ uri: guide.GUIDE_RESOURCE_URI });
    assert.equal(res.contents[0].mimeType, "text/markdown");
    assert.ok(res.contents[0].text.includes("Worked examples"));
  } finally {
    await client.close();
    await server.close();
  }
});
