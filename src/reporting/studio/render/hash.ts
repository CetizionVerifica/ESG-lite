/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "31b1e847e64cd51358a5b453213fc2217c005ca98b398bee4fb1d7d2bbe51345";
