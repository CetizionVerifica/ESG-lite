/**
 * S3-5 · the daily FX job: one rate per currency per day in `fx_rate`, so a
 * spend row converts at the rate of its purchase date and can be reproduced
 * later. Runs once at start (backfill, then today) and every day at 00:20 UTC
 * on node-cron, the scheduler the deadline reminders use.
 *
 *   today     open.er-api.com, then frankfurter.app (ECB): EUR, INR, GBP per USD.
 *   history   frankfurter (ECB reference rates, working days) from 2019-01-01,
 *             a year per request, only for years not stored yet.
 *   pegs      AED, SAR and BHD at their USD peg, source `peg`, on every stored day.
 *
 * A stored day is never changed (INSERT … ON CONFLICT DO NOTHING): a rate a
 * row used stays the rate of that day. Logs counts and dates only.
 * Off when FX_JOB_DISABLED=true (CI) or NODE_ENV=test.
 */
import cron from "node-cron";
import type { EntityManager } from "typeorm";
import { MARKET_CURRENCIES, USD_PEGS } from "./currencies";

export interface RateRow {
  currency: string;
  date: string;
  rate_to_usd: number;
  source: string;
}

export type FetchJson = (url: string) => Promise<unknown>;

export const BACKFILL_FROM = "2019-01-01";
/** A year with at least this many INR days stored counts as backfilled (ECB publishes ~255 a year). */
const YEAR_DONE = 200;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const marketRows = (rates: Record<string, unknown> | undefined, date: string, source: string): RateRow[] =>
  MARKET_CURRENCIES.flatMap((c) => {
    const r = Number(rates?.[c]);
    return Number.isFinite(r) && r > 0 ? [{ currency: c, date, rate_to_usd: r, source }] : [];
  });

/** The peg rows for one day. */
export const pegRows = (date: string): RateRow[] =>
  Object.entries(USD_PEGS).map(([currency, rate]) => ({ currency, date, rate_to_usd: rate, source: "peg" }));

/** Today's rates from the first provider that answers with all three market currencies. */
export async function fetchLatest(fetchJson: FetchJson = defaultFetchJson): Promise<RateRow[]> {
  const providers: Array<{ url: string; parse: (j: any) => RateRow[] }> = [
    {
      url: "https://open.er-api.com/v6/latest/USD",
      parse: (j) => {
        const t = Date.parse(j?.time_last_update_utc ?? "");
        return Number.isNaN(t) ? [] : marketRows(j?.rates, isoDay(new Date(t)), "open.er-api.com");
      },
    },
    { url: "https://api.frankfurter.app/latest?base=USD", parse: (j) => (typeof j?.date === "string" ? marketRows(j.rates, j.date.slice(0, 10), "ecb") : []) },
  ];
  for (const p of providers) {
    try {
      const rows = p.parse(await fetchJson(p.url));
      if (rows.length === MARKET_CURRENCIES.length) return rows;
    } catch {
      // try the next provider
    }
  }
  return [];
}

/** ECB history between two days (inclusive), from frankfurter's time series. */
export async function fetchHistory(from: string, to: string, fetchJson: FetchJson = defaultFetchJson): Promise<RateRow[]> {
  const j = (await fetchJson(`https://api.frankfurter.app/${from}..${to}?base=USD&symbols=${MARKET_CURRENCIES.join(",")}`)) as { rates?: Record<string, Record<string, unknown>> };
  return Object.entries(j?.rates ?? {}).flatMap(([date, rates]) => marketRows(rates, date.slice(0, 10), "ecb"));
}

/** Inserts rows, never changing a stored day. Returns how many were new. */
export async function saveRates(manager: EntityManager, rows: RateRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values: unknown[] = [];
    const tuples = chunk.map((r, k) => {
      values.push(r.currency, r.date, r.rate_to_usd, r.source);
      return `($${k * 4 + 1}, $${k * 4 + 2}::date, $${k * 4 + 3}, $${k * 4 + 4})`;
    });
    const res: unknown[] = await manager.query(
      `INSERT INTO fx_rate (currency, date, rate_to_usd, source) VALUES ${tuples.join(", ")} ON CONFLICT (currency, date) DO NOTHING RETURNING id`,
      values,
    );
    inserted += res.length;
  }
  return inserted;
}

/** With peg rows added for every day the market rows cover. */
const withPegs = (rows: RateRow[]): RateRow[] => [...rows, ...[...new Set(rows.map((r) => r.date))].flatMap(pegRows)];

/** Stores today's rates. Returns the count stored and the day, or 0 when every provider failed. */
export async function runDailyFx(manager: EntityManager, fetchJson: FetchJson = defaultFetchJson): Promise<{ stored: number; date: string | null }> {
  const rows = await fetchLatest(fetchJson);
  if (!rows.length) {
    console.warn("[fx] No provider answered; no rate stored today. Rows keep using the latest stored rate (FX_RATE_FALLBACK).");
    return { stored: 0, date: null };
  }
  const stored = await saveRates(manager, withPegs(rows));
  return { stored, date: rows[0].date };
}

/** Loads ECB history for every year from 2019 that isn't stored yet. */
export async function backfillFx(manager: EntityManager, fetchJson: FetchJson = defaultFetchJson, today: Date = new Date()): Promise<number> {
  const counts: Array<{ y: string; n: string }> = await manager.query(
    `SELECT to_char(date, 'YYYY') AS y, count(*) AS n FROM fx_rate WHERE currency = 'INR' AND source = 'ecb' GROUP BY 1`,
  );
  const done = new Map(counts.map((c) => [Number(c.y), Number(c.n)]));
  const lastYear = today.getUTCFullYear();
  let stored = 0;
  for (let y = Number(BACKFILL_FROM.slice(0, 4)); y <= lastYear; y++) {
    const current = y === lastYear;
    if (!current && (done.get(y) ?? 0) >= YEAR_DONE) continue;
    const from = `${y}-01-01`;
    const to = current ? isoDay(today) : `${y}-12-31`;
    try {
      stored += await saveRates(manager, withPegs(await fetchHistory(from, to, fetchJson)));
    } catch {
      console.warn(`[fx] Backfill of ${y} failed; it is tried again on the next run.`);
    }
  }
  return stored;
}

let task: ReturnType<typeof cron.schedule> | null = null;

/** Starts the job (idempotent). `manager` is AppDataSource.manager. */
export function startFxJob(manager: EntityManager): void {
  if (/^(1|true|yes)$/i.test(process.env.FX_JOB_DISABLED || "") || process.env.NODE_ENV === "test" || task) return;
  const run = async (withBackfill: boolean) => {
    try {
      const back = withBackfill ? await backfillFx(manager) : 0;
      const today = await runDailyFx(manager);
      console.log(`[fx] Stored ${today.stored} rate(s) for ${today.date ?? "no day"}${withBackfill ? `, ${back} from history` : ""}.`);
    } catch (err) {
      console.warn("[fx] Rate job failed:", (err as { code?: string })?.code ?? (err as Error)?.name);
    }
  };
  void run(true);
  // A missed year (provider down at start) is retried by the daily run too.
  task = cron.schedule("20 0 * * *", () => void run(true), { timezone: "UTC" });
}
