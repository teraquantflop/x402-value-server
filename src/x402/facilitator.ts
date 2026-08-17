/**
 * Facilitator clients: PayAI always; Coinbase CDP for Base when configured.
 * Earlier clients in the array win network kinds in x402ResourceServer.initialize().
 */
import { createRequire } from "node:module";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";

export const PAYAI_DEFAULT_URL = "https://facilitator.payai.network";
export const CDP_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

const require = createRequire(import.meta.url);

/**
 * @deprecated Prefer createFacilitatorClients for dual CDP+PayAI.
 */
export function createFacilitatorClient(
  config: AppConfig,
): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: config.facilitatorUrl || PAYAI_DEFAULT_URL,
  });
}

function createPayAiClient(config: AppConfig): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: config.facilitatorUrl || PAYAI_DEFAULT_URL,
  });
}

/**
 * CDP client when both API keys are present. Soft-fails to null if construction fails.
 */
function createCdpClient(config: AppConfig): FacilitatorClient | null {
  if (!config.cdpConfigured || !config.cdpApiKeyId || !config.cdpApiKeySecret) {
    return null;
  }
  try {
    const mod = require("@coinbase/cdp-sdk/x402") as {
      createCdpFacilitatorClient: (args?: {
        apiKeyId?: string;
        apiKeySecret?: string;
      }) => HTTPFacilitatorClient;
    };
    const client = mod.createCdpFacilitatorClient({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
    });
    console.log("[facilitator] CDP enabled for Base (eip155:8453)");
    return client;
  } catch (err) {
    console.warn(
      "[facilitator] CDP keys set but client unavailable; PayAI-only:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Build facilitator client list: CDP first (Base) when configured, then PayAI
 * (Solana + Base fallback). Matches pjm-nowcast dual-facilitator pattern.
 */
export function createFacilitatorClients(
  config: AppConfig,
): FacilitatorClient[] {
  const clients: FacilitatorClient[] = [];

  const cdp = createCdpClient(config);
  if (cdp) {
    clients.push(cdp);
  }

  const payai = createPayAiClient(config);
  clients.push(payai);
  console.log(
    `[facilitator] PayAI enabled url=${config.facilitatorUrl} (Solana; Base fallback=${cdp ? "no" : "yes"})`,
  );

  return clients;
}
