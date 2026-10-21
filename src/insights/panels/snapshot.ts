/**
 * IN-8 · GET /insights/snapshot.pdf (01-contracts §4, I16): the page as one A4 landscape PDF,
 * for the same query, guard and scope as the panels (roles, site scope, switch-off).
 *
 * The panels come from their own build functions through `panelResponse` (so the cache and
 * the figures are the panels' own): summary, decoupling (5 years), ESG ring (KPI on),
 * pathway, target wall and the top three cards. snapshotHtml.ts lays them out; the existing
 * printer (src/reporting/print.ts `htmlToPdf`, unchanged) renders it.
 *
 * Time limit: SNAPSHOT_TIMEOUT_MS (60 s) over the whole request → 504 IN_SNAPSHOT_TIMEOUT.
 * The limit is read at call time from INSIGHTS_SNAPSHOT_TIMEOUT_MS, and under NODE_ENV=test
 * only from the `x-insights-snapshot-timeout-ms` header too, so the API test can force the path.
 * Auth: the Authorization header, as every /insights route (no ?token=: /insights is mounted
 * with `authenticate`, not the report middleware).
 */
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDataSource } from "../../config/data-source";
import { htmlToPdf } from "../../reporting/print";
import { DECOUPLING_YEARS_DEFAULT } from "../contracts/enums";
import { InError } from "../contracts/errors";
import type { Cards, Decoupling, EsgRing, Pathway, Summary, TargetWall } from "../contracts/panels";
import type { CardsQuery, DecouplingQuery } from "../contracts/schemas";
import type { InsightsRequest } from "../guard";
import { handle } from "../http";
import { panelResponse } from "../panel";
import { resolveScope, type InsightsScope } from "../scope";
import { buildCards } from "./cards";
import { buildDecoupling } from "./decoupling";
import { buildEsgRing } from "./esgRing";
import { buildPathway } from "./pathway";
import { buildSummary } from "./summary";
import { buildTargetWall } from "./targetWall";
import { snapshotHtml, type SnapshotInput } from "./snapshotHtml";

export const SNAPSHOT_TIMEOUT_MS = 60_000;
export const SNAPSHOT_CARDS = 3;

/** The limit for this request (see the header comment). */
export const snapshotTimeout = (header: unknown, env = process.env): number => {
  const fromHeader = env.NODE_ENV === "test" ? Number(header) : NaN;
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const fromEnv = Number(env.INSIGHTS_SNAPSHOT_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : SNAPSHOT_TIMEOUT_MS;
};

/** `work` or IN_SNAPSHOT_TIMEOUT after `ms`, whichever comes first. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InError("IN_SNAPSHOT_TIMEOUT")), ms);
  });
  work.catch(() => {}); // a late failure after the timeout is not unhandled
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

const dataOf = async <T>(p: Promise<{ availability: string; data: T | null }>): Promise<T | null> => {
  const r = await p;
  return r.availability === "ok" ? r.data : null;
};

/** The snapshot's figures, read through the panels. */
export async function snapshotInput(scope: InsightsScope, generated = new Date().toISOString().slice(0, 10)): Promise<SnapshotInput> {
  const dec = { ...scope, query: { ...scope.query, years: DECOUPLING_YEARS_DEFAULT } } as InsightsScope<DecouplingQuery>;
  const cardsScope = { ...scope, query: { ...scope.query, ai: false } } as InsightsScope<CardsQuery>;
  const summaryResp = await panelResponse<Summary, InsightsScope["query"]>("summary", scope, buildSummary);
  const [decoupling, ring, pathway, wall, cards] = [
    await dataOf(panelResponse<Decoupling, DecouplingQuery>("decoupling", dec, buildDecoupling, { extras: (q) => ({ years: q.years }) })),
    await dataOf(panelResponse<EsgRing, InsightsScope["query"]>("esg_ring", scope, buildEsgRing, { kpi: true })),
    await dataOf(panelResponse<Pathway, InsightsScope["query"]>("pathway", scope, buildPathway)),
    await dataOf(panelResponse<TargetWall, InsightsScope["query"]>("target_wall", scope, buildTargetWall)),
    await dataOf(panelResponse<Cards, CardsQuery>("cards", cardsScope, buildCards, { extras: (q) => ({ ai: q.ai }) })),
  ];
  const [row] = await AppDataSource.query(`SELECT name FROM company WHERE company_id = $1`, [scope.companyId]);
  return {
    company: String(row?.name ?? ""),
    label: scope.label,
    generated,
    summary: summaryResp.availability === "ok" ? summaryResp.data : null,
    decoupling,
    ring,
    pathway,
    wall,
    cards: (cards?.cards ?? []).slice(0, SNAPSHOT_CARDS),
    pending: { emissions: summaryResp.pending_not_in.emissions, kpi_values: summaryResp.pending_not_in.kpi_values },
  };
}

async function printPdf(html: string): Promise<Buffer> {
  const path = join(tmpdir(), `insights-snapshot-${randomUUID()}.pdf`);
  try {
    await htmlToPdf(html, path);
    return await readFile(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

export const snapshotPdf = handle("snapshot", async (req, res) => {
  const ms = snapshotTimeout(req.headers["x-insights-snapshot-timeout-ms"]);
  const pdf = await withTimeout(
    (async () => {
      const scope = await resolveScope(req as InsightsRequest);
      const input = await snapshotInput(scope);
      return { pdf: await printPdf(snapshotHtml(input)), year: scope.period.year, type: scope.period.yearType };
    })(),
    ms,
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Insights-${pdf.type}${pdf.year}.pdf"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  res.send(pdf.pdf);
});
