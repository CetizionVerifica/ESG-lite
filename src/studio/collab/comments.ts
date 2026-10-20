/**
 * DS-13 · comments, @mentions and tasks (RS-10 §4 + DS-13 §1–2, D13).
 *
 *   GET    /docs/:id/comments[?resolved=1][&tasks=mine|open]   threads, oldest first
 *   POST   /docs/:id/comments      {pageId, elementId?, x?, y?, parentId?, body, mentions?, taskAssigneeId?}
 *   PATCH  /comments/:id           {body?} (author) · {resolved} (anyone on the design)
 *   DELETE /comments/:id           the author, or a Manager
 *   POST   /comments/:id/task      {assigneeId | null}   assign (notifies) or clear
 *   PATCH  /comments/:id/task      {done}                tick or untick
 *
 * Every route loads the design first (tenant, kind, sites: DS-5 loadDocRow),
 * so another company's comment id answers 404. Mentions and assignees must be
 * in docPeople(): anyone else is dropped from `mentions` (never notified) and
 * refused as an assignee (DS_VALIDATION). A final design can still be
 * commented on (comments aren't part of the doc).
 */
import { AppDataSource } from "../../config/data-source";
import {
  AssignTaskBodySchema,
  CommentsQuerySchema,
  CreateCommentBodySchema,
  DsError,
  PatchCommentBodySchema,
  TaskDoneBodySchema,
  type ReportComment,
  type StudioPerson,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { docSites, loadDocRow, type DocRow } from "../docs/store";
import { sendNotices, shorten, type StudioNotice } from "./notify";
import { docPeople, namesFor, personFor, publicPerson } from "./people";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

const CCOLS = `id, doc_id, page_id, element_id, x, y, parent_id, body, author_id, mentions, task_assignee_id, task_done_at, resolved_by, resolved_at, created_at, updated_at`;

async function toComments(rows: Row[]): Promise<ReportComment[]> {
  const ids: number[] = [];
  for (const r of rows) {
    ids.push(Number(r.author_id));
    if (r.task_assignee_id) ids.push(Number(r.task_assignee_id));
    if (r.resolved_by) ids.push(Number(r.resolved_by));
    for (const m of r.mentions ?? []) ids.push(Number(m));
  }
  const names = await namesFor(ids);
  return rows.map((r) => {
    const mentions = (r.mentions ?? []).map(Number);
    return {
      id: Number(r.id),
      docId: Number(r.doc_id),
      pageId: String(r.page_id),
      elementId: r.element_id ?? null,
      x: r.x === null || r.x === undefined ? null : Number(r.x),
      y: r.y === null || r.y === undefined ? null : Number(r.y),
      parentId: r.parent_id === null ? null : Number(r.parent_id),
      body: String(r.body),
      authorId: Number(r.author_id),
      authorName: names.get(Number(r.author_id)) ?? "Someone",
      mentions,
      mentionNames: mentions.map((m: number) => names.get(m) ?? "Someone"),
      taskAssigneeId: r.task_assignee_id === null ? null : Number(r.task_assignee_id),
      taskAssigneeName: r.task_assignee_id === null ? null : names.get(Number(r.task_assignee_id)) ?? "Someone",
      taskDoneAt: iso(r.task_done_at),
      resolvedAt: iso(r.resolved_at),
      resolvedByName: r.resolved_by ? names.get(Number(r.resolved_by)) ?? null : null,
      createdAt: iso(r.created_at) as string,
      updatedAt: iso(r.updated_at) as string,
    };
  });
}

/** Where a notice opens: the page, the element and the thread. */
export const commentLink = (docId: number, c: { page_id: string; element_id: string | null; id: number }) => {
  const q = new URLSearchParams({ page: c.page_id, ...(c.element_id ? { el: c.element_id } : {}), comment: String(c.id) });
  return `/studio/${docId}?${q.toString()}`;
};

export async function people(caller: StudioCaller, docId: number): Promise<StudioPerson[]> {
  const doc = await loadDocRow(caller, docId);
  return (await docPeople(caller.companyId, docSites(doc.draft))).map(publicPerson);
}

export async function listComments(caller: StudioCaller, docId: number, query: unknown): Promise<ReportComment[]> {
  const doc = await loadDocRow(caller, docId);
  const q = parse(CommentsQuerySchema, query ?? {});
  const params: unknown[] = [doc.id, caller.companyId];
  const where = [`doc_id = $1`, `company_id = $2`, `deleted_at IS NULL`];
  if (q.resolved !== "1") {
    // Resolving a thread's root hides the whole thread.
    where.push(`resolved_at IS NULL AND (parent_id IS NULL OR parent_id NOT IN (SELECT id FROM report_comment WHERE doc_id = $1 AND resolved_at IS NOT NULL))`);
  }
  if (q.tasks === "mine") where.push(`task_assignee_id = $${params.push(caller.userId)} AND task_done_at IS NULL`);
  if (q.tasks === "open") where.push(`task_assignee_id IS NOT NULL AND task_done_at IS NULL`);
  const rows: Row[] = await AppDataSource.query(`SELECT ${CCOLS} FROM report_comment WHERE ${where.join(" AND ")} ORDER BY created_at, id LIMIT 2000`, params);
  return toComments(rows);
}

/** Open tasks of a design (the OPEN_TASK info check). */
export async function openTasks(docId: number): Promise<Array<{ id: number; pageId: string; elementId: string | null; body: string; assignee: string }>> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT c.id, c.page_id, c.element_id, c.body, u.name, u.last_name FROM report_comment c LEFT JOIN "user" u ON u.user_id = c.task_assignee_id
      WHERE c.doc_id = $1 AND c.deleted_at IS NULL AND c.task_assignee_id IS NOT NULL AND c.task_done_at IS NULL AND c.resolved_at IS NULL ORDER BY c.id`,
    [docId],
  );
  return rows.map((r) => ({ id: Number(r.id), pageId: r.page_id, elementId: r.element_id ?? null, body: String(r.body), assignee: `${r.name ?? ""} ${r.last_name ?? ""}`.trim() || "someone" }));
}

async function loadComment(caller: StudioCaller, id: number): Promise<{ row: Row; doc: DocRow }> {
  const [row]: Row[] = await AppDataSource.query(`SELECT ${CCOLS}, company_id FROM report_comment WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [id, caller.companyId]);
  if (!row) throw new DsError("DS_DOC_NOT_FOUND");
  // The design's own checks (kind, sites) decide whether the caller can see its comments.
  const doc = await loadDocRow(caller, Number(row.doc_id));
  return { row, doc };
}

