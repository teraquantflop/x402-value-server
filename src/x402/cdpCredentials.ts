/**
 * CDP credential helpers (no SDK import — safe for config load).
 */

/** JWT binding for CDP getSupported — must be GET, not verify/settle POST. */
export const CDP_SUPPORTED_AUTH = Object.freeze({
  method: "GET" as const,
  host: "api.cdp.coinbase.com",
  path: "/platform/v2/x402/supported",
});

/**
 * Railway / dotenv often store multiline PEM secrets with literal `\n`.
 * jose importPKCS8 needs real newlines for EC keys (`-----BEGIN …`).
 * Ed25519 base64 secrets are unchanged.
 */
export function normalizeCdpApiKeySecret(secret: string): string {
  let s = secret.trim();
  if (s.includes("-----BEGIN") && s.includes("\\n")) {
    s = s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  }
  // Some hosts also flatten real CRLF oddly; normalize line endings in PEM only.
  if (s.includes("-----BEGIN") && s.includes("\r")) {
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
  return s;
}

/** Safe diagnostics — never log the secret or JWT. */
export function describeCdpSecretMeta(secret: string): {
  length: number;
  startsWithBegin: boolean;
} {
  return {
    length: secret.length,
    startsWithBegin: secret.startsWith("-----BEGIN"),
  };
}
