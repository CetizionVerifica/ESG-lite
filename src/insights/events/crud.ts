/**
 * IN-4 · Insights events (01-contracts §4–§5): dated labels that explain a
 * jump on the pathway and decoupling charts.
 *
 *   GET    /insights/events?from=&to=&sites=   events the caller can see: company-level ones and
 *                                              those of the scope's sites, by date
 *                                              → {events: [EventRef & {created_by, can_edit}]}
 *   POST   /insights/events {date, label, kind, site_id?}  → 201 {event}
 *   PATCH  /insights/events/:id {…any of them}            → {event}
 *   DELETE /insights/events/:id                            → {removed: id}
 *
 * Rules:
 *   - bodies by EventCreateSchema / EventPatchSchema → 400 IN_EVENT_INVALID (zod issues);
 *   - `date` within the company's data range ± 1 year (first emission date − 1 year …
 *     max(last emission date, today) + 1 year; no data: today ± 1 year) → IN_EVENT_INVALID;
 *   - `site_id` must be one of the caller's sites (else 404 IN_SITE_NOT_FOUND); company-level
 *     (null) only for a caller who reaches every site (a Manager of some sites → 403 IN_FORBIDDEN);
 *   - an event the caller can't see, or another company's, → 404 IN_EVENT_NOT_FOUND;
 *   - edit and delete: its creator, an Admin or the Superadmin (else 403 IN_FORBIDDEN);
 *   - every create, update and delete writes an audit_log row (`insight_event`).
 * Events move the data stamp (sources/stamp.ts reads insight_event.updated_at and the count).
 */
import { Router } from "express";
import { AppDataSource } from "../../config/data-source";
import type { EventRef } from "../contracts/panels";
import type { EventKind } from "../contracts/enums";
import { InError } from "../contracts/errors";
import { EventCreateSchema, EventPatchSchema, EventsQuerySchema } from "../contracts/schemas";
import { insightsScope, type InsightsCaller, type InsightsRequest } from "../guard";
import { handle, parse, routeId } from "../http";
import { resolveScope, type InsightsScope } from "../scope";

type Row = Record<string, any>;

export const IN_EVENT_AUDIT = "insight_event";
export const EVENT_RANGE_YEARS = 1;

const iso = (v: unknown): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};

export interface EventOut extends EventRef {
  created_by: number;
  can_edit: boolean;
}

const toRef = (r: Row): EventRef => ({ id: Number(r.id), date: iso(r.date), label: String(r.label), kind: r.kind as EventKind, site_id: r.site_id === null ? null : Number(r.site_id) });

const canEdit = (caller: Pick<InsightsCaller, "role" | "userId">, r: Row) => caller.role === "Admin" || caller.role === "Superadmin" || Number(r.created_by) === caller.userId;

const toOut = (caller: InsightsCaller, r: Row): EventOut => ({ ...toRef(r), created_by: Number(r.created_by), can_edit: canEdit(caller, r) });

/** Events of the scope's company between two ISO dates (inclusive): company-level ones and those on the scope's sites. */
export async function eventsInRange(scope: Pick<InsightsScope, "companyId" | "siteIds">, from: string | null, to: string | null): Promise<EventRef[]> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT id, date, label, kind, site_id, created_by FROM insight_event
      WHERE company_id = $1 AND (site_id IS NULL OR site_id = ANY($2::int[]))
        AND ($3::date IS NULL OR date >= $3::date) AND ($4::date IS NULL OR date <= $4::date)
      ORDER BY date, id`,
    [scope.companyId, scope.siteIds, from, to],
  );
  return rows.map(toRef);
}

/** The allowed date window for the company's events. */
export async function eventDateWindow(companyId: number, today = new Date().toISOString().slice(0, 10)): Promise<{ from: string; to: string }> {
  const [r]: Row[] = await AppDataSource.query(
    `SELECT to_char(MIN(e.date_of_reporting), 'YYYY-MM-DD') AS first, to_char(MAX(e.date_of_reporting), 'YYYY-MM-DD') AS last
       FROM emission e JOIN site s ON s.site_id = e.site_id WHERE s.company_id = $1 AND e.status::text <> 'draft'`,
    [companyId],
  );
  const first = r?.first && r.first < today ? r.first : today;
  const last = r?.last && r.last > today ? r.last : today;
  const shift = (d: string, years: number) => `${Number(d.slice(0, 4)) + years}${d.slice(4)}`;
  return { from: shift(first, -EVENT_RANGE_YEARS), to: shift(last, EVENT_RANGE_YEARS) };
}

const invalid = (path: string, message: string) => new InError("IN_EVENT_INVALID", { issues: [{ path, message }] });

/** The site rule for a write: one of the caller's sites, or company level for a caller of every site. */
const checkSite = (caller: InsightsCaller, siteId: number | null) => {
  if (siteId === null) {
    if (!caller.allSites) throw new InError("IN_FORBIDDEN", { rule: "company_level_needs_every_site" });
    return;
  }
  if (!caller.siteIds.includes(siteId)) throw new InError("IN_SITE_NOT_FOUND");
};

const checkDate = async (companyId: number, date: string) => {
  const w = await eventDateWindow(companyId);
  if (date < w.from || date > w.to) throw invalid("date", `date must be between ${w.from} and ${w.to}`);
};

const audit = (id: number, action: "create" | "update" | "delete", changed: Record<string, unknown>, userId: number) =>
  AppDataSource.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, NULL, $5)`, [
    IN_EVENT_AUDIT,
    id,
    action,
    JSON.stringify(changed),
    userId || null,
  ]);

