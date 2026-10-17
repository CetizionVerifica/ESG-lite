/**
 * KPI-2 · library service: list, create and update frameworks, KPI
 * definitions, disclosures and mappings (Superadmin), the coverage helper, and
 * the catalogue a client reads. Every write sets `edited_at` (so a re-seed keeps
 * it) and records an audit_log row (`kpi_library`). Nothing is ever deleted:
 * a row is retired with `active: false` (frameworks, KPIs).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { KpiError } from "../contracts/errors";
import {
  KpiDefinitionCreateSchema,
  KpiDefinitionUpdateSchema,
  KpiDisclosureCreateSchema,
  KpiDisclosureUpdateSchema,
  KpiFrameworkCreateSchema,
  KpiFrameworkUpdateSchema,
  KpiMappingCreateSchema,
  KpiMappingUpdateSchema,
  LibraryQuerySchema,
} from "../contracts/schemas";
import { parse } from "../http";
import { unitProblems } from "../values/units";
import { formulaProblems } from "./formulaRefs";

type Row = Record<string, any>;
const db = () => AppDataSource.manager;

const audit = (m: EntityManager, entityId: number, action: string, changed: Record<string, { old: unknown; new: unknown }>, userId: number) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_library', $1, $2, $3, NULL, $4)`, [
    entityId,
    action,
    JSON.stringify(changed),
    userId || null,
  ]);

const JSON_COLUMNS = new Set(["allowed_units", "breakdowns"]);
const param = (k: string, v: unknown) => (JSON_COLUMNS.has(k) ? JSON.stringify(v ?? null) : v ?? null);

/** TypeORM answers UPDATE … RETURNING with [rows, affected]; INSERT with rows. */
export const returned = (result: unknown): Row[] => (Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as Row[]) : (result as Row[]));

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

async function insertRow(m: EntityManager, table: string, data: Row): Promise<Row> {
  const keys = Object.keys(data);
  try {
    const rows: Row[] = await m.query(
      `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}, "edited_at") VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}, now()) RETURNING *`,
      keys.map((k) => param(k, data[k])),
    );
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw new KpiError("KPI_CODE_TAKEN");
    throw err;
  }
}

