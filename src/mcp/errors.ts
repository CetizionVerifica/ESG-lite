import { randomUUID } from "crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { IMPORT_ERRORS, isImportError } from "../imports/errors";
import { log } from "../utils/logger";
import { MCP_CODES, MCP_MESSAGES, McpCode } from "./codes";

/**
 * An error a tool handler throws on purpose. `code` is one of the IM0 import
 * codes or an MCP_CODES value; `details` is safe to show the client (ids and
 * counts, never SQL, stack or another company's names).
 */
export class McpToolError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? MCP_MESSAGES[code as McpCode] ?? code);
    this.name = "McpToolError";
    this.code = code;
    this.details = details;
  }
}

/** IM0's ImportError (any instance, or a plain object carrying one of its codes), never a Node or pg error. */
const isContractError = (err: unknown): err is { code: string; message?: string; details?: unknown } =>
  isImportError(err) ||
  (typeof err === "object" && err !== null && typeof (err as any).code === "string" && (err as any).code in IMPORT_ERRORS);

/**
 * Shapes a failed tool call the way docs/mcp-import/01-contracts.md §9 wants:
 * `isError: true`, one text line "<code>: <message>" and
 * `structuredContent: { code, details }`.
 */
export const toolErrorResult = (code: string, message: string, details?: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: `${code}: ${message}` }],
  structuredContent: { code, ...(details === undefined ? {} : { details }) },
});

/**
 * Turns whatever a handler threw into a tool error result.
 * - McpToolError and IM0's ImportError pass their code, message and details
 *   through: those messages are written for clients.
 * - Everything else (Node, pg, SDK errors, whatever their `code`) becomes
 *   INTERNAL with a request id; the real error, host names and all, goes to
 *   the server log under that id only.
 */
export const mapToolError = (err: unknown, tool: string): { result: CallToolResult; code: string } => {
  if (err instanceof McpToolError) {
    return { result: toolErrorResult(err.code, err.message, err.details), code: err.code };
  }
  if (isContractError(err)) {
    const message = typeof err.message === "string" && err.message ? err.message : err.code;
    return { result: toolErrorResult(err.code, message, err.details), code: err.code };
  }
  const requestId = randomUUID();
  log.error("MCP", "Tool failed", { tool, requestId, error: err instanceof Error ? err.stack || err.message : String(err) });
  return {
    result: toolErrorResult(MCP_CODES.INTERNAL, `${MCP_MESSAGES.INTERNAL} Reference: ${requestId}`, { request_id: requestId }),
    code: MCP_CODES.INTERNAL,
  };
};
