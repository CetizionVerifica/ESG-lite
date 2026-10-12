import { Response } from "express";

/**
 * RFC 6749 §5.2 error bodies for the OAuth endpoints (register, token,
 * revoke, authorize when no safe redirect exists). The app-facing consent
 * endpoints use the import plan's codes instead (see router.ts).
 */
export type OauthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "access_denied"
  | "server_error";

const STATUS: Partial<Record<OauthErrorCode, number>> = {
  invalid_client: 401,
  access_denied: 403,
  server_error: 500,
};

export const oauthError = (res: Response, error: OauthErrorCode, description: string, status?: number) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status ?? STATUS[error] ?? 400).json({ error, error_description: description });
};

/** Codes shared with the import plan (docs/mcp-import/01-contracts.md §5). */
export const MCP_SUPERADMIN_ONLY = "MCP_SUPERADMIN_ONLY";
export const MCP_SUPERADMIN_ONLY_MESSAGE = "Only ESGLite staff (Superadmin) can connect Claude.";
