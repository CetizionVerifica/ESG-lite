// DS-1 renderer goldens: builds the snapshot object compared by
// ci/unit/ds-1-render.test.cjs (and written with UPDATE_SNAPSHOT=1).
//   elements: the HTML of every element of the A4 fixture, rendered in sheet mode
//   formats:  sha256 + bytes of the whole fixture in sheet mode, per format
//   modes:    sha256 + bytes of the A4 fixture per mode (sheet, paged, present, print)
// fixture-a4.json carries the same doc and data for the FE mirror test, which
// must reproduce these hashes byte for byte (scripts/sync-studio-render.mjs copies both).
const crypto = require("crypto");
const path = require("path");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function build(R, F) {
  const data = F.fixtureData(R.renderData);
  const a4 = F.fixtureDoc("a4");
  const opts = (mode) => ({ mode, assets: F.assets, watermark: mode === "paged" ? "PROOF" : undefined, cropMarks: mode === "print" });
  const elements = {};
  for (const page of a4.pages) {
    if (page.kind !== "freeform") continue;
    const html = R.renderSheet(page, a4, data, { mode: "sheet", assets: F.assets }).html;
    const re = /<div class="ds-el [^"]*" data-el-id="([^"]+)"/g;
    let m;
    const starts = [];
    while ((m = re.exec(html))) starts.push({ id: m[1], at: m.index });
    starts.forEach((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].at : html.lastIndexOf("</section>");
      elements[s.id] = html.slice(s.at, end).replace(/<div class="ds-watermark".*$/s, "");
    });
  }
  const formats = {};
  for (const f of Object.keys(F.SIZES)) {
    const r = R.renderDocument(F.fixtureDoc(f), data, opts("sheet"));
    formats[f] = { sha256: sha(r.html + "\n" + r.css), bytes: r.html.length + r.css.length };
  }
  const modes = {};
  for (const m of ["sheet", "paged", "present", "print"]) {
    const r = R.renderDocument(a4, data, opts(m));
    modes[m] = { sha256: sha(r.html + "\n" + r.css), bytes: r.html.length + r.css.length };
  }
  return { renderHash: R.RENDER_HASH, elements, formats, modes };
}

/** The A4 fixture as plain JSON (doc, data, assets) for the FE mirror test. */
function fixtureJson(R, F) {
  return { doc: F.fixtureDoc("a4"), docs: Object.fromEntries(Object.keys(F.SIZES).map((f) => [f, F.fixtureDoc(f)])), data: F.fixtureData(R.renderData), assets: F.assets };
}

module.exports = { build, fixtureJson, sha, DIR: __dirname, SNAPSHOT: path.join(__dirname, "snapshots.json"), FIXTURE: path.join(__dirname, "fixture-a4.json") };
