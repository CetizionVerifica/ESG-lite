// PCF calculation, review flow and reconciliation (E1, part 4).
// Spec: docs/pcf/foundation/E1-data-and-engine/CLAUDE.md ("API").
// Status flow: draft → in_review → approved → published; reject sends a study
// back to draft; publishing supersedes the product's earlier published study
// at the same site. Approve needs someone other than the creator.
// A PCF result is a product footprint only; it is never reused as a CBAM figure.
import { Response } from "express";
import { EntityManager, In, Not } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "../middlewares/auth.middleware";
import { PcfStudy, PcfStudyStatus } from "../entities/PcfStudy";
import { PcfInput } from "../entities/PcfInput";
import { PcfResult } from "../entities/PcfResult";
import { PcfAllocation } from "../entities/PcfAllocation";
import { AuditLog } from "../entities/AuditLog";
import { Site } from "../entities/Site";
import { User } from "../entities/User";
import { canSeeSite, pcfScope } from "../pcf/access";
import { allocatedRows, KeyOverride, loadPlantData, PlantData } from "../pcf/plantData";
import {
  computePcf,
  EngineFactor,
  EngineInput,
  canonicalJson,
  makeSnapshot,
  PcfEngineInput,
  PcfInputError,
} from "../pcf/engine/computePcf";
import { loadInputs, loadStudy, studyJson } from "./pcf.controller";
import { licensedLineIds, redactLines, redactStages } from "../pcf/redact";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUT_OFF_MAX_TOTAL_PCT = 5; // spec: omitted items together stay below 5%
const AI_CONFIRM_BELOW = 0.6;
const PUBLISH_LOCK = 7101; // advisory lock namespace for publishing // C02: AI lines under 60% must be confirmed before calculating

const resultRepo = () => AppDataSource.getRepository(PcfResult);

const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const optNum = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

function readKeyOverride(src: any): [KeyOverride, string | null] {
  const o: KeyOverride = { key_value_product: optNum(src?.key_value_product), key_value_site_total: optNum(src?.key_value_site_total) };
  for (const k of ["key_value_product", "key_value_site_total"] as const) {
    if (o[k] !== null && !Number.isFinite(o[k]!)) return [o, `${k} must be a number`];
  }
  return [o, null];
}

async function studyFor(req: AuthRequest, res: Response) {
  const scope = await pcfScope(req);
  const id = idParam(req.params.id);
  const study = id ? await loadStudy(id, scope) : null;
  if (!study) {
    res.status(404).json({ message: "Footprint not found" });
    return null;
  }
  return { scope, study };
}

function previewJson(data: PlantData) {
  const rows = allocatedRows(data);
  const a3 = rows.reduce((s, r) => s + (r.allocated_kg_per_unit ?? 0), 0);
  return {
    allocation_key: data.allocation_key,
    reference_start: data.reference_start,
    reference_end: data.reference_end,
    sources: rows,
    key_value_product: data.allocation?.key_value_product ?? null,
    key_value_site_total: data.allocation?.key_value_site_total ?? null,
    share_pct: data.allocation ? (data.allocation.key_value_product / data.allocation.key_value_site_total) * 100 : null,
    product_output_units: data.product_output_units,
    product_production_t: data.product_production_t,
    a3_energy_kg_per_unit: data.allocation ? a3 : null,
    plant_s1_s2_tco2e: data.sources.reduce((s, r) => s + r.period_total_tco2e, 0),
    production_ids_used: data.production_ids_used,
    excluded: data.excluded,
    blockers: data.blockers,
    warnings: data.warnings,
  };
}

// GET /pcf/studies/:id/allocation-preview?key_value_product=&key_value_site_total=
export const allocationPreview = async (req: AuthRequest, res: Response) => {
  try {
    const found = await studyFor(req, res);
    if (!found) return;
    const [override, error] = readKeyOverride(req.query);
    if (error) return res.status(400).json({ message: error });
    res.json(previewJson(await loadPlantData(found.study, override)));
  } catch (err) {
    console.error("allocationPreview", err);
    res.status(500).json({ message: "Could not load plant data" });
  }
};

