/**
 * x402 buyer client for the Black-Scholes value server.
 *
 * Supports:
 *   - Solana (SVM): set SVM_PRIVATE_KEY (base58 64-byte secret key)
 *   - EVM (Base):   set EVM_PRIVATE_KEY (0x-prefixed hex)
 *
 * Usage:
 *   npm run dev            # terminal 1 — server
 *   npm run client         # terminal 2 — this client
 *
 * Buyer wallet must hold USDC on the network the server advertises
 * (e.g. Solana mainnet USDC when NETWORKS=solana).
 */
import "dotenv/config";
import {
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";

const SERVER_URL = (process.env.SERVER_URL ?? "http://localhost:4021").replace(
  /\/$/,
  "",
);

const SAMPLE_BODY = {
  spot: 100,
  strike: 100,
  timeToExpiry: 1,
  rate: 0.05,
  volatility: 0.2,
  optionType: "call" as const,
  dividendYield: 0,
};

const SAMPLE_SURFACE_BODY = {
  rate: 0.05,
  dividendYield: 0,
  options: [
    {
      underlying: 100,
      strike: 90,
      timeToExpiry: 0.25,
      optionType: "call" as const,
      premium: 12.5,
    },
    {
      underlying: 102,
      strike: 100,
      timeToExpiry: 0.5,
      optionType: "call" as const,
      premium: 8.7,
    },
    {
      underlying: 101,
      strike: 110,
      timeToExpiry: 1.0,
      optionType: "put" as const,
      premium: 9.1,
    },
  ],
};

interface AcceptRequirement {
  scheme?: string;
  network?: string;
  amount?: string;
  payTo?: string;
  asset?: string;
}

function decodePaymentRequired(
  header: string | null,
): {
  accepts?: AcceptRequirement[];
  x402Version?: number;
  error?: string;
} | null {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
      accepts?: AcceptRequirement[];
      x402Version?: number;
      error?: string;
    };
  } catch {
    return null;
  }
}

function needsSvm(accepts: AcceptRequirement[]): boolean {
  return accepts.some((a) => (a.network ?? "").startsWith("solana:"));
}

function needsEvm(accepts: AcceptRequirement[]): boolean {
  return accepts.some((a) => (a.network ?? "").startsWith("eip155:"));
}

async function buildX402Client(accepts: AcceptRequirement[]): Promise<{
  client: x402Client;
  labels: string[];
}> {
  const client = new x402Client();
  const labels: string[] = [];

  const wantSvm = needsSvm(accepts) || Boolean(process.env.SVM_PRIVATE_KEY);
  const wantEvm = needsEvm(accepts) || Boolean(process.env.EVM_PRIVATE_KEY);

  if (wantSvm && process.env.SVM_PRIVATE_KEY) {
    const raw = process.env.SVM_PRIVATE_KEY.trim();
    const secretBytes = base58.decode(raw);
    if (secretBytes.length !== 64) {
      throw new Error(
        `SVM_PRIVATE_KEY must decode to 64 bytes (got ${secretBytes.length}). Use a full base58 secret key (private+public).`,
      );
    }
    const keypair = await createKeyPairSignerFromBytes(secretBytes);
    const svmSigner = toClientSvmSigner(keypair);
    client.register("solana:*", new ExactSvmScheme(svmSigner));
    labels.push(`Solana buyer ${keypair.address}`);
  }

  if (wantEvm && process.env.EVM_PRIVATE_KEY) {
    const pk = process.env.EVM_PRIVATE_KEY.trim() as `0x${string}`;
    const account = privateKeyToAccount(pk);
    client.register("eip155:*", new ExactEvmScheme(account));
    labels.push(`EVM buyer ${account.address}`);
  }

  if (labels.length === 0) {
    throw new Error(
      "No buyer keys available. Set SVM_PRIVATE_KEY and/or EVM_PRIVATE_KEY in .env",
    );
  }

  // Hard fail if 402 requires a chain we cannot pay
  if (needsSvm(accepts) && !process.env.SVM_PRIVATE_KEY) {
    throw new Error(
      "Server requires Solana payment but SVM_PRIVATE_KEY is not set",
    );
  }
  if (needsEvm(accepts) && !process.env.EVM_PRIVATE_KEY) {
    throw new Error(
      "Server requires EVM payment but EVM_PRIVATE_KEY is not set",
    );
  }

  return { client, labels };
}

