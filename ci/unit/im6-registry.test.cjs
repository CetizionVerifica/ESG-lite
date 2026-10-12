// IM6 unit tests for the pieces of the MCP core that the protocol tests cannot
// time: the per-call timeout/abort and the tool error mapping. Runs against the
// compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { withTimeout, CALL_TIMEOUT_MS } = require(path.resolve("dist/mcp/registry.js"));
const { mapToolError, McpToolError } = require(path.resolve("dist/mcp/errors.js"));
const { ImportError } = require(path.resolve("dist/imports/errors.js"));
const { takeToolCall, resetToolCallBuckets } = require(path.resolve("dist/mcp/rateLimit.js"));

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

test("withTimeout: a handler that finishes in time resolves and leaves its signal untouched", async () => {
  let seen;
  const value = await withTimeout(async (signal) => {
    seen = signal;
    return 42;
  }, 1000);
  assert.equal(value, 42);
  assert.equal(seen.aborted, false);
  assert.equal(CALL_TIMEOUT_MS, 30_000);
});

test("withTimeout: a slow handler is stopped with TIMEOUT and its signal is aborted", async () => {
  let seen;
  await assert.rejects(
    withTimeout(async (signal) => {
      seen = signal;
      await sleep(500, signal);
      return "late";
    }, 20),
    (err) => err instanceof McpToolError && err.code === "TIMEOUT",
  );
  assert.equal(seen.aborted, true);
});

test("withTimeout: a client cancel (parent signal) aborts the handler before the timeout", async () => {
  const parent = new AbortController();
  let seen;
  const p = withTimeout(async (signal) => {
    seen = signal;
    await sleep(5000, signal);
  }, 10_000, parent.signal);
  setTimeout(() => parent.abort(), 10);
  await assert.rejects(p, (err) => err instanceof McpToolError && err.code === "TIMEOUT" && /cancelled/.test(err.message));
  assert.equal(seen.aborted, true);
  // An already-cancelled request never runs the handler.
  let ran = false;
  await assert.rejects(withTimeout(async () => { ran = true; }, 1000, parent.signal), (err) => err.code === "TIMEOUT");
  assert.equal(ran, false);
});

test("mapToolError: McpToolError and IM0 ImportError pass code, message and details through", () => {
  const a = mapToolError(new McpToolError("NOT_IMPLEMENTED"), "ping");
  assert.equal(a.code, "NOT_IMPLEMENTED");
  assert.equal(a.result.isError, true);
  assert.match(a.result.content[0].text, /^NOT_IMPLEMENTED: /);

  const b = mapToolError(new ImportError("IMPORT_PLAN_NOT_FOUND", { plan_id: "x" }), "get_import_plan");
  assert.equal(b.code, "IMPORT_PLAN_NOT_FOUND");
  assert.deepEqual(b.result.structuredContent, { code: "IMPORT_PLAN_NOT_FOUND", details: { plan_id: "x" } });
});

test("mapToolError: a Node/pg error with a string code becomes INTERNAL and leaks nothing of its message", () => {
  const err = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" });
  const { code, result } = mapToolError(err, "plan_import");
  assert.equal(code, "INTERNAL");
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "INTERNAL");
  assert.match(result.structuredContent.details.request_id, /^[0-9a-f-]{36}$/);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.5|5432/);

  const plain = mapToolError({ code: "SOME_UPPER_CODE", message: "secret host db-1.internal" }, "ping");
  assert.equal(plain.code, "INTERNAL");
  assert.doesNotMatch(JSON.stringify(plain.result), /db-1\.internal/);
});

test("takeToolCall: a batch is counted whole and refused whole", () => {
  resetToolCallBuckets();
  const max = Number(process.env.MCP_RATE_LIMIT_MAX) || 60;
  assert.equal(takeToolCall("g1", max - 1).allowed, true);
  const refused = takeToolCall("g1", 2);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0);
  assert.equal(takeToolCall("g1").allowed, true);
  assert.equal(takeToolCall("g1").allowed, false);
  assert.equal(takeToolCall("g2").allowed, true);
  resetToolCallBuckets();
});
