/**
 * KPI-6 · the formula language (pure; no `eval`). A formula is arithmetic over
 * KPI codes:
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/") unary)*
 *   unary   := "-" unary | primary
 *   primary := NUMBER | ref | ("sum" | "avg") "(" ref ")" | "(" expr ")"
 *   ref     := CODE ("." part)?          e.g. WATER_WITHDRAWAL.groundwater
 *
 * `×`, `÷` and `−` are read as `*`, `/` and `-`. `sum(CODE)` / `avg(CODE)` add
 * up or average a site-level KPI over the sites (at site level they are the
 * site's value). `parseFormula` returns the AST or throws KPI_FORMULA_INVALID
 * with the position (0-based) of the problem.
 *
 * Units are checked dimensionally (`unitOf`): each code carries its KPI's
 * canonical unit; + and − need the same unit on both sides; × and ÷ combine
 * them, so `tCO2e / INR crore` is `tCO2e per INR crore`. %, ratio, count and
 * per-person words are dimensionless.
 */
import { KpiError } from "../contracts/errors";
import { unitInfo } from "../values/units";

export type FormulaFn = "sum" | "avg";
export type Ast =
  | { type: "num"; value: number }
  | { type: "ref"; code: string; part: string | null; fn: FormulaFn | null; pos: number }
  | { type: "neg"; arg: Ast }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: Ast; right: Ast; pos: number };

const fail = (problem: string, position: number | null = null): never => {
  throw new KpiError("KPI_FORMULA_INVALID", position === null ? { problems: [problem] } : { problems: [problem], position });
};

type Token =
  | { t: "num"; v: number; pos: number }
  | { t: "code"; v: string; pos: number }
  | { t: "word"; v: string; pos: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" | "."; pos: number }
  | { t: "end"; pos: number };

const OPS: Record<string, "+" | "-" | "*" | "/" | "(" | ")" | "."> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
  "(": "(",
  ")": ")",
  ".": ".",
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // A number: 12, 0.5, 1e6 (a "." after a code is the breakdown dot, never a number).
    const prev = out[out.length - 1];
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? "") && !(prev && prev.t === "code"))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      const m = /^[A-Z][A-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "code", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[a-z0-9_]/.test(ch)) {
      const m = /^[a-z0-9_]+/.exec(src.slice(i))!;
      out.push({ t: "word", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (OPS[ch]) {
      out.push({ t: "op", v: OPS[ch], pos: i });
      i++;
      continue;
    }
    fail(`Unexpected "${ch}". Use KPI codes, numbers, + - * / and brackets.`, i);
  }
  out.push({ t: "end", pos: src.length });
  return out;
}

export function parseFormula(src: string): Ast {
  if (typeof src !== "string" || !src.trim()) fail("The formula is empty.", 0);
  if (src.length > 500) fail("The formula is too long.", 500);
  const tokens = tokenize(src);
  let k = 0;
  const peek = () => tokens[k];
  const isOp = (v: string) => peek().t === "op" && (peek() as { v: string }).v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) fail(`Expected "${v}".`, peek().pos);
    k++;
  };

  const ref = (fn: FormulaFn | null): Ast => {
    const tok = peek();
    if (tok.t !== "code") return fail("Expected a KPI code.", tok.pos);
    k++;
    let part: string | null = null;
    if (isOp(".")) {
      k++;
      const p = peek();
      if (p.t !== "word") return fail("Expected a breakdown part after the dot, e.g. WATER_WITHDRAWAL.groundwater.", p.pos);
      part = p.v;
      k++;
    }
    return { type: "ref", code: tok.v, part, fn, pos: tok.pos };
  };

  const primary = (): Ast => {
    const tok = peek();
    if (tok.t === "num") {
      k++;
      return { type: "num", value: tok.v };
    }
    if (tok.t === "code") return ref(null);
    if (tok.t === "word") {
      if (tok.v !== "sum" && tok.v !== "avg") return fail(`Unknown word "${tok.v}". Functions are sum() and avg().`, tok.pos);
      k++;
      expectOp("(");
      const r = ref(tok.v);
      expectOp(")");
      return r;
    }
    if (isOp("(")) {
      k++;
      const e = expr();
      expectOp(")");
      return e;
    }
    return fail(tok.t === "end" ? "The formula ends too early." : `Unexpected "${(tok as { v: string }).v}".`, tok.pos);
  };
  const unary = (): Ast => {
    if (isOp("-")) {
      k++;
      return { type: "neg", arg: unary() };
    }
    return primary();
  };
  const term = (): Ast => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const tok = peek() as { v: "*" | "/"; pos: number };
      k++;
      left = { type: "bin", op: tok.v, left, right: unary(), pos: tok.pos };
    }
    return left;
  };
  const expr = (): Ast => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const tok = peek() as { v: "+" | "-"; pos: number };
      k++;
      left = { type: "bin", op: tok.v, left, right: term(), pos: tok.pos };
    }
    return left;
  };

  const ast = expr();
  if (peek().t !== "end") fail(`Unexpected "${(peek() as { v: unknown }).v}".`, peek().pos);
  return ast;
}

