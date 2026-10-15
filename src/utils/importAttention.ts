import { IMPORT_LIMITS } from "../imports/limits";

// XI5 "Needs attention": rows of an upload batch the reviewer should look at
// first. A row needs attention when the plan row it came from was matched
// below the confirmation threshold (meta.confidence < 0.8, or a
// LOW_CONFIDENCE_MATCH issue) or was edited by the uploader before commit
// (meta.edited), or was edited after commit (extra_data.import.edited). Joined
// through the batch's import plan and the row_ref IM1 stores on
// emission.extra_data.import; rows without a plan (older batches, Claude and
// API rows without meta) never need attention. `alias` is the emission alias
// of the query it is pasted into; bind `attentionBelow` to ATTENTION_BELOW.
// Shared by the approvals list (XI5) and the S3-15 IMPORT_MATCH_SURE check.
export const attentionSql = (alias: string) =>
  `((${alias}.extra_data -> 'import' ->> 'edited') = 'true'
    OR EXISTS (SELECT 1 FROM import_plan ap JOIN import_plan_row ar ON ar.plan_id = ap.plan_id
            WHERE ap.upload_batch_id = ${alias}.upload_batch_id
              AND ar.row_ref = ${alias}.extra_data -> 'import' ->> 'row_ref'
              AND (COALESCE((ar.input -> 'meta' ->> 'confidence')::float, 1) < :attentionBelow
                   OR (ar.input -> 'meta' ->> 'edited') = 'true'
                   OR ar.issues @> '[{"code":"LOW_CONFIDENCE_MATCH"}]'::jsonb)))`;

export const ATTENTION_BELOW = IMPORT_LIMITS.MAPPING_CONFIRM_BELOW;
