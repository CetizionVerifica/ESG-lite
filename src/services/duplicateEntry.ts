/**
 * The saved entry a typed entry collides with (createEmission's 409): who
 * entered it, and whether the caller may replace it.
 */
import { EmissionStatus } from "../entities/Emission";
import { UserRole } from "../types/type";

type Person = { user_id: number; name?: string | null; last_name?: string | null };
type Saved = { status?: string | null; created_by?: Person | null };

/**
 * Why a Replace is refused, or null. Replace deletes the saved entry, so a
 * User replaces only their own entry that isn't approved; anyone else's, or an
 * approved one, is kept beside the new one or the new one is skipped.
 * Managers, Admins and Superadmins replace as before.
 */
export const replaceRefusal = (saved: Saved, userId: number | null | undefined, role: string | null | undefined): string | null => {
  if (role !== UserRole.USER) return null;
  if (saved.created_by == null || Number(saved.created_by.user_id) !== Number(userId)) {
    return "Someone else entered this, so you can't replace it. Keep both or skip.";
  }
  if (saved.status === EmissionStatus.APPROVED) return "This entry is already approved, so you can't replace it. Keep both or skip.";
  return null;
};

/** Who entered the saved entry (a name, never their account), and whether this caller may replace it. */
export const duplicateOwner = (saved: Saved, userId: number | null | undefined, role: string | null | undefined) => {
  const by = saved.created_by;
  const name = by ? `${by.name || ""} ${by.last_name || ""}`.trim() || null : null;
  return {
    entered_by: { name, you: by != null && Number(by.user_id) === Number(userId) },
    can_replace: replaceRefusal(saved, userId, role) === null,
  };
};

/** The saved entry as a duplicate answer shows it: the person who entered it by name only. */
export const duplicateView = <E extends Saved>(saved: E) => ({
  ...saved,
  created_by: saved.created_by
    ? { user_id: saved.created_by.user_id, name: saved.created_by.name ?? null, last_name: saved.created_by.last_name ?? null }
    : null,
});
