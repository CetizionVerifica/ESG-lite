import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../utils/logger";
import { McpPrincipal, McpScope } from "./auth";
import { assertClientUsable } from "./clientAccess";
import { MCP_CODES } from "./codes";
import { mapToolError, McpToolError } from "./errors";
import { recordToolCall } from "./toolCallLog";

/**
 * What a tool handler gets besides its validated input.
 * - `user`: the Superadmin behind the token (role re-read on this request).
 * - `log`: structured logger scoped to the tool; log ids, never row payloads.
 * - `setPlanId`: tells the call log which plan this call touched.
 * Handlers call the IM2/IM3 services directly, never HTTP routes.
 */
export interface McpToolContext {
  user: McpPrincipal;
  scopes: string[];
  grant_id: string;
  signal: AbortSignal;
  log: (message: string, meta?: Record<string, unknown>) => void;
  setPlanId: (planId: string | null | undefined) => void;
}

export type ToolHandler<Input> = (ctx: McpToolContext, input: Input) => Promise<unknown | CallToolResult>;

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** zod object shape (from src/imports/contracts.ts for the real tools). */
  input: Shape;
  /** Scope the grant must carry; null = any authenticated Superadmin (e.g. ping). */
  scope: McpScope | null;
  annotations?: ToolAnnotations;
  /**
   * When the input carries this key, the named client is checked before the
   * handler runs: must exist, be active and have mcp_enabled on. Default
   * "company_id"; set to null for tools that take no client id (ping,
   * whoami, or tools that look the client up from a plan themselves).
   */
  clientKey?: string | null;
  handler: ToolHandler<z.infer<z.ZodObject<Shape>>>;
}

export const defineTool = <Shape extends z.ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> => def;

/** Names the server must never expose (audit row MCP-19), checked at registration. */
const FORBIDDEN_NAME = /approve|reject|edit|delete|remove|user|site_(create|update)|factor|form_(create|update)/i;
const ALLOWED_DESPITE_PATTERN = new Set(["list_sites_and_categories", "get_category_form", "cancel_import_plan"]);

export const CALL_TIMEOUT_MS = 30_000;

/** Turns a handler's plain return value into a tool result with a neutral summary line. */
const toResult = (name: string, value: unknown): CallToolResult => {
  if (value && typeof value === "object" && Array.isArray((value as any).content)) return value as CallToolResult;
  const data = value === undefined ? {} : value;
  return {
    content: [{ type: "text", text: `${name}: ok` }],
    structuredContent: typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : { data },
  };
};

/**
 * Adds the full result as a JSON text block after the summary line. The
 * claude.ai connector shows the model only the text content, not
 * `structuredContent`, so without this Claude saw counts and never a site,
 * category or activity name (MI-2 check, 2026-10-13). The summary line
 * stays neutral (ids and counts); the JSON block is the data the tool
 * returns and is logged nowhere.
 */
const withTextResult = (result: CallToolResult): CallToolResult => {
  if (result.isError) return result;
  const data = result.structuredContent;
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) return result;
  if (result.content.some((c) => c.type === "text" && c.text.startsWith("{"))) return result;
  return { ...result, content: [...result.content, { type: "text", text: JSON.stringify(data) }] };
};

/**
 * Runs `work` with a signal that aborts after `ms` or when the client cancels
 * (`parent`). The handler gets that signal as `ctx.signal`, so a cooperative
 * handler (query timeouts, fetch) stops too; a non-cooperative one is simply
 * no longer awaited and its result discarded.
 */
export const withTimeout = <T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
      fn();
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new McpToolError(MCP_CODES.TIMEOUT)));
    }, ms);
    const onParentAbort = () => {
      controller.abort();
      finish(() => reject(new McpToolError(MCP_CODES.TIMEOUT, "The request was cancelled.")));
    };
    if (parent?.aborted) return onParentAbort();
    parent?.addEventListener("abort", onParentAbort, { once: true });
    work(controller.signal).then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });

/**
 * Registers every tool the principal's scopes allow on a fresh McpServer and
 * wraps each handler with: client switch check, 30 s timeout, error mapping
 * (contracts §9) and the tool-call log row (no payloads).
 */
export const registerTools = (server: McpServer, tools: ToolDefinition<any>[], principal: McpPrincipal): string[] => {
  const registered: string[] = [];
  for (const def of tools) {
    if (FORBIDDEN_NAME.test(def.name) && !ALLOWED_DESPITE_PATTERN.has(def.name)) {
      throw new Error(`MCP tool "${def.name}" is not allowed: the server never exposes approve, reject, edit, delete, user, site, factor or form management.`);
    }
    if (def.scope && !principal.scopes.includes(def.scope)) continue;
    registered.push(def.name);
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: def.input, annotations: def.annotations },
      (async (input: Record<string, unknown>, extra: { signal: AbortSignal }) => {
        const started = Date.now();
        let planId: string | null = null;
        const clientKey = def.clientKey === undefined ? "company_id" : def.clientKey;
        const companyId = clientKey && typeof input?.[clientKey] === "number" ? (input[clientKey] as number) : null;
        const ctx: McpToolContext = {
          user: principal,
          scopes: principal.scopes,
          grant_id: principal.grant_id,
          signal: extra.signal, // replaced per call below with the timeout-aware signal
          log: (message, meta) => log.info("MCP", `${def.name}: ${message}`, { user_id: principal.user_id, ...meta }),
          setPlanId: (id) => {
            planId = id ?? null;
          },
        };
        let result: CallToolResult;
        let errorCode: string | null = null;
        try {
          result = await withTimeout(
            async (signal) => {
              ctx.signal = signal;
              if (clientKey && companyId !== null) await assertClientUsable(companyId);
              return withTextResult(toResult(def.name, await def.handler(ctx, input as any)));
            },
            CALL_TIMEOUT_MS,
            extra.signal,
          );
          if (result.isError) errorCode = String((result.structuredContent as any)?.code ?? "ERROR");
        } catch (err) {
          const mapped = mapToolError(err, def.name);
          result = mapped.result;
          errorCode = mapped.code;
        }
        if (typeof input?.plan_id === "string" && !planId) planId = input.plan_id as string;
        await recordToolCall({
          grant_id: principal.grant_id,
          user_id: principal.user_id,
          company_id: companyId,
          tool: def.name,
          plan_id: planId,
          ok: errorCode === null,
          error_code: errorCode,
          duration_ms: Date.now() - started,
        });
        return result;
      }) as any,
    );
  }
  return registered;
};
