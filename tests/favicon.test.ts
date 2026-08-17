import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";

describe("favicon routes", () => {
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

  it("GET /favicon.svg returns image/svg+xml", async () => {
    const res = await fetch(`${baseUrl}/favicon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    const text = await res.text();
    expect(text).toContain("<svg");
  });

  it("GET /favicon.ico returns 200", async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.length).toBeGreaterThan(0);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
  });

  it("GET /favicon.png returns image/png", async () => {
    const res = await fetch(`${baseUrl}/favicon.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/png/);
  });
});
