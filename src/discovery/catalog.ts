/**
 * Single source of truth for Bazaar + human/agent discovery metadata.
 * Constraints (Bazaar soft-validation):
 * - description ≤ 500 chars
 * - serviceName ≤ 32 printable ASCII
 * - tags ≤ 5, each ≤ 32 printable ASCII
 */
import type { AppConfig } from "../types.js";
import {
  facilitatorStatus,
  isEvmNetworkId,
  isSvmNetworkId,
} from "../config.js";

export const SERVICE_CATALOG = {
  /** Short Bazaar serviceName (≤32) — used on route configs */
  serviceName: "x402 Derivatives Desk",
  /** Longer product name for GET / */
  productName: "x402 Derivatives Analytics Desk",
  versionField: "serviceVersion",
  tagline:
    "Pay-per-call European option pricing, analytic Greeks, IV surfaces, and multi-leg book risk for power, commodity, equity, and crypto agents.",
  /**
   * English-first capability summary for agents (GET /, /llms.txt).
   * Emphasize energy/power multi-maturity books and multi-leg risk, not only generic BSM.
   */
  description:
    "Production x402 quant API for autonomous trading and risk agents. " +
    "Price European options with full analytic Greeks; invert market premiums to implied vol (single quote or multi-maturity surface); " +
    "price and revalue books on a submitted IV smile (total-variance bilinear in log-moneyness); " +
    "aggregate multi-leg net Greeks; reprice books under spot/vol/time scenarios. " +
    "Designed for power and energy desks (forward marks that differ by maturity), commodities, equities, and crypto — " +
    "no API keys, USDC exact settlement via HTTP 402 on Solana and/or Base. " +
    "Free fixed demo at /v1/demo/option-price; MCP tools at /mcp; paid HTTP routes remain the source of truth.",
  capabilities: [
    "european_option_pricing",
    "analytic_greeks",
    "single_premium_implied_vol",
    "implied_volatility_surface",
    "price_from_iv_surface",
    "scenario_from_iv_surface",
    "multi_maturity_underlyings",
    "portfolio_net_greeks",
    "portfolio_scenario_analysis",
    "power_energy_forward_marks",
    "x402_usdc_micropayments",
    "mcp_tool_facade",
    "bazaar_discoverable",
    "idempotent_retries",
    "free_demo_sample",
  ],
  useCases: [
    "Price power/gas/oil European options off maturity-specific forward marks",
    "Build multi-maturity IV surfaces from broker or exchange premium dumps",
    "Price options on a submitted smile without inventing Dupire/SABR",
    "Book reval on a smile under sticky moneyness/strike/fixed_vol shocks",
    "Delta/vega hedging loops for automated market makers",
    "Net Greeks and MTM for multi-leg books (long/short signed quantity)",
    "Scenario P&L under relative spot/vol shocks and calendar time decay",
    "MCP hosts (Claude, Cursor, Windsurf) calling the full tool set (price, IV, surface, portfolio)",
  ],
  markets: [
    "power_and_energy",
    "commodities",
    "equities",
    "crypto",
    "fx_style_european",
  ],
  /** One-line capability bullets for agents (English-first). */
  capabilitySummary: [
    "Single-contract Black-Scholes-Merton fair value + delta/gamma/vega/theta/rho",
    "Implied vol from one premium (fast) or a full strike×maturity surface (book)",
    "Price / scenario on a submitted IV surface (TV bilinear in k,T; flat_vol wings)",
    "Per-row underlyings so power/commodity forwards can differ by maturity",
    "Multi-leg portfolio net Greeks, MTM, optional dollar Greeks, scenario reprice",
    "x402 USDC exact on Solana mainnet and Base mainnet; free fixed demo for discovery",
    "MCP façade: one tool per paid HTTP route (same services + USDC prices)",
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

/** Single Bazaar settlement tag (≤1 of 5 slots). Prefer multi-chain when both families enabled. */
function settlementTag(config: AppConfig): string {
  const hasSvm = config.networkIds.some(isSvmNetworkId);
  const hasEvm = config.networkIds.some(isEvmNetworkId);
  if (hasSvm && hasEvm) return "multi-chain";
  if (hasSvm) return "solana";
  return "base";
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
  // ≤500 chars — lead with when-to-use for Bazaar agents
  const description =
    `When to use: you already have model inputs (S or forward mark, K, T, r, σ) and need fair value + hedge ratios — not market-premium IV. ` +
    `European BSM price + analytic Greeks (delta, gamma, vega, theta, rho). ` +
    `Works for equity spots and power/commodity forwards (use the maturity mark as spot). ` +
    `USDC exact on ${chain}. Free fixed sample: GET /v1/demo/option-price.`;

  return {
    serviceName: "BSM Price+Greeks",
    description: description.slice(0, 500),
    tags: clampTags([
      "options",
      "greeks",
      "power",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Have S/K/T/r/σ (or a power forward mark as S) and need price + Greeks. Prefer this over surface when you are not inverting market premiums.",
      relatedEndpoints: [
        "GET /v1/demo/option-price",
        "POST /v1/option/implied-vol",
        "POST /v1/volatility/surface",
        "POST /v1/portfolio/greeks",
      ],
    },
  };
}

export function impliedVolDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: one market premium → need σ̂ + Greeks; cheaper/faster than a full surface. ` +
    `Solves Black-Scholes IV then prices Greeks at the solved σ. ` +
    `Same engine as the surface endpoint (fastImpliedVol). ` +
    `Prefer surface when you have a multi-strike/maturity book. USDC exact on ${chain}.`;

  return {
    serviceName: "Single IV Solver",
    description: description.slice(0, 500),
    tags: clampTags([
      "implied-vol",
      "options",
      "greeks",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "One premium to mark or hedge. Use /v1/volatility/surface instead for books and multi-maturity power/commodity grids.",
      relatedEndpoints: [
        "POST /v1/option/price",
        "POST /v1/volatility/surface",
      ],
    },
  };
}

export function volatilitySurfaceDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: book of market premiums → need IV grid + per-quote Greeks (not a single contract). ` +
    `Shared rate/yield; each row has its own underlying (power/commodity forwards by maturity). ` +
    `Returns strike×maturity IV surface, fit quality, solve stats. ` +
    `USDC exact on ${chain}. Prefer single IV endpoint for one premium.`;

  return {
    serviceName: "IV Surface Desk",
    description: description.slice(0, 500),
    tags: clampTags([
      "volatility",
      "iv-surface",
      "power",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Multi-strike/multi-maturity premiums (e.g. power stack or commodity curve). Use price_option / /v1/option/price when σ is already known.",
      relatedEndpoints: [
        "POST /v1/option/price",
        "POST /v1/option/implied-vol",
      ],
    },
  };
}

export function portfolioGreeksDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: multi-leg European book → need net MTM + net Greeks (long/short via signed quantity). ` +
    `Shared rate/yield; each leg has underlying, strike, T, type, quantity, vol. ` +
    `Optional dollar Greeks. Prefer scenario endpoint for what-if P&L. USDC exact on ${chain}.`;

  return {
    serviceName: "Portfolio Net Greeks",
    description: description.slice(0, 500),
    tags: clampTags([
      "portfolio",
      "greeks",
      "risk",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Aggregate delta/gamma/vega/theta/rho across a multi-leg book. Use scenario for shocked MTM.",
      relatedEndpoints: [
        "POST /v1/portfolio/scenario",
        "POST /v1/option/price",
      ],
    },
  };
}

export function portfolioScenarioDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: what-if P&L under relative spot/vol shocks and calendar time decay on a European book. ` +
    `Returns base MTM+Greeks and per-scenario shocked MTM, MTM change, full Greeks. ` +
    `Single-option or multi-leg. USDC exact on ${chain}.`;

  return {
    serviceName: "Portfolio Scenarios",
    description: description.slice(0, 500),
    tags: clampTags([
      "scenario",
      "portfolio",
      "risk",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Need shocked MTM and Greeks (spotShock, volShock, timeDecayDays). Use portfolio/greeks for base risk only.",
      relatedEndpoints: [
        "POST /v1/portfolio/greeks",
        "POST /v1/option/price",
      ],
    },
  };
}

export function priceFromSurfaceDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: you already have an IV surface (k,T,σ) and need to price options on it — not invert premiums and not scalar σ. ` +
    `Interpolates total variance w=σ²T bilinear in log-moneyness k=ln(K/F); wingRule=flat_vol. ` +
    `Returns price, interpolated σ, k, F, BS Greeks. ` +
    `USDC exact on ${chain}. Prefer /v1/option/price when σ is a single scalar.`;

  return {
    serviceName: "Price From Surface",
    description: description.slice(0, 500),
    tags: clampTags([
      "surface-price",
      "options",
      "smile",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Have a smile/surface grid and want European prices + Greeks at interpolated σ. Use scalar /v1/option/price if you already know one σ.",
      relatedEndpoints: [
        "POST /v1/option/price",
        "POST /v1/volatility/surface",
        "POST /v1/option/scenario-from-surface",
      ],
    },
  };
}

export function scenarioFromSurfaceDiscovery(config: AppConfig) {
  const chain = chainHint(config);
  const description =
    `When to use: book reval on an IV surface under F/rate/time/vol shocks with sticky moneyness|strike|fixed_vol. ` +
    `Vol order: interpolate → volAbs → volRel → smileTwist*k. ` +
    `Greeks are sticky-σ BS Greeks (not smile bump deltas). ` +
    `USDC exact on ${chain}. Prefer scalar /v1/portfolio/scenario for per-leg scalar σ books.`;

  return {
    serviceName: "Surface Scenarios",
    description: description.slice(0, 500),
    tags: clampTags([
      "scenario",
      "surface-price",
      "risk",
      settlementTag(config),
      "usdc",
    ]),
    mimeType: "application/json" as const,
    agentHints: {
      whenToCall:
        "Need base vs scenario MTM on a smile with sticky conventions. Use price-from-surface for static pricing only.",
      relatedEndpoints: [
        "POST /v1/option/price-from-surface",
        "POST /v1/portfolio/scenario",
      ],
    },
  };
}

/** Service card payload for GET / (agents + humans). */
export function buildServiceCard(config: AppConfig) {
  const optionMeta = optionPriceDiscovery(config);
  const ivMeta = impliedVolDiscovery(config);
  const surfaceMeta = volatilitySurfaceDiscovery(config);
  const portfolioMeta = portfolioGreeksDiscovery(config);
  const scenarioMeta = portfolioScenarioDiscovery(config);
  const priceSurfMeta = priceFromSurfaceDiscovery(config);
  const scenSurfMeta = scenarioFromSurfaceDiscovery(config);

  const base = config.publicBaseUrl.replace(/\/$/, "");

  return {
    service: SERVICE_CATALOG.serviceName,
    productName: SERVICE_CATALOG.productName,
    version: config.serviceVersion,
    tagline: SERVICE_CATALOG.tagline,
    description: SERVICE_CATALOG.description,
    capabilitySummary: [...SERVICE_CATALOG.capabilitySummary],
    capabilities: [...SERVICE_CATALOG.capabilities],
    useCases: [...SERVICE_CATALOG.useCases],
    markets: [...SERVICE_CATALOG.markets],
    pricing: {
      currency: "USDC",
      scheme: "exact",
      summary:
        `option ${config.priceDollarString} · implied-vol ${config.priceImpliedVolDollarString} · ` +
        `surface ${config.priceVolSurfaceDollarString} · price-from-surface ${config.priceOptionFromSurfaceDollarString} · ` +
        `scenario-from-surface ${config.priceScenarioFromSurfaceDollarString} · ` +
        `portfolio-greeks ${config.pricePortfolioGreeksDollarString} · ` +
        `scenario ${config.pricePortfolioScenarioDollarString} · free fixed demo at /v1/demo/option-price` +
        (config.freeTierN > 0
          ? ` · first ${config.freeTierN} /v1/option/price calls per IP/window free`
          : ""),
      optionPrice: {
        path: "POST /v1/option/price",
        price: config.priceDollarString,
        env: "PRICE_USD",
      },
      impliedVol: {
        path: "POST /v1/option/implied-vol",
        price: config.priceImpliedVolDollarString,
        env: "PRICE_IMPLIED_VOL_USD",
      },
      volatilitySurface: {
        path: "POST /v1/volatility/surface",
        price: config.priceVolSurfaceDollarString,
        env: "PRICE_VOL_SURFACE_USD",
      },
      portfolioGreeks: {
        path: "POST /v1/portfolio/greeks",
        price: config.pricePortfolioGreeksDollarString,
        env: "PRICE_PORTFOLIO_GREEKS_USD",
      },
      portfolioScenario: {
        path: "POST /v1/portfolio/scenario",
        price: config.pricePortfolioScenarioDollarString,
        env: "PRICE_PORTFOLIO_SCENARIO_USD",
      },
      optionFromSurface: {
        path: "POST /v1/option/price-from-surface",
        price: config.priceOptionFromSurfaceDollarString,
        env: "PRICE_OPTION_FROM_SURFACE_USD",
      },
      scenarioFromSurface: {
        path: "POST /v1/option/scenario-from-surface",
        price: config.priceScenarioFromSurfaceDollarString,
        env: "PRICE_SCENARIO_FROM_SURFACE_USD",
      },
      freeDemo: {
        path: "GET|POST /v1/demo/option-price",
        price: "$0.00",
        note: "Fixed ATM sample via live BSM engine; no wallet",
      },
    },
    mcp: config.mcpEnabled
      ? {
          enabled: true,
          path: config.mcpPath,
          url: `${base}${config.mcpPath}`,
          tools: [
            "service_info",
            "price_option",
            "implied_vol",
            "implied_vol_surface",
            "price_from_surface",
            "scenario_from_surface",
            "portfolio_greeks",
            "portfolio_scenario",
          ],
          transport: "streamable-http-stateless",
          note: "MCP is a façade over the same pricing services; USDC payment may be required on paid tools.",
        }
      : { enabled: false },
    freeTier: {
      demoEnabled: config.freeDemoEnabled,
      firstNOnOptionPrice: config.freeTierN,
      windowMs: config.freeTierWindowMs,
    },
    iconUrl: `${base}/favicon.ico`,
    settlement: {
      // Public discovery: network ids + asset labels only — never payTo wallets.
      // Full payTo + asset contract + EIP-712 extra appear only in HTTP 402.
      networks: config.networks.map((alias, i) => {
        const caip2 = config.networkIds[i]!;
        return {
          alias,
          caip2,
          asset: "USDC" as const,
          scheme: "exact" as const,
        };
      }),
      facilitators: facilitatorStatus(config),
      note:
        "No API keys. Clients may pay USDC on any listed network (exact scheme). " +
        "Receive addresses appear only in the 402 PAYMENT-REQUIRED protocol payload, not on free discovery.",
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
        ...(config.freeDemoEnabled
          ? [
              {
                method: "GET|POST",
                path: "/v1/demo/option-price",
                description:
                  "Free fixed ATM BSM sample (live engine, constant inputs) for discovery indexes",
              },
            ]
          : []),
        ...(config.mcpEnabled
          ? [
              {
                method: "POST",
                path: config.mcpPath,
                description:
                  "MCP Streamable HTTP (stateless): service_info + one paid tool per HTTP route",
              },
            ]
          : []),
        {
          method: "GET",
          path: "/.well-known/x402",
          description: "x402 well-known discovery manifest (JSON)",
        },
        {
          method: "GET",
          path: "/.well-known/x402.json",
          description: "x402 well-known discovery manifest (JSON, alias)",
        },
        {
          method: "GET",
          path: "/openapi.json",
          description: "OpenAPI 3.1 specification for all endpoints",
        },
        {
          method: "GET",
          path: "/swagger.json",
          description: "Alias of /openapi.json (same OpenAPI document)",
        },
        {
          method: "GET",
          path: "/llms.txt",
          description:
            "Agent-oriented Markdown summary (llms.txt convention): capabilities, paid endpoints, discovery links",
        },
        {
          method: "GET",
          path: "/skill.md",
          description:
            "Short agent skill loader (Markdown): what, pay, free/paid routes, surface value-add, examples",
        },
        {
          method: "GET",
          path: "/SKILL.md",
          description: "Alias of /skill.md",
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
          path: "/v1/option/implied-vol",
          serviceName: ivMeta.serviceName,
          description: ivMeta.description,
          price: config.priceImpliedVolDollarString,
          mimeType: "application/json",
          tags: ivMeta.tags,
          agentHints: ivMeta.agentHints,
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
        {
          method: "POST",
          path: "/v1/portfolio/greeks",
          serviceName: portfolioMeta.serviceName,
          description: portfolioMeta.description,
          price: config.pricePortfolioGreeksDollarString,
          mimeType: "application/json",
          tags: portfolioMeta.tags,
          agentHints: portfolioMeta.agentHints,
        },
        {
          method: "POST",
          path: "/v1/portfolio/scenario",
          serviceName: scenarioMeta.serviceName,
          description: scenarioMeta.description,
          price: config.pricePortfolioScenarioDollarString,
          mimeType: "application/json",
          tags: scenarioMeta.tags,
          agentHints: scenarioMeta.agentHints,
        },
        {
          method: "POST",
          path: "/v1/option/price-from-surface",
          serviceName: priceSurfMeta.serviceName,
          description: priceSurfMeta.description,
          price: config.priceOptionFromSurfaceDollarString,
          mimeType: "application/json",
          tags: priceSurfMeta.tags,
          agentHints: priceSurfMeta.agentHints,
        },
        {
          method: "POST",
          path: "/v1/option/scenario-from-surface",
          serviceName: scenSurfMeta.serviceName,
          description: scenSurfMeta.description,
          price: config.priceScenarioFromSurfaceDollarString,
          mimeType: "application/json",
          tags: scenSurfMeta.tags,
          agentHints: scenSurfMeta.agentHints,
        },
      ],
    },
    discovery: {
      bazaar: true,
      protocol: "x402",
      howToDiscover:
        "Unpaid POST to a paid path returns HTTP 402 with PAYMENT-REQUIRED (base64). Extensions.bazaar carries input/output schemas for agent tooling.",
      paymentHeader: "PAYMENT-REQUIRED",
      wellKnown: ["/.well-known/x402", "/.well-known/x402.json"],
    },
    baseUrl: config.publicBaseUrl,
  };
}

/**
 * Machine-friendly x402 discovery document for:
 *   GET /.well-known/x402
 *   GET /.well-known/x402.json
 *
 * Subset of the service card plus absolute resource URLs and protocol fields
 * commonly used by agents / crawlers looking for an x402 manifest.
 */
export function buildWellKnownX402(config: AppConfig) {
  const card = buildServiceCard(config);
  const base = config.publicBaseUrl.replace(/\/$/, "");

  const resources = card.endpoints.paid.map((ep) => {
    const [method, path] = ep.path.includes(" ")
      ? (ep.path.split(" ") as [string, string])
      : ["POST", ep.path];
    return {
      type: "http" as const,
      method,
      path,
      url: `${base}${path.startsWith("/") ? path : `/${path}`}`,
      description: ep.description,
      price: ep.price,
      mimeType: ep.mimeType,
      serviceName: ep.serviceName,
      tags: ep.tags,
      scheme: "exact" as const,
      asset: "USDC",
    };
  });

  return {
    x402Version: 2,
    protocol: "x402",
    name: card.service,
    productName: card.productName,
    version: card.version,
    tagline: card.tagline,
    description: card.description,
    url: base,
    capabilities: card.capabilities,
    useCases: card.useCases,
    markets: card.markets,
    resources,
    pricing: card.pricing,
    settlement: {
      scheme: "exact",
      asset: "USDC",
      networks: card.settlement.networks,
      facilitators: card.settlement.facilitators,
      note: card.settlement.note,
    },
    links: {
      serviceCard: `${base}/`,
      health: `${base}/health`,
      wellKnown: `${base}/.well-known/x402.json`,
      openapi: `${base}/openapi.json`,
      swagger: `${base}/swagger.json`,
      llmsTxt: `${base}/llms.txt`,
      skillMd: `${base}/skill.md`,
      favicon: `${base}/favicon.ico`,
      freeDemo: config.freeDemoEnabled
        ? `${base}/v1/demo/option-price`
        : undefined,
      mcp: config.mcpEnabled ? `${base}${config.mcpPath}` : undefined,
    },
    discovery: {
      bazaar: true,
      paymentHeader: "PAYMENT-REQUIRED",
      note: "Unpaid requests to resources return HTTP 402. Payment terms are in the PAYMENT-REQUIRED header (base64 JSON).",
    },
  };
}
