/**
 * DS-1 · Playwright output for the studio renderer: PDF (screen), PDF (print:
 * 3 mm bleed on print formats, optional crop marks) and PNG pages. Every
 * output loads the same HTML (html.ts, paged mode) and waits for fonts,
 * images, pagination and `window.__ready`, then runs `window.__measure()`.
 * Patterns from src/reporting/print.ts (not imported, so the GHG PDF can't
 * change). DS-11 runs these from the render queue.
 */
import { chromium, type Browser, type Page } from "playwright";
import { documentHtml, type HtmlOptions } from "./html";
import { formatSpec } from "./render/formats";
import type { Measurement } from "./render/measure";
import type { RenderData, RenderDoc } from "./render/types";

export interface OutputOptions extends Omit<HtmlOptions, "mode" | "inlineFonts"> {
  /** Reuse a browser (the worker keeps one); otherwise one is launched and closed. */
  browser?: Browser;
  timeoutMs?: number;
}

export interface PdfResult {
  pdf: Buffer;
  pageCount: number;
  measurements: Measurement[];
}

export interface PngPage {
  /** 1-based page number in the paginated document. */
  n: number;
  /** The free-form page id when the page is a sheet; null for flow pages. */
  pageId: string | null;
  png: Buffer;
}

async function withPage<T>(opts: OutputOptions, scale: number, fn: (page: Page) => Promise<T>): Promise<T> {
  const own = !opts.browser;
  const browser = opts.browser ?? (await chromium.launch());
  const context = await browser.newContext({ deviceScaleFactor: scale });
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close();
    if (own) await browser.close();
  }
}

/** Loads a rendered document and waits until it is ready. */
export async function loadDocument(page: Page, html: string, timeoutMs = 120_000): Promise<{ pageCount: number; measurements: Measurement[] }> {
  await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
  await page.waitForFunction("window.__ready === true", undefined, { timeout: timeoutMs });
  const err = await page.evaluate("window.__error || null");
  if (err) throw new Error(`Studio render failed in the page: ${String(err)}`);
  const pageCount = Number(await page.evaluate("window.__pageCount || 0"));
  const measurements = (await page.evaluate("window.__measure()")) as Measurement[];
  return { pageCount, measurements };
}

/** PDF (screen) or PDF (print, with bleed and optional crop marks). Tagged, with bookmarks. */
export async function renderPdf(doc: RenderDoc, data: RenderData | null | undefined, kind: "screen" | "print", opts: OutputOptions = {}): Promise<PdfResult> {
  const mode = kind === "print" ? "print" : "paged";
  const { document } = documentHtml(doc, data, { ...opts, mode, inlineFonts: true });
  return withPage(opts, 1, async (page) => {
    const { pageCount, measurements } = await loadDocument(page, document, opts.timeoutMs);
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    return { pdf, pageCount, measurements };
  });
}

/**
 * PNG per page at a device scale (2 = 192 dpi screen, 300/96 ≈ 3.125 for print),
 * screenshotting each paginated page box, so PNG pages equal PDF pages.
 * `pages` selects 1-based page numbers (default all).
 */
export async function renderPng(doc: RenderDoc, data: RenderData | null | undefined, pages: number[] | null, scale = 2, opts: OutputOptions = {}): Promise<PngPage[]> {
  const { document } = documentHtml(doc, data, { ...opts, mode: "paged", inlineFonts: true });
  const s = formatSpec(doc.format);
  return withPage(opts, scale, async (page) => {
    await page.setViewportSize({ width: Math.ceil((s.wMm * 96) / 25.4) + 40, height: Math.ceil((s.hMm * 96) / 25.4) + 40 });
    await loadDocument(page, document, opts.timeoutMs);
    // Pages sit edge to edge at fractional pixel offsets; a gap keeps each
    // screenshot from catching a row of its neighbour. Layout inside pages is unchanged.
    await page.addStyleTag({ content: ".pagedjs_page{margin:0 0 24px 0 !important;}" });
    const boxes = await page.$$(".pagedjs_page");
    const want = pages && pages.length ? new Set(pages) : null;
    const out: PngPage[] = [];
    for (let i = 0; i < boxes.length; i++) {
      if (want && !want.has(i + 1)) continue;
      const pageId = (await boxes[i].evaluate((el) => el.querySelector(".ds-sheet")?.getAttribute("data-page-id") ?? null)) as string | null;
      out.push({ n: i + 1, pageId, png: await boxes[i].screenshot({ type: "png" }) });
    }
    return out;
  });
}
