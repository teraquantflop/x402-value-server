import type {
  Greeks,
  OptionStyle,
  OptionTimeline,
  OptionType,
} from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import { fastImpliedVol } from "./fastImpliedVol.js";
import {
  DEFAULT_TREE_STEPS_BATCH,
  computeAmericanGreeksFd,
  impliedVolAmericanBinomial,
  priceAmericanBinomial,
} from "./americanBinomial.js";
import { resolveOptionTimeline } from "./timeline.js";

export interface SurfaceOptionRow {
  underlying: number;
  strike: number;
  timeToExpiry?: number;
  optionType: OptionType;
  premium: number;
}

export interface SurfaceMarket {
  rate: number;
  dividendYield: number;
  optionStyle?: OptionStyle;
  forwardStart?: string;
  expiration?: string;
  treeSteps?: number;
}

export interface SurfacePoint {
  index: number;
  underlying: number;
  strike: number;
  timeToExpiry: number;
  optionType: OptionType;
  premium: number;
  impliedVol: number | null;
  greeks: Greeks | null;
  modelPrice: number | null;
  priceError: number | null;
  status: "ok" | "failed";
  reason?: string;
}

export interface VolatilitySurfaceResult {
  surface: {
    strikes: number[];
    maturities: number[];
    /** impliedVols[strikeIndex][maturityIndex]; null if no successful quote */
    impliedVols: (number | null)[][];
  };
  market: {
    rate: number;
    dividendYield: number;
    optionStyle: OptionStyle;
  };
  optionStyle: OptionStyle;
  timeline?: OptionTimeline;
  points: SurfacePoint[];
  fit: {
    okCount: number;
    failedCount: number;
    meanAbsPriceError: number | null;
    maxAbsPriceError: number | null;
    rmsePriceError: number | null;
  };
  stats: {
    optionCount: number;
    elapsedMs: number;
    solver: "fastImpliedVol" | "americanBinomialBisection";
    avgIterations: number;
    treeSteps?: number;
  };
  requestId: string;
  computedAt: string;
}

function round(n: number, digits = 8): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => round(v, 12)))].sort((a, b) => a - b);
}

/**
 * Build implied vol surface + per-option IV/Greeks.
 * Each option supplies its own underlying; rate/q/style are shared.
 * Optional shared forwardStart/expiration → one τ for all rows.
 */