/** The event, when the caller can see it (company-level, or on one of their sites). */
const visibleEvent = async (caller: InsightsCaller, id: number): Promise<Row> => {
  const rows: Row[] = await AppDataSource.query(`SELECT * FROM insight_event WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
  const r = rows[0];
  if (!r || (r.site_id !== null && !caller.siteIds.includes(Number(r.site_id)))) throw new InError("IN_EVENT_NOT_FOUND");
  return r;
};

export const listEvents = handle("events", async (req, res) => {
  const scope = await resolveScope(req as InsightsRequest, EventsQuerySchema as never);
  const q = scope.query as unknown as { from?: string; to?: string };
  const rows: Row[] = await AppDataSource.query(
    `SELECT id, date, label, kind, site_id, created_by FROM insight_event
      WHERE company_id = $1 AND (site_id IS NULL OR site_id = ANY($2::int[]))
        AND ($3::date IS NULL OR date >= $3::date) AND ($4::date IS NULL OR date <= $4::date)
      ORDER BY date, id`,
    [scope.companyId, scope.siteIds, q.from ?? null, q.to ?? null],
  );
  res.json({ events: rows.map((r) => toOut(scope.caller, r)) });
});

export const createEvent = handle("events", async (req, res) => {
  const caller = insightsScope(req as InsightsRequest);
  const body = parse(EventCreateSchema, req.body ?? {}, "IN_EVENT_INVALID");
  const siteId = body.site_id ?? null;
  checkSite(caller, siteId);
  await checkDate(caller.companyId, body.date);
  const [r]: Row[] = await AppDataSource.query(
    `INSERT INTO insight_event (company_id, site_id, date, label, kind, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [caller.companyId, siteId, body.date, body.label, body.kind, caller.userId],
  );
  await audit(Number(r.id), "create", { date: body.date, kind: body.kind, site_id: siteId }, caller.userId);
  res.status(201).json({ event: toOut(caller, r) });
});

export const patchEvent = handle("events", async (req, res) => {
  const caller = insightsScope(req as InsightsRequest);
  const id = routeId(req.params.id);
  const body = parse(EventPatchSchema, req.body ?? {}, "IN_EVENT_INVALID");
  const cur = await visibleEvent(caller, id);
  if (!canEdit(caller, cur)) throw new InError("IN_FORBIDDEN", { rule: "creator_admin_or_superadmin" });
  const next = {
    date: body.date ?? iso(cur.date),
    label: body.label ?? String(cur.label),
    kind: body.kind ?? String(cur.kind),
    site_id: body.site_id === undefined ? (cur.site_id === null ? null : Number(cur.site_id)) : body.site_id,
  };
  if (body.site_id !== undefined) checkSite(caller, next.site_id);
  if (body.date !== undefined) await checkDate(caller.companyId, next.date);
  // TypeORM's postgres driver answers an UPDATE … RETURNING with [rows, affected].
  const updated = await AppDataSource.query(
    `UPDATE insight_event SET date = $3, label = $4, kind = $5, site_id = $6, updated_at = now() WHERE id = $1 AND company_id = $2 RETURNING *`,
    [id, caller.companyId, next.date, next.label, next.kind, next.site_id],
  );
  const r: Row = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
  const changed: Record<string, unknown> = {};
  for (const k of ["date", "kind", "site_id"] as const) {
    const before = k === "date" ? iso(cur.date) : cur[k] === null ? null : k === "site_id" ? Number(cur[k]) : cur[k];
    if (before !== next[k]) changed[k] = { old: before, new: next[k] };
  }
  if (body.label !== undefined && body.label !== cur.label) changed.label = "changed"; // label text stays out of the log
  await audit(id, "update", changed, caller.userId);
  res.json({ event: toOut(caller, r) });
});

export const deleteEvent = handle("events", async (req, res) => {
  const caller = insightsScope(req as InsightsRequest);
  const id = routeId(req.params.id);
  const cur = await visibleEvent(caller, id);
  if (!canEdit(caller, cur)) throw new InError("IN_FORBIDDEN", { rule: "creator_admin_or_superadmin" });
  await AppDataSource.query(`DELETE FROM insight_event WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
  await audit(id, "delete", { date: iso(cur.date), kind: cur.kind, site_id: cur.site_id === null ? null : Number(cur.site_id) }, caller.userId);
  res.json({ removed: id });
});

const router = Router();
router.get("/events", listEvents);
router.post("/events", createEvent);
router.patch("/events/:id", patchEvent);
router.delete("/events/:id", deleteEvent);
export default router;
