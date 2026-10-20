/**
 * DS-13 · collaboration contracts (01-contracts §3 `report_comment`,
 * `report_approval`, `company.report_require_review`, `company.brand_controls`;
 * §4 comments, tasks, approvals, drift, templates from a doc). The FE mirror is
 * the "DS-13" block of ESG-lite_FE src/lib/studio/contracts.ts.
 *
 * Shapes added here beyond 01-contracts §4 (awaiting a DS-0 contracts follow-up):
 *   GET  /docs/:id/people            who may be @mentioned, assigned or asked to approve
 *   GET  /docs/:id/comments          RS `GET /docs/:id/comments` (+ `?resolved=1`)
 *   GET  /docs/:id/approvals         the doc's requests, newest first, and the current one
 *   GET  /review-settings · PUT      `report_require_review` (M) and `brand_controls` (Superadmin)
 *   DELETE /comments/:id             the author (or a Manager) removes a comment
 *   DELETE /templates/:id            archive a company template
 */
import { z } from "zod";
import type { ApprovalState } from "./enums";

const CompanyIdField = { company_id: z.union([z.number(), z.string()]).optional() };

export const COMMENT_BODY_MAX = 4000;
export const MENTIONS_MAX = 20;

// ---------------------------------------------------------------------------
// Comments, mentions, tasks
// ---------------------------------------------------------------------------

export const CreateCommentBodySchema = z
  .object({
    pageId: z.string().trim().min(1).max(120),
    elementId: z.string().trim().min(1).max(120).nullable().optional(),
    /** The pin on the page, in mm (C + click). */
    x: z.number().finite().min(-50).max(2000).nullable().optional(),
    y: z.number().finite().min(-50).max(2000).nullable().optional(),
    parentId: z.number().int().positive().nullable().optional(),
    body: z.string().trim().min(1, "Write a comment").max(COMMENT_BODY_MAX, `At most ${COMMENT_BODY_MAX} characters`),
    /** User ids picked from the @ autocomplete; ids without access to the design are dropped, never notified. */
    mentions: z.array(z.number().int().positive()).max(MENTIONS_MAX).optional(),
    /** "Assign as task" while writing: an assignee from the same list. */
    taskAssigneeId: z.number().int().positive().nullable().optional(),
    ...CompanyIdField,
  })
  .strict();
export type CreateCommentBody = z.infer<typeof CreateCommentBodySchema>;

export const PatchCommentBodySchema = z
  .object({
    body: z.string().trim().min(1).max(COMMENT_BODY_MAX).optional(),
    resolved: z.boolean().optional(),
    ...CompanyIdField,
  })
  .strict()
  .refine((b) => b.body !== undefined || b.resolved !== undefined, { message: "Send body or resolved" });

export const AssignTaskBodySchema = z.object({ assigneeId: z.number().int().positive().nullable(), ...CompanyIdField }).strict();
export const TaskDoneBodySchema = z.object({ done: z.boolean(), ...CompanyIdField }).strict();

export const CommentsQuerySchema = z
  .object({
    /** 1 = include resolved threads ("Show resolved"). */
    resolved: z.enum(["0", "1"]).optional(),
    /** `mine` = open tasks assigned to the caller ("My tasks"). */
    tasks: z.enum(["mine", "open"]).optional(),
    company_id: z.string().optional(),
  })
  .strict();

export interface ReportComment {
  id: number;
  docId: number;
  pageId: string;
  elementId: string | null;
  x: number | null;
  y: number | null;
  parentId: number | null;
  body: string;
  authorId: number;
  authorName: string;
  mentions: number[];
  /** Names of the mentioned people, same order as `mentions`. */
  mentionNames: string[];
  taskAssigneeId: number | null;
  taskAssigneeName: string | null;
  taskDoneAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Someone with studio access who can read every site of the design. */
export interface StudioPerson {
  id: number;
  name: string;
  role: "Manager" | "Admin";
  /** A Manager: may be asked to approve (D14). */
  canApprove: boolean;
}

// ---------------------------------------------------------------------------
// Approval (D14)
// ---------------------------------------------------------------------------

export const RequestApprovalBodySchema = z
  .object({
    reviewerId: z.number().int().positive(),
    /** YYYY-MM-DD. */
    dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    /** The rev the requester is looking at; a stale one is DS_VERSION_CONFLICT. */
    rev: z.number().int().min(0),
    ...CompanyIdField,
  })
  .strict();
export type RequestApprovalBody = z.infer<typeof RequestApprovalBodySchema>;

export const APPROVAL_DECISIONS = ["approve", "request_changes"] as const;
export const DecideApprovalBodySchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    note: z.string().trim().max(2000).nullable().optional(),
    ...CompanyIdField,
  })
  .strict()
  .refine((b) => b.decision !== "request_changes" || !!b.note?.trim(), { message: "Say what should change", path: ["note"] });

