/**
 * S3-8 · warnings on transport rows (01-contracts §7). They never block and
 * never change a total; they are worked out from the row as entered.
 */
import { normalizeUnitKey } from "../calculationSpec";
import { SCOPE3_WARNINGS } from "../../scope3/contracts/errors";
import type { CategoryContext, EngineIssue } from "./compute";
import { ghgCategoryOfContext } from "./methods/fera";

/** A distance unit: km, tonne.km, passenger.km, vehicle.km, miles… */
const DISTANCE_UNIT = /(^|\.)(km|kms|mile|miles)$/;

/** ESTIMATED_DISTANCE: the row says its figure is an estimate and it is entered as a distance (the route helper's estimate). */
export const estimatedDistanceWarning = (isEstimate: boolean | undefined, unit: unknown): EngineIssue | null =>
  isEstimate && DISTANCE_UNIT.test(normalizeUnitKey(unit))
    ? { code: "ESTIMATED_DISTANCE", message: `${SCOPE3_WARNINGS.ESTIMATED_DISTANCE} Replace it with the measured distance when you have it.` }
    : null;

/** The "Who paid for this transport?" answers on the S3-8 form (`extra_data.paid_by`). */
export const PAID_BY_US = "We paid";

/**
 * TRANSPORT_PAID_BY_MISMATCH: a Category 9 row the company says it paid for.
 * Transport the company pays for is Category 4 (guidance Table 4.1, Figure 9.1).
 * A Category 4 row paid by someone else is not flagged: inbound transport of
 * purchased goods is Category 4 whoever paid, and the form doesn't record the
 * direction.
 */
export const paidByMismatchWarning = (ctx: CategoryContext, extraData: Record<string, unknown> | undefined): EngineIssue | null =>
  ghgCategoryOfContext(ctx) === 9 && String(extraData?.paid_by ?? "").trim() === PAID_BY_US
    ? {
        code: "TRANSPORT_PAID_BY_MISMATCH",
        message: `${SCOPE3_WARNINGS.TRANSPORT_PAID_BY_MISMATCH} Transport you paid for belongs in Category 4 (Upstream transportation and distribution), not Category 9.`,
      }
    : null;
