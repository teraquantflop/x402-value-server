import { Router } from "express";
import { config } from "../config.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: config.serviceName,
    version: config.serviceVersion,
    networks: config.networks,
    networkIds: config.networkIds,
    facilitator: config.facilitatorUrl,
    prices: {
      optionPrice: config.priceDollarString,
      volatilitySurface: config.priceVolSurfaceDollarString,
    },
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    service: config.serviceName,
    version: config.serviceVersion,
    description:
      "x402-paid Black-Scholes option pricing, Greeks, and implied volatility surfaces.",
    prices: {
      optionPrice: config.priceDollarString,
      volatilitySurface: config.priceVolSurfaceDollarString,
    },
    networks: config.networks.map((alias, i) => ({
      alias,
      caip2: config.networkIds[i],
      asset: "USDC",
      scheme: "exact",
    })),
    facilitator: config.facilitatorUrl,
    endpoints: {
      free: [
        { method: "GET", path: "/health", description: "Liveness probe" },
        { method: "GET", path: "/", description: "Service card" },
      ],
      paid: [
        {
          method: "POST",
          path: "/v1/option/price",
          description:
            "Compute European option price and Greeks from spot, strike, T, r, σ, type",
          price: config.priceDollarString,
          mimeType: "application/json",
        },
        {
          method: "POST",
          path: "/v1/volatility/surface",
          description:
            "Implied vol surface from market premiums (shared rate/q; per-option underlying)",
          price: config.priceVolSurfaceDollarString,
          mimeType: "application/json",
        },
      ],
    },
    discovery: {
      bazaar: true,
      note: "Paid routes declare @x402/extensions/bazaar metadata for agent discovery.",
    },
    docs: {
      optionPriceExample: {
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
        dividendYield: 0,
      },
      volatilitySurfaceExample: {
        rate: 0.05,
        dividendYield: 0,
        options: [
          {
            underlying: 100,
            strike: 90,
            timeToExpiry: 0.25,
            optionType: "call",
            premium: 12.5,
          },
          {
            underlying: 102,
            strike: 100,
            timeToExpiry: 0.5,
            optionType: "call",
            premium: 8.7,
          },
        ],
      },
    },
    baseUrl: config.publicBaseUrl,
  });
});
