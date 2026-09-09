/**
 * Dispatch European BSM / Black-76 / American CRR after timeline resolution.
 * Does not modify closed-form BSM; Black-76 and American are sibling engines.
 */
import type {
  GreekConvention,
  OptionInputs,
  OptionResult,
  OptionStyle,
  OptionTimeline,
  PricingModelFlag,
} from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import { computeBlack76Greeks, priceBlack76 } from "./black76.js";
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
import {
  scaleGreeksForConvention,
  unitsForConvention,
} from "./greekConvention.js";

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
  spot?: number;
  forward?: number;
  strike: number;
  rate: number;
  volatility: number;
  optionType: "call" | "put";
  dividendYield?: number;
  timeToExpiry?: number;
  optionStyle?: OptionStyle;
  model?: PricingModelFlag;
  greekConvention?: GreekConvention;
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
 * Price + Greeks with style + timeline + optional Black-76 / greekConvention.
 * Legacy european+timeToExpiry+bsm matches prior BSM.
 */
export function priceOptionDispatch(
  body: PriceRequestBody,
  opts: DispatchOptions,
): OptionResult {
  const computedAt = opts.computedAt ?? new Date().toISOString();
  const nowMs = opts.nowMs ?? Date.parse(computedAt);
  const style: OptionStyle = body.optionStyle ?? "european";
  const modelFlag: PricingModelFlag = body.model ?? "bsm";
  const greekConvention: GreekConvention = body.greekConvention ?? "raw";

  const timeline = resolveOptionTimeline({
    timeToExpiry: body.timeToExpiry,
    forwardStart: body.forwardStart,
    expiration: body.expiration,
    nowMs,
  });

  if (modelFlag === "black76") {
    const F = body.forward ?? body.spot;
    if (F === undefined) {
      throw new Error("forward or spot required for model=black76");
    }
    const blackInputs = {
      forward: F,
      strike: body.strike,
      timeToExpiry: timeline.tauYears,
      rate: body.rate,
      volatility: body.volatility,
      optionType: body.optionType,
    };
    const price = priceBlack76(blackInputs);
    const greeks = scaleGreeksForConvention(
      computeBlack76Greeks(blackInputs),
      greekConvention,
    );
    const inputs: OptionInputs = {
      spot: body.spot ?? F,
      forward: F,
      strike: body.strike,
      timeToExpiry: timeline.tauYears,
      rate: body.rate,
      volatility: body.volatility,
      optionType: body.optionType,
      dividendYield: 0,
      optionStyle: "european",
      model: "black76",
      greekConvention,
      forwardStart: body.forwardStart,
      expiration: body.expiration,
    };
    return {
      price: round(price),
      greeks: roundGreeks(greeks),
      inputs,
      model: "black-76",
      optionStyle: "european",
      timeline,
      greeksQuality: "analytic",
      greekConvention,
      units: unitsForConvention(greekConvention),
      requestId: opts.requestId,
      computedAt,
    };
  }

  const spot = body.spot;
  if (spot === undefined) {
    throw new Error("spot is required when model is bsm");
  }

  const inputs: OptionInputs = {
    spot,
    strike: body.strike,
    timeToExpiry: timeline.tauYears,
    rate: body.rate,
    volatility: body.volatility,
    optionType: body.optionType,
    dividendYield: body.dividendYield ?? 0,
    optionStyle: style,
    model: "bsm",
    greekConvention,
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
    const greeks = scaleGreeksForConvention(
      computeAmericanGreeksFd(params),
      greekConvention,
    );
    return {
      price: round(price),
      greeks: roundGreeks(greeks),
      inputs: { ...inputs, treeSteps: steps },
      model: "binomial-crr-american",
      optionStyle: "american",
      timeline,
      greeksQuality: "finite-difference",
      greekConvention,
      treeSteps: steps,
      units: unitsForConvention(greekConvention),
      requestId: opts.requestId,
      computedAt,
    };
  }

  const price = priceOption(inputs);
  const greeks = scaleGreeksForConvention(
    computeGreeks(inputs),
    greekConvention,
  );
  return {
    price: round(price),
    greeks: roundGreeks(greeks),
    inputs,
    model: "black-scholes-merton",
    optionStyle: "european",
    timeline,
    greeksQuality: "analytic",
    greekConvention,
    units: unitsForConvention(greekConvention),
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
