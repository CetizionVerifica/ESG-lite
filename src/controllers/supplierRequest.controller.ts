// Supplier data requests (PCF phase 3, C06). Spec: ESG-lite_FE
// docs/pcf/pages/C06-supplier-requests/CLAUDE.md.
//
// Manager routes sit under /pcf/supplier-requests (requirePcfAccess, own
// sites). Suppliers answer through /public/supplier-requests/:token with no
// account: the token is random, shown once and stored hashed. Accepting a
// figure creates a company MaterialFactor with licence 'supplier' and, while
// the study is still a draft, puts the figure on the input line. A boundary
// other than the study's is refused unless the manager confirms it.
import crypto from "crypto";
import { Response } from "express";
import { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "../middlewares/auth.middleware";
import { SupplierRequest, SupplierRequestStatus } from "../entities/SupplierRequest";
import { PcfStudy } from "../entities/PcfStudy";
import { PcfInput } from "../entities/PcfInput";
import { MaterialFactor } from "../entities/MaterialFactor";
import { AuditLog } from "../entities/AuditLog";
import { User } from "../entities/User";
import { pcfScope, PcfScope } from "../pcf/access";
import { loadStudy } from "./pcf.controller";
import { buildMessage, deliver, mailMode, supplierLink } from "../services/supplierRequestMail";
import { createNotification } from "../services/notificationService";
import { log } from "../utils/logger";

const repo = () => AppDataSource.getRepository(SupplierRequest);

export const PCF_UNITS = ["kg", "t", "m2", "kWh", "tonne.km", "unit"];
const BOUNDARIES = ["cradle_to_gate", "cradle_to_grave", "gate_to_gate"];
const STATUSES: Array<SupplierRequestStatus | "expired"> = ["sent", "opened", "received", "accepted", "rejected", "expired"];
const LINK_DAYS_AFTER_DUE = 30;
const LINK_DAYS_DEFAULT = 60;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = new Set(["application/pdf", "application/json"]);
const RELATIONS = ["company", "study", "study.product", "study.site", "input", "input.material_factor", "requested_by", "decided_by", "material_factor"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** "expired" is derived: nothing received and the link has run out. */
export const effectiveStatus = (r: SupplierRequest, now = new Date()): SupplierRequestStatus | "expired" =>
  (r.status === "sent" || r.status === "opened") && r.token_expires_at.getTime() < now.getTime() ? "expired" : r.status;

const userRef = (u: User | null | undefined) => (u ? { user_id: u.user_id, name: u.name } : null);
const dec = (v: string | null) => (v == null ? null : Number(v));

export function requestJson(r: SupplierRequest) {
  return {
    supplier_request_id: r.supplier_request_id,
    company_id: r.company?.company_id ?? null,
    study: r.study
      ? {
          pcf_study_id: r.study.pcf_study_id,
          version: r.study.version,
          status: r.study.status,
          boundary: r.study.boundary,
          product: r.study.product ? { product_id: r.study.product.product_id, name: r.study.product.name } : null,
          site: r.study.site ? { site_id: r.study.site.site_id, name: r.study.site.name } : null,
        }
      : null,
    input: r.input ? { pcf_input_id: r.input.pcf_input_id, name: r.input.name, stage: r.input.stage, unit: r.input.unit } : null,
    material: r.material,
    unit: r.unit,
    supplier_name: r.supplier_name,
    supplier_email: r.supplier_email,
    due_date: r.due_date,
    subject: r.subject,
    message: r.message,
    status: effectiveStatus(r),
    link_expires_at: r.token_expires_at,
    sent_at: r.sent_at,
    opened_at: r.opened_at,
    received_at: r.received_at,
    decided_at: r.decided_at,
    requested_by: userRef(r.requested_by),
    decided_by: userRef(r.decided_by),
    decision_comment: r.decision_comment,
    reply:
      r.received_at
        ? {
            value_kgco2e: dec(r.reply_value_kgco2e),
            unit: r.reply_unit,
            boundary: r.reply_boundary,
            standard: r.reply_standard,
            gwp_set: r.reply_gwp_set,
            reference_start: r.reply_reference_start,
            reference_end: r.reply_reference_end,
            valid_from: r.reply_valid_from,
            valid_to: r.reply_valid_to,
            verifier: r.reply_verifier,
            product_name: r.reply_product_name,
            note: r.reply_note,
            file: r.reply_file_name ? { name: r.reply_file_name, type: r.reply_file_type, size: r.reply_file_size } : null,
            boundary_mismatch: !!(r.reply_boundary && r.study && r.reply_boundary !== r.study.boundary),
          }
        : null,
    accepted:
      r.status === "accepted"
        ? {
            material_factor_id: r.material_factor?.material_factor_id ?? null,
            value_kgco2e: dec(r.accepted_value_kgco2e),
            boundary: r.accepted_boundary,
          }
        : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const audit = (m: EntityManager, studyId: number, userId: number | null, action: string, changed: Record<string, { old: any; new: any }>, reason: string | null = null) =>
  m.save(
    m.create(AuditLog, {
      entity_type: "pcf_study",
      entity_id: studyId,
      action,
      changed_fields: changed,
      reason,
      changed_by: (userId ? { user_id: userId } : undefined) as User,
    }),
  );

async function requestFor(req: AuthRequest, res: Response): Promise<{ scope: PcfScope; r: SupplierRequest } | null> {
  const scope = await pcfScope(req);
  const id = idParam(req.params.id);
  const r = id ? await repo().findOne({ where: { supplier_request_id: id }, relations: RELATIONS }) : null;
  if (!r || !(await loadStudy(r.study.pcf_study_id, scope))) {
    res.status(404).json({ message: "Supplier request not found" });
    return null;
  }
  return { scope, r };
}

const newToken = (dueDate: string | null) => {
  const token = crypto.randomBytes(24).toString("base64url");
  const base = dueDate ? new Date(`${dueDate}T00:00:00Z`).getTime() + LINK_DAYS_AFTER_DUE * 86_400_000 : 0;
  const expires = new Date(Math.max(base, Date.now() + LINK_DAYS_DEFAULT * 86_400_000));
  return { token, hash: hash(token), expires };
};

// ------------------------------------------------------------- manager ---

// GET /pcf/supplier-requests?study=&product=&status=
export const listRequests = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const qb = repo()
      .createQueryBuilder("r")
      .leftJoinAndSelect("r.company", "company")
      .leftJoinAndSelect("r.study", "study")
      .leftJoinAndSelect("study.product", "product")
      .leftJoinAndSelect("study.site", "site")
      .leftJoinAndSelect("r.input", "input")
      .leftJoinAndSelect("r.requested_by", "requested_by")
      .leftJoinAndSelect("r.decided_by", "decided_by")
      .leftJoinAndSelect("r.material_factor", "material_factor")
      .orderBy("r.created_at", "DESC");
    if (!scope.all) {
      if (!scope.siteIds.length) return res.json({ requests: [], mail_mode: mailMode() });
      qb.andWhere("study.site_id IN (:...sites)", { sites: scope.siteIds });
    }
    const study = idParam(req.query.study);
    if (study) qb.andWhere("study.pcf_study_id = :study", { study });
    const product = idParam(req.query.product);
    if (product) qb.andWhere("product.product_id = :product", { product });
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && !STATUSES.includes(status as any)) return res.status(400).json({ message: `status must be one of ${STATUSES.join(", ")}` });
    let rows = await qb.getMany();
    if (status) rows = rows.filter((r) => effectiveStatus(r) === status);
    res.json({ requests: rows.map(requestJson), mail_mode: mailMode() });
  } catch (error) {
    log.error("SupplierRequest", "List failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't load supplier requests" });
  }
};

