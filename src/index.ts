import { config } from "./config.js";
import { createApp } from "./app.js";

function printBanner(): void {
  console.log(
    `[${config.serviceName}] v${config.serviceVersion} listening on :${config.port}`,
  );
  console.log(`  env:          ${config.nodeEnv}`);
  console.log(`  payTo:        ${config.payToAddress}`);
  if (config.payToEvm && config.payToEvm !== config.payToAddress) {
    console.log(`  payTo (EVM):  ${config.payToEvm}`);
  }
  if (config.payToSvm && config.payToSvm !== config.payToAddress) {
    console.log(`  payTo (SVM):  ${config.payToSvm}`);
  }
  console.log(`  price:        ${config.priceDollarString}`);
  console.log(
    `  networks:     ${config.networks.join(", ")} (${config.networkIds.join(", ")})`,
  );
  console.log(`  facilitator:  ${config.facilitatorUrl}`);
  console.log(`  public URL:   ${config.publicBaseUrl}`);
  console.log(`  paid route:   POST /v1/option/price`);
}

function explainStartupError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nFailed to start x402 value server.");
  console.error(message);
  if (
    message.includes("Facilitator does not support") ||
    message.includes("Route Configuration")
  ) {
    console.error(`
Hint — pick a facilitator that supports your NETWORKS:

  Base Sepolia / Solana Devnet (public, no auth):
    NETWORKS=base-sepolia          FACILITATOR_URL=https://x402.org/facilitator
    NETWORKS=solana-devnet         FACILITATOR_URL=https://x402.org/facilitator

  Solana mainnet / Base mainnet (no CDP keys needed):
    NETWORKS=solana                FACILITATOR_URL=https://facilitator.payai.network
    NETWORKS=base                  FACILITATOR_URL=https://facilitator.payai.network

  CDP (requires API keys):
    FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
    CDP_API_KEY_ID / CDP_API_KEY_SECRET

  CAIP-2 IDs:
    solana mainnet → solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
    solana devnet  → solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
    base mainnet   → eip155:8453
    base sepolia   → eip155:84532
`);
  }
}

const app = createApp();

const placeholderPayTos = new Set([
  "0x0000000000000000000000000000000000000001",
  "0xyourreceivingaddress",
]);

if (
  placeholderPayTos.has(config.payToAddress.toLowerCase()) ||
  config.payToAddress.toLowerCase().includes("your")
) {
  console.warn(
    "[warn] PAY_TO_ADDRESS is a placeholder. Set a real receiving wallet before accepting payments.",
  );
}

// Bind all interfaces (required in Docker / Railway; PORT comes from the platform)
const server = app.listen(config.port, "0.0.0.0", () => {
  printBanner();
});

server.on("error", (err) => {
  explainStartupError(err);
  process.exit(1);
});

// paymentMiddleware validates facilitator/network support asynchronously after
// the first matching request (or on init). Surface unhandled rejections clearly.
process.on("unhandledRejection", (reason) => {
  explainStartupError(reason);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down…`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
