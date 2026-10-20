/**
 * DS-1 · escaping and small deterministic helpers. All text that reaches HTML
 * goes through `esc` (layer rule 7); links through `safeHref`.
 */

export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** `https:`, `http:` and `mailto:` links only; anything else is dropped. */
export const safeHref = (href: unknown): string | null => {
  const s = String(href ?? "").trim();
  return /^(https?:\/\/|mailto:)/i.test(s) ? s : null;
};

/** A hex colour or null (inline styles never take free text). */
export const hex = (c: unknown): string | null => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

/** A number printed with at most 3 decimals and no trailing zeros, so the HTML is stable. */
export const n3 = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
export const mm = (v: number): string => `${n3(v)}mm`;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** FNV-1a 32-bit, hex: a short stable hash for data marks (not security). */
export const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** JSON with sorted object keys: the same value always gives the same string. */
export const stableJson = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
};

/** A safe id fragment for SVG ids and anchors. */
export const idPart = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");