async function main() {
  console.log(`Server: ${SERVER_URL}`);

  // 1) Health (free)
  const healthRes = await fetch(`${SERVER_URL}/health`);
  const health = (await healthRes.json()) as {
    networks?: string[];
    networkIds?: string[];
    price?: string;
    facilitator?: string;
  };
  console.log("\nGET /health →", healthRes.status, health);

  // 2) Unpaid request should be 402
  const unpaid = await fetch(`${SERVER_URL}/v1/option/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(SAMPLE_BODY),
  });
  console.log("\nPOST /v1/option/price (no payment) →", unpaid.status);

  const paymentRequiredHeader =
    unpaid.headers.get("PAYMENT-REQUIRED") ??
    unpaid.headers.get("payment-required");

  const paymentRequired = decodePaymentRequired(paymentRequiredHeader);
  if (paymentRequiredHeader && paymentRequired) {
    console.log("  PAYMENT-REQUIRED accepts:");
    for (const a of paymentRequired.accepts ?? []) {
      console.log(
        `    - ${a.network} scheme=${a.scheme} amount=${a.amount} payTo=${a.payTo} asset=${a.asset}`,
      );
    }
  } else if (paymentRequiredHeader) {
    console.log(
      "  PAYMENT-REQUIRED header present (truncated):",
      paymentRequiredHeader.slice(0, 120) + "…",
    );
  } else {
    try {
      console.log("  body:", await unpaid.json());
    } catch {
      console.log("  body: (non-json)");
    }
  }

  // 2b) Unpaid surface endpoint
  const unpaidSurface = await fetch(`${SERVER_URL}/v1/volatility/surface`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(SAMPLE_SURFACE_BODY),
  });
  console.log(
    "\nPOST /v1/volatility/surface (no payment) →",
    unpaidSurface.status,
  );
  const surfacePrHeader =
    unpaidSurface.headers.get("PAYMENT-REQUIRED") ??
    unpaidSurface.headers.get("payment-required");
  const surfacePr = decodePaymentRequired(surfacePrHeader);
  if (surfacePr?.accepts?.length) {
    for (const a of surfacePr.accepts) {
      console.log(
        `    - ${a.network} scheme=${a.scheme} amount=${a.amount} payTo=${a.payTo}`,
      );
    }
  }

  const accepts = paymentRequired?.accepts ?? surfacePr?.accepts ?? [];
  const hasSvmKey = Boolean(process.env.SVM_PRIVATE_KEY?.trim());
  const hasEvmKey = Boolean(process.env.EVM_PRIVATE_KEY?.trim());

  if (!hasSvmKey && !hasEvmKey) {
    console.log(
      "\nNo buyer keys set — skipping paid flow.\n" +
        "  Solana: set SVM_PRIVATE_KEY (base58 secret)\n" +
        "  EVM:    set EVM_PRIVATE_KEY (0x hex)",
    );
    return;
  }

  // Mainnet spend warning
  const networks = [
    ...(health.networkIds ?? []),
    ...accepts.map((a) => a.network ?? ""),
  ];
  if (
    networks.some(
      (n) =>
        n === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" ||
        n === "eip155:8453" ||
        n === "solana" ||
        n === "base",
    )
  ) {
    console.log(
      "\n[warn] Target network is MAINNET — paid calls spend real USDC.",
    );
  }

  // 3) Paid request via @x402/fetch
  const { client, labels } = await buildX402Client(accepts);
  for (const label of labels) {
    console.log("\n" + label);
  }

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const httpClient = new x402HTTPClient(client);

  const idempotencyKey = crypto.randomUUID();
  console.log("\nPaying for POST /v1/option/price …");

  const paid = await fetchWithPayment(`${SERVER_URL}/v1/option/price`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(SAMPLE_BODY),
  });

  const result = await httpClient.processResponse(paid);
  console.log("\nPOST /v1/option/price (paid) →", paid.status);
  console.log("  paymentStatus:", result.paymentStatus);

  if (paid.status === 402) {
    const failHeader =
      paid.headers.get("PAYMENT-REQUIRED") ??
      paid.headers.get("payment-required");
    const failBody = decodePaymentRequired(failHeader);
    console.error(
      "  payment still required — settlement/verify failed:",
      failBody?.error ?? "(no error field)",
    );
    console.error(
      "  Common causes: insufficient USDC, missing ATA, RPC/sim failure, wrong network.",
    );
    if (needsSvm(accepts)) {
      console.error(
        "  Fund the Solana buyer with mainnet USDC (mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) then retry.",
      );
    }
    process.exitCode = 2;
    return;
  }

  console.log("  body:", JSON.stringify(result.body, null, 2));

  // 4) Replay with same Idempotency-Key
  const replay = await fetchWithPayment(`${SERVER_URL}/v1/option/price`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(SAMPLE_BODY),
  });
  console.log(
    "\nReplay with same Idempotency-Key →",
    replay.status,
    "Idempotent-Replay:",
    replay.headers.get("Idempotent-Replay"),
  );

  // 5) Paid volatility surface (higher price)
  console.log("\nPaying for POST /v1/volatility/surface …");
  const paidSurface = await fetchWithPayment(
    `${SERVER_URL}/v1/volatility/surface`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SAMPLE_SURFACE_BODY),
    },
  );
  const surfaceResult = await httpClient.processResponse(paidSurface);
  console.log(
    "\nPOST /v1/volatility/surface (paid) →",
    paidSurface.status,
  );
  console.log("  paymentStatus:", surfaceResult.paymentStatus);
  if (paidSurface.status === 200) {
    console.log(
      "  body (truncated):",
      JSON.stringify(surfaceResult.body, null, 2).slice(0, 1200),
    );
  } else if (paidSurface.status === 402) {
    const failHeader =
      paidSurface.headers.get("PAYMENT-REQUIRED") ??
      paidSurface.headers.get("payment-required");
    console.error(
      "  surface payment failed:",
      decodePaymentRequired(failHeader)?.error ?? "(unknown)",
    );
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("Client failed:", err);
  process.exit(1);
});
