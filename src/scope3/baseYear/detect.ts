/**
 * S3-14 · what moved the frozen Scope 3 base year (pure, unit tested in
 * ci/unit/scope3-base-year.test.cjs).
 *
 * The snapshot keeps one fingerprint per approved base-year row
 * (`[ghg category, kg, factor fingerprint, dq overall, site]`), the company's
 * sites with their lease role, and the boundary status and method note per
 * category. `detectChanges` compares it with today's rows and lists each
 * change with a suggested reason (Scope 3 Standard §9.3 triggers):
 *   - methodology:  a row's method, factor dataset, version, GWP set or factor
 *                   changed; a category's boundary status or the Category 11
 *                   method note changed (no tCO₂e of its own);
 *   - data_quality: rows of a site and category replaced by rows with a better
 *                   (lower) weighted dq.overall;
 *   - structural:   rows of sites added to or removed from the company since
 *                   the freeze; a site's lease role changed (S3-11);
 *   - error:        any other edit, deletion or late row.
 * Significance follows the spec: |net Σ delta| ≥ significance_pct % of the
 * frozen total (D5: kg summed, then rounded to tCO₂e once).
 */
import { createHash } from "crypto";
import { RECALCULATION_REASONS } from "../contracts/schemas";

export const RECALC_REASONS = RECALCULATION_REASONS;
export type RecalcReason = (typeof RECALC_REASONS)[number];

/** `[ghg category (null = Unmapped), kg, factor fingerprint, dq overall, site id]`. */
export type RowPrint = [number | null, number, string, number | null, number];

export interface FrozenState {
  /** Approved base-year Scope 3 rows by emission pk_id. */
  rows: Record<string, RowPrint>;
  /** Every site of the company, with its lease role. */
  sites: Record<string, string | null>;
  /** Boundary per GHG category: `[status, method_note]`. */
  boundary: Record<string, [string, string | null]>;
}

export interface CategoryTotal {
  n: number | null;
  tco2e: number;
}

export interface BaseYearSnapshot extends FrozenState {
  version: number;
  frozen_at: string;
  base_year: number;
  year_type: "CY" | "FY";
  total_kg: number;
  total_tco2e: number;
  categories: CategoryTotal[];
}

export type ChangeKind =
  | "edited"
  | "deleted"
  | "added"
  | "method"
  | "replaced"
  | "site_added"
  | "site_removed"
  | "lease_role"
  | "boundary"
  | "cat11_assumption";

export interface BaseYearChange {
  reason: RecalcReason;
  kind: ChangeKind;
  n: number | null;
  site_id: number | null;
  rows: number;
  delta_tco2e: number;
}

export interface Comparison {
  before: { total_tco2e: number; categories: CategoryTotal[] };
  after: { total_tco2e: number; categories: CategoryTotal[] };
  delta_tco2e: number;
  /** Net change as a % of the frozen total; null when the frozen total is 0. */
  delta_pct: number | null;
  threshold_tco2e: number;
  significant: boolean;
  /** The reason behind the largest share of the change; null when nothing changed. */
  reason: RecalcReason | null;
  changes: BaseYearChange[];
  /** Same set of changes → same signature (a dismissed proposal is not raised again). */
  signature: string;
  /** The signature as worked out before #209 (tCO₂e deltas at 2 dp), which a proposal dismissed then still holds. */
  legacy_signature: string;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round3 = (n: number) => Math.round(n * 1000) / 1000; // #209: tCO₂e to 3 dp
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
export const kgToT = (kg: number) => round3(kg / 1000);
const hash = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);

