/**
 * Single-premium implied-vol solve + Greeks for POST /v1/option/implied-vol.
 * European: fastImpliedVol + analytic Greeks.
 * American: CRR bisection IV + FD Greeks.
 */
import type {
  Greeks,
  OptionStyle,
  OptionTimeline,
  OptionType,
  PricingModelId,
  GreeksQuality,
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

export interface ImpliedVolSolveInput {
  underlying: number;
  strike: number;
  timeToExpiry?: number;
  rate: number;
  dividendYield: number;
  optionType: OptionType;
  premium: number;
  optionStyle?: OptionStyle;
  forwardStart?: string;
  expiration?: string;
  treeSteps?: number;
}

export interface ImpliedVolSolveResult {
  impliedVol: number;
  greeks: Greeks;
  modelPrice: number;
  priceError: number;
  iterations: number;
  converged: boolean;
  reason?: string;
  inputs: ImpliedVolSolveInput & { timeToExpiry: number };
  optionStyle: OptionStyle;
  model: PricingModelId;
  timeline: OptionTimeline;
  greeksQuality: GreeksQuality;
  treeSteps?: number;
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
  const style: OptionStyle = input.optionStyle ?? "european";
  const nowMs = Date.parse(computedAt);
  const timeline = resolveOptionTimeline({
    timeToExpiry: input.timeToExpiry,
    forwardStart: input.forwardStart,
    expiration: input.expiration,
    nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
  });

  const echoInputs = {
    ...input,
    timeToExpiry: timeline.tauYears,
    optionStyle: style,
  };

  if (style === "american") {
    const steps = input.treeSteps ?? DEFAULT_TREE_STEPS_BATCH;
    const iv = impliedVolAmericanBinomial(
      {
        spot: input.underlying,
        strike: input.strike,
        timeToExpiry: timeline.tauYears,
        rate: input.rate,
        dividendYield: input.dividendYield,
        optionType: input.optionType,
        steps,
      },
      input.premium,
    );

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
        inputs: echoInputs,
        optionStyle: style,
        model: "binomial-crr-american",
        timeline,
        greeksQuality: "finite-difference",
        treeSteps: steps,
        requestId,
        computedAt,
      };
    }

    const params = {
      spot: input.underlying,
      strike: input.strike,
      timeToExpiry: timeline.tauYears,
      rate: input.rate,
      volatility: iv.sigma,
      dividendYield: input.dividendYield,
      optionType: input.optionType,
      steps,
    };
    const modelPrice = priceAmericanBinomial(params);
    const greeks = computeAmericanGreeksFd(params);

    return {
      impliedVol: round(iv.sigma),
      greeks: roundGreeks(greeks),
      modelPrice: round(modelPrice),
      priceError: round(modelPrice - input.premium),
      iterations: iv.iterations,
      converged: true,
      inputs: echoInputs,
      optionStyle: style,
      model: "binomial-crr-american",
      timeline,
      greeksQuality: "finite-difference",
      treeSteps: steps,
      requestId,
      computedAt,
    };
  }

  const market = {
    spot: input.underlying,
    strike: input.strike,
    timeToExpiry: timeline.tauYears,
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
      inputs: echoInputs,
      optionStyle: style,
      model: "black-scholes-merton",
      timeline,
      greeksQuality: "analytic",
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
    inputs: echoInputs,
    optionStyle: style,
    model: "black-scholes-merton",
    timeline,
    greeksQuality: "analytic",
    requestId,
    computedAt,
  };
}