async function one(id: number): Promise<ReportComment> {
  const rows: Row[] = await AppDataSource.query(`SELECT ${CCOLS} FROM report_comment WHERE id = $1`, [id]);
  return (await toComments(rows))[0];
}

const pageExists = (doc: DocRow, pageId: string, elementId: string | null | undefined) => {
  const page = (doc.draft.pages ?? []).find((p: Row) => p.id === pageId);
  if (!page) return false;
  if (!elementId) return true;
  return Array.isArray(page.elements) && page.elements.some((e: Row) => e.id === elementId);
};

const who = (caller: StudioCaller, names: Map<number, string>) => names.get(caller.userId) ?? "Someone";

export async function createComment(caller: StudioCaller, docId: number, rawBody: unknown): Promise<ReportComment> {
  const doc = await loadDocRow(caller, docId);
  const b = parse(CreateCommentBodySchema, rawBody ?? {});
  let pageId = b.pageId;
  let elementId = b.elementId ?? null;
  let parentId: number | null = null;
  if (b.parentId) {
    const [parent]: Row[] = await AppDataSource.query(`SELECT id, parent_id, page_id, element_id FROM report_comment WHERE id = $1 AND doc_id = $2 AND company_id = $3 AND deleted_at IS NULL`, [b.parentId, doc.id, caller.companyId]);
    if (!parent) throw new DsError("DS_DOC_NOT_FOUND");
    // One level of replies: a reply to a reply joins the thread's root.
    parentId = parent.parent_id ? Number(parent.parent_id) : Number(parent.id);
    pageId = parent.page_id;
    elementId = parent.element_id ?? null;
  } else if (!pageExists(doc, pageId, elementId)) {
    throw new DsError("DS_VALIDATION", { issues: [{ path: elementId ? "elementId" : "pageId", message: "That page or element isn't in this design" }] });
  }
  const audience = await docPeople(caller.companyId, docSites(doc.draft));
  const mentions = [...new Set(b.mentions ?? [])].filter((id) => personFor(audience, id) && id !== caller.userId);
  let assignee: number | null = null;
  if (b.taskAssigneeId) {
    if (!personFor(audience, b.taskAssigneeId)) throw new DsError("DS_VALIDATION", { issues: [{ path: "taskAssigneeId", message: "Assign the task to someone who can open this design" }] });
    assignee = b.taskAssigneeId;
  }
  const [r]: Row[] = await AppDataSource.query(
    `INSERT INTO report_comment (company_id, doc_id, page_id, element_id, x, y, parent_id, body, author_id, mentions, task_assignee_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::int[], $11) RETURNING ${CCOLS}`,
    [caller.companyId, doc.id, pageId, elementId, parentId ? null : b.x ?? null, parentId ? null : b.y ?? null, parentId, b.body, caller.userId, mentions, assignee],
  );
  const names = await namesFor([caller.userId]);
  const link = commentLink(doc.id, { id: Number(r.id), page_id: String(r.page_id), element_id: r.element_id ?? null });
  const notices: StudioNotice[] = mentions
    .filter((m) => m !== assignee)
    .map((m) => ({
      userId: m,
      type: "studio_mention" as const,
      title: `${who(caller, names)} mentioned you in "${shorten(doc.title, 80)}"`,
      message: shorten(b.body),
      link,
      meta: { docId: doc.id, commentId: Number(r.id), pageId, elementId },
    }));
  if (assignee && assignee !== caller.userId) notices.push(taskNotice(doc, Number(r.id), r, assignee, who(caller, names), b.body));
  await sendNotices(notices);
  return one(Number(r.id));
}

