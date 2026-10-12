// Declaration export (C05): the footprint as a branded PDF (rendered by the
// front end from format=pdf-data), a PACT v3 ProductFootprint and a CSV.
// Spec: docs/pcf/pages/C05 (ESG-lite_FE) and docs/plan-claims/C05.md.
// Pure: no database. The controller loads the study and passes it in.
//
// A declaration leaves the platform, so licensed (ecoinvent) values are
// withheld for every reader, superadmins included: lines priced with a
// licensed factor carry no value, their stages hide the total and the
// aggregates that could give a factor back are left out (see redact.ts).
// The product total is the footprint itself and always shows.
// A PCF result is never a CBAM "specific embedded emissions" figure.
import { createHash } from "crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { Dqr, PcfEngineInput, PcfLine, ResultStage } from "./engine/computePcf";
import { RESULT_STAGES } from "./engine/computePcf";
import { licensedLineIds, redactStages } from "./redact";
import { PACT_SPEC_VERSION, productFootprintSchema } from "./pact/productFootprintSchema";

export type ExportFormat = "pdf-data" | "pact" | "csv";
export const EXPORT_FORMATS: ExportFormat[] = ["pdf-data", "pact", "csv"];

export class DeclarationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DeclarationSource {
  study: {
    id: number;
    version: number;
    status: "draft" | "in_review" | "approved" | "published" | "superseded";
    standard: string;
    boundary: string;
    pcr_tag: string | null;
    allocation_key: string;
    cut_off_rule_pct: number;
    reference_start: string; // YYYY-MM-DD
    reference_end: string; // YYYY-MM-DD, inclusive
    year_type: "CY" | "FY";
    reviewed_at: Date | null;
    reviewed_by: string | null;
    parent_version_id: number | null;
  };
  company: { id: number; name: string; email: string | null };
  product: {
    id: number;
    name: string;
    description: string | null;
    declared_unit: string | null;
    declared_unit_qty: number | null;
    mass_per_unit_kg: number | null;
  };
  site: { id: number; name: string; country_code: string | null; country_name: string | null };
  result: {
    total_kg_per_unit: number;
    by_stage: Record<string, number>;
    lines: PcfLine[];
    primary_data_share_pct: number;
    dqr: (Dqr & { overall: number }) | null;
    cut_off: { below_threshold_ids: string[]; below_threshold_total_pct: number; within_limit: boolean } | null;
    allocation: { share_pct: number; product_output_units: number } | null;
    warnings: string[];
    calculated_at: Date;
    engine_version: string;
    input: PcfEngineInput | null;
  };
  // Material factor id ("mf-12") → the year of its source, when known.
  factor_years: Record<string, number | null>;
  // Domain used in PACT URNs, e.g. "acme.com".
  issuer_domain: string;
  generated_at: Date;
}

export interface DeclarationLine {
  id: string;
  stage: ResultStage;
  name: string;
  data_type: "primary" | "secondary";
  kgco2e_per_unit: number | null;
  value_hidden: boolean;
}

