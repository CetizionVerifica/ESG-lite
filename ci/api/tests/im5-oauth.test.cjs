// IM5: OAuth 2.1 server for the Claude (MCP) connector. Audit rows MCP-01,
// MCP-02, MCP-04, MCP-05 (API side), MCP-06 (switch), part of MCP-03.
// Scripted public client: register → authorize → consent → code → token →
// /oauth/userinfo (the same check IM6 puts in front of /mcp).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { call, withDb, USERS } = require("../helpers.cjs");

const BASE = process.env.API_BASE;
const RESOURCE = `${BASE}/mcp`;
const REDIRECT = "http://localhost:6274/oauth/callback";
const OTHER_REDIRECT = "http://localhost:6274/other";

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

const form = (fields) => new URLSearchParams(fields).toString();
const postForm = async (route, fields) => {
  const res = await fetch(`${BASE}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(fields),
  });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, json: type.includes("json") ? await res.json() : null, headers: res.headers };
};

const authorize = async (params) => {
  const url = new URL(`${BASE}/oauth/authorize`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location) : null, json: res.status === 400 ? await res.json() : null };
};

let client;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const userinfo = (token) => fetch(`${BASE}/oauth/userinfo`, { headers: bearer(token) });

/** Full happy path up to the code, as `who` (helpers user key or a signed JWT). */
async function getCode(who = "superadmin", opts = {}) {
  const { verifier, challenge } = pkce();
  const auth = await authorize({
    response_type: "code", client_id: client.client_id, redirect_uri: opts.redirect_uri || REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, scope: opts.scope, state: "st-1",
  });
  assert.equal(auth.status, 302);
  const request = auth.location.searchParams.get("request");
  assert.ok(request);
  const headers = typeof who === "string" && USERS[who] ? {} : bearer(who);
  const decision = await call("POST", "/oauth/authorize/decision", USERS[who] ? who : null, { request, decision: "allow" }, headers);
  assert.equal(decision.status, 200, JSON.stringify(decision.json));
  const redirect = new URL(decision.json.redirect_to);
  return { code: redirect.searchParams.get("code"), verifier, redirect, grant_id: decision.json.grant_id };
}

async function getTokens(who = "superadmin") {
  const { code, verifier, grant_id } = await getCode(who);
  const res = await postForm("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return { ...res.json, grant_id };
}

// ---- metadata (MCP-01) ------------------------------------------------------

test("protected-resource and authorization-server metadata have the expected shape", async () => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const r = await call("GET", path, null);
    assert.equal(r.status, 200);
    assert.equal(r.json.resource, RESOURCE);
    assert.deepEqual(r.json.authorization_servers, [BASE]);
    assert.deepEqual(r.json.scopes_supported, ["imports:read", "imports:write"]);
  }
  const as = await call("GET", "/.well-known/oauth-authorization-server", null);
  assert.equal(as.status, 200);
  assert.equal(as.json.issuer, BASE);
  assert.equal(as.json.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(as.json.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(as.json.registration_endpoint, `${BASE}/oauth/register`);
  assert.deepEqual(as.json.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.json.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(as.json.response_types_supported, ["code"]);
  assert.deepEqual(as.json.token_endpoint_auth_methods_supported, ["none"]);
});

test("a call without a token gets 401 with WWW-Authenticate pointing at the resource metadata", async () => {
  const res = await fetch(`${BASE}/oauth/userinfo`);
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate");
  assert.match(challenge, /^Bearer /);
  assert.ok(challenge.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`), challenge);
});

// ---- registration -------------------------------------------------------------

