// PRO-0 contract tests (docs/design-studio/pro/): the element props for photo
// edits (PE-1) and text effects / custom fonts (PE-2) are optional, so the
// fixture docs stay valid; in-range values pass and out-of-range ones fail;
// the AT-1 / AT-2 / PE-1 / PE-2 request and model-output schemas; the new
// error codes; the contracts snapshot carries the PRO-0 enums. Runs against
// the build:   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const c = require(path.resolve("dist/studio/contracts/index.js"));
const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve(`ci/fixtures/studio/${name}.json`), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const ok = (schema, v) => schema.safeParse(v).success;

const image = (props = {}) => ({
  id: "img1",
  type: "image",
  frame: { x: 10, y: 10, w: 50, h: 40, rotation: 0 },
  z: 1,
  source: "user",
  props: { assetId: "a1", fit: "cover", alt: "Plant", ...props },
});
const frame = (props = {}) => ({ ...image(), id: "fr1", type: "frame", props: { mask: "circle", assetId: "a1", fit: "cover", alt: "", ...props } });
const text = (props = {}) => ({
  id: "t1",
  type: "text",
  frame: { x: 10, y: 60, w: 100, h: 20, rotation: 0 },
  z: 2,
  source: "user",
  props: { doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Net zero by 2040" }] }] }, style: "title", align: "left", ...props },
});

test("existing docs stay valid: the fixtures parse unchanged", () => {
  for (const name of ["ghg-doc", "sustainability-doc"]) {
    const r = c.ReportDocSchema.safeParse(fixture(name));
    assert.ok(r.success, `${name}: ${r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))}`);
  }
  assert.ok(ok(c.ElementSchema, image()));
  assert.ok(ok(c.ElementSchema, text()));
});

test("PE-1 image and frame props: adjust, filter, duotone, originalAssetId", () => {
  for (const make of [image, frame]) {
    assert.ok(ok(c.ElementSchema, make({ adjust: { brightness: 12, contrast: 8, saturation: 0, warmth: -5, blur: 0 }, filter: "vivid", duotone: { dark: "#0F2A44", light: "#9AD1D4" }, originalAssetId: "a0" })));
    assert.ok(ok(c.ElementSchema, make({ adjust: {}, duotone: null, filter: "none" })), "every key optional, duotone off");
    assert.ok(!ok(c.ElementSchema, make({ adjust: { brightness: 101 } })), "brightness ≤ 100");
    assert.ok(!ok(c.ElementSchema, make({ adjust: { blur: -1 } })), "blur ≥ 0");
    assert.ok(!ok(c.ElementSchema, make({ adjust: { contrast: 1.5 } })), "integers");
    assert.ok(!ok(c.ElementSchema, make({ adjust: { sharpness: 3 } })), "strict keys");
    assert.ok(!ok(c.ElementSchema, make({ filter: "sepia" })), "known presets only");
    assert.ok(!ok(c.ElementSchema, make({ duotone: { dark: "navy", light: "#FFFFFF" } })), "hex colours");
  }
  assert.deepEqual([...c.IMAGE_FILTERS], ["none", "vivid", "mono", "warm", "cool", "fade"]);
  assert.deepEqual([...c.IMAGE_ADJUST_KEYS], ["brightness", "contrast", "saturation", "warmth", "blur"]);
  // Transparency stays the element's own opacity (0..1), on every element type.
  assert.ok(ok(c.ElementSchema, { ...text(), opacity: 0.4 }));
  assert.ok(!ok(c.ElementSchema, { ...image(), opacity: 40 }));
});

test("PE-2 text props: effects and a font ref (bundled or custom:<id>)", () => {
  const effects = {
    shadow: { blur: 16, offsetX: 6, offsetY: 6, colour: "#000000", opacity: 40 },
    outline: { width: 10, colour: "#FFFFFF" },
    highlight: { colour: "#2BB5A6", radius: 20 },
    curve: { radius: -40 },
  };
  assert.ok(ok(c.ElementSchema, text({ effects, font: "custom:12" })));
  assert.ok(ok(c.ElementSchema, text({ effects: { lift: { intensity: 50 } }, font: "ibm-plex-sans" })));
  assert.ok(ok(c.ElementSchema, text({ effects: {} })));
  assert.ok(!ok(c.ElementSchema, text({ effects: { shadow: effects.shadow, lift: { intensity: 10 } } })), "shadow or lift");
  assert.ok(!ok(c.ElementSchema, text({ effects: { curve: { radius: 101 } } })));
  assert.ok(!ok(c.ElementSchema, text({ effects: { shadow: { ...effects.shadow, opacity: 120 } } })));
  assert.ok(!ok(c.ElementSchema, text({ effects: { glow: {} } })), "known effects only");
  for (const bad of ["custom:", "custom:0", "custom:abc", "Comic Sans", "custom:1;}"]) assert.ok(!ok(c.ElementSchema, text({ font: bad })), bad);
  assert.deepEqual([...c.TEXT_EFFECTS], ["shadow", "lift", "outline", "highlight", "curve"]);
  // A whole doc with the new props on a page still validates.
  const doc = clone(fixture("ghg-doc"));
  const page = doc.pages.find((p) => p.kind === "freeform");
  page.elements.push(image({ filter: "mono" }), text({ effects: { outline: { width: 4, colour: "#112233" } } }));
  const r = c.ReportDocSchema.safeParse(doc);
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3)));
});

