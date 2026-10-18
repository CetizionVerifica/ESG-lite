/**
 * KPI-2 · the library seed in data/kpi/ (frameworks.json, definitions.json,
 * disclosures/<framework>-<version>.json, mappings.json) and how it loads.
 *
 *   readSeed(dir)        the files as one object
 *   seedProblems(seed)   integrity: unique codes, valid enums and units, formulas,
 *                        every mapping points at an existing KPI and disclosure,
 *                        every disclosure has a source_url (unit test + loader)
 *   applySeed(m, seed)   idempotent load: adds missing rows, refreshes rows a
 *                        Superadmin never edited (`edited_at` null), never
 *                        touches an edited row and never deletes anything
 */
import fs from "fs";
import path from "path";
import type { EntityManager } from "typeorm";
import {
  KpiDefinitionCreateSchema,
  KpiDisclosureCreateSchema,
  KpiFrameworkCreateSchema,
  KpiMappingCreateSchema,
} from "../contracts/schemas";
import { TOPIC_PILLAR, type KpiTopic } from "../contracts/enums";
import { unitProblems } from "../values/units";
import { formulaProblems } from "./formulaRefs";

export interface SeedFramework {
  code: string;
  version: string;
  name: string;
  source_url: string;
  active: boolean;
  default_for_new: boolean;
}
export interface SeedDefinition {
  code: string;
  name: string;
  question: string;
  help: string | null;
  topic: string;
  value_type: string;
  unit_dimension: string;
  canonical_unit: string | null;
  allowed_units: string[];
  aggregation: string;
  level: string;
  default_frequency: string;
  source: string;
  auto_source: string | null;
  formula: string | null;
  breakdowns: Record<string, unknown> | null;
  decimals: number;
  /** D19: optional; defaults to TOPIC_PILLAR[topic]. */
  pillar?: string;
}
export interface SeedDisclosure {
  framework: string;
  version: string;
  code: string;
  title: string;
  section: string;
  requirement: string;
  esrs_topic: string | null;
  source_url: string;
  sort_key: number;
  verified: boolean;
}
export interface SeedMapping {
  framework: string;
  version: string;
  disclosure: string;
  kpi: string;
  fit: string;
  breakdown_key: string | null;
  display_unit: string | null;
  note: string | null;
}
export interface KpiSeed {
  frameworks: SeedFramework[];
  definitions: SeedDefinition[];
  disclosures: SeedDisclosure[];
  mappings: SeedMapping[];
}

export const DEFAULT_SEED_DIR = path.resolve(process.cwd(), "data/kpi");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

export const readSeed = (dir = DEFAULT_SEED_DIR): KpiSeed => {
  const disclosureDir = path.join(dir, "disclosures");
  const disclosures: SeedDisclosure[] = [];
  for (const file of fs.readdirSync(disclosureDir).filter((f) => f.endsWith(".json")).sort()) {
    const doc = readJson(path.join(disclosureDir, file));
    for (const d of doc.disclosures) disclosures.push({ framework: doc.framework, version: doc.version, ...d });
  }
  return {
    frameworks: readJson(path.join(dir, "frameworks.json")),
    definitions: readJson(path.join(dir, "definitions.json")),
    disclosures,
    mappings: readJson(path.join(dir, "mappings.json")),
  };
};

const fwKey = (code: string, version: string) => `${code}|${version}`;
const discKey = (code: string, version: string, disclosure: string) => `${code}|${version}|${disclosure}`;

