/**
 * DS-12 · the kind-aware final gate (RS-9 §5, DS-12 "Final gate by kind"),
 * registered with DS-11's `registerFinalGate` when the checks router loads.
 *
 *   1. every server check runs on the doc at the requested rev (content, numbers,
 *      GHG completeness or the sustainability year lock), plus layout checks from
 *      the last render of this rev when there is one;
 *   2. any error refuses the final: 409 DS_CHECKS_BLOCKING `{checks: errors, reason: 'errors'}`
 *      (GHG_PENDING_ENTRIES first, as 05-ux S8 words it);
 *   3. every warning id must be in `acknowledgedWarnings`, else 409 DS_CHECKS_BLOCKING
 *      `{checks: the warnings, unacknowledged: ids, reason: 'warnings'}`;
 *   4. the worker measures the final itself and refuses it before page.pdf when a layout
 *      error shows up there (jobs/worker.ts, `layoutErrors`).
 *
 * The acknowledgements are stored on the final's job (`report_job.acknowledged_warnings`,
 * linked to the version by `version_id`). DS-13 adds DS_APPROVAL_PENDING by wrapping this
 * gate (`finalGate()` → its own rule → this one).
 */
import { DsError } from "../contracts";
import type { FinalGate } from "../jobs/gate";
import { evaluate, storedMeasurements, warningIds } from "./service";

export const checksFinalGate: FinalGate = async ({ caller, docId, rev, doc, acknowledgedWarnings }) => {
  const checks = await evaluate(caller, docId, doc, await storedMeasurements(docId, rev));
  const errors = checks.filter((c) => c.severity === "error");
  if (errors.length) throw new DsError("DS_CHECKS_BLOCKING", { reason: "errors", checks: errors });
  const ack = new Set(acknowledgedWarnings);
  const unacknowledged = warningIds(checks).filter((id) => !ack.has(id));
  if (unacknowledged.length) {
    throw new DsError("DS_CHECKS_BLOCKING", { reason: "warnings", unacknowledged, checks: checks.filter((c) => c.severity === "warning" && unacknowledged.includes(c.id)) });
  }
};
