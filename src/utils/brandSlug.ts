// Brand slugs name a client in its sign-in link (/{slug}/login, P01). Lower
// case letters, digits and single dashes, 1–63 characters, so they also work
// as a subdomain label later.
export const BRAND_SLUG_MAX = 63;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const isBrandSlug = (value: unknown): value is string =>
  typeof value === "string" && SLUG.test(value) && !value.includes("--");

// "Midal Cables W.L.L." -> "midal-cables-w-l-l". Empty when nothing usable is left.
export const slugify = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BRAND_SLUG_MAX)
    .replace(/-+$/g, "");
