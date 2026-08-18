/**
 * Facilitator clients: PayAI always; Coinbase CDP for Base when configured.
 * Two rails — never one URL:
 *   - PayAI  → FACILITATOR_URL (default https://facilitator.payai.network), no CDP JWT
 *   - CDP    → createCdpFacilitatorClient({ apiKeyId, apiKeySecret }) only
 * Earlier clients in the array win network kinds in x402ResourceServer.initialize().
 */
import { createRequire } from "node:module";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";

export const PAYAI_DEFAULT_URL = "https://facilitator.payai.network";
export const CDP_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/** Base mainnet only — CDP must not steal Solana kinds from PayAI. */
export const CDP_BASE_NETWORKS = Object.freeze(["eip155:8453"] as const);

const require = createRequire(import.meta.url);

export type FacilitatorProbeResult = {
  payaiOk: boolean;
  /** null when CDP was not configured / not built */
  cdpOk: boolean | null;
  payaiUrl: string;
  errors: string[];
};

export type BuiltFacilitators = {
  clients: FacilitatorClient[];
  payai: FacilitatorClient;
  cdp: FacilitatorClient | null;
  payaiUrl: string;
};

/**
 * Resolve PayAI facilitator URL. Never allow pointing the PayAI HTTP client at CDP.
 */
export function resolvePayAiUrl(facilitatorUrl: string | undefined): string {
  const raw = (facilitatorUrl || PAYAI_DEFAULT_URL).replace(/\/$/, "");
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (
      host === "api.cdp.coinbase.com" ||
      host.endsWith(".cdp.coinbase.com") ||
      raw.replace(/\/$/, "") === CDP_FACILITATOR_URL.replace(/\/$/, "")
    ) {
      console.warn(
        `[facilitator] FACILITATOR_URL points at CDP (${raw}); ` +
          `PayAI client will use ${PAYAI_DEFAULT_URL} instead. ` +
          `Configure Base via CDP_API_KEY_ID / CDP_API_KEY_SECRET, not FACILITATOR_URL.`,
      );
      return PAYAI_DEFAULT_URL;
    }
  } catch {
    console.warn(
      `[facilitator] Invalid FACILITATOR_URL=${raw}; falling back to ${PAYAI_DEFAULT_URL}`,
    );
    return PAYAI_DEFAULT_URL;
  }
  return raw;
}

/**
 * Advertise only selected networks so initialize() maps Base → CDP.
 * Soft-fails getSupported (returns empty kinds) so one rail never kills boot.
 */
class NetworkScopedFacilitator implements FacilitatorClient {
  readonly name: string;

  constructor(
    private readonly inner: FacilitatorClient,
    private readonly networks: ReadonlySet<string>,
    name: string,
  ) {
    this.name = name;
  }

  verify(
    paymentPayload: Parameters<FacilitatorClient["verify"]>[0],
    paymentRequirements: Parameters<FacilitatorClient["verify"]>[1],
  ) {
    return this.inner.verify(paymentPayload, paymentRequirements);
  }

  settle(
    paymentPayload: Parameters<FacilitatorClient["settle"]>[0],
    paymentRequirements: Parameters<FacilitatorClient["settle"]>[1],
  ) {
    return this.inner.settle(paymentPayload, paymentRequirements);
  }

  async getSupported() {
    try {
      const supported = await this.inner.getSupported();
      const kinds = (supported.kinds ?? []).filter((k) =>
        this.networks.has(k.network),
      );
      return { ...supported, kinds };
    } catch (err) {
      console.warn(
        `[facilitator] ${this.name} getSupported failed; skipping it:`,
        err instanceof Error ? err.message : err,
      );
      return { kinds: [], extensions: [], signers: {} };
    }
  }
}

/**
 * @deprecated Prefer createFacilitatorClients / buildFacilitators for dual CDP+PayAI.
 */
export function createFacilitatorClient(
  config: AppConfig,
): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: resolvePayAiUrl(config.facilitatorUrl),
  });
}

function createPayAiClient(config: AppConfig): HTTPFacilitatorClient {
  const url = resolvePayAiUrl(config.facilitatorUrl);
  // No auth_provider / CDP JWT — PayAI public getSupported + settle only.
  return new HTTPFacilitatorClient({ url });
}

