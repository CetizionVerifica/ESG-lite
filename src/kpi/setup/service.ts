/**
 * KPI-3 · company setup service (module spec docs/kpi/modules/KPI-3-company-setup).
 *
 *   getSetup(caller)             GET /kpi/setup (any role of the company)
 *   putSetup(caller, body)       PUT /kpi/setup (Admin, Superadmin): any subset of the steps,
 *                                in one transaction, each step audited (`kpi_setup`)
 *   createCustomKpi(caller, b)   POST /kpi/setup/custom-kpis (Admin, Superadmin)
 *
 * Rules (PUT): one version per framework code; a topic marked not material and
 * a recommended KPI left out need a reason (KPI_REASON_REQUIRED); an owner is a
 * user of the site (of the company for company-level KPIs) and a reviewer a
 * Manager of the site (KPI_VALUE_INVALID); the year type can't change once
 * values use the other one. `settings.complete: true` finishes setup (at least
 * one framework and one selected KPI, else KPI_SETUP_INCOMPLETE).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import type { YearType } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { CustomKpiCreateSchema, KpiSetupPutSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { checkDefinition, returned } from "../library/service";
import { formulaCodes } from "../formulas/parse";
import { createNotification } from "../../services/notificationService";
import { recommend, type Recommendation } from "./recommend";
import { enabledFrameworks, kpiSettings, userSiteIds } from "./settings";

type Row = Record<string, any>;

/** pg advisory lock class for setup writes (one per company). */
export const KPI_SETUP_LOCK_CLASS = 4152;

const SETUP_WRITERS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

export const assertSetupWriter = (caller: KpiCaller) => {
  if (!SETUP_WRITERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN");
};

const auditSetup = (m: EntityManager, companyId: number, action: string, changed: Record<string, { old: unknown; new: unknown }>, userId: number, reason: string | null = null) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_setup', $1, $2, $3, $4, $5)`, [
    companyId,
    action,
    JSON.stringify(changed),
    reason,
    userId || null,
  ]);

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Active library KPIs plus the company's own (active or not). */
const definitionsFor = (m: EntityManager, companyId: number): Promise<Row[]> =>
  m.query(`SELECT * FROM kpi_definition WHERE (company_id IS NULL AND active) OR company_id = $1 ORDER BY topic, code`, [companyId]);

/** The recommendation for the company's enabled frameworks and material topics (or the ones given). */
export async function recommendedFor(m: EntityManager, companyId: number, override: { frameworkIds?: number[] } = {}): Promise<Recommendation[]> {
  const fwIds = override.frameworkIds ?? (await enabledFrameworks(m, companyId)).map((f) => Number(f.framework_id));
  const frameworks: Row[] = fwIds.length ? await m.query(`SELECT id, code, version FROM kpi_framework WHERE id = ANY($1::int[])`, [fwIds]) : [];
  const disclosures: Row[] = fwIds.length ? await m.query(`SELECT id, framework_id, code, requirement, esrs_topic FROM kpi_disclosure WHERE framework_id = ANY($1::int[])`, [fwIds]) : [];
  const definitions = await definitionsFor(m, companyId);
  const mappings: Row[] = disclosures.length
    ? await m.query(`SELECT disclosure_id, kpi_definition_id FROM kpi_disclosure_map WHERE disclosure_id = ANY($1::int[])`, [disclosures.map((d) => d.id)])
    : [];
  const topics: Row[] = await m.query(`SELECT esrs_topic, material FROM company_material_topic WHERE company_id = $1`, [companyId]);
  return recommend({
    frameworks: frameworks.map((f) => ({ id: Number(f.id), code: f.code, version: f.version })),
    disclosures: disclosures.map((d) => ({ id: Number(d.id), framework_id: Number(d.framework_id), code: d.code, requirement: d.requirement, esrs_topic: d.esrs_topic ?? null })),
    mappings: mappings.map((x) => ({ disclosure_id: Number(x.disclosure_id), kpi_definition_id: Number(x.kpi_definition_id) })),
    definitions: definitions.map((d) => ({ id: Number(d.id), code: d.code, source: d.source, formula: d.formula ?? null, active: d.active === true })),
    material: new Map(topics.map((t) => [t.esrs_topic as string, t.material === true])),
    refsOf: formulaCodes,
  });
}

