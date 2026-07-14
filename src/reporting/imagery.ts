// AI hero imagery for the custom engine. Generates an abstract, on-brand cover
// image per report, styled from the report's topic + the client's palette.
// Provider auto-detected from env (whichever key is present):
//   OPENAI_API_KEY -> OpenAI Images (gpt-image-1)
//   FAL_KEY        -> fal.ai (FLUX)
// Set PPTGEN_IMAGE=off to force the procedural brand-art fallback.
// Returns a data: URL (self-contained, so PDFs stay reproducible), or null.

import type { Report, Theme } from "./types";

export type ImageProvider = "openai" | "fal" | "openrouter" | null;

export function imageProvider(): ImageProvider {
  if (process.env.PPTGEN_IMAGE === "off") return null;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.FAL_KEY) return "fal";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return null;
}

export function imageReady(): boolean {
  return imageProvider() !== null;
}

function heroPrompt(report: Report, theme: Theme): string {
  const cover = report.blocks.find((b) => b.type === "cover") as { title?: string } | undefined;
  const topic = report.docTitle ?? cover?.title ?? "a corporate report";
  return (
    `Abstract, premium, editorial cover artwork for a report about "${topic}". ` +
    `Minimal and professional with subtle depth and soft geometry. On-brand color ` +
    `palette built around ${theme.colors.primary} and ${theme.colors.accent}. ` +
    `No text, no words, no letters, no logos, no charts, no human faces. ` +
    `A full-bleed background suitable behind a title.`
  );
}

/** Generate one image for a raw prompt (with retries). Null if unavailable. */
export async function generateImage(prompt: string): Promise<string | null> {
  const provider = imageProvider();
  if (!provider) return null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let out: string | null = null;
      if (provider === "openai") out = await openaiImage(prompt);
      else if (provider === "fal") out = await falImage(prompt);
      else if (provider === "openrouter") out = await openrouterImage(prompt);
      if (out) return out;
      console.warn(`[imagery] ${provider} returned no image (attempt ${attempt}/3)`);
    } catch (e) {
      console.warn(`[imagery] ${provider} error (attempt ${attempt}/3): ${String((e as Error).message ?? e)}`);
    }
  }
  return null;
}

export async function maybeHeroImage(report: Report, theme: Theme): Promise<string | null> {
  return generateImage(heroPrompt(report, theme));
}

/** Wrap a content-image description with brand + safety guidance. */
export function brandImagePrompt(desc: string, theme: Theme): string {
  return (
    `${desc}. A high-quality, cinematic editorial photograph that literally and specifically depicts ` +
    `the subject above — realistic and directly relevant to the report section. Color grading cohesive ` +
    `with a palette around ${theme.colors.primary} and ${theme.colors.accent}. ` +
    `No text, no words, no letters, no charts, no logos, no watermarks.`
  );
}

async function openrouterImage(prompt: string): Promise<string | null> {
  const model = process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://ppt-gen.local",
      "X-Title": "PPT-GEN",
    },
    body: JSON.stringify({ model, modalities: ["image", "text"], messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenRouter image ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[]; content?: unknown }; finish_reason?: string }[];
    error?: { message?: string };
  };
  if (json.error) throw new Error(`OpenRouter image: ${json.error.message}`);
  const msg = json.choices?.[0]?.message;
  const url = msg?.images?.[0]?.image_url?.url;
  if (url) return url; // already a data: URL
  throw new Error(`no image in response (finish=${json.choices?.[0]?.finish_reason ?? "?"})`);
}

async function openaiImage(prompt: string): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1536", n: 1 }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  return b64 ? `data:image/png;base64,${b64}` : null;
}

async function falImage(prompt: string): Promise<string | null> {
  const res = await fetch("https://fal.run/fal-ai/flux/dev", {
    method: "POST",
    headers: { authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "portrait_4_3", num_images: 1 }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { images?: { url?: string }[] };
  const url = json.images?.[0]?.url;
  if (!url) return null;
  const img = await fetch(url);
  if (!img.ok) return null;
  const buf = Buffer.from(await img.arrayBuffer());
  const ct = img.headers.get("content-type") ?? "image/png";
  return `data:${ct};base64,${buf.toString("base64")}`;
}
