/**
 * DS-1 · where the bundled faces live on disk (Node only, not mirrored).
 * Each FontId is an @fontsource package (OFL-1.1, pinned in package.json);
 * we ship its Latin subset WOFF2 per weight. Licences: fonts/LICENSES.md.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { FONTS, FONT_FILES } from "../render/fonts";
import type { FontId } from "../render/types";

const FILE_RE = /^([a-z0-9-]+)-(\d{3})\.woff2$/;

/** Absolute path of a served font file, or null when the name isn't one of ours. */
export function fontPath(file: string): string | null {
  if (!FONT_FILES.includes(file)) return null;
  const m = FILE_RE.exec(file);
  if (!m) return null;
  const id = m[1] as FontId;
  if (!FONTS[id]) return null;
  try {
    const dir = path.dirname(require.resolve(`@fontsource/${id}/package.json`));
    return path.join(dir, "files", `${id}-latin-${m[2]}-normal.woff2`);
  } catch {
    return null;
  }
}

const cache = new Map<string, string>();
/** The file as base64 (html.ts inlines fonts for render jobs). */
export function fontBase64(file: string): string | null {
  if (cache.has(file)) return cache.get(file) as string;
  const p = fontPath(file);
  if (!p) return null;
  try {
    const b64 = readFileSync(p).toString("base64");
    cache.set(file, b64);
    return b64;
  } catch {
    return null;
  }
}
