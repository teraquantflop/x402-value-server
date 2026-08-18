import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { buildSkillMd } from "../src/discovery/skillMd.js";
import { openApiDocument } from "../src/routes/openapi.js";

describe("buildSkillMd", () => {
  it("covers desk, pay, free/paid, surface value-add, and openapi link", () => {
    const md = buildSkillMd(config);
    expect(md).toMatch(/derivatives|Black-Scholes/i);
    expect(md).toContain(config.publicBaseUrl.replace(/\/$/, ""));
    expect(md).toMatch(/x402|PAYMENT-REQUIRED|402/i);
    expect(md).toContain("/openapi.json");
    expect(md).toContain("/swagger.json");
    expect(md).toContain("/v1/option/price");
    expect(md).toContain("/v1/volatility/surface");
    expect(md).toContain(config.priceVolSurfaceDollarString);
    expect(md).toContain("/v1/option/price-from-surface");
    expect(md).toContain("/v1/option/scenario-from-surface");
    expect(md).toContain("underlying");
    expect(md).not.toMatch(/Runge|RK-Vega|fastImpliedVol|iteration/i);
  });
});

describe("GET /swagger.json and /skill.md HTTP", () => {
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

  it("GET /swagger.json returns 200 and matches openapi.json", async () => {
    const [swaggerRes, openapiRes] = await Promise.all([
      fetch(`${baseUrl}/swagger.json`),
      fetch(`${baseUrl}/openapi.json`),
    ]);
    expect(swaggerRes.status).toBe(200);
    expect(openapiRes.status).toBe(200);
    expect(swaggerRes.headers.get("content-type")).toMatch(/application\/json/);
    const swagger = await swaggerRes.json();
    const openapi = await openapiRes.json();
    expect(swagger).toEqual(openapi);
    expect(swagger).toEqual(openApiDocument);
  });

  it("GET /skill.md and /SKILL.md return 200 markdown", async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/skill.md`),
      fetch(`${baseUrl}/SKILL.md`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get("content-type")).toMatch(/markdown|text\/plain|text\/markdown/i);
    const body = await a.text();
    const bodyUpper = await b.text();
    expect(body).toBe(bodyUpper);
    expect(body).toContain("/v1/volatility/surface");
    expect(body).toContain(config.priceVolSurfaceDollarString);
    expect(body).toContain("/openapi.json");
  });

  it("lists swagger and skill on service card and well-known links", async () => {
    const [cardRes, wkRes, llmsRes] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/.well-known/x402.json`),
      fetch(`${baseUrl}/llms.txt`),
    ]);
    expect(cardRes.status).toBe(200);
    expect(wkRes.status).toBe(200);
    expect(llmsRes.status).toBe(200);

    const card = (await cardRes.json()) as {
      endpoints: { free: { path: string }[] };
    };
    const freePaths = card.endpoints.free.map((e) => e.path);
    expect(freePaths).toContain("/swagger.json");
    expect(freePaths).toContain("/skill.md");
    expect(freePaths).toContain("/SKILL.md");

    const wk = (await wkRes.json()) as {
      links?: { swagger?: string; skillMd?: string; openapi?: string };
    };
    expect(wk.links?.openapi).toContain("/openapi.json");
    expect(wk.links?.swagger).toContain("/swagger.json");
    expect(wk.links?.skillMd).toContain("/skill.md");

    const llms = await llmsRes.text();
    expect(llms).toContain("/swagger.json");
    expect(llms).toContain("/skill.md");
  });
});
