/**
 * DS-11 · the final gate. `POST /docs/:id/jobs {kind: 'final'}` asks it before
 * a final is queued. DS-12 replaces the default with the checks gate
 * (`registerFinalGate(fn)`, one call at module load, `// DS-12`); DS-13 adds
 * the approval rule (DS_APPROVAL_PENDING) the same way.
 *
 * Until then the default gate is the RS-5 minimum, per kind:
 *   - ghg: no pending emission entries in the period for the doc's sites
 *     (D6, `GHG_PENDING_ENTRIES`) → 409 DS_CHECKS_BLOCKING;
 *   - sustainability: the year's KPI values are locked (R3) → 409 DS_YEAR_NOT_LOCKED.
 */
import { DsError, type ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { checkSites, readableSites } from "../sources/resolve";
import { loadGhgReadiness, loadSustainabilityReadiness } from "../docs/readiness";

export interface FinalGateInput {
  caller: StudioCaller;
  docId: number;
  rev: number;
  doc: ReportDoc;
  acknowledgedWarnings: string[];
}
/** Throws a DsError to refuse the final; returns to allow it. */
export type FinalGate = (input: FinalGateInput) => Promise<void>;

export const defaultFinalGate: FinalGate = async ({ caller, doc }) => {
  if (doc.kind === "ghg") {
    const { readable, all } = await readableSites(caller);
    const siteIds = checkSites(doc.meta.sites, readable, all);
    const r = await loadGhgReadiness(caller, { year: doc.meta.year, yearType: doc.meta.yearType, siteIds });
    if (r.pendingRows > 0) {
      throw new DsError("DS_CHECKS_BLOCKING", {
        checks: [{ id: "GHG_PENDING_ENTRIES", severity: "error", count: r.pendingRows, message: `Pending entries: ${r.pendingRows}. Approve them in Review before the final.`, link: "/data/approvals" }],
      });
    }
    return;
  }
  const r = await loadSustainabilityReadiness(caller, doc.meta.year);
  if (!r.locked) throw new DsError("DS_YEAR_NOT_LOCKED");
};

let gate: FinalGate = defaultFinalGate;

export function registerFinalGate(fn: FinalGate | null): void {
  gate = fn ?? defaultFinalGate;
}
export const finalGate = (): FinalGate => gate;