/** Users of the company with their sites (no emails): the owner and reviewer pickers. */
async function companyPeople(m: EntityManager, companyId: number): Promise<Array<{ user_id: number; name: string; role: string; site_ids: number[] }>> {
  const rows: Row[] = await m.query(
    `SELECT u.user_id, TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.last_name, ''))) AS name, u.role,
            COALESCE(array_agg(DISTINCT s.site_id) FILTER (WHERE s.site_id IS NOT NULL), '{}') AS site_ids
       FROM "user" u
       LEFT JOIN user_sites us ON us.user_id = u.user_id
       JOIN site s ON (s.site_id = u.site_id OR s.site_id = us.site_id) AND s.company_id = $1
      WHERE u.role IN ('User', 'Manager', 'Admin')
      GROUP BY u.user_id ORDER BY u.user_id`,
    [companyId],
  );
  return rows.map((r) => ({ user_id: Number(r.user_id), name: r.name || `User ${r.user_id}`, role: r.role, site_ids: (r.site_ids as number[]).map(Number).sort((a, b) => a - b) }));
}

/**
 * Default owners (module spec, Build 5): a site-level KPI goes to the site's
 * first data-entry User and is reviewed by the site's managers (reviewer null);
 * a company-level KPI goes to the company's first Admin. Only manual KPIs need
 * an owner; pairs that already have an assignment are left out.
 */
function suggestAssignments(
  kpis: Row[],
  sites: Row[],
  people: Array<{ user_id: number; role: string; site_ids: number[] }>,
  assigned: Set<string>,
): Array<{ kpi_definition_id: number; site_id: number | null; owner_user_id: number; reviewer_user_id: null }> {
  const out: Array<{ kpi_definition_id: number; site_id: number | null; owner_user_id: number; reviewer_user_id: null }> = [];
  const admin = people.find((p) => p.role === UserRole.ADMIN);
  for (const k of kpis) {
    if (!k.selected || k.source !== "manual") continue;
    if (k.level === "company") {
      if (admin && !assigned.has(`${k.kpi_definition_id}:`)) out.push({ kpi_definition_id: k.kpi_definition_id, site_id: null, owner_user_id: admin.user_id, reviewer_user_id: null });
      continue;
    }
    for (const s of sites) {
      if (assigned.has(`${k.kpi_definition_id}:${s.site_id}`)) continue;
      const owner = people.find((p) => p.role === UserRole.USER && p.site_ids.includes(Number(s.site_id)));
      if (owner) out.push({ kpi_definition_id: k.kpi_definition_id, site_id: Number(s.site_id), owner_user_id: owner.user_id, reviewer_user_id: null });
    }
  }
  return out;
}

