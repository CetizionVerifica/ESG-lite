// DS-14F golden group "render" (DS-1): the renderer's HTML per element type, per page format,
// per mode (render/element/<type>-<format>-<mode>). Every element of that type in the DS-1
// fixture (ci/golden/ds/render/fixture.cjs, laid out on the format) goes on one page and the
// doc is rendered in the mode; the golden keeps each element's frame, size and sha256 of its
// HTML. The CSS isn't part of it (a theme or font change shows in DS-1's own snapshots).
const crypto = require("crypto");
const path = require("path");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

module.exports = async function render(ctx, kase) {
  const R = require(path.join(ctx.root, "dist/reporting/studio/render/index.js"));
  const F = require(path.join(ctx.root, "ci/golden/ds/render/fixture.cjs"));
  const { element, format, mode } = kase.params;
  const doc = F.fixtureDoc(format);
  const pages = doc.pages.filter((p) => p.kind !== "flow");
  const elements = pages.flatMap((p) => p.elements.filter((e) => e.type === element));
  if (!elements.length) throw new Error(`the DS-1 fixture has no ${element} element`);
  const page = { ...pages[0], id: `p-${element}`, name: element, elements };
  const one = { ...doc, pages: [page] };
  const r = R.renderDocument(one, F.fixtureData(R.renderData), { mode, assets: F.assets });
  const html = r.html;
  const re = /<div class="ds-el [^"]*" data-el-id="([^"]+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(html))) starts.push({ id: m[1], at: m.index });
  const out = [];
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : html.indexOf("</section>", s.at) > 0 ? html.indexOf("</section>", s.at) : html.length;
    const frag = html.slice(s.at, end);
    out.push({ id: s.id, frame: /data-frame="([^"]+)"/.exec(frag)?.[1] ?? null, bytes: frag.length, sha256: sha(frag) });
  });
  const hidden = elements.filter((e) => e.hidden).map((e) => e.id);
  if (out.length !== elements.length - hidden.length) throw new Error(`${element}: ${elements.length - hidden.length} visible elements in, ${out.length} rendered`);
  if (out.some((o) => hidden.includes(o.id))) throw new Error(`${element}: a hidden element was rendered`);
  return { element, format, mode, pages: (html.match(/<section\b/g) || []).length, elements: out, ...(hidden.length ? { hidden } : {}) };
};