/** 15 categories in order, then Unmapped (n null): kg summed per category, then rounded. */
export function categoryTotals(rows: Record<string, RowPrint>): { total_kg: number; total_tco2e: number; categories: CategoryTotal[] } {
  const kg = new Map<number | null, number>();
  let total = 0;
  for (const [n, k] of Object.values(rows)) {
    kg.set(n, (kg.get(n) ?? 0) + k);
    total += k;
  }
  const categories: CategoryTotal[] = [];
  for (let n = 1; n <= 15; n++) categories.push({ n, tco2e: kgToT(kg.get(n) ?? 0) });
  categories.push({ n: null, tco2e: kgToT(kg.get(null) ?? 0) });
  return { total_kg: total, total_tco2e: kgToT(total), categories };
}

/**
 * #209: the snapshot with its tCO₂e totals worked out again from its rows' kg, at today's precision.
 * A snapshot frozen before #209 stores them at 2 dp; the stored snapshot is never rewritten.
 */
export function retotalled(s: BaseYearSnapshot): BaseYearSnapshot {
  if (!s?.rows) return s;
  const { total_tco2e, categories } = categoryTotals(s.rows);
  return { ...s, total_tco2e, categories };
}

/** kg-weighted dq.overall of rows that have one; null when none do. */
const weightedDq = (rows: RowPrint[]) => {
  let w = 0;
  let s = 0;
  for (const [, kg, , dq] of rows) {
    if (dq === null) continue;
    const weight = Math.abs(kg) || 1e-9;
    w += weight;
    s += dq * weight;
  }
  return w ? s / w : null;
};

const REASON_ORDER: RecalcReason[] = ["error", "methodology", "structural", "data_quality"];

