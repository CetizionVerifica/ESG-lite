// AT-2 · the `suggest_layouts` golden (group "ai"): the recorded answer in
// ci/fixtures/studio/ai/recorded.json goes through the same interpret → build → check
// steps as a live call (swap/layouts.ts), against the library read from data/studio
// (no DB). The golden records each option's layout, the frame every element moves to
// and the decoration the layout adds, so a change in composition shows up here.
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../..");
const dist = (p) => require(path.join(ROOT, "dist", p));

function libraryLayouts() {
  const { readLibrarySeeds } = dist("studio/library/seed.js");
  return readLibrarySeeds().layouts.map((l, i) => ({ id: i + 1, companyId: null, kind: l.kind, format: l.format, pageKind: l.page_kind, name: l.name, thumbnailUrl: null, page: l.page, slug: l.slug, family: l.family, role: l.role, sort: l.sort }));
}

function layoutsGolden() {
  const { RECORDED, DOCS } = require("./ai.cjs");
  const compose = dist("studio/swap/compose.js");
  const L = dist("studio/swap/layouts.js");
  const { SuggestionSchema } = dist("studio/contracts/index.js");
  const rec = RECORDED.suggest_layouts;
  if (!rec) return { action: "suggest_layouts", built: true, recorded: false };
  const doc = DOCS[rec.doc];
  const page = L.layoutTargetPage(doc, rec.target);
  const ranked = compose.rankLayouts(page, libraryLayouts().filter((l) => l.kind === doc.kind && l.format === doc.format)).map((r) => r.layout);
  const candidates = ranked.slice(0, L.LAYOUT_CANDIDATES);
  const result = L.interpretLayouts(rec.answer, doc, page, candidates);
  if (result.issues) return { action: "suggest_layouts", built: true, valid: false, issues: result.issues };
  const suggestion = L.toLayoutSuggestion("recorded", L.completeOptions(doc, page, result.options, ranked));
  const before = new Map(page.elements.map((e) => [e.id, e]));
  return {
    action: "suggest_layouts",
    built: true,
    valid: SuggestionSchema.safeParse(suggestion).success,
    candidates: candidates.map((l) => l.slug),
    options: suggestion.payload.layoutOptions.map((o, i) => {
      const p = suggestion.payload.pages[i];
      return {
        id: o.id,
        layoutSlug: o.layoutSlug,
        name: o.name,
        reason: o.reason,
        issues: compose.layoutOptionIssues(doc, page, p),
        placed: o.placedElementIds,
        moved: Object.fromEntries(p.elements.filter((e) => before.has(e.id) && JSON.stringify(before.get(e.id).frame) !== JSON.stringify(e.frame)).map((e) => [e.id, e.frame])),
        added: p.elements.filter((e) => !before.has(e.id)).map((e) => `${e.id}:${e.type}`),
      };
    }),
  };
}

module.exports = { layoutsGolden, libraryLayouts };
