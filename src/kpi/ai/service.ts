/**
 * KPI-12 · the ESG-lite proxy to python's KPI suggestions (suggest only; a
 * person always confirms). Nothing is stored except an in-process, audit-free
 * cache of python's answer for 24 h.
 *
 *   POST /kpi/ai/suggest-values   JSON {document_id, site_id?, period?, period_start?, kpis?}
 *                                 or multipart `file` (+ the same fields): the file goes to python's
 *                                 document store as the caller first (POST /v1/kpi/documents).
 *     → {available: true, document_id, document_name, pages, period, suggestions: [{kpi_code,
 *        kpi_definition_id, kpi_name, site_id, site_ids, value, unit, breakdown_key, period_start,
 *        period_end, site_hint, source_page, quote, confidence, why, check_this, document_id,
 *        document_name, label}]}
 *     → {available: false, message, suggestions: []} when python is down, slow or can't read it
 *   POST /kpi/ai/suggest-mapping  {name, question, unit?, topic} (Admin, Superadmin)
 *     → {available: true, suggestions: [{disclosure_id, framework, version, code, title, section,
 *        why, confidence, check_this, fit ("exact" when inferable, else null)}]} | {available: false, message, suggestions: []}
 *
 * Scope (suggest-values): the KPIs sent to python are the caller's own due
 * items of `/kpi/my` for that month (D17 owners; on `site_id` only, when
 * given; another site → 404); `kpis` may narrow them, and a code the caller
 * doesn't owe there is KPI_NOT_ASSIGNED. Candidates for other codes are
 * dropped. python reads only documents the caller uploaded (`user_id`).
 * A Superadmin (no company of their own) can't upload to python yet: they get
 * `available: false` (TODO in CLAUDE.md).
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { KpiError } from "../contracts/errors";
import { KpiSuggestMappingSchema, KpiSuggestValuesSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { enabledFrameworks } from "../setup/settings";
import { myKpis } from "../values/my";
import { postService, uploadDocument } from "./client";

type Row = Record<string, any>;

export const AI_UNAVAILABLE = "AI not available right now";
export const SUPERADMIN_UNAVAILABLE = "Fill from a document isn't available for Superadmin yet";
/** Below this the FE shows the suggestion as "Check this" (layer rule 4). */
export const CHECK_THIS_BELOW = 0.6;
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAPPING_WRITERS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN]);

const unavailable = (message = AI_UNAVAILABLE) => ({ available: false as const, message, suggestions: [] as never[] });

// python's answer per (company, user, document, codes, period): never audited, never persisted.
const cache = new Map<string, { at: number; body: Row }>();
const cached = (key: string) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  if (hit) cache.delete(key);
  return null;
};