/**
 * CDP client when both API keys are present. Soft-fails to null if construction fails.
 * Uses only apiKeyId + apiKeySecret. CDP_WALLET_SECRET is unused when payTo is an EOA.
 */
function createCdpClient(config: AppConfig): FacilitatorClient | null {
  if (!config.cdpConfigured || !config.cdpApiKeyId || !config.cdpApiKeySecret) {
    return null;
  }
  try {
    const mod = require("@coinbase/cdp-sdk/x402") as {
      createCdpFacilitatorClient: (args?: {
        apiKeyId?: string;
        apiKeySecret?: string;
      }) => HTTPFacilitatorClient;
    };
    const inner = mod.createCdpFacilitatorClient({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
    });
    const scoped = new NetworkScopedFacilitator(
      inner,
      new Set(CDP_BASE_NETWORKS),
      "cdp",
    );
    console.log("[facilitator] CDP enabled for Base (eip155:8453)");
    return scoped;
  } catch (err) {
    console.warn(
      "[facilitator] CDP keys set but client unavailable; PayAI-only:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Build facilitator client list: CDP first (Base only) when configured, then PayAI
 * (Solana + Base fallback). Matches pjm-nowcast dual-facilitator pattern.
 */
export function buildFacilitators(config: AppConfig): BuiltFacilitators {
  const payaiUrl = resolvePayAiUrl(config.facilitatorUrl);
  const cdp = createCdpClient(config);
  const payai = createPayAiClient(config);

  const clients: FacilitatorClient[] = [];
  if (cdp) clients.push(cdp);
  clients.push(payai);

  console.log(
    `[facilitator] PayAI enabled url=${payaiUrl} (Solana; Base fallback=${cdp ? "no" : "yes"})`,
  );

  return { clients, payai, cdp, payaiUrl };
}

export function createFacilitatorClients(
  config: AppConfig,
): FacilitatorClient[] {
  return buildFacilitators(config).clients;
}

/**
 * Probe each rail's getSupported independently. NEVER throws.
 * PayAI is probed with no auth; CDP only through the CDP-authenticated client.
 */
export async function probeFacilitatorSupport(
  built: BuiltFacilitators,
): Promise<FacilitatorProbeResult> {
  const errors: string[] = [];
  let payaiOk = false;
  let cdpOk: boolean | null = built.cdp ? false : null;

  try {
    const supported = await built.payai.getSupported();
    const n = supported.kinds?.length ?? 0;
    payaiOk = n > 0;
    if (!payaiOk) {
      errors.push("PayAI getSupported returned no kinds");
      console.warn("[facilitator] PayAI probe: no supported kinds");
    } else {
      console.log(`[facilitator] PayAI probe ok kinds=${n} url=${built.payaiUrl}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`PayAI getSupported: ${msg}`);
    console.warn("[facilitator] PayAI probe failed:", msg);
  }

  if (built.cdp) {
    try {
      const supported = await built.cdp.getSupported();
      const n = supported.kinds?.length ?? 0;
      cdpOk = n > 0;
      if (!cdpOk) {
        errors.push("CDP getSupported returned no kinds (auth failure or empty)");
        console.warn(
          "[facilitator] CDP probe: no kinds — continuing with Solana/PayAI",
        );
      } else {
        console.log(`[facilitator] CDP probe ok kinds=${n} (Base eip155:8453)`);
      }
    } catch (err) {
      cdpOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`CDP getSupported: ${msg}`);
      console.warn(
        "[facilitator] CDP probe failed (401/unavailable) — continuing with Solana/PayAI:",
        msg,
      );
    }
  } else {
    console.log("[facilitator] CDP not configured — Solana/PayAI only");
  }

  return { payaiOk, cdpOk, payaiUrl: built.payaiUrl, errors };
}

/**
 * Warm resource server kind catalog. Soft-fails: never throws to the caller.
 * Returns whether any payment kinds were loaded.
 */
export async function warmResourceServer(
  resourceServer: { initialize: () => Promise<void> } | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (!resourceServer) {
    return { ok: false, error: "no resource server" };
  }
  try {
    await resourceServer.initialize();
    console.log("[facilitator] resourceServer.initialize() ok");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[facilitator] resourceServer.initialize() failed — process still listening:",
      msg,
    );
    return { ok: false, error: msg };
  }
}
