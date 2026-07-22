# x402 Value Server — Black-Scholes Options

Production-ready **HTTP 402 (x402)** API that sells **Black-Scholes-Merton** European option prices and full **Greeks** (delta, gamma, vega, theta, rho). Built with **TypeScript + Express** and the latest scoped **`@x402/*`** packages.

Agents and clients discover the endpoint via **Bazaar** metadata, pay **USDC** on **Base**, and receive a JSON result — no API keys or accounts.

## Features

- **POST `/v1/option/price`** — paid option calculator (exact scheme, USDC)
- **Base Sepolia** / **Base mainnet** + **Solana mainnet** / **Solana devnet** (USDC, exact scheme)
- Configurable price **$0.01–$0.10** (default `$0.05`)
- Facilitator via env (public test **`https://x402.org/facilitator`**, PayAI for Solana/Base mainnet, CDP optional)
- Full **Bazaar discovery** (`declareDiscoveryExtension` input/output schemas)
- **Idempotent** responses (`Idempotency-Key` header)
- Security: helmet, CORS, rate limits, strict Zod validation, no server private keys
- Simple **test client** (`npm run client`)

## Architecture

```
Client / Agent
    │  HTTP 402 → sign payment → retry
    ▼
Express
  free:  GET /  ·  GET /health
  paid:  POST /v1/option/price   ← paymentMiddleware (@x402/express)
           │
           ├─ Zod validation
           ├─ Idempotency cache
           └─ Black-Scholes-Merton service
                    │
                    ▼
         HTTPFacilitatorClient → FACILITATOR_URL
```

## Quick start (Base Sepolia)

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Configure

Edit `.env`:

| Variable | Notes |
|----------|--------|
| `PAY_TO_ADDRESS` | Receiving wallet: EVM `0x…` **or** Solana base58 (public only) |
| `PAY_TO_EVM_ADDRESS` / `PAY_TO_SVM_ADDRESS` | Optional when enabling both chain families |
| `NETWORKS` | `base-sepolia` \| `base` \| `solana` \| `solana-devnet` |
| `FACILITATOR_URL` | Must support every network in `NETWORKS` |
| `PRICE_USD` | `0.01`–`0.10` (default `0.05`) |

The server **never** needs a private key — only the receiving address(es).

### 3. Run

```bash
npm run dev
# → http://localhost:4021
```

### 4. Smoke without payment

```bash
curl -s http://localhost:4021/health | jq
curl -s -X POST http://localhost:4021/v1/option/price \
  -H 'Content-Type: application/json' \
  -d '{"spot":100,"strike":100,"timeToExpiry":1,"rate":0.05,"volatility":0.2,"optionType":"call"}' \
  -D -
# Expect HTTP 402 + PAYMENT-REQUIRED header
```

### 5. Paid test client

Fund a **buyer** wallet on the network your server advertises:

| Server `NETWORKS` | Buyer key | Needs |
|-------------------|-----------|--------|
| `solana` / `solana-devnet` | `SVM_PRIVATE_KEY` (base58 64-byte secret) | USDC on that Solana cluster |
| `base` / `base-sepolia` | `EVM_PRIVATE_KEY` (`0x` hex) | USDC (+ gas if not sponsored) |

```bash
# In .env (client-only — never deploy buyer keys on the server)
SVM_PRIVATE_KEY=...          # Solana buyer
# EVM_PRIVATE_KEY=0x...      # or Base buyer
SERVER_URL=http://localhost:4021

npm run client
```

The client reads the unpaid `402` `accepts` list, registers `ExactSvmScheme` and/or `ExactEvmScheme`, then pays automatically via `@x402/fetch`.

## API

### `GET /health` (free)

Liveness + active networks / facilitator.

### `GET /` (free)

Service card for humans and agents (endpoints, price, discovery flags).

### `POST /v1/option/price` (paid · x402 exact · USDC)

**Request**

