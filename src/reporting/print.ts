// Playwright print pipeline: load the self-contained HTML, wait for charts +
// Paged.js pagination to finish, then emit the PDF. Also saves PNG previews of
// the first pages so we can visually verify design quality during development.

import { chromium } from "playwright";

export interface PrintResult {
  pageCount: number;
  previews: string[];
}

export async function htmlToPdf(
  html: string,
  pdfPath: string,
  previewPngPaths: string[] = []
): Promise<PrintResult> {
  // Chromium + system libraries are provided by the Playwright base image (see
  // Dockerfile), so a plain launch works in both production and local dev.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction("window.__ready === true", { timeout: 60_000 });

    const err = await page.evaluate("window.__error || null");
    if (err) throw new Error(`In-page rendering failed:\n${err}`);

    const paged = await page.$$(".pagedjs_page");
    const pageCount = paged.length;

    const previews: string[] = [];
    for (let i = 0; i < previewPngPaths.length && i < paged.length; i++) {
      await paged[i].screenshot({ path: previewPngPaths[i] });
      previews.push(previewPngPaths[i]);
    }

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return { pageCount, previews };
  } finally {
    await browser.close();
  }
}
