/**
 * DS-4 · every seed file the library ships, as {relative path → text}.
 * `npm run seeds:ds-4` writes them under data/studio/ (and the renderer's
 * Lucide icon table); ci/unit/ds-4-library.test.cjs checks the committed
 * files equal this output.
 */
import { elementSeeds } from "./elements";
import { GHG_FAMILIES } from "./ghg";
import type { FamilySeed } from "./kit";
import { SUSTAINABILITY_FAMILIES } from "./sustainability";
import { ELEMENT_GROUPS } from "../../contracts/library";

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

export const ALL_FAMILIES = (): FamilySeed[] => [...GHG_FAMILIES(), ...SUSTAINABILITY_FAMILIES()];

/** data/studio/** files (paths relative to data/studio). */
export function seedFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { template, layouts } of ALL_FAMILIES()) {
    const base = `templates/${template.kind}/${template.family}`;
    out[`${base}/template.json`] = json(template);
    out[`${base}/thumbs/README.md`] =
      "Cover and page thumbnails for this template are rendered by DS-11 `thumbnail` jobs with the default brand and cached in R2 (`report_template.thumbnail_key`). Nothing is committed here.\n";
    const used = new Set<string>();
    layouts.forEach((l, i) => {
      if (used.has(l.role)) throw new Error(`${template.family}: two layouts with role ${l.role}`);
      used.add(l.role);
      out[`${base}/layouts/${String(i + 1).padStart(2, "0")}-${l.role}.json`] = json({ ...l, sort: i + 1 });
    });
  }
  const elements = elementSeeds();
  for (const g of ELEMENT_GROUPS) out[`elements/${g}.json`] = json(elements.filter((e) => e.group === g));
  return out;
}
