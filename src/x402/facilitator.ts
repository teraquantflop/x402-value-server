/**
 * Facilitator clients: PayAI (Solana) + Coinbase CDP (Base) when keys set.
 * Nowcast semantics:
 *   - Keys present → register CDP for eip155:8453 and keep Base in 402 accepts
 *   - getSupported is warn-only; never drop Base because of 401/empty
 *   - PayAI stays Solana-only when CDP is enabled
 */
import {
  createCdpFacilitatorClient,
  CDP_FACILITATOR_URL as SDK_CDP_FACILITATOR_URL,
} from "@coinbase/cdp-sdk/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppConfig } from "../types.js";
import {
  CDP_SUPPORTED_AUTH,
  describeCdpSecretMeta,
  normalizeCdpApiKeySecret,
} from "./cdpCredentials.js";
import { setCdpLastProbe, type CdpLastProbe } from "./cdpProbeState.js";

export const PAYAI_DEFAULT_URL = "https://facilitator.payai.network";
export const CDP_FACILITATOR_URL =
  SDK_CDP_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402";

/** Base mainnet only — CDP must not steal Solana kinds from PayAI. */
export const CDP_BASE_NETWORKS = Object.freeze(["eip155:8453"] as const);

/** Solana networks PayAI is allowed to advertise when CDP owns Base. */
export const PAYAI_SOLANA_NETWORKS = Object.freeze([
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
] as const);

export {
  CDP_SUPPORTED_AUTH,
  describeCdpSecretMeta,
  normalizeCdpApiKeySecret,
} from "./cdpCredentials.js";

export type FacilitatorProbeResult = {
  payaiOk: boolean;
  /** Keys present → CDP is enabled regardless of probe. */
  cdpEnabled: boolean;
  /** warn-only probe outcome */
  cdpLastProbe: CdpLastProbe;
  payaiUrl: string;
  errors: string[];
};

export type BuiltFacilitators = {
  clients: FacilitatorClient[];
  payai: FacilitatorClient;
  /** Scoped CDP client used by resourceServer (synthesizes Base kinds on probe fail). */
  cdp: FacilitatorClient | null;
  /** Raw CDP client for warn-only getSupported probe status (200|401). */
  cdpInner: FacilitatorClient | null;
  payaiUrl: string;
  cdpEnabled: boolean;
};

/**
 * Synthetic Base kinds so initialize() maps eip155:8453 → CDP even when
 * GET /supported 401s. Verify/settle still use the real CDP client.
 * Matches nowcast: keys set ⇒ Base enabled; getSupported is not a gate.
 */
export function syntheticCdpBaseSupported() {
  return {
    kinds: CDP_BASE_NETWORKS.map((network) => ({
      x402Version: 2,
      scheme: "exact",
      network,
    })),
    extensions: [] as string[],
    signers: {} as Record<string, string[]>,
  };
}

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

type ScopeMode = "filter" | "cdp-synthesize-base";

/**
 * Advertise only selected networks so initialize() maps Base → CDP / Solana → PayAI.
 * CDP mode: on getSupported 401/empty, synthesize Base kinds (warn-only — never drop Base).
 */
export class NetworkScopedFacilitator implements FacilitatorClient {
  readonly name: string;

