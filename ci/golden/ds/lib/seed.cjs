// DS-14F · the seed companies and seed docs behind the "seed", "checks", "parity" and "pdf"
// golden groups (ci/golden/ds/CLAUDE.md "Seed docs").
//
//   ensureSeed(ctx)    once per run: loads ci/golden/ds/fixture/seed.sql on top of the API fixture,
//                      the KPI tables and seed-kpi.sql, switches the studio on for the seed companies,
//                      and builds the seed docs through the API as each company's Manager:
//                        GHG (companies 1, 11, 12): Inventory (Classic), Board brief (resized from the
//                        Inventory: POST /docs/:id/resize), One-page summary (Classic);
//                        sustainability (company 13, KPI tracking on): Editorial.
//                      → ctx.seed = { companies, docs: { "<company>/<doc>": {id, rev, company, doc, built} } }
//   docBindings(doc), docTokens(doc)   what DS-2 resolves for a doc, in its order (sources/doc.ts)
//   resolveDoc(ctx, entry)             POST /studio/resolve for a seed doc's own scope
//   summarise(value)                   a resolved binding, short and stable (no dates or hashes)
const fs = require("fs");
const path = require("path");

/** The three GHG seed companies and the KPI seed company (fixture/seed.sql). */
const GHG_COMPANIES = [
  { key: "steel", companyId: 1, who: "manager", year: 2025, yearType: "CY" },
  { key: "cement", companyId: 11, who: "seedCement", year: 2026, yearType: "FY" },
  { key: "textiles", companyId: 12, who: "seedTextiles", year: 2025, yearType: "CY" },
];
const KPI_COMPANY = { key: "foods", companyId: 13, who: "seedFoods", year: 2025, yearType: "CY" };
const KPI_SCRIPTS = ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTargets"];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function docTokens(doc) {
  const out = [];
  const walk = (n) => {
    if (!isObj(n)) return;
    if (n.type === "data" && isObj(n.attrs)) out.push({ type: "data", attrs: n.attrs });
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  for (const page of doc.pages) {
    if (page.kind === "flow") walk(page.content);
    else for (const e of page.elements) if (isObj(e.props?.doc)) walk(e.props.doc);
  }
  return out;
}

function docBindings(doc) {
  const out = [];
  for (const page of doc.pages) if (page.kind !== "flow") for (const e of page.elements) if (isObj(e.props?.binding)) out.push(e.props.binding);
  return out;
}

const round = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);

/** One resolved binding as "label: display" plus the figures a reader checks. */
function summarise(v) {
  const out = { display: v.display, value: round(v.value), unit: v.unit ?? null };
  if (v.unavailable) out.unavailable = v.unavailable.reason;
  if (v.series && v.series.length) out.series = v.series.map((s) => `${s.label}: ${s.values.map((p) => `${p.key}=${round(p.value)}`).join(", ")}`);
  if (v.compare) out.compare = { against: v.compare.against, year: v.compare.year, change_pct: round(v.compare.change_pct) };
  return out;
}

const bindingLabel = (b) => {
  if (!b) return "?";
  if (b.source === "ghg") return `ghg:${b.metric}${b.breakdown ? ` by ${b.breakdown}` : ""}${b.scope3Category ? ` cat ${b.scope3Category}` : ""}${b.compare ? ` vs ${b.compare}` : ""}`;
  if (b.source === "kpi") return `kpi:${(b.kpis || []).join("+")}${b.breakdown ? ` by ${b.breakdown}` : ""}${b.compare ? ` vs ${b.compare}` : ""}`;
  if (b.source === "input") return `input:${b.key}`;
  return b.source;
};

async function resolveDoc(ctx, entry) {
  const d = entry.doc;
  const r = await ctx.call("POST", "/studio/resolve", entry.company.who, {
    kind: d.kind,
    year: d.meta.year,
    yearType: d.meta.yearType,
    sites: d.meta.sites,
    bindings: docBindings(d),
    tokens: docTokens(d),
    docId: entry.id,
  });
  if (r.status !== 200) throw new Error(`resolve ${entry.key}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

async function ensureSeed(ctx) {
  if (ctx.seed) return ctx.seed;
  const { q, call, root } = ctx;
  const { migrate } = require("./stack.cjs");
  if (!(await q(`SELECT 1 FROM company WHERE company_id = 11`)).length) await q(fs.readFileSync(path.join(__dirname, "../fixture/seed.sql"), "utf8"));
  migrate(root, KPI_SCRIPTS.map((n) => path.join(root, `dist/scripts/${n}.js`)));
  await q(fs.readFileSync(path.join(__dirname, "../fixture/seed-kpi.sql"), "utf8"));
  await q(`UPDATE company SET design_studio_enabled = true WHERE company_id = ANY($1::int[])`, [[...GHG_COMPANIES, KPI_COMPANY].map((c) => c.companyId)]);

  const templateId = async (slug) => {
    const [row] = await q(`SELECT id FROM report_template WHERE company_id IS NULL AND slug = $1 AND is_active ORDER BY version DESC LIMIT 1`, [slug]);
    if (!row) throw new Error(`no active system template ${slug}`);
    return row.id;
  };
  const docs = {};
  const keep = (key, company, res, extra = {}) => {
    docs[key] = { key, company, id: res.id, rev: res.rev, doc: res.doc, title: res.title, build: res.build, ...extra };
    return docs[key];
  };
  const build = async (company, slug, frameworks) => {
    const r = await call("POST", "/studio/docs", company.who, { kind: slug.startsWith("ghg") ? "ghg" : "sustainability", templateId: await templateId(slug), year: company.year, yearType: company.yearType, sites: "all", frameworks, inputs: {}, ai: false });
    if (r.status !== 201) throw new Error(`build ${company.key} ${slug}: ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
    return r.json;
  };
  const load = async (company, id) => {
    const r = await call("GET", `/studio/docs/${id}`, company.who);
    if (r.status !== 200) throw new Error(`GET /studio/docs/${id}: ${r.status}`);
    return r.json;
  };
  for (const c of GHG_COMPANIES) {
    const inventory = keep(`${c.key}/ghg-inventory-classic`, c, await build(c, "ghg-inventory-classic", ["GHGP"]));
    const resized = await call("POST", `/studio/docs/${inventory.id}/resize`, c.who, { format: "slide_16_9", purpose: "deck" });
    if (resized.status !== 201) throw new Error(`resize ${c.key}: ${resized.status} ${JSON.stringify(resized.json).slice(0, 400)}`);
    keep(`${c.key}/ghg-board-brief`, c, await load(c, resized.json.id), { resize: { pageCount: resized.json.pageCount, dropped: resized.json.dropped.length, truncated: resized.json.truncated.length } });
    keep(`${c.key}/ghg-one-page-summary`, c, await build(c, "ghg-one-page-classic", ["GHGP"]));
  }
  keep(`${KPI_COMPANY.key}/sustainability-editorial`, KPI_COMPANY, await build(KPI_COMPANY, "sustainability-editorial", ["GRI", "BRSR", "ESRS"]));
  ctx.seed = { companies: [...GHG_COMPANIES, KPI_COMPANY], ghg: GHG_COMPANIES, kpi: KPI_COMPANY, docs };
  return ctx.seed;
}

module.exports = { ensureSeed, resolveDoc, summarise, bindingLabel, docBindings, docTokens, GHG_COMPANIES, KPI_COMPANY };
