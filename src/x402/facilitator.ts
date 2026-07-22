import { HTTPFacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";

/**
 * Create the facilitator client.
 *
 * Default: public test facilitator at https://x402.org/facilitator (Sepolia).
 * Production swap: set FACILITATOR_URL to CDP or another facilitator.
 *
 * CDP example (when you need mainnet):
 *   import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
 *   return createCdpFacilitatorClient(); // needs CDP_API_KEY_ID / SECRET
 */
export function createFacilitatorClient(config: AppConfig): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });
}
