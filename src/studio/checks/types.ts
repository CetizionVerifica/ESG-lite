/**
 * DS-12 · what every check family reads, and how a Check is made.
 *
 * The check functions are pure: `CheckInput` carries the doc, its index, the
 * resolved values (DS-2, same order as docBindings / collectTokens), the
 * effective report inputs and, for GHG, the facts loaded by facts.ts. The
 * service (service.ts) loads them; unit tests build them by hand.
 */
import { CHECK_RULES, ISO_ESCALATION, type Check, type CheckId, type CheckSeverity, type ReportDoc, type ReportInputs } from "../contracts";
import type { Measurement } from "../../reporting/studio/render/measure";
import type { ResolveResponse } from "../sources/types";
import type { DocIndex } from "./walk";

export interface GhgFacts {
  periodLabel: string;
  /** Pending + rejected (not yet corrected) entries in the period for the doc's sites. */
  pending: number;
  rejected: number;
  sitesMissing: Array<{ id: number; name: string }>;
  monthsMissing: Array<{ siteId: number; siteName: string; months: string[] }>;
  /** Scope 3 categories with approved tCO₂e in the period. */
  scope3Reported: number[];
  /** GWP sets on the approved rows' factor snapshots. */
  gwpSets: string[];
  /** Factor sources (and versions) on the approved rows' factor snapshots. */
  factorSources: Array<{ source: string; version: string | null }>;
  /** Approved biogenic CO₂ in the period (t), null when no row records it. */
  biogenicT: number | null;
  /** Scope totals of the period (t), to catch biogenic added into one. */
  totals: { total: number; scope1: number; scope2: number; scope3: number } | null;
}

export interface SustainabilityFacts {
  locked: boolean;
  periodLabel: string;
}

export interface CheckInput {
  doc: ReportDoc;
  ix: DocIndex;
  resolved: Pick<ResolveResponse, "values" | "tokens">;
  inputs: ReportInputs;
  ghg?: GhgFacts;
  sustainability?: SustainabilityFacts;
  /** Browser measurements (live from the editor, or from the last render at this rev). */
  measurements?: Measurement[] | null;
}

/** The ISO 14064-1 escalation applies (D8). */
export const isoSelected = (doc: ReportDoc): boolean => doc.meta.frameworks.includes("ISO14064");

/** A check with its default severity (escalated for ISO when selected). */
export function check(doc: ReportDoc, id: CheckId, message: string, extra: Partial<Omit<Check, "id" | "message">> = {}): Check {
  let severity: CheckSeverity = extra.severity ?? CHECK_RULES[id].severity;
  if (!extra.severity && isoSelected(doc) && ISO_ESCALATION[id]) severity = ISO_ESCALATION[id] as CheckSeverity;
  const out: Check = { id, severity, message };
  if (extra.pageId) out.pageId = extra.pageId;
  if (extra.elementId) out.elementId = extra.elementId;
  if (extra.fix) out.fix = extra.fix;
  if (extra.details !== undefined) out.details = extra.details;
  return out;
}

/** True when a report input holds something (an empty string or list counts as missing). */
export function hasInput(inputs: ReportInputs, key: keyof ReportInputs): boolean {
  const v = inputs[key]?.value as unknown;
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
