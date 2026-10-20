// DS-14 golden group "contracts" (DS-0): what the contracts make of a doc, without a database.
// For a v2 doc: does it parse, its byte size under the 2 MB cap, its outline (pages and
// elements), every binding in page order (collectBindings: what DS-2 resolves and DS-12
// checks), and the check ids of its kind. With `upgrade: true` the input is an RS v1 doc and
// the golden is the whole upgraded v2 doc plus the same summary.
const fs = require("fs");
const path = require("path");

module.exports = async function contracts(ctx, kase) {
  const c = require(path.join(ctx.root, "dist/studio/contracts/index.js"));
  let doc = JSON.parse(fs.readFileSync(path.join(ctx.root, kase.input), "utf8"));
  const out = {};
  if (kase.upgrade) {
    doc = c.upgradeV1(doc);
    out.upgraded = doc;
  }
  const parsed = c.ReportDocSchema.safeParse(doc);
  if (!parsed.success) return { ...out, valid: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const d = parsed.data;
  const bytes = c.docBytes(d);
  return {
    ...out,
    valid: true,
    kind: d.kind,
    format: d.format,
    purpose: d.purpose,
    bytes,
    underCap: bytes <= c.MAX_DOC_BYTES,
    pages: d.pages.map((p) =>
      p.kind === "flow"
        ? { id: p.id, kind: p.kind, flowType: p.flowType }
        : { id: p.id, kind: p.kind, layoutId: p.layoutId ?? null, elements: p.elements.map((e) => `${e.id}:${e.type}`) },
    ),
    bindings: c.collectBindings(d),
    checks: c.checksFor(d.kind),
  };
};
