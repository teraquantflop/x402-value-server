import { x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { HTTPFacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { isEvmNetworkId, isSvmNetworkId } from "../config.js";

/**
 * Build an x402 resource server and register exact schemes for enabled networks.
 * - EVM (Base): ExactEvmScheme
 * - SVM (Solana): ExactSvmScheme
 * Also registers the Bazaar resource-server extension for discovery enrichment.
 */
export function createResourceServer(
  facilitator: HTTPFacilitatorClient,
  config: AppConfig,
): x402ResourceServer {
  const server = new x402ResourceServer(facilitator);

  let registeredEvm = false;
  let registeredSvm = false;

  for (const networkId of config.networkIds) {
    if (isEvmNetworkId(networkId)) {
      server.register(networkId, new ExactEvmScheme());
      registeredEvm = true;
    } else if (isSvmNetworkId(networkId)) {
      server.register(networkId, new ExactSvmScheme());
      registeredSvm = true;
    } else {
      throw new Error(`No payment scheme registered for network ${networkId}`);
    }
  }

  // Optional wildcards make multi-network facilitator responses more flexible
  if (registeredEvm) {
    server.register("eip155:*", new ExactEvmScheme());
  }
  if (registeredSvm) {
    server.register("solana:*", new ExactSvmScheme());
  }

  server.registerExtension(bazaarResourceServerExtension);

  return server;
}
