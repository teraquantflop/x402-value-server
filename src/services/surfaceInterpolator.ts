/**
 * Total-variance bilinear interpolator in (k, T) for log-moneyness forward surfaces.
 * k = ln(K/F). w = σ²T. wingRule: flat_vol only (no wing model).
 */

export const SURFACE_CONVENTION = "log_moneyness_forward" as const;
export const SURFACE_INTERPOLATION = "total_variance_bilinear" as const;
export const SURFACE_WING_RULE = "flat_vol" as const;

export const SIGMA_MIN = 1e-4;
export const SIGMA_MAX = 5.0;
export const T_EPS = 1e-12;
const KEY_DIGITS = 12;

export type WingRule = typeof SURFACE_WING_RULE;
export type StickyMode = "moneyness" | "strike" | "fixed_vol";

export interface SurfacePointK {
  k: number;
  timeToExpiry: number;
  iv: number;
}

export interface SurfacePointStrike {
  strike: number;
  underlying: number;
  timeToExpiry: number;
  iv: number;
}

export type RawSurfacePoint = SurfacePointK | SurfacePointStrike;

export interface NormalizedPoint {
  k: number;
  T: number;
  iv: number;
}

export interface SurfaceGrid {
  ks: number[];
  Ts: number[];
  /** sigma[kIndex][tIndex]; null if no quoted point */
  sigma: (number | null)[][];
  /** filled w for interpolation (never null after fill) */
  w: number[][];
  warnings: string[];
  pointCount: number;
}

export class SurfaceValidationError extends Error {
  constructor(
    message: string,
    public readonly code = "surface_validation_error",
  ) {
    super(message);
    this.name = "SurfaceValidationError";
  }
}

function round(n: number, digits = KEY_DIGITS): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function keyKT(k: number, T: number): string {
  return `${round(k)}|${round(T)}`;
}

export function isStrikePoint(p: RawSurfacePoint): p is SurfacePointStrike {
  return "strike" in p && "underlying" in p;
}

export function logMoneyness(strike: number, forward: number): number {
  if (!(forward > 0) || !(strike > 0)) {
    throw new SurfaceValidationError("strike and underlying/forward must be > 0");
  }
  return Math.log(strike / forward);
}

/**
 * Convert raw surface rows to unique (k,T,iv). Throws on duplicates / invalid.
 */
export function normalizeSurfacePoints(
  raw: RawSurfacePoint[],
): NormalizedPoint[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new SurfaceValidationError("surface must be a non-empty array");
  }
  const seen = new Set<string>();
  const out: NormalizedPoint[] = [];

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;
    let k: number;
    let T: number;
    let iv: number;

    if (isStrikePoint(p)) {
      k = logMoneyness(p.strike, p.underlying);
      T = p.timeToExpiry;
      iv = p.iv;
    } else if (
      typeof (p as SurfacePointK).k === "number" &&
      typeof (p as SurfacePointK).timeToExpiry === "number" &&
      typeof (p as SurfacePointK).iv === "number"
    ) {
      k = (p as SurfacePointK).k;
      T = (p as SurfacePointK).timeToExpiry;
      iv = (p as SurfacePointK).iv;
    } else {
      throw new SurfaceValidationError(
        `surface[${i}] must be {k,timeToExpiry,iv} or {strike,underlying,timeToExpiry,iv}`,
      );
    }

    if (!Number.isFinite(k) || !Number.isFinite(T) || !Number.isFinite(iv)) {
      throw new SurfaceValidationError(`surface[${i}] has non-finite values`);
    }
    if (T < 0) {
      throw new SurfaceValidationError(`surface[${i}] timeToExpiry must be >= 0`);
    }
    if (!(iv > 0)) {
      throw new SurfaceValidationError(`surface[${i}] iv must be > 0`);
    }

    const key = keyKT(k, T);
    if (seen.has(key)) {
      throw new SurfaceValidationError(
        `duplicate surface point at (k,T)=(${round(k)},${round(T)})`,
      );
    }
    seen.add(key);
    out.push({ k: round(k), T: round(T), iv });
  }
  return out;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((v) => round(v)))].sort((a, b) => a - b);
}

function sigmaToW(sigma: number, T: number): number {
  const t = Math.max(T, T_EPS);
  return sigma * sigma * t;
}

function wToSigma(w: number, T: number): number {
  const t = Math.max(T, T_EPS);
  const s = Math.sqrt(Math.max(0, w) / t);
  return Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, s));
}

/**
 * Nearest defined σ on tenor tIdx along k; if none, search other tenors.
 */
function fillFlatVol(
  sigma: (number | null)[][],
  ks: number[],
  Ts: number[],
): { w: number[][]; warnings: string[] } {
  const nk = ks.length;
  const nt = Ts.length;
  const filled: number[][] = Array.from({ length: nk }, () =>
    Array.from({ length: nt }, () => SIGMA_MIN),
  );
  const warnings: string[] = [];
  let emptyCells = 0;

  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < nk; i++) {
      const direct = sigma[i]![j];
      if (direct != null) {
        filled[i]![j] = direct;
        continue;
      }
      emptyCells += 1;
      // nearest in k on same tenor
      let best: number | null = null;
      let bestDist = Infinity;
      for (let ii = 0; ii < nk; ii++) {
        const s = sigma[ii]![j];
        if (s == null) continue;
        const d = Math.abs(ks[ii]! - ks[i]!);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      if (best != null) {
        filled[i]![j] = best;
        continue;
      }
      // nearest across tenors (any k)
      best = null;
      bestDist = Infinity;
      for (let jj = 0; jj < nt; jj++) {
        for (let ii = 0; ii < nk; ii++) {
          const s = sigma[ii]![jj];
          if (s == null) continue;
          const d =
            Math.abs(Ts[jj]! - Ts[j]!) * 10 + Math.abs(ks[ii]! - ks[i]!);
          if (d < bestDist) {
            bestDist = d;
            best = s;
          }
        }
      }
      if (best != null) {
        filled[i]![j] = best;
      }
    }
  }

  if (emptyCells > 0) {
    warnings.push(
      `flat_vol_fill: ${emptyCells} empty grid cell(s) filled from nearest quoted σ (wingRule=flat_vol)`,
    );
  }

  const w = filled.map((row) =>
    row.map((s, j) => sigmaToW(s, Ts[j]!)),
  );
  return { w, warnings };
}

