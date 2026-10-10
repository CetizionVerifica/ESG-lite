// PCF studies, their input lines and material factors (E1, part 3).
// Spec: docs/pcf/foundation/E1-data-and-engine/CLAUDE.md ("API").
// Every route sits behind requirePcfAccess (Manager or Superadmin) and is
// scoped to the manager's own sites. Only drafts can be edited or deleted.
import { Response } from "express";
import { EntityManager, In } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "../middlewares/auth.middleware";
import { PcfStudy, PcfAllocationKey, PcfStudyStatus } from "../entities/PcfStudy";
import { PcfInput, PcfStage } from "../entities/PcfInput";
import { PcfResult } from "../entities/PcfResult";
import { MaterialFactor } from "../entities/MaterialFactor";
import { EmissionFactor } from "../entities/EmissionFactor";
import { Product } from "../entities/Product";
import { Site } from "../entities/Site";
import { Company } from "../entities/Company";
import { User } from "../entities/User";
import { canSeeCompany, canSeeSite, pcfScope, PcfScope } from "../pcf/access";
import { licensedLineIds, redactAggregates, redactStages } from "../pcf/redact";
import type { PcfEngineInput } from "../pcf/engine/computePcf";

const studyRepo = () => AppDataSource.getRepository(PcfStudy);
const inputRepo = () => AppDataSource.getRepository(PcfInput);
const resultRepo = () => AppDataSource.getRepository(PcfResult);
const factorRepo = () => AppDataSource.getRepository(MaterialFactor);

const STATUSES: PcfStudyStatus[] = ["draft", "in_review", "approved", "published", "superseded"];
const VERSION_LOCK = 7102; // advisory lock namespace: numbering a product's versions
const STAGES: PcfStage[] = ["A1", "A2", "A3_packaging", "A3_waste"];
const KEYS: PcfAllocationKey[] = ["mass", "machine_hours", "energy", "economic", "manual"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 500;

// A real calendar date, not just the YYYY-MM-DD shape.
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "1900-01-01";
};

