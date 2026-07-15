// Playwright print pipeline: load the self-contained HTML, wait for charts +
// Paged.js pagination to finish, then emit the PDF. Also saves PNG previews of
// the first pages so we can visually verify design quality during development.

import { chromium, Browser } from "playwright";

export interface PrintResult {
  pageCount: number;
  previews: string[];
}

// Launch Chromium. In production (DO App Platform buildpack) the OS has no
// system libraries for a normal Playwright browser and we can't apt-install
// them (no root), so we use @sparticuz/chromium — a self-contained Chromium
// built for locked-down/serverless environments. Locally we use Playwright's
// own bundled browser.
async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === "production") {
    // @sparticuz/chromium is ESM-only. This project compiles to CommonJS, which
    // would turn import() into require() and can fail on ESM depending on the
    // deployed Node version. new Function preserves a real native dynamic import.
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;
    const sparticuz = (await dynamicImport("@sparticuz/chromium")).default;
    return chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: sparticuz.args,
      headless: true,
    });
  }
  return chromium.launch();
}

export async function htmlToPdf(
  html: string,
  pdfPath: string,
  previewPngPaths: string[] = []
): Promise<PrintResult> {
  const browser = await launchBrowser();
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
