import { Router } from "express";
import { config } from "../config.js";
import { buildServiceCard, SERVICE_CATALOG } from "../discovery/catalog.js";
import {
  OPTION_EXAMPLE_INPUT,
  OPTION_EXAMPLE_OUTPUT,
} from "../schemas/option.js";
import {
  VOL_SURFACE_EXAMPLE_INPUT,
  VOL_SURFACE_EXAMPLE_OUTPUT,
} from "../schemas/volatility.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: SERVICE_CATALOG.serviceName,
    productName: SERVICE_CATALOG.productName,
    version: config.serviceVersion,
    networks: config.networks,
    networkIds: config.networkIds,
    facilitator: config.facilitatorUrl,
    prices: {
      optionPrice: config.priceDollarString,
      volatilitySurface: config.priceVolSurfaceDollarString,
    },
    capabilities: SERVICE_CATALOG.capabilities,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/", (_req, res) => {
  const card = buildServiceCard(config);
  res.status(200).json({
    ...card,
    examples: {
      optionPrice: {
        request: OPTION_EXAMPLE_INPUT,
        response: OPTION_EXAMPLE_OUTPUT,
      },
      volatilitySurface: {
        request: VOL_SURFACE_EXAMPLE_INPUT,
        response: VOL_SURFACE_EXAMPLE_OUTPUT,
      },
    },
  });
});