test("dynamic client registration: public client with allowed redirect URIs", async () => {
  const r = await call("POST", "/oauth/register", null, {
    client_name: "MCP Inspector", redirect_uris: [REDIRECT, OTHER_REDIRECT], token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.client_id);
  assert.equal(r.json.token_endpoint_auth_method, "none");
  assert.deepEqual(r.json.redirect_uris, [REDIRECT, OTHER_REDIRECT]);
  client = r.json;
});

test("registration refuses http (non-localhost) and unlisted hosts, and confidential clients", async () => {
  const http = await call("POST", "/oauth/register", null, { client_name: "x", redirect_uris: ["http://evil.example/cb"] });
  assert.equal(http.status, 400);
  assert.equal(http.json.error, "invalid_redirect_uri");
  const host = await call("POST", "/oauth/register", null, { client_name: "x", redirect_uris: ["https://evil.example/cb"] });
  assert.equal(host.status, 400);
  const secret = await call("POST", "/oauth/register", null, { client_name: "x", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
  assert.equal(secret.status, 400);
  assert.equal(secret.json.error, "invalid_client_metadata");
  const ok = await call("POST", "/oauth/register", null, { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  assert.equal(ok.status, 201);
});

// ---- authorize validation (MCP-02) ------------------------------------------------

test("authorize: unknown client or unregistered redirect_uri is answered directly, never redirected", async () => {
  const unknown = await authorize({ response_type: "code", client_id: "nope", redirect_uri: REDIRECT });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error, "invalid_client");
  const badUri = await authorize({ response_type: "code", client_id: client.client_id, redirect_uri: "http://localhost:6274/not-registered" });
  assert.equal(badUri.status, 400);
  assert.equal(badUri.json.error, "invalid_redirect_uri");
});

test("authorize: only code + S256 PKCE with the /mcp resource reaches the consent page", async () => {
  const { challenge } = pkce();
  const base = { response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, state: "s" };
  const expectError = async (overrides, error) => {
    const r = await authorize({ ...base, ...overrides });
    assert.equal(r.status, 302);
    assert.equal(r.location.origin + r.location.pathname, REDIRECT);
    assert.equal(r.location.searchParams.get("error"), error, r.location.toString());
    assert.equal(r.location.searchParams.get("state"), "s");
  };
  await expectError({ response_type: "token" }, "unsupported_response_type");
  await expectError({ code_challenge_method: "plain" }, "invalid_request");
  await expectError({ code_challenge_method: undefined }, "invalid_request");
  await expectError({ code_challenge: "short" }, "invalid_request");
  await expectError({ resource: undefined }, "invalid_target");
  await expectError({ resource: `${BASE}/user` }, "invalid_target");
  await expectError({ scope: "admin:everything" }, "invalid_scope");

  const ok = await authorize(base);
  assert.equal(ok.status, 302);
  assert.equal(ok.location.pathname, "/oauth/consent");
  assert.ok(ok.location.searchParams.get("request"));
});

// ---- consent (MCP-03 API side) ---------------------------------------------------------

test("the consent request describes the app and scopes; only a Superadmin may allow", async () => {
  const { challenge } = pkce();
  const auth = await authorize({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE });
  const request = auth.location.searchParams.get("request");

  const anon = await call("GET", `/oauth/authorize/request?request=${encodeURIComponent(request)}`, null);
  assert.equal(anon.status, 401);

  const sa = await call("GET", `/oauth/authorize/request?request=${encodeURIComponent(request)}`, "superadmin");
  assert.equal(sa.status, 200);
  assert.equal(sa.json.client.client_name, "MCP Inspector");
  assert.equal(sa.json.client.redirect_host, "localhost:6274");
  assert.deepEqual(sa.json.scopes.map((s) => s.scope), ["imports:read", "imports:write"]);
  assert.match(sa.json.scopes[1].description, /can't approve, edit or delete/);
  assert.equal(sa.json.can_allow, true);
  assert.equal(sa.json.refusal, null);
  assert.equal(sa.json.user.role, "Superadmin");

  const mgr = await call("GET", `/oauth/authorize/request?request=${encodeURIComponent(request)}`, "manager");
  assert.equal(mgr.status, 200);
  assert.equal(mgr.json.can_allow, false);
  assert.equal(mgr.json.refusal.code, "MCP_SUPERADMIN_ONLY");

  const bogus = await call("GET", `/oauth/authorize/request?request=not-a-request`, "superadmin");
  assert.equal(bogus.status, 400);
  assert.equal(bogus.json.code, "OAUTH_REQUEST_INVALID");
});

test("Manager, Admin and User consent → MCP_SUPERADMIN_ONLY, no code and no grant stored", async () => {
  const before = await withDb(async (db) => (await db.query("SELECT count(*)::int AS n FROM oauth_code")).rows[0].n);
  for (const who of ["manager", "admin", "user"]) {
    const { challenge } = pkce();
    const auth = await authorize({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, state: "x" });
    const request = auth.location.searchParams.get("request");
    const r = await call("POST", "/oauth/authorize/decision", who, { request, decision: "allow" });
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "MCP_SUPERADMIN_ONLY");
    assert.match(r.json.message, /Only ESGLite staff \(Superadmin\)/);
    assert.equal(new URL(r.json.redirect_to).searchParams.get("error"), "access_denied");
    assert.equal(new URL(r.json.redirect_to).searchParams.get("state"), "x");
  }
  const after = await withDb(async (db) => ({
    codes: (await db.query("SELECT count(*)::int AS n FROM oauth_code")).rows[0].n,
    grants: (await db.query("SELECT count(*)::int AS n FROM oauth_grant WHERE user_id IN (1,2,3)")).rows[0].n,
  }));
  assert.equal(after.codes, before);
  assert.equal(after.grants, 0);
});

test("Deny sends the browser back with access_denied and issues nothing", async () => {
  const { challenge } = pkce();
  const auth = await authorize({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE, state: "d" });
  const request = auth.location.searchParams.get("request");
  const r = await call("POST", "/oauth/authorize/decision", "superadmin", { request, decision: "deny" });
  assert.equal(r.status, 200);
  const url = new URL(r.json.redirect_to);
  assert.equal(url.searchParams.get("error"), "access_denied");
  assert.equal(url.searchParams.get("state"), "d");
  assert.equal(url.searchParams.get("code"), null);
});

// ---- code exchange (MCP-02) ---------------------------------------------------------

test("Superadmin allow → code; the right verifier yields hashed tokens that work at /oauth/userinfo", async () => {
  const { code, verifier, redirect } = await getCode();
  assert.equal(redirect.searchParams.get("state"), "st-1");
  assert.ok(code.startsWith("esgl_ac_"));
  const r = await postForm("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.token_type, "Bearer");
  assert.equal(r.json.expires_in, 3600);
  assert.equal(r.json.scope, "imports:read imports:write");
  assert.ok(r.json.access_token.startsWith("esgl_at_"));
  assert.ok(r.json.refresh_token.startsWith("esgl_rt_"));
  assert.equal(r.headers.get("cache-control"), "no-store");

  const me = await userinfo(r.json.access_token);
  assert.equal(me.status, 200);
  const body = await me.json();
  assert.equal(body.user_id, USERS.superadmin.userId);
  assert.equal(body.role, "Superadmin");
  assert.deepEqual(body.scopes, ["imports:read", "imports:write"]);

  // Stored hashed: no plain token or code anywhere in the tables.
  const stored = await withDb(async (db) => ({
    tokens: (await db.query("SELECT token_hash FROM oauth_token")).rows.map((x) => x.token_hash),
    codes: (await db.query("SELECT code_hash FROM oauth_code")).rows.map((x) => x.code_hash),
  }));
  assert.ok(stored.tokens.length >= 2);
  assert.ok(stored.tokens.every((h) => /^[0-9a-f]{64}$/.test(h)));
  assert.ok(!stored.tokens.includes(r.json.access_token) && !stored.tokens.includes(r.json.refresh_token));
  assert.ok(stored.codes.every((h) => /^[0-9a-f]{64}$/.test(h)) && !stored.codes.includes(code));
  const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
  assert.ok(stored.tokens.includes(sha(r.json.access_token)));
  assert.ok(stored.codes.includes(sha(code)));

  // A code is one-time.
  const again = await postForm("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, "invalid_grant");
});

test("wrong verifier, expired code, mismatched redirect_uri or resource are refused", async () => {
  const wrong = await getCode();
  const r1 = await postForm("/oauth/token", { grant_type: "authorization_code", code: wrong.code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: "a".repeat(43), resource: RESOURCE });
  assert.equal(r1.status, 400);
  assert.equal(r1.json.error, "invalid_grant");
  // A failed verification burns the code.
  const r1b = await postForm("/oauth/token", { grant_type: "authorization_code", code: wrong.code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: wrong.verifier, resource: RESOURCE });
  assert.equal(r1b.json.error, "invalid_grant");

  const expired = await getCode();
  await withDb((db) => db.query("UPDATE oauth_code SET expires_at = now() - interval '5 minutes' WHERE code_hash = $1", [crypto.createHash("sha256").update(expired.code).digest("hex")]));
  const r2 = await postForm("/oauth/token", { grant_type: "authorization_code", code: expired.code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: expired.verifier, resource: RESOURCE });
  assert.equal(r2.json.error, "invalid_grant");
  assert.match(r2.json.error_description, /expired/);

  const redirect = await getCode();
  const r3 = await postForm("/oauth/token", { grant_type: "authorization_code", code: redirect.code, redirect_uri: OTHER_REDIRECT, client_id: client.client_id, code_verifier: redirect.verifier, resource: RESOURCE });
  assert.equal(r3.json.error, "invalid_grant");

  const resource = await getCode();
  const r4 = await postForm("/oauth/token", { grant_type: "authorization_code", code: resource.code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: resource.verifier, resource: `${BASE}/user` });
  assert.equal(r4.json.error, "invalid_target");

  const other = await call("POST", "/oauth/register", null, { client_name: "Other", redirect_uris: [REDIRECT] });
  const stolen = await getCode();
  const r5 = await postForm("/oauth/token", { grant_type: "authorization_code", code: stolen.code, redirect_uri: REDIRECT, client_id: other.json.client_id, code_verifier: stolen.verifier, resource: RESOURCE });
  assert.equal(r5.json.error, "invalid_grant");

  const noClient = await postForm("/oauth/token", { grant_type: "authorization_code", code: "x", redirect_uri: REDIRECT, code_verifier: "y".repeat(43) });
  assert.equal(noClient.status, 401);
  assert.equal(noClient.json.error, "invalid_client");
  const badGrant = await postForm("/oauth/token", { grant_type: "password", client_id: client.client_id });
  assert.equal(badGrant.json.error, "unsupported_grant_type");
});

// ---- refresh rotation and revocation (MCP-05) -----------------------------------------------

test("refresh rotates the token; reusing the old refresh token revokes the grant", async () => {
  const t = await getTokens();
  const r1 = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.notEqual(r1.json.refresh_token, t.refresh_token);
  assert.equal((await userinfo(r1.json.access_token)).status, 200);

  const wider = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: r1.json.refresh_token, client_id: client.client_id, scope: "imports:read imports:write admin:all" });
  assert.equal(wider.json.error, "invalid_scope");

  const reuse = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, "invalid_grant");
  assert.match(reuse.json.error_description, /reused/);
  // Everything under the grant is now dead.
  assert.equal((await userinfo(r1.json.access_token)).status, 401);
  const r2 = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: r1.json.refresh_token, client_id: client.client_id });
  assert.equal(r2.json.error, "invalid_grant");
  const grant = await withDb(async (db) => (await db.query("SELECT revoked_at FROM oauth_grant WHERE grant_id = $1", [t.grant_id])).rows[0]);
  assert.ok(grant.revoked_at);
});

test("POST /oauth/revoke: an access token alone, a refresh token with its grant", async () => {
  const a = await getTokens();
  assert.equal((await postForm("/oauth/revoke", { token: a.access_token })).status, 200);
  assert.equal((await userinfo(a.access_token)).status, 401);
  const re = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: a.refresh_token, client_id: client.client_id });
  assert.equal(re.status, 200, "the grant survives an access-token revocation");

  assert.equal((await postForm("/oauth/revoke", { token: re.json.refresh_token })).status, 200);
  assert.equal((await userinfo(re.json.access_token)).status, 401);
  assert.equal((await postForm("/oauth/revoke", { token: "esgl_rt_unknown" })).status, 200, "unknown tokens still answer 200");
});