// Method note §2.10: the reference period is twelve months, a calendar year
// (Jan–Dec) or a financial year (Apr–Mar), matching the study's year_type.
export function periodError(start: string, end: string, yearType: "CY" | "FY"): string | null {
  const y = Number(start.slice(0, 4));
  const want = yearType === "CY" ? [`${y}-01-01`, `${y}-12-31`] : [`${y}-04-01`, `${y + 1}-03-31`];
  if (start !== want[0] || end !== want[1]) {
    return yearType === "CY"
      ? "A calendar-year footprint runs from 1 January to 31 December of one year"
      : "A financial-year footprint runs from 1 April to 31 March";
  }
  return null;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------- loading ---

export async function loadStudy(id: number, scope: PcfScope) {
  const study = await studyRepo().findOne({
    where: { pcf_study_id: id },
    relations: ["company", "product", "site", "parent_version", "created_by", "reviewed_by"],
  });
  if (!study || !canSeeSite(scope, study.site.site_id)) return null;
  return study;
}

const userRef = (u: User | null | undefined) => (u ? { user_id: u.user_id, name: u.name } : null);

// Pass the viewer's scope so licensed values are hidden from non-superadmins.
export function studyJson(s: PcfStudy, result: PcfResult | null | undefined, scope: PcfScope) {
  return {
    pcf_study_id: s.pcf_study_id,
    company_id: s.company?.company_id ?? null,
    product: s.product
      ? { product_id: s.product.product_id, name: s.product.name, declared_unit: s.product.declared_unit,
          declared_unit_qty: num(s.product.declared_unit_qty), mass_per_unit_kg: num(s.product.mass_per_unit_kg) }
      : null,
    site: s.site ? { site_id: s.site.site_id, name: s.site.name } : null,
    reference_start: s.reference_start,
    reference_end: s.reference_end,
    year_type: s.year_type,
    boundary: s.boundary,
    standard: s.standard,
    pcr_tag: s.pcr_tag,
    allocation_key: s.allocation_key,
    cut_off_rule_pct: num(s.cut_off_rule_pct),
    version: s.version,
    parent_version_id: s.parent_version?.pcf_study_id ?? null,
    status: s.status,
    stale: s.stale,
    notes: s.notes,
    created_by: userRef(s.created_by),
    reviewed_by: userRef(s.reviewed_by),
    reviewed_at: s.reviewed_at,
    review_comment: s.review_comment,
    created_at: s.created_at,
    updated_at: s.updated_at,
    result: result === undefined ? undefined : result ? resultSummary(result, scope) : null,
  };
}

function resultSummary(r: PcfResult, scope: PcfScope) {
  const input = (r.factor_snapshot as unknown as { input?: PcfEngineInput } | null)?.input;
  const hidden = scope.all ? new Set<string>() : licensedLineIds(input);
  const { by_stage, hidden_stages } = redactStages(r.by_stage, input?.inputs ?? [], hidden);
  return {
    total_kg_per_unit: Number(r.total_kg_per_unit),
    by_stage,
    hidden_stages,
    ...redactAggregates({ primary_data_share_pct: Number(r.primary_data_share_pct), dqr_overall: Number(r.dqr_overall) }, hidden),
    warnings: ((r.cut_off as { warnings?: string[] } | null)?.warnings ?? []) as string[],
    is_draft: r.is_draft,
    calculated_at: r.calculated_at,
    engine_version: r.engine_version,
  };
}

export function inputJson(i: PcfInput) {
  return {
    pcf_input_id: i.pcf_input_id,
    stage: i.stage,
    name: i.name,
    sort_order: i.sort_order,
    material_factor_id: i.material_factor?.material_factor_id ?? null,
    recycled_material_factor_id: i.recycled_material_factor?.material_factor_id ?? null,
    emission_factor_id: i.emission_factor?.emission_factor_id ?? null,
    supplier_pcf_kgco2e: num(i.supplier_pcf_kgco2e),
    quantity: Number(i.quantity),
    unit: i.unit,
    recycled_share_pct: Number(i.recycled_share_pct),
    origin_country: i.origin_country,
    supplier_name: i.supplier_name,
    transport_mode: i.transport_mode,
    distance_km: num(i.distance_km),
    payload_t: num(i.payload_t),
    data_type: i.data_type,
    dqr_technology: i.dqr_technology,
    dqr_geography: i.dqr_geography,
    dqr_time: i.dqr_time,
    ai_suggested: i.ai_suggested,
    ai_confidence: num(i.ai_confidence),
  };
}

export const loadInputs = (studyId: number) =>
  inputRepo().find({
    where: { study: { pcf_study_id: studyId } },
    relations: ["material_factor", "recycled_material_factor", "emission_factor"],
    order: { sort_order: "ASC", pcf_input_id: "ASC" },
  });

// ---------------------------------------------------------------- studies ---

// GET /pcf/studies?productId=&status=&siteId=
export const listStudies = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    if (!scope.all && scope.siteIds.length === 0) return res.json([]);
    const qb = studyRepo()
      .createQueryBuilder("s")
      .leftJoinAndSelect("s.company", "company")
      .leftJoinAndSelect("s.product", "product")
      .leftJoinAndSelect("s.site", "site")
      .leftJoinAndSelect("s.parent_version", "parent")
      .leftJoinAndSelect("s.created_by", "creator")
      .leftJoinAndSelect("s.reviewed_by", "reviewer")
      .orderBy("s.updated_at", "DESC");
    if (!scope.all) qb.andWhere("site.site_id IN (:...sites)", { sites: scope.siteIds });
    const productId = idParam(req.query.productId);
    const siteId = idParam(req.query.siteId);
    if (req.query.productId !== undefined && !productId) return res.status(400).json({ message: "productId must be an id" });
    if (req.query.siteId !== undefined && !siteId) return res.status(400).json({ message: "siteId must be an id" });
    if (productId) qb.andWhere("product.product_id = :productId", { productId });
    if (siteId) qb.andWhere("site.site_id = :siteId", { siteId });
    if (req.query.status !== undefined) {
      if (!STATUSES.includes(req.query.status as PcfStudyStatus)) return res.status(400).json({ message: `status must be one of ${STATUSES.join(", ")}` });
      qb.andWhere("s.status = :status", { status: req.query.status });
    }
    const studies = await qb.getMany();
    const results = studies.length
      ? await resultRepo().find({ where: { study: { pcf_study_id: In(studies.map((s) => s.pcf_study_id)) } }, relations: ["study"] })
      : [];
    const byStudy = new Map(results.map((r) => [r.study.pcf_study_id, r]));
    res.json(studies.map((s) => studyJson(s, byStudy.get(s.pcf_study_id) ?? null, scope)));
  } catch (err) {
    console.error("listStudies", err);
    res.status(500).json({ message: "Could not load footprints" });
  }
};

type StudyFields = Partial<Pick<PcfStudy, "reference_start" | "reference_end" | "year_type" | "pcr_tag" | "allocation_key" | "notes">> & {
  cut_off_rule_pct?: string;
};

// Validates the editable study fields; returns [fields, error].
function readStudyFields(body: any, creating: boolean): [StudyFields, string | null] {
  const f: StudyFields = {};
  for (const k of ["reference_start", "reference_end"] as const) {
    if (body[k] !== undefined) {
      if (!isDate(body[k])) return [f, `${k} must be a date (YYYY-MM-DD)`];
      f[k] = body[k];
    } else if (creating) return [f, `${k} is required`];
  }
  if (f.reference_start && f.reference_end && f.reference_start > f.reference_end) {
    return [f, "reference_start must be on or before reference_end"];
  }
  if (body.year_type !== undefined) {
    if (body.year_type !== "CY" && body.year_type !== "FY") return [f, "year_type must be CY or FY"];
    f.year_type = body.year_type;
  }
  if (body.allocation_key !== undefined) {
    if (!KEYS.includes(body.allocation_key)) return [f, `allocation_key must be one of ${KEYS.join(", ")}`];
    f.allocation_key = body.allocation_key;
  }
  if (body.cut_off_rule_pct !== undefined) {
    const v = Number(body.cut_off_rule_pct);
    if (!Number.isFinite(v) || v < 0 || v > 5) return [f, "cut_off_rule_pct must be between 0 and 5"];
    f.cut_off_rule_pct = String(v);
  }
  for (const k of ["pcr_tag", "notes"] as const) {
    if (body[k] === undefined) continue;
    if (body[k] !== null && typeof body[k] !== "string") return [f, `${k} must be text`];
    f[k] = body[k] === null || !body[k].trim() ? null : body[k].trim();
  }
  return [f, null];
}