// Engine input from the study's stored lines and the plant data.
export function buildEngineInput(study: PcfStudy, inputs: PcfInput[], plant: PlantData): PcfEngineInput {
  const factors = new Map<string, EngineFactor>();
  const lines: EngineInput[] = inputs.map((i) => {
    let factorId: string | null = null;
    if (i.stage === "A2" && i.emission_factor) {
      const ef = i.emission_factor;
      factorId = `ef-${ef.emission_factor_id}`;
      factors.set(factorId, { id: factorId, name: ef.emission_category_name ?? ef.global_category_name ?? `factor ${ef.emission_factor_id}`, unit: ef.denominator_unit ?? "", value_kgco2e: Number(ef.factor_value), source: ef.source ?? null, licence: "open", gwp_set: null });
    } else if (i.material_factor) {
      const mf = i.material_factor;
      factorId = `mf-${mf.material_factor_id}`;
      factors.set(factorId, { id: factorId, name: mf.name, unit: mf.unit, value_kgco2e: Number(mf.value_kgco2e), source: mf.source, licence: mf.licence, gwp_set: mf.gwp_set });
    }
    let recycledId: string | null = null;
    if (i.recycled_material_factor) {
      const rf = i.recycled_material_factor;
      recycledId = `mf-${rf.material_factor_id}`;
      factors.set(recycledId, { id: recycledId, name: rf.name, unit: rf.unit, value_kgco2e: Number(rf.value_kgco2e), source: rf.source, licence: rf.licence, gwp_set: rf.gwp_set });
    }
    return {
      id: `in-${i.pcf_input_id}`,
      stage: i.stage,
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      factor_id: factorId,
      recycled_factor_id: recycledId,
      recycled_share_pct: Number(i.recycled_share_pct),
      supplier_pcf_kgco2e: i.supplier_pcf_kgco2e == null ? null : Number(i.supplier_pcf_kgco2e),
      payload_t: i.payload_t == null ? null : Number(i.payload_t),
      distance_km: i.distance_km == null ? null : Number(i.distance_km),
      data_type: i.data_type,
      dqr: { technology: i.dqr_technology, geography: i.dqr_geography, time: i.dqr_time },
    };
  });
  return {
    study: { cut_off_rule_pct: Number(study.cut_off_rule_pct), cut_off_max_total_pct: CUT_OFF_MAX_TOTAL_PCT },
    factors: [...factors.values()].sort((a, b) => a.id.localeCompare(b.id)),
    inputs: lines,
    energy: plant.allocation
      ? plant.sources.map(({ emission_ids, ...s }) => s)
      : [],
    allocation: plant.allocation,
  };
}

const audit = (m: EntityManager, study: PcfStudy, userId: number, action: string, changed: Record<string, { old: any; new: any }>, reason: string | null = null) =>
  m.save(
    m.create(AuditLog, {
      entity_type: "pcf_study",
      entity_id: study.pcf_study_id,
      action,
      changed_fields: changed,
      reason,
      changed_by: { user_id: userId } as User,
    }),
  );

