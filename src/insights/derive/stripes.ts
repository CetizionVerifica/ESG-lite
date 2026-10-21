/**
 * IN-8 · emission stripes (pure, unit tested in ci/unit/in-8-stripes.test.cjs).
 *
 *   stripesSeries(months, byMonth, max)  the last `max` months of `months` (oldest first), each
 *                                        the month's approved net from Overview's by_month, or
 *                                        null when the month has no approved monthly tCO₂e
 *                                        (gross and saved both 0: missing, never 0); leading
 *                                        months before the first value are dropped so the band
 *                                        starts at the data; min / max over the values.
 */
export interface MonthNet {
  month: string;
  gross: number;
  saved: number;
  net: number;
}

export function stripesSeries(months: string[], byMonth: Map<string, MonthNet>, max: number): { months: string[]; values: Array<number | null>; min: number; max: number; count: number } {
  const window = months.slice(-max);
  const values = window.map((m) => {
    const b = byMonth.get(m);
    return b && (b.gross !== 0 || b.saved !== 0) ? b.net : null;
  });
  const first = values.findIndex((v) => v !== null);
  const kept = first < 0 ? [] : values.slice(first);
  const keptMonths = first < 0 ? [] : window.slice(first);
  const known = kept.filter((v): v is number => v !== null);
  return {
    months: keptMonths,
    values: kept,
    min: known.length ? Math.min(...known) : 0,
    max: known.length ? Math.max(...known) : 0,
    count: known.length,
  };
}
