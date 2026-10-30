/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "e08511fd2c87edfbde465f0ea4cd23bfbbcefd1c5563c13479f87b7f9efc8f30";
