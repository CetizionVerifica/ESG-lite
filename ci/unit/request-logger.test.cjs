// Tokens in URLs never reach the request log (audit finding F-11).
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { redactUrl } = require(path.resolve("dist/middlewares/requestLogger.js"));

test("token query params are redacted", () => {
  assert.equal(redactUrl("/reports/ghg?siteIds=1&token=abc.def.ghi&download=1"), "/reports/ghg?siteIds=1&token=[redacted]&download=1");
  assert.equal(redactUrl("/notifications/stream?token=abc.def.ghi"), "/notifications/stream?token=[redacted]");
  assert.equal(redactUrl("/x?Token=a&access_token=b"), "/x?Token=[redacted]&access_token=[redacted]");
});

test("the password-reset token in the path is redacted", () => {
  assert.equal(redactUrl("/auth/verify-reset-token/0123abcd?x=1"), "/auth/verify-reset-token/[redacted]?x=1");
});

test("OAuth codes, PKCE values, state and the consent request are redacted", () => {
  assert.equal(
    redactUrl("/oauth/authorize?response_type=code&client_id=abc&code_challenge=XYZ&code_challenge_method=S256&state=s1&resource=r"),
    "/oauth/authorize?response_type=code&client_id=abc&code_challenge=[redacted]&code_challenge_method=S256&state=[redacted]&resource=r",
  );
  assert.equal(redactUrl("/oauth/authorize/request?request=eyJhbGc.abc.def"), "/oauth/authorize/request?request=[redacted]");
  assert.equal(redactUrl("/cb?code=esgl_ac_123&state=x"), "/cb?code=[redacted]&state=[redacted]");
});

test("URLs without secrets are unchanged", () => {
  for (const u of ["/user/emissions?page=2", "/user/emissions?mytoken_count=3", "/auth/login"]) assert.equal(redactUrl(u), u);
});
