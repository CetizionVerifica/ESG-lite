import { AsyncLocalStorage } from "node:async_hooks";

/**
 * M6: the company a person with sites at several clients chose in the account menu, sent as
 * `X-Company-Id`. Only a preference for "which company is this user in": resolveUserCompanyId
 * honours it when the user belongs to that company, else the usual rule applies. It never widens
 * access: site scope and company guards are unchanged.
 */
const store = new AsyncLocalStorage<{ companyId: number }>();

export const preferredCompanyId = (): number | null => store.getStore()?.companyId ?? null;

/** A positive integer header value, else null (an absent or malformed header is ignored). */
export const parseCompanyHeader = (value: unknown): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return id > 0 ? id : null;
};

/** Runs the rest of the request with the chosen company as the preference. */
export const withPreferredCompany = <T>(companyId: number | null, fn: () => T): T => (companyId ? store.run({ companyId }, fn) : fn());
