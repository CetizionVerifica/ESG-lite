/**
 * DS-13 · approval (D14, DS-13 §3).
 *
 *   GET    /docs/:id/approvals        R   ApprovalsResponse (newest first; `current`, `stale`, `requireReview`)
 *   POST   /docs/:id/approvals        R   {reviewerId, dueAt?, note?, rev} → 201 ReportApproval
 *   POST   /approvals/:id/decide      the named reviewer (a Manager) or a Superadmin: {decision, note?}
 *   DELETE /approvals/:id             the requester (or a Superadmin) withdraws an undecided request
 *
 * Rules:
 *   - the reviewer is a Manager who can open the design (docPeople), never the requester;
 *   - a new request withdraws the design's undecided one (state `none`): one open request at a time;
 *   - a request is tied to the rev the requester saw; approving ties it to the rev the reviewer
 *     approved (the design now). An edit after that makes the approval "an earlier version"
 *     (`stale`), and with `company.report_require_review` on a final needs a fresh one;
 *   - "Request changes" needs a note. Requester and reviewer are notified (in-app and email).
 *
 * The final gate (approvalFinalGate) wraps the gate already registered (DS-12's checks), so a
 * final answers DS_APPROVAL_PENDING before the checks run when review is required.
 */
import { AppDataSource } from "../../config/data-source";
import { DecideApprovalBodySchema, DsError, RequestApprovalBodySchema, type ApprovalsResponse, type ApprovalState, type ReportApproval } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import type { FinalGate } from "../jobs/gate";
import { docSites, loadDocRow } from "../docs/store";
import { sendNotices, shorten } from "./notify";
import { docPeople, namesFor, personFor } from "./people";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

const ACOLS = `id, doc_id, rev, requested_by, reviewer_id, due_at, state, note, decision_note, decided_at, created_at`;

async function toApprovals(rows: Row[]): Promise<ReportApproval[]> {
  const names = await namesFor(rows.flatMap((r) => [Number(r.requested_by), Number(r.reviewer_id)]));
  return rows.map((r) => ({
    id: Number(r.id),
    docId: Number(r.doc_id),
    rev: Number(r.rev),
    requestedBy: Number(r.requested_by),
    requestedByName: names.get(Number(r.requested_by)) ?? "Someone",
    reviewerId: Number(r.reviewer_id),
    reviewerName: names.get(Number(r.reviewer_id)) ?? "Someone",
    dueAt: dateOnly(r.due_at),
    state: r.state as ApprovalState,
    note: r.note ?? null,
    decisionNote: r.decision_note ?? null,
    decidedAt: iso(r.decided_at),
    createdAt: iso(r.created_at) as string,
  }));
}

export const requireReviewOn = async (companyId: number): Promise<boolean> => {
  const [r]: Row[] = await AppDataSource.query(`SELECT report_require_review AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return r?.on === true;
};

/** Pure: the approval a final at `rev` would rely on, and whether it's for an earlier version. */
export function approvalStatus(current: Pick<ReportApproval, "state" | "rev"> | null, rev: number): { stale: boolean; approvedForRev: boolean } {
  const approved = current?.state === "approved";
  return { stale: approved && current!.rev !== rev, approvedForRev: approved && current!.rev === rev };
}

async function docApprovals(docId: number): Promise<ReportApproval[]> {
  const rows: Row[] = await AppDataSource.query(`SELECT ${ACOLS} FROM report_approval WHERE doc_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [docId]);
  return toApprovals(rows);
}

export async function listApprovals(caller: StudioCaller, docId: number): Promise<ApprovalsResponse> {
  const doc = await loadDocRow(caller, docId);
  const approvals = await docApprovals(doc.id);
  const current = approvals.find((a) => a.state !== "none") ?? null;
  return { approvals, current, stale: approvalStatus(current, doc.rev).stale, rev: doc.rev, requireReview: await requireReviewOn(caller.companyId) };
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function requestApproval(caller: StudioCaller, docId: number, rawBody: unknown): Promise<ReportApproval> {
  const doc = await loadDocRow(caller, docId);
  const b = parse(RequestApprovalBodySchema, rawBody ?? {});
  if (b.rev !== doc.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: doc.rev });
  if (doc.status === "final") throw new DsError("DS_FINAL_IMMUTABLE");
  if (b.reviewerId === caller.userId) throw new DsError("DS_VALIDATION", { issues: [{ path: "reviewerId", message: "Ask someone else to approve your design" }] });
  const reviewer = personFor(await docPeople(caller.companyId, docSites(doc.draft)), b.reviewerId);
  if (!reviewer || !reviewer.canApprove) throw new DsError("DS_VALIDATION", { issues: [{ path: "reviewerId", message: "The reviewer must be a Manager who can open this design" }] });
  const id = await AppDataSource.transaction(async (m) => {
    // One open request at a time: a new one withdraws the undecided one.
    await m.query(`UPDATE report_approval SET state = 'none', decided_at = now(), decided_by = $2, updated_at = now() WHERE doc_id = $1 AND state = 'requested'`, [doc.id, caller.userId]);
    const [r]: Row[] = await m.query(
      `INSERT INTO report_approval (company_id, doc_id, rev, requested_by, reviewer_id, due_at, state, note) VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7) RETURNING id`,
      [caller.companyId, doc.id, doc.rev, caller.userId, reviewer.id, b.dueAt ?? null, b.note?.trim() || null],
    );
    return Number(r.id);
  });
  const by = (await namesFor([caller.userId])).get(caller.userId) ?? "Someone";
  await sendNotices([
    {
      userId: reviewer.id,
      type: "studio_approval_requested",
      title: `${by} asked you to approve "${shorten(doc.title, 80)}"`,
      message: [b.dueAt ? `Due ${fmtDate(b.dueAt)}.` : "", b.note ? shorten(b.note) : ""].filter(Boolean).join(" ") || "Open the design to approve it or request changes.",
      link: `/studio/${doc.id}?approval=${id}`,
      meta: { docId: doc.id, approvalId: id },
    },
  ]);
  const [row]: Row[] = await AppDataSource.query(`SELECT ${ACOLS} FROM report_approval WHERE id = $1`, [id]);
  return (await toApprovals([row]))[0];
}

