// D17 (KPI wave D) · topic-wise assignment (docs/kpi/wave-d.md, D17):
//
//   kpi_topic_assignment     owner (and optional reviewer) per (company, site, KPI topic); site null =
//                            company level. The unique key treats a null site as one value, so it is
//                            an expression index (mirrored in ci/api/fixture.sql)
//   kpi_topic_grant.converted_at   when a grant was turned into topic assignments (below)
//
//   npm run migrate:kpi-topic-assignment
//
// Idempotent and additive: IF NOT EXISTS only; no row is deleted or changed
// except the new `converted_at` stamp. Grants (kpi_topic_grant, no longer read)
// are converted ONCE: each unconverted grant of a User or Manager becomes the
// owner of that topic on each of their sites where the slot is still empty
// (Users before Managers, then the lowest user id), then the grant is stamped,
// so a later run never refills a slot someone emptied on purpose.
// Wave B setups gave every KPI its own kpi_assignment row. Where one person
// (same owner and reviewer) holds every per-KPI row of a topic on a site and
// that slot has no topic owner yet, they become its topic owner (insert only;
// the per-KPI rows stay and now equal the topic owner, so nothing changes who
// owns what). They are dropped later when the topic owner changes. The collapse
// runs only on the run that creates kpi_topic_assignment: on later boots a
// per-KPI override left on every KPI of an emptied topic must stay an override,
// not quietly become the topic owner. Statements
// match what TypeORM generates for the entity, so ci/schema-diff.cjs sees
// nothing left to do. Nothing here touches emission data.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { KPI_TOPICS } from "../kpi/contracts/enums";

export const KPI_TOPIC_ASSIGNMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "kpi_topic_assignment" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "site_id" integer, "topic" character varying(30) NOT NULL, "owner_user_id" integer NOT NULL, "reviewer_user_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_by" integer, CONSTRAINT "PK_f4d5881b185fc54cf3896efe7a3" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_topic_assignment_company_owner" ON "kpi_topic_assignment" ("company_id", "owner_user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_topic_assignment_company_site_topic" ON "kpi_topic_assignment" ("company_id", (COALESCE("site_id", 0)), "topic")`,
  `ALTER TABLE "kpi_topic_grant" ADD COLUMN IF NOT EXISTS "converted_at" TIMESTAMP`,
];

export const COLLAPSE_PER_KPI = `
  INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id, reviewer_user_id)
  SELECT g.company_id, g.site_id, g.topic, g.owner, NULLIF(g.reviewer, 0) FROM (
    SELECT a.company_id, a.site_id, d.topic, MIN(a.owner_user_id) AS owner, MAX(a.owner_user_id) AS owner_max,
           MIN(COALESCE(a.reviewer_user_id, 0)) AS reviewer, MAX(COALESCE(a.reviewer_user_id, 0)) AS reviewer_max
      FROM kpi_assignment a JOIN kpi_definition d ON d.id = a.kpi_definition_id
     GROUP BY a.company_id, a.site_id, d.topic
  ) g
  WHERE g.owner = g.owner_max AND g.reviewer = g.reviewer_max
  ON CONFLICT (company_id, (COALESCE(site_id, 0)), topic) DO NOTHING`;

export const CONVERT_GRANTS = `
  INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id)
  SELECT company_id, site_id, topic, user_id FROM (
    SELECT DISTINCT ON (s.company_id, s.site_id, g.topic) s.company_id, s.site_id, g.topic, g.user_id
      FROM kpi_topic_grant g
      JOIN "user" u ON u.user_id = g.user_id AND u.role IN ('User', 'Manager')
      JOIN (SELECT user_id, site_id FROM "user" WHERE site_id IS NOT NULL UNION SELECT user_id, site_id FROM user_sites) us ON us.user_id = g.user_id
      JOIN site s ON s.site_id = us.site_id
     WHERE g.converted_at IS NULL AND g.topic = ANY($1::text[])
     ORDER BY s.company_id, s.site_id, g.topic, (u.role = 'User') DESC, g.user_id
  ) first_grant
  ON CONFLICT (company_id, (COALESCE(site_id, 0)), topic) DO NOTHING`;

async function main() {
  await AppDataSource.initialize();
  try {
    const [grants] = await AppDataSource.query(`SELECT to_regclass('kpi_topic_grant') IS NOT NULL AS ok`);
    if (!grants?.ok) throw new Error("kpi_topic_grant is missing: run migrate:kpi-setup first");
    const [existing] = await AppDataSource.query(`SELECT to_regclass('kpi_topic_assignment') IS NOT NULL AS ok`);
    const firstRun = !existing?.ok;
    for (const sql of KPI_TOPIC_ASSIGNMENT_SCHEMA) await AppDataSource.query(sql);
    const converted = await AppDataSource.transaction(async (m) => {
      await m.query(`LOCK TABLE kpi_topic_grant IN SHARE ROW EXCLUSIVE MODE`);
      const [ins] = await m.query(`WITH made AS (${CONVERT_GRANTS} RETURNING id) SELECT COUNT(*)::int AS n FROM made`, [[...KPI_TOPICS]]);
      const [upd] = await m.query(`WITH done AS (UPDATE kpi_topic_grant SET converted_at = now() WHERE converted_at IS NULL RETURNING id) SELECT COUNT(*)::int AS n FROM done`);
      const [col] = firstRun ? await m.query(`WITH made AS (${COLLAPSE_PER_KPI} RETURNING id) SELECT COUNT(*)::int AS n FROM made`) : [{ n: 0 }];
      return { assignments: Number(ins?.n ?? 0), grants: Number(upd?.n ?? 0), collapsed: Number(col?.n ?? 0) };
    });
    console.log(`D17 kpi_topic_assignment present; ${converted.assignments} topic assignment(s) made from ${converted.grants} unconverted grant(s); ${converted.collapsed} from per-KPI rows held by one person.`);
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
