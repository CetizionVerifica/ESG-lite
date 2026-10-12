import { Router, Request, Response } from "express";
import cors from "cors";
import { SCOPES, apiBaseUrl, mcpResource } from "./config";

/**
 * Discovery documents (RFC 9728 protected-resource metadata and RFC 8414
 * authorization-server metadata). Open CORS: MCP clients fetch these from
 * the browser. Mounted at /.well-known.
 */
const router = Router();
router.use(cors({ origin: true }));

const protectedResource = (req: Request, res: Response) => {
  const base = apiBaseUrl(req);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    resource: mcpResource(req),
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "ESGLite imports",
    resource_documentation: `${base}/mcp`,
  });
};

router.get("/oauth-protected-resource", protectedResource);
router.get("/oauth-protected-resource/mcp", protectedResource);

router.get("/oauth-authorization-server", (req, res) => {
  const base = apiBaseUrl(req);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${base}/mcp`,
  });
});

export default router;
