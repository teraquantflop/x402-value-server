/**
 * Stateless Streamable HTTP transport for MCP (one server instance per request).
 */
import type { Request, Response, Express } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { x402ResourceServer } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { createDerivativesMcpServer } from "./server.js";

export function mountMcpRoutes(
  app: Express,
  config: AppConfig,
  resourceServer: x402ResourceServer | null,
): void {
  if (!config.mcpEnabled) return;

  const path = config.mcpPath;
  let initPromise: Promise<void> | null = null;

  /** Facilitator kind catalog — required before buildPaymentRequirements. */
  const ensureResourceServerReady = async (): Promise<void> => {
    if (!resourceServer || config.skipPayment) return;
    if (!initPromise) {
      initPromise = resourceServer.initialize().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    await initPromise;
  };

  app.post(path, async (req: Request, res: Response) => {
    if (!resourceServer) {
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "MCP payment stack not initialized" },
        id: null,
      });
      return;
    }

    try {
      await ensureResourceServerReady();
      const server = await createDerivativesMcpServer(config, resourceServer);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (err) {
      console.error("[mcp] request error", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              err instanceof Error
                ? err.message
                : "Internal MCP server error",
          },
          id: null,
        });
      }
    }
  });

  app.get(path, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST for Streamable HTTP MCP.",
      },
      id: null,
    });
  });

  app.delete(path, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });
}
