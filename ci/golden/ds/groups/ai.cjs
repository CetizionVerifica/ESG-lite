// DS-14 golden group "ai" (DS-9): each AI action's recorded model answer
// (ci/fixtures/studio/ai/recorded.json) validates — zod, the token guard, the binding
// check — and, for text, renders with the studio renderer. Actions DS-9 hasn't built
// record `built: false`, so a later module that builds one changes this golden on purpose.
const path = require("path");

module.exports = async function ai(ctx, kase) {
  const { ACTIONS } = require(path.join(ctx.root, "dist/studio/ai/actions.js"));
  const { TextDocSchema } = require(path.join(ctx.root, "dist/studio/contracts/index.js"));
  const { replay, renderText, tokensOf } = require("../lib/ai.cjs");
  const action = kase.params.action;
  if (!ACTIONS[action]) return { action, built: false };
  const r = replay(action);
  if (!r) return { action, built: true, recorded: false };
  const { result, spec, doc } = r;
  if (result.issues) return { action, built: true, valid: false, issues: result.issues };
  const out = { action, built: true, valid: true, output: spec.output, group: spec.group };
  if (result.text) {
    out.textDocValid = TextDocSchema.safeParse(result.text).success;
    out.chips = tokensOf(result.text).map((t) => t.attrs);
    out.sources = result.sources;
    out.rendered = renderText(doc, result.text);
  } else {
    Object.assign(out, result);
  }
  return out;
};
