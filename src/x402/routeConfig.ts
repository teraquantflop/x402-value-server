import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "../types.js";
import { payToForNetwork, isSvmNetworkId } from "../config.js";
import {
  OPTION_EXAMPLE_INPUT,
  OPTION_EXAMPLE_OUTPUT,
  optionInputJsonSchema,
  optionOutputJsonSchema,
} from "../schemas/option.js";

/**
 * x402 paid-route configuration with full Bazaar discovery metadata.
 * Add new paid endpoints here and wire handlers in routes/.
 */
export function buildPaidRoutes(config: AppConfig) {
  const accepts = config.networkIds.map((network) => ({
    scheme: "exact" as const,
    price: config.priceDollarString,
    network,
    payTo: payToForNetwork(config, network),
  }));

  const chainLabels = config.networks.map((n) => {
    if (n === "solana") return "Solana mainnet";
    if (n === "solana-devnet") return "Solana devnet";
    if (n === "base") return "Base mainnet";
    return "Base Sepolia";
  });

  const description =
    `Black-Scholes-Merton European option price and Greeks (delta, gamma, vega, theta, rho). USDC exact payment on ${chainLabels.join(" / ")}.`;

  const hasSvm = config.networkIds.some(isSvmNetworkId);

  return {
    "POST /v1/option/price": {
      accepts,
      description,
      mimeType: "application/json",
      // Bazaar service metadata (soft-validated by facilitators)
      ...(hasSvm
        ? {
            serviceName: "BS Option Greeks",
            tags: ["options", "greeks", "black-scholes", "solana", "usdc"],
          }
        : {
            serviceName: "BS Option Greeks",
            tags: ["options", "greeks", "black-scholes", "base", "usdc"],
          }),
      extensions: {
        ...declareDiscoveryExtension({
          // POST JSON body discovery for agent crawlers / Bazaar
          bodyType: "json",
          input: OPTION_EXAMPLE_INPUT,
          inputSchema: {
            properties: optionInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...optionInputJsonSchema.required],
          },
          output: {
            example: OPTION_EXAMPLE_OUTPUT,
            schema: optionOutputJsonSchema as Record<string, unknown>,
          },
        }),
      },
    },
  };
}
