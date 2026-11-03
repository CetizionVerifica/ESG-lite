/**
 * AS-1 · the help articles (src/assistant/kb/*.md) and how a question finds them.
 *
 *   loadKb(dir?)                 every article, parsed and checked (cached; throws on a bad file)
 *   searchKb(kb, text, {role, path}, limit)
 *                                the articles that best fit a question, only those
 *                                the role may read (A2), best first
 *
 * An article is Markdown with a front matter block: id, title, roles, paths,
 * keywords. Search is plain word matching (title ×3, keyword phrases ×3,
 * keyword words ×1.5, body words ×1, +2 when the article is about the page the
 * person is on). No model call and no embeddings: the set is small and the
 * results stay testable (`kb/evals.json`).
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { z } from "zod";

export const ASSISTANT_ROLES = ["User", "Manager", "Admin", "Superadmin"] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

const ArticleMetaSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(3).max(120),
  roles: z.array(z.enum(ASSISTANT_ROLES)).min(1),
  paths: z.array(z.string().regex(/^\//)).default([]),
  keywords: z.array(z.string().min(2)).default([]),
});

export interface Article {
  id: string;
  title: string;
  roles: AssistantRole[];
  paths: string[];
  keywords: string[];
  body: string;
}

interface Indexed {
  article: Article;
  title: Set<string>;
  keywordWords: Set<string>;
  phrases: string[];
  body: Set<string>;
}

export interface Kb {
  articles: Article[];
  byId: Map<string, Article>;
  index: Indexed[];
}

/** src/assistant/kb, from dist/assistant or src/assistant alike (the image keeps src, as for the MCP guide). */
export const kbDir = (): string => {
  const fromRoot = path.resolve(__dirname, "../../src/assistant/kb");
  return existsSync(fromRoot) ? fromRoot : path.join(__dirname, "kb");
};

/** `key: value` lines; `[a, b]` is a list. Enough for the article headers, nothing more. */
export function parseFrontMatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("no front matter");
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const raw = kv[2].trim();
    meta[kv[1]] = raw.startsWith("[")
      ? raw
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : raw.replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its me my of on or our so that the their them then there this to us was we what when where which who why will with you your should would could get got need want please hi hello".split(" "),
);

const stem = (w: string): string => {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
};

/** Lower case, ₂ → 2, words of 2+ characters, stop words out, crude stemming. */
export const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/₂/g, "2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const words = (text: string): string[] =>
  normalise(text)
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem);

export function parseArticle(file: string, text: string): Article {
  const { meta, body } = parseFrontMatter(text);
  const parsed = ArticleMetaSchema.safeParse(meta);
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  if (`${parsed.data.id}.md` !== path.basename(file)) throw new Error(`${file}: id must match the file name`);
  if (!body) throw new Error(`${file}: empty body`);
  return { ...parsed.data, body };
}

export function buildKb(articles: Article[]): Kb {
  const byId = new Map<string, Article>();
  for (const a of articles) {
    if (byId.has(a.id)) throw new Error(`duplicate article id ${a.id}`);
    byId.set(a.id, a);
  }
  const index = articles.map((article) => ({
    article,
    title: new Set(words(article.title)),
    keywordWords: new Set(article.keywords.flatMap(words)),
    phrases: article.keywords.map(normalise).filter((p) => p.includes(" ")),
    body: new Set(words(article.body)),
  }));
  return { articles, byId, index };
}

let cached: Kb | null = null;

export function loadKb(dir = kbDir()): Kb {
  if (cached && dir === kbDir()) return cached;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "CLAUDE.md");
  const kb = buildKb(files.sort().map((f) => parseArticle(f, readFileSync(path.join(dir, f), "utf8"))));
  if (dir === kbDir()) cached = kb;
  return kb;
}

/** True when `pagePath` is `articlePath` or below it (/data/new/x under /data/new). */
const onPath = (pagePath: string, articlePath: string): boolean =>
  pagePath === articlePath || pagePath.startsWith(articlePath.endsWith("/") ? articlePath : `${articlePath}/`);

export const MIN_SCORE = 3;

export interface Hit {
  article: Article;
  score: number;
}

/** A Superadmin supports every role, so they can read every article ("what is a period lock?" is a Manager's). */
export const canRead = (article: Article, role: AssistantRole): boolean => role === "Superadmin" || article.roles.includes(role);

export function searchKb(kb: Kb, text: string, ctx: { role: AssistantRole; path?: string | null }, limit = 4): Hit[] {
  const q = new Set(words(text));
  const phraseText = ` ${normalise(text)} `;
  const pagePath = ctx.path ? ctx.path.split(/[?#]/)[0] : null;
  const hits: Hit[] = [];
  for (const ix of kb.index) {
    if (!canRead(ix.article, ctx.role)) continue;
    let score = 0;
    for (const w of q) {
      if (ix.title.has(w)) score += 3;
      if (ix.keywordWords.has(w)) score += 1.5;
      if (ix.body.has(w)) score += 1;
    }
    for (const p of ix.phrases) if (phraseText.includes(` ${p} `)) score += 3;
    const here = !!pagePath && ix.article.paths.some((p) => onPath(pagePath, p));
    if (here) score += 2;
    // Their own articles win a close call, without lifting one over the bar.
    if (score >= MIN_SCORE) hits.push({ article: ix.article, score: score + (ix.article.roles.includes(ctx.role) ? 1 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id)).slice(0, limit);
}
