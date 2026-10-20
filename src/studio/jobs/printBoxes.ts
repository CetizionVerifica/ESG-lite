/**
 * DS-11 · print PDF boxes (D12, 01-contracts §7 `print`). Chromium writes only
 * a MediaBox, which for a print PDF is the trim size plus 3 mm bleed on every
 * edge. Printers also want to know where to cut, so each page gets a
 * TrimBox (the MediaBox inset by the bleed) and a BleedBox (the MediaBox).
 * Everything else (text, fonts, tags, bookmarks) is kept as Chromium made it.
 */
import { PDFDocument } from "pdf-lib";

export const MM_TO_PT = 72 / 25.4;

export async function setPrintBoxes(pdf: Buffer, bleedMm: number): Promise<Buffer> {
  if (!(bleedMm > 0)) return pdf;
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const b = bleedMm * MM_TO_PT;
  for (const page of doc.getPages()) {
    const { x, y, width, height } = page.getMediaBox();
    page.setBleedBox(x, y, width, height);
    page.setTrimBox(x + b, y + b, width - 2 * b, height - 2 * b);
  }
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
