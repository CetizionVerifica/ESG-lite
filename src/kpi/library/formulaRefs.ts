/**
 * KPI-2 · the formula check the library can do before KPI-6 lands: a formula
 * uses only KPI codes, numbers, + − × ÷ and brackets, names KPIs that exist,
 * and doesn't loop back on itself. TODO(KPI-6): replace with the KPI-6 parser
 * (units across the formula, evaluation).
 */
const ALLOWED = /^[A-Z0-9_+\-*/().\s]+$/;
const CODE = /[A-Z][A-Z0-9_]*/g;

/** The KPI codes a formula names, each once; null when it has other characters or unbalanced brackets. */
export const formulaRefs = (formula: string): string[] | null => {
  if (!ALLOWED.test(formula)) return null;
  let depth = 0;
  for (const ch of formula) {
    if (ch === "(") depth++;
    if (ch === ")" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  return [...new Set(formula.match(CODE) ?? [])];
};

/**
 * Problems with a set of formulas: unknown codes and cycles. `formulas` maps a
 * KPI code to its formula (formula KPIs only); `known` is every KPI code.
 */
export const formulaProblems = (formulas: Map<string, string>, known: Set<string>): Array<{ code: string; problem: string }> => {
  const problems: Array<{ code: string; problem: string }> = [];
  const refs = new Map<string, string[]>();
  for (const [code, formula] of formulas) {
    const r = formulaRefs(formula);
    if (!r || !r.length) {
      problems.push({ code, problem: "The formula can only use KPI codes, numbers, + - * / and brackets." });
      continue;
    }
    for (const ref of r) if (!known.has(ref)) problems.push({ code, problem: `Unknown KPI ${ref}.` });
    refs.set(code, r);
  }
  // Depth-first search for cycles.
  const state = new Map<string, 1 | 2>();
  const visit = (code: string, path: string[]): void => {
    if (state.get(code) === 2) return;
    if (state.get(code) === 1) {
      problems.push({ code: path[0], problem: `The formula loops back: ${[...path, code].join(" → ")}.` });
      return;
    }
    state.set(code, 1);
    for (const next of refs.get(code) ?? []) if (refs.has(next)) visit(next, [...path, code]);
    state.set(code, 2);
  };
  for (const code of refs.keys()) visit(code, []);
  return problems;
};
