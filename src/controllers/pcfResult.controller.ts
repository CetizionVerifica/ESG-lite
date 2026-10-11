// PCF result detail and audit trail (C03 footprint result page).
// Read-only: everything comes from the stored PcfResult (its factor_snapshot
// and the engine lines saved at Calculate), PcfAllocation rows and the audit
// log. Licensed (ecoinvent) values stay hidden from non-superadmins exactly as
// in the study summary (src/pcf/redact.ts).
// A PCF result is a product footprint only; it is never reused as a CBAM figure.
import { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "../middlewares/auth.middleware";
import { PcfResult } from "../entities/PcfResult";
import { PcfAllocation } from "../entities/PcfAllocation";
import { AuditLog } from "../entities/AuditLog";
import { pcfScope } from "../pcf/access";
import { computePcf, PcfEngineInput, PcfLine } from "../pcf/engine/computePcf";
import { licensedLineIds, redactAggregates, redactLines, redactStages } from "../pcf/redact";
import { loadStudy } from "./pcf.controller";

const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const MASS_TO_KG: Record<string, number> = { g: 0.001, kg: 1, t: 1000, tonne: 1000, tonnes: 1000 };
const LEVER_STEP_PTS = 10;

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

// Change in the product total when one line's recycled share goes up by 10
// points (capped at 100%), found by re-running the engine on the stored
// snapshot with that line swapped. Negative means the footprint goes down.
export function recycledLevers(input: PcfEngineInput, baseTotal: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of input.inputs) {
    if (line.stage !== "A1" || !line.recycled_factor_id || line.supplier_pcf_kgco2e != null) continue;
    const share = line.recycled_share_pct ?? 0;
    if (share >= 100) continue;
    const next = Math.min(100, share + LEVER_STEP_PTS);
    try {
      const swapped = computePcf({ ...input, inputs: input.inputs.map((i) => (i.id === line.id ? { ...i, recycled_share_pct: next } : i)) });
      out.set(line.id, swapped.total_kg_per_unit - baseTotal);
    } catch {
      // A recycled factor whose unit can't take this line's quantity: no lever.
    }
  }
  return out;
}

// Mass-weighted recycled share of the A1 lines measured in mass; null when none are.
export function recycledInputPct(input: PcfEngineInput): number | null {
  let mass = 0;
  let recycled = 0;
  for (const i of input.inputs) {
    const k = MASS_TO_KG[i.unit.trim().toLowerCase()];
    if (i.stage !== "A1" || k === undefined) continue;
    mass += i.quantity * k;
    recycled += i.quantity * k * ((i.recycled_share_pct ?? 0) / 100);
  }
  return mass > 0 ? (recycled / mass) * 100 : null;
}

