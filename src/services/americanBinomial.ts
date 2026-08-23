/**
 * American option pricing via Cox–Ross–Rubinstein (CRR) binomial tree.
 *
 * - Single exercise (not a swing / multi-exercise product).
 * - Tree spans model life τ only (forward-start window convention lives in timeline.ts).
 * - Cost of carry uses client rate r and dividendYield q (b = r − q).
 *   Power/futures-style: set r ≈ q (or both 0); we do not force that.
 * - Greeks via finite differences (not analytic) — see greeksQuality.
 */
import type { Greeks, OptionInputs, OptionType } from "../types.js";

export const DEFAULT_TREE_STEPS_PRICE = 200;
export const DEFAULT_TREE_STEPS_BATCH = 128;

function intrinsic(S: number, K: number, type: OptionType): number {
  return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

export type AmericanPriceParams = {
  spot: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  volatility: number;
  dividendYield: number;
  optionType: OptionType;
  steps?: number;
};

/**
 * CRR American price. When T≤0 or steps degenerate, returns intrinsic.
 */
export function priceAmericanBinomial(p: AmericanPriceParams): number {
  const {
    spot: S,
    strike: K,
    timeToExpiry: T,
    rate: r,
    volatility: sigma,
    dividendYield: q,
    optionType,
  } = p;
  const n = Math.max(1, Math.floor(p.steps ?? DEFAULT_TREE_STEPS_PRICE));

  if (!(S > 0) || !(K > 0) || !Number.isFinite(S) || !Number.isFinite(K)) {
    return NaN;
  }
  if (T <= 0 || sigma <= 0) {
    return intrinsic(S, K, optionType);
  }

  const dt = T / n;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  // Risk-neutral probability under continuous dividend yield q
  const a = Math.exp((r - q) * dt);
  let pUp = (a - d) / (u - d);
  // Clamp numerical drift edge cases
  if (!Number.isFinite(pUp)) pUp = 0.5;
  pUp = Math.min(1, Math.max(0, pUp));
  const pDn = 1 - pUp;

  // Terminal payoffs at j up-moves from the bottom
  const values = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) {
    const ST = S * Math.pow(u, j) * Math.pow(d, n - j);
    values[j] = intrinsic(ST, K, optionType);
  }

  // Backward induction with early exercise
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= i; j++) {
      const ST = S * Math.pow(u, j) * Math.pow(d, i - j);
      const cont = disc * (pUp * values[j + 1]! + pDn * values[j]!);
      const ex = intrinsic(ST, K, optionType);
      values[j] = Math.max(cont, ex);
    }
  }

  return values[0]!;
}

function bumpRel(x: number, frac: number): number {
  const ax = Math.abs(x);
  const scale = ax > 1e-8 ? ax : 1;
  return frac * scale;
}

/**
 * Finite-difference Greeks for American CRR.
 * Units match European analytics (vega per 1.0 σ, theta per year, rho per 1.0 r).
 */
export function computeAmericanGreeksFd(
  p: AmericanPriceParams,
): Greeks {
  const steps = p.steps ?? DEFAULT_TREE_STEPS_PRICE;
  const base = { ...p, steps };
  const v0 = priceAmericanBinomial(base);

  const dS = bumpRel(p.spot, 1e-4);
  const up = priceAmericanBinomial({ ...base, spot: p.spot + dS });
  const dn = priceAmericanBinomial({ ...base, spot: Math.max(1e-12, p.spot - dS) });
  const delta = (up - dn) / (2 * dS);
  const gamma = (up - 2 * v0 + dn) / (dS * dS);

  const dSig = 1e-4;
  const vega =
    (priceAmericanBinomial({ ...base, volatility: p.volatility + dSig }) -
      priceAmericanBinomial({
        ...base,
        volatility: Math.max(1e-8, p.volatility - dSig),
      })) /
    (2 * dSig);

  // Theta ≈ (V(T−dT) − V(T)) / dT so longs typically have negative theta (time decay).
  const dT = Math.min(1e-5, Math.max(p.timeToExpiry * 1e-4, 1e-8));
  let theta: number;
  if (p.timeToExpiry <= dT) {
    theta =
      (intrinsic(p.spot, p.strike, p.optionType) - v0) /
      Math.max(p.timeToExpiry, 1e-12);
  } else {
    const vShort = priceAmericanBinomial({
      ...base,
      timeToExpiry: p.timeToExpiry - dT,
    });
    theta = (vShort - v0) / dT;
  }

  const dr = 1e-5;
  const rho =
    (priceAmericanBinomial({ ...base, rate: p.rate + dr }) -
      priceAmericanBinomial({ ...base, rate: p.rate - dr })) /
    (2 * dr);

  return { delta, gamma, vega, theta, rho };
}