/** Every reference of an AST, in source order. */
export function refsOf(ast: Ast): Array<Extract<Ast, { type: "ref" }>> {
  switch (ast.type) {
    case "num":
      return [];
    case "ref":
      return [ast];
    case "neg":
      return refsOf(ast.arg);
    case "bin":
      return [...refsOf(ast.left), ...refsOf(ast.right)];
  }
}

/** The KPI codes a formula names, each once, in order; [] when it doesn't parse. */
export const formulaCodes = (formula: string): string[] => {
  try {
    return [...new Set(refsOf(parseFormula(formula)).map((r) => r.code))];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** A unit as base words with exponents: `tCO2e per INR crore` → {tCO2e: 1, "INR crore": -1}. */
export type UnitMap = Record<string, number>;

const DIMENSIONLESS = new Set(["%", "ratio", "count", "fraction", "times", "employee", "employees", "person", "persons", "people", "worker", "workers"]);

const unitWord = (w: string): string | null => {
  const word = w.trim();
  if (!word) return null;
  const info = unitInfo(word);
  const label = info ? info.label : word;
  return DIMENSIONLESS.has(label.toLowerCase()) ? null : label;
};

/** Reads a canonical unit (`GJ`, `tCO2e per INR crore`, `%`, null) into a UnitMap. */
export function parseUnit(unit: string | null | undefined): UnitMap {
  const out: UnitMap = {};
  const text = (unit ?? "").trim();
  if (!text) return out;
  const [num, ...dens] = text.split(/(?:^|\s+)per\s+/i);
  const add = (w: string, e: number) => {
    const word = unitWord(w);
    if (word) out[word] = (out[word] ?? 0) + e;
  };
  add(num, 1);
  for (const d of dens) add(d, -1);
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

export const sameUnit = (a: UnitMap, b: UnitMap): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

/** `{tCO2e: 1, "INR crore": -1}` → `tCO2e per INR crore`; {} → "" (no unit). */
export function formatUnit(u: UnitMap): string {
  const num = Object.keys(u).filter((k) => u[k] > 0).sort();
  const den = Object.keys(u).filter((k) => u[k] < 0).sort();
  const side = (ks: string[], sign: number) => ks.map((k) => (Math.abs(u[k]) === 1 ? k : `${k}^${sign * u[k]}`)).join(" · ");
  if (!num.length && !den.length) return "";
  return den.length ? `${num.length ? side(num, 1) + " " : ""}per ${side(den, -1)}` : side(num, 1);
}

const combine = (a: UnitMap, b: UnitMap, sign: 1 | -1): UnitMap => {
  const out: UnitMap = { ...a };
  for (const [k, e] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + sign * e;
    if (out[k] === 0) delete out[k];
  }
  return out;
};

/**
 * The unit of an AST, given the canonical unit of each code (null = unknown
 * code, reported by the caller). Throws KPI_FORMULA_INVALID when + or − mix units.
 */
export function unitOf(ast: Ast, canonicalOf: (code: string) => string | null): UnitMap {
  switch (ast.type) {
    case "num":
      return {};
    case "ref":
      return parseUnit(canonicalOf(ast.code));
    case "neg":
      return unitOf(ast.arg, canonicalOf);
    case "bin": {
      const l = unitOf(ast.left, canonicalOf);
      const r = unitOf(ast.right, canonicalOf);
      if (ast.op === "*") return combine(l, r, 1);
      if (ast.op === "/") return combine(l, r, -1);
      if (!sameUnit(l, r)) fail(`"${ast.op}" mixes ${formatUnit(l) || "a plain number"} and ${formatUnit(r) || "a plain number"}.`, ast.pos);
      return l;
    }
  }
}
