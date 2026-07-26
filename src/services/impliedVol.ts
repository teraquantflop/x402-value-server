/**
 * Single-premium implied-vol solve + Greeks for POST /v1/option/implied-vol.
 * Reuses fastImpliedVol and Black-Scholes analytics.
 */
import type { Greeks, OptionType } from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import { fastImpliedVol } from "./fastImpliedVol.js";

export interface ImpliedVolSolveInput {
  underlying: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  dividendYield: number;
  optionType: OptionType;
  premium: number;
}

export interface ImpliedVolSolveResult {
  impliedVol: number;
  greeks: Greeks;
  modelPrice: number;
  priceError: number;
  iterations: number;
  converged: boolean;
  reason?: string;
  inputs: ImpliedVolSolveInput;
  requestId: string;
  computedAt: string;
}

function round(n: number, digits = 8): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function roundGreeks(g: Greeks): Greeks {
  return {
    delta: round(g.delta),
    gamma: round(g.gamma),
    vega: round(g.vega),
    theta: round(g.theta),
    rho: round(g.rho),
  };
}

/**
 * Invert market premium → IV, then price Greeks at the solved σ.
 * Returns converged=false (with reason) when the solver cannot find a valid σ.
 */
export function solveImpliedVol(
  input: ImpliedVolSolveInput,
  requestId: string,
  computedAt: string = new Date().toISOString(),
): ImpliedVolSolveResult {
  const market = {
    spot: input.underlying,
    strike: input.strike,
    timeToExpiry: input.timeToExpiry,
    rate: input.rate,
    dividendYield: input.dividendYield,
    optionType: input.optionType,
  };

  const iv = fastImpliedVol(market, input.premium);

  if (!iv.converged || !Number.isFinite(iv.sigma)) {
    return {
      impliedVol: Number.isFinite(iv.sigma) ? round(iv.sigma) : NaN,
      greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
      modelPrice: Number.isFinite(iv.modelPrice) ? round(iv.modelPrice) : NaN,
      priceError: Number.isFinite(iv.modelPrice)
        ? round(iv.modelPrice - input.premium)
        : NaN,
      iterations: iv.iterations,
      converged: false,
      reason: iv.reason ?? "no_convergence",
      inputs: input,
      requestId,
      computedAt,
    };
  }

  const priced = {
    ...market,
    volatility: iv.sigma,
  };
  const modelPrice = priceOption(priced);
  const greeks = computeGreeks(priced);

  return {
    impliedVol: round(iv.sigma),
    greeks: roundGreeks(greeks),
    modelPrice: round(modelPrice),
    priceError: round(modelPrice - input.premium),
    iterations: iv.iterations,
    converged: true,
    inputs: input,
    requestId,
    computedAt,
  };
}