// POST /pcf/studies  { product_id, site_id?, reference_start, reference_end, ..., copy_from_id? }
export const createStudy = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const body = req.body ?? {};
    let parent: PcfStudy | null = null;
    if (body.copy_from_id !== undefined) {
      const pid = idParam(body.copy_from_id);
      parent = pid ? await loadStudy(pid, scope) : null;
      if (!parent) return res.status(404).json({ message: "Study to copy not found" });
    }
    if (parent && body.product_id !== undefined && idParam(body.product_id) !== parent.product.product_id) {
      return res.status(400).json({ message: "A new version is for the same product; start a new footprint for another product" });
    }
    const productId = idParam(body.product_id) ?? parent?.product.product_id ?? null;
    if (!productId) return res.status(400).json({ message: "product_id is required" });
    const product = await AppDataSource.getRepository(Product).findOne({
      where: { product_id: productId },
      relations: ["site", "site.company"],
    });
    if (!product || !canSeeSite(scope, product.site.site_id)) return res.status(404).json({ message: "Product not found" });

    const siteId = idParam(body.site_id) ?? parent?.site.site_id ?? product.site.site_id;
    const site = await AppDataSource.getRepository(Site).findOne({ where: { site_id: siteId }, relations: ["company"] });
    if (!site || !canSeeSite(scope, site.site_id)) return res.status(404).json({ message: "Site not found" });
    if (site.company?.company_id !== product.site.company?.company_id) {
      return res.status(400).json({ message: "The producing site must belong to the product's company" });
    }

    const base = parent
      ? { reference_start: parent.reference_start, reference_end: parent.reference_end, year_type: parent.year_type,
          pcr_tag: parent.pcr_tag, allocation_key: parent.allocation_key, cut_off_rule_pct: parent.cut_off_rule_pct, notes: parent.notes }
      : {};
    const [fields, error] = readStudyFields({ ...base, ...body }, true);
    if (error) return res.status(400).json({ message: error });
    const periodProblem = periodError(fields.reference_start!, fields.reference_end!, fields.year_type ?? "CY");
    if (periodProblem) return res.status(400).json({ message: periodProblem });
    if (parent && parent.company.company_id !== site.company?.company_id) {
      return res.status(400).json({ message: "A new version stays in the same company" });
    }

    const saved = await AppDataSource.transaction(async (m) => {
      // Versions count per product and site; the lock stops two copies taking the same number.
      await m.query("SELECT pg_advisory_xact_lock($1, $2)", [VERSION_LOCK, product.product_id]);
      const [{ max }] = await m.query("SELECT COALESCE(MAX(version), 0) AS max FROM pcf_study WHERE product_id = $1 AND site_id = $2", [
        product.product_id,
        site.site_id,
      ]);
      const study = m.create(PcfStudy, {
        ...fields,
        company: site.company,
        product,
        site,
        version: Number(max) + 1,
        parent_version: parent,
        status: "draft",
        created_by: { user_id: scope.userId } as User,
      });
      await m.save(study);
      if (parent) {
        const lines = await m.find(PcfInput, {
          where: { study: { pcf_study_id: parent.pcf_study_id } },
          relations: ["material_factor", "recycled_material_factor", "emission_factor"],
        });
        await m.save(lines.map(({ pcf_input_id, created_at, updated_at, ...rest }) => m.create(PcfInput, { ...rest, study })));
      }
      return study;
    });
    const study = await loadStudy(saved.pcf_study_id, scope);
    res.status(201).json(studyJson(study!, null, scope));
  } catch (err) {
    console.error("createStudy", err);
    res.status(500).json({ message: "Could not create the footprint" });
  }
};

// GET /pcf/studies/:id
export const getStudy = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const study = id ? await loadStudy(id, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    const [inputs, result] = await Promise.all([
      loadInputs(study.pcf_study_id),
      resultRepo().findOne({ where: { study: { pcf_study_id: study.pcf_study_id } } }),
    ]);
    res.json({ ...studyJson(study, result, scope), inputs: inputs.map(inputJson) });
  } catch (err) {
    console.error("getStudy", err);
    res.status(500).json({ message: "Could not load the footprint" });
  }
};