export const seedProblems = (seed: KpiSeed): string[] => {
  const problems: string[] = [];
  const fws = new Set<string>();
  for (const f of seed.frameworks) {
    const key = fwKey(f.code, f.version);
    if (fws.has(key)) problems.push(`framework ${key} twice`);
    fws.add(key);
    if (!KpiFrameworkCreateSchema.safeParse(f).success) problems.push(`framework ${key} is invalid`);
  }
  const codes = new Set<string>();
  for (const d of seed.definitions) {
    if (codes.has(d.code)) problems.push(`KPI ${d.code} twice`);
    codes.add(d.code);
    const parsed = KpiDefinitionCreateSchema.safeParse(d);
    if (!parsed.success) problems.push(`KPI ${d.code}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    for (const p of unitProblems(d)) problems.push(`KPI ${d.code}: ${p}`);
    if (d.value_type === "percent" && d.canonical_unit !== "%") problems.push(`KPI ${d.code}: a percent KPI is in %`);
  }
  const formulas = new Map(seed.definitions.filter((d) => d.formula).map((d) => [d.code, d.formula as string]));
  for (const p of formulaProblems(formulas, codes)) problems.push(`KPI ${p.code}: ${p.problem}`);

  const discs = new Set<string>();
  for (const d of seed.disclosures) {
    const key = discKey(d.framework, d.version, d.code);
    if (!fws.has(fwKey(d.framework, d.version))) problems.push(`disclosure ${key}: unknown framework version`);
    if (discs.has(key)) problems.push(`disclosure ${key} twice`);
    discs.add(key);
    if (!d.source_url) problems.push(`disclosure ${key} has no source_url`);
    if (typeof d.verified !== "boolean") problems.push(`disclosure ${key} has no verified flag`);
    if (!KpiDisclosureCreateSchema.safeParse({ ...d, framework_id: 1 }).success) problems.push(`disclosure ${key} is invalid`);
    if ((d.framework === "ESRS") !== !!d.esrs_topic && d.code !== "GOV-1") problems.push(`disclosure ${key}: esrs_topic is for ESRS topical disclosures only`);
  }
  const pairs = new Set<string>();
  for (const m of seed.mappings) {
    const key = `${discKey(m.framework, m.version, m.disclosure)} → ${m.kpi}`;
    if (!discs.has(discKey(m.framework, m.version, m.disclosure))) problems.push(`mapping ${key}: unknown disclosure`);
    if (!codes.has(m.kpi)) problems.push(`mapping ${key}: unknown KPI`);
    if (pairs.has(key)) problems.push(`mapping ${key} twice`);
    pairs.add(key);
    if (!KpiMappingCreateSchema.safeParse({ ...m, disclosure_id: 1, kpi_definition_id: 1 }).success) problems.push(`mapping ${key} is invalid`);
    const def = seed.definitions.find((d) => d.code === m.kpi);
    const by = (def?.breakdowns as { by?: string[] } | null)?.by;
    if (m.breakdown_key && !(by ?? []).includes(m.breakdown_key)) problems.push(`mapping ${key}: the KPI has no "${m.breakdown_key}" breakdown`);
  }
  return problems;
};

export interface SeedCounts {
  added: number;
  refreshed: number;
  kept_edited: number;
}
export type SeedResult = Record<"frameworks" | "definitions" | "disclosures" | "mappings", SeedCounts>;

const counts = (): SeedCounts => ({ added: 0, refreshed: 0, kept_edited: 0 });
/** Key-order-independent JSON (jsonb comes back with its keys reordered). */
const stable = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : JSON.stringify(v ?? null);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

/**
 * Upserts one row by its natural key: insert when missing; when present and
 * never edited, update the fields that differ; when edited, leave it.
 */
async function upsert(
  m: EntityManager,
  table: string,
  where: Record<string, unknown>,
  fields: Record<string, unknown>,
  jsonFields: string[],
  c: SeedCounts,
): Promise<number> {
  const whereParams: unknown[] = [];
  const whereSql = Object.keys(where)
    .map((k) => {
      if (where[k] === null) return `"${k}" IS NULL`;
      whereParams.push(where[k]);
      return `"${k}" = $${whereParams.length}`;
    })
    .join(" AND ");
  const found: Array<Record<string, unknown>> = await m.query(`SELECT * FROM "${table}" WHERE ${whereSql} LIMIT 1`, whereParams);
  const value = (k: string) => (jsonFields.includes(k) ? JSON.stringify(fields[k] ?? null) : fields[k]);
  if (!found.length) {
    const all = { ...where, ...fields };
    const keys = Object.keys(all);
    const params = keys.map((k) => (jsonFields.includes(k) ? JSON.stringify(all[k] ?? null) : all[k]));
    const rows: Array<{ id: number }> = await m.query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      params,
    );
    c.added++;
    return Number(rows[0].id);
  }
  const row = found[0];
  if (row.edited_at) {
    c.kept_edited++;
    return Number(row.id);
  }
  const changed = Object.keys(fields).filter((k) => !same(row[k], fields[k]));
  if (changed.length) {
    const sets = changed.map((k, i) => `"${k}" = $${i + 2}`).join(", ");
    await m.query(`UPDATE "${table}" SET ${sets} WHERE id = $1 AND edited_at IS NULL`, [row.id, ...changed.map(value)]);
    c.refreshed++;
  }
  return Number(row.id);
}

export async function applySeed(m: EntityManager, seed: KpiSeed): Promise<SeedResult> {
  const result: SeedResult = { frameworks: counts(), definitions: counts(), disclosures: counts(), mappings: counts() };
  const frameworkIds = new Map<string, number>();
  for (const f of seed.frameworks) {
    const id = await upsert(m, "kpi_framework", { code: f.code, version: f.version }, { name: f.name, source_url: f.source_url, active: f.active, default_for_new: f.default_for_new }, [], result.frameworks);
    frameworkIds.set(fwKey(f.code, f.version), id);
  }
  const kpiIds = new Map<string, number>();
  for (const d of seed.definitions) {
    const { code, ...fields } = d;
    const pillar = fields.pillar ?? TOPIC_PILLAR[fields.topic as KpiTopic];
    const id = await upsert(m, "kpi_definition", { company_id: null, code }, { ...fields, pillar, help: fields.help ?? null, auto_source: fields.auto_source ?? null, formula: fields.formula ?? null, breakdowns: fields.breakdowns ?? null }, ["allowed_units", "breakdowns"], result.definitions);
    kpiIds.set(code, id);
  }
  const disclosureIds = new Map<string, number>();
  for (const d of seed.disclosures) {
    const frameworkId = frameworkIds.get(fwKey(d.framework, d.version))!;
    const id = await upsert(
      m,
      "kpi_disclosure",
      { framework_id: frameworkId, code: d.code },
      { title: d.title, section: d.section, requirement: d.requirement, esrs_topic: d.esrs_topic ?? null, source_url: d.source_url, sort_key: d.sort_key, verified: d.verified },
      [],
      result.disclosures,
    );
    disclosureIds.set(discKey(d.framework, d.version, d.code), id);
  }
  for (const mp of seed.mappings) {
    const disclosureId = disclosureIds.get(discKey(mp.framework, mp.version, mp.disclosure));
    const kpiId = kpiIds.get(mp.kpi);
    if (!disclosureId || !kpiId) continue; // seedProblems refuses such a seed before this runs
    await upsert(m, "kpi_disclosure_map", { disclosure_id: disclosureId, kpi_definition_id: kpiId }, { fit: mp.fit, breakdown_key: mp.breakdown_key ?? null, display_unit: mp.display_unit ?? null, note: mp.note ?? null }, [], result.mappings);
  }
  return result;
}
