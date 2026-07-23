/**
 * Single source of truth for Bazaar + human/agent discovery metadata.
 * Constraints (Bazaar soft-validation):
 * - description ≤ 500 chars
 * - serviceName ≤ 32 printable ASCII
 * - tags ≤ 5, each ≤ 32 printable ASCII
 */
import type { AppConfig } from "../types.js";
import { isSvmNetworkId } from "../config.js";

export const SERVICE_CATALOG = {
  /** Short Bazaar serviceName (≤32) — used on route configs */
  serviceName: "x402 Derivatives Desk",
  /** Longer product name for GET / */
  productName: "x402 Derivatives Analytics Desk",
  versionField: "serviceVersion",
  tagline:
    "Pay-per-call Black-Scholes pricing, Greeks, and implied-volatility surfaces for AI trading and risk agents.",
  /** Full service description for GET / and README (no 500-char limit) */
  description:
    "Production x402-paid quant API for autonomous agents in equities, commodities, power, and crypto derivatives. " +
    "Price European options, extract full Greeks for hedging, and invert market books into IV surfaces — " +
    "no API keys, settle in USDC via HTTP 402. Built for risk analysis, portfolio optimization, and automated market-making workflows.",
  capabilities: [
    "european_option_pricing",
    "analytic_greeks",
    "implied_volatility_surface",
    "multi_maturity_underlyings",
    "x402_usdc_micropayments",
    "bazaar_discoverable",
    "idempotent_retries",
  ],
  useCases: [
    "AI agents pricing power, gas, oil, metal, or equity options in real time",
    "Delta/vega hedging loops for automated market makers",
    "Portfolio risk aggregation from Greeks across books",
    "Building IV surfaces from broker/exchange premium dumps",
    "Commodity and energy desk scenario analysis (BSM European)",
  ],
  markets: [
    "equities",
    "commodities",
    "power_and_energy",
    "crypto",
    "fx_style_european",
  ],
} as const;

function chainHint(config: AppConfig): string {
  const parts = config.networks.map((n) => {
    if (n === "solana") return "Solana";
    if (n === "solana-devnet") return "Solana Devnet";
    if (n === "base") return "Base";
    return "Base Sepolia";
  });
  return parts.join("/");
}

function settlementTag(config: AppConfig): string {
  return config.networkIds.some(isSvmNetworkId) ? "solana" : "base";
}

/** Clamp tags to Bazaar limits (max 5 × 32 ASCII). */
export function clampTags(tags: string[]): string[] {
  return tags
    .map((t) => t.replace(/[^\x20-\x7E]/g, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 5);
}

export function optionPriceDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  // ≤500 chars for facilitator/Bazaar
  const description =
    `European Black-Scholes-Merton fair value + full analytic Greeks (delta, gamma, vega, theta, rho) for AI risk, hedging, and trading agents. ` +
    `Input spot, strike, T, r, σ, call/put; optional dividend yield. ` +
    `Ideal for equities, commodities, power, and crypto European options. ` +
    `USDC exact on ${chain}. No API keys — pay per call via x402.`;

  return {
    serviceName: "BSM Price+Greeks",
    description: description.slice(0, 500),
    tags: clampTags([
      "options",
      "greeks",
      "risk",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Need a single European option fair value and hedge ratios from model inputs (S,K,T,r,σ).",
      relatedEndpoints: ["POST /v1/volatility/surface"],
    },
  };
}

export function volatilitySurfaceDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `Implied-volatility surface builder for AI trading agents: submit shared rate/yield plus options with per-row underlying, strike, T, type, and market premium. ` +
    `Returns IV grid, per-contract IV+Greeks, fit quality, and solve stats. ` +
    `Supports multi-maturity underlyings (e.g. power/commodity forwards). ` +
    `USDC exact on ${chain}. x402 pay-per-call — no accounts.`;

  return {
    serviceName: "IV Surface Desk",
    description: description.slice(0, 500),
    tags: clampTags([
      "volatility",
      "iv-surface",
      "commodities",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Have a book of market premiums and need IVs, Greeks, and a strike×maturity surface for risk or MM.",
      relatedEndpoints: ["POST /v1/option/price"],
    },
  };
}

/** Service card payload for GET / (agents + humans). */
export function buildServiceCard(config: AppConfig) {
  const optionMeta = optionPriceDiscovery(config);
  const surfaceMeta = volatilitySurfaceDiscovery(config);

  return {
    service: SERVICE_CATALOG.serviceName,
    productName: SERVICE_CATALOG.productName,
    version: config.serviceVersion,
    tagline: SERVICE_CATALOG.tagline,
    description: SERVICE_CATALOG.description,
    capabilities: [...SERVICE_CATALOG.capabilities],
    useCases: [...SERVICE_CATALOG.useCases],
    markets: [...SERVICE_CATALOG.markets],
    pricing: {
      currency: "USDC",
      scheme: "exact",
      optionPrice: {
        path: "POST /v1/option/price",
        price: config.priceDollarString,
        env: "PRICE_USD",
      },
      volatilitySurface: {
        path: "POST /v1/volatility/surface",
        price: config.priceVolSurfaceDollarString,
        env: "PRICE_VOL_SURFACE_USD",
      },
    },
    settlement: {
      networks: config.networks.map((alias, i) => ({
        alias,
        caip2: config.networkIds[i],
        asset: "USDC",
        scheme: "exact",
      })),
      facilitator: config.facilitatorUrl,
      payTo: config.payToAddress,
      note: "No API keys. Clients complete x402 payment; server holds only a public payTo address.",
    },
    endpoints: {
      free: [
        {
          method: "GET",
          path: "/health",
          description: "Liveness and active network/pricing snapshot",
        },
        {
          method: "GET",
          path: "/",
          description:
            "Machine-readable service card: capabilities, use cases, endpoint catalog, examples",
        },
      ],
      paid: [
        {
          method: "POST",
          path: "/v1/option/price",
          serviceName: optionMeta.serviceName,
          description: optionMeta.description,
          price: config.priceDollarString,
          mimeType: "application/json",
          tags: optionMeta.tags,
          agentHints: optionMeta.agentHints,
        },
        {
          method: "POST",
          path: "/v1/volatility/surface",
          serviceName: surfaceMeta.serviceName,
          description: surfaceMeta.description,
          price: config.priceVolSurfaceDollarString,
          mimeType: "application/json",
          tags: surfaceMeta.tags,
          agentHints: surfaceMeta.agentHints,
        },
      ],
    },
    discovery: {
      bazaar: true,
      protocol: "x402",
      howToDiscover:
        "Unpaid POST to a paid path returns HTTP 402 with PAYMENT-REQUIRED (base64). Extensions.bazaar carries input/output schemas for agent tooling.",
      paymentHeader: "PAYMENT-REQUIRED",
    },
    baseUrl: config.publicBaseUrl,
  };
}
