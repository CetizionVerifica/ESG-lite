/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * `npm run sync:studio-render` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; `npm run check:studio-render` fails when they differ.
 */
export const RENDER_HASH = "9f69256e8aece846a8e0260f6497dfdd87ee8e5cf4f0e30d2325bce9c17713c3";
