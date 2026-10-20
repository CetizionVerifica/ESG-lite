// DS-14F golden group "seed" (DS-4, DS-5, DS-10): the seed docs, built through POST /studio/docs
// (and the Board brief through POST /docs/:id/resize) on the seed companies (lib/seed.cjs).
// Per company: the doc's outline (pages, layouts, element counts), its build steps, and every
// binding and chip resolved in the doc's own scope ("label = display", series, unavailable
// reasons). Dates, ids and data hashes are left out (they change from run to run).
const { ensureSeed, resolveDoc, summarise, bindingLabel, docBindings, docTokens } = require("../lib/seed.cjs");

const line = (label, v) => {
  const s = summarise(v);
  let out = `${label} = ${s.display}`;
  if (s.unavailable) out += ` [${s.unavailable}]`;
  if (s.compare) out += ` (vs ${s.compare.against} ${s.compare.year}: ${s.compare.change_pct ?? "n/a"} %)`;
  if (s.series) out += ` | ${s.series.join(" ; ")}`;
  return out;
};

async function outline(ctx, entry) {
  const d = entry.doc;
  const resolved = await resolveDoc(ctx, entry);
  const bindings = docBindings(d);
  const tokens = docTokens(d);
  return {
    title: d.meta.title,
    kind: d.kind,
    purpose: d.purpose,
    format: d.format,
    year: `${d.meta.yearType} ${d.meta.year}`,
    templateId: d.design.templateId,
    linkedSource: d.source ? true : undefined,
    resize: entry.resize,
    build: (entry.build?.steps || []).map((s) => `${s.id ?? s.key ?? s.name}: ${s.state}${s.note ? ` (${s.note})` : ""}`),
    pageCount: d.pages.length,
    pages: d.pages.map((p) => (p.kind === "flow" ? `${p.id} flow ${p.flowType}` : `${p.id} ${p.layoutId ?? "-"} (${p.elements.length} elements)`)),
    values: resolved.values.map((v, i) => line(bindingLabel(bindings[i]), v)),
    chips: resolved.tokens.map((v, i) => line(`${bindingLabel(tokens[i].attrs.binding)} ${tokens[i].attrs.measure}`, v)),
    unavailable: resolved.unavailable.length,
  };
}

module.exports = async function seed(ctx, kase) {
  const { docs, ghg, kpi } = await ensureSeed(ctx);
  const companies = kase.doc.startsWith("sustainability") ? [kpi] : ghg;
  const out = {};
  for (const c of companies) out[c.key] = await outline(ctx, docs[`${c.key}/${kase.doc}`]);
  return out;
};
