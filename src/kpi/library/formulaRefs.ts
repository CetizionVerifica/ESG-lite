/**
 * KPI-2's formula helpers, now answered by the KPI-6 parser and graph
 * (src/kpi/formulas): the seed's integrity check and older callers use them.
 */
import { formulaProblems as graphProblems } from "../formulas/graph";
import { parseFormula, refsOf } from "../formulas/parse";

/** The KPI codes a formula names, each once; null when it doesn't parse. */
export const formulaRefs = (formula: string): string[] | null => {
  try {
    return [...new Set(refsOf(parseFormula(formula)).map((r) => r.code))];
  } catch {
    return null;
  }
};

/**
 * Problems with a set of formulas: syntax, unknown codes and cycles (units are
 * checked by KPI-6's `definitionProblems`, which knows each KPI's unit).
 * `formulas` maps a KPI code to its formula (formula KPIs only); `known` is every KPI code.
 */
export const formulaProblems = (formulas: Map<string, string>, known: Set<string>): Array<{ code: string; problem: string }> => {
  const defs = [
    ...[...known].filter((c) => !formulas.has(c)).map((code) => ({ code, source: "manual", formula: null, canonical_unit: null })),
    ...[...formulas].map(([code, formula]) => ({ code, source: "formula", formula, canonical_unit: null })),
  ];
  // Without units every unit is "a plain number", so only syntax, unknown codes and cycles remain.
  return graphProblems(defs).map(({ code, problem }) => ({ code, problem }));
};
