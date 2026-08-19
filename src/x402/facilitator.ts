/**
 * Facilitator clients — nowcast two-client dispatch (no Python port):
 *   1) CDP first (eip155:8453 only) via createCdpFacilitatorClient + NetworkScoped
 *   2) PayAI second (Solana-only when CDP on) via HTTPFacilitatorClient(FACILITATOR_URL)
 *
 * initialize() maps Base → CDP (earlier wins). PayAI is Solana-scoped so Base
 * never hits PayAI even on try-all fallback. GET /supported 401 is warn-only;
 * CDP synthesizes Base kinds so accepts stay.
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
import { logSettlementNetworks } from "./settlementNetworks.js";

export const PAYAI_DEFAULT_URL = "https://facilitator.payai.network";
export const CDP_FACILITATOR_URL =
  SDK_CDP_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402";

export const CDP_BASE_NETWORKS = Object.freeze(["eip155:8453"] as const);

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
  cdpEnabled: boolean;
  cdpLastProbe: CdpLastProbe;
  payaiUrl: string;
  errors: string[];
};

export type BuiltFacilitators = {
  /** Registered on x402ResourceServer — CDP first when present (nowcast order). */
  clients: FacilitatorClient[];
  payai: FacilitatorClient;
  cdp: FacilitatorClient | null;
  cdpInner: FacilitatorClient | null;
  payaiUrl: string;
  cdpEnabled: boolean;
};

export function syntheticCdpBaseSupported() {
  return {
    kinds: CDP_BASE_NETWORKS.map((network) => ({
      x402Version: 2,
      scheme: "exact" as const,
      network: network as `${string}:${string}`,
    })),
    extensions: [] as string[],
    signers: {} as Record<string, string[]>,
  };
}

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

function statusFromError(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err) {
    const n = (err as { statusCode?: unknown }).statusCode;
    if (typeof n === "number") return n;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/\b(401|403|404|500|502|503)\b/);
  return m ? Number(m[1]) : undefined;
}

type ScopeMode = "filter" | "cdp-synthesize-base";