  constructor(
    private readonly inner: FacilitatorClient,
    private readonly networks: ReadonlySet<string>,
    name: string,
    private readonly mode: ScopeMode = "filter",
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
      if (kinds.length > 0) {
        return { ...supported, kinds };
      }
      if (this.mode === "cdp-synthesize-base") {
        console.warn(
          `[facilitator] ${this.name} getSupported returned no Base kinds (warn-only); ` +
            `synthesizing eip155:8453 so Base stays registered for verify/settle`,
        );
        return syntheticCdpBaseSupported();
      }
      return { ...supported, kinds: [] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.mode === "cdp-synthesize-base") {
        console.warn(
          `[facilitator] ${this.name} getSupported failed (warn-only); ` +
            `synthesizing eip155:8453 — Base remains enabled:`,
          msg,
        );
        return syntheticCdpBaseSupported();
      }
      console.warn(
        `[facilitator] ${this.name} getSupported failed; skipping it:`,
        msg,
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

function createPayAiClient(
  config: AppConfig,
  solanaOnly: boolean,
): FacilitatorClient {
  const url = resolvePayAiUrl(config.facilitatorUrl);
  const inner = new HTTPFacilitatorClient({ url });
  if (!solanaOnly) return inner;
  return new NetworkScopedFacilitator(
    inner,
    new Set(PAYAI_SOLANA_NETWORKS),
    "payai",
    "filter",
  );
}

/**
 * CDP client when both API keys are present. Soft-fails to null if construction fails.
 * Keys present ⇒ Base enabled; getSupported never gates registration.
 */
function createCdpClient(config: AppConfig): {
  scoped: FacilitatorClient;
  inner: FacilitatorClient;
} | null {
  if (!config.cdpConfigured || !config.cdpApiKeyId || !config.cdpApiKeySecret) {
    return null;
  }

  const apiKeyId = config.cdpApiKeyId.trim();
  const apiKeySecret = normalizeCdpApiKeySecret(config.cdpApiKeySecret);
  const secretMeta = describeCdpSecretMeta(apiKeySecret);

  console.log(
    `[facilitator] CDP client via createCdpFacilitatorClient` +
      ` secretLen=${secretMeta.length}` +
      ` secretStartsWithBegin=${secretMeta.startsWithBegin}` +
      ` jwt=${CDP_SUPPORTED_AUTH.method} ${CDP_SUPPORTED_AUTH.host}${CDP_SUPPORTED_AUTH.path}`,
  );

  try {
    const inner = createCdpFacilitatorClient({
      apiKeyId,
      apiKeySecret,
      baseUrl: CDP_FACILITATOR_URL,
    });
    const scoped = new NetworkScopedFacilitator(
      inner,
      new Set(CDP_BASE_NETWORKS),
      "cdp",
      "cdp-synthesize-base",
    );
    console.log(
      "[facilitator] CDP enabled for Base (eip155:8453) — getSupported is warn-only",
    );
    return { scoped, inner };
  } catch (err) {
    console.warn(
      "[facilitator] CDP keys set but createCdpFacilitatorClient failed; PayAI-only:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Build facilitator client list: CDP first (Base) when configured, then PayAI (Solana).
 */
export function buildFacilitators(config: AppConfig): BuiltFacilitators {
  const payaiUrl = resolvePayAiUrl(config.facilitatorUrl);
  const cdpPair = createCdpClient(config);
  const cdp = cdpPair?.scoped ?? null;
  const cdpInner = cdpPair?.inner ?? null;
  const cdpEnabled = Boolean(cdp);
  // PayAI Solana-only when CDP owns Base (nowcast dual-rail).
  const payai = createPayAiClient(config, cdpEnabled);

  const clients: FacilitatorClient[] = [];
  if (cdp) clients.push(cdp);
  clients.push(payai);

  if (!cdpEnabled) {
    setCdpLastProbe("skipped");
  }

  console.log(
    `[facilitator] PayAI enabled url=${payaiUrl}` +
      (cdpEnabled
        ? " (Solana-only; Base via CDP)"
        : " (Solana; Base fallback if NETWORKS includes base)"),
  );

  return { clients, payai, cdp, cdpInner, payaiUrl, cdpEnabled };
}

export function createFacilitatorClients(
  config: AppConfig,
): FacilitatorClient[] {
  return buildFacilitators(config).clients;
}

/**
 * Probe each rail's getSupported independently. NEVER throws.
 * CDP probe is warn-only on the raw client: never disables Base / never sets enabled=false.
 * Scoped CDP client (used at initialize) synthesizes Base kinds if this probe 401s.
 */
export async function probeFacilitatorSupport(
  built: BuiltFacilitators,
): Promise<FacilitatorProbeResult> {
  const errors: string[] = [];
  let payaiOk = false;
  let cdpLastProbe: CdpLastProbe = built.cdpEnabled ? "401" : "skipped";

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

  if (built.cdpInner) {
    console.log(
      `[facilitator] CDP probe (warn-only) → ${CDP_SUPPORTED_AUTH.method} https://${CDP_SUPPORTED_AUTH.host}${CDP_SUPPORTED_AUTH.path}`,
    );
    try {
      const supported = await built.cdpInner.getSupported();
      const n = (supported.kinds ?? []).filter((k) =>
        (CDP_BASE_NETWORKS as readonly string[]).includes(k.network),
      ).length;
      if (n > 0) {
        cdpLastProbe = "200";
        console.log(
          `[facilitator] CDP probe 200 kinds=${n} (Base enabled)`,
        );
      } else {
        cdpLastProbe = "401";
        errors.push(
          "CDP getSupported returned no Base kinds (warn-only) — Base stays enabled",
        );
        console.warn(
          "[facilitator] CDP probe empty (warn-only) — Base stays enabled for verify/settle",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cdpLastProbe = /401|unauthorized/i.test(msg) ? "401" : "401";
      errors.push(`CDP getSupported: ${msg}`);
      console.warn(
        "[facilitator] CDP probe 401 (warn-only) — Base stays enabled for verify/settle:",
        msg,
      );
    }
  } else {
    cdpLastProbe = "skipped";
    console.log("[facilitator] CDP not configured — Solana/PayAI only");
  }

  setCdpLastProbe(cdpLastProbe);

  return {
    payaiOk,
    cdpEnabled: built.cdpEnabled,
    cdpLastProbe,
    payaiUrl: built.payaiUrl,
    errors,
  };
}

/**
 * Warm resource server kind catalog. Soft-fails: never throws to the caller.
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
