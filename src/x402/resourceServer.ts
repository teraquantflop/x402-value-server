import { x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { isEvmNetworkId, isSvmNetworkId } from "../config.js";
import { settlementNetworkIds } from "./settlementNetworks.js";

export type CreateResourceServerOptions = {
  /** When true, register ExactEvmScheme for eip155:8453 (CDP rail only). */
  cdpEnabled: boolean;
};

/**
 * Build an x402 resource server with facilitator client(s).
 *
 * Nowcast-shaped registration (no wildcards):
 * - ExactEvmScheme only for settlement EVM nets (Base mainnet iff CDP enabled)
 * - ExactSvmScheme only for Solana nets (PayAI)
 * Facilitator clients must be [CDP_scoped?, PayAI]; initialize() maps by getSupported.
 */
export function createResourceServer(
  facilitators: FacilitatorClient | FacilitatorClient[],
  config: AppConfig,
  opts: CreateResourceServerOptions,
): x402ResourceServer {
  const clients = Array.isArray(facilitators) ? facilitators : [facilitators];
  const server = new x402ResourceServer(clients);

  const networks = settlementNetworkIds(config, opts.cdpEnabled);

  for (const networkId of networks) {
    if (networkId === "eip155:8453") {
      // Base mainnet ↔ CDP only (never register Base scheme without CDP client)
      server.register(networkId, new ExactEvmScheme());
    } else if (isSvmNetworkId(networkId)) {
      server.register(networkId, new ExactSvmScheme());
    } else if (isEvmNetworkId(networkId)) {
      // e.g. base-sepolia when CDP dual-rail is off
      server.register(networkId, new ExactEvmScheme());
    } else {
      throw new Error(`No payment scheme registered for network ${networkId}`);
    }
  }

  server.registerExtension(bazaarResourceServerExtension);

  return server;
}
