// DS-14F golden group "checks" (DS-12): the checks list of each seed doc (POST /docs/:id/checks at
// the doc's rev, no render: layout 'none'), per seed company: id, severity, element or page,
// fix action and message, in the order the panel shows them, plus what blocks a final.
const { ensureSeed } = require("../lib/seed.cjs");

module.exports = async function checks(ctx, kase) {
  const { docs, ghg, kpi } = await ensureSeed(ctx);
  const companies = kase.doc.startsWith("sustainability") ? [kpi] : ghg;
  const out = {};
  for (const c of companies) {
    const entry = docs[`${c.key}/${kase.doc}`];
    const r = await ctx.call("POST", `/studio/docs/${entry.id}/checks`, c.who, { rev: entry.rev });
    if (r.status !== 200) throw new Error(`checks ${entry.key}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    out[c.key] = {
      blocking: r.json.blocking,
      layout: r.json.layout,
      warnings: r.json.warnings,
      checks: r.json.checks.map((x) => `${x.severity} ${x.id}${x.elementId ? ` @${x.elementId}` : x.pageId ? ` @${x.pageId}` : ""}${x.fix ? ` [${x.fix}]` : ""}: ${x.message}`),
    };
  }
  return out;
};
