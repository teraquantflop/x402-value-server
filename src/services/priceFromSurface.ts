import type { Greeks } from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";
import {
  buildSurfaceGrid,
  interpolateVol,
  logMoneyness,
  normalizeSurfacePoints,
  type RawSurfacePoint,
  type SurfaceGrid,
  SURFACE_CONVENTION,
  SURFACE_INTERPOLATION,
  SURFACE_WING_RULE,
} from "./surfaceInterpolator.js";

const UNITS = {
  price: "option value in spot currency units",
  delta: "dV/dS (share equivalent) at sticky/interpolated σ",
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

function roundGreeks(g: Greeks): Greeks {
  return {
    delta: round(g.delta),
    gamma: round(g.gamma),
    vega: round(g.vega),
    theta: round(g.theta),
    rho: round(g.rho),
  };
}

export interface SurfacePriceLeg {
  underlying: number;
  strike: number;
  timeToExpiry: number;
  optionType: "call" | "put";
  quantity: number;
  id?: string;
}

export interface PriceFromSurfaceParams {
  rate: number;
  dividendYield: number;
  surface: RawSurfacePoint[];
  options: SurfacePriceLeg[];
  surfaceConvention?: string;
  interpolation?: string;
  wingRule?: string;
}

export function prepareSurfaceGrid(surface: RawSurfacePoint[]): {
  grid: SurfaceGrid;
  warnings: string[];
} {
  const points = normalizeSurfacePoints(surface);
  const grid = buildSurfaceGrid(points);
  return { grid, warnings: [...grid.warnings] };
}

export function priceLegOnSurface(
  grid: SurfaceGrid,
  leg: SurfacePriceLeg,
  rate: number,
  dividendYield: number,
): {
  forward: number;
  k: number;
  impliedVol: number;
  price: number;
  greeks: Greeks;
  contribution: number;
  warnings: string[];
} {
  const F = leg.underlying;
  const k = logMoneyness(leg.strike, F);
  const { sigma, warnings } = interpolateVol(grid, k, leg.timeToExpiry);
  const inputs = {
    spot: F,
    strike: leg.strike,
    timeToExpiry: leg.timeToExpiry,
    rate,
    dividendYield,
    optionType: leg.optionType,
    volatility: sigma,
  };
  const price = priceOption(inputs);
  const greeks = computeGreeks(inputs);
  return {
    forward: F,
    k: round(k),
    impliedVol: round(sigma),
    price: round(price),
    greeks: roundGreeks(greeks),
    contribution: round(price * leg.quantity),
    warnings,
  };
}

export function priceFromSurface(
  params: PriceFromSurfaceParams,
  requestId: string,
  computedAt: string = new Date().toISOString(),
) {
  if (
    params.surfaceConvention &&
    params.surfaceConvention !== SURFACE_CONVENTION
  ) {
    throw new Error(`Unsupported surfaceConvention: ${params.surfaceConvention}`);
  }

  const { grid, warnings } = prepareSurfaceGrid(params.surface);
  const allWarnings = [...warnings];
  const results = params.options.map((leg, index) => {
    const priced = priceLegOnSurface(
      grid,
      leg,
      params.rate,
      params.dividendYield,
    );
    allWarnings.push(...priced.warnings.map((w) => `option[${index}]: ${w}`));
    return {
      index,
      id: leg.id,
      underlying: leg.underlying,
      strike: leg.strike,
      timeToExpiry: leg.timeToExpiry,
      optionType: leg.optionType,
      quantity: leg.quantity,
      forward: priced.forward,
      k: priced.k,
      impliedVol: priced.impliedVol,
      price: priced.price,
      greeks: priced.greeks,
      contribution: priced.contribution,
    };
  });

  let mtm = 0;
  const net = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  for (const r of results) {
    mtm += r.contribution;
    net.delta += r.greeks.delta * r.quantity;
    net.gamma += r.greeks.gamma * r.quantity;
    net.vega += r.greeks.vega * r.quantity;
    net.theta += r.greeks.theta * r.quantity;
    net.rho += r.greeks.rho * r.quantity;
  }

  return {
    results,
    book: {
      mtm: round(mtm),
      greeks: roundGreeks(net),
    },
    units: { ...UNITS },
    surfaceMeta: {
      pointCount: grid.pointCount,
      kCount: grid.ks.length,
      tCount: grid.Ts.length,
      convention: SURFACE_CONVENTION,
      interpolation: params.interpolation ?? SURFACE_INTERPOLATION,
      wingRule: params.wingRule ?? SURFACE_WING_RULE,
    },
    warnings: [...new Set(allWarnings)],
    model: "black-scholes-merton+surface-tv-bilinear" as const,
    requestId,
    computedAt,
  };
}