export interface Declaration {
  pact_id: string;
  draft: boolean;
  status: DeclarationSource["study"]["status"];
  version: number;
  company: { name: string };
  product: { name: string; description: string | null };
  site: { name: string; country: string | null };
  declared_unit: { quantity: number; unit: string; label: string };
  reference_period: { start: string; end: string; year_type: "CY" | "FY" };
  method: {
    standard: string;
    boundary: string;
    pcr: string | null;
    allocation_key: string;
    allocation_share_pct: number | null;
    cut_off_rule_pct: number;
    gwp_sets: string[];
  };
  total_kg_per_unit: number;
  by_stage: Record<string, number | null>;
  hidden_stages: string[];
  lines: DeclarationLine[];
  primary_data_share_pct: number | null;
  dqr: (Dqr & { overall: number }) | null;
  cut_off: { below_threshold_total_pct: number | null; within_limit: boolean } | null;
  licensed_values_withheld: boolean;
  factor_sources: { name: string; version: string }[];
  warnings: string[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  calculated_at: string;
  generated_at: string;
  engine_version: string;
}

const FINAL = new Set(["approved", "published", "superseded"]);

// ------------------------------------------------------------- helpers ---

// PACT decimals are strings without an exponent.
export function decimal(n: number): string {
  if (!Number.isFinite(n)) throw new DeclarationError(500, "A footprint value is not a finite number");
  const s = n.toFixed(10).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

// RFC 4122 version 5 (SHA-1, name-based) UUID: the same study always exports
// with the same PACT id.
const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
export function uuidV5(name: string, namespace = URL_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const pactIdFor = (studyId: number) => uuidV5(`esglite:pcf-study:${studyId}`);

const addDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

type PactUnit =
  | "liter" | "kilogram" | "cubic meter" | "kilowatt hour" | "megajoule"
  | "ton kilometer" | "square meter" | "piece" | "hour" | "megabit second";

// Product declared unit → PACT unit and the factor that turns the declared
// quantity into that unit. Units with no mass (energy, transport work, time)
// declare 0 kg per unit, as PACT allows.
const UNIT_MAP: Record<string, { unit: PactUnit; factor: number; massless?: boolean }> = {
  kg: { unit: "kilogram", factor: 1 },
  g: { unit: "kilogram", factor: 0.001 },
  t: { unit: "kilogram", factor: 1000 },
  tonne: { unit: "kilogram", factor: 1000 },
  tonnes: { unit: "kilogram", factor: 1000 },
  l: { unit: "liter", factor: 1 },
  liter: { unit: "liter", factor: 1 },
  litre: { unit: "liter", factor: 1 },
  m3: { unit: "cubic meter", factor: 1 },
  "m³": { unit: "cubic meter", factor: 1 },
  m2: { unit: "square meter", factor: 1 },
  "m²": { unit: "square meter", factor: 1 },
  kwh: { unit: "kilowatt hour", factor: 1, massless: true },
  mj: { unit: "megajoule", factor: 1, massless: true },
  piece: { unit: "piece", factor: 1 },
  pieces: { unit: "piece", factor: 1 },
  pcs: { unit: "piece", factor: 1 },
  unit: { unit: "piece", factor: 1 },
  units: { unit: "piece", factor: 1 },
  tkm: { unit: "ton kilometer", factor: 1, massless: true },
  "tonne.km": { unit: "ton kilometer", factor: 1, massless: true },
  h: { unit: "hour", factor: 1, massless: true },
  hour: { unit: "hour", factor: 1, massless: true },
};

export function pactUnit(declaredUnit: string | null, qty: number | null, massPerUnitKg: number | null) {
  const raw = (declaredUnit ?? "").trim();
  const m = UNIT_MAP[raw.toLowerCase()];
  if (!m) {
    throw new DeclarationError(
      400,
      raw
        ? `The declared unit "${raw}" has no PACT equivalent; use kg, t, l, m³, m², kWh, MJ, piece, tkm or h`
        : "Set the product's declared unit first",
    );
  }
  const quantity = qty != null && qty > 0 ? qty : 1;
  const amount = quantity * m.factor;
  let mass: number;
  if (m.unit === "kilogram") mass = amount;
  else if (massPerUnitKg != null && massPerUnitKg >= 0) mass = massPerUnitKg;
  else if (m.massless) mass = 0;
  else throw new DeclarationError(409, "Set the product's mass per declared unit before exporting to PACT");
  return { unit: m.unit, amount, mass };
}

// ----------------------------------------------------------- declaration ---

export function buildDeclaration(src: DeclarationSource): Declaration {
  const { study, result } = src;
  const hidden = licensedLineIds(result.input);
  const { by_stage, hidden_stages } = redactStages(result.by_stage, result.lines, hidden);
  const anyHidden = hidden.size > 0;

  const factors = result.input?.factors ?? [];
  const used = new Set(
    (result.input?.inputs ?? []).filter((i) => i.supplier_pcf_kgco2e == null).flatMap((i) => [i.factor_id, i.recycled_factor_id]),
  );
  const sources = new Map<string, { name: string; version: string }>();
  for (const f of factors) {
    if (!used.has(f.id) || !f.source?.trim()) continue;
    const year = src.factor_years[f.id];
    const version = year ? String(year) : "unspecified";
    sources.set(`${f.source.trim()}|${version}`, { name: f.source.trim(), version });
  }
  const gwp = [...new Set(factors.map((f) => f.gwp_set).filter((g): g is string => !!g && /^AR\d+$/.test(g)))].sort();

  const qty = src.product.declared_unit_qty ?? 1;
  const unit = src.product.declared_unit ?? "";
  return {
    pact_id: pactIdFor(study.id),
    draft: !FINAL.has(study.status),
    status: study.status,
    version: study.version,
    company: { name: src.company.name },
    product: { name: src.product.name, description: src.product.description },
    site: { name: src.site.name, country: src.site.country_name },
    declared_unit: { quantity: qty, unit, label: `${decimal(qty)} ${unit}`.trim() },
    reference_period: { start: study.reference_start, end: study.reference_end, year_type: study.year_type },
    method: {
      standard: study.standard,
      boundary: study.boundary,
      pcr: study.pcr_tag,
      allocation_key: study.allocation_key,
      allocation_share_pct: result.allocation?.share_pct ?? null,
      cut_off_rule_pct: study.cut_off_rule_pct,
      gwp_sets: gwp.length ? gwp : ["AR6"],
    },
    total_kg_per_unit: result.total_kg_per_unit,
    by_stage: Object.fromEntries(RESULT_STAGES.map((s) => [s, s in by_stage ? by_stage[s] : 0])),
    hidden_stages,
    lines: result.lines.map((l) => ({
      id: l.id,
      stage: l.stage,
      name: l.name,
      data_type: l.data_type,
      kgco2e_per_unit: hidden.has(l.id) ? null : l.kgco2e_per_unit,
      value_hidden: hidden.has(l.id),
    })),
    primary_data_share_pct: anyHidden ? null : result.primary_data_share_pct,
    dqr: anyHidden ? null : result.dqr,
    cut_off: result.cut_off
      ? { below_threshold_total_pct: anyHidden ? null : result.cut_off.below_threshold_total_pct, within_limit: result.cut_off.within_limit }
      : null,
    licensed_values_withheld: anyHidden,
    factor_sources: [...sources.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)),
    warnings: result.warnings,
    reviewed_by: study.reviewed_by,
    reviewed_at: study.reviewed_at ? study.reviewed_at.toISOString() : null,
    calculated_at: result.calculated_at.toISOString(),
    generated_at: src.generated_at.toISOString(),
    engine_version: result.engine_version,
  };
}

// ------------------------------------------------------------------ PACT ---

const STANDARDS: Record<string, string> = {
  iso14067: "ISO14067",
  "iso 14067": "ISO14067",
  "iso-14067": "ISO14067",
  "ghg protocol product": "GHGP-Product",
  "ghgp-product": "GHGP-Product",
};

const STAGE_LABEL: Record<string, string> = {
  A1: "raw materials",
  A2: "inbound transport",
  A3_energy: "plant energy",
  A3_packaging: "packaging",
  A3_waste: "production waste",
};

export function toPact(src: DeclarationSource, d: Declaration = buildDeclaration(src)): Record<string, unknown> {
  const { study } = src;
  if (!FINAL.has(study.status)) {
    throw new DeclarationError(409, "Only an approved or published footprint can be exported to PACT");
  }
  const unit = pactUnit(src.product.declared_unit, src.product.declared_unit_qty, src.product.mass_per_unit_kg);
  const domain = src.issuer_domain;
  const total = decimal(d.total_kg_per_unit);
  const stages = RESULT_STAGES.filter((s) => (src.result.by_stage[s] ?? 0) !== 0 || s === "A1").map((s) => STAGE_LABEL[s]);

  const pcf: Record<string, unknown> = {
    declaredUnitOfMeasurement: unit.unit,
    declaredUnitAmount: decimal(unit.amount),
    productMassPerDeclaredUnit: decimal(unit.mass),
    referencePeriodStart: `${study.reference_start}T00:00:00Z`,
    referencePeriodEnd: `${addDay(study.reference_end)}T00:00:00Z`,
    boundaryProcessesDescription: `${study.boundary === "cradle_to_grave" ? "Cradle to grave" : "Cradle to gate"}: ${stages.join(", ")}.`,
    // No biogenic uptake, aircraft or land-use change is modelled yet, so the
    // whole total is fossil (method note §2.13).
    pcfExcludingBiogenicUptake: total,
    pcfIncludingBiogenicUptake: total,
    fossilGhgEmissions: total,
    fossilCarbonContent: "0",
    biogenicCarbonContent: "0",
    packagingEmissionsIncluded: true,
    ipccCharacterizationFactors: d.method.gwp_sets,
    crossSectoralStandards: [...new Set([STANDARDS[study.standard.trim().toLowerCase()] ?? null, "PACT-3.0"].filter((s): s is string => !!s))],
    exemptedEmissionsPercent: "0",
    exemptedEmissionsDescription: `No emissions are exempted. Items below the ${decimal(study.cut_off_rule_pct)}% cut-off rule are flagged for review but stay in the total.`,
  };
  if (!d.hidden_stages.includes("A3_packaging")) pcf.packagingGhgEmissions = decimal(Math.max(0, src.result.by_stage.A3_packaging ?? 0));
  if (src.site.country_code && /^[A-Z]{2}$/.test(src.site.country_code)) pcf.geographyCountry = src.site.country_code;
  if (study.pcr_tag?.trim()) {
    pcf.productOrSectorSpecificRules = [{ operator: "Other", otherOperatorName: study.pcr_tag.trim(), ruleNames: [study.pcr_tag.trim()] }];
  }
  if (src.result.allocation) {
    pcf.allocationRulesDescription = `Plant Scope 1 and 2 emissions allocated by ${study.allocation_key.replace(/_/g, " ")}; this product's share is ${decimal(Number(src.result.allocation.share_pct.toFixed(4)))}%.`;
  }
  if (d.factor_sources.length) pcf.secondaryEmissionFactorSources = d.factor_sources;
  if (d.primary_data_share_pct != null) pcf.primaryDataShare = decimal(Number(d.primary_data_share_pct.toFixed(4)));
  if (d.dqr) {
    pcf.dqi = {
      technologicalDQR: decimal(Number(d.dqr.technology.toFixed(4))),
      geographicalDQR: decimal(Number(d.dqr.geography.toFixed(4))),
      temporalDQR: decimal(Number(d.dqr.time.toFixed(4))),
    };
  }

  const pf: Record<string, unknown> = {
    id: d.pact_id,
    specVersion: PACT_SPEC_VERSION,
    created: (study.reviewed_at ?? src.result.calculated_at).toISOString(),
    status: study.status === "superseded" ? "Deprecated" : "Active",
    companyName: src.company.name,
    companyIds: [`urn:pact:${domain}:company-id:${src.company.id}`],
    productDescription: src.product.description?.trim() || src.product.name,
    productIds: [`urn:pact:${domain}:supplier-id:${src.product.id}`],
    productNameCompany: src.product.name,
    comment: `ESGLite footprint ${study.id}, version ${study.version}. Fossil and biogenic carbon content are not modelled and are reported as 0.${d.licensed_values_withheld ? " Primary data share and data quality are withheld because licensed factor values could be derived from them." : ""}`,
    pcf,
  };
  if (study.parent_version_id) pf.precedingPfIds = [pactIdFor(study.parent_version_id)];
  return pf;
}

let validator: ReturnType<Ajv2020["compile"]> | null = null;
export function validatePact(doc: unknown): string[] {
  if (!validator) {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    // The schema's own patterns check these; the formats only label them.
    ajv.addFormat("decimal", true);
    ajv.addFormat("urn", true);
    validator = ajv.compile(productFootprintSchema as object);
  }
  if (validator(doc)) return [];
  return (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

// ------------------------------------------------------------------- CSV ---

// Quote every text cell and defuse spreadsheet formulas (=, +, -, @).
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return decimal(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(d: Declaration): string {
  const rows: (string | number | null)[][] = [];
  if (d.draft) rows.push(["DRAFT", "Not approved; do not share as a final declaration"]);
  rows.push(
    ["Company", d.company.name],
    ["Product", d.product.name],
    ["Site", d.site.name],
    ["Declared unit", d.declared_unit.label],
    ["Reference period", `${d.reference_period.start} to ${d.reference_period.end}`],
    ["Status", d.status],
    ["Version", d.version],
    ["Standard", d.method.standard],
    ["Boundary", d.method.boundary],
    ["PCR", d.method.pcr],
    ["GWP set", d.method.gwp_sets.join(" ")],
    ["Total kg CO2e per declared unit", d.total_kg_per_unit],
    ["Primary data share %", d.primary_data_share_pct],
    ["DQR overall", d.dqr?.overall ?? null],
    ["PACT id", d.pact_id],
  );
  if (d.licensed_values_withheld) rows.push(["Note", "Values from licensed factors are withheld"]);
  rows.push([]);
  rows.push(["Stage", "kg CO2e per declared unit"]);
  for (const s of RESULT_STAGES) rows.push([s, d.by_stage[s]]);
  rows.push([]);
  rows.push(["Stage", "Line", "Data type", "kg CO2e per declared unit"]);
  for (const l of d.lines) rows.push([l.stage, l.name, l.data_type, l.kgco2e_per_unit]);
  // UTF-8 BOM so spreadsheet apps read "CO₂"-style characters correctly.
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
