/**
 * KPI-7 (backend part) · GET /kpi/my?period=YYYY-MM&site= — what the caller owes.
 *
 * `period` is a month (default: last month). An item is a KPI × site (or the
 * company) × the KPI's period that ENDS in that month (monthly: the month;
 * quarterly: the quarter ending then; annual: the year ending then), in the
 * company's year type and the KPI's frequency for the company; its values are
 * due on `due_day` of the next month (D16).
 *
 * Whose items (D17, wave D): manual KPIs × sites (or the company) the caller
 * owns through `resolveOwner` (setup/owners.ts): the per-KPI assignment, else
 * the topic assignment of (site, the KPI's topic). Unassigned pairs are
 * nobody's (no Admin or topic-grant fallback any more). Plus:
 *   - read-only auto and formula KPIs (group "auto") of the sites, or the
 *     company, the caller has manual items for.
 * Groups: due (nothing yet, or a draft), sent_back (rejected), done (pending or
 * approved), auto. Before setup is finished: 409 KPI_SETUP_INCOMPLETE.
 */
import { Router } from "express";
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { KpiError } from "../contracts/errors";
import { kpiCaller, type KpiCaller, type KpiRequest } from "../guard";
import { handle, parse } from "../http";
import { kpiSettings } from "../setup/settings";
import { ownerIndex, type ResolvedOwner } from "../setup/owners";
import { topicLabel, topicOrder } from "../setup/topics";
import { dueDate, periodsFor, reportingYearOf, type KpiPeriod, isoDay } from "./period";
import { assertSetupDone, canSee, evidenceFor, needsEvidence, toValueOut } from "./service";

type Row = Record<string, any>;

const MyQuerySchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM").optional(),
  site: z.coerce.number().int().positive().optional(),
});

