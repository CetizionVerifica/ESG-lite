/**
 * DS-2 (RS-2 build 7, R9) · materiality scores for the sustainability
 * report's matrix chart: `company_material_topic.impact_score` and
 * `financial_score` (0–10, one decimal, null = not scored).
 *
 *   materialityTopics(companyId)        every topic row with its scores
 *   materialityPoints(topics)           matrix points for the material topics, or null when any
 *                                       material topic lacks a score (the chart then isn't offered)
 *   saveScores(companyId, scores, uid)  sets the scores of existing topic rows (KPI-3 setup owns the rows)
 *
 * Routes (studio switch on, sustainability kind → KPI tracking on):
 *   GET /studio/materiality             R → {topics, points}
 *   PUT /studio/materiality             R {scores: [{esrs_topic, impact_score, financial_score}]} → {topics, points}
 */
import { Router } from "express";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { DsError } from "../contracts";
import { assertKind, studioCaller, type StudioRequest } from "../guard";
import { handle, parse } from "../http";

type Row = Record<string, any>;

export const ESRS_TOPIC_NAMES: Record<string, string> = {
  E1: "Climate change",
  E2: "Pollution",
  E3: "Water and marine resources",
  E4: "Biodiversity and ecosystems",
  E5: "Resource use and circular economy",
  S1: "Own workforce",
  S2: "Workers in the value chain",
  S3: "Affected communities",
  S4: "Consumers and end-users",
  G1: "Business conduct",
};

export interface MaterialTopic {
  esrs_topic: string;
  name: string;
  material: boolean;
  impact_score: number | null;
  financial_score: number | null;
}

export interface MaterialityPoint {
  topic: string;
  label: string;
  impact: number;
  financial: number;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function materialityTopics(companyId: number): Promise<MaterialTopic[]> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT esrs_topic, material, impact_score, financial_score FROM company_material_topic WHERE company_id = $1 ORDER BY esrs_topic`,
    [companyId],
  );
  return rows.map((r) => ({ esrs_topic: r.esrs_topic, name: ESRS_TOPIC_NAMES[r.esrs_topic] ?? r.esrs_topic, material: r.material === true, impact_score: num(r.impact_score), financial_score: num(r.financial_score) }));
}

/** Pure: the matrix points, or null when no topic is material or a material topic is unscored. */
export function materialityPoints(topics: MaterialTopic[]): MaterialityPoint[] | null {
  const material = topics.filter((t) => t.material);
  if (!material.length || material.some((t) => t.impact_score === null || t.financial_score === null)) return null;
  return material.map((t) => ({ topic: t.esrs_topic, label: t.name, impact: t.impact_score as number, financial: t.financial_score as number }));
}

const Score = z.number().min(0).max(10).multipleOf(0.1).nullable();
const PutScores = z
  .object({
    scores: z.array(z.object({ esrs_topic: z.string().regex(/^[ESG][1-5]$/), impact_score: Score, financial_score: Score }).strict()).min(1).max(20),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export async function saveScores(companyId: number, scores: z.infer<typeof PutScores>["scores"]): Promise<void> {
  await AppDataSource.transaction(async (m) => {
    for (const s of scores) {
      const r: Row[] = await m.query(
        `UPDATE company_material_topic SET impact_score = $1, financial_score = $2 WHERE company_id = $3 AND esrs_topic = $4 RETURNING id`,
        [s.impact_score, s.financial_score, companyId, s.esrs_topic],
      );
      const updated = Array.isArray(r[0]) ? r[0] : r;
      if (!updated.length) throw new DsError("DS_DOC_NOT_FOUND", { esrs_topic: s.esrs_topic });
    }
  });
}

export const materialityRouter = Router();

materialityRouter.get(
  "/materiality",
  handle("materiality.get", async (req, res) => {
    const caller = studioCaller(req as StudioRequest);
    assertKind(caller, "sustainability");
    const topics = await materialityTopics(caller.companyId);
    res.json({ topics, points: materialityPoints(topics) });
  }),
);

materialityRouter.put(
  "/materiality",
  handle("materiality.put", async (req, res) => {
    const caller = studioCaller(req as StudioRequest);
    assertKind(caller, "sustainability");
    const body = parse(PutScores, req.body ?? {});
    await saveScores(caller.companyId, body.scores);
    const topics = await materialityTopics(caller.companyId);
    res.json({ topics, points: materialityPoints(topics) });
  }),
);