// POST /pcf/studies/:id/calculate  { key_value_product?, key_value_site_total? }
export const calculateStudy = async (req: AuthRequest, res: Response) => {
  try {
    const found = await studyFor(req, res);
    if (!found) return;
    const { scope, study } = found;
    if (study.status !== "draft") return res.status(409).json({ message: "Only a draft can be calculated; create a new version instead" });
    const [override, error] = readKeyOverride(req.body);
    if (error) return res.status(400).json({ message: error });

    const inputs = await loadInputs(study.pcf_study_id);
    if (!inputs.length) return res.status(400).json({ message: "Add at least one input line first" });
    const unconfirmed = inputs.filter((i) => i.ai_suggested && (i.ai_confidence == null || Number(i.ai_confidence) < AI_CONFIRM_BELOW));
    if (unconfirmed.length) {
      return res.status(400).json({
        message: `Confirm the ${unconfirmed.length} AI-suggested line(s) with confidence under ${AI_CONFIRM_BELOW * 100}% (or none given) first`,
        input_ids: unconfirmed.map((i) => i.pcf_input_id),
      });
    }
    const plant = await loadPlantData(study, override);
    if (plant.blockers.length) return res.status(400).json({ message: plant.blockers[0], blockers: plant.blockers });

    const engineInput = buildEngineInput(study, inputs, plant);
    let r;
    try {
      r = computePcf(engineInput);
    } catch (e) {
      if (e instanceof PcfInputError) return res.status(400).json({ message: e.message });
      throw e;
    }
    const rows = allocatedRows(plant);

    const written = await AppDataSource.transaction(async (m) => {
      // Re-check under a row lock: a submit or approve that landed meanwhile wins.
      const locked = await m
        .createQueryBuilder(PcfStudy, "s")
        .setLock("pessimistic_write")
        .where("s.pcf_study_id = :id", { id: study.pcf_study_id })
        .getOne();
      if (locked?.status !== "draft") return false;
      const existing = await m.findOne(PcfResult, { where: { study: { pcf_study_id: study.pcf_study_id } } });
      await m.save(
        m.create(PcfResult, {
          pcf_result_id: existing?.pcf_result_id,
          study,
          total_kg_per_unit: String(r.total_kg_per_unit),
          by_stage: r.by_stage,
          by_input: r.by_input,
          biogenic_kg_per_unit: String(r.biogenic_kg_per_unit),
          aircraft_kg_per_unit: String(r.aircraft_kg_per_unit),
          luc_kg_per_unit: String(r.luc_kg_per_unit),
          primary_data_share_pct: String(r.primary_data_share_pct),
          dqr_overall: String(r.dqr.overall),
          cut_off: { ...r.cut_off, dqr: r.dqr, lines: r.lines, allocation: r.allocation },
          factor_snapshot: makeSnapshot(engineInput) as unknown as Record<string, unknown>,
          emission_ids_used: plant.allocation ? plant.emission_ids_used : [],
          production_ids_used: plant.allocation ? plant.production_ids_used : [],
          is_draft: true,
          engine_version: r.engine_version,
          calculated_by: { user_id: scope.userId } as User,
          calculated_at: new Date(),
        }),
      );
      await m.delete(PcfAllocation, { study: { pcf_study_id: study.pcf_study_id } });
      if (plant.allocation) {
        await m.save(
          rows.map((row) =>
            m.create(PcfAllocation, {
              study,
              category: row.category_id ? ({ category_id: row.category_id } as any) : null,
              category_name: row.category_name,
              scope: row.scope,
              period_total_tco2e: String(row.period_total_tco2e),
              key_value_product: String(plant.allocation!.key_value_product),
              key_value_site_total: String(plant.allocation!.key_value_site_total),
              share_pct: String(row.share_pct),
              allocated_kg_per_unit: String(row.allocated_kg_per_unit),
            }),
          ),
        );
      }
      await audit(m, study, scope.userId, "calculate", { total_kg_per_unit: { old: existing ? Number(existing.total_kg_per_unit) : null, new: r.total_kg_per_unit } });
      return true;
    });
    if (!written) return res.status(409).json({ message: "The footprint left draft meanwhile; reload it" });

    const hidden = scope.all ? new Set<string>() : licensedLineIds(engineInput);
    const redacted = redactStages(r.by_stage, r.lines, hidden);
    res.json({
      result: {
        total_kg_per_unit: r.total_kg_per_unit,
        fossil_kg_per_unit: r.fossil_kg_per_unit,
        biogenic_kg_per_unit: r.biogenic_kg_per_unit,
        aircraft_kg_per_unit: r.aircraft_kg_per_unit,
        luc_kg_per_unit: r.luc_kg_per_unit,
        by_stage: redacted.by_stage,
        hidden_stages: redacted.hidden_stages,
        lines: redactLines(r.lines, hidden).map((l) => ({ ...l, pcf_input_id: l.id.startsWith("in-") ? Number(l.id.slice(3)) : null })),
        allocation: r.allocation,
        cut_off: r.cut_off,
        primary_data_share_pct: r.primary_data_share_pct,
        dqr: r.dqr,
        engine_version: r.engine_version,
        is_draft: true,
      },
      warnings: plant.warnings,
      excluded: plant.excluded,
    });
  } catch (err) {
    console.error("calculateStudy", err);
    res.status(500).json({ message: "Could not calculate the footprint" });
  }
};

