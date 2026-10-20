/**
 * DS-1 · resolved data lookup. A binding is found by `bindingKey` (stable JSON
 * of the binding), a text chip by `tokenKey`. `renderData()` zips a
 * POST /studio/resolve response with the bindings and tokens it was asked for
 * (same order) into the maps the renderer reads.
 *
 * Missing or unavailable values render "Not reported" in the muted style with
 * the reason in `data-reason` (layer rule 4, D7). Never 0, never blank.
 */
import type { DataTokenNode, RenderBinding, RenderData, RenderValue } from "./types";
import { esc, fnv1a, stableJson } from "./util";

export const NOT_REPORTED = "Not reported";

export const bindingKey = (b: RenderBinding): string => stableJson(b);
export const tokenKey = (a: DataTokenNode["attrs"]): string => stableJson({ b: a.binding, m: a.measure, f: a.format ?? null, y: a.year ?? null });
/** `data-binding-hash`: a short hash of the binding (editor overlay, checks). */
export const bindingHash = (b: RenderBinding): string => fnv1a(bindingKey(b));

export const emptyData = (): RenderData => ({ values: {}, tokens: {} });

interface ResolveResponseLike {
  values: RenderValue[];
  tokens?: RenderValue[];
  unavailable?: { bindingIdx: number; reason: string }[];
}

/** Builds RenderData from the request's bindings/tokens and the /resolve response (index-aligned). */
export function renderData(bindings: RenderBinding[], tokens: DataTokenNode[], res: ResolveResponseLike, extra?: Pick<RenderData, "flow" | "scope3">): RenderData {
  const out: RenderData = { values: {}, tokens: {}, ...extra };
  const unavailable = new Map((res.unavailable ?? []).map((u) => [u.bindingIdx, u.reason]));
  bindings.forEach((b, i) => {
    const v = res.values[i];
    if (!v) return;
    const reason = unavailable.get(i);
    out.values[bindingKey(b)] = reason && !v.unavailable ? { ...v, unavailable: { reason } } : v;
  });
  tokens.forEach((t, i) => {
    const v = res.tokens?.[i];
    if (v) out.tokens[tokenKey(t.attrs)] = v;
  });
  return out;
}

export const lookup = (data: RenderData, b: RenderBinding | undefined): RenderValue | null => (b ? (data.values[bindingKey(b)] ?? null) : null);

/** Why a value can't be shown, or null when it can. */
export const unavailableReason = (v: RenderValue | null): string | null => {
  if (!v) return "NOT_RESOLVED";
  if (v.unavailable) return v.unavailable.reason || "UNAVAILABLE";
  const hasShape = (v.series?.length ?? 0) > 0 || (v.points?.length ?? 0) > 0 || (v.links?.length ?? 0) > 0 || !!v.table;
  if (v.value === null && (v.display === "" || v.display === undefined) && !hasShape) return "NO_VALUE";
  return null;
};

/** The muted "Not reported" chip with its reason. */
export const notReported = (reason: string, cls = "ds-nr"): string => `<span class="${cls}" data-reason="${esc(reason)}">${NOT_REPORTED}</span>`;

/** Data-mark attributes for a bound element (layer rule 5). */
export const dataMarks = (b: RenderBinding | undefined, v: RenderValue | null): string => {
  if (!b) return "";
  const reason = b.source === "custom" ? null : unavailableReason(v);
  return ` data-binding-hash="${bindingHash(b)}" data-source="${esc(b.source)}"${reason ? ` data-reason="${esc(reason)}"` : ""}${b.source === "custom" ? ' data-unlinked="true"' : ""}`;
};
