/**
 * DS-13 · template locks under brand controls (RS-10 §2, DS-13 §5).
 *
 * Elements a template author locked (`templateLocked: true`, set when a design is saved as a
 * template with "Lock locked elements for others") can't be moved or edited in designs made
 * from it: the editor honours the flag (DS-6). With `company.brand_controls` on, the server
 * also refuses an Admin's save that changes, removes or unlocks one (403 DS_ROLE,
 * `details.reason = 'template_locked'`, `details.elementIds`). Managers and Superadmins may
 * still unlock them (the editor's "Unlock template element").
 *
 *   lockedChanges(before, after)        ids of template-locked elements of `before` that `after` changed (pure)
 *   assertTemplateLocks(caller, b, a)   the rule above (DS-5 PATCH calls it, `// DS-13`)
 */
import { AppDataSource } from "../../config/data-source";
import { DsError } from "../contracts";
import type { StudioCaller } from "../guard";
import { stableStringify } from "../sources/hash";

type Json = Record<string, any>;

export function lockedChanges(before: Json, after: Json): string[] {
  const now = new Map<string, Json>();
  for (const p of after?.pages ?? []) for (const e of p?.elements ?? []) now.set(String(e.id), e);
  const out: string[] = [];
  for (const p of before?.pages ?? []) {
    for (const e of p?.elements ?? []) {
      if (e?.templateLocked !== true) continue;
      const next = now.get(String(e.id));
      if (!next || stableStringify(next) !== stableStringify(e)) out.push(String(e.id));
    }
  }
  return out;
}

export const brandControlsOn = async (companyId: number): Promise<boolean> => {
  const [r]: Json[] = await AppDataSource.query(`SELECT brand_controls AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return r?.on === true;
};

export async function assertTemplateLocks(caller: StudioCaller, before: Json, after: Json): Promise<void> {
  if (caller.roleClass === "M") return;
  const changed = lockedChanges(before, after);
  if (!changed.length) return;
  if (!(await brandControlsOn(caller.companyId))) return;
  throw new DsError("DS_ROLE", { reason: "template_locked", elementIds: changed.slice(0, 50) }, "These elements are locked by the template. Ask a Manager to unlock them.");
}