export function detectChanges(snapshot: BaseYearSnapshot, current: FrozenState, significancePct: number): Comparison {
  const acc = new Map<string, { reason: RecalcReason; kind: ChangeKind; n: number | null; site_id: number | null; rows: number; kg: number }>();
  const add = (reason: RecalcReason, kind: ChangeKind, n: number | null, site: number | null, kg: number, rows = 1) => {
    const key = `${reason}|${kind}|${n}|${site}`;
    const hit = acc.get(key) ?? { reason, kind, n, site_id: site, rows: 0, kg: 0 };
    hit.rows += rows;
    hit.kg += kg;
    acc.set(key, hit);
  };

  const removed: RowPrint[] = [];
  for (const [pk, then] of Object.entries(snapshot.rows)) {
    const now = current.rows[pk];
    if (!now) {
      removed.push(then);
      continue;
    }
    const [n0, kg0, fp0, , s0] = then;
    const [n1, kg1, fp1, , s1] = now;
    if (fp0 === fp1 && kg0 === kg1 && n0 === n1 && s0 === s1) continue;
    const reason: RecalcReason = fp0 !== fp1 ? "methodology" : "error";
    const kind: ChangeKind = fp0 !== fp1 ? "method" : "edited";
    if (n0 === n1) add(reason, kind, n1, s1, kg1 - kg0);
    else {
      // Moved to another category: it leaves one and joins the other.
      add(reason, kind, n0, s0, -kg0);
      add(reason, kind, n1, s1, kg1, 0);
    }
  }
  const added = Object.entries(current.rows)
    .filter(([pk]) => !(pk in snapshot.rows))
    .map(([, r]) => r);

  // Structural: rows of sites that joined or left the company since the freeze.
  const buckets = new Map<string, { removed: RowPrint[]; added: RowPrint[] }>();
  const bucket = (r: RowPrint) => {
    const key = `${r[4]}|${r[0]}`;
    const b = buckets.get(key) ?? { removed: [], added: [] };
    buckets.set(key, b);
    return b;
  };
  for (const r of removed) {
    if (!(String(r[4]) in current.sites)) add("structural", "site_removed", r[0], r[4], -r[1]);
    else bucket(r).removed.push(r);
  }
  for (const r of added) {
    if (!(String(r[4]) in snapshot.sites)) add("structural", "site_added", r[0], r[4], r[1]);
    else bucket(r).added.push(r);
  }
  // Rows of a site and category swapped for better-scored ones: data quality; anything else: error.
  for (const b of buckets.values()) {
    const before = weightedDq(b.removed);
    const after = weightedDq(b.added);
    if (b.removed.length && b.added.length && before !== null && after !== null && after < before) {
      for (const r of b.removed) add("data_quality", "replaced", r[0], r[4], -r[1]);
      for (const r of b.added) add("data_quality", "replaced", r[0], r[4], r[1], 0);
      continue;
    }
    for (const r of b.removed) add("error", "deleted", r[0], r[4], -r[1]);
    for (const r of b.added) add("error", "added", r[0], r[4], r[1]);
  }

  for (const [site, role] of Object.entries(snapshot.sites)) {
    if (site in current.sites && (current.sites[site] ?? null) !== (role ?? null)) add("structural", "lease_role", null, Number(site), 0, 0);
  }
  for (const [n, [status, note]] of Object.entries(snapshot.boundary ?? {})) {
    const now = current.boundary?.[n];
    if (!now) continue;
    if (now[0] !== status) add("methodology", "boundary", Number(n), null, 0, 0);
    if (Number(n) === 11 && (now[1] ?? null) !== (note ?? null)) add("methodology", "cat11_assumption", 11, null, 0, 0);
  }

  const listChanges = (toT: (kg: number) => number): BaseYearChange[] =>
    [...acc.values()]
      .map((c) => ({ reason: c.reason, kind: c.kind, n: c.n, site_id: c.site_id, rows: c.rows, delta_tco2e: toT(c.kg) }))
      .sort((a, b) => Math.abs(b.delta_tco2e) - Math.abs(a.delta_tco2e) || (a.n ?? 99) - (b.n ?? 99) || (a.site_id ?? 0) - (b.site_id ?? 0) || a.kind.localeCompare(b.kind));
  const changes = listChanges(kgToT);

  // The reason with the largest absolute share; ties go by REASON_ORDER.
  const byReason = new Map<RecalcReason, number>();
  for (const c of acc.values()) byReason.set(c.reason, (byReason.get(c.reason) ?? 0) + Math.abs(c.kg));
  let reason: RecalcReason | null = null;
  for (const r of REASON_ORDER) {
    if (!byReason.has(r)) continue;
    if (reason === null || byReason.get(r)! > byReason.get(reason)!) reason = r;
  }

  const frozen = retotalled(snapshot);
  const after = categoryTotals(current.rows);
  const deltaKg = after.total_kg - snapshot.total_kg;
  const thresholdKg = (Math.abs(snapshot.total_kg) * significancePct) / 100;
  const significant = deltaKg !== 0 && Math.abs(deltaKg) >= thresholdKg;
  // kg at 4 dp in key order, so the signature doesn't follow the precision tCO₂e is shown at (#209).
  const signature = hash(
    [...acc.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => [c.reason, c.kind, c.n, c.site_id, c.rows, round4(c.kg)]),
  );
  const legacy_signature = hash(listChanges((kg) => round2(kg / 1000)).map((c) => [c.reason, c.kind, c.n, c.site_id, c.rows, c.delta_tco2e]));

  return {
    before: { total_tco2e: frozen.total_tco2e, categories: frozen.categories },
    after: { total_tco2e: after.total_tco2e, categories: after.categories },
    delta_tco2e: kgToT(deltaKg),
    delta_pct: snapshot.total_kg ? round1((deltaKg / snapshot.total_kg) * 100) : null,
    threshold_tco2e: kgToT(thresholdKg),
    significant,
    reason,
    changes,
    signature,
    legacy_signature,
  };
}

/** "Category 1" for the largest category change, for the proposal sentence. */
export function largestCategory(c: Comparison): number | null {
  const by = new Map<number | null, number>();
  for (const x of c.changes) by.set(x.n, (by.get(x.n) ?? 0) + x.delta_tco2e);
  let best: number | null = null;
  let size = 0;
  for (const [n, d] of by) {
    if (n !== null && Math.abs(d) > size) {
      best = n;
      size = Math.abs(d);
    }
  }
  return best;
}