```json
{
  "spot": 100,
  "strike": 100,
  "timeToExpiry": 1.0,
  "rate": 0.05,
  "volatility": 0.2,
  "optionType": "call",
  "dividendYield": 0
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `spot` | yes | Underlying price \(S > 0\) |
| `strike` | yes | Strike \(K > 0\) |
| `timeToExpiry` | yes | Years to expiry \(T \ge 0\) |
| `rate` | yes | Continuous risk-free rate \(r\) |
| `volatility` | yes | Annualized vol \(\sigma > 0\) |
| `optionType` | yes | `"call"` or `"put"` |
| `dividendYield` | no | Continuous yield \(q\) (default `0`) |

**Headers (optional)**

- `Idempotency-Key: <uuid>` — safe retries return the same body (`Idempotent-Replay: true`)

**Response `200`**

```json
{
  "price": 10.45057562,
  "greeks": {
    "delta": 0.63683059,
    "gamma": 0.01876202,
    "vega": 37.52403469,
    "theta": -6.41402764,
    "rho": 53.23248343
  },
  "inputs": { "...": "..." },
  "model": "black-scholes-merton",
  "units": {
    "vega": "dV/dσ per 1.0 absolute volatility (not per 1%)",
    "theta": "dV/dT per year (not per day)",
    "rho": "dV/dr per 1.0 absolute rate (not per 1%)"
  },
  "requestId": "…",
  "computedAt": "…"
}
```

**Model notes**

- European Black-Scholes-Merton with continuous dividend yield
- Greeks use standard analytic formulas
- **Vega / theta / rho** are raw derivatives (per 1.0 vol, per year, per 1.0 rate) — not the “per 1% / per day” trading-desk scalings

## Networks & facilitator

| Network | CAIP-2 | Env alias | Scheme package |
|---------|--------|-----------|----------------|
| Base Sepolia | `eip155:84532` | `base-sepolia` | `@x402/evm` `ExactEvmScheme` |
| Base mainnet | `eip155:8453` | `base` | `@x402/evm` `ExactEvmScheme` |
| Solana mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana` | `@x402/svm` `ExactSvmScheme` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana-devnet` | `@x402/svm` `ExactSvmScheme` |

### Public test facilitator

```bash
FACILITATOR_URL=https://x402.org/facilitator
NETWORKS=base-sepolia
# or: NETWORKS=solana-devnet
```

Works **without** API keys. **Testnet only** (Base Sepolia + Solana Devnet).

### Solana / Base mainnet (recommended easy path)

PayAI supports Solana mainnet + Base mainnet with **no API keys**:

```bash
FACILITATOR_URL=https://facilitator.payai.network
NETWORKS=solana
PAY_TO_ADDRESS=YourSolanaBase58Address
```

```bash
FACILITATOR_URL=https://facilitator.payai.network
NETWORKS=base
PAY_TO_ADDRESS=0xYourEvmAddress
```

### CDP facilitator

```bash
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
NETWORKS=base
# or multi: NETWORKS=base,solana  (+ PAY_TO_EVM_ADDRESS and PAY_TO_SVM_ADDRESS)
```

If the facilitator requires auth (CDP), install `@coinbase/cdp-sdk` and replace the client in `src/x402/facilitator.ts`:

```ts
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
// return createCdpFacilitatorClient(); // uses CDP_API_KEY_ID / CDP_API_KEY_SECRET
```

> **Fail-fast:** the server rejects routes the facilitator does not support (e.g.
> `NETWORKS=solana` with `https://x402.org/facilitator`).

## Bazaar discovery

Paid routes register `@x402/extensions/bazaar` via `declareDiscoveryExtension` in `src/x402/routeConfig.ts`:

- Example **input** body agents can copy
- JSON Schema for parameters
- Example **output** + schema for price + Greeks

Indexing notes (CDP Bazaar / compatible facilitators):

- Crawlers expect **HTTP 402** on unpaid discovery probes
- Keep `description` ≤ **500** characters
- After at least one successful settle through a Bazaar-capable facilitator, the resource can appear in discovery listings

List resources (buyer side example):

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions";

const client = withBazaar(
  new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! }),
);
const { items } = await client.extensions.bazaar.listResources({ type: "http" });
```

## Wallet notes

| Role | Needs | Never |
|------|--------|--------|
| **Server** | `PAY_TO_ADDRESS` only | Private keys, seed phrases |
| **Buyer / test client** | Funded key: USDC + gas on the target network | Commit keys to git |

Recommendations:

- Use a dedicated receiving address (hardware or custody)
- Rotate buyer test keys; keep them only in local `.env` (gitignored)
- Start on Sepolia; mainnet with small `PRICE_USD` first

## Security

- `helmet` security headers
- CORS allowlist in production (`CORS_ORIGIN`)
- Global rate limiting
- JSON body size cap (`32kb`)
- Strict Zod validation (reject unknown fields, NaN, Infinity)
- No payment payloads or private keys in logs
- `TRUST_PROXY=1` when behind nginx/Caddy/ALB

## Idempotency

Send `Idempotency-Key` on paid requests. Successful JSON responses are cached in memory for `IDEMPOTENCY_TTL_MS` (default 5 minutes). Multi-instance deploys should replace `MemoryIdempotencyStore` with Redis (interface is ready in `src/middleware/idempotency.ts`).

## Project layout

```
src/
  index.ts / app.ts / config.ts
  services/blackScholes.ts     # pure pricing
  routes/                      # free + paid handlers
  x402/                        # facilitator, resource server, route config
  middleware/                  # security, errors, idempotency
  schemas/option.ts
