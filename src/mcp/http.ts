import express, { NextFunction, Request, Response, Router } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requestLogger } from "../middlewares/requestLogger";
import { log } from "../utils/logger";
import { MCP_SCOPES, McpPrincipal, verifyMcpBearer } from "./auth";
import { MCP_CODES, MCP_MESSAGES } from "./codes";
import { takeToolCall } from "./rateLimit";
import { buildMcpServer } from "./server";

/**
 * `POST /mcp`: MCP over Streamable HTTP, stateless (a new McpServer and
 * transport per request, no session id), JSON responses. Mounted in
 * src/index.ts BEFORE the app-wide body parser and CORS so this router owns
 * both for its path: a 5 MB body cap and the Claude connector origins.
 *
 * Order per request: CORS → body (5 MB) → bearer token → Superadmin gate →
 * scope check → rate limit (tools/call only) → MCP server.
 */

export const BODY_LIMIT = "5mb";

/** Where the protected-resource metadata lives (IM5 serves it, with and without the /mcp suffix). */
export const apiBase = (req: Request): string =>
  (process.env.API_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

const CLAUDE_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)*claude\.ai$/i, /^https:\/\/([a-z0-9-]+\.)*claude\.com$/i, /^https:\/\/([a-z0-9-]+\.)*anthropic\.com$/i];

const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true); // server-to-server (claude.ai's connector backend, Inspector CLI)
  const extra = (process.env.MCP_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const appOrigin = process.env.CORS_ORIGIN;
  if (CLAUDE_ORIGINS.some((re) => re.test(origin)) || extra.includes(origin) || (appOrigin && appOrigin === origin)) {
    return cb(null, true);
  }
  return cb(null, false);
};

export const mcpCors = cors({
  origin: corsOrigin,
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Session-Id", "MCP-Protocol-Version", "Last-Event-ID"],
  exposedHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
  maxAge: 600,
});

const unauthorized = (req: Request, res: Response, error?: "invalid_token") => {
  const parts = [`Bearer resource_metadata="${apiBase(req)}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`, `error_description="The access token is missing, expired, revoked or not an MCP token."`);
  res.setHeader("WWW-Authenticate", parts.join(", "));
  res.status(401).json({ error: error ?? "unauthorized", message: "Sign in to ESGLite through the connector to use this server." });
};

export interface McpRequest extends Request {
  mcp?: McpPrincipal;
  auth?: { token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> };
}

/** Bearer token → principal, Superadmin only, at least one MCP scope. */
export const authenticateMcp = async (req: McpRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const [scheme, token] = typeof header === "string" ? header.split(/\s+/, 2) : [];
  if (!header || !/^Bearer$/i.test(scheme || "") || !token) return unauthorized(req, res);

  let outcome;
  try {
    outcome = await verifyMcpBearer(token);
  } catch (err: any) {
    log.error("MCP", "Token verification failed", { error: err?.message });
    return res.status(503).json({ error: "temporarily_unavailable", message: "ESGLite could not verify the token right now." });
  }
  if (!outcome.ok) {
    if (outcome.reason === "not_superadmin") {
      return res.status(403).json({ code: MCP_CODES.MCP_SUPERADMIN_ONLY, message: MCP_MESSAGES.MCP_SUPERADMIN_ONLY });
    }
    return unauthorized(req, res, "invalid_token");
  }
  const { principal } = outcome;
  if (!principal.scopes.some((s) => (MCP_SCOPES as readonly string[]).includes(s))) {
    res.setHeader("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${MCP_SCOPES.join(" ")}"`);
    return res.status(403).json({ error: "insufficient_scope", message: `This connection has none of the scopes ${MCP_SCOPES.join(", ")}.` });
  }
  req.mcp = principal;
  req.auth = { token, clientId: principal.grant_id, scopes: principal.scopes, extra: { user_id: principal.user_id, role: principal.role } };
  next();
};

const isToolCall = (body: unknown): boolean => {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((m) => m && typeof m === "object" && (m as any).method === "tools/call");
};

/** 60 tool calls per minute per grant; initialize and tools/list are not counted. */
export const rateLimitMcp = (req: McpRequest, res: Response, next: NextFunction) => {
  if (!req.mcp || !isToolCall(req.body)) return next();
  const verdict = takeToolCall(req.mcp.grant_id);
  if (verdict.allowed) return next();
  res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
  log.warn("MCP", "Rate limit hit", { user_id: req.mcp.user_id });
  return res.status(429).json({ error: "rate_limited", message: `Too many tool calls. Try again in ${verdict.retryAfterSeconds} s.` });
};

export const handleMcpPost = async (req: McpRequest, res: Response) => {
  const principal = req.mcp!;
  const server = buildMcpServer(principal);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    log.error("MCP", "Request failed", { user_id: principal.user_id, error: err?.stack || err?.message });
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
};

const methodNotAllowed = (_req: Request, res: Response) => {
  res.setHeader("Allow", "POST, OPTIONS");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This server is stateless: use POST." }, id: null });
};

/** Body-parser errors (too large, bad JSON) as JSON, without a stack. */
const bodyErrors = (err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ jsonrpc: "2.0", error: { code: -32600, message: `Request body over ${BODY_LIMIT}. Send rows in chunks of at most 2,000.` }, id: null });
  }
  if (err.type === "entity.parse.failed" || err.status === 400) {
    return res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }
  return next(err);
};

export const mcpRouter: Router = Router();
mcpRouter.use(mcpCors);
mcpRouter.use(requestLogger);
mcpRouter.use(express.json({ limit: BODY_LIMIT, type: ["application/json", "application/*+json"] }));
mcpRouter.use(bodyErrors);
mcpRouter.post("/", authenticateMcp, rateLimitMcp, handleMcpPost);
mcpRouter.get("/", methodNotAllowed);
mcpRouter.delete("/", methodNotAllowed);
mcpRouter.put("/", methodNotAllowed);
mcpRouter.patch("/", methodNotAllowed);