test("AT-1 POST /templates/suggest body and the model's answer", () => {
  const body = { kind: "ghg", year: 2025, brief: { purpose: "ghg_inventory", frameworks: ["ISO14064"], audience: "verifier", length: "medium", note: "For our first verification." } };
  const p = c.TemplateSuggestBodySchema.parse(body);
  assert.equal(p.yearType, "CY");
  assert.equal(p.sites, "all");
  assert.ok(!ok(c.TemplateSuggestBodySchema, { ...body, brief: { ...body.brief, audience: "staff" } }));
  assert.ok(!ok(c.TemplateSuggestBodySchema, { ...body, brief: { ...body.brief, note: "x".repeat(501) } }));
  assert.equal(c.BRIEF_LENGTH_PAGES.long, 40);
  assert.ok(ok(c.TemplateSuggestModelOutputSchema, { picks: [{ templateId: 3, reasons: ["Built for verification."] }] }));
  assert.ok(!ok(c.TemplateSuggestModelOutputSchema, { picks: [1, 2, 3, 4].map((id) => ({ templateId: id, reasons: ["a"] })) }), "at most 3");
  assert.ok(!ok(c.TemplateSuggestModelOutputSchema, { picks: [{ templateId: 3, reasons: ["a", "b", "c", "d"] }] }), "at most 3 reasons");
  assert.equal(c.TEMPLATE_SHORTLIST_MAX, 3);
});

test("AT-2 suggest_layouts answer, layout options on a Suggestion, template swap bodies", () => {
  assert.ok(c.AI_ACTIONS.includes("suggest_layouts"), "the DS-9 action already exists (no enum change)");
  const out = { options: ["A", "B", "C"].map((n) => ({ layoutSlug: `ghg-inventory/scope1-${n}`, name: n, reason: "Chart first.", slots: [{ slot: "chart", elementId: "p07.chart" }] })) };
  assert.ok(ok(c.SuggestLayoutsModelOutputSchema, out));
  assert.ok(!ok(c.SuggestLayoutsModelOutputSchema, { options: [...out.options, out.options[0]] }), "at most 3 options");
  const page = { id: "p07", kind: "freeform", name: "Scope 1", background: {}, elements: [] };
  const suggestion = {
    id: "s1", action: "suggest_layouts", model: "m", createdAt: "2026-10-20T00:00:00Z", kind: "pages", sources: [],
    payload: { pages: [page, page, page], layoutOptions: ["A", "B", "C"].map((id) => ({ id, name: id, layoutSlug: "ghg-inventory/scope1", reason: "", placedElementIds: [] })) },
  };
  assert.ok(ok(c.SuggestionSchema, suggestion));
  assert.ok(!ok(c.SuggestionSchema, { ...suggestion, payload: { ...suggestion.payload, layoutOptions: [{ ...suggestion.payload.layoutOptions[0], id: "D" }] } }));
  assert.ok(ok(c.TemplateSwapBodySchema, { templateId: 4, rev: 7 }));
  assert.ok(!ok(c.TemplateSwapApplyBodySchema, { templateId: 4, rev: 7 }), "apply needs the preview hash");
  assert.ok(ok(c.TemplateSwapApplyBodySchema, { templateId: 4, rev: 7, previewHash: "abc" }));
});

