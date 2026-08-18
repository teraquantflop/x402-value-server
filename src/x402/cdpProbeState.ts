/**
 * Mutable CDP probe status for health / discovery.
 * enabled = keys present (never flipped false on 401).
 * lastProbe = outcome of optional getSupported warn-only probe.
 */

export type CdpLastProbe = "200" | "401" | "skipped";

let cdpLastProbe: CdpLastProbe = "skipped";

export function getCdpLastProbe(): CdpLastProbe {
  return cdpLastProbe;
}

export function setCdpLastProbe(value: CdpLastProbe): void {
  cdpLastProbe = value;
}

/** Test helper */
export function resetCdpLastProbe(): void {
  cdpLastProbe = "skipped";
}