export async function getSetup(caller: KpiCaller) {
  const m = AppDataSource.manager;
  const companyId = caller.companyId;
  const s = await kpiSettings(m, companyId);
  const frameworks = await enabledFrameworks(m, companyId);
  const topics: Row[] = await m.query(`SELECT * FROM company_material_topic WHERE company_id = $1 ORDER BY esrs_topic`, [companyId]);
  const kpiRows: Row[] = await m.query(
    `SELECT ck.*, d.code, d.name, d.topic, d.level, d.source, d.default_frequency, d.company_id AS owner_company_id
       FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id
      WHERE ck.company_id = $1 ORDER BY d.topic, d.code`,
    [companyId],
  );
  const assignments: Row[] = await m.query(`SELECT * FROM kpi_assignment WHERE company_id = $1 ORDER BY kpi_definition_id, site_id NULLS FIRST`, [companyId]);
  const available: Row[] = await m.query(
    `SELECT id, code, version, name, source_url, default_for_new FROM kpi_framework WHERE active ORDER BY CASE code WHEN 'GRI' THEN 1 WHEN 'BRSR' THEN 2 WHEN 'ESRS' THEN 3 ELSE 4 END, version`,
  );
  const sites: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY name, site_id`, [companyId]);
  const kpis = kpiRows.map((k) => ({
    company_id: companyId,
    kpi_definition_id: Number(k.kpi_definition_id),
    code: k.code,
    name: k.name,
    topic: k.topic,
    level: k.level,
    source: k.source,
    custom: k.owner_company_id !== null,
    selected: k.selected === true,
    frequency: k.frequency ?? null,
    effective_frequency: k.frequency ?? k.default_frequency,
    reason_excluded: k.reason_excluded ?? null,
  }));
  const out: Record<string, unknown> = {
    settings: { company_id: companyId, year_type: s.year_type, first_year: s.first_year, due_day: s.due_day, setup_completed_at: iso(s.setup_completed_at) },
    frameworks: frameworks.map((f) => ({ company_id: companyId, framework_id: Number(f.framework_id), code: f.code, version: f.version, name: f.name, enabled_at: iso(f.enabled_at), enabled_by: f.enabled_by ?? null })),
    material_topics: topics.map((t) => ({ company_id: companyId, esrs_topic: t.esrs_topic, material: t.material === true, reason: t.reason ?? null, decided_by: t.decided_by ?? null, decided_at: iso(t.decided_at) })),
    kpis,
    assignments: assignments.map((a) => ({ company_id: companyId, kpi_definition_id: Number(a.kpi_definition_id), site_id: a.site_id === null ? null : Number(a.site_id), owner_user_id: Number(a.owner_user_id), reviewer_user_id: a.reviewer_user_id === null ? null : Number(a.reviewer_user_id) })),
    // The FE reads ids; the reasons ride beside them.
    ...(await (async () => {
      const recs = await recommendedFor(m, companyId);
      return { recommended: recs.map((r) => r.kpi_definition_id), recommended_reasons: recs };
    })()),
    available_frameworks: available.map((f) => ({ id: Number(f.id), code: f.code, version: f.version, name: f.name, source_url: f.source_url, default_for_new: f.default_for_new === true })),
    sites: sites.map((x) => ({ site_id: Number(x.site_id), name: x.name })),
  };
  // The pickers' data (names, roles, sites, grants) is for the people who set up.
  if (SETUP_WRITERS.has(caller.role)) {
    const people = await companyPeople(m, companyId);
    const assigned = new Set(assignments.map((a) => `${a.kpi_definition_id}:${a.site_id ?? ""}`));
    out.people = people;
    out.topic_grants = (
      await m.query(`SELECT user_id, topic FROM kpi_topic_grant WHERE user_id = ANY($1::int[]) ORDER BY user_id, topic`, [people.map((p) => p.user_id)])
    ).map((g: Row) => ({ user_id: Number(g.user_id), topic: g.topic }));
    out.suggested_assignments = suggestAssignments(kpis, sites, people, assigned);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PUT /kpi/setup
// ---------------------------------------------------------------------------

const hasText = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** KPI_REASON_REQUIRED before the schema runs, so a missing reason isn't a generic KPI_VALIDATION. */
function reasonPrecheck(raw: Row) {
  if (!Array.isArray(raw.material_topics)) return;
  for (const t of raw.material_topics) {
    if (t && typeof t === "object" && t.material === false && !hasText(t.reason)) throw new KpiError("KPI_REASON_REQUIRED", { esrs_topic: t.esrs_topic ?? null });
  }
}

const validation = (path: string, message: string) => new KpiError("KPI_VALIDATION", { issues: [{ path, message }] });

/** A KPI the company may set up: an active library KPI or its own. Another company's id is 404. */
async function visibleKpi(m: EntityManager, companyId: number, id: number): Promise<Row> {
  const rows: Row[] = await m.query(`SELECT * FROM kpi_definition WHERE id = $1 AND ((company_id IS NULL AND active) OR company_id = $2)`, [id, companyId]);
  if (!rows.length) throw new KpiError("KPI_NOT_FOUND", { kpi_definition_id: id });
  return rows[0];
}

async function saveSettings(m: EntityManager, caller: KpiCaller, settings: NonNullable<ReturnType<typeof KpiSetupPutSchema.parse>["settings"]>) {
  const companyId = caller.companyId;
  const before = await kpiSettings(m, companyId);
  const next = {
    year_type: (settings.year_type ?? before.year_type) as YearType,
    first_year: settings.first_year ?? before.first_year,
    due_day: settings.due_day ?? before.due_day,
  };
  if (before.stored && next.year_type !== before.year_type) {
    const used: Row[] = await m.query(`SELECT 1 FROM kpi_value WHERE company_id = $1 AND year_type <> $2 LIMIT 1`, [companyId, next.year_type]);
    if (used.length) throw validation("settings.year_type", "Values already use the other year type.");
  }
  await m.query(
    `INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id) DO UPDATE SET year_type = EXCLUDED.year_type, first_year = EXCLUDED.first_year, due_day = EXCLUDED.due_day, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [companyId, next.year_type, next.first_year, next.due_day, caller.userId || null],
  );
  const changed = Object.fromEntries(
    (["year_type", "first_year", "due_day"] as const)
      .filter((k) => !before.stored || before[k] !== next[k])
      .map((k) => [k, { old: before.stored ? before[k] : null, new: next[k] }]),
  );
  if (Object.keys(changed).length) await auditSetup(m, companyId, "settings", changed, caller.userId);
}

