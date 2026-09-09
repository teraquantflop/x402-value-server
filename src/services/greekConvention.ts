/**
 * Scale Greeks between raw model units and trading-desk conventions.
 * raw (default): vega per 1.0 vol, theta per year, rho per 1.0 rate
 * trading: vega per 1%, theta per day, rho per bp
 */
import type { Greeks } from "../types.js";

export type GreekConvention = "raw" | "trading";

export const RAW_GREEK_UNITS = {
  price: "option value in spot/forward currency units",
  delta: "dV/dS or dV/dF (share / forward equivalent)",
  gamma: "d²V/dS² or d²V/dF²",
  vega: "dV/dσ per 1.0 absolute volatility (not per 1%)",
  theta: "dV/dT per year (not per day)",
  rho: "dV/dr per 1.0 absolute rate (not per 1%)",
} as const;

export const TRADING_GREEK_UNITS = {
  price: "option value in spot/forward currency units",
  delta: "dV/dS or dV/dF (share / forward equivalent)",
  gamma: "d²V/dS² or d²V/dF²",
  vega: "dV/dσ per 1% volatility (0.01 absolute)",
  theta: "dV/dT per calendar day",
  rho: "dV/dr per basis point (0.0001 absolute rate)",
} as const;

export function scaleGreeksForConvention(
  g: Greeks,
  convention: GreekConvention,
): Greeks {
  if (convention === "raw") return { ...g };
  return {
    delta: g.delta,
    gamma: g.gamma,
    vega: g.vega * 0.01,
    theta: g.theta / 365,
    rho: g.rho * 0.0001,
  };
}

export function unitsForConvention(convention: GreekConvention) {
  return convention === "trading" ? { ...TRADING_GREEK_UNITS } : { ...RAW_GREEK_UNITS };
}