const previousMonth = () => {
  const d = new Date();
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() - 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

export interface UploadedDoc {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

export async function suggestValues(caller: KpiCaller, raw: unknown, file: UploadedDoc | undefined, authorization: string | undefined) {
  const b = parse(KpiSuggestValuesSchema, raw ?? {});
  if (!file && !b.document_id) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "document_id", message: "Send a document_id, or the file itself (multipart `file`)." }] });
  if (caller.role === UserRole.SUPERADMIN) return unavailable(SUPERADMIN_UNAVAILABLE);
  const period = b.period ?? (b.period_start ? b.period_start.slice(0, 7) : previousMonth());

  // The caller's own due items (scope, D17 owners): /kpi/my answers 404 for a site that isn't theirs.
  const my = await myKpis(caller, { period, ...(b.site_id ? { site: b.site_id } : {}) });
  let items = (my.items as Row[]).filter((i) => i.source === "manual" && (i.group === "due" || i.group === "sent_back"));
  if (b.site_id === null) items = items.filter((i) => i.site_id === null);
  if (b.kpis?.length) {
    const owed = new Set(items.map((i) => i.code));
    for (const code of b.kpis) if (!owed.has(code)) throw new KpiError("KPI_NOT_ASSIGNED", { kpi: code, site_id: b.site_id ?? null });
    items = items.filter((i) => b.kpis!.includes(i.code));
  }
  if (!items.length) return { available: true, document_id: b.document_id ?? null, document_name: null, pages: 0, period, suggestions: [], message: "Nothing due to fill for this period." };

  let documentId = b.document_id ?? null;
  let documentName: string | null = null;
  if (file) {
    if (!authorization) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: "Sign in again to upload." }] });
    const up = await uploadDocument(file, authorization);
    if (up.status === 400) throw new KpiError("KPI_VALIDATION", { issues: [{ path: "file", message: typeof up.body?.detail === "string" ? up.body.detail.slice(0, 200) : "That file can't be read." }] });
    if (!up.ok || !Number.isInteger(up.body?.document_id)) return unavailable();
    documentId = Number(up.body.document_id);
    documentName = typeof up.body.document_name === "string" ? up.body.document_name : null;
  }

  // One entry per KPI code (python wants unique codes); the period hint spans the items.
  const byCode = new Map<string, Row[]>();
  for (const i of items) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  const starts = items.map((i) => i.period_start).sort();
  const ends = items.map((i) => i.period_end).sort();
  const freqs = new Set(items.map((i) => i.frequency));
  const payload = {
    company_id: caller.companyId,
    document_id: documentId,
    user_id: caller.userId,
    kpis: [...byCode.values()].map(([i]) => ({ code: i.code, question: i.question, unit: i.canonical_unit ?? null, allowed_units: i.allowed_units ?? [], breakdowns: i.breakdowns ?? null })),
    period_hint: { period_start: starts[0], period_end: ends[ends.length - 1], frequency: freqs.size === 1 ? [...freqs][0] : null },
  };
  const key = JSON.stringify([caller.companyId, caller.userId, documentId, [...byCode.keys()].sort(), payload.period_hint]);
  let body = cached(key);
  if (!body) {
    const res = await postService("/v1/kpi/suggest-values", payload);
    if (res.status === 404) throw new KpiError("KPI_NOT_FOUND", { document_id: documentId });
    if (res.status === 410) return unavailable("That document is no longer stored. Upload it again.");
    if (res.status === 422) return unavailable("The document couldn't be read.");
    if (!res.ok || !Array.isArray(res.body?.candidates)) return unavailable();
    body = res.body as Row;
    cache.set(key, { at: Date.now(), body });
  }
  documentName = typeof body.document_name === "string" ? body.document_name : documentName;
  const suggestions = (body.candidates as Row[])
    .filter((c) => byCode.has(String(c.kpi_code)))
    .map((c) => {
      const its = byCode.get(String(c.kpi_code))!;
      const confidence = Number(c.confidence);
      const page = Number(c.source_page) || null;
      return {
        kpi_code: String(c.kpi_code),
        kpi_definition_id: Number(its[0].kpi_definition_id),
        kpi_name: its[0].name,
        site_id: its.length === 1 ? its[0].site_id : null,
        site_ids: its.map((i) => i.site_id),
        value: c.value,
        unit: c.unit ?? null,
        breakdown_key: c.breakdown_key ?? null,
        period_start: c.period_start ?? null,
        period_end: c.period_end ?? null,
        site_hint: c.site_hint ?? null,
        source_page: page,
        quote: typeof c.quote === "string" ? c.quote : "",
        confidence,
        why: typeof c.why === "string" ? c.why : "",
        check_this: !(confidence >= CHECK_THIS_BELOW),
        document_id: documentId,
        document_name: documentName,
        label: `Suggested from ${documentName ?? "your document"}${page ? `, page ${page}` : ""}`,
      };
    });
  console.log(`[kpi-ai] suggest-values company ${caller.companyId} user ${caller.userId} document ${documentId}: ${payload.kpis.length} asked, ${suggestions.length} suggested`);
  return { available: true, document_id: documentId, document_name: documentName, pages: Number(body.pages) || 0, period, suggestions };
}

