/**
 * KPI-6 · the dependency graph of calculated KPIs (pure), across library KPIs
 * and a company's own. A formula KPI depends on the codes its formula names.
 *
 *   formulaProblems(defs)          parse errors, unknown codes, unit mismatches and cycles
 *   definitionProblems(def, defs)  the problems that concern one KPI being saved
 *   dependantsOf(defs, codes)      formula KPIs that (transitively) use any of `codes`
 *   evaluationOrder(defs, codes)   those formula KPIs, inputs before the KPIs that use them
 */
import { KpiError } from "../contracts/errors";
import { formatUnit, parseFormula, parseUnit, refsOf, sameUnit, unitOf, type Ast } from "./parse";

export interface GraphDef {
  code: string;
  source: string;
  formula: string | null;
  canonical_unit: string | null;
}

export interface FormulaProblem {
  code: string;
  problem: string;
  position?: number;
}

const problemOf = (code: string, err: unknown): FormulaProblem => {
  if (err instanceof KpiError) {
    const d = err.details as { problems?: string[]; position?: number } | undefined;
    return { code, problem: d?.problems?.[0] ?? err.message, ...(d?.position !== undefined ? { position: d.position } : {}) };
  }
  throw err;
};

/** Parsed formulas by code (formula KPIs whose formula parses). */
function parsed(defs: GraphDef[]): { asts: Map<string, Ast>; problems: FormulaProblem[] } {
  const asts = new Map<string, Ast>();
  const problems: FormulaProblem[] = [];
  for (const d of defs) {
    if (d.source !== "formula" || !d.formula) continue;
    try {
      asts.set(d.code, parseFormula(d.formula));
    } catch (err) {
      problems.push(problemOf(d.code, err));
    }
  }
  return { asts, problems };
}

/** Every problem of every formula KPI in `defs`: syntax, unknown codes, units against the KPI's canonical unit, cycles. */
export function formulaProblems(defs: GraphDef[]): FormulaProblem[] {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const { asts, problems } = parsed(defs);
  for (const [code, ast] of asts) {
    const unknown = [...new Set(refsOf(ast).map((r) => r.code).filter((c) => !byCode.has(c)))];
    for (const u of unknown) problems.push({ code, problem: `Unknown KPI ${u}.` });
    if (unknown.length) continue;
    try {
      const got = unitOf(ast, (c) => byCode.get(c)?.canonical_unit ?? null);
      const want = parseUnit(byCode.get(code)!.canonical_unit);
      if (!sameUnit(got, want)) problems.push({ code, problem: `The formula gives ${formatUnit(got) || "a plain number"}, not ${formatUnit(want) || "a plain number"}.` });
    } catch (err) {
      problems.push(problemOf(code, err));
    }
  }
  // Depth-first search for cycles.
  const deps = new Map([...asts].map(([code, ast]) => [code, [...new Set(refsOf(ast).map((r) => r.code))]]));
  const state = new Map<string, 1 | 2>();
  const visit = (code: string, path: string[]): void => {
    if (state.get(code) === 2) return;
    if (state.get(code) === 1) {
      const loop = [...path.slice(path.indexOf(code)), code];
      problems.push({ code: loop[0], problem: `The formula loops back: ${loop.join(" → ")}.` });
      return;
    }
    state.set(code, 1);
    for (const next of deps.get(code) ?? []) if (deps.has(next)) visit(next, [...path, code]);
    state.set(code, 2);
  };
  for (const code of deps.keys()) visit(code, []);
  return problems;
}

/**
 * The problems saving `def` among `defs` would cause: its own, and any new
 * one it brings to other formulas (a cycle through it, or a formula that uses
 * it and no longer gets its unit). Problems that were there before are left
 * to their own KPIs.
 */
export function definitionProblems(def: GraphDef, defs: GraphDef[]): FormulaProblem[] {
  const others = defs.filter((d) => d.code !== def.code);
  const key = (p: FormulaProblem) => `${p.code}|${p.problem}`;
  const before = new Set(formulaProblems(others).map(key));
  return formulaProblems([...others, def]).filter((p) => p.code === def.code || !before.has(key(p)));
}

/** Codes each formula KPI uses directly. */
export function dependencies(defs: GraphDef[]): Map<string, string[]> {
  const { asts } = parsed(defs);
  return new Map([...asts].map(([code, ast]) => [code, [...new Set(refsOf(ast).map((r) => r.code))]]));
}

/** Formula KPIs that use any of `codes`, directly or through other formula KPIs. */
export function dependantsOf(defs: GraphDef[], codes: Iterable<string>): Set<string> {
  const deps = dependencies(defs);
  const out = new Set<string>();
  const queue = [...codes];
  while (queue.length) {
    const c = queue.shift()!;
    for (const [code, uses] of deps) {
      if (!out.has(code) && uses.includes(c)) {
        out.add(code);
        queue.push(code);
      }
    }
  }
  return out;
}

/** The formula KPIs in `codes` (all of them when omitted), each after the formula KPIs it uses. Cycles are left out. */
export function evaluationOrder(defs: GraphDef[], codes?: Iterable<string>): string[] {
  const deps = dependencies(defs);
  const wanted = new Set(codes ?? deps.keys());
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (code: string): boolean => {
    if (state.get(code) === 2) return true;
    if (state.get(code) === 1) return false;
    state.set(code, 1);
    let ok = true;
    for (const next of deps.get(code) ?? []) if (deps.has(next)) ok = visit(next) && ok;
    state.set(code, 2);
    if (ok && wanted.has(code)) out.push(code);
    return ok;
  };
  for (const code of deps.keys()) visit(code);
  return out;
}