// POST /pcf/supplier-requests
// { study_id, input_id?, material, unit, supplier_email, supplier_name?, due_date?, note? }
export const createRequest = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const b = req.body ?? {};
    const studyId = idParam(b.study_id);
    const study = studyId ? await loadStudy(studyId, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    let input: PcfInput | null = null;
    if (b.input_id !== undefined && b.input_id !== null) {
      const inputId = idParam(b.input_id);
      input = inputId
        ? await AppDataSource.getRepository(PcfInput).findOne({ where: { pcf_input_id: inputId, study: { pcf_study_id: study.pcf_study_id } }, relations: ["material_factor"] })
        : null;
      if (!input) return res.status(404).json({ message: "Input line not found on this footprint" });
    }
    const material = text(b.material, 200) ?? input?.name ?? null;
    if (!material) return res.status(400).json({ message: "material is required" });
    const unit = typeof b.unit === "string" && b.unit ? b.unit : input?.unit;
    if (!unit || !PCF_UNITS.includes(unit)) return res.status(400).json({ message: `unit must be one of ${PCF_UNITS.join(", ")}` });
    const email = typeof b.supplier_email === "string" ? b.supplier_email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254) return res.status(400).json({ message: "supplier_email must be a valid email address" });
    const supplierName = text(b.supplier_name, 200) ?? input?.supplier_name ?? null;
    const dueDate = b.due_date === undefined || b.due_date === null || b.due_date === "" ? null : b.due_date;
    if (dueDate !== null && !isDate(dueDate)) return res.status(400).json({ message: "due_date must be YYYY-MM-DD" });
    if (dueDate !== null && dueDate < new Date().toISOString().slice(0, 10)) return res.status(400).json({ message: "due_date can't be in the past" });
    const note = text(b.note, 1000);

    const manager = await AppDataSource.getRepository(User).findOne({ where: { user_id: scope.userId } });
    const t = newToken(dueDate);
    const link = supplierLink(t.token);
    const { subject, text: message } = buildMessage({
      companyName: study.company.name,
      managerName: manager?.name ?? "The ESGLite team",
      managerEmail: manager?.email ?? "",
      supplierName,
      material,
      unit,
      dueDate,
      boundary: study.boundary,
      note,
      link,
    });

    const saved = await AppDataSource.transaction(async (m) => {
      const r = await m.save(
        m.create(SupplierRequest, {
          company: study.company,
          study,
          input,
          material,
          unit,
          supplier_name: supplierName,
          supplier_email: email,
          due_date: dueDate,
          subject,
          message,
          status: "sent",
          token_hash: t.hash,
          token_expires_at: t.expires,
          sent_at: new Date(),
          requested_by: { user_id: scope.userId } as User,
        }),
      );
      await audit(m, study.pcf_study_id, scope.userId, "supplier_request_sent", {
        supplier_request_id: { old: null, new: r.supplier_request_id },
        material: { old: null, new: material },
        supplier_email: { old: null, new: email },
      });
      return r;
    });
    const mail = await deliver(saved.supplier_request_id, email, subject, message, link);
    const full = await repo().findOneOrFail({ where: { supplier_request_id: saved.supplier_request_id }, relations: RELATIONS });
    res.status(201).json({ request: requestJson(full), link, mail });
  } catch (error) {
    log.error("SupplierRequest", "Create failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't create the supplier request" });
  }
};

