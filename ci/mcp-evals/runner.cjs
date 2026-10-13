// IM9 eval runner: drives Claude through the Messages API against the ESGLite
// MCP server and records every tool call per workbook. Not run in CI.
//
//   ANTHROPIC_API_KEY=… ESGLITE_MCP_URL=https://<api>/mcp ESGLITE_MCP_TOKEN=<token> \
//     node ci/mcp-evals/runner.cjs [--only 01,04] [--model claude-opus-5-5] [--bridge]
//
// Two transports:
// - connector (default for a public URL): Anthropic's servers call /mcp through
//   the Messages API MCP connector, exactly as claude.ai does.
// - bridge (--bridge, or automatic for a localhost URL): this process connects
//   to /mcp with the MCP client, hands the tool list to Claude as plain tools
//   and executes each tool_use locally. Same workbooks, same scoring; it tests
//   the tools and the guide, not the connector handshake. Use it when the
//   server is not reachable from the internet (a CI database in a cloud
//   session, a laptop).
// Needs `npm install --no-save @anthropic-ai/sdk` (not a project dependency).
// Workbooks come from make-workbooks.cjs; each sheet is sent as CSV text with
// its merged ranges noted, which is what Claude sees when it reads a workbook.
// Results land in ci/mcp-evals/results/<timestamp>/<workbook>.json; run
// score.cjs on that folder.
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT = __dirname;
// Check the model id and the MCP connector beta header against the current Claude API docs before the first wave-4 run.
const MODEL = argValue("--model") || "claude-opus-5-5";
const ONLY = (argValue("--only") || "").split(",").filter(Boolean);
const MAX_TURNS = 14; // scripted user replies per case
const MAX_STEPS = 120; // model responses per case (bridge tool round trips count here, not above)
const DRY_RUN = process.argv.includes("--dry-run"); // bridge only: list tools, call whoami, no API key needed
const BRIDGE = process.argv.includes("--bridge") || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(process.env.ESGLITE_MCP_URL || "");
const SYSTEM = "You are connected to the ESGLite MCP server. Follow its instructions and the esglite://guide/import resource.";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function loadSdk() {
  try {
    return require("@anthropic-ai/sdk");
  } catch {
    console.error("Install the SDK first: npm install --no-save @anthropic-ai/sdk");
    process.exit(2);
  }
}

/** Bridge mode: an MCP client on the local /mcp, exposing its tools as Messages API tools. */
async function openBridge() {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const mcp = new Client({ name: "esglite-eval-runner", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(process.env.ESGLITE_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.ESGLITE_MCP_TOKEN}` } },
  });
  await mcp.connect(transport);
  const { tools } = await mcp.listTools();
  const instructions = mcp.getInstructions() || "";
  return {
    tools: tools.map((t) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema })),
    // An MCP host shows the server's instructions to the model; the bridge does the same.
    system: instructions ? `${SYSTEM}\n\nESGLite MCP server instructions:\n${instructions}` : SYSTEM,
    async call(name, args) {
      try {
        const res = await mcp.callTool({ name, arguments: args || {} }, undefined, { timeout: 120000 });
        return { is_error: !!res.isError, content: Array.isArray(res.content) ? res.content : [] };
      } catch (err) {
        return { is_error: true, content: [{ type: "text", text: String(err && err.message ? err.message : err) }] };
      }
    },
    close: () => mcp.close(),
  };
}

function toolResultBlocks(content) {
  const blocks = content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => ({ type: "text", text: b.text }));
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function workbookText(file) {
  const wb = XLSX.readFile(file);
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: true });
    const merges = (ws["!merges"] || []).map((m) => `${XLSX.utils.encode_range(m)}`);
    return `### Sheet "${name}"${merges.length ? ` (merged cells: ${merges.join(", ")})` : ""}\n\`\`\`csv\n${csv}\n\`\`\``;
  }).join("\n\n");
}

function askText(expected, name) {
  const a = expected.ask || {};
  const parts = [`Please import this workbook (${name}.xlsx) into ESGLite.`];
  if (a.client) parts.push(`Client: ${a.client}.`);
  if (a.site) parts.push(`Site: ${a.site}.`);
  if (a.category) parts.push(`Category: ${a.category}.`);
  if (a.period) parts.push(`Period: ${a.period}.`);
  return parts.join(" ");
}

/** Pick the scripted reply to Claude's last message. */
function nextUserTurn(text, state) {
  const t = text.toLowerCase();
  const asksToSave = /(shall i|should i|do you want me to|would you like me to|ready to|ok to|confirm).*(save|commit|import|proceed)/s.test(t) || /save these|commit (the|these)/.test(t);
  if (asksToSave) {
    state.askedBeforeCommit = true;
    return state.commitAnswer;
  }
  if (state.answers.length) return state.answers.shift();
  if (/\?\s*$/.test(text.trim()) || /which (client|site|category|period)|could you (confirm|tell)/.test(t)) {
    return "Use your best judgement from what I told you; if a row cannot be resolved, skip it and tell me.";
  }
  return null;
}

