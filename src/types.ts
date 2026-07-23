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
  /** Max options accepted per surface request */
  maxSurfaceOptions: number;
  networks: NetworkAlias[];
  networkIds: NetworkId[];
  facilitatorUrl: string;
  publicBaseUrl: string;
  corsOrigin: string | string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  idempotencyTtlMs: number;
  trustProxy: boolean;
  /** When true, skip x402 payment gate (local/debug only — never enable in production). */
  skipPayment: boolean;
  serviceName: string;
  serviceVersion: string;
}