// GET /pcf/supplier-requests/preview?study_id=&input_id=&material=&unit=&supplier_name=&due_date=&note=
// The exact message "Ask supplier" shows before Send (no row is written).
export const previewMessage = async (req: AuthRequest, res: Response) => {
  try {
    const scope = await pcfScope(req);
    const studyId = idParam(req.query.study_id);
    const study = studyId ? await loadStudy(studyId, scope) : null;
    if (!study) return res.status(404).json({ message: "Footprint not found" });
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : "");
    const unit = q("unit") || "kg";
    if (!PCF_UNITS.includes(unit)) return res.status(400).json({ message: `unit must be one of ${PCF_UNITS.join(", ")}` });
    const dueDate = q("due_date");
    if (dueDate && !isDate(dueDate)) return res.status(400).json({ message: "due_date must be YYYY-MM-DD" });
    const manager = await AppDataSource.getRepository(User).findOne({ where: { user_id: scope.userId } });
    const link = `${supplierLink("")}<link>`;
    const msg = buildMessage({
      companyName: study.company.name,
      managerName: manager?.name ?? "The ESGLite team",
      managerEmail: manager?.email ?? "",
      supplierName: text(q("supplier_name"), 200),
      material: text(q("material"), 200) ?? "the material",
      unit,
      dueDate: dueDate || null,
      boundary: study.boundary,
      note: text(q("note"), 1000),
      link,
    });
    res.json({ ...msg, link_placeholder: link, mail_mode: mailMode() });
  } catch (error) {
    log.error("SupplierRequest", "Preview failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't build the message" });
  }
};

// GET /pcf/supplier-requests/:id
export const getRequest = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    res.json({ request: requestJson(found.r), mail_mode: mailMode() });
  } catch (error) {
    log.error("SupplierRequest", "Get failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't load the supplier request" });
  }
};