function softArbWarnings(grid: SurfaceGrid): string[] {
  const out: string[] = [];
  const { ks, Ts, w } = grid;
  // Calendar: w should be non-decreasing in T for fixed k
  for (let i = 0; i < ks.length; i++) {
    for (let j = 1; j < Ts.length; j++) {
      if (w[i]![j]! + 1e-12 < w[i]![j - 1]!) {
        out.push(
          `calendar_warning: w decreases in T at k=${ks[i]} between T=${Ts[j - 1]} and T=${Ts[j]}`,
        );
        break;
      }
    }
  }
  // Butterfly: discrete convexity of w vs k (rough)
  for (let j = 0; j < Ts.length; j++) {
    for (let i = 1; i < ks.length - 1; i++) {
      const k0 = ks[i - 1]!;
      const k1 = ks[i]!;
      const k2 = ks[i + 1]!;
      const w0 = w[i - 1]![j]!;
      const w1 = w[i]![j]!;
      const w2 = w[i + 1]![j]!;
      const left = (w1 - w0) / (k1 - k0);
      const right = (w2 - w1) / (k2 - k1);
      if (right + 1e-8 < left) {
        out.push(
          `butterfly_warning: w not convex in k at T=${Ts[j]} near k=${k1}`,
        );
        break;
      }
    }
  }
  return out;
}

export function buildSurfaceGrid(points: NormalizedPoint[]): SurfaceGrid {
  const ks = uniqueSorted(points.map((p) => p.k));
  const Ts = uniqueSorted(points.map((p) => p.T));
  const sigma: (number | null)[][] = Array.from({ length: ks.length }, () =>
    Array.from({ length: Ts.length }, () => null),
  );

  for (const p of points) {
    const i = ks.indexOf(round(p.k));
    const j = Ts.indexOf(round(p.T));
    if (i < 0 || j < 0) continue;
    sigma[i]![j] = p.iv;
  }

  const { w, warnings: fillWarnings } = fillFlatVol(sigma, ks, Ts);
  const grid: SurfaceGrid = {
    ks,
    Ts,
    sigma,
    w,
    warnings: fillWarnings,
    pointCount: points.length,
  };
  grid.warnings.push(...softArbWarnings(grid));
  return grid;
}

function locateBracket(axis: number[], x: number): [number, number, number] {
  // returns [i0, i1, t] with t in [0,1] for x between axis[i0] and axis[i1]
  if (axis.length === 1) return [0, 0, 0];
  if (x <= axis[0]!) return [0, 0, 0];
  if (x >= axis[axis.length - 1]!) {
    const last = axis.length - 1;
    return [last, last, 0];
  }
  let i1 = 1;
  while (i1 < axis.length && axis[i1]! < x) i1 += 1;
  const i0 = i1 - 1;
  const a0 = axis[i0]!;
  const a1 = axis[i1]!;
  const t = a1 === a0 ? 0 : (x - a0) / (a1 - a0);
  return [i0, i1, t];
}

/**
 * Interpolate σ at (k,T) via bilinear total variance; flat_vol outside k-range.
 */
export function interpolateVol(
  grid: SurfaceGrid,
  k: number,
  T: number,
): { sigma: number; warnings: string[] } {
  const warnings: string[] = [];
  const { ks, Ts, w } = grid;

  if (ks.length === 0 || Ts.length === 0) {
    throw new SurfaceValidationError("empty surface grid");
  }

  let tQuery = T;
  if (tQuery < Ts[0]! - 1e-15 || tQuery > Ts[Ts.length - 1]! + 1e-15) {
    warnings.push("tenor_extrapolate: T outside quoted maturities; clamped");
    tQuery = Math.min(Ts[Ts.length - 1]!, Math.max(Ts[0]!, tQuery));
  }
  if (k < ks[0]! - 1e-15 || k > ks[ks.length - 1]! + 1e-15) {
    warnings.push("wing_clamp: k outside quoted moneyness; flat_vol edge");
  }

  const [i0, i1, tk] = locateBracket(ks, k);
  const [j0, j1, tt] = locateBracket(Ts, tQuery);

  const w00 = w[i0]![j0]!;
  const w10 = w[i1]![j0]!;
  const w01 = w[i0]![j1]!;
  const w11 = w[i1]![j1]!;

  const w0 = w00 * (1 - tk) + w10 * tk;
  const w1 = w01 * (1 - tk) + w11 * tk;
  const wInterp = w0 * (1 - tt) + w1 * tt;

  const sigma = wToSigma(wInterp, Math.max(tQuery, T_EPS));
  return { sigma, warnings };
}

export function clampSigma(sigma: number): { sigma: number; clipped: boolean } {
  if (sigma < SIGMA_MIN) return { sigma: SIGMA_MIN, clipped: true };
  if (sigma > SIGMA_MAX) return { sigma: SIGMA_MAX, clipped: true };
  return { sigma, clipped: false };
}
