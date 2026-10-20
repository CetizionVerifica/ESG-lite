// DS-9 · recorded model answers, shared by the AI golden group (groups/ai.cjs) and the unit
// tests (ci/unit/ds-9-ai.test.cjs). No network and no database: the answers in
// ci/fixtures/studio/ai/recorded.json go through the same parse → zod → token guard as a live
// call (runner.interpret), and text answers are rendered by the studio renderer with each chip
// showing its binding (so the golden shows where every figure comes from).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const dist = (p) => require(path.join(ROOT, "dist", p));
const RECORDED = JSON.parse(fs.readFileSync(path.join(ROOT, "ci/fixtures/studio/ai/recorded.json"), "utf8"));
const DOCS = {
  ghg: JSON.parse(fs.readFileSync(path.join(ROOT, "ci/fixtures/studio/ghg-doc.json"), "utf8")),
  sustainability: JSON.parse(fs.readFileSync(path.join(ROOT, "ci/fixtures/studio/sustainability-doc.json"), "utf8")),
};

/** The facts a prompt for the fixture docs would offer (what DS-2 resolves for the CI fixture company). */
function scopeFor(kind, docYear) {
  const { GHG_METRICS } = dist("studio/contracts/index.js");
  const ghg = new Set(kind === "ghg" ? GHG_METRICS.filter((m) => m !== "scope2_market" && m !== "scope3_category") : []);
  if (kind === "ghg") for (let n = 1; n <= 15; n++) if (n !== 8) ghg.add(`scope3_category.${n}`);
  return {
    kind,
    docYear,
    ghg,
    kpis: new Set(kind === "sustainability" ? ["ENERGY_TOTAL", "WATER_WITHDRAWAL", "WOMEN_WORKFORCE_PCT"] : []),
    inputs: new Map([
      ["consolidation_approach", "Operational control"],
      ["reporting_period", "Calendar year 2025 (1 January – 31 December 2025)"],
    ]),
  };
}

const tokensOf = (node, out = []) => {
  if (!node || typeof node !== "object") return out;
  if (node.type === "data") out.push(node);
  (node.content || []).forEach((c) => tokensOf(c, out));
  return out;
};
const label = (t) => {
  const b = t.attrs.binding;
  const ref = b.source === "kpi" ? `kpi:${b.kpis[0]}` : b.metric === "scope3_category" ? `scope3_category.${b.scope3Category}` : b.metric;
  return `⟨${ref}|${t.attrs.year ?? "current"}|${t.attrs.measure}⟩`;
};

/** Renders a TextDoc in a sheet with each chip showing its binding; returns the visible text. */
function renderText(doc, textDoc) {
  const render = dist("reporting/studio/render/index.js");
  const tokens = tokensOf(textDoc);
  const data = render.renderData([], tokens, { values: [], tokens: tokens.map((t) => ({ source: t.attrs.binding.source, display: label(t), value: null, unit: null })), unavailable: [] });
  const page = { id: "ai-golden", kind: "freeform", name: "AI", background: {}, elements: [{ id: "ai-golden.text", type: "text", frame: { x: 20, y: 20, w: 170, h: 120, rotation: 0 }, z: 1, source: "ai", reviewed: false, props: { doc: textDoc, style: "body", align: "left" } }] };
  const r = render.renderSheet(page, { ...doc, pages: [page] }, data, { mode: "sheet" });
  const el = r.html.slice(r.html.indexOf('data-el-id="ai-golden.text"'));
  return el
    .replace(/<\/(p|li|h[2-4])>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/^[^>]*>/, "");
}

/** One recorded answer through the runner's interpret step; null when the action has no recording. */
function replay(action) {
  const rec = RECORDED[action];
  if (!rec) return null;
  const { ACTIONS } = dist("studio/ai/actions.js");
  const { interpret, resolveTarget } = dist("studio/ai/runner.js");
  const { textDocToTokens } = dist("studio/ai/guard.js");
  const doc = DOCS[rec.doc];
  const spec = ACTIONS[action];
  const { element } = resolveTarget(spec, doc, rec.target);
  const scope = scopeFor(doc.kind, doc.meta.year);
  if (spec.output === "text" && element && (element.type === "text" || element.type === "callout")) scope.existing = textDocToTokens(element.props.doc, doc.meta.year).existing;
  return { rec, doc, spec, element, scope, result: interpret(spec, rec.answer, scope, doc, element) };
}

module.exports = { RECORDED, DOCS, scopeFor, renderText, replay, tokensOf };
