import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "../types.js";
import { payToForNetwork, isSvmNetworkId } from "../config.js";
import {
  OPTION_EXAMPLE_INPUT,
  OPTION_EXAMPLE_OUTPUT,
  optionInputJsonSchema,
  optionOutputJsonSchema,
} from "../schemas/option.js";
import {
  VOL_SURFACE_EXAMPLE_INPUT,
  VOL_SURFACE_EXAMPLE_OUTPUT,
  volatilitySurfaceInputJsonSchema,
  volatilitySurfaceOutputJsonSchema,
} from "../schemas/volatility.js";

function chainLabels(config: AppConfig): string {
  return config.networks
    .map((n) => {
      if (n === "solana") return "Solana mainnet";
      if (n === "solana-devnet") return "Solana devnet";
      if (n === "base") return "Base mainnet";
      return "Base Sepolia";
    })
    .join(" / ");
}

function acceptsForPrice(config: AppConfig, price: string) {
  return config.networkIds.map((network) => ({
    scheme: "exact" as const,
    price,
    network,
    payTo: payToForNetwork(config, network),
  }));
}

function bazaarTags(config: AppConfig, extra: string[]): string[] {
  const chain = config.networkIds.some(isSvmNetworkId) ? "solana" : "base";
  const tags = [...extra, chain, "usdc"].slice(0, 5);
  return tags;
}

/**
 * x402 paid-route configuration with full Bazaar discovery metadata.
 * Add new paid endpoints here and wire handlers in routes/.
 */
export function buildPaidRoutes(config: AppConfig) {
  const chains = chainLabels(config);

  return {
    "POST /v1/option/price": {
      accepts: acceptsForPrice(config, config.priceDollarString),
      description: `Black-Scholes-Merton European option price and Greeks (delta, gamma, vega, theta, rho). USDC exact payment on ${chains}.`,
      mimeType: "application/json",
      serviceName: "BS Option Greeks",
      tags: bazaarTags(config, ["options", "greeks", "black-scholes"]),
      extensions: {
        ...declareDiscoveryExtension({
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

    "POST /v1/volatility/surface": {
      accepts: acceptsForPrice(config, config.priceVolSurfaceDollarString),
      description:
        `Implied volatility surface from market premiums: shared rate/yield + options[{underlying,strike,T,type,premium}]. Returns IV grid, per-option IV+Greeks, fit quality, stats. USDC on ${chains}.`,
      mimeType: "application/json",
      serviceName: "IV Surface",
      tags: bazaarTags(config, ["options", "iv", "volatility", "surface"]),
      extensions: {
        ...declareDiscoveryExtension({
          bodyType: "json",
          input: VOL_SURFACE_EXAMPLE_INPUT,
          inputSchema: {
            properties: volatilitySurfaceInputJsonSchema.properties as Record<
              string,
              unknown
            >,
            required: [...volatilitySurfaceInputJsonSchema.required],
          },
          output: {
            example: VOL_SURFACE_EXAMPLE_OUTPUT,
            schema: volatilitySurfaceOutputJsonSchema as Record<string, unknown>,
          },
        }),
      },
    },
  };
}
