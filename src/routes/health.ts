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
    price: config.priceDollarString,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    service: config.serviceName,
    version: config.serviceVersion,
    description:
      "x402-paid Black-Scholes-Merton option pricing with full Greeks (delta, gamma, vega, theta, rho).",
    price: config.priceDollarString,
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
      ],
    },
    discovery: {
      bazaar: true,
      note: "Paid routes declare @x402/extensions/bazaar metadata for agent discovery.",
    },
    docs: {
      inputExample: {
        spot: 100,
        strike: 100,
        timeToExpiry: 1,
        rate: 0.05,
        volatility: 0.2,
        optionType: "call",
        dividendYield: 0,
      },
    },
    baseUrl: config.publicBaseUrl,
  });
});
