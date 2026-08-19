/** Supported network aliases (env) → CAIP-2 identifiers. */
export type NetworkAlias =
  | "base-sepolia"
  | "base"
  | "solana"
  | "solana-devnet";

export type NetworkId =
  | "eip155:84532"
  | "eip155:8453"
  | "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
  | "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export type ChainFamily = "evm" | "svm";

export type OptionType = "call" | "put";

export interface OptionInputs {
  spot: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  volatility: number;
  optionType: OptionType;
  dividendYield: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

export interface OptionResult {
  price: number;
  greeks: Greeks;
  inputs: OptionInputs;
  model: "black-scholes-merton";
  units: {
    price: string;
    delta: string;
    gamma: string;
    vega: string;
    theta: string;
    rho: string;
  };
  requestId: string;
  computedAt: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: "development" | "production" | "test";
  /** Primary receiving address from PAY_TO_ADDRESS (EVM or Solana). */
  payToAddress: string;
  /** EVM receiver when any Base network is enabled. */
  payToEvm?: `0x${string}`;
  /** Solana receiver when any Solana network is enabled. */
  payToSvm?: string;
  priceUsd: number;
  priceDollarString: string;
  /** Paid price for /v1/volatility/surface */
  priceVolSurfaceUsd: number;
  priceVolSurfaceDollarString: string;
  priceImpliedVolUsd: number;
  priceImpliedVolDollarString: string;
  pricePortfolioGreeksUsd: number;
  pricePortfolioGreeksDollarString: string;
  pricePortfolioScenarioUsd: number;
  pricePortfolioScenarioDollarString: string;
  /** Price from submitted IV surface */
  priceOptionFromSurfaceUsd: number;
  priceOptionFromSurfaceDollarString: string;
  /** Scenario reval on IV surface */
  priceScenarioFromSurfaceUsd: number;
  priceScenarioFromSurfaceDollarString: string;
  /** Max options accepted per invert-surface request */
  maxSurfaceOptions: number;
  /** Max (k,T,iv) points on a submitted pricing surface */
  maxSurfacePoints: number;
  /** Max options/legs on price-from-surface / scenario-from-surface */
  maxSurfacePriceOptions: number;
  maxPortfolioPositions: number;
  maxScenarios: number;
  networks: NetworkAlias[];
  networkIds: NetworkId[];
  /** PayAI (or primary) facilitator URL */
  facilitatorUrl: string;
  /** Coinbase CDP credentials (both required to enable CDP for Base). */
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  cdpConfigured: boolean;
  publicBaseUrl: string;
  corsOrigin: string | string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  idempotencyTtlMs: number;
  trustProxy: boolean;
  /** When true, skip x402 payment gate (local/debug only — never enable in production). */
  skipPayment: boolean;
  /** Free fixed-sample demo at /v1/demo/option-price */
  freeDemoEnabled: boolean;
  freeDemoRateMax: number;
  /**
   * First N unpaid calls to POST /v1/option/price per IP per window are free.
   * 0 = disabled (default).
   */
  freeTierN: number;
  freeTierWindowMs: number;
  /** Streamable HTTP MCP façade */
  mcpEnabled: boolean;
  mcpPath: string;
  serviceName: string;
  serviceVersion: string;
}

/** Public facilitator labels — never includes secrets or wallet addresses. */
export interface FacilitatorStatus {
  payai: boolean;
  /**
   * CDP rail status. `enabled` = keys present (never flipped false on getSupported 401).
   * `lastProbe` = warn-only GET /supported outcome.
   */
  cdp: {
    enabled: boolean;
    lastProbe: "200" | "401" | "skipped";
  };
  /** Which facilitator handles Base mainnet accepts (CDP-only; never PayAI) */
  base: "cdp" | "none";
  /** Which facilitator handles Solana mainnet accepts */
  solana: "payai" | "none";
}
