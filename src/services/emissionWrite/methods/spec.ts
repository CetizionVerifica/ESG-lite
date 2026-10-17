/**
 * Spec method (S3-0): categories with a calculation spec (per_method /
 * per_unit). The spec turns the row's fields into one activity value, which
 * then goes through the activity method's factor step.
 *
 * Moved from compute.ts without change (ci/golden).
 */
import { computeSpecActivityValue } from "../../calculationSpec";
import type { RowIssueCode } from "../../../imports/errors";
import type { CalculationSpec } from "../../../entities/ColumnConfig";
import type { CategoryContext, ComputeResult, FactorRow } from "../compute";
import { applyFactor } from "./activity";

/** Spec messages that mean "a field is missing" vs "a field holds a wrong option". */
const specIssueCode = (message: string): RowIssueCode =>
  /not configured|cannot be more than 100|Please select a unit|Please choose/.test(message) ? "FIELD_INVALID" : "FIELD_REQUIRED";

/**
 * `row.activity_data` is updated: the computed product is written into
 * `activity_value`, as the typed-entry path does. compute.ts picks this file
 * only when the category has a spec.
 */
export const compute = (ctx: CategoryContext, row: FactorRow): ComputeResult => {
  const spec = ctx.spec as CalculationSpec;
  let unit = row.activity_unit;
  const computed = computeSpecActivityValue(spec, row.activity_data, unit, row.method);
  if (!computed.ok) {
    return { ok: false, issue: { code: specIssueCode(computed.message), message: computed.message } };
  }
  const activityValue = computed.value;
  if (computed.unitKey) unit = computed.unitKey;
  row.activity_data.activity_value = String(activityValue);
  return applyFactor(activityValue, unit, row.factor);
};
