/**
 * Build the llms.txt Markdown document for AI agent discovery.
 * Convention: H1 + blockquote summary + sections with links.
 */
import type { AppConfig } from "../types.js";
import { SERVICE_CATALOG } from "./catalog.js";

function abs(base: string, path: string): string {
  const root = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${root}${p}`;
}

/**
 * Generate a concise llms.txt body from live config (prices, base URL, networks).
 */
export function buildLlmsTxt(config: AppConfig): string {
  const base = config.publicBaseUrl.replace(/\/$/, "");
  const networks = config.networks.join(", ");
  const networkIds = config.networkIds.join(", ");

  const lines: string[] = [
    `# ${SERVICE_CATALOG.productName}`,
    "",
    `> ${SERVICE_CATALOG.tagline} Settle **USDC** via HTTP 402 (x402 exact) on **Solana mainnet and/or Base mainnet** — no API keys.`,
    "",
    "## Overview",
    "",
    SERVICE_CATALOG.description,
    "",
    `- **Version:** ${config.serviceVersion}`,
    `- **Protocol:** x402 (exact scheme, USDC)`,
    `- **Networks:** ${networks} (\`${networkIds}\`)`,
    `- **Facilitator:** ${config.facilitatorUrl}`,
    `- **Markets:** ${SERVICE_CATALOG.markets.join(", ")}`,
    "",
    "## Capabilities",
    "",
    ...SERVICE_CATALOG.capabilities.map((c) => `- ${c.replace(/_/g, " ")}`),
    "",
    "## Paid endpoints (USDC exact)",
    "",
    `- [POST /v1/option/price](${abs(base, "/v1/option/price")}) — **${config.priceDollarString}** — European Black-Scholes-Merton fair value + full analytic Greeks`,
    `- [POST /v1/option/implied-vol](${abs(base, "/v1/option/implied-vol")}) — **${config.priceImpliedVolDollarString}** — Solve implied vol from one market premium + Greeks`,
    `- [POST /v1/volatility/surface](${abs(base, "/v1/volatility/surface")}) — **${config.priceVolSurfaceDollarString}** — IV surface grid + per-quote IV/Greeks from market premiums`,
    `- [POST /v1/portfolio/greeks](${abs(base, "/v1/portfolio/greeks")}) — **${config.pricePortfolioGreeksDollarString}** — Net MTM + Greeks for multi-leg books (signed quantity)`,
    `- [POST /v1/portfolio/scenario](${abs(base, "/v1/portfolio/scenario")}) — **${config.pricePortfolioScenarioDollarString}** — Scenario reprice under spot/vol/time shocks`,
    "",
    "Unpaid calls to paid paths return **HTTP 402** with a `PAYMENT-REQUIRED` header (base64). Clients may pay on **any** listed network.",
    "",
    "## Free discovery",
    "",
    `- [Service card (JSON)](${abs(base, "/")}) — capabilities, pricing, examples, agent hints`,
    `- [Health](${abs(base, "/health")}) — liveness, networks, prices, payTo`,
    `- [OpenAPI](${abs(base, "/openapi.json")}) — full request/response schemas`,
    `- [x402 well-known](${abs(base, "/.well-known/x402.json")}) — machine-readable x402 discovery manifest`,
    `- [x402 well-known (alias)](${abs(base, "/.well-known/x402")}) — same as above`,
    `- [llms.txt](${abs(base, "/llms.txt")}) — this file`,
    "",
    "## How agents should call",
    "",
    "1. Read this file or `GET /` / `GET /.well-known/x402.json` to choose an endpoint.",
    "2. `POST` the paid path without payment → parse `PAYMENT-REQUIRED` for accepts (network, payTo, amount).",
    "3. Settle USDC on Solana or Base via an x402 client; retry with payment proof.",
    "4. Optional: send `Idempotency-Key` for safe retries after successful payment.",
    "",
    "## Notes",
    "",
    "- Model: European Black-Scholes-Merton with continuous dividend yield.",
    "- Greeks: analytic delta, gamma, vega, theta, rho (raw derivatives, not desk scalings).",
    "- No accounts, no API keys — public payTo addresses only on the server.",
    "",
  ];

  return lines.join("\n");
}