async function move(
  req: AuthRequest,
  res: Response,
  from: PcfStudyStatus,
  to: PcfStudyStatus,
  check?: (study: PcfStudy, result: PcfResult | null, userId: number) => string | [number, string] | null,
  apply?: (m: EntityManager, study: PcfStudy, userId: number) => Promise<void>,
  opts: { where?: string; lock?: (m: EntityManager, study: PcfStudy) => Promise<unknown> } = {},
) {
  const found = await studyFor(req, res);
  if (!found) return;
  const { scope, study } = found;
  if (study.status !== from) return res.status(409).json({ message: `The footprint is ${study.status.replace("_", " ")}, not ${from.replace("_", " ")}` });
  const result = await resultRepo().findOne({ where: { study: { pcf_study_id: study.pcf_study_id } }, relations: ["calculated_by"] });
  const problem = check?.(study, result, scope.userId);
  if (problem) {
    const [status, message] = Array.isArray(problem) ? problem : [409, problem];
    return res.status(status).json({ message });
  }
  // Conditional update: a second click or a concurrent reviewer can't move it twice.
  const moved = await AppDataSource.transaction(async (m) => {
    await opts.lock?.(m, study);
    const upd = await m
      .createQueryBuilder()
      .update(PcfStudy)
      .set({ status: to })
      .where(`pcf_study_id = :id AND status = :from${opts.where ? ` AND ${opts.where}` : ""}`, { id: study.pcf_study_id, from })
      .execute();
    if (!upd.affected) return false;
    await apply?.(m, study, scope.userId);
    await audit(m, study, scope.userId, ACTION[to] ?? to, { status: { old: from, new: to } }, req.body?.comment ?? null);
    return true;
  });
  if (!moved) return res.status(409).json({ message: "The footprint changed meanwhile; reload it" });
  const fresh = await loadStudy(study.pcf_study_id, scope);
  const freshResult = await resultRepo().findOne({ where: { study: { pcf_study_id: study.pcf_study_id } } });
  res.json(studyJson(fresh!, freshResult, scope));
}

const ACTION: Partial<Record<PcfStudyStatus, string>> = { in_review: "submit", draft: "reject", approved: "approve", published: "publish" };
const comment = (req: AuthRequest) => (typeof req.body?.comment === "string" ? req.body.comment.trim() : "");

// Whether the stored result still matches today's lines, factors and plant data.
async function resultIsCurrent(study: PcfStudy, result: PcfResult): Promise<boolean> {
  const stored = result.factor_snapshot as unknown as { input?: PcfEngineInput };
  const a = stored.input?.allocation;
  const plant = await loadPlantData(study, a ? { key_value_product: a.key_value_product, key_value_site_total: a.key_value_site_total } : {});
  if (plant.blockers.length) return false;
  const now = makeSnapshot(buildEngineInput(study, await loadInputs(study.pcf_study_id), plant));
  return canonicalJson(now) === canonicalJson(result.factor_snapshot);
}

// POST /pcf/studies/:id/submit
export const submitStudy = async (req: AuthRequest, res: Response) => {
  try {
    const found = await studyFor(req, res);
    if (!found) return;
    const result = await resultRepo().findOne({ where: { study: { pcf_study_id: found.study.pcf_study_id } } });
    if (found.study.status === "draft") {
      if (!result) return res.status(409).json({ message: "Calculate the footprint before sending it for review" });
      if (!(await resultIsCurrent(found.study, result))) {
        return res.status(409).json({ message: "Lines, factors or plant data changed since the last calculation; calculate it again" });
      }
    }
    await move(req, res, "draft", "in_review");
  } catch (err) {
    console.error("submitStudy", err);
    res.status(500).json({ message: "Could not send the footprint for review" });
  }
};

// POST /pcf/studies/:id/approve  { comment? }
export const approveStudy = (req: AuthRequest, res: Response) =>
  move(
    req,
    res,
    "in_review",
    "approved",
    (study, result, userId) => {
      // Four eyes: neither the creator nor whoever produced the result under review.
      if (study.created_by?.user_id === userId) return [403, "Someone other than the footprint's creator must approve it"];
      if (result?.calculated_by?.user_id === userId) return [403, "Someone other than the person who calculated it must approve it"];
      return null;
    },
    async (m, study, userId) => {
      await m.update(PcfStudy, { pcf_study_id: study.pcf_study_id }, {
        reviewed_by: { user_id: userId } as User,
        reviewed_at: new Date(),
        review_comment: comment(req) || null,
      });
      await m
        .createQueryBuilder()
        .update(PcfResult)
        .set({ is_draft: false })
        .where("pcf_study_id = :id", { id: study.pcf_study_id })
        .execute();
    },
  ).catch((err) => {
    console.error("approveStudy", err);
    res.status(500).json({ message: "Could not approve the footprint" });
  });

// POST /pcf/studies/:id/reject  { comment } (back to draft)
export const rejectStudy = (req: AuthRequest, res: Response) => {
  if (comment(req).length < 5) return res.status(400).json({ message: "Say what needs fixing (at least 5 characters)" });
  return move(req, res, "in_review", "draft", undefined, async (m, study, userId) => {
    await m.update(PcfStudy, { pcf_study_id: study.pcf_study_id }, {
      reviewed_by: { user_id: userId } as User,
      reviewed_at: new Date(),
      review_comment: comment(req),
    });
  }).catch((err) => {
    console.error("rejectStudy", err);
    res.status(500).json({ message: "Could not send the footprint back" });
  });
};

