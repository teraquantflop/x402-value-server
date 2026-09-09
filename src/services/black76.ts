/**
 * Black-76 (futures/forward options).
 * Mark on forward F; discount with continuous rate r.
 * Does not replace BSM or American CRR.
 */
import type { Greeks, OptionType } from "../types.js";
import { normCdf, normPdf } from "./blackScholes.js";

export type Black76Inputs = {
  forward: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  volatility: number;
  optionType: OptionType;
};

function intrinsicFwd(F: number, K: number, type: OptionType): number {
  return type === "call" ? Math.max(F - K, 0) : Math.max(K - F, 0);
}

export function priceBlack76(inputs: Black76Inputs): number {
  const { forward: F, strike: K, timeToExpiry: T, rate: r, volatility: sigma, optionType } =
    inputs;
  if (!(F > 0) || !(K > 0)) return NaN;
  if (T <= 0 || sigma <= 0) {
    return Math.exp(-r * Math.max(T, 0)) * intrinsicFwd(F, K, optionType);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * T);
  if (optionType === "call") {
    return df * (F * normCdf(d1) - K * normCdf(d2));
  }
  return df * (K * normCdf(-d2) - F * normCdf(-d1));
}

/** Analytic Black-76 Greeks (delta = ∂V/∂F). */
export function computeBlack76Greeks(inputs: Black76Inputs): Greeks {
  const { forward: F, strike: K, timeToExpiry: T, rate: r, volatility: sigma, optionType } =
    inputs;
  if (T <= 0 || sigma <= 0) {
    const itm = optionType === "call" ? F > K : F < K;
    const atm = F === K;
    const df = Math.exp(-r * Math.max(T, 0));
    return {
      delta: atm
        ? 0.5 * df * (optionType === "call" ? 1 : -1)
        : itm
          ? df * (optionType === "call" ? 1 : -1)
          : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
    };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * T);
  const pdf = normPdf(d1);
  const gamma = (df * pdf) / (F * sigma * sqrtT);
  const vega = df * F * pdf * sqrtT;

  if (optionType === "call") {
    const delta = df * normCdf(d1);
    // Analytic ∂V/∂T (year); matches BSM theta sign convention in this service.
    const theta =
      -(df * F * pdf * sigma) / (2 * sqrtT) -
      r * K * df * normCdf(d2) +
      r * F * df * normCdf(d1);
    const rho = -T * priceBlack76(inputs);
    return { delta, gamma, vega, theta, rho };
  }

  const delta = -df * normCdf(-d1);
  const thetaBsmStyle =
    -(df * F * pdf * sigma) / (2 * sqrtT) +
    r * K * df * normCdf(-d2) -
    r * F * df * normCdf(-d1);
  const rho = -T * priceBlack76(inputs);
  return { delta, gamma, vega, theta: thetaBsmStyle, rho };
}