// PATCH /pcf/studies/:id (draft only)
export const updateStudy = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const study = id ? await loadStudy(id, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    if (study.status !== "draft") return res.status(409).json({ message: "Only a draft can be edited; create a new version instead" });
    const [fields, error] = readStudyFields(req.body ?? {}, false);
    if (error) return res.status(400).json({ message: error });
    const start = fields.reference_start ?? study.reference_start;
    const end = fields.reference_end ?? study.reference_end;
    if (start > end) return res.status(400).json({ message: "reference_start must be on or before reference_end" });
    const periodProblem = periodError(start, end, fields.year_type ?? study.year_type);
    if (periodProblem) return res.status(400).json({ message: periodProblem });
    // Conditional on draft, so a submit that lands meanwhile wins.
    const upd = await studyRepo().update({ pcf_study_id: study.pcf_study_id, status: "draft" }, fields);
    if (!upd.affected) return res.status(409).json({ message: "Only a draft can be edited; create a new version instead" });
    const fresh = await loadStudy(study.pcf_study_id, scope);
    res.json(studyJson(fresh!, undefined, scope));
  } catch (err) {
    console.error("updateStudy", err);
    res.status(500).json({ message: "Could not save the footprint" });
  }
};

// DELETE /pcf/studies/:id (draft only)
export const deleteStudy = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const study = id ? await loadStudy(id, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    if (study.status !== "draft") return res.status(409).json({ message: "Only a draft can be deleted" });
    const del = await studyRepo().delete({ pcf_study_id: study.pcf_study_id, status: "draft" });
    if (!del.affected) return res.status(409).json({ message: "Only a draft can be deleted" });
    res.status(204).end();
  } catch (err) {
    console.error("deleteStudy", err);
    res.status(500).json({ message: "Could not delete the footprint" });
  }
};

// ----------------------------------------------------------------- inputs ---

const factorVisibleTo = (f: MaterialFactor, companyId: number) => !f.company || f.company.company_id === companyId;

// PUT /pcf/studies/:id/inputs  { inputs: [...] } replaces every line (builder autosave).
export const replaceInputs = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const study = id ? await loadStudy(id, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    if (study.status !== "draft") return res.status(409).json({ message: "Only a draft can be edited; create a new version instead" });
    const lines = req.body?.inputs;
    if (!Array.isArray(lines)) return res.status(400).json({ message: "inputs must be a list" });
    if (lines.length > MAX_LINES) return res.status(400).json({ message: `At most ${MAX_LINES} lines` });

    const companyId = study.company.company_id;
    const mfIds = new Set<number>();
    const efIds = new Set<number>();
    for (const l of lines) {
      for (const k of ["material_factor_id", "recycled_material_factor_id"]) if (idParam(l?.[k])) mfIds.add(idParam(l[k])!);
      if (idParam(l?.emission_factor_id)) efIds.add(idParam(l.emission_factor_id)!);
    }
    const mfs = mfIds.size
      ? await factorRepo().find({ where: { material_factor_id: In([...mfIds]) }, relations: ["company"] })
      : [];
    const efs = efIds.size
      ? await AppDataSource.getRepository(EmissionFactor).find({ where: { emission_factor_id: In([...efIds]) }, relations: ["site", "site.company"] })
      : [];
    const mfById = new Map(mfs.map((f) => [f.material_factor_id, f]));
    const efById = new Map(efs.map((f) => [f.emission_factor_id, f]));

    const errors: { index: number; message: string }[] = [];
    const rows: Partial<PcfInput>[] = [];
    lines.forEach((l: any, index: number) => {
      const fail = (message: string) => errors.push({ index, message });
      if (!l || typeof l !== "object") return fail("Each line must be an object");
      if (!STAGES.includes(l.stage)) return fail(`stage must be one of ${STAGES.join(", ")}`);
      if (typeof l.name !== "string" || !l.name.trim()) return fail("name is required");
      if (typeof l.unit !== "string" || !l.unit.trim()) return fail("unit is required");
      const n: Record<string, number | null> = {};
      for (const k of ["quantity", "recycled_share_pct", "supplier_pcf_kgco2e", "payload_t", "distance_km", "ai_confidence"]) {
        n[k] = num(l[k]);
        if (n[k] !== null && (!isNum(n[k]) || n[k]! < 0)) return fail(`${k} must be a number of 0 or more`);
      }
      if ((n.recycled_share_pct ?? 0) > 100) return fail("recycled_share_pct must be 0–100");
      if (n.ai_confidence !== null && n.ai_confidence > 1) return fail("ai_confidence must be 0–1");
      const dqr: Record<string, number> = {};
      for (const k of ["dqr_technology", "dqr_geography", "dqr_time"]) {
        dqr[k] = l[k] === undefined ? 3 : Number(l[k]);
        if (![1, 2, 3].includes(dqr[k])) return fail(`${k} must be 1, 2 or 3`);
      }
      const dataType = l.data_type ?? "secondary";
      if (dataType !== "primary" && dataType !== "secondary") return fail("data_type must be primary or secondary");

      const mf = idParam(l.material_factor_id) ? mfById.get(idParam(l.material_factor_id)!) : undefined;
      const rf = idParam(l.recycled_material_factor_id) ? mfById.get(idParam(l.recycled_material_factor_id)!) : undefined;
      const ef = idParam(l.emission_factor_id) ? efById.get(idParam(l.emission_factor_id)!) : undefined;
      if (l.material_factor_id != null && (!mf || !factorVisibleTo(mf, companyId))) return fail("material factor not found");
      if (l.recycled_material_factor_id != null && (!rf || !factorVisibleTo(rf, companyId))) return fail("recycled factor not found");
      if (l.emission_factor_id != null && (!ef || ef.site?.company?.company_id !== companyId)) return fail("transport factor not found");

      if (l.stage !== "A2" && n.quantity === null) return fail("quantity is required");
      if (l.stage === "A2") {
        if (n.payload_t === null || n.distance_km === null) return fail("a transport leg needs payload_t and distance_km");
        const unit = (ef?.denominator_unit ?? mf?.unit ?? "").trim().toLowerCase();
        if (!ef && !mf) return fail("a transport leg needs a tonne.km factor");
        if (unit !== "tonne.km") return fail("the transport factor must be per tonne.km");
      } else {
        if (!mf && n.supplier_pcf_kgco2e === null) return fail("pick a factor or enter the supplier's footprint");
        if ((n.recycled_share_pct ?? 0) > 0 && n.supplier_pcf_kgco2e === null && !rf) {
          return fail("a recycled share needs a recycled factor");
        }
      }
      const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
      rows.push({
        stage: l.stage,
        name: l.name.trim(),
        sort_order: index,
        material_factor: mf ?? null,
        recycled_material_factor: rf ?? null,
        emission_factor: ef ?? null,
        supplier_pcf_kgco2e: n.supplier_pcf_kgco2e === null ? null : String(n.supplier_pcf_kgco2e),
        quantity: String(n.quantity ?? 0),
        unit: l.unit.trim(),
        recycled_share_pct: String(n.recycled_share_pct ?? 0),
        origin_country: str(l.origin_country),
        supplier_name: str(l.supplier_name),
        transport_mode: str(l.transport_mode),
        distance_km: n.distance_km === null ? null : String(n.distance_km),
        payload_t: n.payload_t === null ? null : String(n.payload_t),
        data_type: dataType,
        dqr_technology: dqr.dqr_technology,
        dqr_geography: dqr.dqr_geography,
        dqr_time: dqr.dqr_time,
        ai_suggested: l.ai_suggested === true,
        ai_confidence: n.ai_confidence === null ? null : String(n.ai_confidence),
      });
    });
    if (errors.length) return res.status(400).json({ message: "Some lines are not valid", errors });

    const replaced = await AppDataSource.transaction(async (m) => {
      const locked = await m
        .createQueryBuilder(PcfStudy, "s")
        .setLock("pessimistic_write")
        .where("s.pcf_study_id = :id", { id: study.pcf_study_id })
        .getOne();
      if (locked?.status !== "draft") return false;
      await m.delete(PcfInput, { study: { pcf_study_id: study.pcf_study_id } });
      if (rows.length) await m.save(rows.map((r) => m.create(PcfInput, { ...r, study })));
      await m.update(PcfStudy, { pcf_study_id: study.pcf_study_id }, { updated_at: new Date() });
      return true;
    });
    if (!replaced) return res.status(409).json({ message: "Only a draft can be edited; create a new version instead" });
    const saved = await loadInputs(study.pcf_study_id);
    res.json({ inputs: saved.map(inputJson) });
  } catch (err) {
    console.error("replaceInputs", err);
    res.status(500).json({ message: "Could not save the lines" });
  }
};