// GET /pcf/supplier-requests/:id/file  the declaration the supplier uploaded
export const getRequestFile = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    const { r } = found;
    if (!r.reply_file_name) return res.status(404).json({ message: "The supplier sent no file" });
    const withFile = await repo().createQueryBuilder("r").addSelect("r.reply_file").where("r.supplier_request_id = :id", { id: r.supplier_request_id }).getOne();
    if (!withFile?.reply_file) return res.status(404).json({ message: "The supplier sent no file" });
    const safeName = r.reply_file_name.replace(/[^\w.\- ]+/g, "_");
    res.setHeader("Content-Type", r.reply_file_type ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.send(withFile.reply_file);
  } catch (error) {
    log.error("SupplierRequest", "File failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't load the file" });
  }
};

// POST /pcf/supplier-requests/:id/resend  { due_date? }  new link, message sent again
export const resendRequest = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    const { scope, r } = found;
    if (r.status === "accepted" || r.status === "rejected") return res.status(409).json({ message: "This request is closed; ask again with a new request" });
    const b = req.body ?? {};
    let dueDate = r.due_date;
    if (b.due_date !== undefined) {
      if (b.due_date !== null && b.due_date !== "" && !isDate(b.due_date)) return res.status(400).json({ message: "due_date must be YYYY-MM-DD" });
      dueDate = b.due_date || null;
    }
    const manager = await AppDataSource.getRepository(User).findOne({ where: { user_id: scope.userId } });
    const t = newToken(dueDate);
    const link = supplierLink(t.token);
    const { subject, text: message } = buildMessage({
      companyName: r.company.name,
      managerName: manager?.name ?? "The ESGLite team",
      managerEmail: manager?.email ?? "",
      supplierName: r.supplier_name,
      material: r.material,
      unit: r.unit,
      dueDate,
      boundary: r.study.boundary,
      note: null,
      link,
    });
    await AppDataSource.transaction(async (m) => {
      await m.update(SupplierRequest, r.supplier_request_id, {
        due_date: dueDate,
        subject,
        message,
        status: r.status === "received" ? "received" : "sent",
        token_hash: t.hash,
        token_expires_at: t.expires,
        sent_at: new Date(),
      });
      await audit(m, r.study.pcf_study_id, scope.userId, "supplier_request_resent", { supplier_request_id: { old: r.supplier_request_id, new: r.supplier_request_id } });
    });
    const mail = await deliver(r.supplier_request_id, r.supplier_email, subject, message, link);
    const full = await repo().findOneOrFail({ where: { supplier_request_id: r.supplier_request_id }, relations: RELATIONS });
    res.json({ request: requestJson(full), link, mail });
  } catch (error) {
    log.error("SupplierRequest", "Resend failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't resend the request" });
  }
};

// DELETE /pcf/supplier-requests/:id  only while nothing was received
export const deleteRequest = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    const { scope, r } = found;
    if (r.received_at) return res.status(409).json({ message: "The supplier already answered; reject the answer instead of deleting the request" });
    await AppDataSource.transaction(async (m) => {
      await m.delete(SupplierRequest, r.supplier_request_id);
      await audit(m, r.study.pcf_study_id, scope.userId, "supplier_request_deleted", { supplier_request_id: { old: r.supplier_request_id, new: null } });
    });
    res.json({ message: "Supplier request deleted" });
  } catch (error) {
    log.error("SupplierRequest", "Delete failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't delete the supplier request" });
  }
};