// GET /pcf/studies/:id/result
export const getStudyResult = async (req: AuthRequest, res: Response) => {
  try {
    const found = await studyFor(req, res);
    if (!found) return;
    const { scope, study } = found;
    const result = await AppDataSource.getRepository(PcfResult).findOne({
      where: { study: { pcf_study_id: study.pcf_study_id } },
      relations: ["calculated_by"],
    });
    if (!result) return res.status(404).json({ message: "This footprint hasn't been calculated yet" });
    const allocations = await AppDataSource.getRepository(PcfAllocation).find({
      where: { study: { pcf_study_id: study.pcf_study_id } },
      relations: ["category"],
      order: { scope: "ASC", category_name: "ASC" },
    });

    const input = (result.factor_snapshot as unknown as { input?: PcfEngineInput } | null)?.input ?? null;
    const stored = result.cut_off as {
      lines?: PcfLine[];
      allocation?: { share_pct: number; product_output_units: number } | null;
      dqr?: { technology: number; geography: number; time: number; overall: number };
      below_threshold_ids?: string[];
      below_threshold_total_pct?: number;
      within_limit?: boolean;
      warnings?: string[];
    } | null;
    const lines = stored?.lines ?? [];
    const hidden = scope.all ? new Set<string>() : licensedLineIds(input);
    const total = Number(result.total_kg_per_unit);
    const factors = new Map((input?.factors ?? []).map((f) => [f.id, f]));
    const inputsById = new Map((input?.inputs ?? []).map((i) => [i.id, i]));
    const levers = input ? recycledLevers(input, total) : new Map<string, number>();
    const factorJson = (id: string | null | undefined, hideValue: boolean) => {
      const f = id ? factors.get(id) : undefined;
      if (!f) return null;
      const licensed = f.licence === "ecoinvent";
      return {
        name: f.name,
        unit: f.unit,
        source: f.source ?? null,
        licence: f.licence ?? null,
        value_kgco2e: hideValue || (licensed && !scope.all) ? null : f.value_kgco2e,
      };
    };

    const { by_stage, hidden_stages } = redactStages(result.by_stage, lines, hidden);
    const dqr = stored?.dqr ?? null;
    const aggregates = redactAggregates(
      {
        primary_data_share_pct: Number(result.primary_data_share_pct),
        dqr,
        fossil_kg_per_unit: total - Number(result.biogenic_kg_per_unit),
        biogenic_kg_per_unit: Number(result.biogenic_kg_per_unit),
      },
      hidden,
    );

    res.json({
      pcf_study_id: study.pcf_study_id,
      total_kg_per_unit: total,
      by_stage,
      hidden_stages,
      ...aggregates,
      recycled_input_pct: input ? recycledInputPct(input) : null,
      lines: redactLines(lines, hidden).map((l) => {
        const src = inputsById.get(l.id);
        const isHidden = hidden.has(l.id);
        return {
          ...l,
          pcf_input_id: l.id.startsWith("in-") ? Number(l.id.slice(3)) : null,
          share_pct: l.kgco2e_per_unit == null || total === 0 ? null : (l.kgco2e_per_unit / total) * 100,
          quantity: src?.stage === "A2" ? src.payload_t ?? null : src?.quantity ?? null,
          unit: src?.stage === "A2" ? "t" : src?.unit ?? null,
          recycled_share_pct: src?.recycled_share_pct ?? null,
          supplier_specific: src?.supplier_pcf_kgco2e != null,
          factor: factorJson(src?.factor_id, isHidden),
          recycled_factor: factorJson(src?.recycled_factor_id, isHidden),
          lever_kg_per_10pts: isHidden ? null : levers.get(l.id) ?? null,
        };
      }),
      cut_off: hidden.size
        ? { below_threshold_ids: null, below_threshold_total_pct: null, within_limit: stored?.within_limit ?? null }
        : {
            below_threshold_ids: stored?.below_threshold_ids ?? [],
            below_threshold_total_pct: stored?.below_threshold_total_pct ?? 0,
            within_limit: stored?.within_limit ?? null,
          },
      allocation: stored?.allocation
        ? {
            ...stored.allocation,
            key: study.allocation_key,
            key_value_product: allocations[0] ? Number(allocations[0].key_value_product) : input?.allocation?.key_value_product ?? null,
            key_value_site_total: allocations[0] ? Number(allocations[0].key_value_site_total) : input?.allocation?.key_value_site_total ?? null,
          }
        : null,
      allocations: allocations.map((a) => ({
        pcf_allocation_id: a.pcf_allocation_id,
        category_id: a.category?.category_id ?? null,
        category_name: a.category_name,
        scope: a.scope,
        period_total_tco2e: Number(a.period_total_tco2e),
        share_pct: Number(a.share_pct),
        allocated_kg_per_unit: Number(a.allocated_kg_per_unit),
      })),
      emission_ids_used: result.emission_ids_used ?? [],
      production_ids_used: result.production_ids_used ?? [],
      warnings: stored?.warnings ?? [],
      is_draft: result.is_draft,
      engine_version: result.engine_version,
      calculated_at: result.calculated_at,
      calculated_by: result.calculated_by ? { user_id: result.calculated_by.user_id, name: result.calculated_by.name } : null,
    });
  } catch (err) {
    console.error("getStudyResult", err);
    res.status(500).json({ message: "Could not load the footprint result" });
  }
};

// GET /pcf/studies/:id/audit
export const getStudyAudit = async (req: AuthRequest, res: Response) => {
  try {
    const found = await studyFor(req, res);
    if (!found) return;
    const logs = await AppDataSource.getRepository(AuditLog).find({
      where: { entity_type: "pcf_study", entity_id: found.study.pcf_study_id },
      relations: ["changed_by"],
      order: { changed_at: "DESC", id: "DESC" },
    });
    res.json(
      logs.map((l) => ({
        id: l.id,
        action: l.action,
        changed_fields: l.changed_fields,
        reason: l.reason ?? null,
        changed_by: l.changed_by ? { user_id: l.changed_by.user_id, name: l.changed_by.name } : null,
        changed_at: l.changed_at,
      })),
    );
  } catch (err) {
    console.error("getStudyAudit", err);
    res.status(500).json({ message: "Could not load the footprint history" });
  }
};
