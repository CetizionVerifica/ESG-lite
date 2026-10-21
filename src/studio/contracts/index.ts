/**
 * Design Studio contracts (DS-0): one import for modules. The files are the
 * source; this only re-exports them, plus the `/studio/status` shape.
 */
export * from "./enums";
export * from "./sources";
export * from "./schema";
export * from "./errors";
export * from "./checks";
export * from "./ai";
export * from "./brandkit"; // DS-3
export * from "./library"; // DS-4
export * from "./docs"; // DS-5
export * from "./jobs"; // DS-11
export * from "./resize"; // DS-10
export * from "./collab"; // DS-13
export * from "./proProps"; // PRO-0: image edits, text effects, font refs (element props)
export * from "./pro"; // PRO-0: AT-1, AT-2, PE-1, PE-2 API shapes

import type { ReportKind } from "./enums";

/** `GET /studio/status` (01-contracts §4): answers while the switch is off. */
export interface StudioStatus {
  enabled: boolean;
  kinds: Record<ReportKind, boolean>;
}
