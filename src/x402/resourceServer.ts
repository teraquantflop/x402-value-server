import { x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import { isEvmNetworkId, isSvmNetworkId } from "../config.js";

/**
 * Build an x402 resource server with facilitator client(s).
 * Nowcast order when CDP configured: [CDP_scoped(eip155:8453), PayAI_solana_scoped].
 * initialize() maps Base → CDP (earlier wins); PayAI is Solana-only so Base never hits PayAI.
 * - EVM (Base): ExactEvmScheme (USDC 0x8335… + EIP-712 name/version on Base)
 * - SVM (Solana): ExactSvmScheme
 */
export function createResourceServer(
  facilitators: FacilitatorClient | FacilitatorClient[],
  config: AppConfig,
): x402ResourceServer {
  const clients = Array.isArray(facilitators) ? facilitators : [facilitators];
  const server = new x402ResourceServer(clients);

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

  if (registeredEvm) {
    server.register("eip155:*", new ExactEvmScheme());
  }
  if (registeredSvm) {
    server.register("solana:*", new ExactSvmScheme());
  }

  server.registerExtension(bazaarResourceServerExtension);

  return server;
}