function taskNotice(doc: DocRow, commentId: number, r: Row, assignee: number, by: string, body: string): StudioNotice {
  return {
    userId: assignee,
    type: "studio_task",
    title: `${by} assigned you a task in "${shorten(doc.title, 80)}"`,
    message: shorten(body),
    link: commentLink(doc.id, { id: commentId, page_id: r.page_id, element_id: r.element_id ?? null }),
    meta: { docId: doc.id, commentId, pageId: r.page_id, elementId: r.element_id ?? null },
  };
}

export async function patchComment(caller: StudioCaller, id: number, rawBody: unknown): Promise<ReportComment> {
  const { row } = await loadComment(caller, id);
  const b = parse(PatchCommentBodySchema, rawBody ?? {});
  if (b.body !== undefined) {
    if (Number(row.author_id) !== caller.userId) throw new DsError("DS_ROLE", { reason: "Only the author can edit a comment" });
    await AppDataSource.query(`UPDATE report_comment SET body = $1, updated_at = now() WHERE id = $2`, [b.body, id]);
  }
  if (b.resolved !== undefined) {
    await AppDataSource.query(
      b.resolved ? `UPDATE report_comment SET resolved_at = now(), resolved_by = $1, updated_at = now() WHERE id = $2` : `UPDATE report_comment SET resolved_at = NULL, resolved_by = NULL, updated_at = now() WHERE id = $2 AND $1::int IS NOT NULL`,
      [caller.userId, id],
    );
  }
  return one(id);
}

export async function deleteComment(caller: StudioCaller, id: number): Promise<void> {
  const { row } = await loadComment(caller, id);
  if (Number(row.author_id) !== caller.userId && caller.roleClass !== "M") throw new DsError("DS_ROLE", { reason: "Only the author or a Manager can delete a comment" });
  await AppDataSource.query(`UPDATE report_comment SET deleted_at = now() WHERE id = $1`, [id]);
}

export async function assignTask(caller: StudioCaller, id: number, rawBody: unknown): Promise<ReportComment> {
  const { row, doc } = await loadComment(caller, id);
  const b = parse(AssignTaskBodySchema, rawBody ?? {});
  if (b.assigneeId === null) {
    await AppDataSource.query(`UPDATE report_comment SET task_assignee_id = NULL, task_done_at = NULL, task_done_by = NULL, updated_at = now() WHERE id = $1`, [id]);
    return one(id);
  }
  const audience = await docPeople(caller.companyId, docSites(doc.draft));
  if (!personFor(audience, b.assigneeId)) throw new DsError("DS_VALIDATION", { issues: [{ path: "assigneeId", message: "Assign the task to someone who can open this design" }] });
  const changed = Number(row.task_assignee_id) !== b.assigneeId;
  await AppDataSource.query(`UPDATE report_comment SET task_assignee_id = $1, task_done_at = NULL, task_done_by = NULL, updated_at = now() WHERE id = $2`, [b.assigneeId, id]);
  if (changed && b.assigneeId !== caller.userId) {
    const names = await namesFor([caller.userId]);
    await sendNotices([taskNotice(doc, id, row, b.assigneeId, who(caller, names), String(row.body))]);
  }
  return one(id);
}

export async function setTaskDone(caller: StudioCaller, id: number, rawBody: unknown): Promise<ReportComment> {
  const { row } = await loadComment(caller, id);
  const b = parse(TaskDoneBodySchema, rawBody ?? {});
  if (!row.task_assignee_id) throw new DsError("DS_VALIDATION", { issues: [{ path: "done", message: "This comment isn't a task" }] });
  await AppDataSource.query(
    b.done ? `UPDATE report_comment SET task_done_at = now(), task_done_by = $1, updated_at = now() WHERE id = $2` : `UPDATE report_comment SET task_done_at = NULL, task_done_by = NULL, updated_at = now() WHERE id = $2 AND $1::int IS NOT NULL`,
    [caller.userId, id],
  );
  return one(id);
}