// -------------------------------------------------------- material factors ---

// Licensed (ecoinvent) values are never shown to clients, only to superadmins.
function factorJson(f: MaterialFactor, scope: PcfScope, usage?: FactorUsage) {
  const hidden = f.licence === "ecoinvent" && !scope.all;
  return {
    material_factor_id: f.material_factor_id,
    company_id: f.company?.company_id ?? null,
    name: f.name,
    material_group: f.material_group,
    geography: f.geography,
    unit: f.unit,
    value_kgco2e: hidden ? null : Number(f.value_kgco2e),
    value_hidden: hidden,
    gwp_set: f.gwp_set,
    source: f.source,
    source_year: f.source_year,
    dataset_ref: f.dataset_ref,
    licence: f.licence,
    recycled_variant: f.recycled_variant,
    valid_from: f.valid_from,
    valid_to: f.valid_to,
    used_by: usage?.used_by ?? 0,
    used_by_approved: usage?.used_by_approved ?? 0,
  };
}

// C04 "Used by": footprints (studies) with a line on the factor, as virgin or
// recycled factor. Counted only over studies the caller can see, so a global
// factor never reveals other companies' footprints. Approved counts approved
// and published ones, which keep their snapshot when the factor changes.
interface FactorUsage {
  used_by: number;
  used_by_approved: number;
}

const USES_SQL = `
  SELECT u.factor_id, s.pcf_study_id, s.status, s.version, s.site_id, p.product_id, p.name AS product_name
    FROM (SELECT material_factor_id AS factor_id, pcf_study_id FROM pcf_input WHERE material_factor_id IS NOT NULL
          UNION
          SELECT recycled_material_factor_id, pcf_study_id FROM pcf_input WHERE recycled_material_factor_id IS NOT NULL) u
    JOIN pcf_study s ON s.pcf_study_id = u.pcf_study_id
    JOIN product p ON p.product_id = s.product_id
   WHERE u.factor_id = ANY($1::int[]) AND ($2::int[] IS NULL OR s.site_id = ANY($2::int[]))`;