async function saveFrameworks(m: EntityManager, caller: KpiCaller, ids: number[]) {
  const companyId = caller.companyId;
  const unique = [...new Set(ids)];
  const rows: Row[] = unique.length ? await m.query(`SELECT id, code, version FROM kpi_framework WHERE id = ANY($1::int[]) AND active`, [unique]) : [];
  for (const id of unique) if (!rows.some((r) => Number(r.id) === id)) throw validation("frameworks", `No active framework version ${id}.`);
  const codes = rows.map((r) => r.code);
  if (new Set(codes).size !== codes.length) throw validation("frameworks", "Pick one version per framework.");
  const before = await enabledFrameworks(m, companyId);
  const beforeIds = before.map((f) => Number(f.framework_id));
  const removed = beforeIds.filter((id) => !unique.includes(id));
  if (removed.length) await m.query(`DELETE FROM company_framework WHERE company_id = $1 AND framework_id = ANY($2::int[])`, [companyId, removed]);
  for (const r of rows) {
    if (beforeIds.includes(Number(r.id))) continue;
    await m.query(`INSERT INTO company_framework (company_id, framework_id, framework_code, enabled_by) VALUES ($1, $2, $3, $4)`, [companyId, r.id, r.code, caller.userId || null]);
  }
  const label = (list: Row[]) => list.map((f) => `${f.code} ${f.version}`).sort();
  const after = rows.map((r) => ({ code: r.code, version: r.version }));
  if (JSON.stringify(label(before)) !== JSON.stringify(label(after))) await auditSetup(m, companyId, "frameworks", { frameworks: { old: label(before), new: label(after) } }, caller.userId);
}

