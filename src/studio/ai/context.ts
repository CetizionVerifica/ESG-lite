/**
 * DS-9 · the context builder (RS-8 §4): for a design, assemble only what a
 * prompt needs, already resolved and formatted by DS-2:
 *
 *   company   name, industry, number of sites in the design (no people, no emails)
 *   report    kind, title, period, frameworks, look → tone
 *   facts     GHG: scopes, Scope 3 categories, gases, biogenic CO₂, intensity, base year,
 *             data quality and coverage, each with its token, display value and change
 *             vs the prior year. Sustainability: the design's KPIs, the same way.
 *             Unavailable figures are listed as "not reported" with no token.
 *   inputs    report details (01-contracts §2.1) as text, except the responsible person
 *   voice     brand.voice (D11; empty → "plain, factual, third person")
 *
 * It never includes user names or emails, evidence, raw entries, factors or
 * another company's data. `scope` is what the token guard accepts.
 */
import { AppDataSource } from "../../config/data-source";
import { formatSpec } from "../../reporting/studio/render/formats";
import { ghgCategory } from "../../scope3/contracts/ghgCategory";
import {
  DEFAULT_BRAND_VOICE,
  MAX_BRAND_VOICE_CHARS,
  REPORT_INPUT_KEYS,
  type Binding,
  type DataToken,
  type GhgBinding,
  type GhgMetric,
  type KpiBinding,
  type ReportDoc,
  type ReportInputKey,
  type ReportKind,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { docBindings } from "../sources/doc";
import { METRIC_LABELS } from "../sources/ghg";
import { inputDisplay, periodText } from "../sources/inputs";
import { expandCode } from "../sources/kpi";
import { buildContext, loadersFor, resolveBinding, resolveToken, type Loaders } from "../sources/resolve";
import type { ResolveContext, ResolvedBinding } from "../sources/types";
import { TOKEN_RE, ghgKey, parseToken, tokenAttrs, type TokenScope } from "./guard";

type Row = Record<string, any>;

export interface Fact {
  /** The token key: 'total', 'scope3_category.4', or a KPI code. */
  key: string;
  label: string;
  token: string | null;
  display: string;
  prior?: string;
  changePct?: string;
  note?: string;
}

export interface AiContext {
  caller: StudioCaller;
  docId: number | null;
  doc: ReportDoc;
  kind: ReportKind;
  company: { name: string; industry: string | null; sites: number };
  period: string;
  tone: string;
  facts: Fact[];
  inputs: Array<{ key: ReportInputKey; label: string; text: string }>;
  voice: string;
  scope: TokenScope;
  /** Display text of a token (chat replies): the server's figure, never the model's. */
  displayToken(raw: string): Promise<string>;
}

const TONE: Record<string, string> = { classic: "measured and confident", light: "plain and friendly", night: "bold and direct" };

const INPUT_LABELS: Record<ReportInputKey, string> = {
  consolidation_approach: "Consolidation approach",
  responsible_person: "Responsible person",
  reporting_period: "Reporting period",
  base_year: "Base year",
  recalculation_policy: "Base-year recalculation policy",
  significance_threshold_pct: "Significance threshold",
  gwp_set: "GWP values",
  exclusions: "Exclusions",
  scope2_instruments: "Scope 2 instruments",
  uncertainty_statement: "Uncertainty",
  verification: "Verification",
  conformance: "Conformance",
  revenue: "Revenue",
  revenue_ppp_rate: "Revenue PPP rate",
  output_units: "Output units",
  employees: "Employees",
  leadership_message: "Leadership message",
  about_company: "About the company",
};
/** Left out of every prompt: a person's name. */
const NEVER_IN_PROMPTS: ReportInputKey[] = ["responsible_person"];

const GHG_FACT_METRICS: GhgMetric[] = [
  "total",
  "scope1",
  "scope2_location",
  "scope2_market",
  "scope3",
  "biogenic_co2",
  "gas_co2",
  "gas_ch4",
  "gas_n2o",
  "intensity_revenue",
  "intensity_output",
  "intensity_employee",
  "base_year_total",
  "dq_score",
  "primary_data_pct",
  "sites_covered",
  "months_covered",
];
/** Metrics that compare with the prior year in the facts list. */
const WITH_CHANGE = new Set<GhgMetric>(["total", "scope1", "scope2_location", "scope3", "scope3_category", "intensity_revenue", "intensity_output", "intensity_employee"]);

const valueToken = (r: ResolvedBinding, measure: DataToken["attrs"]["measure"]) => resolveToken(r, { type: "data", attrs: { binding: { source: "ghg", metric: "total", years: { last: 1 }, sites: "all" }, measure } } as DataToken);

async function ghgFacts(L: Loaders, ctx: ResolveContext): Promise<Fact[]> {
  const facts: Fact[] = [];
  const one = async (key: string, label: string, b: GhgBinding) => {
    const withChange = WITH_CHANGE.has(b.metric);
    const r = await resolveBinding(L, ctx, withChange ? ({ ...b, compare: "prior" } as GhgBinding) : b, 0);
    if (r.unavailable) {
      facts.push({ key, label, token: null, display: r.display || "Not reported", note: `not available (${r.unavailable.reason.toLowerCase().replace(/_/g, " ")}); do not mention a figure` });
      return;
    }
    const f: Fact = { key, label, token: `{{data:${key}|current|value}}`, display: `${valueToken(r, "value").display}${r.unit ? ` ${r.unit}` : ""}` };
    if (withChange && r.compare && r.compare.value !== null) {
      f.prior = `{{data:${key}|prior|value}}`;
      f.changePct = `{{data:${key}|current|change_pct}} (${valueToken(r, "change_pct").display})`;
    }
    facts.push(f);
  };
  for (const m of GHG_FACT_METRICS) await one(m, METRIC_LABELS[m], { source: "ghg", metric: m, years: { last: 1 }, sites: "all" } as GhgBinding);
  for (let n = 1; n <= 15; n++) {
    await one(`scope3_category.${n}`, `Scope 3 Category ${n}: ${ghgCategory(n)?.name ?? ""}`.trim(), { source: "ghg", metric: "scope3_category", scope3Category: n, years: { last: 1 }, sites: "all" } as GhgBinding);
  }
  return facts;
}

async function kpiFacts(L: Loaders, ctx: ResolveContext, doc: ReportDoc): Promise<Fact[]> {
  const codes = [...new Set(docBindings(doc).flatMap((b: Binding) => (b.source === "kpi" ? (b as KpiBinding).kpis : [])))].slice(0, 40);
  const facts: Fact[] = [];
  for (const code of codes) {
    const def = await expandCode(L.kpi, code).catch(() => null);
    if (!def) continue;
    const r = await resolveBinding(L, ctx, { source: "kpi", kpis: [code], years: { last: 2 }, sites: "all", compare: "prior" } as KpiBinding, 0).catch(() => null);
    if (!r) continue;
    if (r.unavailable) {
      facts.push({ key: code, label: def.name, token: null, display: "Not reported", note: "not available; do not mention a figure" });
      continue;
    }
    const f: Fact = { key: code, label: def.name, token: `{{kpi:${code}|current|value}}`, display: `${r.display}${r.unit ? ` ${r.unit}` : ""}` };
    if (r.compare && r.compare.value !== null) {
      f.prior = `{{kpi:${code}|prior|value}}`;
      f.changePct = `{{kpi:${code}|current|change_pct}}`;
    }
    if (r.target) f.note = `has a target for ${r.target.target_year}: {{kpi:${code}|current|target}}, progress {{kpi:${code}|current|progress}}`;
    facts.push(f);
  }
  return facts;
}

/** The brand voice (D11), capped; empty → the default. */
export async function brandVoice(companyId: number): Promise<string> {
  const [b]: Row[] = await AppDataSource.query(`SELECT voice FROM brand WHERE company_id = $1`, [companyId]).catch(() => [{}]);
  const v = String(b?.voice ?? "").trim().slice(0, MAX_BRAND_VOICE_CHARS);
  return v || DEFAULT_BRAND_VOICE;
}

export async function buildAiContext(caller: StudioCaller, docId: number | null, doc: ReportDoc): Promise<AiContext> {
  const L = loadersFor(caller.companyId, doc.meta.yearType);
  const { ctx } = await buildContext(caller, { kind: doc.kind, year: doc.meta.year, yearType: doc.meta.yearType, sites: doc.meta.sites, ...(docId ? { docId } : {}) }, L);
  const [company]: Row[] = await AppDataSource.query(`SELECT name, industry FROM company WHERE company_id = $1`, [caller.companyId]);
  const facts = doc.kind === "ghg" ? await ghgFacts(L, ctx) : await kpiFacts(L, ctx, doc);
  const inputs = REPORT_INPUT_KEYS.filter((k) => !NEVER_IN_PROMPTS.includes(k))
    .map((k) => ({ key: k, label: INPUT_LABELS[k], text: ctx.inputs[k] ? inputDisplay(k, ctx.inputs[k]!.value) : "" }))
    .filter((i) => i.text.trim());
  const scope: TokenScope = {
    kind: doc.kind,
    docYear: doc.meta.year,
    ghg: new Set(doc.kind === "ghg" ? facts.filter((f) => f.token).map((f) => f.key) : []),
    kpis: new Set(doc.kind === "sustainability" ? facts.filter((f) => f.token).map((f) => f.key) : []),
    inputs: new Map(inputs.map((i) => [i.key, i.text])),
  };
  const period = typeof ctx.inputs.reporting_period?.value === "string" && ctx.inputs.reporting_period.value.trim() ? ctx.inputs.reporting_period.value : periodText(doc.meta.yearType, doc.meta.year);
  const look = doc.design.theme?.look ?? "classic";
  return {
    caller,
    docId,
    doc,
    kind: doc.kind,
    company: { name: String(company?.name ?? ""), industry: company?.industry ? String(company.industry) : null, sites: ctx.siteIds.length },
    period,
    tone: TONE[look] ?? TONE.classic,
    facts,
    inputs,
    voice: await brandVoice(caller.companyId),
    scope,
    async displayToken(raw: string) {
      TOKEN_RE.lastIndex = 0;
      const m = TOKEN_RE.exec(raw);
      TOKEN_RE.lastIndex = 0;
      if (!m) return raw;
      const p = parseToken(m[0], m[1], m[2], m[3], m[4]);
      if (typeof p === "string") return "—";
      if (p.type === "input") return scope.inputs.get(p.ref as ReportInputKey) ?? "—";
      const attrs = tokenAttrs(p, scope);
      if (typeof attrs === "string") return "—";
      const b = attrs.binding as Binding;
      const binding = (attrs.measure === "change_abs" || attrs.measure === "change_pct") && !(b as GhgBinding).compare ? ({ ...b, compare: attrs.year === "base" ? "base" : "prior" } as Binding) : b;
      const r = await resolveBinding(L, ctx, binding, 0).catch(() => null);
      if (!r) return "—";
      const t = resolveToken(r, { type: "data", attrs } as DataToken);
      return `${t.display}${t.unit && attrs.measure === "value" ? ` ${t.unit}` : ""}`;
    },
  };
}

/** A rough character budget for a text frame (mm): body text at about 10 pt. */
export function charBudget(frame: { w: number; h: number } | undefined, fallback = 900): number {
  if (!frame) return fallback;
  return Math.max(160, Math.min(3000, Math.round((frame.w * frame.h) / 10)));
}

/** A new body-text frame on a page of the doc's format (inside the safe area). */
export function newTextFrame(doc: ReportDoc): { x: number; y: number; w: number; h: number; rotation: number } {
  const f = formatSpec(doc.format);
  const w = f.wMm - 2 * f.safeMm;
  const h = Math.min(60, f.hMm / 3);
  return { x: f.safeMm, y: Math.max(f.safeMm, f.hMm / 2 - h / 2), w, h, rotation: 0 };
}

/** Is a GHG key one the facts offer? (used by the chat to read "Scope 3 category 9"). */
export const factKeyOk = (ctx: AiContext, key: string) => (ctx.kind === "ghg" ? !!ghgKey(key) && ctx.scope.ghg.has(key) : ctx.scope.kpis.has(key));
