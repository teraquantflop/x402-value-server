import type { Greeks } from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import {
  clampSigma,
  interpolateVol,
  logMoneyness,
  T_EPS,
  type StickyMode,
  type SurfaceGrid,
  SURFACE_CONVENTION,
} from "./surfaceInterpolator.js";
import {
  prepareSurfaceGrid,
  type SurfacePriceLeg,
} from "./priceFromSurface.js";
import type { RawSurfacePoint } from "./surfaceInterpolator.js";

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

export interface SurfaceScenarioShock {
  underlyingRel?: number;
  underlyingAbs?: number;
  rateBp?: number;
  timeDays?: number;
  volAbs?: number;
  volRel?: number;
  smileTwist?: number;
}

export interface ScenarioFromSurfaceParams {
  rate: number;
  dividendYield: number;
  surface: RawSurfacePoint[];
  positions: SurfacePriceLeg[];
  sticky?: StickyMode;
  scenario: SurfaceScenarioShock;
  surfaceConvention?: string;
}

function applyUnderlyingShock(
  F: number,
  shock: SurfaceScenarioShock,
): { F: number; warnings: string[] } {
  const warnings: string[] = [];
  if (shock.underlyingRel !== undefined && shock.underlyingAbs !== undefined) {
    throw new Error("Set at most one of underlyingRel or underlyingAbs");
  }
  let F2 = F;
  if (shock.underlyingRel !== undefined) {
    F2 = F * (1 + shock.underlyingRel);
  } else if (shock.underlyingAbs !== undefined) {
    F2 = F + shock.underlyingAbs;
  }
  if (!(F2 > 0)) {
    warnings.push("underlying_clipped: scenario forward floored to epsilon");
    F2 = 1e-12;
  }
  return { F: F2, warnings };
}

/**
 * Vol transform order: interpolate → volAbs → volRel → smileTwist.
 * σ_used = (σ_interp + volAbs) * (1 + volRel) + smileTwist * k_twist
 */
export function applyVolTransforms(
  sigmaInterp: number,
  kTwist: number,
  shock: SurfaceScenarioShock,
): { sigma: number; warnings: string[] } {
  const warnings: string[] = [];
  const volAbs = shock.volAbs ?? 0;
  const volRel = shock.volRel ?? 0;
  const smileTwist = shock.smileTwist ?? 0;
  let s = (sigmaInterp + volAbs) * (1 + volRel) + smileTwist * kTwist;
  const clipped = clampSigma(s);
  if (clipped.clipped) {
    warnings.push("sigma_clipped: σ clamped to [1e-4, 5]");
  }
  return { sigma: clipped.sigma, warnings };
}

function priceAt(
  F: number,
  strike: number,
  T: number,
  rate: number,
  q: number,
  type: "call" | "put",
  sigma: number,
  qty: number,
): { price: number; greeks: Greeks; contribution: number } {
  const inputs = {
    spot: F,
    strike,
    timeToExpiry: T,
    rate,
    dividendYield: q,
    optionType: type,
    volatility: sigma,
  };
  const price = priceOption(inputs);
  const greeks = computeGreeks(inputs);
  return {
    price: round(price),
    greeks: roundGreeks(greeks),
    contribution: round(price * qty),
  };
}

function resolveScenarioSigma(
  grid: SurfaceGrid,
  sticky: StickyMode,
  kBase: number,
  TBase: number,
  _FBase: number,
  FScen: number,
  strike: number,
  TScen: number,
  shock: SurfaceScenarioShock,
): { sigma: number; kRead: number; warnings: string[] } {
  const warnings: string[] = [];
  let kRead: number;
  let sigmaInterp: number;
  let kTwist: number;

  if (sticky === "fixed_vol") {
    const base = interpolateVol(grid, kBase, TBase);
    warnings.push(...base.warnings);
    sigmaInterp = base.sigma;
    kRead = kBase;
    kTwist = kBase;
  } else if (sticky === "strike") {
    kRead = kBase;
    kTwist = kBase;
    const interp = interpolateVol(grid, kRead, TScen);
    warnings.push(...interp.warnings);
    sigmaInterp = interp.sigma;
  } else {
    // moneyness
    kRead = logMoneyness(strike, FScen);
    kTwist = kRead;
    const interp = interpolateVol(grid, kRead, TScen);
    warnings.push(...interp.warnings);
    sigmaInterp = interp.sigma;
  }

  const transformed = applyVolTransforms(sigmaInterp, kTwist, shock);
  warnings.push(...transformed.warnings);
  return { sigma: transformed.sigma, kRead: round(kRead), warnings };
}

