import "dotenv/config";
import { z } from "zod";
import type {
  AppConfig,
  ChainFamily,
  NetworkAlias,
  NetworkId,
} from "./types.js";
import { normalizeCdpApiKeySecret } from "./x402/cdpCredentials.js";

export const NETWORK_MAP: Record<NetworkAlias, NetworkId> = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
  /** Solana mainnet-beta */
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const NETWORK_FAMILY: Record<NetworkAlias, ChainFamily> = {
  "base-sepolia": "evm",
  base: "evm",
  solana: "svm",
  "solana-devnet": "svm",
};

/** Normalize free-form NETWORKS tokens → canonical aliases. */
const NETWORK_ALIASES: Record<string, NetworkAlias> = {
  "base-sepolia": "base-sepolia",
  basesepolia: "base-sepolia",
  base: "base",
  "base-mainnet": "base",
  basemainnet: "base",
  solana: "solana",
  "solana-mainnet": "solana",
  solanamainnet: "solana",
  "solana-mainnet-beta": "solana",
  "solana-devnet": "solana-devnet",
  solanadevnet: "solana-devnet",
  "solana-dev": "solana-devnet",
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
/** Solana base58 pubkey (no 0, O, I, l). */
const SVM_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isEvmAddress(value: string): value is `0x${string}` {
  return EVM_ADDRESS_RE.test(value);
}

export function isSvmAddress(value: string): boolean {
  return SVM_ADDRESS_RE.test(value) && !value.startsWith("0x");
}

export function isSvmNetworkId(networkId: NetworkId | string): boolean {
  return networkId.startsWith("solana:");
}

export function isEvmNetworkId(networkId: NetworkId | string): boolean {
  return networkId.startsWith("eip155:");
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4021),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Primary pay-to (EVM 0x… or Solana base58). */
  PAY_TO_ADDRESS: z.string().min(1).default(
    "0x0000000000000000000000000000000000000001",
  ),
  /** Optional explicit EVM receiver when multi-chain. */
  PAY_TO_EVM_ADDRESS: z.string().optional(),
  /** Optional explicit Solana receiver when multi-chain. */
  PAY_TO_SVM_ADDRESS: z.string().optional(),
  PRICE_USD: z.coerce
    .number()
    .min(0.01, "PRICE_USD must be >= 0.01")
    .max(1, "PRICE_USD must be <= 1.00")
    .default(0.05),
  PRICE_VOL_SURFACE_USD: z.coerce
    .number()
    .min(0.01, "PRICE_VOL_SURFACE_USD must be >= 0.01")
    .max(1, "PRICE_VOL_SURFACE_USD must be <= 1.00")
    .default(0.1),
  PRICE_IMPLIED_VOL_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.03),
  PRICE_PORTFOLIO_GREEKS_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.15),
  PRICE_PORTFOLIO_SCENARIO_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.25),
  PRICE_OPTION_FROM_SURFACE_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.08),
  PRICE_SCENARIO_FROM_SURFACE_USD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.15),
  MAX_SURFACE_OPTIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200),
  MAX_SURFACE_POINTS: z.coerce.number().int().min(1).max(500).default(200),
  MAX_SURFACE_PRICE_OPTIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50),
  MAX_PORTFOLIO_POSITIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100),
  MAX_SCENARIOS: z.coerce.number().int().min(1).max(100).default(20),
  NETWORKS: z.string().default("base-sepolia"),
  /** PayAI / primary facilitator (Solana; Base fallback when CDP unset). */
  FACILITATOR_URL: z.string().url().default("https://facilitator.payai.network"),
  /** Coinbase CDP facilitator credentials for Base mainnet (optional). */
  CDP_API_KEY_ID: z.string().optional(),
  CDP_API_KEY_SECRET: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4021"),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(300_000),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** Local/debug only: skip x402 payment middleware. Forbidden when NODE_ENV=production. */
  SKIP_PAYMENT: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  /** Fixed-sample free demo (default on). Set FREE_DEMO_ENABLED=0 to disable. */
  FREE_DEMO_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  FREE_DEMO_RATE_MAX: z.coerce.number().int().positive().default(30),
  /** First-N free on POST /v1/option/price only (0 = off). */
  FREE_TIER_N: z.coerce.number().int().min(0).max(10_000).default(0),
  FREE_TIER_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400_000),
  MCP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "0" && v !== "false"),
  MCP_PATH: z
    .string()
    .default("/mcp")
    .transform((v) => {
      const p = v.trim() || "/mcp";
      return p.startsWith("/") ? p : `/${p}`;
    }),
});

