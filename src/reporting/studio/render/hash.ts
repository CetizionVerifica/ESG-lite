/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "6fb93e79d00874214543d768c97b75ddda7c51276e25c34e812f4d1086e2d6c4";
