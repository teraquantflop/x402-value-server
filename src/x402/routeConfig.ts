import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { AppConfig } from "../types.js";
import { payToForNetwork } from "../config.js";
import {
  optionPriceDiscovery,
  volatilitySurfaceDiscovery,
} from "../discovery/catalog.js";
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

function acceptsForPrice(config: AppConfig, price: string) {
  return config.networkIds.map((network) => ({
    scheme: "exact" as const,
    price,
    network,
    payTo: payToForNetwork(config, network),
  }));
}

/**
 * x402 paid-route configuration with full Bazaar discovery metadata.
 * Descriptions/tags come from the discovery catalog (agent-oriented).
 */
export function buildPaidRoutes(config: AppConfig) {
  const optionMeta = optionPriceDiscovery(config);
  const surfaceMeta = volatilitySurfaceDiscovery(config);

  return {
    "POST /v1/option/price": {
      accepts: acceptsForPrice(config, config.priceDollarString),
      description: optionMeta.description,
      mimeType: optionMeta.mimeType,
      serviceName: optionMeta.serviceName,
      tags: optionMeta.tags,
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
      description: surfaceMeta.description,
      mimeType: surfaceMeta.mimeType,
      serviceName: surfaceMeta.serviceName,
      tags: surfaceMeta.tags,
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
            schema: volatilitySurfaceOutputJsonSchema as Record<
              string,
              unknown
            >,
          },
        }),
      },
    },
  };
}