interface FactorUse {
  factor_id: number;
  pcf_study_id: number;
  status: PcfStudyStatus;
  version: number;
  site_id: number;
  product_id: number;
  product_name: string;
}

async function factorUses(ids: number[], scope: PcfScope): Promise<FactorUse[]> {
  if (!ids.length) return [];
  return AppDataSource.query(USES_SQL + " ORDER BY p.name, s.version DESC", [ids, scope.all ? null : scope.siteIds]);
}

function usageById(uses: FactorUse[]): Map<number, FactorUsage> {
  const out = new Map<number, FactorUsage>();
  for (const u of uses) {
    const n = out.get(u.factor_id) ?? { used_by: 0, used_by_approved: 0 };
    n.used_by += 1;
    if (u.status === "approved" || u.status === "published") n.used_by_approved += 1;
    out.set(u.factor_id, n);
  }
  return out;
}

// One factor per name × geography × source year × company (C04). Names and
// geographies compare trimmed and case-insensitively; empty geography or year
// match each other. Run inside the transaction holding FACTOR_LOCK.
const FACTOR_LOCK = 7103;
type FactorKey = { name: string; geography: string | null; source_year: number | null; companyId: number | null };
const keyOf = (k: FactorKey) =>
  [k.name.trim().toLowerCase(), (k.geography ?? "").trim().toLowerCase(), k.source_year ?? "", k.companyId ?? ""].join("|");

async function findDuplicate(m: EntityManager, k: FactorKey, excludeId: number | null): Promise<number | null> {
  const rows: { material_factor_id: number }[] = await m.query(
    `SELECT material_factor_id FROM material_factor
      WHERE lower(trim(name)) = lower(trim($1))
        AND lower(trim(coalesce(geography, ''))) = lower(trim(coalesce($2::varchar, '')))
        AND source_year IS NOT DISTINCT FROM $3::int
        AND company_id IS NOT DISTINCT FROM $4::int
        AND material_factor_id <> $5
      ORDER BY material_factor_id LIMIT 1`,
    [k.name, k.geography, k.source_year, k.companyId, excludeId ?? 0],
  );
  return rows[0]?.material_factor_id ?? null;
}

const DUPLICATE = "A factor with this name, geography and year already exists";
class DuplicateFactor extends Error {
  constructor(public existingId: number) {
    super(DUPLICATE);
  }
}

// GET /pcf/material-factors?group=&q=&companyId=
export const listMaterialFactors = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const qb = factorRepo().createQueryBuilder("f").leftJoinAndSelect("f.company", "company").orderBy("f.material_group").addOrderBy("f.name");
    if (!scope.all) {
      if (scope.companyIds.length) qb.where("(company.company_id IS NULL OR company.company_id IN (:...cs))", { cs: scope.companyIds });
      else qb.where("company.company_id IS NULL");
    } else if (req.query.companyId !== undefined) {
      const c = idParam(req.query.companyId);
      if (!c) return res.status(400).json({ message: "companyId must be an id" });
      qb.where("(company.company_id IS NULL OR company.company_id = :c)", { c });
    }
    if (typeof req.query.group === "string" && req.query.group) qb.andWhere("f.material_group = :g", { g: req.query.group });
    if (typeof req.query.q === "string" && req.query.q.trim()) qb.andWhere("f.name ILIKE :q", { q: `%${req.query.q.trim()}%` });
    const factors = await qb.getMany();
    const usage = usageById(await factorUses(factors.map((f) => f.material_factor_id), scope));
    res.json(factors.map((f) => factorJson(f, scope, usage.get(f.material_factor_id))));
  } catch (err) {
    console.error("listMaterialFactors", err);
    res.status(500).json({ message: "Could not load material factors" });
  }
};

