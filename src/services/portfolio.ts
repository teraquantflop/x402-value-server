import type { Greeks, OptionType } from "../types.js";
import { computeGreeks, priceOption } from "./blackScholes.js";

const SIGMA_MIN = 1e-4;

export interface PortfolioPosition {
  underlying: number;
  strike: number;
  timeToExpiry: number;
  optionType: OptionType;
  quantity: number;
  volatility: number;
}

export interface ScenarioShock {
  name?: string;
  spotShock?: number;
  volShock?: number;
  timeDecayDays?: number;
}

export interface LegResult {
  index: number;
  quantity: number;
  underlying: number;
  strike: number;
  timeToExpiry: number;
  optionType: OptionType;
  volatility: number;
  price: number;
  contribution: number;
  greeks: Greeks;
}

export interface DollarGreeks {
  deltaCash: number;
  gammaCash: number;
  vegaPerPoint: number;
  thetaPerDay: number;
  rhoPerPoint: number;
}

export interface PortfolioSnapshot {
  mtm: number;
  greeks: Greeks;
  dollarGreeks?: DollarGreeks;
  legs: LegResult[];
}

function round(n: number, digits = 8): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function scaleGreeks(g: Greeks, qty: number): Greeks {
  return {
    delta: g.delta * qty,
    gamma: g.gamma * qty,
    vega: g.vega * qty,
    theta: g.theta * qty,
    rho: g.rho * qty,
  };
}

function addGreeks(a: Greeks, b: Greeks): Greeks {
  return {
    delta: a.delta + b.delta,
    gamma: a.gamma + b.gamma,
    vega: a.vega + b.vega,
    theta: a.theta + b.theta,
    rho: a.rho + b.rho,
  };
}

function zeroGreeks(): Greeks {
  return { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
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
 * Dollar / risk-unit scalings for agent consumption (optional).
 * Cash delta/gamma use per-leg underlyings.
 */
export function computeDollarGreeks(
  legs: LegResult[],
  netGreeks: Greeks,
): DollarGreeks {
  let deltaCash = 0;
  let gammaCash = 0;
  for (const leg of legs) {
    deltaCash += leg.greeks.delta * leg.underlying;
    gammaCash += 0.5 * leg.greeks.gamma * leg.underlying * leg.underlying;
  }
  return {
    deltaCash: round(deltaCash),
    gammaCash: round(gammaCash),
    vegaPerPoint: round(netGreeks.vega * 0.01),
    thetaPerDay: round(netGreeks.theta / 365),
    rhoPerPoint: round(netGreeks.rho * 0.01),
  };
}

/**
 * Price and aggregate a multi-leg European option portfolio.
 */
export function aggregatePortfolio(
  rate: number,
  dividendYield: number,
  positions: PortfolioPosition[],
  includeDollarGreeks = false,
): PortfolioSnapshot {
  const legs: LegResult[] = [];
  let mtm = 0;
  let net = zeroGreeks();

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    const inputs = {
      spot: p.underlying,
      strike: p.strike,
      timeToExpiry: p.timeToExpiry,
      rate,
      dividendYield,
      optionType: p.optionType,
      volatility: p.volatility,
    };
    const price = priceOption(inputs);
    const g = computeGreeks(inputs);
    const qty = p.quantity;
    const contribution = price * qty;
    const legGreeks = scaleGreeks(g, qty);

    mtm += contribution;
    net = addGreeks(net, legGreeks);

    legs.push({
      index: i,
      quantity: qty,
      underlying: p.underlying,
      strike: p.strike,
      timeToExpiry: p.timeToExpiry,
      optionType: p.optionType,
      volatility: p.volatility,
      price: round(price),
      contribution: round(contribution),
      greeks: roundGreeks(legGreeks),
    });
  }

  const netGreeks = roundGreeks(net);
  const snapshot: PortfolioSnapshot = {
    mtm: round(mtm),
    greeks: netGreeks,
    legs,
  };
  if (includeDollarGreeks) {
    snapshot.dollarGreeks = computeDollarGreeks(legs, netGreeks);
  }
  return snapshot;
}

export function shockPosition(
  p: PortfolioPosition,
  shock: ScenarioShock,
): PortfolioPosition {
  const spotShock = shock.spotShock ?? 0;
  const volShock = shock.volShock ?? 0;
  const days = shock.timeDecayDays ?? 0;

  const underlying = Math.max(1e-12, p.underlying * (1 + spotShock));
  let volatility = p.volatility * (1 + volShock);
  if (!Number.isFinite(volatility) || volatility <= 0) {
    volatility = SIGMA_MIN;
  } else {
    volatility = Math.max(SIGMA_MIN, volatility);
  }
  const timeToExpiry = Math.max(0, p.timeToExpiry - days / 365);

  return {
    ...p,
    underlying,
    volatility,
    timeToExpiry,
  };
}

export interface ScenarioResult {
  name: string;
  shocks: {
    spotShock: number;
    volShock: number;
    timeDecayDays: number;
  };
  mtm: number;
  mtmChange: number;
  greeks: Greeks;
}

/**
 * Base portfolio snapshot + reprice under each scenario shock.
 */
export function runPortfolioScenarios(
  rate: number,
  dividendYield: number,
  positions: PortfolioPosition[],
  scenarios: ScenarioShock[],
): {
  base: { mtm: number; greeks: Greeks };
  scenarios: ScenarioResult[];
} {
  const base = aggregatePortfolio(rate, dividendYield, positions, false);

  const results: ScenarioResult[] = scenarios.map((s, i) => {
    const name = (s.name?.trim() || `scenario_${i}`).slice(0, 64);
    const shocked = positions.map((p) => shockPosition(p, s));
    const snap = aggregatePortfolio(rate, dividendYield, shocked, false);
    return {
      name,
      shocks: {
        spotShock: s.spotShock ?? 0,
        volShock: s.volShock ?? 0,
        timeDecayDays: s.timeDecayDays ?? 0,
      },
      mtm: snap.mtm,
      mtmChange: round(snap.mtm - base.mtm),
      greeks: snap.greeks,
    };
  });

  return {
    base: { mtm: base.mtm, greeks: base.greeks },
    scenarios: results,
  };
}
