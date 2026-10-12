// IM9 eval runner: drives Claude through the Messages API with the ESGLite MCP
// connector and records every tool call per workbook. Not run in CI.
//
//   ANTHROPIC_API_KEY=… ESGLITE_MCP_URL=https://<api>/mcp ESGLITE_MCP_TOKEN=<token> \
//     node ci/mcp-evals/runner.cjs [--only 01,04] [--model claude-opus-5-5]
//
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
const MAX_TURNS = 14;

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
  let stop = null;

  while (turns < MAX_TURNS) {
    turns++;
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["mcp-client-2025-11-20"],
      system: "You are connected to the ESGLite MCP server. Follow its instructions and the esglite://guide/import resource.",
      mcp_servers: [{ type: "url", url: process.env.ESGLITE_MCP_URL, name: "esglite", authorization_token: process.env.ESGLITE_MCP_TOKEN }],
      tools: [{ type: "mcp_toolset", mcp_server_name: "esglite" }],
      messages,
    });
    stop = response.stop_reason;
    messages.push({ role: "assistant", content: response.content });
    let text = "";
    for (const block of response.content) {
      if (block.type === "mcp_tool_use") toolCalls.push({ turn: turns, name: block.name, input: block.input });
      else if (block.type === "mcp_tool_result") toolResults.push({ turn: turns, is_error: !!block.is_error, content: block.content });
      else if (block.type === "text") text += block.text;
    }
    transcript.push({ role: "assistant", turn: turns, text });
    if (stop === "refusal") break;
    if (toolCalls.some((c) => c.name === "commit_import") && stop === "end_turn") break;
    if (stop === "pause_turn") continue; // server-side tool use still running
    const reply = nextUserTurn(text, state);
    if (!reply) break;
    messages.push({ role: "user", content: reply });
    transcript.push({ role: "user", turn: turns, text: reply });
  }
  return { name, model: MODEL, turns, stop, askedBeforeCommit: state.askedBeforeCommit, commitAnswer: opts.commitAnswer, toolCalls, toolResults, transcript };
}

(async () => {
  for (const v of ["ANTHROPIC_API_KEY", "ESGLITE_MCP_URL", "ESGLITE_MCP_TOKEN"]) {
    if (!process.env[v]) { console.error(`Missing ${v}`); process.exit(2); }
  }
  const Anthropic = loadSdk();
  const client = new Anthropic();
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
      const result = await runOne(client, c.name, c.expected, { commitAnswer: c.commitAnswer });
      result.case = label;
      fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(result, null, 2));
      console.log(`${result.turns} turns, ${result.toolCalls.length} tool calls, stop=${result.stop}`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify({ case: label, error: err.message }, null, 2));
    }
  }
  console.log(`Results in ${outDir}; score with: node ci/mcp-evals/score.cjs ${outDir}`);
})();
