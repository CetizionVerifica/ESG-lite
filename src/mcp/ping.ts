import { defineTool } from "./registry";

/**
 * The one tool IM6 ships for real: proves the connection, token and role
 * work. No scope needed, no client named, nothing read from client data.
 */
export const pingTool = defineTool({
  name: "ping",
  title: "Ping ESGLite",
  description: "Checks that the ESGLite connection works. Returns the server time and the scopes this connection has.",
  input: {},
  scope: null,
  clientKey: null,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (ctx) => ({
    ok: true,
    server: "esglite",
    time: new Date().toISOString(),
    scopes: ctx.scopes,
  }),
});