// POST /pcf/studies/:id/publish  (supersedes the earlier published study of this product at this site)
export const publishStudy = (req: AuthRequest, res: Response) =>
  move(
    req,
    res,
    "approved",
    "published",
    (study) => (study.stale ? "Plant data used by this footprint changed after approval; create a new version" : null),
    async (m, study, userId) => {
      const older = await m.find(PcfStudy, {
        where: {
          product: { product_id: study.product.product_id },
          site: { site_id: study.site.site_id },
          status: "published",
          pcf_study_id: Not(study.pcf_study_id),
        },
      });
      if (older.length) {
        await m.update(PcfStudy, { pcf_study_id: In(older.map((s) => s.pcf_study_id)) }, { status: "superseded" });
        for (const s of older) await audit(m, s, userId, "superseded", { status: { old: "published", new: "superseded" } }, `by study ${study.pcf_study_id}`);
      }
    },
    {
      where: "stale = false",
      // One publish per product at a time, so two versions can't both stay published.
      lock: (m, study) => m.query("SELECT pg_advisory_xact_lock($1, $2)", [PUBLISH_LOCK, study.product.product_id]),
    },
  ).catch((err) => {
    console.error("publishStudy", err);
    res.status(500).json({ message: "Could not publish the footprint" });
  });

// GET /pcf/reconciliation?siteId=&start=YYYY-MM-DD&end=YYYY-MM-DD
// Plant Scope 1+2 for the period against what the site's approved or
// published footprints for exactly that period allocate to their products.
export const reconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const siteId = idParam(req.query.siteId);
    const start = String(req.query.start ?? "");
    const end = String(req.query.end ?? "");
    if (!siteId) return res.status(400).json({ message: "siteId is required" });
    if (!DATE.test(start) || !DATE.test(end) || start > end) return res.status(400).json({ message: "start and end must be YYYY-MM-DD, start first" });
    const site = await AppDataSource.getRepository(Site).findOne({ where: { site_id: siteId } });
    if (!site || !canSeeSite(scope, siteId)) return res.status(404).json({ message: "Site not found" });

    // The plant total uses the same inclusion rules as a study's A3 energy.
    const probe = { reference_start: start, reference_end: end, allocation_key: "mass", site, product: { product_id: -1 } } as unknown as PcfStudy;
    const plant = await loadPlantData(probe);
    const plantTotal = plant.sources.reduce((s, r) => s + r.period_total_tco2e, 0);

    const studies = await AppDataSource.getRepository(PcfStudy)
      .createQueryBuilder("s")
      .leftJoinAndSelect("s.product", "product")
      .leftJoinAndSelect("s.allocations", "a")
      .where("s.site_id = :siteId", { siteId })
      .andWhere("s.status IN ('approved', 'published')")
      .andWhere("s.reference_start = :start AND s.reference_end = :end", { start, end })
      .orderBy("s.version", "DESC")
      .getMany();
    const latest = new Map<number, PcfStudy>();
    for (const s of studies) {
      const cur = latest.get(s.product.product_id);
      if (!cur || (cur.status !== "published" && s.status === "published")) latest.set(s.product.product_id, s);
    }
    const products = [...latest.values()].map((s) => {
      const covered = s.allocations.reduce((sum, a) => sum + (Number(a.period_total_tco2e) * Number(a.share_pct)) / 100, 0);
      return {
        product_id: s.product.product_id,
        product_name: s.product.name,
        pcf_study_id: s.pcf_study_id,
        version: s.version,
        status: s.status,
        stale: s.stale,
        covered_tco2e: covered,
        share_pct: s.allocations.length ? Number(s.allocations[0].share_pct) : 0,
      };
    });
    const covered = products.reduce((s, p) => s + p.covered_tco2e, 0);
    res.json({
      site_id: siteId,
      start,
      end,
      plant_s1_s2_tco2e: plantTotal,
      covered_tco2e: covered,
      coverage_pct: plantTotal > 0 ? (covered / plantTotal) * 100 : null,
      products,
      excluded: plant.excluded.filter((e) => e.kind === "emission"),
    });
  } catch (err) {
    console.error("reconciliation", err);
    res.status(500).json({ message: "Could not reconcile the plant" });
  }
};
