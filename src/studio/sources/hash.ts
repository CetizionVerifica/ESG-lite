/**
 * DS-2 · data hashes (layer rule 5): `sha256(sorted resolved values + inputs +
 * period + sites)`. Stored on autosave and versions (DS-5, DS-13), compared
 * for drift (DS-13). Stable across runs and key order; it changes exactly
 * when a resolved figure, its approval time, an input, the period or the
 * sites change.
 *
 *   stableStringify(v)       JSON with object keys sorted (arrays keep order)
 *   bindingsHash(bindings)   identifies a set of bindings (the resolve cache key)
 *   dataHash({…})            the doc's data hash, "sha256:<hex>"
 *   elementHash(values)      the hash of only the values one element uses (drift, RS-10)
 */
import { createHash } from "crypto";
import type { ReportInputs } from "../contracts";
import type { ResolvedBinding } from "./types";

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export const bindingsHash = (bindings: unknown): string => sha(stableStringify(bindings));

/** The part of a resolved binding that is data (not presentation): value, unit, series, approval, availability. */
const dataPart = (r: ResolvedBinding) => ({
  source: r.source,
  value: r.value,
  unit: r.unit,
  series: r.series ?? null,
  approvedAt: r.approvedAt ?? null,
  compare: r.compare ? { value: r.compare.value, year: r.compare.year } : null,
  target: r.target ?? null,
  unavailable: r.unavailable?.reason ?? null,
  // Input bindings carry their text in `display`.
  text: r.source === "input" ? r.display : null,
});

/** Inputs without who/when they were edited: only what a page can show. */
const inputValues = (inputs: ReportInputs) =>
  Object.fromEntries(
    Object.entries(inputs)
      .filter(([, e]) => e !== undefined)
      .map(([k, e]) => [k, (e as { value: unknown }).value]),
  );

export function dataHash(args: { year: number; yearType: string; siteIds: number[]; values: ResolvedBinding[]; inputs: ReportInputs }): string {
  const values = args.values.map((v) => stableStringify(dataPart(v))).sort();
  const payload = stableStringify({
    period: { year: args.year, yearType: args.yearType },
    sites: [...args.siteIds].sort((a, b) => a - b),
    values,
    inputs: inputValues(args.inputs),
  });
  return `sha256:${sha(payload)}`;
}

export const elementHash = (values: ResolvedBinding[]): string => `sha256:${sha(stableStringify(values.map(dataPart)))}`;
