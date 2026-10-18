// D19 (KPI wave E) · ESG pillars (docs/kpi/wave-e.md, D19):
//
//   kpi_definition.pillar   varchar(20) not null: environment | social | governance.
//                           Added, then backfilled from the KPI's topic (TOPIC_PILLAR)
//                           where it is still empty, then made NOT NULL.
//
//   npm run migrate:kpi-pillars        (after migrate:kpi-library; the seed runs it too)
//
// Idempotent and additive: ADD COLUMN IF NOT EXISTS, and the backfill only
// fills rows whose pillar is null, so a Superadmin's override (or a second run)
// is never touched. The statements match what TypeORM generates for the
// entity, so ci/schema-diff.cjs sees nothing left to do. Nothing here touches
// emission data.
import "reflect-metadata";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { KPI_TOPICS, TOPIC_PILLAR } from "../kpi/contracts/enums";

/** `CASE topic WHEN 'climate' THEN 'environment' … END`, from the contract table. */
export const TOPIC_PILLAR_CASE = `CASE "topic" ${KPI_TOPICS.map((t) => `WHEN '${t}' THEN '${TOPIC_PILLAR[t]}'`).join(" ")} END`;

export const KPI_PILLAR_SCHEMA = [`ALTER TABLE "kpi_definition" ADD COLUMN IF NOT EXISTS "pillar" character varying(20)`];
export const BACKFILL_PILLARS = `UPDATE "kpi_definition" SET "pillar" = ${TOPIC_PILLAR_CASE} WHERE "pillar" IS NULL`;

/** Adds the column, fills it from the topic where empty, and makes it NOT NULL. Returns the rows filled. */
export async function ensurePillarColumn(m: Pick<EntityManager, "query">): Promise<number> {
  const [table] = await m.query(`SELECT to_regclass('kpi_definition') IS NOT NULL AS ok`);
  if (!table?.ok) throw new Error("kpi_definition is missing: run migrate:kpi-library first");
  for (const sql of KPI_PILLAR_SCHEMA) await m.query(sql);
  const [filled] = await m.query(`WITH done AS (${BACKFILL_PILLARS} RETURNING id) SELECT COUNT(*)::int AS n FROM done`);
  const [left] = await m.query(`SELECT COUNT(*)::int AS n, COALESCE(string_agg(DISTINCT topic, ', '), '') AS topics FROM kpi_definition WHERE pillar IS NULL`);
  if (Number(left?.n ?? 0) > 0) throw new Error(`${left.n} KPI(s) have a topic with no pillar (${left.topics}); nothing made NOT NULL`);
  const [col] = await m.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'kpi_definition' AND column_name = 'pillar' AND table_schema = current_schema()`);
  if (col?.is_nullable === "YES") await m.query(`ALTER TABLE "kpi_definition" ALTER COLUMN "pillar" SET NOT NULL`);
  return Number(filled?.n ?? 0);
}

async function main() {
  await AppDataSource.initialize();
  try {
    const filled = await AppDataSource.transaction((m) => ensurePillarColumn(m));
    console.log(`D19 kpi_definition.pillar present; ${filled} KPI(s) given their topic's pillar.`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