// POST /pcf/supplier-requests/:id/accept
// { value_kgco2e, boundary?, confirm_boundary?, standard?, gwp_set?, valid_from?, valid_to?, verifier?, source?, material_group?, dqr_time? }
// The manager's reviewed figure (typed, or the AI-read one they confirmed).
export const acceptRequest = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    const { scope, r } = found;
    if (r.status !== "received") return res.status(409).json({ message: "Only a received answer can be accepted" });
    const b = req.body ?? {};
    const value = num(b.value_kgco2e ?? r.reply_value_kgco2e);
    if (value === null || Number.isNaN(value) || value < 0) return res.status(400).json({ message: "value_kgco2e must be a number of 0 or more" });
    const boundary = b.boundary === undefined ? r.reply_boundary : text(b.boundary, 20);
    if (boundary && !BOUNDARIES.includes(boundary)) return res.status(400).json({ message: `boundary must be one of ${BOUNDARIES.join(", ")}` });
    if (boundary && boundary !== r.study.boundary && b.confirm_boundary !== true) {
      return res.status(409).json({
        message: `The supplier's figure is ${boundary.replace(/_/g, "-")} but this footprint is ${r.study.boundary.replace(/_/g, "-")}; confirm the boundary to accept it anyway`,
        boundary_mismatch: true,
      });
    }
    if (b.gwp_set !== undefined && b.gwp_set !== null && b.gwp_set !== "AR6" && b.gwp_set !== "AR5") return res.status(400).json({ message: "gwp_set must be AR6 or AR5" });
    for (const k of ["valid_from", "valid_to"] as const) {
      if (b[k] !== undefined && b[k] !== null && b[k] !== "" && !isDate(b[k])) return res.status(400).json({ message: `${k} must be YYYY-MM-DD` });
    }
    const validFrom = b.valid_from === undefined ? r.reply_valid_from : b.valid_from || null;
    const validTo = b.valid_to === undefined ? r.reply_valid_to : b.valid_to || null;
    if (validFrom && validTo && validTo < validFrom) return res.status(400).json({ message: "valid_to must be on or after valid_from" });
    const standard = b.standard === undefined ? r.reply_standard : text(b.standard, 100);
    const verifier = b.verifier === undefined ? r.reply_verifier : text(b.verifier, 200);
    const gwp = (b.gwp_set ?? r.reply_gwp_set) === "AR5" ? "AR5" : "AR6";
    const dqrTime = b.dqr_time === undefined ? null : Number(b.dqr_time);
    if (dqrTime !== null && ![1, 2, 3].includes(dqrTime)) return res.status(400).json({ message: "dqr_time must be 1, 2 or 3" });
    const supplier = r.supplier_name?.trim() || r.supplier_email.split("@")[1];
    const group = text(b.material_group, 30) ?? r.input?.material_factor?.material_group ?? "supplier";
    const sourceBits = [standard ? `Supplier PCF (${standard})` : "Supplier PCF", verifier ? `verified by ${verifier}` : null, r.reply_file_name ? `file ${r.reply_file_name}` : null].filter(Boolean);

    const result = await AppDataSource.transaction(async (m) => {
      const factor = await m.save(
        m.create(MaterialFactor, {
          company: r.company,
          name: `${r.material} — ${supplier} (supplier)`,
          material_group: group,
          geography: null,
          unit: r.unit,
          value_kgco2e: String(value),
          gwp_set: gwp,
          source: text(b.source, 200) ?? sourceBits.join(", "),
          source_year: r.reply_reference_end ? Number(r.reply_reference_end.slice(0, 4)) : null,
          dataset_ref: `supplier-request:${r.supplier_request_id}`,
          licence: "supplier",
          recycled_variant: false,
          valid_from: validFrom,
          valid_to: validTo,
        }),
      );
      let applied = false;
      if (r.input && r.study.status === "draft") {
        const refYear = r.reply_reference_end ? Number(r.reply_reference_end.slice(0, 4)) : null;
        const age = refYear ? new Date().getUTCFullYear() - refYear : null;
        await m.update(PcfInput, r.input.pcf_input_id, {
          supplier_pcf_kgco2e: String(value),
          material_factor: factor,
          data_type: "primary",
          supplier_name: r.supplier_name ?? r.input.supplier_name,
          dqr_technology: 1,
          dqr_geography: 1,
          dqr_time: dqrTime ?? (age === null ? 2 : age <= 2 ? 1 : age <= 5 ? 2 : 3),
        });
        await m.update(PcfStudy, r.study.pcf_study_id, { updated_at: new Date() });
        applied = true;
      }
      await m.update(SupplierRequest, r.supplier_request_id, {
        status: "accepted",
        decided_at: new Date(),
        decided_by: { user_id: scope.userId } as User,
        decision_comment: text(b.comment, 1000),
        material_factor: factor,
        accepted_value_kgco2e: String(value),
        accepted_boundary: boundary ?? r.study.boundary,
      });
      await audit(
        m,
        r.study.pcf_study_id,
        scope.userId,
        "supplier_request_accepted",
        {
          supplier_request_id: { old: r.supplier_request_id, new: r.supplier_request_id },
          material_factor_id: { old: null, new: factor.material_factor_id },
          supplier_pcf_kgco2e: { old: r.input?.supplier_pcf_kgco2e ?? null, new: applied ? value : null },
          ...(boundary && boundary !== r.study.boundary ? { boundary: { old: r.study.boundary, new: boundary } } : {}),
        },
        text(b.comment, 1000),
      );
      return { factor, applied };
    });
    const full = await repo().findOneOrFail({ where: { supplier_request_id: r.supplier_request_id }, relations: RELATIONS });
    res.json({
      request: requestJson(full),
      material_factor_id: result.factor.material_factor_id,
      applied_to_input: result.applied,
      note: result.applied ? null : r.input ? "The footprint is no longer a draft, so the factor is ready for its next version" : "No input line is linked, so pick the new factor in the builder",
    });
  } catch (error) {
    log.error("SupplierRequest", "Accept failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't accept the supplier's figure" });
  }
};

