import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpPrincipal } from "./auth";
import { INSTRUCTIONS } from "./guide/instructions";
import { pingTool } from "./ping";
import { registerTools, ToolDefinition } from "./registry";
import { importTools } from "./tools/import";
import { readTools } from "./tools/read";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: PACKAGE_VERSION } = require("../../package.json") as { version: string };

export const SERVER_NAME = "esglite";

/** Every tool the server knows, before scope filtering. */
export const allTools = (): ToolDefinition<any>[] => [pingTool, ...readTools, ...importTools];

/**
 * One McpServer per request (stateless Streamable HTTP): registers the tools
 * the principal's scopes allow, so `tools/list` already reflects the grant.
 */
export const buildMcpServer = (principal: McpPrincipal): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, title: "ESGLite", version: PACKAGE_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, allTools(), principal);
  return server;
};
