import { IMPORT_ERRORS } from "../imports/errors";

/**
 * Error codes the MCP core raises itself. The import codes
 * (IMPORT_PLAN_NOT_FOUND, ...) live in src/imports/errors.ts (IM0) and reach
 * the client through mapToolError in ./errors.ts. The three shared codes
 * (MCP_SUPERADMIN_ONLY, MCP_DISABLED_FOR_CLIENT, CLIENT_INACTIVE) take their
 * messages from IM0 so a client sees one vocabulary whether the refusal came
 * from HTTP or from a tool.
 */
export const MCP_CODES = {
  /** Token is not from a Superadmin account (decision D4). HTTP 403. */
  MCP_SUPERADMIN_ONLY: "MCP_SUPERADMIN_ONLY",
  /** The named client has "Allow Claude imports" switched off. Tool error. */
  MCP_DISABLED_FOR_CLIENT: "MCP_DISABLED_FOR_CLIENT",
  /** The named client is deactivated (company.status = false). Tool error. */
  CLIENT_INACTIVE: "CLIENT_INACTIVE",
  /** The named client does not exist. Tool error. */
  CLIENT_NOT_FOUND: "CLIENT_NOT_FOUND",
  /** Tool registered by IM6 as a stub; IM7/IM8 fill it in. */
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  /** Tool handler ran past the per-call timeout. */
  TIMEOUT: "TIMEOUT",
  /** Anything unexpected; details only in the server log, keyed by request_id. */
  INTERNAL: "INTERNAL",
} as const;

export type McpCode = (typeof MCP_CODES)[keyof typeof MCP_CODES];

export const MCP_MESSAGES: Record<McpCode, string> = {
  MCP_SUPERADMIN_ONLY: IMPORT_ERRORS.MCP_SUPERADMIN_ONLY.message,
  MCP_DISABLED_FOR_CLIENT: IMPORT_ERRORS.MCP_DISABLED_FOR_CLIENT.message,
  CLIENT_INACTIVE: IMPORT_ERRORS.CLIENT_INACTIVE.message,
  CLIENT_NOT_FOUND: "No client with this company_id.",
  NOT_IMPLEMENTED: "This tool is not available yet.",
  TIMEOUT: "The tool took too long and was stopped.",
  INTERNAL: "Something went wrong on the ESGLite side.",
};
