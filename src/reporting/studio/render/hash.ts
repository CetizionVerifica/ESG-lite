/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "0824af07d9d95bf9f0fc3ce5369e76fc54ee0941dbed3f2c5da4bd0eb560a43b";