async function saveMaterialTopics(m: EntityManager, caller: KpiCaller, topics: Array<{ esrs_topic: string; material: boolean; reason?: string | null }>) {
  const companyId = caller.companyId;
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const t of topics) {
    const reason = t.material ? null : (t.reason ?? "").trim();
    const old: Row[] = await m.query(`SELECT material, reason FROM company_material_topic WHERE company_id = $1 AND esrs_topic = $2`, [companyId, t.esrs_topic]);
    if (old.length && old[0].material === t.material && (old[0].reason ?? null) === reason) continue;
    await m.query(
      `INSERT INTO company_material_topic (company_id, esrs_topic, material, reason, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (company_id, esrs_topic) DO UPDATE SET material = EXCLUDED.material, reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by, decided_at = now()`,
      [companyId, t.esrs_topic, t.material, reason, caller.userId || null],
    );
    changed[t.esrs_topic] = { old: old.length ? { material: old[0].material, reason: old[0].reason ?? null } : null, new: { material: t.material, reason } };
  }
  if (Object.keys(changed).length) await auditSetup(m, companyId, "material_topics", changed, caller.userId);
}

/**
 * The KPI step replaces the company's selection: listed KPIs are saved as
 * sent; a KPI selected before and not listed is left out (a recommended one
 * then needs to be listed with its reason).
 */
