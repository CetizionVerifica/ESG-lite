// Unit tests for removing stored evidence files (audit F-06 follow-up). Runs
// against the compiled build: npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { destroyStoredFile, uniqueFileName } = require(path.resolve("dist/utils/storedFiles.js"));

const fakeUploader = (storedAs) => {
  const calls = [];
  return {
    calls,
    destroy: async (publicId, { resource_type }) => {
      calls.push(resource_type);
      return { result: resource_type === storedAs ? "ok" : "not found" };
    },
  };
};

test("a PDF or image uploaded with 'auto' is removed as 'image'", async () => {
  const uploader = fakeUploader("image");
  assert.equal(await destroyStoredFile(uploader, "emission_docs/x.pdf"), true);
  assert.deepEqual(uploader.calls, ["raw", "image"]);
});

test("a raw file is removed on the first try", async () => {
  const uploader = fakeUploader("raw");
  assert.equal(await destroyStoredFile(uploader, "emission_docs/x.xlsx"), true);
  assert.deepEqual(uploader.calls, ["raw"]);
});

test("a file that is gone reports false after trying every type", async () => {
  const uploader = fakeUploader(null);
  assert.equal(await destroyStoredFile(uploader, "emission_docs/gone.pdf"), false);
  assert.deepEqual(uploader.calls, ["raw", "image", "video"]);
});

test("two uploads of one file name in the same millisecond get different names", () => {
  const a = uniqueFileName("Bill May (1).pdf", 1700000000000);
  const b = uniqueFileName("Bill May (1).pdf", 1700000000000);
  assert.notEqual(a, b);
  assert.match(a, /^1700000000000_[0-9a-f]{10}_Bill_May__1_\.pdf$/);
});

test("a very long file name is cut to fit, keeping its extension", () => {
  const name = uniqueFileName(`${"x".repeat(300)}.xlsx`, 1700000000000, () => "0123456789");
  assert.ok(`emission_docs/${name}`.length <= 255);
  assert.match(name, /^1700000000000_0123456789_x+\.xlsx$/);
  assert.equal(name.length, "1700000000000_0123456789_".length + 150);
});

test("deletes ask the CDN to drop its cached copy", async () => {
  const seen = [];
  await destroyStoredFile({ destroy: async (_id, opts) => (seen.push(opts.invalidate), { result: "ok" }) }, "emission_docs/x.pdf");
  assert.deepEqual(seen, [true]);
});
