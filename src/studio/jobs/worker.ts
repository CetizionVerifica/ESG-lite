/**
 * DS-11 · the render worker (RS-5 §3 worker steps, 01-contracts §7):
 *
 *   claim (queued → running) → load the stored doc → resolve (DS-2) → HTML
 *   (DS-1 html.ts) → Chromium (DS-1 print.ts: PDF screen | print, PNG pages)
 *   → private storage (storage.ts) → sha256, page count, measurements → done
 *   → a final writes its version (doc, data snapshot, hashes, PDF) → the
 *   `report_ready` notification to the requester.
 *
 * One Chromium is reused across jobs, with a new context per job (print.ts).
 * Each attempt has a time limit (STUDIO_JOB_TIMEOUT_MS, default 120 s); a
 * failure is retried once, then the job is `failed` with a reason:
 * timeout | chromium | font | measure | storage | data. A data error (the doc
 * no longer validates, the kind was switched off) is not retried.
 *
 * Jobs reach `processJob` from the `studio.render` queue consumer
 * (src/queues/studioRenderConsumer.ts) or, without RabbitMQ (local, tests),
 * from the in-process runner in src/queues/studioRenderProducer.ts.
 */
import { createHash } from "crypto";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { AppDataSource } from "../../config/data-source";
import { DsError, ReportDocSchema, type ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { kpiTrackingEnabled } from "../../kpi/guard";
import { renderPdf, renderPng } from "../../reporting/studio/print";
import { RENDER_HASH } from "../../reporting/studio/render";
import type { RenderDoc } from "../../reporting/studio/render/types";
import type { Measurement } from "../../reporting/studio/render/measure"; // DS-12
import { createNotification } from "../../services/notificationService";
import { renderInputs } from "./inputs";
import { JOB_COLS, JOB_SUFFIX, OUTPUT_KEEP_DAYS, toJobRow, type JobRow } from "./service";
import { outputKey, putOutput } from "./storage";
import { zipStore } from "./zip";
import { setPrintBoxes } from "./printBoxes";
import { bleedFor } from "../../reporting/studio/render/formats";
import { layoutErrors } from "../checks/layout"; // DS-12

type Row = Record<string, any>;

export const JOB_TIMEOUT_MS = () => Number(process.env.STUDIO_JOB_TIMEOUT_MS) || 120_000;
export const JOB_MAX_ATTEMPTS = 2;

/** PNG device scale for a dpi: 144 → 2× (the screen "2×"), 300 → 300/96. */
export const pngScale = (dpi: number | undefined): number => (dpi === 300 ? 300 / 96 : 2);

/** 1-based page numbers of an inclusive range (null = every page). */
export const pageRange = (pages: [number, number] | undefined): number[] | null => (pages ? Array.from({ length: pages[1] - pages[0] + 1 }, (_, i) => pages[0] + i) : null);

/** The failure reason of an error (DS_JOB_FAILED details.reason). */
export function failureReason(err: unknown): string {
  if (err instanceof DsError) return err.code === "DS_CHECKS_BLOCKING" ? "checks" : "data"; // DS-12: a final refused by its layout checks
  const msg = String((err as Error)?.message ?? err);
  const name = String((err as Error)?.name ?? "");
  if (name === "TimeoutError" || /timed? ?out|timeout/i.test(msg)) return "timeout";
  if (/storage|R2|S3|ENOSPC|EACCES|bad output key/i.test(msg)) return "storage";
  if (/font/i.test(msg)) return "font";
  if (/render failed in the page|__measure|__error/i.test(msg)) return "measure";
  if (/browser|chrom|executable|playwright|Target (page|closed)|context/i.test(msg)) return "chromium";
  return "chromium";
}
export const retryable = (reason: string) => reason !== "data" && reason !== "checks"; // DS-12

export class JobTimeout extends Error {
  constructor(ms: number) {
    super(`Render timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

/** Runs `fn` with a time limit; on timeout `onTimeout` runs (e.g. closing the browser) and the promise rejects. */
export function withTimeout<T>(fn: () => Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new JobTimeout(ms));
      }
    }, ms);
    fn().then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// One shared Chromium
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

async function sharedBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  if (browser?.isConnected()) return browser;
  if (!launching) {
    launching = chromium.launch().then((b) => {
      browser = b;
      b.on("disconnected", () => {
        if (browser === b) browser = null;
      });
      return b;
    });
    launching.finally(() => (launching = null)).catch(() => undefined);
  }
  return launching;
}

const releaseBrowserSoon = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), 60_000);
  idleTimer.unref?.();
};

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b) await b.close().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** The worker acts for the company with full site access; the requester's access was checked when the job was made. */
async function workerCaller(job: JobRow): Promise<StudioCaller> {
  return { companyId: job.companyId, userId: job.requestedBy ?? 0, role: "Manager", roleClass: "M", sites: null, kpiEnabled: await kpiTrackingEnabled(job.companyId) };
}

interface Output {
  bytes: Buffer;
  pageCount: number | null;
  measurements: unknown[] | null;
}

/** Renders a job's output with the shared browser (pure apart from Chromium). */
export async function renderOutput(job: Pick<JobRow, "kind" | "options">, doc: ReportDoc, inputs: Awaited<ReturnType<typeof renderInputs>>, b: Browser): Promise<Output> {
  const rdoc = doc as unknown as RenderDoc;
  const common = { browser: b, brand: inputs.brand, assets: inputs.assets, customFonts: inputs.customFonts /* PE-2 */, timeoutMs: JOB_TIMEOUT_MS() };
  switch (job.kind) {
    case "proof":
    case "final": {
      // DS-12: a final measures itself and stops before page.pdf on a layout error (RS-9 §5).
      const beforePdf =
        job.kind === "final"
          ? (m: Measurement[]) => {
              const errors = layoutErrors(doc, m);
              if (errors.length) {
                console.warn(`[studio] final ${job.kind} refused by layout checks: ${errors.map((c) => `${c.id}@${c.elementId ?? c.pageId ?? ""}`).join(", ")}`);
                throw new DsError("DS_CHECKS_BLOCKING", { reason: "layout", checks: errors, measurements: m });
              }
            }
          : undefined;
      const r = await renderPdf(rdoc, inputs.data, "screen", { ...common, ...(beforePdf ? { beforePdf } : {}) });
      return { bytes: r.pdf, pageCount: r.pageCount, measurements: r.measurements };
    }
    case "print": {
      const r = await renderPdf(rdoc, inputs.data, "print", { ...common, cropMarks: !!job.options.cropMarks });
      return { bytes: await setPrintBoxes(r.pdf, bleedFor(doc.format, "print")), pageCount: r.pageCount, measurements: r.measurements };
    }
    case "png": {
      const pages = await renderPng(rdoc, inputs.data, pageRange(job.options.pages), pngScale(job.options.dpi), common);
      const width = String(Math.max(...pages.map((p) => p.n), 1)).length;
      const zip = zipStore(pages.map((p) => ({ name: `page-${String(p.n).padStart(Math.max(2, width), "0")}.png`, data: p.png })));
      return { bytes: zip, pageCount: pages.length, measurements: null };
    }
    case "thumbnail": {
      const page = (job.options.pageId ? doc.pages.find((p) => p.id === job.options.pageId) : null) ?? doc.pages.find((p) => !("hidden" in p && p.hidden)) ?? doc.pages[0];
      const one = { ...doc, pages: page ? [page] : [] } as unknown as RenderDoc;
      const pages = await renderPng(one, inputs.data, [1], 0.5, common);
      if (!pages.length) throw new DsError("DS_DOC_INVALID", { reason: "no page to draw" });
      return { bytes: pages[0].png, pageCount: 1, measurements: null };
    }
  }
}

async function nextVersionN(docId: number): Promise<number> {
  const [r]: Row[] = await AppDataSource.query(`SELECT COALESCE(MAX(n), 0) + 1 AS n FROM report_doc_version WHERE doc_id = $1`, [docId]);
  return Number(r.n);
}

/** A final's version: the doc, the data snapshot, the hashes and the PDF (immutable; RS-5 §4). */
async function insertFinalVersion(job: JobRow, doc: ReportDoc, snapshot: unknown, dataHash: string, file: { key: string; sha256: string; pageCount: number | null }): Promise<{ id: number; n: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [r]: Row[] = await AppDataSource.query(
        `INSERT INTO report_doc_version (doc_id, n, kind, rev, doc, data_snapshot, data_hash, design_version, renderer_hash, pdf_r2_key, pdf_sha256, page_count, note, created_by)
         SELECT $1, COALESCE(MAX(n), 0) + 1, 'final', $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12 FROM report_doc_version WHERE doc_id = $1 RETURNING id, n`,
        [job.docId, job.rev, JSON.stringify(doc), JSON.stringify(snapshot), dataHash, doc.design.templateVersion, RENDER_HASH, file.key, file.sha256, file.pageCount, job.note, job.requestedBy],
      );
      return { id: Number(r.id), n: Number(r.n) };
    } catch (err) {
      if ((err as { code?: string }).code !== "23505" || attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

async function notifyReady(job: JobRow, versionN: number | null): Promise<void> {
  if (!job.requestedBy) return;
  const what = job.kind === "final" ? `Final v${versionN}` : job.kind === "png" ? "PNG pages" : job.kind === "print" ? "Print PDF" : job.kind === "thumbnail" ? null : "PDF proof";
  if (!what) return;
  try {
    const [d]: Row[] = await AppDataSource.query(`SELECT title FROM report_doc WHERE id = $1`, [job.docId]);
    await createNotification(job.requestedBy, "report_ready", `${what} is ready`, `${what} of "${String(d?.title ?? "your design").slice(0, 120)}" is ready to download.`, `/studio/${job.docId}/preview`, { docId: job.docId, jobId: job.id } as never);
  } catch (err) {
    console.warn(`[studio] job ${job.id}: notification not sent:`, (err as Error)?.message);
  }
}

async function claim(jobId: number): Promise<{ job: JobRow; doc: unknown } | null> {
  const res = await AppDataSource.query(
    `UPDATE report_job SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'queued' RETURNING ${JOB_COLS}, doc`,
    [jobId],
  );
  const rows: Row[] = Array.isArray(res[0]) ? res[0] : res;
  if (!rows.length) return null;
  return { job: toJobRow(rows[0]), doc: rows[0].doc };
}

/** Runs one attempt of a job. Returns the final state, or 'requeue' when it should be tried again. */
export async function processJob(jobId: number): Promise<"done" | "failed" | "requeue" | "skipped"> {
  const claimed = await claim(jobId);
  if (!claimed) return "skipped";
  const { job } = claimed;
  let b: Browser | null = null;
  try {
    const out = await withTimeout(
      async () => {
        const parsed = ReportDocSchema.safeParse(claimed.doc);
        if (!parsed.success) throw new DsError("DS_DOC_INVALID");
        const doc = parsed.data;
        const caller = await workerCaller(job);
        const inputs = await renderInputs(caller, doc, { docId: job.docId });
        b = await sharedBrowser();
        const output = await renderOutput(job, doc, inputs, b);
        return { doc, inputs, output };
      },
      JOB_TIMEOUT_MS(),
      () => void closeBrowser(),
    );
    const s = JOB_SUFFIX[job.kind];
    const sha256 = createHash("sha256").update(out.output.bytes).digest("hex");
    let version: { id: number; n: number } | null = null;
    let key: string;
    if (job.kind === "final") {
      key = outputKey(job.companyId, job.docId, await nextVersionN(job.docId), job.kind, s.ext);
      await putOutput(key, out.output.bytes, s.mime);
      const snapshot = { values: out.inputs.resolved.values, tokens: out.inputs.resolved.tokens, unavailable: out.inputs.resolved.unavailable, dataHash: out.inputs.resolved.dataHash, flow: out.inputs.resolved.flow ?? {}, scope3: out.inputs.resolved.scope3 ?? {} };
      version = await insertFinalVersion(job, out.doc, snapshot, out.inputs.resolved.dataHash, { key, sha256, pageCount: out.output.pageCount });
    } else {
      key = outputKey(job.companyId, job.docId, `j${job.id}`, job.kind, s.ext);
      await putOutput(key, out.output.bytes, s.mime);
    }
    await AppDataSource.query(
      `UPDATE report_job SET status = 'done', finished_at = now(), updated_at = now(), error_code = NULL, doc = NULL, version_id = $2, file_key = $3, content_type = $4, bytes = $5, sha256 = $6, page_count = $7, measurements = $8::jsonb,
              proof_expires_at = ${job.kind === "final" ? "NULL" : `now() + interval '${OUTPUT_KEEP_DAYS} days'`}
        WHERE id = $1`,
      [job.id, version?.id ?? null, key, s.mime, out.output.bytes.length, sha256, out.output.pageCount, out.output.measurements ? JSON.stringify(out.output.measurements) : null],
    );
    await notifyReady(job, version?.n ?? null);
    return "done";
  } catch (err) {
    const reason = failureReason(err);
    console.error(`[studio] render job ${job.id} (${job.kind}) attempt ${job.attempts} failed: ${reason}`, (err as Error)?.message);
    if (retryable(reason) && job.attempts < JOB_MAX_ATTEMPTS) {
      await AppDataSource.query(`UPDATE report_job SET status = 'queued', error_code = $2, updated_at = now() WHERE id = $1`, [job.id, reason]);
      return "requeue";
    }
    // DS-12: a final refused by its layout checks keeps the measurements, so POST /checks can show them.
    const measured = reason === "checks" ? ((err as DsError).details as { measurements?: unknown } | undefined)?.measurements : undefined;
    await AppDataSource.query(`UPDATE report_job SET status = 'failed', error_code = $2, finished_at = now(), updated_at = now(), doc = NULL, measurements = COALESCE($3::jsonb, measurements) WHERE id = $1`, [job.id, reason, measured ? JSON.stringify(measured) : null]);
    return "failed";
  } finally {
    if (b) releaseBrowserSoon();
  }
}

/**
 * Startup sweep: a job left `running` by a stopped process is queued again
 * (or failed once out of attempts); `queued` jobs are handed back to `dispatch`.
 */
export async function recoverJobs(dispatch: (jobId: number) => Promise<unknown>): Promise<number> {
  const stale = new Date(Date.now() - 2 * JOB_TIMEOUT_MS());
  await AppDataSource.query(
    `UPDATE report_job SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END, error_code = 'timeout', finished_at = CASE WHEN attempts >= $2 THEN now() ELSE NULL END, updated_at = now()
      WHERE status = 'running' AND started_at < $1`,
    [stale, JOB_MAX_ATTEMPTS],
  );
  const rows: Row[] = await AppDataSource.query(`SELECT id FROM report_job WHERE status = 'queued' ORDER BY created_at, id LIMIT 500`);
  for (const r of rows) await dispatch(Number(r.id));
  return rows.length;
}
