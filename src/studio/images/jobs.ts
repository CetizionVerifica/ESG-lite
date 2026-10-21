/**
 * PE-1 · background-removal jobs (contracts/pro.ts `ImageJob`, decision E1).
 *
 *   startRemoveBackground   tenant-checked source asset → queued report_image_job (202)
 *   getImageJob             the caller's company's job by id (404 otherwise)
 *   processImageJob         queued → running → done (a NEW derived asset) | failed
 *
 * Jobs run on a one-at-a-time in-process runner after the request answers
 * (the model session lives in the API process; studio render jobs use the
 * same fallback). A job left queued by a stopped process is picked up again
 * when it is next read; one left running for longer than STALE_MS fails with
 * reason `timeout`. The source asset is only read, never changed or deleted.
 */
import { AppDataSource } from "../../config/data-source";
import { r2Enabled, r2PublicUrl } from "../../config/r2";
import { BG_INPUT_MIMES, DsError, RemoveBackgroundBodySchema, type DsErrorCode, type ImageJob, type JobStatus } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { companyAssetRow, storeDerivedAsset } from "../library/assets";
import { readLocalAsset } from "../library/storage";
import { bgEngine, type BgEngine } from "./bgRemove/engine";
import { BgProcessError, removeBackgroundBytes } from "./process";

type Row = Record<string, any>;

/** Queued or running background removals a company may have at once. */
export const IMAGE_JOBS_PER_COMPANY = 3;
const STALE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const SOURCE_MAX_BYTES = 25 * 1024 * 1024;

const COLS = `id, company_id, kind, asset_id, status, result_asset_id, error_code, error_reason, engine, attempts, requested_by, started_at, finished_at, created_at`;

export const toImageJob = (r: Row): ImageJob => ({
  id: Number(r.id),
  kind: "remove_background",
  assetId: String(r.asset_id),
  status: r.status as JobStatus,
  resultAssetId: r.result_asset_id ? String(r.result_asset_id) : null,
  errorCode: (r.error_code as DsErrorCode | null) ?? null,
  errorReason: r.error_reason ?? null,
  createdAt: new Date(r.created_at).toISOString(),
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

/** Test hooks (NODE_ENV=test only, from the request header x-studio-test-bg): "off" = no engine, "fail" = an engine that fails. */
export type EngineOverride = "off" | "fail" | null;
const failing: BgEngine = {
  name: "stub-fail",
  side: 32,
  mask: async () => {
    throw new BgProcessError("model", "test engine failure");
  },
};
const overrides = new Map<number, EngineOverride>();
const engineFor = (override: EngineOverride): BgEngine | null => (override === "off" ? null : override === "fail" ? failing : bgEngine());

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const pending: number[] = [];
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const id = pending.shift() as number;
      try {
        await processImageJob(id);
      } catch (err) {
        console.error(`[studio] image job ${id} crashed:`, (err as Error)?.message);
      }
    }
  } finally {
    running = false;
  }
}

function dispatch(id: number): void {
  if (!pending.includes(id)) pending.push(id);
  setImmediate(() => void drain());
}

/** True while the runner has work (tests wait on it). */
export const imageJobsBusy = () => running || pending.length > 0;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export async function startRemoveBackground(caller: StudioCaller, id: unknown, body: unknown, override: EngineOverride = null): Promise<ImageJob> {
  parse(RemoveBackgroundBodySchema, body ?? {});
  const asset = await companyAssetRow(caller.companyId, String(id ?? ""));
  if (!asset) throw new DsError("DS_DOC_NOT_FOUND");
  if (!(BG_INPUT_MIMES as readonly string[]).includes(asset.mime)) throw new DsError("DS_ASSET_TYPE", { reason: "BG_INPUT", mime: asset.mime }, "The background can be removed from JPG, PNG and WebP images only.");
  const engine = engineFor(override);
  if (!engine) throw new DsError("DS_BG_UNAVAILABLE");

  // The same image already being worked on: that job comes back.
  const [active]: Row[] = await AppDataSource.query(`SELECT ${COLS} FROM report_image_job WHERE company_id = $1 AND asset_id = $2 AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`, [caller.companyId, asset.id]);
  if (active) return toImageJob(active);
  const [{ n }]: Row[] = await AppDataSource.query(`SELECT count(*)::int AS n FROM report_image_job WHERE company_id = $1 AND status IN ('queued', 'running')`, [caller.companyId]);
  if (Number(n) >= IMAGE_JOBS_PER_COMPANY) throw new DsError("DS_JOB_RUNNING", { reason: "IMAGE_JOBS_BUSY", limit: IMAGE_JOBS_PER_COMPANY }, "A few backgrounds are already being removed. Try again in a moment.");

  const [row]: Row[] = await AppDataSource.query(
    `INSERT INTO report_image_job (company_id, kind, asset_id, status, engine, requested_by) VALUES ($1, 'remove_background', $2, 'queued', $3, $4) RETURNING ${COLS}`,
    [caller.companyId, asset.id, engine.name, caller.userId || null],
  );
  if (override) overrides.set(Number(row.id), override);
  dispatch(Number(row.id));
  return toImageJob(row);
}