const lastMonth = () => {
  const d = new Date();
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() - 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

const day = (v: unknown) => isoDay(v) as string;
const minusYear = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

/** The KPI period of `frequency` that ends in month `ym`, or null. */
export function periodEndingIn(ym: string, frequency: "monthly" | "quarterly" | "annual", yearType: "CY" | "FY"): KpiPeriod | null {
  const first = `${ym}-01`;
  const year = reportingYearOf(first, yearType);
  return periodsFor(frequency, yearType, year).find((p) => p.end.slice(0, 7) === ym) ?? null;
}

export async function myKpis(caller: KpiCaller, query: unknown) {
  const q = parse(MyQuerySchema, query ?? {});
  const m = AppDataSource.manager;
  const companyId = caller.companyId;
  await assertSetupDone(m, companyId);
  const ym = q.period ?? lastMonth();
  const settings = await kpiSettings(m, companyId);

  const sites: Row[] = await m.query(`SELECT site_id, name FROM site WHERE company_id = $1 ORDER BY name, site_id`, [companyId]);
  const siteName = new Map(sites.map((s) => [Number(s.site_id), String(s.name)]));
  if (q.site !== undefined && (!siteName.has(q.site) || (caller.sites && !caller.sites.has(q.site)))) throw new KpiError("KPI_NOT_FOUND", { site_id: q.site });
  const mySites = sites.map((s) => Number(s.site_id)).filter((s) => (!caller.sites || caller.sites.has(s)) && (q.site === undefined || s === q.site));

  const defs: Row[] = await m.query(
    `SELECT d.*, COALESCE(ck.frequency, d.default_frequency) AS frequency
       FROM kpi_definition d JOIN company_kpi ck ON ck.kpi_definition_id = d.id AND ck.company_id = $1 AND ck.selected
      WHERE d.active AND (d.company_id IS NULL OR d.company_id = $1) ORDER BY d.topic, d.code`,
    [companyId],
  );
  const owners = await ownerIndex(m, companyId);

  // Which manual KPI × target pairs are the caller's (D17 resolver).
  type Pair = { def: Row; site: number | null; owner: ResolvedOwner | null };
  const manual: Pair[] = [];
  for (const d of defs.filter((x) => x.source === "manual")) {
    if (d.level === "company") {
      if (q.site !== undefined) continue;
      const o = owners.resolve(d as { id: number; topic: string }, null);
      if (o.owner_user_id === caller.userId) manual.push({ def: d, site: null, owner: o });
      continue;
    }
    for (const s of mySites) {
      const o = owners.resolve(d as { id: number; topic: string }, s);
      if (o.owner_user_id === caller.userId) manual.push({ def: d, site: s, owner: o });
    }
  }
  // Owners assigned on a site the caller can no longer read still see it only if it's in their scope.
  const ownSites = new Set(manual.filter((p) => p.site !== null).map((p) => p.site as number));
  const hasCompany = manual.some((p) => p.site === null);
  const readOnly: Pair[] = [];
  for (const d of defs.filter((x) => x.source !== "manual")) {
    if (d.level === "company") {
      if (hasCompany) readOnly.push({ def: d, site: null, owner: null });
    } else for (const s of ownSites) readOnly.push({ def: d, site: s, owner: null });
  }

  // Values of the month's periods and of the same periods last year, in one query each.
  const [y, mo] = ym.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const rowsFor = (from: string, to: string): Promise<Row[]> =>
    m.query(`SELECT v.*, d.code AS kpi_code, d.canonical_unit FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = $1 AND v.period_end >= $2 AND v.period_end <= $3`, [
      companyId,
      from,
      to,
    ]);
  const now = await rowsFor(`${ym}-01`, monthEnd);
  const last = await rowsFor(minusYear(`${ym}-01`), minusYear(monthEnd));
  const key = (kpi: number, site: number | null, start: string, freq: string) => `${kpi}|${site ?? ""}|${start}|${freq}`;
  const nowBy = new Map(now.map((v) => [key(Number(v.kpi_definition_id), v.site_id === null ? null : Number(v.site_id), day(v.period_start), v.frequency), v]));
  const lastBy = new Map(last.map((v) => [key(Number(v.kpi_definition_id), v.site_id === null ? null : Number(v.site_id), day(v.period_start), v.frequency), v]));
  const evidence = await evidenceFor(m, now.map((v) => Number(v.id)));

  // Framework badges from the versions the company reports on.
  const badges: Row[] = defs.length
    ? await m.query(
        `SELECT mp.kpi_definition_id, f.code AS framework, ds.code, ds.requirement
           FROM kpi_disclosure_map mp JOIN kpi_disclosure ds ON ds.id = mp.disclosure_id
           JOIN kpi_framework f ON f.id = ds.framework_id JOIN company_framework cf ON cf.framework_id = f.id AND cf.company_id = $1
          WHERE mp.kpi_definition_id = ANY($2::int[]) ORDER BY f.code, ds.sort_key, ds.code`,
        [companyId, defs.map((d) => d.id)],
      )
    : [];
  const usedIn = new Map<number, Array<{ framework: string; code: string; core?: boolean }>>();
  for (const b of badges) {
    const list = usedIn.get(Number(b.kpi_definition_id)) ?? [];
    list.push({ framework: b.framework, code: b.code, ...(b.requirement === "core" ? { core: true } : {}) });
    usedIn.set(Number(b.kpi_definition_id), list);
  }
  const evidenceNeeded = new Map<number, boolean>();
  const nameOf = new Map(defs.map((d) => [String(d.code), String(d.name)]));

  const items = [];
  for (const p of [...manual, ...readOnly]) {
    const d = p.def;
    const period = periodEndingIn(ym, d.frequency, settings.year_type);
    if (!period) continue;
    const id = Number(d.id);
    const v = nowBy.get(key(id, p.site, period.start, period.frequency)) ?? null;
    const visible = v && canSee(caller, v) ? v : null;
    const prev = lastBy.get(key(id, p.site, minusYear(period.start), period.frequency)) ?? null;
    const prevOk = prev && (prev.status === "approved" || prev.status === "pending") ? prev : null;
    if (!evidenceNeeded.has(id)) evidenceNeeded.set(id, d.source === "manual" ? await needsEvidence(m, companyId, id) : false);
    const auto = d.source !== "manual";
    const group = auto ? "auto" : !visible || visible.status === "draft" ? "due" : visible.status === "rejected" ? "sent_back" : "done";
    const snapshotInputs = auto && d.source === "formula" && visible?.auto_snapshot?.inputs ? (visible.auto_snapshot.inputs as Row[]) : null;
    items.push({
      kpi_definition_id: id,
      code: d.code,
      name: d.name,
      question: d.question,
      help: d.help ?? null,
      topic: d.topic,
      topic_label: topicLabel(d.topic),
      source: d.source,
      value_type: d.value_type,
      unit_dimension: d.unit_dimension,
      canonical_unit: d.canonical_unit ?? null,
      allowed_units: d.allowed_units ?? [],
      decimals: Number(d.decimals),
      level: d.level,
      breakdowns: d.breakdowns ?? null,
      auto_source: d.auto_source ?? null,
      formula: d.formula ?? null,
      needs_evidence: evidenceNeeded.get(id) === true,
      used_in: usedIn.get(id) ?? [],
      site_id: p.site,
      site_name: p.site === null ? null : siteName.get(p.site) ?? null,
      period_start: period.start,
      period_end: period.end,
      period_label: period.label,
      frequency: period.frequency,
      year_type: period.year_type,
      due_date: dueDate(period, settings.due_day),
      group,
      status: visible ? visible.status : "missing",
      assigned: p.owner !== null && p.owner.via !== null,
      assigned_via: p.owner?.via ?? null,
      reviewer_user_id: p.owner?.reviewer_user_id ?? null,
      reviewer_name: p.owner?.reviewer_user_id ? p.owner.reviewer_name || null : null,
      value: visible ? toValueOut(visible, evidence.get(Number(visible.id))) : null,
      last_value: prevOk
        ? {
            value: prevOk.value_numeric === null ? null : Number(prevOk.value_numeric),
            unit: prevOk.unit ?? null,
            value_canonical: prevOk.value_canonical === null ? null : Number(prevOk.value_canonical),
            period_start: day(prevOk.period_start),
            status: prevOk.status,
          }
        : null,
      ...(d.source === "formula"
        ? { inputs: (snapshotInputs ?? []).map((i) => ({ code: i.code, part: i.part ?? null, name: nameOf.get(String(i.code)) ?? i.code, value: i.value ?? null, unit: i.unit ?? null, status: i.status ?? null })) }
        : {}),
    });
  }
  // D17: grouped under topic headings, in KPI_TOPICS order.
  items.sort((a, b) => topicOrder(a.topic) - topicOrder(b.topic) || a.due_date.localeCompare(b.due_date) || (a.site_name ?? "").localeCompare(b.site_name ?? "") || a.code.localeCompare(b.code));
  const counts = { due: 0, sent_back: 0, done: 0, auto: 0, total: items.length };
  for (const i of items) counts[i.group as keyof typeof counts]++;
  return { period: ym, items, counts };
}

/** KPI-7 route, behind requireKpiTracking: GET /kpi/my?period=YYYY-MM&site= → {period, items, counts}. */
export const myRouter = Router();
myRouter.get("/my", handle("my KPIs", async (req, res) => res.json(await myKpis(kpiCaller(req as KpiRequest), req.query))));
