/**
 * DS-0: the contract names the FE mirror must carry, as plain JSON. Written to
 * ci/studio-contracts.json by `npm run studio:contracts` (and checked by
 * ci/unit/ds-0-contracts.test.cjs); ESG-lite_FE keeps a copy at
 * src/lib/studio/contracts.snapshot.json and its vitest compares the mirror
 * with it. A contract change updates both files in the same DS-0 follow-up.
 */
import { STUDIO_ENUMS } from "./enums";
import { DATA_SOURCES, GHG_BREAKDOWNS, GHG_METRICS, GWP_SETS, INPUT_SOURCES, REPORT_INPUT_KEYS, REPORT_INPUT_KINDS, VERIFICATION_STATUSES, CONFORMANCE_CODES } from "./sources";
import { ASSET_KINDS, FRAME_MASKS, TEXT_MARK_TYPES, TEXT_NODE_TYPES } from "./schema";
import { DS_ERRORS } from "./errors";
import { CHECK_FIXES, CHECK_IDS, CHECK_RULES } from "./checks";
import { AI_ACTIONS, SUGGESTION_KINDS } from "./ai";

export function contractsSnapshot() {
  return {
    enums: {
      ...STUDIO_ENUMS,
      DATA_SOURCES,
      GHG_METRICS,
      GHG_BREAKDOWNS,
      REPORT_INPUT_KEYS,
      INPUT_SOURCES,
      VERIFICATION_STATUSES,
      CONFORMANCE_CODES,
      GWP_SETS,
      ASSET_KINDS,
      FRAME_MASKS,
      TEXT_NODE_TYPES,
      TEXT_MARK_TYPES,
      CHECK_IDS,
      CHECK_FIXES,
      AI_ACTIONS,
      SUGGESTION_KINDS,
    },
    reportInputKinds: REPORT_INPUT_KINDS,
    errors: Object.fromEntries(Object.entries(DS_ERRORS).map(([code, e]) => [code, e.status])),
    checks: Object.fromEntries(Object.entries(CHECK_RULES).map(([id, r]) => [id, { severity: r.severity, kinds: r.kinds }])),
  };
}