async function runOne(client, name, expected, opts) {
  const sheets = workbookText(path.join(ROOT, "workbooks", `${name}.xlsx`));
  const state = { answers: [...(expected.answers || [])], commitAnswer: opts.commitAnswer, askedBeforeCommit: false };
  const messages = [{ role: "user", content: `${askText(expected, name)}\n\n${sheets}` }];
  const toolCalls = [];
  const toolResults = [];
  const transcript = [];
  let turns = 0;
  let userTurns = 0;
  let stop = null;

  while (turns < MAX_STEPS && userTurns < MAX_TURNS) {
    turns++;
    let response;
    if (opts.bridge) {
      response = await client.messages.create({ model: MODEL, max_tokens: 16000, system: opts.bridge.system, tools: opts.bridge.tools, messages });
    } else {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["mcp-client-2025-11-20"],
        system: SYSTEM,
        mcp_servers: [{ type: "url", url: process.env.ESGLITE_MCP_URL, name: "esglite", authorization_token: process.env.ESGLITE_MCP_TOKEN }],
        tools: [{ type: "mcp_toolset", mcp_server_name: "esglite" }],
        messages,
      });
    }
    stop = response.stop_reason;
    messages.push({ role: "assistant", content: response.content });
    let text = "";
    const pendingUses = [];
    for (const block of response.content) {
      if (block.type === "mcp_tool_use") toolCalls.push({ turn: turns, name: block.name, input: block.input });
      else if (block.type === "mcp_tool_result") toolResults.push({ turn: turns, is_error: !!block.is_error, content: block.content });
      else if (block.type === "tool_use") { toolCalls.push({ turn: turns, name: block.name, input: block.input }); pendingUses.push(block); }
      else if (block.type === "text") text += block.text;
    }
    transcript.push({ role: "assistant", turn: turns, text });
    if (stop === "refusal") break;
    if (pendingUses.length) {
      // Bridge: run the tools here and hand the results back as the next user turn.
      const results = [];
      for (const use of pendingUses) {
        const r = await opts.bridge.call(use.name, use.input);
        toolResults.push({ turn: turns, is_error: r.is_error, content: r.content });
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: r.is_error, content: toolResultBlocks(r.content) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    if (toolCalls.some((c) => c.name === "commit_import") && stop === "end_turn") break;
    if (stop === "pause_turn") continue; // server-side tool use still running
    const reply = nextUserTurn(text, state);
    if (!reply) break;
    userTurns++;
    messages.push({ role: "user", content: reply });
    transcript.push({ role: "user", turn: turns, text: reply });
  }
  return { name, model: MODEL, transport: opts.bridge ? "bridge" : "connector", turns, stop, askedBeforeCommit: state.askedBeforeCommit, commitAnswer: opts.commitAnswer, toolCalls, toolResults, transcript };
}

(async () => {
  for (const v of DRY_RUN ? ["ESGLITE_MCP_URL", "ESGLITE_MCP_TOKEN"] : ["ANTHROPIC_API_KEY", "ESGLITE_MCP_URL", "ESGLITE_MCP_TOKEN"]) {
    if (!process.env[v]) { console.error(`Missing ${v}`); process.exit(2); }
  }
  if (DRY_RUN) {
    const bridge = await openBridge();
    console.log(`tools: ${bridge.tools.map((t) => t.name).join(", ")}`);
    const who = await bridge.call("whoami", {});
    console.log(`whoami ${who.is_error ? "error" : "ok"}: ${toolResultBlocks(who.content)[0].text.slice(0, 300)}`);
    await bridge.close();
    return;
  }
  const Anthropic = loadSdk();
  const client = new Anthropic();
  const bridge = BRIDGE ? await openBridge() : null;
  if (bridge) console.log(`bridge mode: ${bridge.tools.length} tools from ${process.env.ESGLITE_MCP_URL}`);
  const outDir = path.join(ROOT, "results", new Date().toISOString().replace(/[:.]/g, "").slice(0, 15));
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs.readdirSync(path.join(ROOT, "expected")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const cases = [];
  for (const name of names) {
    if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) continue;
    const expected = JSON.parse(fs.readFileSync(path.join(ROOT, "expected", `${name}.json`), "utf8"));
    cases.push({ name, expected, commitAnswer: "Yes, save them." });
    if (name.startsWith("01")) cases.push({ name, expected, commitAnswer: "No, don't save anything.", suffix: "-no" });
  }
  for (const c of cases) {
    const label = c.name + (c.suffix || "");
    process.stdout.write(`${label} … `);
    try {
      const result = await runOne(client, c.name, c.expected, { commitAnswer: c.commitAnswer, bridge });
      result.case = label;
      fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(result, null, 2));
      console.log(`${result.turns} turns, ${result.toolCalls.length} tool calls, stop=${result.stop}`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ case: label, error: err.message }, null, 2));
    }
  }
  if (bridge) await bridge.close();
  console.log(`Results in ${outDir}; score with: node ci/mcp-evals/score.cjs ${outDir}`);
})();
