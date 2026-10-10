import { Response, NextFunction } from "express";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "./auth.middleware";
import { UserRole } from "../types/type";

/**
 * Audit trail for approve, reject and delete (audit finding F-06). Handlers
 * stay unchanged: the middleware reads the affected rows before the handler
 * runs and, when the handler answers 2xx, writes one audit_log row per row
 * whose status changed or that was deleted, FERA twins included, before the
 * response leaves.
 */

type Guard = (req: AuthRequest, res: Response, next: NextFunction) => unknown;
type Entity = "emission" | "production_data";
type Snapshot = { id: number; status: string; amount: string | null };

const TABLES: Record<Entity, { table: string; key: string; amount: string }> = {
  emission: { table: "emission", key: "pk_id", amount: "total_emission" },
  production_data: { table: "production_data", key: "production_id", amount: "quantity" },
};

/** Where the target ids come from: `:id`, body `ids[]` or `:batchId`. */
type Source = "param" | "ids" | "batch";

const toIds = (value: unknown): number[] =>
  (Array.isArray(value) ? value : [value])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

async function targetIds(entity: Entity, source: Source, req: AuthRequest): Promise<number[]> {
  let ids: number[];
  if (source === "batch") {
    const rows: { pk_id: number }[] = await AppDataSource.query(
      `SELECT pk_id FROM emission WHERE upload_batch_id = $1`,
      [String(req.params.batchId)]
    );
    ids = rows.map((r) => Number(r.pk_id));
  } else {
    ids = toIds(source === "param" ? req.params.id : req.body?.ids);
  }
  if (entity !== "emission" || !ids.length) return ids;
  // FERA twins move with their parent (both link directions).
  const twins: { id: number }[] = await AppDataSource.query(
    `SELECT fera_linked_id AS id FROM emission WHERE pk_id = ANY($1::int[]) AND fera_linked_id IS NOT NULL
     UNION SELECT pk_id AS id FROM emission WHERE fera_linked_id = ANY($1::int[])`,
    [ids]
  );
  return [...new Set([...ids, ...twins.map((t) => Number(t.id))])];
}

async function snapshot(entity: Entity, ids: number[]): Promise<Map<number, Snapshot>> {
  if (!ids.length) return new Map();
  const t = TABLES[entity];
  const rows: Snapshot[] = await AppDataSource.query(
    `SELECT ${t.key} AS id, status, ${t.amount}::text AS amount FROM ${t.table} WHERE ${t.key} = ANY($1::int[])`,
    [ids]
  );
  return new Map(rows.map((r) => [Number(r.id), r]));
}

const ACTION_BY_STATUS: Record<string, string> = { approved: "approve", rejected: "reject", pending: "reopen" };

async function writeAudit(entity: Entity, before: Map<number, Snapshot>, req: AuthRequest) {
  const after = await snapshot(entity, [...before.keys()]);
  const amountKey = TABLES[entity].amount;
  const reason = String(req.body?.comment ?? req.body?.reason ?? "").trim() || null;
  const values: unknown[] = [];
  const rows: string[] = [];
  for (const [id, old] of before) {
    const now = after.get(id);
    let action: string;
    let changed: Record<string, { old: unknown; new: unknown }>;
    if (!now) {
      action = "delete";
      changed = { status: { old: old.status, new: null }, [amountKey]: { old: old.amount, new: null } };
    } else if (now.status !== old.status) {
      action = ACTION_BY_STATUS[now.status] ?? "status_change";
      changed = { status: { old: old.status, new: now.status } };
    } else {
      continue;
    }
    const n = values.length;
    rows.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}::jsonb, $${n + 5}, $${n + 6})`);
    values.push(entity, id, action, JSON.stringify(changed), reason, req.user?.userId ?? null);
  }
  if (!rows.length) return;
  await AppDataSource.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ${rows.join(", ")}`,
    values
  );
}

/**
 * Record approve / reject / delete of the rows named by `source`. The audit
 * row is written before the handler's response is sent; a failure to write
 * it is logged and does not undo the handler's change.
 */
export const auditReview = (entity: Entity, source: Source): Guard => async (req, res, next) => {
  let before: Map<number, Snapshot>;
  try {
    before = await snapshot(entity, await targetIds(entity, source, req));
  } catch (error) {
    console.error("Audit snapshot error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !before.size) return json(body);
    writeAudit(entity, before, req)
      .catch((error) => console.error("Audit write error:", error))
      .finally(() => json(body));
    return res;
  }) as Response["json"];
  next();
};

/**
 * Approved emissions are part of reported totals: only a reviewer (Manager or
 * Superadmin) may delete them, and that delete is audited. (Approved
 * production rows can't be deleted at all; the handler refuses them.)
 */
export const guardApprovedDelete = (entity: Entity, source: Source): Guard => async (req, res, next) => {
  try {
    if (req.user?.role === UserRole.MANAGER || req.user?.role === UserRole.SUPERADMIN) return next();
    const rows = await snapshot(entity, await targetIds(entity, source, req));
    if ([...rows.values()].some((r) => r.status === "approved")) {
      return res.status(409).json({ message: "Approved entries can only be deleted by a manager" });
    }
    next();
  } catch (error) {
    console.error("Approved delete guard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
