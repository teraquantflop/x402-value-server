import { config, facilitatorStatus } from "./config.js";
import { createApp, type AppLocals } from "./app.js";
import {
  probeFacilitatorSupport,
  warmResourceServer,
} from "./x402/facilitator.js";

function printBanner(): void {
  const fac = facilitatorStatus(config);
  console.log(
    `[${config.serviceName}] v${config.serviceVersion} listening on :${config.port}`,
  );
  console.log(`  env:          ${config.nodeEnv}`);
  console.log(
    `  networks:     ${config.networks.join(", ")} (${config.networkIds.join(", ")})`,
  );
  console.log(`  payTo:        ${config.payToAddress}`);
  if (config.payToSvm) {
    console.log(`  payTo (SVM):  ${config.payToSvm}`);
  }
  if (config.payToEvm) {
    console.log(`  payTo (EVM):  ${config.payToEvm}`);
  }
  console.log(`  price:        ${config.priceDollarString}`);
  console.log(`  facilitator:  ${config.facilitatorUrl} (PayAI URL)`);
  console.log(`  public URL:   ${config.publicBaseUrl}`);
  console.log(
    `  prices:       option=${config.priceDollarString}` +
      ` impliedVol=${config.priceImpliedVolDollarString}` +
      ` surface=${config.priceVolSurfaceDollarString}` +
      ` portfolioGreeks=${config.pricePortfolioGreeksDollarString}` +
      ` portfolioScenario=${config.pricePortfolioScenarioDollarString}`,
  );
  console.log(
    `  facilitators: payai=${fac.payai ? "yes" : "no"}` +
      ` cdp.enabled=${fac.cdp.enabled ? "yes" : "no"}` +
      ` cdp.lastProbe=${fac.cdp.lastProbe}` +
      ` base=${fac.base} solana=${fac.solana}`,
  );
  console.log(`  free routes:  GET /`);
  console.log(`                GET /health`);
  console.log(`                GET /openapi.json`);
  console.log(`                GET /llms.txt`);
  console.log(`                GET /favicon.ico`);
  console.log(`                GET /.well-known/x402`);
  console.log(`                GET /.well-known/x402.json`);
  if (config.freeDemoEnabled) {
    console.log(`                GET|POST /v1/demo/option-price  (free sample)`);
  }
  if (config.mcpEnabled) {
    console.log(`                POST ${config.mcpPath}  (MCP Streamable HTTP)`);
  }
  if (config.freeTierN > 0) {
    console.log(
      `  free tier:    first ${config.freeTierN} POST /v1/option/price per IP/window`,
    );
  }
  console.log(`  paid routes:  POST /v1/option/price          ${config.priceDollarString}`);
  console.log(
    `                POST /v1/option/implied-vol    ${config.priceImpliedVolDollarString}`,
  );
  console.log(
    `                POST /v1/volatility/surface    ${config.priceVolSurfaceDollarString}`,
  );
  console.log(
    `                POST /v1/portfolio/greeks      ${config.pricePortfolioGreeksDollarString}`,
  );
  console.log(
    `                POST /v1/portfolio/scenario    ${config.pricePortfolioScenarioDollarString}`,
  );
  console.log(
    `                POST /v1/option/price-from-surface ${config.priceOptionFromSurfaceDollarString}`,
  );
  console.log(
    `                POST /v1/option/scenario-from-surface ${config.priceScenarioFromSurfaceDollarString}`,
  );
  if (config.skipPayment) {
    console.warn(`  SKIP_PAYMENT: enabled (no x402 gate)`);
  }
}

function explainStartupError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nFailed to start x402 value server.");
  console.error(message);
  if (
    message.includes("Facilitator does not support") ||
    message.includes("Route Configuration") ||
    message.includes("no supported payment kinds")
  ) {
    console.error(`
Hint — use TWO facilitators (not one URL):

  Dual mainnet (recommended):
    NETWORKS=solana,base
    FACILITATOR_URL=https://facilitator.payai.network
    PAY_TO_ADDRESS=<Solana base58>
    PAY_TO_EVM_ADDRESS=0x…
    CDP_API_KEY_ID / CDP_API_KEY_SECRET     # Base via CDP only
    # CDP_WALLET_SECRET=                   # optional; unused when payTo is an EOA

  Do NOT set FACILITATOR_URL to api.cdp.coinbase.com
  Do NOT send CDP JWTs to PayAI

  Testnet only (public facilitator, no auth):
    NETWORKS=base-sepolia          FACILITATOR_URL=https://x402.org/facilitator
    NETWORKS=solana-devnet         FACILITATOR_URL=https://x402.org/facilitator

  CAIP-2 IDs:
    solana mainnet → solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
    solana devnet  → solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
    base mainnet   → eip155:8453
    base sepolia   → eip155:84532
`);
  }
}

/**
 * Boot probes + warm initialize. Never throws — CDP 401 / missing keys
 * must not prevent Solana/PayAI from listening.
 */
async function warmFacilitatorsAtBoot(app: ReturnType<typeof createApp>): Promise<void> {
  if (config.skipPayment) return;

  const locals = app.locals as AppLocals;
  const built = locals.facilitators;
  if (built) {
    const probe = await probeFacilitatorSupport(built);
    if (!probe.payaiOk) {
      console.warn(
        "[facilitator] PayAI probe did not succeed — Solana settles may fail until facilitator recovers",
      );
    }
    if (probe.cdpEnabled && probe.cdpLastProbe === "401") {
      console.warn(
        "[facilitator] CDP getSupported 401 (warn-only) — Base remains enabled for verify/settle",
      );
    }
  }

  // Scoped CDP synthesizes Base kinds on 401 so initialize keeps eip155:8453 mapped.
  await warmResourceServer(locals.x402ResourceServer);
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
  void warmFacilitatorsAtBoot(app).catch((err) => {
    // Belt-and-suspenders: probe/warm must never crash listen
    console.warn(
      "[facilitator] boot warm unexpected error (ignored):",
      err instanceof Error ? err.message : err,
    );
  });
});

server.on("error", (err) => {
  explainStartupError(err);
  process.exit(1);
});

// paymentMiddleware validates facilitator/network support asynchronously after
// the first matching request (or on init). Surface unhandled rejections clearly,
// but do not exit on a single-rail getSupported failure (CDP 401 while PayAI works).
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const soft =
    /getSupported|Failed to fetch supported kinds|401|unauthorized/i.test(
      message,
    );
  if (soft) {
    console.warn(
      "[facilitator] unhandledRejection from facilitator probe (ignored; process stays up):",
      message,
    );
    return;
  }
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
