// PE-1 golden group "photo" (docs/design-studio/pro/PE-1.md): one case per photo edit. An image
// (and, for the frame / crop cases, a frame or a cropped image) from the DS-1 fixture gets the
// edit and is rendered in every mode the outputs use: sheet (editor), paged (Page view, PNG,
// screen PDF), present and print (print PDF). The golden keeps the CSS filter, the SVG filter
// and the element's full HTML, and the handler fails unless the HTML is the same in all four
// modes, so the editor, the preview and the PDF can't draw an effect differently.
const path = require("path");

const DUO = { dark: "#0b223a", light: "#2572c0" };
const EFFECTS = {
  none: {},
  brightness: { adjust: { brightness: 12 } },
  "brightness-min": { adjust: { brightness: -100 } },
  contrast: { adjust: { contrast: 8 } },
  saturation: { adjust: { saturation: -40 } },
  warmth: { adjust: { warmth: -5 } },
  "warmth-max": { adjust: { warmth: 100 } },
  blur: { adjust: { blur: 50 } },
  "filter-vivid": { filter: "vivid" },
  "filter-mono": { filter: "mono" },
  "filter-warm": { filter: "warm" },
  "filter-cool": { filter: "cool" },
  "filter-fade": { filter: "fade" },
  "filter-none": { filter: "none", adjust: { brightness: 0 } },
  duotone: { duotone: DUO },
  "duotone-off": { duotone: null },
  opacity: { opacity: 0.6 },
  combined: { filter: "vivid", adjust: { brightness: 12, contrast: 8, saturation: 0, warmth: -5, blur: 0 }, duotone: DUO, opacity: 0.8 },
  "frame-duotone": { on: "p-el.f-circle", duotone: { dark: "#18497b", light: "#f39a2b" }, filter: "mono" },
  "crop-warmth": { on: "p-el.img-crop", adjust: { warmth: 30, contrast: -20 } },
  "background-removed": { originalAssetId: "a-original" },
};

module.exports = async function photo(ctx, kase) {
  const R = require(path.join(ctx.root, "dist/reporting/studio/render/index.js"));
  const F = require(path.join(ctx.root, "ci/golden/ds/render/fixture.cjs"));
  const { effect } = kase.params;
  const spec = EFFECTS[effect];
  if (!spec) throw new Error(`photo: no effect ${effect}`);
  const { on = "p-el.img", opacity, ...props } = spec;
  const doc = F.fixtureDoc("a4");
  const source = doc.pages.filter((p) => p.kind !== "flow").flatMap((p) => p.elements).find((e) => e.id === on);
  if (!source) throw new Error(`photo: the DS-1 fixture has no ${on}`);
  const element = { ...source, ...(opacity !== undefined ? { opacity } : {}), props: { ...source.props, ...props } };
  const page = { ...doc.pages.find((p) => p.kind !== "flow"), id: `p-photo-${effect}`, name: effect, elements: [element] };
  const one = { ...doc, pages: [page] };
  const data = F.fixtureData(R.renderData);
  const htmlIn = (mode) => {
    const html = R.renderDocument(one, data, { mode, assets: F.assets }).html;
    const at = html.indexOf(`data-el-id="${element.id}"`);
    if (at < 0) throw new Error(`photo/${effect}: ${element.id} not rendered in ${mode}`);
    const start = html.lastIndexOf("<div", at);
    const end = html.indexOf("</section>", at);
    return html.slice(start, end > 0 ? end : html.length);
  };
  const modes = ["sheet", "paged", "present", "print"];
  const frags = modes.map(htmlIn);
  modes.forEach((m, i) => {
    if (frags[i] !== frags[0]) throw new Error(`photo/${effect}: the ${m} HTML differs from the sheet's`);
  });
  const fxProps = { adjust: element.props.adjust, filter: element.props.filter, duotone: element.props.duotone };
  return {
    effect,
    element: { id: element.id, type: element.type, opacity: element.opacity ?? null, props: props },
    css: R.imageFilterCss(fxProps),
    svgFilter: R.needsSvgFilter(fxProps) ? R.imageSvgFilter(R.imageFilterId(element.id), fxProps) : null,
    sameInModes: modes,
    html: frags[0],
  };
};
module.exports.EFFECTS = Object.keys(EFFECTS);