// POST /pcf/supplier-requests/:id/reject  { comment }
export const rejectRequest = async (req: AuthRequest, res: Response) => {
  try {
    const found = await requestFor(req, res);
    if (!found) return;
    const { scope, r } = found;
    if (r.status !== "received") return res.status(409).json({ message: "Only a received answer can be rejected" });
    const comment = text(req.body?.comment, 1000);
    if (!comment) return res.status(400).json({ message: "Say why the figure is rejected" });
    await AppDataSource.transaction(async (m) => {
      await m.update(SupplierRequest, r.supplier_request_id, { status: "rejected", decided_at: new Date(), decided_by: { user_id: scope.userId } as User, decision_comment: comment });
      await audit(m, r.study.pcf_study_id, scope.userId, "supplier_request_rejected", { supplier_request_id: { old: r.supplier_request_id, new: r.supplier_request_id } }, comment);
    });
    const full = await repo().findOneOrFail({ where: { supplier_request_id: r.supplier_request_id }, relations: RELATIONS });
    res.json({ request: requestJson(full) });
  } catch (error) {
    log.error("SupplierRequest", "Reject failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't reject the supplier's figure" });
  }
};

// -------------------------------------------------------------- public ---

const byToken = async (token: unknown) => {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return repo().findOne({ where: { token_hash: hash(token) }, relations: ["company", "study", "study.product"] });
};

function publicJson(r: SupplierRequest) {
  return {
    company: r.company.name,
    product: r.study.product?.name ?? null,
    material: r.material,
    unit: r.unit,
    boundary: r.study.boundary,
    due_date: r.due_date,
    supplier_name: r.supplier_name,
    status: effectiveStatus(r),
    received_at: r.received_at,
    reply: r.received_at
      ? {
          value_kgco2e: dec(r.reply_value_kgco2e),
          unit: r.reply_unit,
          boundary: r.reply_boundary,
          standard: r.reply_standard,
          reference_start: r.reply_reference_start,
          reference_end: r.reply_reference_end,
          valid_from: r.reply_valid_from,
          valid_to: r.reply_valid_to,
          verifier: r.reply_verifier,
          file: r.reply_file_name ? { name: r.reply_file_name, size: r.reply_file_size } : null,
        }
      : null,
  };
}

// GET /public/supplier-requests/:token  (marks the request opened)
export const openPublicRequest = async (req: AuthRequest, res: Response) => {
  try {
    const r = await byToken(req.params.token);
    if (!r) return res.status(404).json({ message: "This link isn't valid" });
    const status = effectiveStatus(r);
    if (status === "expired") return res.status(410).json({ message: "This link has expired; ask the company for a new one" });
    if (r.status === "sent") {
      await repo().update(r.supplier_request_id, { status: "opened", opened_at: new Date() });
      r.status = "opened";
      r.opened_at = new Date();
    }
    res.json(publicJson(r));
  } catch (error) {
    log.error("SupplierRequest", "Public open failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't open the request" });
  }
};

