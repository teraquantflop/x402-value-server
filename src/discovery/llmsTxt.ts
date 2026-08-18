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
    `> ${SERVICE_CATALOG.tagline} Settle **USDC** via HTTP 402 (x402 exact) on **Solana and/or Base** — no API keys.`,
    "",
    "## What this service does (English)",
    "",
    SERVICE_CATALOG.description,
    "",
    "## Capability summary",
    "",
    ...SERVICE_CATALOG.capabilitySummary.map((c) => `- ${c}`),
    "",
    `- **Version:** ${config.serviceVersion}`,
    `- **Protocol:** x402 (exact scheme, USDC)`,
    `- **Networks:** ${networks} (\`${networkIds}\`)`,
    `- **Facilitator:** ${config.facilitatorUrl}`,
    `- **Markets:** ${SERVICE_CATALOG.markets.join(", ")}`,
    "",
    "## Price list (USDC exact)",
    "",
    `| Endpoint | Price | Use when |`,
    `|----------|-------|----------|`,
    `| POST /v1/option/price | ${config.priceDollarString} | Have S,K,T,r,σ → fair value + Greeks |`,
    `| POST /v1/option/implied-vol | ${config.priceImpliedVolDollarString} | One market premium → σ̂ + Greeks |`,
    `| POST /v1/volatility/surface | ${config.priceVolSurfaceDollarString} | Premium book / multi-maturity power-commodity surface |`,
    `| POST /v1/portfolio/greeks | ${config.pricePortfolioGreeksDollarString} | Multi-leg net MTM + Greeks |`,
    `| POST /v1/portfolio/scenario | ${config.pricePortfolioScenarioDollarString} | Spot/vol/time scenario P&L (scalar σ) |`,
    `| POST /v1/option/price-from-surface | ${config.priceOptionFromSurfaceDollarString} | Price on submitted IV surface (TV bilinear) |`,
    `| POST /v1/option/scenario-from-surface | ${config.priceScenarioFromSurfaceDollarString} | Book reval on surface + sticky smile shocks |`,
    `| GET/POST /v1/demo/option-price | free | Fixed ATM sample (discovery seeding) |`,
    "",
  ];

  if (config.freeTierN > 0) {
    lines.push(
      `Optional soft free tier: first **${config.freeTierN}** calls to \`POST /v1/option/price\` per IP per window are free (\`FREE_TIER_N\`).`,
      "",
    );
  }

  lines.push(
    "## Paid endpoint links",
    "",
    `- [POST /v1/option/price](${abs(base, "/v1/option/price")}) — **${config.priceDollarString}**`,
    `- [POST /v1/option/implied-vol](${abs(base, "/v1/option/implied-vol")}) — **${config.priceImpliedVolDollarString}**`,
    `- [POST /v1/volatility/surface](${abs(base, "/v1/volatility/surface")}) — **${config.priceVolSurfaceDollarString}**`,
    `- [POST /v1/portfolio/greeks](${abs(base, "/v1/portfolio/greeks")}) — **${config.pricePortfolioGreeksDollarString}**`,
    `- [POST /v1/portfolio/scenario](${abs(base, "/v1/portfolio/scenario")}) — **${config.pricePortfolioScenarioDollarString}**`,
    `- [POST /v1/option/price-from-surface](${abs(base, "/v1/option/price-from-surface")}) — **${config.priceOptionFromSurfaceDollarString}**`,
    `- [POST /v1/option/scenario-from-surface](${abs(base, "/v1/option/scenario-from-surface")}) — **${config.priceScenarioFromSurfaceDollarString}**`,
    "",
    "Unpaid paid-path calls return **HTTP 402** with `PAYMENT-REQUIRED` (base64). Pay on **any** listed network.",
    "",
    "## Free discovery",
    "",
    `- [Service card (JSON)](${abs(base, "/")})`,
    `- [Health](${abs(base, "/health")})`,
    `- [OpenAPI](${abs(base, "/openapi.json")})`,
    `- [x402 well-known](${abs(base, "/.well-known/x402.json")})`,
    `- [llms.txt](${abs(base, "/llms.txt")}) — this file`,
  );

  if (config.freeDemoEnabled) {
    lines.push(
      `- [Free demo option price](${abs(base, "/v1/demo/option-price")}) — fixed ATM BSM sample`,
    );
  }
  if (config.mcpEnabled) {
    lines.push(
      `- [MCP Streamable HTTP](${abs(base, config.mcpPath)}) — tools: \`price_option\`, \`implied_vol_surface\`, \`service_info\``,
    );
  }

  lines.push(
    "",
    "## When to call which tool",
    "",
    "- **price / price_option** — model inputs known; need fair value + Greeks (equity spot or power forward mark as S).",
    "- **implied-vol** — one market premium to invert; not a full book.",
    "- **surface / implied_vol_surface** — multi-strike multi-maturity premiums; underlyings may differ by maturity.",
    "- **portfolio/greeks** — net risk on a multi-leg book.",
    "- **portfolio/scenario** — shocked MTM under spot/vol/time (scalar σ per leg).",
    "- **price-from-surface** — price on a submitted smile (TV bilinear in k,T); wingRule=flat_vol.",
    "- **scenario-from-surface** — base vs scenario on same interpolator; sticky moneyness|strike|fixed_vol; smileTwist = vol pts per unit k.",
    "",
    "## How agents should pay",
    "",
    "1. Discover via this file, `GET /`, or `GET /.well-known/x402.json`.",
    "2. Optional: hit free demo to validate JSON shape without a wallet.",
    "3. `POST` paid path unpaid → parse `PAYMENT-REQUIRED` accepts (Solana and/or Base).",
    "4. Settle USDC; retry with payment proof. Optional `Idempotency-Key`.",
    "5. MCP hosts: connect to the MCP URL; paid tools may require USDC the same way.",
    "",
    "## Notes",
    "",
    "- Model: European Black-Scholes-Merton with continuous dividend/convenience yield.",
    "- Greeks: raw analytic derivatives (not per-1% / per-day desk scalings).",
    "- No accounts, no API keys — public payTo only on the server.",
    "",
  );

  return lines.join("\n");
}