/**
 * Advertise only selected networks so initialize() maps Base → CDP / Solana → PayAI.
 * Mirrors nowcast _NetworkScopedFacilitator, plus CDP synthesize-on-401 (warn-only).
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

  /** Test helper */
  get innerClient(): FacilitatorClient {
    return this.inner;
  }

  async verify(
    paymentPayload: Parameters<FacilitatorClient["verify"]>[0],
    paymentRequirements: Parameters<FacilitatorClient["verify"]>[1],
  ) {
    const network = String(paymentRequirements.network);
    // Bind to inner — do not wrap/strip Authorization; CDP JWT stays on the client.
    const verify = this.inner.verify.bind(this.inner);
    try {
      const result = await verify(paymentPayload, paymentRequirements);
      const valid =
        result && typeof result === "object" && "isValid" in result
          ? Boolean((result as { isValid?: boolean }).isValid)
          : undefined;
      console.log(
        `[facilitator] verify network=${network} facilitator=${this.name} status=ok` +
          (valid === undefined ? "" : ` isValid=${valid}`),
      );
      return result;
    } catch (err) {
      const status = statusFromError(err);
      console.warn(
        `[facilitator] verify network=${network} facilitator=${this.name} status=${status ?? "error"}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  async settle(
    paymentPayload: Parameters<FacilitatorClient["settle"]>[0],
    paymentRequirements: Parameters<FacilitatorClient["settle"]>[1],
  ) {
    const network = String(paymentRequirements.network);
    const settle = this.inner.settle.bind(this.inner);
    try {
      const result = await settle(paymentPayload, paymentRequirements);
      console.log(
        `[facilitator] settle network=${network} facilitator=${this.name} status=ok`,
      );
      return result;
    } catch (err) {
      const status = statusFromError(err);
      console.warn(
        `[facilitator] settle network=${network} facilitator=${this.name} status=${status ?? "error"}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  async getSupported() {
    // CDP: always return Base kinds so HTTPServer.initialize() validateRouteConfiguration
    // never throws missing_facilitator for eip155:8453 (nowcast does not init Base on PayAI).
    if (this.mode === "cdp-synthesize-base") {
      try {
        const supported = await this.inner.getSupported();
        const kinds = (supported.kinds ?? []).filter((k) =>
          this.networks.has(k.network),
        );
        if (kinds.some((k) => k.network === "eip155:8453")) {
          return { ...supported, kinds };
        }
        console.warn(
          `[facilitator] ${this.name} getSupported missing Base (warn-only); synthesizing eip155:8453`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[facilitator] ${this.name} getSupported failed (warn-only); synthesizing eip155:8453:`,
          msg,
        );
      }
      return syntheticCdpBaseSupported();
    }

    try {
      const supported = await this.inner.getSupported();
      const kinds = (supported.kinds ?? []).filter((k) =>
        this.networks.has(k.network),
      );
      return { ...supported, kinds };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[facilitator] ${this.name} getSupported failed; skipping it:`,
        msg,
      );
      return { kinds: [], extensions: [], signers: {} };
    }
  }
}

/**
 * @deprecated Prefer buildFacilitators.
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

function cdpClientHasJwt(client: FacilitatorClient): boolean {
  const c = client as FacilitatorClient & {
    createAuthHeaders?: unknown;
    _createAuthHeaders?: unknown;
  };
  return (
    typeof c.createAuthHeaders === "function" ||
    typeof c._createAuthHeaders === "function"
  );
}

/**
 * Authenticated CDP client for Base. Credentials come explicitly from env
 * (trimmed). verify/settle are bound to the raw CDP client — we never strip
 * or rewrite Authorization; NetworkScoped only overrides getSupported kinds.
 */
function createCdpScoped(config: AppConfig): {
  scoped: NetworkScopedFacilitator;
  inner: FacilitatorClient;
} | null {
  // Prefer live env at construction time (explicit), fall back to loaded config.
  const apiKeyId = (
    process.env.CDP_API_KEY_ID ??
    config.cdpApiKeyId ??
    ""
  ).trim();
  // trim + PEM \n unescape for EC keys; Ed25519 base64 unchanged
  const apiKeySecret = normalizeCdpApiKeySecret(
    process.env.CDP_API_KEY_SECRET ?? config.cdpApiKeySecret ?? "",
  );

  if (!apiKeyId || !apiKeySecret) {
    return null;
  }

  const secretMeta = describeCdpSecretMeta(apiKeySecret);

  try {
    const inner = createCdpFacilitatorClient({
      apiKeyId,
      apiKeySecret,
    });
    const jwtAttached = cdpClientHasJwt(inner);
    console.log(
      `[facilitator] CDP createCdpFacilitatorClient` +
        ` keyIdLen=${apiKeyId.length}` +
        ` secretLen=${secretMeta.length}` +
        ` secretStartsWithBegin=${secretMeta.startsWithBegin}` +
        ` jwtAttached=${jwtAttached}`,
    );
    if (!jwtAttached) {
      console.warn(
        "[facilitator] CDP client missing createAuthHeaders — verify will be unauthenticated",
      );
    }

    // Scope getSupported to Base (+ synthesize on 401). verify/settle → inner.bind
    // so Authorization JWT from createCdpFacilitatorClient is untouched.
    const scoped = new NetworkScopedFacilitator(
      inner,
      new Set(CDP_BASE_NETWORKS),
      "cdp",
      "cdp-synthesize-base",
    );
    console.log(
      "[facilitator] CDP enabled for Base (eip155:8453) — first in client list (nowcast order)",
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
 * Nowcast order: CDP (Base) first when configured, then PayAI (Solana-scoped if CDP on).
 */
export function buildFacilitators(config: AppConfig): BuiltFacilitators {
  const payaiUrl = resolvePayAiUrl(config.facilitatorUrl);
  const cdpPair = createCdpScoped(config);
  const cdpEnabled = Boolean(cdpPair);
  const payai = createPayAiClient(config, cdpEnabled);

  const clients: FacilitatorClient[] = [];
  if (cdpPair) clients.push(cdpPair.scoped);
  clients.push(payai);

  if (!cdpEnabled) {
    setCdpLastProbe("skipped");
  }

  console.log(
    `[facilitator] PayAI enabled url=${payaiUrl}` +
      (cdpEnabled
        ? " (Solana-only; Base via CDP)"
        : " (Solana; Base only if CDP configured)"),
  );
  logSettlementNetworks(config, cdpEnabled);

  return {
    clients,
    payai,
    cdp: cdpPair?.scoped ?? null,
    cdpInner: cdpPair?.inner ?? null,
    payaiUrl,
    cdpEnabled,
  };
}

export function createFacilitatorClients(
  config: AppConfig,
): FacilitatorClient[] {
  return buildFacilitators(config).clients;
}

/**
 * Probe rails independently. NEVER throws.
 * CDP probe is warn-only; never disables Base.
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
      const n = (supported.kinds ?? []).filter(
        (k) => k.network === "eip155:8453",
      ).length;
      if (n > 0) {
        cdpLastProbe = "200";
        console.log(`[facilitator] CDP probe 200 kinds=${n} (Base enabled)`);
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
      cdpLastProbe = "401";
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
