import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

describe("MCP Streamable HTTP smoke", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /mcp returns 405 method not allowed", async () => {
    if (!config.mcpEnabled) return;
    const res = await fetch(`${baseUrl}${config.mcpPath}`);
    expect(res.status).toBe(405);
  });

  it("POST /mcp without dual Accept returns 406 JSON-RPC hint", async () => {
    if (!config.mcpEnabled) return;
    const res = await fetch(`${baseUrl}${config.mcpPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(406);
    const body = (await res.json()) as {
      jsonrpc: string;
      error: { code: number; message: string; data?: { hint?: string; path?: string; docs?: string } };
      id: null;
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.code).toBe(-32000);
    expect(body.error.message).toMatch(/Not Acceptable/i);
    expect(body.error.data?.hint).toMatch(/Retry initialize/i);
    expect(body.error.data?.path).toBe(config.mcpPath);
    expect(body.error.data?.docs).toContain("/llms.txt");
  });

  it("POST /mcp is mounted and responds (JSON-RPC envelope)", async () => {
    if (!config.mcpEnabled) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${baseUrl}${config.mcpPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
        signal: controller.signal,
      });

      // 200/202 = healthy MCP; 500 possible if facilitator unreachable in CI
      expect([200, 202, 500]).toContain(res.status);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
    }
  }, 20_000);
});
