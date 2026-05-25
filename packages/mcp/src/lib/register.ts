// Helper that wraps `server.registerTool(...)` with the shared
// error-handling shape every LeadRails MCP tool needs.
//
// The MCP SDK 1.29 surface (https://github.com/modelcontextprotocol/typescript-sdk)
// expects:
//
//   server.registerTool(
//     name,
//     { title, description, inputSchema, outputSchema },
//     async (args) => ({ content, structuredContent?, isError? })
//   );
//
// Three things every LeadRails tool wants but the SDK doesn't provide:
//
//   1. Catch `ApiError` and convert to a dual-emit error response with
//      the right human summary (plan-required → upgrade hint, 429 →
//      Retry-After surface, etc.). Without this wrapper, a thrown
//      `ApiError` would bubble out as a generic JSON-RPC error and the
//      LLM would see "internal error" instead of "your plan doesn't
//      support this — upgrade at …".
//
//   2. Catch any other thrown error and surface it as a structured
//      tool error rather than letting the JSON-RPC layer return a
//      protocol-level error. Tools failing should NOT kill the MCP
//      connection.
//
//   3. Stamp a uniform error path for the SDK's `cb` argument signature
//      (which takes `(args, extra)` for tools that declare an input
//      shape) so the tool factories below don't have to re-implement
//      try/catch fences in every handler.
//
// This file is intentionally tiny — the goal is one chokepoint for
// "what does a LeadRails tool look like" without abstracting over
// the SDK's actual API.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z, ZodRawShape } from "zod";
import { ApiError } from "./api-client.js";
import { errorResult, type ToolResult } from "./dual-emit.js";

/**
 * Type-level helper: derive the parsed-input object type from a
 * `ZodRawShape`. The SDK has an internal `ShapeOutput<>` type that
 * does the same thing, but it's not part of the public surface. We
 * re-implement it locally so this module doesn't depend on the SDK's
 * private types — Zod 4 exposes the per-schema output type via
 * `z.output<T>`.
 */
export type ShapeOutputOf<Shape extends ZodRawShape> = {
  [K in keyof Shape]: z.output<Shape[K]>;
};

/**
 * Args accepted by `registerTool`. The shape mirrors what the MCP SDK
 * expects so the wrapper is a thin pass-through; the only change is
 * `inputSchema` / `outputSchema` accept a `ZodRawShape` directly (a
 * plain object literal) which is what the SDK already uses.
 */
export interface ToolDefinition<
  InputShape extends ZodRawShape = ZodRawShape,
  OutputShape extends ZodRawShape = ZodRawShape,
> {
  title: string;
  description: string;
  inputSchema: InputShape;
  outputSchema?: OutputShape;
  handler: (input: ShapeOutputOf<InputShape>) => Promise<ToolResult>;
}

/**
 * Loose-typed alias used at heterogenous record sites (e.g. the
 * `createXxxTools(...)` factories that return tools for several
 * resources at once). The strict per-tool generic above stays in force
 * inside each factory; the loose alias only relaxes the value type at
 * the record boundary so a `Record<string, ToolDefinition>` works for
 * any tool shape.
 */
export type AnyToolDefinition = ToolDefinition<
  ZodRawShape,
  ZodRawShape
>;

/**
 * Register one tool. Wraps the handler so any thrown `ApiError`
 * becomes an `errorResult(...)`, and any other thrown error becomes a
 * generic error response with the message exposed (so an LLM can
 * recover; the connection stays open).
 */
export function registerTool<
  InputShape extends ZodRawShape,
  OutputShape extends ZodRawShape,
>(
  server: McpServer,
  name: string,
  def: ToolDefinition<InputShape, OutputShape>,
): void {
  const config: {
    title: string;
    description: string;
    inputSchema: InputShape;
    outputSchema?: OutputShape;
  } = {
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
  };
  if (def.outputSchema !== undefined) {
    config.outputSchema = def.outputSchema;
  }

  // The SDK's `cb` signature is `(args, extra) => CallToolResult`. We
  // intentionally cast through `unknown` here: the SDK derives the
  // exact `args` type from the `inputSchema` overload it selects, and
  // our `ShapeOutputOf<>` matches structurally. Going through the
  // SDK's exposed types would require importing the private
  // `ShapeOutput<>` helper. The runtime call is sound because
  // `def.handler` is a function of `ShapeOutputOf<InputShape>` and
  // the SDK's `BaseToolCallback` calls it with the same shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cb = (async (args: unknown): Promise<ToolResult> => {
    try {
      return await def.handler(args as ShapeOutputOf<InputShape>);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResult(err);
      }
      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `LeadRails MCP tool error: ${message}`,
          },
        ],
      };
    }
    // The SDK accepts a sync callable too; we always return a
    // promise. Casting to `any` is the same workaround the SDK uses
    // internally; the runtime contract is preserved.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  server.registerTool(name, config, cb);
}