clients/test-client.ts
tests/
```

### Adding a new paid endpoint

1. Add handler under `src/routes/`
2. Register path + Bazaar metadata in `src/x402/routeConfig.ts`
3. Mount router in `src/app.ts` (payment middleware already matches route keys)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with reload |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm test` | Unit tests (pricing + validation) |
| `npm run client` | Paid/unpaid smoke client |

## Deploy (Railway)

Minimal public deploy via Docker. The server only needs a **public** receiving address — **never** put `SVM_PRIVATE_KEY`, `EVM_PRIVATE_KEY`, or other signing secrets on Railway.

### Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage Node 22 Alpine build → slim production image (non-root) |
| `railway.json` | Dockerfile builder + `/health` check |
| `.dockerignore` | Keeps `.env`, tests, and secrets out of the image |

### 1. Create the project

1. Push this repo to GitHub (ensure `.env` is **not** committed — it is gitignored).
2. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub** → select the repo.
3. Railway detects `railway.json` / `Dockerfile` and builds the image.

### 2. Set variables (Railway → Variables)

Required / recommended for a Solana mainnet public API:

| Variable | Example | Notes |
|----------|---------|--------|
| `NODE_ENV` | `production` | |
| `TRUST_PROXY` | `1` | Railway terminates TLS |
| `PAY_TO_ADDRESS` | `DCi9…` (public base58 or `0x…`) | **Public only** — where USDC is received |
| `NETWORKS` | `solana` | Or `base`, `base-sepolia`, etc. |
| `PRICE_USD` | `0.01` | Between `0.01` and `0.10` |
| `FACILITATOR_URL` | `https://facilitator.payai.network` | Must support `NETWORKS` |
| `PUBLIC_BASE_URL` | `https://your-app.up.railway.app` | Set after first deploy / custom domain |
| `CORS_ORIGIN` | your frontend origin(s) | Avoid `*` in production |

**Do not set on Railway:** `SVM_PRIVATE_KEY`, `EVM_PRIVATE_KEY`, or any buyer/signing key.

`PORT` is injected by Railway — leave it unset.

### 3. Generate a public domain

Railway → **Settings** → **Networking** → **Generate domain** (or attach a custom domain).  
Then set `PUBLIC_BASE_URL` to that `https://…` URL and redeploy if needed.

### 4. Smoke-check production

```bash
curl -sS https://YOUR_APP.up.railway.app/health | jq
curl -sS -D - -o /dev/null -X POST https://YOUR_APP.up.railway.app/v1/option/price \
  -H 'Content-Type: application/json' \
  -d '{"spot":100,"strike":100,"timeToExpiry":1,"rate":0.05,"volatility":0.2,"optionType":"call"}'
# Expect: HTTP/2 402 and a PAYMENT-REQUIRED header
```

Local paid tests still use a **local** key:

```bash
export SVM_PRIVATE_KEY='...'   # local shell only
SERVER_URL=https://YOUR_APP.up.railway.app npm run client
```

### 5. Local Docker (optional)

```bash
docker build -t x402-value-server .
docker run --rm -p 4021:4021 \
  -e NODE_ENV=production \
  -e TRUST_PROXY=1 \
  -e PAY_TO_ADDRESS=YourPublicAddress \
  -e NETWORKS=solana \
  -e PRICE_USD=0.01 \
  -e FACILITATOR_URL=https://facilitator.payai.network \
  -e PUBLIC_BASE_URL=http://localhost:4021 \
  x402-value-server
```

### Security checklist

- [ ] No private keys in repo, image, or Railway variables  
- [ ] `PAY_TO_ADDRESS` is a public address you control  
- [ ] `TRUST_PROXY=1` behind Railway  
- [ ] `CORS_ORIGIN` locked down if a browser frontend calls the API  
- [ ] Facilitator matches `NETWORKS` (e.g. PayAI for Solana mainnet)  
- [ ] Unpaid `POST /v1/option/price` returns **402** on the public URL  

Node **20+** required (image uses **22**).

## License

MIT
