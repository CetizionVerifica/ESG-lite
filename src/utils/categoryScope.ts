/**
 * A category's scope (S3-4, docs/scope3/01-contracts.md §1): only 'Scope 1',
 * 'Scope 2', 'Scope 3' or null (null = a saving, such as renewables). Input is
 * read case-insensitively with the spellings found in older data ("scope3",
 * "S3", "Scope-3", "scope_3"), and saved in the canonical form.
 */
export type CategoryScope = "Scope 1" | "Scope 2" | "Scope 3" | null;

export const SCOPE_VALUES: readonly CategoryScope[] = ["Scope 1", "Scope 2", "Scope 3", null];

export const SCOPE_INVALID_MESSAGE = "Scope must be Scope 1, Scope 2, Scope 3 or empty.";

/** The canonical scope for an input, or `undefined` when it isn't one of the four values. */
export const normaliseScope = (input: unknown): CategoryScope | undefined => {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  if (text === "") return null;
  const m = /^(?:scope|s)[\s_-]*([123])$/i.exec(text);
  return m ? (`Scope ${m[1]}` as CategoryScope) : undefined;
};