test("Connected apps: the user lists their grants and disconnecting one kills its tokens", async () => {
  const t = await getTokens();
  assert.equal((await userinfo(t.access_token)).status, 200);
  const list = await call("GET", "/oauth/grants", "superadmin");
  assert.equal(list.status, 200);
  assert.equal(list.json.connector_url, RESOURCE);
  const mine = list.json.grants.find((g) => g.grant_id === t.grant_id);
  assert.ok(mine);
  assert.equal(mine.client.client_name, "MCP Inspector");
  assert.deepEqual(mine.scopes, ["imports:read", "imports:write"]);
  assert.equal(mine.revoked_at, null);
  assert.ok(mine.last_used_at, "userinfo set last_used_at");

  // Someone else can't disconnect it.
  assert.equal((await call("DELETE", `/oauth/grants/${t.grant_id}`, "manager")).status, 404);
  assert.equal((await userinfo(t.access_token)).status, 200);

  const del = await call("DELETE", `/oauth/grants/${t.grant_id}`, "superadmin");
  assert.equal(del.status, 200);
  assert.equal((await userinfo(t.access_token)).status, 401);
  const refresh = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(refresh.json.error, "invalid_grant");
  const after = await call("GET", "/oauth/grants", "superadmin");
  assert.equal(after.json.grants.some((g) => g.grant_id === t.grant_id), false);
  const history = await call("GET", "/oauth/grants?include_revoked=1", "superadmin");
  assert.ok(history.json.grants.find((g) => g.grant_id === t.grant_id).revoked_at, "history is kept, not deleted");
  assert.equal((await call("GET", "/oauth/grants", "manager")).json.grants.length, 0);
});