function readFactor(body: any, partial: boolean): [Partial<MaterialFactor>, string | null] {
  const f: Partial<MaterialFactor> = {};
  const req = (k: string) => !partial && (body[k] === undefined || body[k] === null || body[k] === "");
  for (const k of ["name", "material_group", "unit"] as const) {
    if (req(k)) return [f, `${k} is required`];
    if (body[k] !== undefined) {
      if (typeof body[k] !== "string" || !body[k].trim()) return [f, `${k} must be non-empty text`];
      f[k] = body[k].trim();
    }
  }
  if (req("value_kgco2e")) return [f, "value_kgco2e is required"];
  if (body.value_kgco2e !== undefined) {
    const v = Number(body.value_kgco2e);
    if (!Number.isFinite(v) || v < 0) return [f, "value_kgco2e must be a number of 0 or more"];
    f.value_kgco2e = String(v);
  }
  if (body.gwp_set !== undefined) {
    if (body.gwp_set !== "AR6" && body.gwp_set !== "AR5") return [f, "gwp_set must be AR6 or AR5"];
    f.gwp_set = body.gwp_set;
  }
  if (body.licence !== undefined) {
    if (!["open", "ecoinvent", "supplier"].includes(body.licence)) return [f, "licence must be open, ecoinvent or supplier"];
    f.licence = body.licence;
  }
  for (const k of ["geography", "source", "dataset_ref"] as const) {
    if (body[k] !== undefined) f[k] = body[k] === null || String(body[k]).trim() === "" ? null : String(body[k]).trim();
  }
  if (body.source_year !== undefined) {
    const y = body.source_year === null ? null : Number(body.source_year);
    if (y !== null && !Number.isInteger(y)) return [f, "source_year must be a year"];
    f.source_year = y;
  }
  for (const k of ["valid_from", "valid_to"] as const) {
    if (body[k] !== undefined) {
      if (body[k] !== null && !isDate(body[k])) return [f, `${k} must be a date (YYYY-MM-DD)`];
      f[k] = body[k];
    }
  }
  if (body.recycled_variant !== undefined) f.recycled_variant = body.recycled_variant === true;
  return [f, null];
}

// POST /pcf/material-factors  (company_id: null = global, superadmin only)
// Which company a new factor belongs to: superadmins pick one (null = global),
// managers add to their own. Returns [companyId, status, message] on refusal.
async function targetCompany(scope: PcfScope, raw: unknown): Promise<[number | null, number?, string?]> {
  if (scope.all) {
    const companyId = raw == null ? null : idParam(raw);
    if (raw != null && companyId === null) return [null, 400, "company_id must be an id, or null for the global library"];
    if (companyId !== null && !(await AppDataSource.getRepository(Company).exist({ where: { company_id: companyId } }))) {
      return [null, 404, "Company not found"];
    }
    return [companyId];
  }
  const companyId = idParam(raw) ?? (scope.companyIds.length === 1 ? scope.companyIds[0] : null);
  if (companyId === null || !scope.companyIds.includes(companyId)) return [null, 403, "Managers add factors to their own company"];
  return [companyId];
}

const LICENSED_ADD = "Only a superadmin can add licensed (ecoinvent) factors";

export const createMaterialFactor = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const body = req.body ?? {};
    const [companyId, status, message] = await targetCompany(scope, body.company_id);
    if (status) return res.status(status).json({ message });
    const [fields, error] = readFactor(body, false);
    if (error) return res.status(400).json({ message: error });
    if (!scope.all && fields.licence === "ecoinvent") return res.status(403).json({ message: LICENSED_ADD });
    const saved = await AppDataSource.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock($1, 0)", [FACTOR_LOCK]);
      const dup = await findDuplicate(m, { name: fields.name!, geography: fields.geography ?? null, source_year: fields.source_year ?? null, companyId }, null);
      if (dup) throw new DuplicateFactor(dup);
      return m.save(m.create(MaterialFactor, { ...fields, company: companyId === null ? null : ({ company_id: companyId } as any) }));
    });
    const fresh = await factorRepo().findOne({ where: { material_factor_id: saved.material_factor_id }, relations: ["company"] });
    res.status(201).json(factorJson(fresh!, scope));
  } catch (err) {
    if (err instanceof DuplicateFactor) return res.status(409).json({ message: DUPLICATE, existing_id: err.existingId });
    console.error("createMaterialFactor", err);
    res.status(500).json({ message: "Could not add the factor" });
  }
};

const MAX_IMPORT = 1000;

// POST /pcf/material-factors/import  { company_id?, rows: [...] }
// Every row is checked first (same rules as one factor, plus duplicates within
// the sheet and against the library); then all rows are saved, or none.
export const importMaterialFactors = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const body = req.body ?? {};
    const [companyId, status, message] = await targetCompany(scope, body.company_id);
    if (status) return res.status(status).json({ message });
    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: "rows must be a non-empty list" });
    if (rows.length > MAX_IMPORT) return res.status(400).json({ message: `At most ${MAX_IMPORT} rows per import` });

    const errors: { index: number; message: string; existing_id?: number; duplicate_of_row?: number }[] = [];
    const parsed: Partial<MaterialFactor>[] = [];
    const seen = new Map<string, number>();
    rows.forEach((row: unknown, index: number) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return errors.push({ index, message: "Each row must be an object" });
      const [fields, error] = readFactor(row, false);
      if (error) return errors.push({ index, message: error });
      if (!scope.all && fields.licence === "ecoinvent") return errors.push({ index, message: LICENSED_ADD });
      const key = keyOf({ name: fields.name!, geography: fields.geography ?? null, source_year: fields.source_year ?? null, companyId });
      if (seen.has(key)) return errors.push({ index, message: "Repeats an earlier row in this sheet", duplicate_of_row: seen.get(key) });
      seen.set(key, index);
      parsed[index] = fields;
    });
    if (errors.length) return res.status(400).json({ message: "Some rows are not valid; nothing was imported", errors });

    const saved = await AppDataSource.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock($1, 0)", [FACTOR_LOCK]);
      for (let index = 0; index < parsed.length; index++) {
        const f = parsed[index];
        const dup = await findDuplicate(m, { name: f.name!, geography: f.geography ?? null, source_year: f.source_year ?? null, companyId }, null);
        if (dup) errors.push({ index, message: DUPLICATE, existing_id: dup });
      }
      if (errors.length) return null;
      const company = companyId === null ? null : ({ company_id: companyId } as any);
      return m.save(parsed.map((f) => m.create(MaterialFactor, { ...f, company })));
    });
    if (!saved) return res.status(409).json({ message: "Some rows are already in the library; nothing was imported", errors });
    const fresh = await factorRepo().find({
      where: { material_factor_id: In(saved.map((f) => f.material_factor_id)) },
      relations: ["company"],
      order: { material_factor_id: "ASC" },
    });
    res.status(201).json({ created: fresh.length, factors: fresh.map((f) => factorJson(f, scope)) });
  } catch (err) {
    console.error("importMaterialFactors", err);
    res.status(500).json({ message: "Could not import the factors" });
  }
};