async function updateRow(m: EntityManager, table: string, id: number, patch: Row): Promise<Row> {
  const keys = Object.keys(patch);
  const sets = [...keys.map((k, i) => `"${k}" = $${i + 2}`), `"edited_at" = now()`].join(", ");
  try {
    const result = await m.query(`UPDATE "${table}" SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => param(k, patch[k]))]);
    return returned(result)[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw new KpiError("KPI_CODE_TAKEN");
    throw err;
  }
}

const diff = (before: Row | null, after: Row, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null)).map((k) => [k, { old: before?.[k] ?? null, new: after[k] ?? null }]));

async function findById(m: EntityManager, table: string, id: number, extra = ""): Promise<Row> {
  const rows: Row[] = await m.query(`SELECT * FROM "${table}" WHERE id = $1 ${extra}`, [id]);
  if (!rows.length) throw new KpiError("KPI_NOT_FOUND");
  return rows[0];
}

// ---------------------------------------------------------------------------
// Frameworks
// ---------------------------------------------------------------------------

export const listFrameworks = async (): Promise<Row[]> =>
  db().query(`SELECT * FROM kpi_framework ORDER BY CASE code WHEN 'GRI' THEN 1 WHEN 'BRSR' THEN 2 WHEN 'ESRS' THEN 3 ELSE 4 END, version`);

export const createFramework = (body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const data = parse(KpiFrameworkCreateSchema, body);
    const row = await insertRow(m, "kpi_framework", data);
    await audit(m, row.id, "framework_created", diff(null, row, Object.keys(data)), userId);
    return row;
  });

export const updateFramework = (id: number, body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const patch = parse(KpiFrameworkUpdateSchema, body);
    const before = await findById(m, "kpi_framework", id);
    if (!Object.keys(patch).length) return before;
    const row = await updateRow(m, "kpi_framework", id, patch);
    await audit(m, id, "framework_updated", diff(before, row, Object.keys(patch)), userId);
    return row;
  });

// ---------------------------------------------------------------------------
// KPI definitions (library rows: company_id IS NULL)
// ---------------------------------------------------------------------------

const DEFINITION_KEYS = [
  "name", "question", "help", "topic", "value_type", "unit_dimension", "canonical_unit", "allowed_units", "aggregation",
  "level", "default_frequency", "source", "auto_source", "formula", "breakdowns", "decimals", "active",
];

/** Unit, value-type and formula checks on a whole (merged) definition. */
async function checkDefinition(m: EntityManager, d: Row, selfId: number | null) {
  const problems = unitProblems({ unit_dimension: d.unit_dimension, canonical_unit: d.canonical_unit, allowed_units: d.allowed_units ?? [] });
  if (d.value_type === "percent" && d.canonical_unit !== "%") problems.push("A percent KPI is in %.");
  if (["yes_no", "choice", "text"].includes(d.value_type) && d.unit_dimension !== "none") problems.push("A yes/no, choice or text KPI has no unit dimension.");
  if (problems.length) throw new KpiError("KPI_UNIT_NOT_ALLOWED", { problems });
  if (d.source !== "formula" || !d.formula) return;
  const rows: Array<{ id: number; code: string; formula: string | null; source: string }> = await m.query(
    `SELECT id, code, formula, source FROM kpi_definition WHERE company_id IS NULL`,
  );
  const known = new Set(rows.map((r) => r.code).concat(d.code));
  const formulas = new Map<string, string>();
  for (const r of rows) if (r.id !== selfId && r.source === "formula" && r.formula) formulas.set(r.code, r.formula);
  formulas.set(d.code, d.formula);
  const found = formulaProblems(formulas, known).filter((p) => p.code === d.code || p.problem.includes(d.code));
  if (found.length) throw new KpiError("KPI_FORMULA_INVALID", { problems: found.map((p) => p.problem) });
}

export async function listDefinitions(query: unknown): Promise<Row[]> {
  const q = parse(LibraryQuerySchema, query ?? {});
  const where = ["d.company_id IS NULL"];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.topic) add("d.topic = ?", q.topic);
  if (q.source) add("d.source = ?", q.source);
  if (q.active !== undefined) add("d.active = ?", q.active);
  if (q.framework) add(`EXISTS (SELECT 1 FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id JOIN kpi_framework f ON f.id = ds.framework_id WHERE mp.kpi_definition_id = d.id AND f.code = ?)`, q.framework);
  const rows: Row[] = await db().query(
    `SELECT d.*,
            COALESCE((SELECT json_agg(json_build_object('id', mp.id, 'disclosure_id', ds.id, 'framework', f.code, 'version', f.version, 'code', ds.code, 'fit', mp.fit) ORDER BY f.code, ds.sort_key)
                        FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id JOIN kpi_framework f ON f.id = ds.framework_id
                       WHERE mp.kpi_definition_id = d.id), '[]') AS mappings
       FROM kpi_definition d WHERE ${where.join(" AND ")} ORDER BY d.topic, d.code`,
    params,
  );
  return rows;
}

export async function getDefinition(id: number): Promise<Row> {
  const row = await findById(db(), "kpi_definition", id, "AND company_id IS NULL");
  const mappings: Row[] = await db().query(
    `SELECT mp.*, ds.code AS disclosure_code, ds.title AS disclosure_title, f.code AS framework, f.version
       FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id JOIN kpi_framework f ON f.id = ds.framework_id
      WHERE mp.kpi_definition_id = $1 ORDER BY f.code, ds.sort_key`,
    [id],
  );
  return { ...row, mappings };
}

export const createDefinition = (body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const data = parse(KpiDefinitionCreateSchema, body);
    await checkDefinition(m, data, null);
    const row = await insertRow(m, "kpi_definition", {
      ...data,
      help: data.help ?? null,
      auto_source: data.auto_source ?? null,
      formula: data.formula ?? null,
      breakdowns: data.breakdowns ?? null,
      decimals: data.decimals ?? 2,
      active: data.active ?? true,
      company_id: null,
    });
    await audit(m, row.id, "definition_created", diff(null, row, ["code", ...DEFINITION_KEYS]), userId);
    return row;
  });

export const updateDefinition = (id: number, body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const patch = parse(KpiDefinitionUpdateSchema, body);
    const before = await findById(m, "kpi_definition", id, "AND company_id IS NULL");
    if (!Object.keys(patch).length) return before;
    const merged = { ...before, ...patch };
    const whole = KpiDefinitionCreateSchema.safeParse({ ...merged, help: merged.help ?? null });
    if (!whole.success) throw new KpiError("KPI_VALIDATION", { issues: whole.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    await checkDefinition(m, merged, id);
    const row = await updateRow(m, "kpi_definition", id, patch);
    await audit(m, id, "definition_updated", diff(before, row, Object.keys(patch)), userId);
    return row;
  });

// ---------------------------------------------------------------------------
// Disclosures
// ---------------------------------------------------------------------------

export async function listDisclosures(query: unknown): Promise<Row[]> {
  const q = parse(LibraryQuerySchema, query ?? {});
  const where: string[] = ["true"];
  const params: unknown[] = [];
  if (q.framework) {
    params.push(q.framework);
    where.push(`f.code = $${params.length}`);
  }
  if (q.framework_id) {
    params.push(q.framework_id);
    where.push(`ds.framework_id = $${params.length}`);
  }
  return db().query(
    `SELECT ds.*, f.code AS framework, f.version,
            (SELECT COUNT(*)::int FROM kpi_disclosure_map mp WHERE mp.disclosure_id = ds.id) AS mapped_kpis
       FROM kpi_disclosure ds JOIN kpi_framework f ON f.id = ds.framework_id
      WHERE ${where.join(" AND ")} ORDER BY f.code, f.version, ds.sort_key, ds.code`,
    params,
  );
}

export const createDisclosure = (body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const data = parse(KpiDisclosureCreateSchema, body);
    const fw: Row[] = await m.query(`SELECT code FROM kpi_framework WHERE id = $1`, [data.framework_id]);
    if (!fw.length) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "framework_id", message: "No such framework" }] });
    if (data.esrs_topic && fw[0].code !== "ESRS") throw new KpiError("KPI_VALIDATION", { issues: [{ path: "esrs_topic", message: "Only ESRS disclosures have an ESRS topic" }] });
    const row = await insertRow(m, "kpi_disclosure", { ...data, esrs_topic: data.esrs_topic ?? null, sort_key: data.sort_key ?? 0, verified: data.verified ?? false });
    await audit(m, row.id, "disclosure_created", diff(null, row, Object.keys(data)), userId);
    return row;
  });

export const updateDisclosure = (id: number, body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const patch = parse(KpiDisclosureUpdateSchema, body);
    const before = await findById(m, "kpi_disclosure", id);
    if (!Object.keys(patch).length) return before;
    const row = await updateRow(m, "kpi_disclosure", id, patch);
    await audit(m, id, "disclosure_updated", diff(before, row, Object.keys(patch)), userId);
    return row;
  });

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

export async function listMappings(query: unknown): Promise<Row[]> {
  const q = parse(LibraryQuerySchema, query ?? {});
  const where: string[] = ["d.company_id IS NULL"];
  const params: unknown[] = [];
  if (q.framework) {
    params.push(q.framework);
    where.push(`f.code = $${params.length}`);
  }
  if (q.kpi) {
    params.push(q.kpi);
    where.push(`mp.kpi_definition_id = $${params.length}`);
  }
  return db().query(
    `SELECT mp.*, d.code AS kpi_code, ds.code AS disclosure_code, f.code AS framework, f.version
       FROM kpi_disclosure_map mp
       JOIN kpi_definition d ON d.id = mp.kpi_definition_id
       JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id
       JOIN kpi_framework f ON f.id = ds.framework_id
      WHERE ${where.join(" AND ")} ORDER BY f.code, ds.sort_key, d.code`,
    params,
  );
}

async function checkBreakdownKey(m: EntityManager, kpiId: number, key: string | null | undefined) {
  if (!key) return;
  const rows: Row[] = await m.query(`SELECT breakdowns FROM kpi_definition WHERE id = $1`, [kpiId]);
  const by: string[] = rows[0]?.breakdowns?.by ?? [];
  if (!by.includes(key)) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "breakdown_key", message: "The KPI has no such breakdown" }] });
}

export const createMapping = (body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const data = parse(KpiMappingCreateSchema, body);
    const disc: Row[] = await m.query(`SELECT 1 FROM kpi_disclosure WHERE id = $1`, [data.disclosure_id]);
    const kpi: Row[] = await m.query(`SELECT 1 FROM kpi_definition WHERE id = $1 AND company_id IS NULL`, [data.kpi_definition_id]);
    if (!disc.length || !kpi.length) throw new KpiError("KPI_VALIDATION", { issues: [{ path: disc.length ? "kpi_definition_id" : "disclosure_id", message: "No such row" }] });
    await checkBreakdownKey(m, data.kpi_definition_id, data.breakdown_key);
    const row = await insertRow(m, "kpi_disclosure_map", { ...data, breakdown_key: data.breakdown_key ?? null, display_unit: data.display_unit ?? null, note: data.note ?? null });
    await audit(m, row.id, "mapping_created", diff(null, row, Object.keys(data)), userId);
    return row;
  });

export const updateMapping = (id: number, body: unknown, userId: number) =>
  AppDataSource.transaction(async (m) => {
    const patch = parse(KpiMappingUpdateSchema, body);
    const before = await findById(m, "kpi_disclosure_map", id);
    if (!Object.keys(patch).length) return before;
    const merged = { ...before, ...patch };
    if ((merged.fit === "partial" || merged.fit === "derived") && !merged.note) {
      throw new KpiError("KPI_VALIDATION", { issues: [{ path: "note", message: "A partial or derived fit carries a note." }] });
    }
    await checkBreakdownKey(m, before.kpi_definition_id, patch.breakdown_key);
    const row = await updateRow(m, "kpi_disclosure_map", id, patch);
    await audit(m, id, "mapping_updated", diff(before, row, Object.keys(patch)), userId);
    return row;
  });

// ---------------------------------------------------------------------------
// Coverage and the client catalogue
// ---------------------------------------------------------------------------

/** Per framework version: disclosures, how many have at least one active KPI mapped, and the gaps. */
export const libraryCoverage = async (): Promise<Row[]> => {
  const rows: Row[] = await db().query(
    `SELECT f.id AS framework_id, f.code, f.version,
            COUNT(ds.id)::int AS disclosures,
            COUNT(ds.id) FILTER (WHERE EXISTS (SELECT 1 FROM kpi_disclosure_map mp JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND d.active
                                               WHERE mp.disclosure_id = ds.id))::int AS mapped,
            COALESCE(json_agg(ds.code ORDER BY ds.sort_key) FILTER (WHERE ds.id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM kpi_disclosure_map mp JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND d.active WHERE mp.disclosure_id = ds.id)), '[]') AS unmapped
       FROM kpi_framework f LEFT JOIN kpi_disclosure ds ON ds.framework_id = f.id
      GROUP BY f.id ORDER BY f.code, f.version`,
  );
  return rows;
};

/**
 * GET /kpi/catalogue: the library as a company sees it. Active framework
 * versions, their disclosures, the active library KPIs plus the company's own,
 * and the mappings between them. TODO(KPI-3): only the versions the company
 * enabled (company_framework).
 */
export async function catalogue(companyId: number) {
  const m = db();
  const frameworks: Row[] = await m.query(`SELECT id, code, version, name, source_url, default_for_new FROM kpi_framework WHERE active ORDER BY code, version`);
  const fwIds = frameworks.map((f) => f.id);
  const disclosures: Row[] = await m.query(
    `SELECT id, framework_id, code, title, section, requirement, esrs_topic, source_url, sort_key FROM kpi_disclosure WHERE framework_id = ANY($1::int[]) ORDER BY framework_id, sort_key, code`,
    [fwIds],
  );
  const definitions: Row[] = await m.query(
    `SELECT id, code, name, question, help, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level,
            default_frequency, source, auto_source, formula, breakdowns, decimals, company_id
       FROM kpi_definition WHERE active AND (company_id IS NULL OR company_id = $1) ORDER BY topic, code`,
    [companyId],
  );
  const mappings: Row[] = await m.query(
    `SELECT mp.id, mp.disclosure_id, mp.kpi_definition_id, mp.fit, mp.breakdown_key, mp.display_unit, mp.note
       FROM kpi_disclosure_map mp
       JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id AND ds.framework_id = ANY($1::int[])
       JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND d.active AND (d.company_id IS NULL OR d.company_id = $2)
      ORDER BY mp.disclosure_id, mp.kpi_definition_id`,
    [fwIds, companyId],
  );
  return { frameworks, disclosures, definitions, mappings };
}