// POST /public/supplier-requests/:token/submit  multipart: file? + typed fields
export const submitPublicRequest = async (req: AuthRequest, res: Response) => {
  try {
    const r = await byToken(req.params.token);
    if (!r) return res.status(404).json({ message: "This link isn't valid" });
    const status = effectiveStatus(r);
    if (status === "expired") return res.status(410).json({ message: "This link has expired; ask the company for a new one" });
    if (status === "accepted" || status === "rejected") return res.status(409).json({ message: "This request is closed" });
    const b = req.body ?? {};
    const file = (req as any).file as Express.Multer.File | undefined;
    if (file) {
      const name = file.originalname.toLowerCase();
      if (!(name.endsWith(".pdf") || name.endsWith(".json")) || (file.mimetype && !FILE_TYPES.has(file.mimetype) && file.mimetype !== "application/octet-stream")) {
        return res.status(400).json({ message: "Upload a PDF or a PACT JSON file" });
      }
    }
    const value = num(b.value_kgco2e);
    if (value !== null && (Number.isNaN(value) || value < 0)) return res.status(400).json({ message: "value_kgco2e must be a number of 0 or more" });
    if (value === null && !file) return res.status(400).json({ message: "Upload a declaration file or type the value in kg CO2e" });
    const unit = text(b.unit, 20) ?? (value !== null ? r.unit : null);
    if (unit && !PCF_UNITS.includes(unit)) return res.status(400).json({ message: `unit must be one of ${PCF_UNITS.join(", ")}` });
    const boundary = text(b.boundary, 20);
    if (boundary && !BOUNDARIES.includes(boundary)) return res.status(400).json({ message: `boundary must be one of ${BOUNDARIES.join(", ")}` });
    if (value !== null && !boundary) return res.status(400).json({ message: "Say which system boundary the value covers" });
    const gwp = text(b.gwp_set, 5);
    if (gwp && gwp !== "AR6" && gwp !== "AR5") return res.status(400).json({ message: "gwp_set must be AR6 or AR5" });
    const dates: Record<string, string | null> = {};
    for (const k of ["reference_start", "reference_end", "valid_from", "valid_to"]) {
      const v = b[k];
      if (v === undefined || v === null || v === "") dates[k] = null;
      else if (!isDate(v)) return res.status(400).json({ message: `${k} must be YYYY-MM-DD` });
      else dates[k] = v;
    }
    if (dates.reference_start && dates.reference_end && dates.reference_end < dates.reference_start) return res.status(400).json({ message: "reference_end must be on or after reference_start" });
    if (dates.valid_from && dates.valid_to && dates.valid_to < dates.valid_from) return res.status(400).json({ message: "valid_to must be on or after valid_from" });

    await AppDataSource.transaction(async (m) => {
      await m.update(SupplierRequest, r.supplier_request_id, {
        status: "received",
        received_at: new Date(),
        opened_at: r.opened_at ?? new Date(),
        reply_value_kgco2e: value === null ? null : String(value),
        reply_unit: unit,
        reply_boundary: boundary,
        reply_standard: text(b.standard, 100),
        reply_gwp_set: gwp,
        reply_reference_start: dates.reference_start,
        reply_reference_end: dates.reference_end,
        reply_valid_from: dates.valid_from,
        reply_valid_to: dates.valid_to,
        reply_verifier: text(b.verifier, 200),
        reply_product_name: text(b.product_name, 200),
        reply_note: text(b.note, 2000),
        reply_file_name: file ? file.originalname.slice(0, 200) : null,
        reply_file_type: file ? (file.originalname.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/json") : null,
        reply_file_size: file ? file.size : null,
        reply_file: file ? file.buffer : null,
      });
      await audit(m, r.study.pcf_study_id, null, "supplier_request_received", {
        supplier_request_id: { old: r.supplier_request_id, new: r.supplier_request_id },
        reply_value_kgco2e: { old: dec(r.reply_value_kgco2e), new: value },
        file: { old: r.reply_file_name, new: file ? file.originalname.slice(0, 200) : null },
      });
    });
    const owner = await repo().findOne({ where: { supplier_request_id: r.supplier_request_id }, relations: ["requested_by"] });
    if (owner?.requested_by) {
      try {
        await createNotification(
          owner.requested_by.user_id,
          "supplier_request",
          "Supplier data received",
          `${r.supplier_name?.trim() || r.supplier_email} answered the request for ${r.material}. Review it before it is used.`,
          `/products/suppliers?request=${r.supplier_request_id}`,
        );
      } catch (err) {
        log.warn("SupplierRequest", "Owner notification failed", { requestId: r.supplier_request_id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const full = await repo().findOneOrFail({ where: { supplier_request_id: r.supplier_request_id }, relations: ["company", "study", "study.product"] });
    res.json({ message: "Thank you, your data was received", ...publicJson(full) });
  } catch (error) {
    log.error("SupplierRequest", "Public submit failed", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Couldn't save your answer" });
  }
};