export function americanParamsFromInputs(
  inputs: OptionInputs,
  steps?: number,
): AmericanPriceParams {
  return {
    spot: inputs.spot,
    strike: inputs.strike,
    timeToExpiry: inputs.timeToExpiry,
    rate: inputs.rate,
    volatility: inputs.volatility,
    dividendYield: inputs.dividendYield,
    optionType: inputs.optionType,
    steps: steps ?? inputs.treeSteps ?? DEFAULT_TREE_STEPS_PRICE,
  };
}

/**
 * Invert American CRR price → σ via bisection (robust; slower than European Newton).
 */
export function impliedVolAmericanBinomial(
  market: Omit<AmericanPriceParams, "volatility" | "steps"> & { steps?: number },
  premium: number,
): { sigma: number; iterations: number; converged: boolean; modelPrice: number; reason?: string } {
  const steps = market.steps ?? DEFAULT_TREE_STEPS_BATCH;
  const base = { ...market, steps };

  if (!Number.isFinite(premium) || premium < 0) {
    return { sigma: NaN, iterations: 0, converged: false, modelPrice: NaN, reason: "invalid_premium" };
  }

  const T = market.timeToExpiry;
  if (T <= 0) {
    const intrins = intrinsic(market.spot, market.strike, market.optionType);
    const match = Math.abs(premium - intrins) <= 1e-8 * Math.max(1, market.spot);
    return {
      sigma: match ? 0 : NaN,
      iterations: 0,
      converged: match,
      modelPrice: intrins,
      reason: match ? undefined : "expired_premium_mismatch",
    };
  }

  const priceAt = (sigma: number) =>
    priceAmericanBinomial({ ...base, volatility: sigma });

  let lo = 1e-4;
  let hi = 5.0;
  let pLo = priceAt(lo);
  let pHi = priceAt(hi);

  if (premium > pHi + 1e-6) {
    return { sigma: NaN, iterations: 0, converged: false, modelPrice: pHi, reason: "premium_above_max" };
  }
  if (premium < pLo - 1e-8) {
    // Below low-vol price — still try lo
  }

  let iterations = 0;
  let mid = lo;
  let pMid = pLo;
  for (let i = 0; i < 64; i++) {
    iterations = i + 1;
    mid = 0.5 * (lo + hi);
    pMid = priceAt(mid);
    if (Math.abs(pMid - premium) < Math.max(1e-10, 1e-8 * Math.max(1, premium))) {
      return { sigma: mid, iterations, converged: true, modelPrice: pMid };
    }
    if (pMid > premium) {
      hi = mid;
      pHi = pMid;
    } else {
      lo = mid;
      pLo = pMid;
    }
    if (hi - lo < 1e-10) break;
  }
  pMid = priceAt(mid);
  if (Math.abs(pMid - premium) < Math.max(1e-8, 1e-6 * Math.max(1, premium))) {
    return { sigma: mid, iterations, converged: true, modelPrice: pMid };
  }
  return { sigma: mid, iterations, converged: false, modelPrice: pMid, reason: "no_convergence" };
}