export function buildVolatilitySurface(
  market: SurfaceMarket,
  options: SurfaceOptionRow[],
  requestId: string,
  computedAt: string = new Date().toISOString(),
): VolatilitySurfaceResult {
  const t0 = performance.now();
  const { rate, dividendYield } = market;
  const style: OptionStyle = market.optionStyle ?? "european";
  const nowMs = Date.parse(computedAt);
  const hasShared =
    market.forwardStart !== undefined || market.expiration !== undefined;

  let sharedTimeline: OptionTimeline | undefined;
  let sharedTau: number | undefined;
  if (hasShared) {
    sharedTimeline = resolveOptionTimeline({
      forwardStart: market.forwardStart,
      expiration: market.expiration,
      nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
    });
    sharedTau = sharedTimeline.tauYears;
  }

  const steps = market.treeSteps ?? DEFAULT_TREE_STEPS_BATCH;
  const points: SurfacePoint[] = [];
  let iterSum = 0;
  let iterCount = 0;
  const absErrors: number[] = [];

  for (let i = 0; i < options.length; i++) {
    const row = options[i]!;
    const T = sharedTau ?? row.timeToExpiry!;
    const base = {
      spot: row.underlying,
      strike: row.strike,
      timeToExpiry: T,
      rate,
      dividendYield,
      optionType: row.optionType,
    };

    if (style === "american") {
      const iv = impliedVolAmericanBinomial({ ...base, steps }, row.premium);
      iterSum += iv.iterations;
      iterCount += 1;

      if (!iv.converged || !Number.isFinite(iv.sigma)) {
        points.push({
          index: i,
          underlying: row.underlying,
          strike: row.strike,
          timeToExpiry: T,
          optionType: row.optionType,
          premium: row.premium,
          impliedVol: null,
          greeks: null,
          modelPrice: Number.isFinite(iv.modelPrice)
            ? round(iv.modelPrice)
            : null,
          priceError: null,
          status: "failed",
          reason: iv.reason ?? "solve_failed",
        });
        continue;
      }

      const full = { ...base, volatility: iv.sigma, steps };
      const greeks = computeAmericanGreeksFd(full);
      const modelPrice = priceAmericanBinomial(full);
      const priceError = modelPrice - row.premium;
      absErrors.push(Math.abs(priceError));

      points.push({
        index: i,
        underlying: row.underlying,
        strike: row.strike,
        timeToExpiry: T,
        optionType: row.optionType,
        premium: row.premium,
        impliedVol: round(iv.sigma),
        greeks: {
          delta: round(greeks.delta),
          gamma: round(greeks.gamma),
          vega: round(greeks.vega),
          theta: round(greeks.theta),
          rho: round(greeks.rho),
        },
        modelPrice: round(modelPrice),
        priceError: round(priceError),
        status: "ok",
      });
      continue;
    }

    const iv = fastImpliedVol(base, row.premium);
    iterSum += iv.iterations;
    iterCount += 1;

    if (!iv.converged || !Number.isFinite(iv.sigma)) {
      points.push({
        index: i,
        underlying: row.underlying,
        strike: row.strike,
        timeToExpiry: T,
        optionType: row.optionType,
        premium: row.premium,
        impliedVol: null,
        greeks: null,
        modelPrice: Number.isFinite(iv.modelPrice) ? round(iv.modelPrice) : null,
        priceError: null,
        status: "failed",
        reason: iv.reason ?? "solve_failed",
      });
      continue;
    }

    const full = { ...base, volatility: iv.sigma };
    const greeks = computeGreeks(full);
    const modelPrice = priceOption(full);
    const priceError = modelPrice - row.premium;
    absErrors.push(Math.abs(priceError));

    points.push({
      index: i,
      underlying: row.underlying,
      strike: row.strike,
      timeToExpiry: T,
      optionType: row.optionType,
      premium: row.premium,
      impliedVol: round(iv.sigma),
      greeks: {
        delta: round(greeks.delta),
        gamma: round(greeks.gamma),
        vega: round(greeks.vega),
        theta: round(greeks.theta),
        rho: round(greeks.rho),
      },
      modelPrice: round(modelPrice),
      priceError: round(priceError),
      status: "ok",
    });
  }

  const strikes = uniqueSorted(options.map((o) => o.strike));
  const maturities = uniqueSorted(points.map((p) => p.timeToExpiry));

  const buckets: number[][][] = strikes.map(() =>
    maturities.map(() => [] as number[]),
  );

  for (const p of points) {
    if (p.status !== "ok" || p.impliedVol == null) continue;
    const si = strikes.indexOf(round(p.strike, 12));
    const mi = maturities.indexOf(round(p.timeToExpiry, 12));
    if (si < 0 || mi < 0) continue;
    buckets[si]![mi]!.push(p.impliedVol);
  }

  const impliedVols: (number | null)[][] = buckets.map((row) =>
    row.map((cell) => {
      if (cell.length === 0) return null;
      const avg = cell.reduce((a, b) => a + b, 0) / cell.length;
      return round(avg);
    }),
  );

  const okCount = points.filter((p) => p.status === "ok").length;
  const failedCount = points.length - okCount;

  let meanAbsPriceError: number | null = null;
  let maxAbsPriceError: number | null = null;
  let rmsePriceError: number | null = null;
  if (absErrors.length > 0) {
    meanAbsPriceError = round(
      absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
    );
    maxAbsPriceError = round(Math.max(...absErrors));
    rmsePriceError = round(
      Math.sqrt(absErrors.reduce((a, b) => a + b * b, 0) / absErrors.length),
    );
  }

  const elapsedMs = round(performance.now() - t0, 3);

  return {
    surface: { strikes, maturities, impliedVols },
    market: { rate, dividendYield, optionStyle: style },
    optionStyle: style,
    timeline: sharedTimeline,
    points,
    fit: {
      okCount,
      failedCount,
      meanAbsPriceError,
      maxAbsPriceError,
      rmsePriceError,
    },
    stats: {
      optionCount: options.length,
      elapsedMs,
      solver:
        style === "american" ? "americanBinomialBisection" : "fastImpliedVol",
      avgIterations: iterCount > 0 ? round(iterSum / iterCount, 4) : 0,
      treeSteps: style === "american" ? steps : undefined,
    },
    requestId,
    computedAt,
  };
}
