import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { DEMO_OPTION_INPUTS } from "../src/routes/demo.js";

describe("free demo option-price", () => {
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

  it("GET /v1/demo/option-price returns fixed sample via live engine", async () => {
    const res = await fetch(`${baseUrl}/v1/demo/option-price`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-demo")).toBe("true");
    const body = (await res.json()) as {
      price: number;
      greeks: { delta: number };
      inputs: typeof DEMO_OPTION_INPUTS;
      demo: boolean;
    };
    expect(body.demo).toBe(true);
    expect(body.inputs).toMatchObject(DEMO_OPTION_INPUTS);
    expect(body.price).toBeCloseTo(10.45057562, 4);
    expect(body.greeks.delta).toBeCloseTo(0.6368, 3);
  });

  it("POST /v1/demo/option-price ignores body and returns same fixed sample", async () => {
    const res = await fetch(`${baseUrl}/v1/demo/option-price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inputs: { spot: number } };
    expect(body.inputs.spot).toBe(100);
  });
});