export async function getImageJob(caller: StudioCaller, id: unknown): Promise<ImageJob> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new DsError("DS_DOC_NOT_FOUND");
  const [row]: Row[] = await AppDataSource.query(`SELECT ${COLS} FROM report_image_job WHERE id = $1 AND company_id = $2`, [n, caller.companyId]);
  if (!row) throw new DsError("DS_DOC_NOT_FOUND");
  const age = Date.now() - new Date(row.started_at ?? row.created_at).getTime();
  if (row.status === "running" && age > STALE_MS) {
    const [rows]: [Row[], number] = await AppDataSource.query(
      `UPDATE report_image_job SET status = 'failed', error_code = 'DS_JOB_FAILED', error_reason = 'timeout', finished_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2 AND status = 'running' RETURNING ${COLS}`,
      [n, caller.companyId],
    );
    if (rows[0]) return toImageJob(rows[0]);
  }
  // Queued by a process that stopped before running it: run it here.
  if (row.status === "queued" && !pending.includes(n) && !running) dispatch(n);
  return toImageJob(row);
}

async function sourceBytes(row: Row): Promise<Buffer | null> {
  if (!r2Enabled()) return readLocalAsset(row.r2_key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(r2PublicUrl(row.r2_key), { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > SOURCE_MAX_BYTES ? null : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fail(id: number, code: DsErrorCode, reason: string): Promise<"failed"> {
  await AppDataSource.query(`UPDATE report_image_job SET status = 'failed', error_code = $2, error_reason = $3, finished_at = now(), updated_at = now() WHERE id = $1`, [id, code, reason]);
  return "failed";
}

/** queued → running → done | failed. Safe to call twice: only a queued row is claimed. */
export async function processImageJob(id: number): Promise<"done" | "failed" | "skipped"> {
  const override = overrides.get(id) ?? null;
  // data-loss-reviewed: removes an entry from an in-memory Map, no record is deleted.
  overrides.delete(id);
  const [claimed]: [Row[], number] = await AppDataSource.query(
    `UPDATE report_image_job SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'queued' RETURNING ${COLS}`,
    [id],
  );
  const job = claimed[0];
  if (!job) return "skipped";
  const engine = engineFor(override);
  if (!engine) return fail(id, "DS_BG_UNAVAILABLE", "model");
  const source = await companyAssetRow(Number(job.company_id), String(job.asset_id)).catch(() => null);
  if (!source) return fail(id, "DS_JOB_FAILED", "image");
  const bytes = await sourceBytes(source);
  if (!bytes) return fail(id, "DS_JOB_FAILED", "storage");
  let cut;
  try {
    cut = await removeBackgroundBytes(bytes, engine);
  } catch (err) {
    const reason = err instanceof BgProcessError ? err.reason : "model";
    console.error(`[studio] image job ${id} (${engine.name}) failed: ${reason}`);
    return fail(id, "DS_JOB_FAILED", reason);
  }
  let asset;
  try {
    asset = await storeDerivedAsset({ companyId: Number(job.company_id), userId: job.requested_by ? Number(job.requested_by) : null }, { id: String(source.id), alt: source.alt ?? "", folder: source.folder ?? null }, cut, "remove_background");
  } catch (err) {
    console.error(`[studio] image job ${id} result not stored:`, (err as Error)?.message);
    return fail(id, "DS_JOB_FAILED", "storage");
  }
  await AppDataSource.query(`UPDATE report_image_job SET status = 'done', result_asset_id = $2, engine = $3, finished_at = now(), updated_at = now() WHERE id = $1`, [id, asset.id, engine.name]);
  return "done";
}