// ---- token boundaries (MCP-04) -------------------------------------------------------------

test("MCP tokens are refused by app endpoints and app JWTs by the MCP check", async () => {
  const t = await getTokens();
  const app = await fetch(`${BASE}/user/emissions`, { headers: bearer(t.access_token) });
  assert.equal(app.status, 401);
  const admin = await fetch(`${BASE}/admin/companies`, { headers: bearer(t.access_token) });
  assert.equal(admin.status, 401);
  const me = await fetch(`${BASE}/auth/me`, { headers: bearer(t.access_token) });
  assert.equal(me.status, 401);

  const appJwt = await call("GET", "/oauth/userinfo", "superadmin");
  assert.equal(appJwt.status, 401);
  assert.match(appJwt.headers.get("www-authenticate"), /error="invalid_token"/);
  const refreshAsAccess = await userinfo(t.refresh_token);
  assert.equal(refreshAsAccess.status, 401);
  const expired = await withDb((db) => db.query("UPDATE oauth_token SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [crypto.createHash("sha256").update(t.access_token).digest("hex")]));
  assert.equal((await userinfo(t.access_token)).status, 401);
});

test("a Superadmin demoted after consent loses access on the next call", async () => {
  const demoted = { userId: 50, role: "Superadmin" };
  await withDb((db) => db.query(`INSERT INTO "user" (user_id, name, email, password, role) VALUES (50, 'CI Demoted', 'ci-demoted@example.invalid', 'x', 'Superadmin') ON CONFLICT (user_id) DO UPDATE SET role = 'Superadmin'`));
  const t = await getTokens(jwt.sign(demoted, process.env.JWT_SECRET));
  assert.equal((await userinfo(t.access_token)).status, 200);
  await withDb((db) => db.query(`UPDATE "user" SET role = 'Manager' WHERE user_id = 50`));
  assert.equal((await userinfo(t.access_token)).status, 401);
  // ...and a refreshed token does not help either.
  const re = await postForm("/oauth/token", { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(re.status, 200);
  assert.equal((await userinfo(re.json.access_token)).status, 401);
});

// ---- the per-client switch (MCP-06) --------------------------------------------------------

test("company.mcp_enabled is off by default and toggled by Superadmin through the client update", async () => {
  const before = await call("GET", "/admin/companies", "superadmin");
  assert.equal(before.json.find((c) => c.company_id === 2).mcp_enabled, false);
  assert.equal((await call("PUT", "/admin/companies/2", "superadmin", { mcp_enabled: "yes" })).status, 400);
  assert.equal((await call("PUT", "/admin/companies/2", "superadmin", { mcp_enabled: true })).status, 200);
  const after = await call("GET", "/admin/companies", "superadmin");
  assert.equal(after.json.find((c) => c.company_id === 2).mcp_enabled, true);
  assert.equal((await call("PUT", "/admin/companies/2", "admin", { mcp_enabled: true })).status, 403);
  assert.equal((await call("PUT", "/admin/companies/2", "superadmin", { mcp_enabled: false })).status, 200);
});

// ---- rate limits (last: they use up the buckets) -----------------------------------------------

const disabled = process.env.AUTH_RATE_LIMIT_DISABLED === "true";
const MAX = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

test("registration and token endpoints are rate limited", { skip: disabled && "AUTH_RATE_LIMIT_DISABLED" }, async () => {
  const statuses = [];
  for (let i = 0; i <= MAX; i++) statuses.push((await call("POST", "/oauth/register", null, { client_name: `burst ${i}`, redirect_uris: [REDIRECT] })).status);
  assert.ok(statuses.includes(429), `register statuses: ${statuses}`);
  assert.ok(statuses.slice(statuses.indexOf(429)).every((s) => s === 429));

  // The token endpoint allows 30 failures per client and IP; earlier tests used some.
  const tokenStatuses = [];
  for (let i = 0; i <= 30; i++) {
    tokenStatuses.push((await postForm("/oauth/token", { grant_type: "authorization_code", code: "esgl_ac_bogus", redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: "z".repeat(43) })).status);
  }
  assert.ok(tokenStatuses.includes(429), `token statuses: ${tokenStatuses}`);
});
