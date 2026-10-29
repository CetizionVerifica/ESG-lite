/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "b3a36e64f4c79dffc73312dc4f5821085ec3f8e69040cb1a862d10956926de29";
