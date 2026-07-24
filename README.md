# x402 Derivatives Analytics Desk

Production **HTTP 402 (x402)** quant API for **AI agents** in equities, commodities, power/energy, and crypto: European **Black-Scholes-Merton** pricing, full **Greeks**, and **implied-volatility surfaces**. TypeScript + Express + `@x402/*`.

Agents discover capabilities via **Bazaar** metadata and `GET /`, pay **USDC** per call, and get JSON — **no API keys or accounts**.

## Features

- **POST `/v1/option/price`** — fair value + delta/gamma/vega/theta/rho (risk, hedging, trading)
- **POST `/v1/volatility/surface`** — invert market premiums → IV grid + per-quote Greeks (multi-maturity underlyings)
- Settlement: **Base** / **Base Sepolia** / **Solana** mainnet & devnet (USDC, exact scheme)
- Configurable micropayments **$0.01–$0.10** per endpoint
- **Rich Bazaar discovery** (descriptions, tags, input/output schemas, examples)
- Machine-readable **service card** at `GET /` (capabilities, use cases, markets)
- **Idempotent** retries (`Idempotency-Key`), helmet/CORS/rate limits, Zod validation
- Simple **test client** (`npm run client`)

## Architecture

```
Agent / Client
    │  GET / (discover) → POST paid path → 402 → pay USDC → 200 JSON
    ▼
Express
  free:  GET /  ·  GET /health  ·  GET /.well-known/x402(.json)
  paid:  POST /v1/option/price
         POST /v1/volatility/surface   ← paymentMiddleware (@x402/express)
           │
           ├─ Zod validation
           ├─ Idempotency cache
           └─ BSM / IV surface services
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
| `PRICE_USD` | Single option `/v1/option/price` — `0.01`–`0.10` (default `0.05`) |
| `PRICE_VOL_SURFACE_USD` | Surface `/v1/volatility/surface` — `0.01`–`0.10` (default `0.10`) |
| `MAX_SURFACE_OPTIONS` | Max options per surface request (default `200`) |

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

curl -s -X POST http://localhost:4021/v1/volatility/surface \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.05,"dividendYield":0,"options":[{"underlying":100,"strike":90,"timeToExpiry":0.25,"optionType":"call","premium":12.5},{"underlying":102,"strike":100,"timeToExpiry":0.5,"optionType":"call","premium":8.7}]}' \
  -D -
# Expect HTTP 402 (default $0.10)
# Body explains payment_required; full terms are in the PAYMENT-REQUIRED header (base64).
# To exercise the compute path without USDC locally: SKIP_PAYMENT=1 npm run dev
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

**Primary discovery document** for agents: product pitch, capabilities, markets (equities / commodities / power / crypto), use cases, pricing, settlement networks, paid endpoint catalog with tags and agent hints, plus request/response examples.

### `GET /.well-known/x402` and `GET /.well-known/x402.json` (free)

Machine-readable **x402 discovery manifest** (same JSON for both paths):

- `x402Version`, `protocol`, service name/description
- `resources[]` — paid HTTP endpoints with absolute `url`, method, price, tags
- `settlement` — USDC, networks (CAIP-2), facilitator, payTo
- `links` — service card, health, well-known

Use these for crawlers/agents that look for a well-known x402 file. Prefer `/.well-known/x402.json` for explicit JSON content-type consumers; both return `application/json`.
### Pricing

| Endpoint | Env | Default |
|----------|-----|---------|
| `POST /v1/option/price` | `PRICE_USD` | `$0.05` |
| `POST /v1/volatility/surface` | `PRICE_VOL_SURFACE_USD` | `$0.10` |

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

### `POST /v1/volatility/surface` (paid · x402 exact · USDC · default `$0.10`)

Invert a book of market premiums into an implied-vol surface, per-option IV + Greeks, fit quality, and compute stats.

**Request** — shared `rate` / `dividendYield`; each option has its own `underlying` (can differ by maturity):

```json
{
  "rate": 0.05,
  "dividendYield": 0,
  "options": [
    { "underlying": 100, "strike": 90, "timeToExpiry": 0.25, "optionType": "call", "premium": 12.5 },
    { "underlying": 102, "strike": 100, "timeToExpiry": 0.5, "optionType": "call", "premium": 8.7 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `rate` | yes | Shared continuous risk-free rate \(r\) |
| `dividendYield` | no | Shared continuous yield \(q\) (default `0`) |
| `options` | yes | 1–`MAX_SURFACE_OPTIONS` rows |
| `options[].underlying` | yes | Underlying \(S > 0\) for this option (may differ by maturity) |
| `options[].strike` | yes | Strike \(K > 0\) |
| `options[].timeToExpiry` | yes | Years to expiry \(T \ge 0\) |
| `options[].optionType` | yes | `"call"` or `"put"` |
| `options[].premium` | yes | Market premium \(\ge 0\) |

**Response `200` (shape)**

- `surface.strikes` / `surface.maturities` — grid axes derived from inputs  
- `surface.impliedVols[i][j]` — IV at strike i, maturity j (`null` if empty)  
- `points[]` — per-option IV, Greeks, model price, error, status  
- `fit` — ok/failed counts and price-error metrics  
- `stats` — timing, option count, `solver: "fastImpliedVol"`  

IV inversion uses an internal black-box solver (`fastImpliedVol`); iteration details are not exposed.

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

## Bazaar discovery (agent catalog)

Metadata lives in **`src/discovery/catalog.ts`** and is applied in `src/x402/routeConfig.ts` via `declareDiscoveryExtension`.

| Layer | What agents get |
|-------|------------------|
| **Service** | Name, tagline, capabilities, markets, use cases (`GET /`) |
| **Route** | `serviceName`, `description` (≤500), `tags` (≤5), mimeType |
| **Bazaar extension** | Example input body, JSON Schema properties with finance-oriented descriptions, example output + schema |

### Paid tools

| Endpoint | Bazaar name | Agent value |
|----------|-------------|-------------|
| `POST /v1/option/price` | BSM Price+Greeks | Single-contract fair value + hedge ratios |
| `POST /v1/volatility/surface` | IV Surface Desk | Book → IV grid + Greeks for MM / risk |

### Indexing notes

- Unpaid POST to a paid path must return **HTTP 402** with `PAYMENT-REQUIRED` (and `extensions.bazaar`)
- Facilitator soft-limits: description ≤ **500** chars; `serviceName` ≤ **32**; ≤ **5** tags
- After a successful settle on a Bazaar-capable facilitator, resources can appear in discovery listings

### How agents should call

1. `GET /` — choose endpoint by capability / use case  
2. Unpaid POST — parse `PAYMENT-REQUIRED` (base64) for price, network, payTo, schemas  
3. Pay USDC via x402 client (`@x402/fetch` + EVM/SVM scheme)  
4. Retry with payment; optional `Idempotency-Key`

List resources (buyer side):

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions";

const client = withBazaar(
  new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! }),
);
const { items } = await client.extensions.bazaar.listResources({ type: "http" });
// Filter by tags/description: options, greeks, volatility, commodities, …
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