async function saveKpis(m: EntityManager, caller: KpiCaller, items: Array<{ kpi_definition_id: number; selected: boolean; frequency?: string | null; reason_excluded?: string | null }>) {
  const companyId = caller.companyId;
  const recommended = new Set((await recommendedFor(m, companyId)).map((r) => r.kpi_definition_id));
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  const listed = new Set(items.map((i) => i.kpi_definition_id));
  const dropped: Row[] = await m.query(
    `SELECT ck.kpi_definition_id, ck.frequency, d.code FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id WHERE ck.company_id = $1 AND ck.selected`,
    [companyId],
  );
  for (const d of dropped) {
    const id = Number(d.kpi_definition_id);
    if (listed.has(id)) continue;
    if (recommended.has(id)) throw new KpiError("KPI_REASON_REQUIRED", { kpi_definition_id: id, kpi: d.code });
    await m.query(`UPDATE company_kpi SET selected = false, reason_excluded = NULL, updated_by = $3, updated_at = now() WHERE company_id = $1 AND kpi_definition_id = $2`, [companyId, id, caller.userId || null]);
    changed[d.code] = { old: { selected: true, frequency: d.frequency ?? null, reason_excluded: null }, new: { selected: false, frequency: d.frequency ?? null, reason_excluded: null } };
  }
  for (const item of items) {
    const kpi = await visibleKpi(m, companyId, item.kpi_definition_id);
    const reason = item.selected ? null : (item.reason_excluded ?? "").trim() || null;
    if (!item.selected && !reason && recommended.has(Number(kpi.id))) throw new KpiError("KPI_REASON_REQUIRED", { kpi_definition_id: Number(kpi.id), kpi: kpi.code });
    const old: Row[] = await m.query(`SELECT selected, frequency, reason_excluded FROM company_kpi WHERE company_id = $1 AND kpi_definition_id = $2`, [companyId, kpi.id]);
    const before = old.length ? { selected: old[0].selected, frequency: old[0].frequency ?? null, reason_excluded: old[0].reason_excluded ?? null } : null;
    // An omitted frequency keeps the override; null clears it.
    const frequency = item.frequency === undefined ? (before?.frequency ?? null) : item.frequency;
    const after = { selected: item.selected, frequency, reason_excluded: reason };
    if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
    await m.query(
      `INSERT INTO company_kpi (company_id, kpi_definition_id, selected, frequency, reason_excluded, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, kpi_definition_id) DO UPDATE SET selected = EXCLUDED.selected, frequency = EXCLUDED.frequency, reason_excluded = EXCLUDED.reason_excluded, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [companyId, kpi.id, item.selected, frequency, reason, caller.userId || null],
    );
    changed[kpi.code] = { old: before, new: after };
  }
  if (Object.keys(changed).length) await auditSetup(m, companyId, "kpis", changed, caller.userId);
}

async function saveAssignments(m: EntityManager, caller: KpiCaller, items: Array<{ kpi_definition_id: number; site_id: number | null; owner_user_id: number; reviewer_user_id?: number | null }>) {
  const companyId = caller.companyId;
  const companySites = new Set<number>(
    (await m.query(`SELECT site_id FROM site WHERE company_id = $1`, [companyId])).map((r: Row) => Number(r.site_id)),
  );
  const roles = new Map<number, string>();
  const sitesOf = new Map<number, Set<number>>();
  const person = async (userId: number) => {
    if (!roles.has(userId)) {
      const rows: Row[] = await m.query(`SELECT role FROM "user" WHERE user_id = $1`, [userId]);
      roles.set(userId, rows[0]?.role ?? "");
      sitesOf.set(userId, await userSiteIds(m, userId));
    }
    return { role: roles.get(userId)!, sites: sitesOf.get(userId)! };
  };
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const kpi = await visibleKpi(m, companyId, a.kpi_definition_id);
    const sel: Row[] = await m.query(`SELECT 1 FROM company_kpi WHERE company_id = $1 AND kpi_definition_id = $2 AND selected`, [companyId, kpi.id]);
    if (!sel.length) throw new KpiError("KPI_NOT_SELECTED", { kpi: kpi.code });
    if ((kpi.level === "company") !== (a.site_id === null)) throw validation(`assignments.${i}.site_id`, kpi.level === "company" ? "A company-level KPI has no site." : "A site-level KPI needs a site.");
    if (a.site_id !== null && !companySites.has(a.site_id)) throw new KpiError("KPI_NOT_FOUND", { site_id: a.site_id });

    const owner = await person(a.owner_user_id);
    const ownerSites = [...owner.sites].filter((s) => companySites.has(s));
    const ownerOk =
      owner.role !== UserRole.SUPERADMIN &&
      owner.role !== "" &&
      (a.site_id === null ? ownerSites.length > 0 : owner.role === UserRole.ADMIN ? ownerSites.length > 0 : owner.sites.has(a.site_id));
    if (!ownerOk) throw new KpiError("KPI_VALUE_INVALID", { field: `assignments.${i}.owner_user_id`, rule: a.site_id === null ? "user_of_the_company" : "user_of_the_site" });

    const reviewerId = a.reviewer_user_id ?? null;
    if (reviewerId !== null) {
      const reviewer = await person(reviewerId);
      const reviewerOk = reviewer.role === UserRole.MANAGER && (a.site_id === null ? [...reviewer.sites].some((s) => companySites.has(s)) : reviewer.sites.has(a.site_id));
      if (!reviewerOk) throw new KpiError("KPI_VALUE_INVALID", { field: `assignments.${i}.reviewer_user_id`, rule: "manager_of_the_site" });
    }

    const old: Row[] = await m.query(
      `SELECT owner_user_id, reviewer_user_id FROM kpi_assignment WHERE company_id = $1 AND kpi_definition_id = $2 AND site_id IS NOT DISTINCT FROM $3`,
      [companyId, kpi.id, a.site_id],
    );
    const before = old.length ? { owner_user_id: Number(old[0].owner_user_id), reviewer_user_id: old[0].reviewer_user_id === null ? null : Number(old[0].reviewer_user_id) } : null;
    const after = { owner_user_id: a.owner_user_id, reviewer_user_id: reviewerId };
    if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
    await m.query(
      `INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id, reviewer_user_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, kpi_definition_id, (COALESCE(site_id, 0))) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, reviewer_user_id = EXCLUDED.reviewer_user_id, updated_at = now()`,
      [companyId, kpi.id, a.site_id, a.owner_user_id, reviewerId],
    );
    changed[`${kpi.code}@${a.site_id ?? "company"}`] = { old: before, new: after };
  }
  if (Object.keys(changed).length) await auditSetup(m, companyId, "assignments", changed, caller.userId);
}

async function complete(m: EntityManager, caller: KpiCaller) {
  const companyId = caller.companyId;
  const missing: string[] = [];
  if (!(await enabledFrameworks(m, companyId)).length) missing.push("frameworks");
  const sel: Row[] = await m.query(`SELECT 1 FROM company_kpi WHERE company_id = $1 AND selected LIMIT 1`, [companyId]);
  if (!sel.length) missing.push("kpis");
  if (missing.length) throw new KpiError("KPI_SETUP_INCOMPLETE", { missing });
  const result = await m.query(
    `UPDATE company_kpi_settings SET setup_completed_at = now(), updated_by = $2, updated_at = now() WHERE company_id = $1 AND setup_completed_at IS NULL RETURNING setup_completed_at`,
    [companyId, caller.userId || null],
  );
  if (returned(result).length) await auditSetup(m, companyId, "complete", { setup_completed_at: { old: null, new: iso(returned(result)[0].setup_completed_at) } }, caller.userId);
}

export async function putSetup(caller: KpiCaller, raw: unknown) {
  assertSetupWriter(caller);
  const input: Row = raw && typeof raw === "object" ? { ...(raw as Row) } : {};
  // The FE mock calls the framework step `framework_ids`; both spellings are accepted.
  if (input.frameworks === undefined && input.framework_ids !== undefined) input.frameworks = input.framework_ids;
  reasonPrecheck(input);
  const body = parse(KpiSetupPutSchema, input);
  await AppDataSource.transaction(async (m) => {
    // Serialise setup writes per company, and make sure the settings row exists.
    await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [KPI_SETUP_LOCK_CLASS, caller.companyId]);
    const s = await kpiSettings(m, caller.companyId);
    if (!s.stored) {
      await m.query(`INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, updated_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (company_id) DO NOTHING`, [
        caller.companyId,
        s.year_type,
        s.first_year,
        s.due_day,
        caller.userId || null,
      ]);
      if (!body.settings) await auditSetup(m, caller.companyId, "settings", { year_type: { old: null, new: s.year_type }, first_year: { old: null, new: s.first_year }, due_day: { old: null, new: s.due_day } }, caller.userId);
    }
    if (body.settings) await saveSettings(m, caller, body.settings);
    if (body.frameworks) await saveFrameworks(m, caller, body.frameworks);
    if (body.material_topics) await saveMaterialTopics(m, caller, body.material_topics);
    if (body.kpis) await saveKpis(m, caller, body.kpis);
    if (body.assignments) await saveAssignments(m, caller, body.assignments);
    if (body.settings?.complete) await complete(m, caller);
  });
  return getSetup(caller);
}

// ---------------------------------------------------------------------------
// POST /kpi/setup/custom-kpis
// ---------------------------------------------------------------------------

/** A code from the name when the Admin didn't give one: `C<company>_<NAME>`. */
async function generatedCode(m: EntityManager, companyId: number, name: string): Promise<string> {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "KPI";
  const base = `C${companyId}_${slug}`;
  for (let n = 1; n < 1000; n++) {
    const code = n === 1 ? base : `${base}_${n}`;
    const taken: Row[] = await m.query(`SELECT 1 FROM kpi_definition WHERE code = $1 AND (company_id IS NULL OR company_id = $2)`, [code, companyId]);
    if (!taken.length) return code;
  }
  throw new KpiError("KPI_CODE_TAKEN");
}

export async function createCustomKpi(caller: KpiCaller, raw: unknown) {
  assertSetupWriter(caller);
  const companyId = caller.companyId;
  return AppDataSource.transaction(async (m) => {
    const input: Row = raw && typeof raw === "object" ? { ...(raw as Row) } : {};
    delete input.company_id;
    if (input.source === undefined) input.source = "manual";
    if (input.code === undefined || input.code === null || input.code === "") input.code = await generatedCode(m, companyId, typeof input.name === "string" ? input.name : "");
    const data = parse(CustomKpiCreateSchema, input);
    const { mappings = [], ...def } = data;
    const clash: Row[] = await m.query(`SELECT 1 FROM kpi_definition WHERE code = $1 AND (company_id IS NULL OR company_id = $2)`, [def.code, companyId]);
    if (clash.length) throw new KpiError("KPI_CODE_TAKEN");
    await checkDefinition(m, def, null, companyId);
    for (const [i, mp] of mappings.entries()) {
      if ((mp.fit === "partial" || mp.fit === "derived") && !mp.note) throw validation(`mappings.${i}.note`, "A partial or derived fit carries a note.");
      const ds: Row[] = await m.query(`SELECT 1 FROM kpi_disclosure ds JOIN kpi_framework f ON f.id = ds.framework_id AND f.active WHERE ds.id = $1`, [mp.disclosure_id]);
      if (!ds.length) throw validation(`mappings.${i}.disclosure_id`, "No such disclosure.");
    }
    const rows: Row[] = await m.query(
      `INSERT INTO kpi_definition (code, name, question, help, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, auto_source, formula, breakdowns, decimals, company_id, active, edited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, $14, $15, $16, $17, $18, now()) RETURNING *`,
      [
        def.code, def.name, def.question, def.help ?? null, def.topic, def.value_type, def.unit_dimension, def.canonical_unit, JSON.stringify(def.allowed_units),
        def.aggregation, def.level, def.default_frequency, def.source, def.formula ?? null, def.breakdowns ? JSON.stringify(def.breakdowns) : null,
        def.decimals ?? 2, companyId, def.active ?? true,
      ],
    );
    const row = rows[0];
    const saved: Row[] = [];
    for (const mp of mappings) {
      const r: Row[] = await m.query(
        `INSERT INTO kpi_disclosure_map (disclosure_id, kpi_definition_id, fit, note, edited_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (disclosure_id, kpi_definition_id) DO NOTHING RETURNING id, disclosure_id, kpi_definition_id, fit, breakdown_key, display_unit, note`,
        [mp.disclosure_id, row.id, mp.fit, mp.note ?? null],
      );
      saved.push(...r);
    }
    await m.query(
      `INSERT INTO company_kpi (company_id, kpi_definition_id, selected, updated_by) VALUES ($1, $2, true, $3) ON CONFLICT (company_id, kpi_definition_id) DO NOTHING`,
      [companyId, row.id, caller.userId || null],
    );
    await auditSetup(m, companyId, "custom_kpi", { kpi: { old: null, new: { id: row.id, code: row.code, mappings: saved.map((s) => s.disclosure_id) } } }, caller.userId);
    return { ...row, mappings: saved };
  });
}

// ---------------------------------------------------------------------------
// POST /kpi/setup/invite
// ---------------------------------------------------------------------------

/**
 * "Invite your team" (05-ux S2): a `kpi_assigned` notification to every owner
 * of an assignment of a selected KPI, once per person. Admin, Superadmin.
 */
export async function inviteTeam(caller: KpiCaller): Promise<{ notified: number }> {
  assertSetupWriter(caller);
  const m = AppDataSource.manager;
  const owners: Row[] = await m.query(
    `SELECT a.owner_user_id, COUNT(*)::int AS n FROM kpi_assignment a
       JOIN company_kpi ck ON ck.company_id = a.company_id AND ck.kpi_definition_id = a.kpi_definition_id AND ck.selected
       JOIN "user" u ON u.user_id = a.owner_user_id
      WHERE a.company_id = $1 GROUP BY a.owner_user_id ORDER BY a.owner_user_id`,
    [caller.companyId],
  );
  for (const o of owners) {
    const n = Number(o.n);
    await createNotification(
      Number(o.owner_user_id),
      "kpi_assigned",
      "You have KPIs to enter",
      `${n} KPI${n === 1 ? " is" : "s are"} assigned to you. Open My KPIs to see what's due.`,
      "/kpi",
    );
  }
  await auditSetup(m, caller.companyId, "invite", { notified: { old: null, new: owners.map((o) => Number(o.owner_user_id)) } }, caller.userId);
  return { notified: owners.length };
}

