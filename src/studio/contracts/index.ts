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

import type { ReportKind } from "./enums";

/** `GET /studio/status` (01-contracts §4): answers while the switch is off. */
export interface StudioStatus {
  enabled: boolean;
  kinds: Record<ReportKind, boolean>;
}