async function loadApproval(caller: StudioCaller, id: number) {
  const [row]: Row[] = await AppDataSource.query(`SELECT ${ACOLS} FROM report_approval WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
  if (!row) throw new DsError("DS_DOC_NOT_FOUND");
  const doc = await loadDocRow(caller, Number(row.doc_id));
  return { row, doc };
}

export async function decideApproval(caller: StudioCaller, id: number, rawBody: unknown): Promise<ReportApproval> {
  const { row, doc } = await loadApproval(caller, id);
  const b = parse(DecideApprovalBodySchema, rawBody ?? {});
  const isSuperadmin = caller.role === "Superadmin";
  if (caller.roleClass !== "M" || (!isSuperadmin && Number(row.reviewer_id) !== caller.userId)) throw new DsError("DS_ROLE", { reason: "Only the reviewer can decide" });
  if (row.state !== "requested") throw new DsError("DS_VALIDATION", { issues: [{ path: "decision", message: "This request was already decided or withdrawn" }] });
  const state: ApprovalState = b.decision === "approve" ? "approved" : "changes_requested";
  // Approving ties the approval to the rev the reviewer approved: the design as it is now.
  await AppDataSource.query(
    `UPDATE report_approval SET state = $1, decision_note = $2, decided_at = now(), decided_by = $3, rev = COALESCE($4, rev), updated_at = now() WHERE id = $5`,
    [state, b.note?.trim() || null, caller.userId, state === "approved" ? doc.rev : null, id],
  );
  const by = (await namesFor([caller.userId])).get(caller.userId) ?? "Someone";
  if (Number(row.requested_by) !== caller.userId) {
    await sendNotices([
      {
        userId: Number(row.requested_by),
        type: "studio_approval_decided",
        title: state === "approved" ? `${by} approved "${shorten(doc.title, 80)}"` : `${by} requested changes to "${shorten(doc.title, 80)}"`,
        message: b.note ? shorten(b.note) : state === "approved" ? "You can generate the final." : "Open the design to see what to change.",
        link: `/studio/${doc.id}?approval=${id}`,
        meta: { docId: doc.id, approvalId: id, state },
      },
    ]);
  }
  const [fresh]: Row[] = await AppDataSource.query(`SELECT ${ACOLS} FROM report_approval WHERE id = $1`, [id]);
  return (await toApprovals([fresh]))[0];
}

export async function withdrawApproval(caller: StudioCaller, id: number): Promise<void> {
  const { row } = await loadApproval(caller, id);
  if (Number(row.requested_by) !== caller.userId && caller.role !== "Superadmin") throw new DsError("DS_ROLE", { reason: "Only the requester can withdraw a request" });
  if (row.state !== "requested") throw new DsError("DS_VALIDATION", { issues: [{ path: "id", message: "Only an undecided request can be withdrawn" }] });
  await AppDataSource.query(`UPDATE report_approval SET state = 'none', decided_at = now(), decided_by = $1, updated_at = now() WHERE id = $2`, [caller.userId, id]);
}

/**
 * The approval rule for finals (D14): with `report_require_review` on, the newest request must be
 * approved for the rev being finalised. Otherwise 409 DS_APPROVAL_PENDING with
 * `details.reason`: `none` (never asked), `requested` (waiting), `changes_requested`, `stale`
 * (approved an earlier version).
 */
export async function assertApproved(companyId: number, docId: number, rev: number): Promise<void> {
  if (!(await requireReviewOn(companyId))) return;
  const [cur]: Row[] = await AppDataSource.query(`SELECT id, state, rev, reviewer_id FROM report_approval WHERE doc_id = $1 AND state <> 'none' ORDER BY created_at DESC, id DESC LIMIT 1`, [docId]);
  const current = cur ? { state: cur.state as ApprovalState, rev: Number(cur.rev) } : null;
  if (approvalStatus(current, rev).approvedForRev) return;
  const reason = !current ? "none" : current.state === "approved" ? "stale" : current.state;
  throw new DsError("DS_APPROVAL_PENDING", { reason, approvalId: cur ? Number(cur.id) : null });
}

/** Wraps the registered final gate: approval first (no data to load), then `next` (the checks). */
export const approvalFinalGate =
  (next: FinalGate): FinalGate =>
  async (input) => {
    await assertApproved(input.caller.companyId, input.docId, input.rev);
    await next(input);
  };
