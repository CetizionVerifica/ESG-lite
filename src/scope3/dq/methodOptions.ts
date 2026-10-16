/**
 * S3-3 · `column_config.method_options`: the methods a form offers, most
 * specific first, each with the units it shows (01-contracts.md §6,
 * `MethodOptionsSchema`). The shape and the rules come from the S3-0
 * contracts; this file only reads and checks them.
 *
 * Writes are validated with `MethodOptionsSchema` and refused by name.
 *
 * Reads tolerate a list of bare method keys (`["distance_based", …]`), the
 * shape the first cut of this column stored: each becomes
 * `{method, units: []}`, meaning "this method, no unit limit". `units: []`
 * is never accepted on a write (the schema needs at least one unit), so it
 * only ever describes a legacy row. Anything else in the column (an unknown
 * key, `unknown`, a repeat, a stray value) is skipped rather than trusted:
 * the engine must never refuse rows because of a form it can't read.
 */
import { MethodOptionsSchema, type MethodOptions } from "../contracts/schemas";
import { MethodSchema, type Method } from "../contracts/ghgCategory";

/** One entry as read from the column; `units` is empty only for a legacy bare key. */
export type StoredMethodOption = { method: Exclude<Method, "unknown">; units: string[] };

/** The column as stored, in either shape, normalised to `{method, units}` entries. */
export const readMethodOptions = (value: unknown): StoredMethodOption[] => {
  if (!Array.isArray(value)) return [];
  const out: StoredMethodOption[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? { method: item, units: [] as unknown[] } : item && typeof item === "object" ? (item as { method?: unknown; units?: unknown }) : null;
    const method = MethodSchema.safeParse(raw?.method);
    if (!method.success || method.data === "unknown" || out.some((o) => o.method === method.data)) continue;
    const units = Array.isArray(raw?.units) ? raw.units.filter((u): u is string => typeof u === "string" && u.trim() !== "").map((u) => u.trim()) : [];
    out.push({ method: method.data, units });
  }
  return out;
};

/** The method keys a form offers, most specific first; empty when it offers no list. */
export const offeredMethods = (value: unknown): Method[] => readMethodOptions(value).map((o) => o.method);

export type MethodOptionsParse = { ok: true; value: MethodOptions | null | undefined } | { ok: false; field: string; message: string };

/**
 * `method_options` on a column-config write: absent keeps what is stored,
 * `null` (or an empty list) clears it, anything else must pass
 * `MethodOptionsSchema`. A refusal names the entry and the field at fault.
 */
export const parseMethodOptionsInput = (value: unknown): MethodOptionsParse => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || (Array.isArray(value) && value.length === 0)) return { ok: true, value: null };
  const parsed = MethodOptionsSchema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = ["method_options", ...(issue?.path ?? [])].map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("");
  const message =
    issue?.path[issue.path.length - 1] === "method"
      ? `${field}: not a method a form can offer.`
      : issue?.path.includes("units")
        ? `${field}: each method needs at least one unit (text, up to 50 characters).`
        : `${field}: ${Array.isArray(value) ? issue?.message ?? "not valid." : "must be a list of {method, units}."}`;
  return { ok: false, field, message };
};