export function scenarioFromSurface(
  params: ScenarioFromSurfaceParams,
  requestId: string,
  computedAt: string = new Date().toISOString(),
) {
  if (
    params.surfaceConvention &&
    params.surfaceConvention !== SURFACE_CONVENTION
  ) {
    throw new Error(`Unsupported surfaceConvention: ${params.surfaceConvention}`);
  }

  const sticky: StickyMode = params.sticky ?? "moneyness";
  const shock = params.scenario;
  const { grid, warnings: gridWarnings } = prepareSurfaceGrid(params.surface);
  const allWarnings = [...gridWarnings];

  const rateScen = params.rate + (shock.rateBp ?? 0) / 10_000;
  const timeDays = shock.timeDays ?? 0;

  const legs = params.positions.map((leg, index) => {
    const FBase = leg.underlying;
    const kBase = logMoneyness(leg.strike, FBase);
    const TBase = leg.timeToExpiry;

    const baseInterp = interpolateVol(grid, kBase, TBase);
    allWarnings.push(
      ...baseInterp.warnings.map((w) => `leg[${index}].base: ${w}`),
    );
    const basePriced = priceAt(
      FBase,
      leg.strike,
      TBase,
      params.rate,
      params.dividendYield,
      leg.optionType,
      baseInterp.sigma,
      leg.quantity,
    );

    const { F: FScen, warnings: fWarn } = applyUnderlyingShock(FBase, shock);
    allWarnings.push(...fWarn.map((w) => `leg[${index}]: ${w}`));

    let TScen = TBase - timeDays / 365;
    if (TScen < T_EPS) {
      allWarnings.push(`leg[${index}]: T_clipped to epsilon after timeDays`);
      TScen = T_EPS;
    }

    const scenVol = resolveScenarioSigma(
      grid,
      sticky,
      kBase,
      TBase,
      FBase,
      FScen,
      leg.strike,
      TScen,
      shock,
    );
    allWarnings.push(
      ...scenVol.warnings.map((w) => `leg[${index}].scenario: ${w}`),
    );

    const scenPriced = priceAt(
      FScen,
      leg.strike,
      TScen,
      rateScen,
      params.dividendYield,
      leg.optionType,
      scenVol.sigma,
      leg.quantity,
    );

    return {
      index,
      id: leg.id,
      quantity: leg.quantity,
      optionType: leg.optionType,
      strike: leg.strike,
      base: {
        underlying: FBase,
        timeToExpiry: TBase,
        forward: FBase,
        k: round(kBase),
        impliedVol: round(baseInterp.sigma),
        price: basePriced.price,
        greeks: basePriced.greeks,
        contribution: basePriced.contribution,
      },
      scenario: {
        underlying: round(FScen),
        timeToExpiry: round(TScen),
        forward: round(FScen),
        k: scenVol.kRead,
        impliedVol: round(scenVol.sigma),
        price: scenPriced.price,
        greeks: scenPriced.greeks,
        contribution: scenPriced.contribution,
      },
      deltaValue: round(scenPriced.contribution - basePriced.contribution),
    };
  });

  let valueBase = 0;
  let valueScenario = 0;
  const greeksBase = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  const greeksScenario = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  for (const leg of legs) {
    valueBase += leg.base.contribution;
    valueScenario += leg.scenario.contribution;
    const q = leg.quantity;
    greeksBase.delta += leg.base.greeks.delta * q;
    greeksBase.gamma += leg.base.greeks.gamma * q;
    greeksBase.vega += leg.base.greeks.vega * q;
    greeksBase.theta += leg.base.greeks.theta * q;
    greeksBase.rho += leg.base.greeks.rho * q;
    greeksScenario.delta += leg.scenario.greeks.delta * q;
    greeksScenario.gamma += leg.scenario.greeks.gamma * q;
    greeksScenario.vega += leg.scenario.greeks.vega * q;
    greeksScenario.theta += leg.scenario.greeks.theta * q;
    greeksScenario.rho += leg.scenario.greeks.rho * q;
  }

  return {
    sticky,
    scenario: {
      underlyingRel: shock.underlyingRel,
      underlyingAbs: shock.underlyingAbs,
      rateBp: shock.rateBp ?? 0,
      timeDays: shock.timeDays ?? 0,
      volAbs: shock.volAbs ?? 0,
      volRel: shock.volRel ?? 0,
      smileTwist: shock.smileTwist ?? 0,
      rateScenario: round(rateScen),
    },
    legs,
    book: {
      valueBase: round(valueBase),
      valueScenario: round(valueScenario),
      deltaValue: round(valueScenario - valueBase),
      greeksBase: roundGreeks(greeksBase),
      greeksScenario: roundGreeks(greeksScenario),
      greeksNote:
        "Greeks are analytic BS Greeks at sticky/scenario σ — NOT full smile-recalibrated bump deltas",
    },
    surfaceMeta: {
      pointCount: grid.pointCount,
      kCount: grid.ks.length,
      tCount: grid.Ts.length,
      convention: SURFACE_CONVENTION,
    },
    warnings: [...new Set(allWarnings)],
    model: "black-scholes-merton+surface-tv-bilinear" as const,
    requestId,
    computedAt,
  };
}
