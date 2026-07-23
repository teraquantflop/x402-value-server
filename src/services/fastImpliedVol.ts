/**
 * Black-box implied volatility solver.
 * Public API: fastImpliedVol only — internal iteration details are private.
 */
import type { OptionInputs, OptionType } from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";

const SIGMA_MIN = 1e-4;
const SIGMA_MAX = 5.0;
const MAX_ITERS = 16;
const PRICE_TOL_REL = 1e-10;
const PRICE_TOL_ABS = 1e-12;
const SIGMA_TOL = 1e-12;

export interface FastImpliedVolResult {
  sigma: number;
  iterations: number;
  converged: boolean;
  modelPrice: number;
  reason?: string;
}

function intrinsic(S: number, K: number, type: OptionType): number {
  return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

function maxOptionValue(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  type: OptionType,
): number {
  if (type === "call") {
    return S * Math.exp(-q * T);
  }
  return K * Math.exp(-r * T);
}

function clampSigma(s: number): number {
  if (!Number.isFinite(s)) return SIGMA_MIN;
  return Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, s));
}

/** Closed-form seed for the iterative solver. */
function seedSigma(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  premium: number,
  type: OptionType,
): number {
  if (T <= 0) return SIGMA_MIN;
  const F = S * Math.exp((r - q) * T);
  const disc = Math.exp(-r * T);
  // Moneyness-adjusted ATM-style seed
  const forwardPrem =
    type === "call"
      ? premium
      : premium + disc * (F - K); // put → synthetic call via parity (approx)
  const atm = Math.max(forwardPrem, 1e-12) / (0.4 * S * Math.sqrt(T));
  const m = Math.log(S / K);
  const adj = atm * (1 + 0.15 * Math.abs(m));
  return clampSigma(adj);
}

function withVol(base: Omit<OptionInputs, "volatility">, sigma: number): OptionInputs {
  return { ...base, volatility: sigma };
}

/**
 * Invert market premium → implied volatility for a European option.
 * Returns converged=false with reason when no valid σ exists.
 */
export function fastImpliedVol(
  market: Omit<OptionInputs, "volatility">,
  premium: number,
): FastImpliedVolResult {
  const { spot: S, strike: K, timeToExpiry: T, rate: r, dividendYield: q, optionType } =
    market;

  if (!Number.isFinite(premium) || premium < 0) {
    return {
      sigma: NaN,
      iterations: 0,
      converged: false,
      modelPrice: NaN,
      reason: "invalid_premium",
    };
  }

  // Loose intrinsic lower bound (undiscounted for T>0 use continuous bounds)
  const lower =
    T <= 0
      ? intrinsic(S, K, optionType)
      : Math.max(
          0,
          intrinsic(S, K, optionType) * Math.exp(-Math.abs(r) * T) * 0.5,
        );
  const upper = maxOptionValue(S, K, Math.max(T, 0), r, q, optionType);

  if (premium > upper + 1e-8) {
    return {
      sigma: NaN,
      iterations: 0,
      converged: false,
      modelPrice: NaN,
      reason: "premium_above_max",
    };
  }

  if (T <= 0) {
    const match = Math.abs(premium - intrinsic(S, K, optionType)) <= 1e-8 * Math.max(1, S);
    return {
      sigma: match ? 0 : NaN,
      iterations: 0,
      converged: match,
      modelPrice: intrinsic(S, K, optionType),
      reason: match ? undefined : "expired_premium_mismatch",
    };
  }

  if (premium <= lower * 1e-12 && premium < 1e-14) {
    // Near-zero premium → near-zero vol for OTM
    const model = priceOption(withVol(market, SIGMA_MIN));
    return {
      sigma: SIGMA_MIN,
      iterations: 0,
      converged: true,
      modelPrice: model,
    };
  }

  let sigma = seedSigma(S, K, T, r, q, premium, optionType);
  let iterations = 0;
  let modelPrice = priceOption(withVol(market, sigma));

  const tol = Math.max(PRICE_TOL_ABS, PRICE_TOL_REL * Math.max(1, premium));

  for (let i = 0; i < MAX_ITERS; i++) {
    iterations = i + 1;
    modelPrice = priceOption(withVol(market, sigma));
    const err = modelPrice - premium;
    if (Math.abs(err) < tol) {
      return { sigma, iterations, converged: true, modelPrice };
    }

    const greeks = computeGreeks(withVol(market, sigma));
    let vega = greeks.vega;
    if (!Number.isFinite(vega) || Math.abs(vega) < 1e-14) {
      // Finite-difference fallback for vega
      const h = Math.max(1e-5, sigma * 1e-4);
      const up = priceOption(withVol(market, clampSigma(sigma + h)));
      const dn = priceOption(withVol(market, clampSigma(sigma - h)));
      vega = (up - dn) / (2 * h);
    }
    if (!Number.isFinite(vega) || Math.abs(vega) < 1e-16) {
      return {
        sigma,
        iterations,
        converged: false,
        modelPrice,
        reason: "zero_vega",
      };
    }

    // Predictor: first-order residual step (damped)
    const rawStep = -err / vega;
    const damp = Math.abs(rawStep) > 0.5 * sigma ? 0.5 * sigma / Math.abs(rawStep) : 1;
    const pred = clampSigma(sigma + damp * rawStep);

    // Multi-stage residual refinement along price residual
    const k1 = residualSlope(market, premium, sigma);
    const k2 = residualSlope(market, premium, clampSigma(sigma + 0.5 * damp * k1));
    const k3 = residualSlope(market, premium, clampSigma(sigma + 0.5 * damp * k2));
    const k4 = residualSlope(market, premium, clampSigma(sigma + damp * k3));
    const rkStep = (damp / 6) * (k1 + 2 * k2 + 2 * k3 + k4);

    // Blend predictor with multi-stage step
    const next = clampSigma(0.65 * pred + 0.35 * (sigma + rkStep));
    const dSig = next - sigma;
    sigma = next;

    if (Math.abs(dSig) < SIGMA_TOL) {
      modelPrice = priceOption(withVol(market, sigma));
      if (Math.abs(modelPrice - premium) < tol * 10) {
        return { sigma, iterations, converged: true, modelPrice };
      }
    }
  }

  modelPrice = priceOption(withVol(market, sigma));
  if (Math.abs(modelPrice - premium) < tol * 100) {
    return { sigma, iterations, converged: true, modelPrice };
  }

  return {
    sigma,
    iterations,
    converged: false,
    modelPrice,
    reason: "no_convergence",
  };
}

/** dσ/dε estimate from local vega (ε = model − market). */
function residualSlope(
  market: Omit<OptionInputs, "volatility">,
  premium: number,
  sigma: number,
): number {
  const model = priceOption(withVol(market, sigma));
  const err = model - premium;
  const g = computeGreeks(withVol(market, sigma));
  let vega = g.vega;
  if (!Number.isFinite(vega) || Math.abs(vega) < 1e-14) {
    const h = Math.max(1e-5, sigma * 1e-4);
    const up = priceOption(withVol(market, clampSigma(sigma + h)));
    const dn = priceOption(withVol(market, clampSigma(sigma - h)));
    vega = (up - dn) / (2 * h);
  }
  if (!Number.isFinite(vega) || Math.abs(vega) < 1e-16) return 0;
  return -err / vega;
}
