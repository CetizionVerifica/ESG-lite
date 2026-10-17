/**
 * KPI-6 · evaluation (pure). The caller resolves each reference of the formula
 * for one target (a site, or the company after aggregation) and one period;
 * this file does the arithmetic and says why there is no value:
 *
 *   - a reference with no value → no value, `missing: [codes]` (never a 0);
 *   - a division by zero        → no value, `reason: "division_by_zero"`.
 *
 * `inputs` lists every reference with the value used and its status, for the
 * "How it's calculated" line and the value's snapshot; `waiting_for` lists
 * inputs that aren't approved yet.
 */
import { refsOf, type Ast, type FormulaFn } from "./parse";

export interface ResolvedInput {
  value: number | null;
  /** approved | pending (the least settled of the values used). */
  status?: string | null;
  unit?: string | null;
  /** True when some expected sites or periods had no value (the value covers the rest). */
  partial?: boolean;
}

export type Resolver = (ref: { code: string; part: string | null; fn: FormulaFn | null }) => ResolvedInput | null;

export interface EvaluatedInput {
  code: string;
  part: string | null;
  fn: FormulaFn | null;
  value: number | null;
  unit: string | null;
  status: string | null;
  partial: boolean;
}

export interface EvaluationResult {
  value: number | null;
  reason: "missing_inputs" | "division_by_zero" | null;
  /** References with no value, as written (`WATER_WITHDRAWAL.groundwater`). */
  missing: string[];
  /** References whose value isn't approved yet. */
  waiting_for: string[];
  inputs: EvaluatedInput[];
}

const label = (r: { code: string; part: string | null; fn: FormulaFn | null }) => {
  const ref = r.part ? `${r.code}.${r.part}` : r.code;
  return r.fn ? `${r.fn}(${ref})` : ref;
};

/** Rounds away binary noise (12 significant digits, as values/aggregate.ts). */
const tidy = (n: number) => Number(n.toPrecision(12));

export function evaluate(ast: Ast, resolve: Resolver): EvaluationResult {
  const inputs: EvaluatedInput[] = [];
  const seen = new Map<string, ResolvedInput | null>();
  for (const r of refsOf(ast)) {
    const key = label(r);
    if (seen.has(key)) continue;
    const got = resolve({ code: r.code, part: r.part, fn: r.fn });
    const value = got && typeof got.value === "number" && Number.isFinite(got.value) ? got.value : null;
    seen.set(key, got ? { ...got, value } : null);
    inputs.push({ code: r.code, part: r.part, fn: r.fn, value, unit: got?.unit ?? null, status: got?.status ?? null, partial: got?.partial === true });
  }
  const missing = inputs.filter((i) => i.value === null).map(label);
  const waiting_for = inputs.filter((i) => i.value !== null && i.status !== "approved").map(label);
  if (missing.length) return { value: null, reason: "missing_inputs", missing, waiting_for, inputs };

  let divByZero = false;
  const run = (n: Ast): number => {
    switch (n.type) {
      case "num":
        return n.value;
      case "ref":
        return seen.get(label(n))!.value as number;
      case "neg":
        return -run(n.arg);
      case "bin": {
        const a = run(n.left);
        const b = run(n.right);
        if (n.op === "+") return a + b;
        if (n.op === "-") return a - b;
        if (n.op === "*") return a * b;
        if (b === 0) {
          divByZero = true;
          return NaN;
        }
        return a / b;
      }
    }
  };
  const v = run(ast);
  if (divByZero || !Number.isFinite(v)) return { value: null, reason: "division_by_zero", missing: [], waiting_for, inputs };
  return { value: tidy(v), reason: null, missing: [], waiting_for, inputs };
}