// GET /pcf/material-factors/:id  the factor and the footprints that use it.
export const getMaterialFactor = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const id = idParam(req.params.id);
    const f = id ? await factorRepo().findOne({ where: { material_factor_id: id }, relations: ["company"] }) : null;
    if (!f || !canSeeCompany(scope, f.company?.company_id ?? null)) return res.status(404).json({ message: "Factor not found" });
    const uses = await factorUses([f.material_factor_id], scope);
    res.json({
      ...factorJson(f, scope, usageById(uses).get(f.material_factor_id)),
      used_in: uses.map((u) => ({
        pcf_study_id: u.pcf_study_id,
        product: { product_id: u.product_id, name: u.product_name },
        version: u.version,
        status: u.status,
        site_id: u.site_id,
      })),
    });
  } catch (err) {
    console.error("getMaterialFactor", err);
    res.status(500).json({ message: "Could not load the factor" });
  }
};

async function editableFactor(req: AuthRequest, res: Response, scope: PcfScope) {
  const id = idParam(req.params.id);
  const f = id ? await factorRepo().findOne({ where: { material_factor_id: id }, relations: ["company"] }) : null;
  const companyId = f?.company?.company_id ?? null;
  if (!f || !canSeeCompany(scope, companyId)) {
    res.status(404).json({ message: "Factor not found" });
    return null;
  }
  if (!scope.all && companyId === null) {
    res.status(403).json({ message: "Only a superadmin can change the global library" });
    return null;
  }
  // Licensed values are hidden from managers, so only a superadmin may touch those rows.
  if (!scope.all && f.licence === "ecoinvent") {
    res.status(403).json({ message: "Only a superadmin can change licensed (ecoinvent) factors" });
    return null;
  }
  return f;
}

// PATCH /pcf/material-factors/:id
export const updateMaterialFactor = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const f = await editableFactor(req, res, scope);
    if (!f) return;
    const [fields, error] = readFactor(req.body ?? {}, true);
    if (error) return res.status(400).json({ message: error });
    if (!scope.all && fields.licence === "ecoinvent") {
      return res.status(403).json({ message: "Only a superadmin can mark a factor as licensed (ecoinvent)" });
    }
    await AppDataSource.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock($1, 0)", [FACTOR_LOCK]);
      if (fields.name !== undefined || fields.geography !== undefined || fields.source_year !== undefined) {
        const key = {
          name: fields.name ?? f.name,
          geography: fields.geography !== undefined ? fields.geography : f.geography,
          source_year: fields.source_year !== undefined ? fields.source_year : f.source_year,
          companyId: f.company?.company_id ?? null,
        };
        const dup = await findDuplicate(m, key, f.material_factor_id);
        if (dup) throw new DuplicateFactor(dup);
      }
      await m.update(MaterialFactor, { material_factor_id: f.material_factor_id }, fields);
    });
    const fresh = await factorRepo().findOne({ where: { material_factor_id: f.material_factor_id }, relations: ["company"] });
    const usage = usageById(await factorUses([f.material_factor_id], scope));
    res.json(factorJson(fresh!, scope, usage.get(f.material_factor_id)));
  } catch (err) {
    if (err instanceof DuplicateFactor) return res.status(409).json({ message: DUPLICATE, existing_id: err.existingId });
    console.error("updateMaterialFactor", err);
    res.status(500).json({ message: "Could not save the factor" });
  }
};

// DELETE /pcf/material-factors/:id  (refused while a study line uses it)
export const deleteMaterialFactor = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const f = await editableFactor(req, res, scope);
    if (!f) return;
    const used = await inputRepo().count({
      where: [
        { material_factor: { material_factor_id: f.material_factor_id } },
        { recycled_material_factor: { material_factor_id: f.material_factor_id } },
      ],
    });
    if (used) return res.status(409).json({ message: `Used by ${used} footprint line(s); replace it there first` });
    await factorRepo().delete({ material_factor_id: f.material_factor_id });
    res.status(204).end();
  } catch (err) {
    console.error("deleteMaterialFactor", err);
    res.status(500).json({ message: "Could not delete the factor" });
  }
};

