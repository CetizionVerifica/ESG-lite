/**
 * IN-7 · GET and PUT /kpi/setup/materiality-scores (01-contracts §4, I10; shared with RS-2 / DS-2).
 *
 * GET (any role of the company, as GET /kpi/setup) answers the same shape as PUT. It lets the KPI
 * setup scores block read the scores without Design Studio (GET /studio/materiality is behind the
 * studio switch).
 *
 * Mounted on the KPI setup router (behind requireKpiTracking: 403 KPI_TRACKING_OFF while
 * off; a Superadmin passes company_id). Admin and Superadmin only (else 403 KPI_FORBIDDEN).
 * Body `MaterialityScoresBodySchema`: `{topics:[{esrs_topic, impact_score, financial_score}]}`,
 * scores 0–10 with one decimal or null. A bad body, or a topic that isn't one of the company's
 * material topics (company_material_topic.material = true), is 400 IN_SCORES_INVALID and
 * nothing is saved.
 *
 * Writes the DS-2 columns (`impact_score`, `financial_score`, migrate:ds-2-materiality-scores)
 * on the existing KPI-3 topic rows, in one transaction, and one audit_log row
 * (`kpi_setup`, action `materiality_scores`) listing the topic codes changed — never the values.
 * Answers `{topics:[{esrs_topic, label, material, impact_score, financial_score}]}`.
 */
import type { Response } from "express";
import { AppDataSource } from "../config/data-source";
import { ESRS_TOPIC_LABELS } from "../kpi/contracts/labels";
import { KpiError } from "../kpi/contracts/errors";
import { kpiCaller, type KpiRequest } from "../kpi/guard";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { InError } from "./contracts/errors";
import { MaterialityScoresBodySchema } from "./contracts/schemas";
import { parse } from "./http";

type Row = Record<string, any>;

const SCORE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function topicScores(companyId: number) {
  const rows: Row[] = await AppDataSource.query(
    `SELECT esrs_topic, material, impact_score, financial_score FROM company_material_topic WHERE company_id = $1 ORDER BY esrs_topic`,
    [companyId],
  );
  return rows.map((r) => ({
    esrs_topic: String(r.esrs_topic),
    label: (ESRS_TOPIC_LABELS as Record<string, string>)[r.esrs_topic] ?? String(r.esrs_topic),
    material: r.material === true,
    impact_score: num(r.impact_score),
    financial_score: num(r.financial_score),
  }));
}

export async function putMaterialityScores(req: KpiRequest, body: unknown) {
  const caller = kpiCaller(req);
  if (!SCORE_ROLES.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Admin", "Superadmin"] });
  const b = parse(MaterialityScoresBodySchema, body ?? {}, "IN_SCORES_INVALID");
  const codes = b.topics.map((t) => t.esrs_topic);
  if (new Set(codes).size !== codes.length) throw new InError("IN_SCORES_INVALID", { rule: "one_row_per_topic" });
  const material = new Set((await topicScores(caller.companyId)).filter((t) => t.material).map((t) => t.esrs_topic));
  const unknown = codes.filter((c) => !material.has(c));
  if (unknown.length) throw new InError("IN_SCORES_INVALID", { rule: "material_topic", esrs_topics: unknown });
  await AppDataSource.transaction(async (m) => {
    for (const t of b.topics) {
      await m.query(`UPDATE company_material_topic SET impact_score = $1, financial_score = $2 WHERE company_id = $3 AND esrs_topic = $4 AND material = true`, [
        t.impact_score,
        t.financial_score,
        caller.companyId,
        t.esrs_topic,
      ]);
    }
    await m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_setup', $1, 'materiality_scores', $2, NULL, $3)`, [
      caller.companyId,
      JSON.stringify({ esrs_topics: codes }),
      caller.userId || null,
    ]);
  });
  return { topics: await topicScores(caller.companyId) };
}

export async function getMaterialityScores(req: KpiRequest) {
  return { topics: await topicScores(kpiCaller(req).companyId) };
}

/** A route handler: KPI and Insights errors in their `{code, message, details}` shape. */
const scoresRoute =
  (what: string, work: (req: AuthRequest) => Promise<unknown>) =>
  async (req: AuthRequest, res: Response) => {
    try {
      res.json(await work(req));
    } catch (err) {
      if (err instanceof InError || err instanceof KpiError) return res.status(err.status).json(err.toBody());
      console.error(`[insights] materiality scores ${what} failed (user ${req.user?.userId}):`, (err as Error)?.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

export const materialityScoresRoute = scoresRoute("save", (req) => putMaterialityScores(req as KpiRequest, req.body));
export const materialityScoresGetRoute = scoresRoute("read", (req) => getMaterialityScores(req as KpiRequest));
