/**
 * DS-11 · request and response shapes for preview, render jobs, versions and
 * view links (01-contracts §4 rows "preview.html", "jobs", "versions",
 * "shares", "/s/:token"; §7 render jobs). The enums (JobKind, JobStatus,
 * RenderMode, VersionKind) stay in enums.ts; error codes in errors.ts.
 */
import { z } from "zod";
import { JobKindSchema, type JobKind, type JobStatus, type VersionKind } from "./enums";
import type { DsErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** GET /docs/:id/preview.html: `present` has no job; `print` shows the bleed and crop marks. */
export const PREVIEW_MODES = ["sheet", "paged", "present", "print"] as const;
export const PreviewQuerySchema = z
  .object({
    mode: z.enum(PREVIEW_MODES).default("paged"),
    pageId: z.string().min(1).max(120).optional(),
    rev: z.coerce.number().int().min(1).optional(),
    cropMarks: z.enum(["0", "1"]).optional(),
    company_id: z.string().optional(),
  })
  .strict();
export type PreviewQuery = z.infer<typeof PreviewQuerySchema>;

// ---------------------------------------------------------------------------
// Jobs (§7)
// ---------------------------------------------------------------------------

/** PNG resolution: 144 dpi (2×, screen) or 300 dpi (print). */
export const PNG_DPIS = [144, 300] as const;
export const JOB_PAGES_MAX = 500;

export const JobOptionsSchema = z
  .object({
    /** print: crop marks around the trim box (bleed is always 3 mm on print formats, D12). */
    cropMarks: z.boolean().optional(),
    /** print: kept for the FE shape; a print PDF always bleeds on print formats. */
    bleed: z.boolean().optional(),
    /** png: a 1-based inclusive page range of the paginated document. */
    pages: z
      .tuple([z.number().int().min(1).max(JOB_PAGES_MAX), z.number().int().min(1).max(JOB_PAGES_MAX)])
      .refine(([a, b]) => a <= b, "The first page must come before the last")
      .optional(),
    dpi: z.union([z.literal(144), z.literal(300)]).optional(),
    /** thumbnail: the free-form page to draw (default the first page). */
    pageId: z.string().min(1).max(120).optional(),
  })
  .strict();
export type JobOptions = z.infer<typeof JobOptionsSchema>;

export const CreateJobBodySchema = z
  .object({
    kind: JobKindSchema,
    rev: z.number().int().min(1),
    options: JobOptionsSchema.optional(),
    acknowledgedWarnings: z.array(z.string().max(80)).max(200).optional(),
    /** final: required when a final already exists (RS R10). */
    note: z.string().trim().max(2000).optional(),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export type CreateJobBody = z.infer<typeof CreateJobBodySchema>;

/** POST /docs/:id/jobs and GET /jobs/:id. The storage key is never part of it. */
export interface ReportJob {
  id: number;
  docId: number;
  versionId: number | null;
  /** n of the final version the job made. */
  versionN: number | null;
  kind: JobKind;
  status: JobStatus;
  errorCode: DsErrorCode | null;
  /** DS_JOB_FAILED details.reason: timeout | font | chromium | measure | storage | data. */
  errorReason: string | null;
  requestedBy: number | null;
  rev: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** API path of the file once done (GET with the session), else null. */
  downloadUrl: string | null;
  fileName: string | null;
  bytes: number | null;
  pageCount: number | null;
  expiresAt: string | null;
  options?: JobOptions;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export const CreateVersionBodySchema = z
  .object({
    note: z.string().trim().min(1).max(2000),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export const RestoreVersionBodySchema = z
  .object({
    /** The draft's current rev (optimistic, like PATCH). */
    rev: z.number().int().min(1),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export const VersionsQuerySchema = z
  .object({
    kind: z.enum(["snapshot", "review", "final", "autosave"]).optional(),
    company_id: z.string().optional(),
  })
  .strict();

export interface ReportVersion {
  id: number;
  n: number;
  kind: VersionKind;
  rev: number | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  pageCount: number | null;
  /** API path of the stored PDF (finals), else null. */
  pdfUrl: string | null;
  pdfSha256: string | null;
  dataHash: string | null;
  rendererHash: string | null;
  /** A final with a newer final after it (RS R10). */
  superseded: boolean;
}

// ---------------------------------------------------------------------------
// View links (D15)
// ---------------------------------------------------------------------------

export const SHARE_DAYS_DEFAULT = 14;
export const SHARE_DAYS_MAX = 90;

export const CreateShareBodySchema = z
  .object({
    /** A version with a stored PDF (a final). */
    versionId: z.number().int().positive().optional(),
    /** Or a finished proof job (its PDF expires after 7 days, and so does the link). */
    jobId: z.number().int().positive().optional(),
    expiresInDays: z.number().int().min(1).max(SHARE_DAYS_MAX).default(SHARE_DAYS_DEFAULT),
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict()
  .refine((b) => (b.versionId === undefined) !== (b.jobId === undefined), { message: "Pick a final version or a proof", path: ["versionId"] });
export type CreateShareBody = z.infer<typeof CreateShareBodySchema>;

/** POST /docs/:id/shares returns `url` once (the token is never stored); GET lists without it. */
export interface ReportShare {
  id: number;
  docId: number;
  versionId: number | null;
  versionN: number | null;
  jobId: number | null;
  /** "Final v2" or "Proof 21 Oct". */
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  views: number;
  lastViewedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** active | expired | revoked */
  state: "active" | "expired" | "revoked";
  url?: string;
}

/** GET /s/:token/meta (public): what the viewer shows; never live data. */
export interface PublicShareMeta {
  title: string;
  company: string;
  logoUrl: string | null;
  label: string;
  expiresAt: string;
  pageCount: number | null;
  fileUrl: string;
}
