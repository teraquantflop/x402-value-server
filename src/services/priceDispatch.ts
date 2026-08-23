/**
 * Dispatch European BSM vs American CRR after timeline resolution.
 * Does not modify closed-form BSM; American is a sibling engine.
 */
import type {
  OptionInputs,
  OptionResult,
  OptionStyle,
  OptionTimeline,
} from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import {
  DEFAULT_TREE_STEPS_BATCH,
  DEFAULT_TREE_STEPS_PRICE,
  americanParamsFromInputs,
  computeAmericanGreeksFd,
  priceAmericanBinomial,
} from "./americanBinomial.js";
import {
  TimelineError,
  resolveOptionTimeline,
  type TimelineRequest,
} from "./timeline.js";

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

function roundGreeks(g: {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}) {
  return {
    delta: round(g.delta),
    gamma: round(g.gamma),
    vega: round(g.vega),
    theta: round(g.theta),
    rho: round(g.rho),
  };
}

export type PriceRequestBody = {
  spot: number;
  strike: number;
  rate: number;
  volatility: number;
  optionType: "call" | "put";
  dividendYield?: number;
  timeToExpiry?: number;
  optionStyle?: OptionStyle;
  forwardStart?: string;
  expiration?: string;
  treeSteps?: number;
};

export type DispatchOptions = {
  requestId: string;
  computedAt?: string;
  nowMs?: number;
  /** Default tree steps when american and treeSteps omitted. */
  defaultTreeSteps?: number;
};

export { TimelineError };

export function buildTimelineFromBody(
  body: TimelineRequest,
  nowMs?: number,
): OptionTimeline {
  return resolveOptionTimeline({ ...body, nowMs });
}

/**
 * Price + Greeks with style + timeline. Legacy european+timeToExpiry matches prior BSM.
 */
export function priceOptionDispatch(
  body: PriceRequestBody,
  opts: DispatchOptions,
): OptionResult {
  const computedAt = opts.computedAt ?? new Date().toISOString();
  const nowMs = opts.nowMs ?? Date.parse(computedAt);
  const style: OptionStyle = body.optionStyle ?? "european";

  const timeline = resolveOptionTimeline({
    timeToExpiry: body.timeToExpiry,
    forwardStart: body.forwardStart,
    expiration: body.expiration,
    nowMs,
  });

  const inputs: OptionInputs = {
    spot: body.spot,
    strike: body.strike,
    timeToExpiry: timeline.tauYears,
    rate: body.rate,
    volatility: body.volatility,
    optionType: body.optionType,
    dividendYield: body.dividendYield ?? 0,
    optionStyle: style,
    forwardStart: body.forwardStart,
    expiration: body.expiration,
    treeSteps: body.treeSteps,
  };

  if (style === "american") {
    const steps =
      body.treeSteps ??
      opts.defaultTreeSteps ??
      DEFAULT_TREE_STEPS_PRICE;
    const params = americanParamsFromInputs(inputs, steps);
    const price = priceAmericanBinomial(params);
    const greeks = computeAmericanGreeksFd(params);
    return {
      price: round(price),
      greeks: roundGreeks(greeks),
      inputs: { ...inputs, treeSteps: steps },
      model: "binomial-crr-american",
      optionStyle: "american",
      timeline,
      greeksQuality: "finite-difference",
      treeSteps: steps,
      units: { ...UNITS },
      requestId: opts.requestId,
      computedAt,
    };
  }

  const price = priceOption(inputs);
  const greeks = computeGreeks(inputs);
  return {
    price: round(price),
    greeks: roundGreeks(greeks),
    inputs,
    model: "black-scholes-merton",
    optionStyle: "european",
    timeline,
    greeksQuality: "analytic",
    units: { ...UNITS },
    requestId: opts.requestId,
    computedAt,
  };
}

/** Price only (IV / surface loops). */
export function priceOnlyDispatch(
  inputs: OptionInputs,
  style: OptionStyle = inputs.optionStyle ?? "european",
  steps?: number,
): number {
  if (style === "american") {
    return priceAmericanBinomial(
      americanParamsFromInputs(
        inputs,
        steps ?? inputs.treeSteps ?? DEFAULT_TREE_STEPS_BATCH,
      ),
    );
  }
  return priceOption(inputs);
}

export { DEFAULT_TREE_STEPS_BATCH, DEFAULT_TREE_STEPS_PRICE };