function parseNetworks(raw: string): NetworkAlias[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("NETWORKS must list at least one network");
  }

  const aliases: NetworkAlias[] = [];
  for (const p of parts) {
    const alias = NETWORK_ALIASES[p];
    if (!alias) {
      throw new Error(
        `Unknown network "${p}". Supported: base-sepolia, base, solana, solana-devnet`,
      );
    }
    if (!aliases.includes(alias)) {
      aliases.push(alias);
    }
  }
  return aliases;
}

function formatPriceDollar(priceUsd: number): string {
  // USDC prices in this app are cent-level ($0.01–$0.10); always two decimals
  return `$${priceUsd.toFixed(2)}`;
}

function resolvePayTos(
  env: z.infer<typeof envSchema>,
  networks: NetworkAlias[],
): { payToEvm?: `0x${string}`; payToSvm?: string; payToAddress: string } {
  const primary = env.PAY_TO_ADDRESS.trim();
  const needsEvm = networks.some((n) => NETWORK_FAMILY[n] === "evm");
  const needsSvm = networks.some((n) => NETWORK_FAMILY[n] === "svm");

  let payToEvm: `0x${string}` | undefined;
  let payToSvm: string | undefined;

  if (env.PAY_TO_EVM_ADDRESS) {
    const v = env.PAY_TO_EVM_ADDRESS.trim();
    if (!isEvmAddress(v)) {
      throw new Error("PAY_TO_EVM_ADDRESS must be a valid EVM 0x address");
    }
    payToEvm = v;
  } else if (isEvmAddress(primary)) {
    payToEvm = primary;
  }

  if (env.PAY_TO_SVM_ADDRESS) {
    const v = env.PAY_TO_SVM_ADDRESS.trim();
    if (!isSvmAddress(v)) {
      throw new Error("PAY_TO_SVM_ADDRESS must be a valid Solana base58 address");
    }
    payToSvm = v;
  } else if (isSvmAddress(primary)) {
    payToSvm = primary;
  }

  if (needsEvm && !payToEvm) {
    throw new Error(
      "EVM network(s) enabled but no EVM receiver: set PAY_TO_ADDRESS to a 0x address or set PAY_TO_EVM_ADDRESS",
    );
  }
  if (needsSvm && !payToSvm) {
    throw new Error(
      "Solana network(s) enabled but no Solana receiver: set PAY_TO_ADDRESS to a base58 address or set PAY_TO_SVM_ADDRESS",
    );
  }

  // Soft-validate primary when it is the only declared address
  if (!isEvmAddress(primary) && !isSvmAddress(primary)) {
    throw new Error(
      "PAY_TO_ADDRESS must be an EVM 0x address or a Solana base58 address",
    );
  }

  return { payToEvm, payToSvm, payToAddress: primary };
}

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }

  const env = parsed.data;
  const networks = parseNetworks(env.NETWORKS);
  const networkIds = networks.map((n) => NETWORK_MAP[n]);
  const { payToEvm, payToSvm, payToAddress } = resolvePayTos(env, networks);

  const corsOrigin =
    env.CORS_ORIGIN === "*"
      ? "*"
      : env.CORS_ORIGIN.split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const skipPayment = Boolean(env.SKIP_PAYMENT);
  if (skipPayment && env.NODE_ENV === "production") {
    throw new Error(
      "SKIP_PAYMENT cannot be enabled when NODE_ENV=production",
    );
  }

  const cdpId = (env.CDP_API_KEY_ID ?? "").trim();
  // Unescape PEM `\n` from Railway/dotenv before JWT minting (EC keys).
  const cdpSecret = normalizeCdpApiKeySecret(env.CDP_API_KEY_SECRET ?? "");
  if (Boolean(cdpId) !== Boolean(cdpSecret)) {
    console.warn(
      "[warn] CDP_API_KEY_ID and CDP_API_KEY_SECRET must both be set; ignoring CDP",
    );
  }
  const cdpConfigured = Boolean(cdpId && cdpSecret);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    payToAddress,
    payToEvm,
    payToSvm,
    priceUsd: env.PRICE_USD,
    priceDollarString: formatPriceDollar(env.PRICE_USD),
    priceVolSurfaceUsd: env.PRICE_VOL_SURFACE_USD,
    priceVolSurfaceDollarString: formatPriceDollar(env.PRICE_VOL_SURFACE_USD),
    priceImpliedVolUsd: env.PRICE_IMPLIED_VOL_USD,
    priceImpliedVolDollarString: formatPriceDollar(env.PRICE_IMPLIED_VOL_USD),
    pricePortfolioGreeksUsd: env.PRICE_PORTFOLIO_GREEKS_USD,
    pricePortfolioGreeksDollarString: formatPriceDollar(
      env.PRICE_PORTFOLIO_GREEKS_USD,
    ),
    pricePortfolioScenarioUsd: env.PRICE_PORTFOLIO_SCENARIO_USD,
    pricePortfolioScenarioDollarString: formatPriceDollar(
      env.PRICE_PORTFOLIO_SCENARIO_USD,
    ),
    priceOptionFromSurfaceUsd: env.PRICE_OPTION_FROM_SURFACE_USD,
    priceOptionFromSurfaceDollarString: formatPriceDollar(
      env.PRICE_OPTION_FROM_SURFACE_USD,
    ),
    priceScenarioFromSurfaceUsd: env.PRICE_SCENARIO_FROM_SURFACE_USD,
    priceScenarioFromSurfaceDollarString: formatPriceDollar(
      env.PRICE_SCENARIO_FROM_SURFACE_USD,
    ),
    maxSurfaceOptions: env.MAX_SURFACE_OPTIONS,
    maxSurfacePoints: env.MAX_SURFACE_POINTS,
    maxSurfacePriceOptions: env.MAX_SURFACE_PRICE_OPTIONS,
    maxPortfolioPositions: env.MAX_PORTFOLIO_POSITIONS,
    maxScenarios: env.MAX_SCENARIOS,
    networks,
    networkIds,
    facilitatorUrl: env.FACILITATOR_URL.replace(/\/$/, ""),
    cdpApiKeyId: cdpConfigured ? cdpId : undefined,
    cdpApiKeySecret: cdpConfigured ? cdpSecret : undefined,
    cdpConfigured,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ""),
    corsOrigin,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    idempotencyTtlMs: env.IDEMPOTENCY_TTL_MS,
    trustProxy: Boolean(env.TRUST_PROXY),
    skipPayment,
    freeDemoEnabled: env.FREE_DEMO_ENABLED !== false,
    freeDemoRateMax: env.FREE_DEMO_RATE_MAX,
    freeTierN: env.FREE_TIER_N,
    freeTierWindowMs: env.FREE_TIER_WINDOW_MS,
    mcpEnabled: env.MCP_ENABLED !== false,
    mcpPath: env.MCP_PATH,
    serviceName: "x402-derivatives-desk",
    serviceVersion: "1.6.0",
  };
}

/** Public facilitator readiness labels (no secrets, no wallets). */
export function facilitatorStatus(
  config: AppConfig,
): import("./types.js").FacilitatorStatus {
  const hasBase = config.networks.includes("base");
  const hasSolana =
    config.networks.includes("solana") ||
    config.networks.includes("solana-devnet");
  const cdp = config.cdpConfigured;
  return {
    payai: true,
    cdp,
    base: hasBase ? (cdp ? "cdp" : "payai") : "none",
    solana: hasSolana ? "payai" : "none",
  };
}

export const config: AppConfig = loadConfig();

/** Resolve payTo for a given CAIP-2 network id. */
export function payToForNetwork(config: AppConfig, networkId: string): string {
  if (isSvmNetworkId(networkId)) {
    if (!config.payToSvm) {
      throw new Error(`No Solana payTo configured for network ${networkId}`);
    }
    return config.payToSvm;
  }
  if (isEvmNetworkId(networkId)) {
    if (!config.payToEvm) {
      throw new Error(`No EVM payTo configured for network ${networkId}`);
    }
    return config.payToEvm;
  }
  throw new Error(`Unsupported network id: ${networkId}`);
}
