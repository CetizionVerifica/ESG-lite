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
  let n = 0;
  const random = () => [0.123456789, 0.987654321][n++];
  const a = uniqueFileName("Bill May (1).pdf", 1700000000000, random);
  const b = uniqueFileName("Bill May (1).pdf", 1700000000000, random);
  assert.notEqual(a, b);
  assert.match(a, /^1700000000000_[a-z0-9]+_Bill_May__1_\.pdf$/);
});
