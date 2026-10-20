/**
 * DS-13 · version history upkeep (D16). DS-5 makes the autosave versions (every
 * 10 minutes of editing, `docs/store.ts autosaveIfDue`) and prunes the doc it
 * just saved; DS-11 lists, snapshots ("named versions") and restores them.
 * This adds the pruning job for every design, so docs nobody edits any more
 * are pruned too:
 *
 *   pruneAllHistory()               autosaves older than 90 days outside each doc's newest 200
 *                                   (finals, snapshots and review versions are never touched),
 *                                   and drift baselines older than 90 days outside each doc's newest 20
 *   startStudioHistoryScheduler()   node-cron at 03:20 server time; off under NODE_ENV=test and
 *                                   with STUDIO_HISTORY_JOB=off (tests call pruneAllHistory)
 */
import cron from "node-cron";
import { AppDataSource } from "../../config/data-source";
import { AUTOSAVE_KEEP_DAYS, AUTOSAVE_KEEP_LAST, pruneAutosaves } from "../docs/store";

type Row = Record<string, any>;

export const BASELINE_KEEP_LAST = 20;

export interface PruneRun {
  docs: number;
  versionsDeleted: number;
  baselinesDeleted: number;
}

const count = (res: unknown): number => (Array.isArray(res) && typeof res[1] === "number" ? res[1] : 0);

export async function pruneAllHistory(): Promise<PruneRun> {
  const docs: Row[] = await AppDataSource.query(
    `SELECT DISTINCT doc_id FROM report_doc_version WHERE kind = 'autosave' AND created_at < now() - ($1 || ' days')::interval ORDER BY doc_id`,
    [String(AUTOSAVE_KEEP_DAYS)],
  );
  let versionsDeleted = 0;
  for (const d of docs) versionsDeleted += count(await pruneAutosaves(Number(d.doc_id)));
  const b = await AppDataSource.query(
    `DELETE FROM report_data_baseline x WHERE x.created_at < now() - ($1 || ' days')::interval
       AND x.id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY doc_id ORDER BY created_at DESC, id DESC) AS rn FROM report_data_baseline) k WHERE k.rn <= $2)`,
    [String(AUTOSAVE_KEEP_DAYS), BASELINE_KEEP_LAST],
  );
  return { docs: docs.length, versionsDeleted, baselinesDeleted: count(b) };
}

export function startStudioHistoryScheduler(): void {
  if (process.env.NODE_ENV === "test" || process.env.STUDIO_HISTORY_JOB === "off") return;
  cron.schedule("20 3 * * *", async () => {
    try {
      const r = await pruneAllHistory();
      if (r.versionsDeleted || r.baselinesDeleted) console.log(`[studio] history pruned: ${r.versionsDeleted} autosaves in ${r.docs} designs, ${r.baselinesDeleted} baselines (kept ${AUTOSAVE_KEEP_DAYS} days or the newest ${AUTOSAVE_KEEP_LAST})`);
    } catch (err) {
      console.warn("[studio] history pruning failed:", (err as Error)?.message);
    }
  });
}

// `node dist/studio/collab/history.js` prunes once (operators; the API test runs it this way).
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("reflect-metadata");
  AppDataSource.initialize()
    .then(() => pruneAllHistory())
    .then((r) => {
      console.log(JSON.stringify(r));
      return AppDataSource.destroy();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
