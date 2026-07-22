import type { Greeks, OptionInputs, OptionResult, OptionType } from "../types.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF φ(x). */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF Φ(x) via Abramowitz & Stegun 26.2.17 approximation.
 * Absolute error < 7.5e-8.
 */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) {
    return x > 0 ? 1 : 0;
  }
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * absX);
  const d = 0.3989422804014327 * Math.exp((-absX * absX) / 2);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return sign === 1 ? 1 - p : p;
}

export interface Intermediate {
  d1: number;
  d2: number;
  discount: number;
  forwardFactor: number;
  pdfD1: number;
}

/**
 * Compute d1/d2 for Black-Scholes-Merton.
 * When T=0 or σ=0, returns sentinel values handled by price/greeks.
 */
export function computeD1D2(inputs: OptionInputs): Intermediate | null {
  const { spot: S, strike: K, timeToExpiry: T, rate: r, volatility: sigma, dividendYield: q } =
    inputs;

  if (T <= 0 || sigma <= 0) {
    return null;
  }

  const sqrtT = Math.sqrt(T);
  const d1 =
    (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  return {
    d1,
    d2,
    discount: Math.exp(-r * T),
    forwardFactor: Math.exp(-q * T),
    pdfD1: normPdf(d1),
  };
}

function intrinsic(S: number, K: number, type: OptionType): number {
  return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

export function priceOption(inputs: OptionInputs): number {
  const { spot: S, strike: K, timeToExpiry: T, rate: r, dividendYield: q, optionType } =
    inputs;
  const mid = computeD1D2(inputs);

  if (!mid) {
    // Expired or zero vol: discounted intrinsic under deterministic forward
    if (T <= 0) {
      return intrinsic(S, K, optionType);
    }
    const F = S * Math.exp((r - q) * T);
    const disc = Math.exp(-r * T);
    return disc * intrinsic(F, K, optionType);
  }

  const { d1, d2, discount, forwardFactor } = mid;

  if (optionType === "call") {
    return S * forwardFactor * normCdf(d1) - K * discount * normCdf(d2);
  }
  return K * discount * normCdf(-d2) - S * forwardFactor * normCdf(-d1);
}

export function computeGreeks(inputs: OptionInputs): Greeks {
  const { spot: S, strike: K, timeToExpiry: T, rate: r, volatility: sigma, dividendYield: q, optionType } =
    inputs;
  const mid = computeD1D2(inputs);

  if (!mid) {
    if (T <= 0) {
      const itm = optionType === "call" ? S > K : S < K;
      const atm = S === K;
      return {
        delta: atm ? 0.5 * (optionType === "call" ? 1 : -1) : itm ? (optionType === "call" ? 1 : -1) : 0,
        gamma: 0,
        vega: 0,
        theta: 0,
        rho: 0,
      };
    }
    // σ → 0, T > 0: deterministic
    const F = S * Math.exp((r - q) * T);
    const disc = Math.exp(-r * T);
    if (optionType === "call") {
      return {
        delta: F > K ? Math.exp(-q * T) : F === K ? 0.5 * Math.exp(-q * T) : 0,
        gamma: 0,
        vega: 0,
        theta: F > K ? q * S * Math.exp(-q * T) - r * K * disc : 0,
        rho: F > K ? K * T * disc : 0,
      };
    }
    return {
      delta: F < K ? -Math.exp(-q * T) : F === K ? -0.5 * Math.exp(-q * T) : 0,
      gamma: 0,
      vega: 0,
      theta: F < K ? -q * S * Math.exp(-q * T) + r * K * disc : 0,
      rho: F < K ? -K * T * disc : 0,
    };
  }

  const { d1, d2, discount, forwardFactor, pdfD1 } = mid;
  const sqrtT = Math.sqrt(T);

  // Gamma and vega identical for call and put
  const gamma = (forwardFactor * pdfD1) / (S * sigma * sqrtT);
  // Vega: dV/dσ for a 1.0 absolute move in volatility (not per 1%)
  const vega = S * forwardFactor * pdfD1 * sqrtT;

  if (optionType === "call") {
    const delta = forwardFactor * normCdf(d1);
    const theta =
      (-(S * forwardFactor * pdfD1 * sigma) / (2 * sqrtT) -
        r * K * discount * normCdf(d2) +
        q * S * forwardFactor * normCdf(d1));
    const rho = K * T * discount * normCdf(d2);
    return { delta, gamma, vega, theta, rho };
  }

  const delta = -forwardFactor * normCdf(-d1);
  const theta =
    (-(S * forwardFactor * pdfD1 * sigma) / (2 * sqrtT) +
      r * K * discount * normCdf(-d2) -
      q * S * forwardFactor * normCdf(-d1));
  const rho = -K * T * discount * normCdf(-d2);
  return { delta, gamma, vega, theta, rho };
}

const UNITS = {
  price: "option value in spot currency units",
  delta: "dV/dS (share equivalent)",
  gamma: "d²V/dS²",
  vega: "dV/dσ per 1.0 absolute volatility (not per 1%)",
  theta: "dV/dT per year (not per day)",
  rho: "dV/dr per 1.0 absolute rate (not per 1%)",
} as const;

function round(n: number, digits = 8): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function priceWithGreeks(
  inputs: OptionInputs,
  requestId: string,
  computedAt: string = new Date().toISOString(),
): OptionResult {
  const price = priceOption(inputs);
  const greeks = computeGreeks(inputs);

  return {
    price: round(price),
    greeks: {
      delta: round(greeks.delta),
      gamma: round(greeks.gamma),
      vega: round(greeks.vega),
      theta: round(greeks.theta),
      rho: round(greeks.rho),
    },
    inputs,
    model: "black-scholes-merton",
    units: { ...UNITS },
    requestId,
    computedAt,
  };
}