export async function suggestMapping(caller: KpiCaller, raw: unknown) {
  if (!MAPPING_WRITERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Admin", "Superadmin"] });
  const b = parse(KpiSuggestMappingSchema, raw ?? {});
  const m = AppDataSource.manager;
  // The company's enabled versions (every active one until it enables one, as the catalogue).
  const enabled = (await enabledFrameworks(m, caller.companyId)).map((f) => Number(f.framework_id));
  const rows: Row[] = await m.query(
    `SELECT ds.id, ds.code, ds.title, ds.section, f.code AS framework, f.version
       FROM kpi_disclosure ds JOIN kpi_framework f ON f.id = ds.framework_id AND f.active
      WHERE ($1::int[] IS NULL OR f.id = ANY($1::int[]))
      ORDER BY CASE f.code WHEN 'GRI' THEN 1 WHEN 'BRSR' THEN 2 WHEN 'ESRS' THEN 3 ELSE 4 END, f.version DESC, ds.sort_key, ds.code`,
    [enabled.length ? enabled : null],
  );
  const catalogue = new Map<string, Row>();
  for (const r of rows) if (!catalogue.has(`${r.framework}|${r.code}`)) catalogue.set(`${r.framework}|${r.code}`, r);
  if (!catalogue.size) return unavailable("No framework disclosures to map to yet.");
  const res = await postService("/v1/kpi/suggest-mapping", {
    name: b.name,
    question: b.question,
    unit: b.unit ?? null,
    topic: b.topic,
    company_id: caller.companyId,
    catalogue: [...catalogue.values()].map((r) => ({ framework: r.framework, code: r.code, title: r.title, section: r.section ?? null })),
  });
  if (!res.ok || !Array.isArray(res.body?.suggestions)) return unavailable();
  const picked = (res.body.suggestions as Row[])
    .map((s) => ({ s, d: catalogue.get(`${s.framework}|${s.code}`) }))
    .filter((x) => x.d)
    .slice(0, 5);
  // A fit only where it can be inferred: the disclosure already takes a library KPI exactly in the
  // custom KPI's unit, and python is confident (≥ 0.8) → "exact"; otherwise null (the Admin picks).
  const unitKey = (u: unknown) => String(u ?? "").trim().toLowerCase();
  const exactUnits = new Map<number, Set<string>>();
  if (b.unit && picked.length) {
    const rows: Row[] = await m.query(
      `SELECT mp.disclosure_id, d.canonical_unit, mp.display_unit FROM kpi_disclosure_map mp JOIN kpi_definition d ON d.id = mp.kpi_definition_id AND d.company_id IS NULL
        WHERE mp.fit = 'exact' AND mp.disclosure_id = ANY($1::int[])`,
      [picked.map((x) => Number(x.d!.id))],
    );
    for (const r of rows) {
      const set = exactUnits.get(Number(r.disclosure_id)) ?? new Set<string>();
      set.add(unitKey(r.canonical_unit));
      if (r.display_unit) set.add(unitKey(r.display_unit));
      exactUnits.set(Number(r.disclosure_id), set);
    }
  }
  const suggestions = picked
    .map(({ s, d }) => ({
      disclosure_id: Number(d!.id),
      framework: d!.framework,
      version: d!.version,
      code: d!.code,
      title: d!.title,
      section: d!.section ?? null,
      why: typeof s.why === "string" ? s.why : "",
      confidence: Number(s.confidence),
      check_this: !(Number(s.confidence) >= CHECK_THIS_BELOW),
      fit: Number(s.confidence) >= 0.8 && exactUnits.get(Number(d!.id))?.has(unitKey(b.unit)) ? ("exact" as const) : null,
    }));
  console.log(`[kpi-ai] suggest-mapping company ${caller.companyId}: ${catalogue.size} disclosures sent, ${suggestions.length} suggested`);
  return { available: true, suggestions };
}