test("PE-1 and PE-2 request shapes and limits", () => {
  assert.equal(c.BG_MODEL_ENV, "STUDIO_BG_MODEL_PATH");
  assert.equal(c.BG_MODEL_INPUT_PX, 320);
  assert.deepEqual([...c.IMAGE_JOB_KINDS], ["remove_background"]);
  assert.ok(ok(c.RemoveBackgroundBodySchema, {}));
  assert.ok(!ok(c.RemoveBackgroundBodySchema, { mode: "fast" }));
  assert.equal(c.FONT_MAX_BYTES, 5 * 1024 * 1024);
  assert.deepEqual([...c.FONT_FILE_FORMATS], ["woff2", "ttf", "otf"]);
  const f = c.FontUploadFieldsSchema.parse({ family: "Midal Sans", weight: "700", licenceConfirmed: "true" });
  assert.deepEqual([f.weight, f.style, f.licenceConfirmed], [700, "normal", true]);
  assert.equal(c.FontUploadFieldsSchema.parse({ family: "Midal Sans" }).licenceConfirmed, false, "absent tick → false (the service answers DS_FONT_LICENCE)");
  assert.ok(!ok(c.FontUploadFieldsSchema, { family: "Midal Sans", weight: "450" }));
  assert.ok(!ok(c.FontUploadFieldsSchema, { family: 'x"; } body { color: red' }), "a family can't break out of @font-face");
  // Magic bytes as hex prefixes.
  assert.equal(Buffer.from("wOF2").toString("hex"), c.FONT_MAGIC.woff2[0]);
  assert.equal(Buffer.from("OTTO").toString("hex"), c.FONT_MAGIC.otf[0]);
});

test("PRO-0 error codes", () => {
  const expect = { DS_NOT_BUILT: 501, DS_BG_UNAVAILABLE: 503, DS_FONT_TYPE: 415, DS_FONT_TOO_LARGE: 413, DS_FONT_LICENCE: 422, DS_FONT_EXISTS: 409 };
  for (const [code, status] of Object.entries(expect)) assert.equal(c.DS_ERRORS[code].status, status, code);
  assert.equal(new c.DsError("DS_BG_UNAVAILABLE").message, "Background remover isn't set up on this server yet.");
});

test("the contracts snapshot lists the PRO-0 enums", () => {
  const snap = JSON.parse(fs.readFileSync(path.resolve("ci/studio-contracts.json"), "utf8"));
  for (const name of ["IMAGE_FILTERS", "IMAGE_ADJUST_KEYS", "TEXT_EFFECTS", "BRIEF_PURPOSES", "BRIEF_AUDIENCES", "BRIEF_LENGTHS", "BRIEF_TONES", "READINESS_BADGE_KEYS", "READINESS_LEVELS", "LAYOUT_OPTION_IDS", "SWAP_PAGE_STATUSES", "IMAGE_JOB_KINDS", "FONT_FILE_FORMATS", "FONT_WEIGHTS", "FONT_STYLES"]) {
    assert.deepEqual(snap.enums[name], [...c[name]], name);
  }
  assert.equal(snap.errors.DS_BG_UNAVAILABLE, 503);
});
