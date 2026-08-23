/**
 * Which CAIP-2 networks we may advertise / register schemes for.
 * - Base mainnet (eip155:8453): CDP only
 * - Polygon (eip155:137): PayAI when POLY_PAY_TO set
 * - Solana: PayAI
 */
import type { AppConfig, NetworkId } from "../types.js";
import { isEvmNetworkId, isSvmNetworkId } from "../config.js";

export function settlementNetworkIds(
  config: AppConfig,
  cdpEnabled: boolean,
): NetworkId[] {
  const out: NetworkId[] = [];
  for (const id of config.networkIds) {
    if (isSvmNetworkId(id)) {
      out.push(id);
      continue;
    }
    if (id === "eip155:8453") {
      if (cdpEnabled) out.push(id);
      continue;
    }
    if (id === "eip155:137") {
      if (config.payToPolygon) out.push(id);
      continue;
    }
    // Testnets (e.g. base-sepolia): only when not running CDP dual-rail for mainnet Base.
    if (isEvmNetworkId(id) && !cdpEnabled) {
      out.push(id);
    }
  }
  return out;
}

export function logSettlementNetworks(
  config: AppConfig,
  cdpEnabled: boolean,
): void {
  const ids = settlementNetworkIds(config, cdpEnabled);
  const droppedBase =
    config.networkIds.includes("eip155:8453") && !cdpEnabled;
  const droppedPolygon =
    config.networkIds.includes("eip155:137") && !config.payToPolygon;
  console.log(
    `[facilitator] settlement networks=${ids.join(",") || "(none)"} cdpEnabled=${cdpEnabled}`,
  );
  if (droppedBase) {
    console.warn(
      "[facilitator] NETWORKS includes base but CDP is not configured — Base omitted (never initialize Base against PayAI)",
    );
  }
  if (droppedPolygon) {
    console.warn(
      "[facilitator] NETWORKS includes polygon but POLY_PAY_TO unset — Polygon omitted",
    );
  }
}