export interface ReportApproval {
  id: number;
  docId: number;
  /** The doc rev the request (then the approval) is tied to. */
  rev: number;
  requestedBy: number;
  requestedByName: string;
  reviewerId: number;
  reviewerName: string;
  dueAt: string | null;
  /** `none` = withdrawn (by the requester, or replaced by a newer request). */
  state: ApprovalState;
  note: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ApprovalsResponse {
  approvals: ReportApproval[];
  /** The newest request that wasn't withdrawn, or null. */
  current: ReportApproval | null;
  /** `current.state === 'approved'` and the design changed since (01-contracts D14: "Approved an earlier version"). */
  stale: boolean;
  /** The design's rev now. */
  rev: number;
  /** `company.report_require_review`: a final needs an approval for the current rev. */
  requireReview: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ReviewSettings {
  requireReview: boolean;
  brandControls: boolean;
  /** Manager or Superadmin. */
  canEditRequireReview: boolean;
  /** Superadmin only. */
  canEditBrandControls: boolean;
}
export const ReviewSettingsBodySchema = z
  .object({ requireReview: z.boolean().optional(), brandControls: z.boolean().optional(), ...CompanyIdField })
  .strict();

// ---------------------------------------------------------------------------
// Drift (RS-10 §5, both sources)
// ---------------------------------------------------------------------------

export interface DriftFigure {
  elementId: string;
  label: string;
  before: string | null;
  after: string;
}
export interface DriftItem {
  elementId: string;
  pageId: string;
  pageName: string;
  /** The first 160 characters of the typed text. */
  text: string;
  basedOnHash: string;
  /** RS shape: the page's figures, joined ("Scope 1: 1,200 → 1,260 tCO₂e"); before is null when it wasn't recorded. */
  before: string | null;
  after: string;
  figures: DriftFigure[];
}
export interface DriftResponse {
  /** The data hash now: "Mark as checked" stamps it on the element (`basedOnHash`). */
  dataHash: string;
  changed: DriftItem[];
}

// ---------------------------------------------------------------------------
// Save as template / layout (RS-10 §1)
// ---------------------------------------------------------------------------

export const TemplateFromDocBodySchema = z
  .object({
    docId: z.number().int().positive(),
    name: z.string().trim().min(1, "Name the template").max(200),
    description: z.string().trim().max(1000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    /** Elements locked in the design (`locked`) become locked for everyone using the template (`templateLocked`). Default true. */
    lockLocked: z.boolean().optional(),
    /** Re-save over a company template: a new version of it (the older one is archived). */
    replaceTemplateId: z.number().int().positive().optional(),
    ...CompanyIdField,
  })
  .strict();
export type TemplateFromDocBody = z.infer<typeof TemplateFromDocBodySchema>;

export const LayoutFromPageBodySchema = z
  .object({
    docId: z.number().int().positive(),
    pageId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1, "Name the layout").max(200),
    lockLocked: z.boolean().optional(),
    ...CompanyIdField,
  })
  .strict();
export type LayoutFromPageBody = z.infer<typeof LayoutFromPageBodySchema>;

/** Notification types DS-13 sends (in-app and by email; `notification_preferences.email_studio = false` mutes the email). */
export const STUDIO_NOTIFICATION_TYPES = ["studio_mention", "studio_task", "studio_approval_requested", "studio_approval_decided"] as const;
export type StudioNotificationType = (typeof STUDIO_NOTIFICATION_TYPES)[number];
