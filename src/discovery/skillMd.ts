/**
 * Short agent-loader skill document (GET /skill.md | /SKILL.md).
 * No solver / RK / implementation internals.
 */
import type { AppConfig } from "../types.js";
import { SERVICE_CATALOG } from "./catalog.js";

function abs(base: string, path: string): string {
  const root = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${root}${p}`;
}

/**
 * Concise Markdown for agent skill loaders.
 */
export function buildSkillMd(config: AppConfig): string {
  const base = config.publicBaseUrl.replace(/\/$/, "");

  const lines: string[] = [
    `# ${SERVICE_CATALOG.productName}`,
    "",
    "## What",
    "",
    "x402 **derivatives desk**: European Black-Scholes fair value + Greeks, single-premium implied vol, **IV smile/surface**, portfolio net Greeks, and scenario reprice.",
    "",
    `- **Base URL:** ${base}`,
    `- **Version:** ${config.serviceVersion}`,
    "",
    "## Pay",
    "",
    "x402 **exact USDC** on **Solana** and **Base**. Unpaid paid-routes return **HTTP 402** with `PAYMENT-REQUIRED` (base64). Settle on either network, then retry with payment proof. Optional `Idempotency-Key`.",
    "",
    "## Free discovery",
    "",
    `- \`GET /\` — service card`,
    `- \`GET /health\``,
    `- \`GET /openapi.json\` · \`GET /swagger.json\` (same OpenAPI)`,
    `- \`GET /llms.txt\``,
    `- \`GET /skill.md\` · \`GET /SKILL.md\` (this file)`,
    `- \`GET /.well-known/x402\` · \`GET /.well-known/x402.json\``,
    "",
    "## Paid routes (USDC exact)",
    "",
    `| Method | Path | Price |`,
    `|--------|------|-------|`,
    `| POST | /v1/option/price | ${config.priceDollarString} |`,
    `| POST | /v1/option/implied-vol | ${config.priceImpliedVolDollarString} |`,
    `| POST | /v1/volatility/surface | ${config.priceVolSurfaceDollarString} |`,
    `| POST | /v1/option/price-from-surface | ${config.priceOptionFromSurfaceDollarString} |`,
    `| POST | /v1/option/scenario-from-surface | ${config.priceScenarioFromSurfaceDollarString} |`,
    `| POST | /v1/portfolio/greeks | ${config.pricePortfolioGreeksDollarString} |`,
    `| POST | /v1/portfolio/scenario | ${config.pricePortfolioScenarioDollarString} |`,
    "",
    "## Value-add: implied vol surface",
    "",
    `**POST \`/v1/volatility/surface\` — ${config.priceVolSurfaceDollarString}**`,
    "",
    "Build an implied-vol **smile / term structure** from a strip of market options. Each contract carries its own `underlying` (forward or spot-as-forward), `strike`, `timeToExpiry`, `optionType`, and `premium`; shared `rate` / `dividendYield`. Response includes per-quote IVs, smile/term structure, and Greeks metadata.",
    "",
    "Related (price on a submitted smile):",
    "",
    `- \`POST /v1/option/price-from-surface\` — ${config.priceOptionFromSurfaceDollarString}`,
    `- \`POST /v1/option/scenario-from-surface\` — ${config.priceScenarioFromSurfaceDollarString}`,
    "",
    "### Surface example (commodity-friendly underlyings)",
    "",
    "```json",
    JSON.stringify(
      {
        rate: 0.04,
        dividendYield: 0,
        options: [
          {
            underlying: 78.5,
            strike: 75,
            timeToExpiry: 0.25,
            optionType: "call",
            premium: 6.2,
          },
          {
            underlying: 80.0,
            strike: 80,
            timeToExpiry: 0.5,
            optionType: "call",
            premium: 5.1,
          },
          {
            underlying: 81.2,
            strike: 85,
            timeToExpiry: 1.0,
            optionType: "put",
            premium: 7.4,
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "## Quick start: single option price",
    "",
    `**POST \`/v1/option/price\` — ${config.priceDollarString}**`,
    "",
    "```json",
    JSON.stringify(
      {
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
        dividendYield: 0,
      },
      null,
      2,
    ),
    "```",
    "",
    "Unpaid → **402**; pay USDC per `PAYMENT-REQUIRED`, retry the same POST.",
    "",
    "## MCP",
    "",
    `- Streamable HTTP: \`POST ${"/mcp"}\` (see service card \`mcp\` field).`,
    "- Free: `service_info`. Paid tools mirror HTTP 1:1: `price_option`, `implied_vol`, `implied_vol_surface`, `price_from_surface`, `scenario_from_surface`, `portfolio_greeks`, `portfolio_scenario`.",
    "- Clients must send `Accept: application/json, text/event-stream`.",
    "",
    "## Spec",
    "",
    `- Full schemas: [${abs(base, "/openapi.json")}](${abs(base, "/openapi.json")})`,
    `- Alias: [${abs(base, "/swagger.json")}](${abs(base, "/swagger.json")})`,
    "",
  ];

  return lines.join("\n");
}
