# x402 Derivatives Analytics Desk

Production **HTTP 402 (x402)** quant API for **AI agents** in equities, commodities, power/energy, and crypto: European **Black-Scholes-Merton** pricing, full **Greeks**, single-premium **IV**, **IV surfaces**, **price/scenario on a submitted smile**, **portfolio net Greeks**, and **scenario reprice**. TypeScript + Express + `@x402/*`.

Agents discover capabilities via **Bazaar** metadata and `GET /`, pay **USDC** per call, and get JSON — **no API keys or accounts**.

## Features

- **POST `/v1/option/price`** — fair value + delta/gamma/vega/theta/rho (risk, hedging, trading)
- **POST `/v1/option/implied-vol`** — solve σ̂ from one market premium + full Greeks (`fastImpliedVol`)
- **POST `/v1/volatility/surface`** — invert market premiums → IV grid + per-quote Greeks (multi-maturity underlyings; power/commodity marks)
- **POST `/v1/option/price-from-surface`** — price options on a submitted IV surface (TV bilinear in \(k,T\))
- **POST `/v1/option/scenario-from-surface`** — book reval on the same surface with sticky smile shocks
- **POST `/v1/portfolio/greeks`** — net MTM + Greeks for multi-leg books (long/short via signed quantity)
- **POST `/v1/portfolio/scenario`** — base + shocked MTM/Greeks under spot/vol/time scenarios (scalar σ per leg)
- **GET|POST `/v1/demo/option-price`** — **free** fixed ATM sample (live engine, constant inputs) for discovery indexes
- **POST `/mcp`** — **MCP Streamable HTTP** façade (one paid tool per HTTP route + free `service_info`)
- Settlement: **Solana mainnet (PayAI) + Base mainnet (CDP when keys set)** dual USDC (exact); also Base Sepolia / Solana Devnet for test
- 402 challenges list **one accept per network** — clients pay on Solana **or** Base
- Configurable micropayments **$0.01–$1.00** per endpoint
- **Rich Bazaar discovery** (descriptions, tags, input/output schemas, examples, agent when-to-use copy)
- Machine-readable **service card** at `GET /` and **`/llms.txt`** for agents
- **Idempotent** retries (`Idempotency-Key`), helmet/CORS/rate limits, Zod validation
- Simple **test client** (`npm run client`)

## Architecture

```
Agent / Client
    │  GET / (discover) → POST paid path → 402 → pay USDC → 200 JSON
    ▼
Express
  free:  GET /  ·  GET /health  ·  GET /openapi.json  ·  GET /llms.txt
         GET /.well-known/x402(.json)
         GET|POST /v1/demo/option-price   (fixed sample)
         POST /mcp                        (MCP Streamable HTTP)
  paid:  POST /v1/option/price            (+ optional FREE_TIER_N)
         POST /v1/option/implied-vol
         POST /v1/volatility/surface
         POST /v1/option/price-from-surface
         POST /v1/option/scenario-from-surface
         POST /v1/portfolio/greeks
         POST /v1/portfolio/scenario   ← paymentMiddleware (@x402/express)
           │
           ├─ Zod validation
           ├─ Idempotency cache
           └─ BSM / IV / surface / portfolio services  ← also used by MCP tools
                    │
                    ▼
         PayAI HTTPFacilitatorClient → FACILITATOR_URL
         CDP createCdpFacilitatorClient → api.cdp.coinbase.com (Base only)
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
| `PAY_TO_ADDRESS` | Primary receiving wallet: EVM `0x…` **or** Solana base58 (public only) |
| `PAY_TO_EVM_ADDRESS` | Base/EVM receiver when dual-chain (e.g. `0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f`) |
| `PAY_TO_SVM_ADDRESS` | Explicit Solana receiver when dual-chain |
| `NETWORKS` | Comma-separated: `solana,base` (prod dual) \| `base-sepolia` \| `solana-devnet` \| … |
| `FACILITATOR_URL` | PayAI only (default `https://facilitator.payai.network`) — never the CDP API URL |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Base via CDP; both required. Missing/401 → still listen on Solana |
| `CDP_WALLET_SECRET` | Optional; unused when `PAY_TO_EVM_ADDRESS` is an EOA |
| `PRICE_USD` | Single option `/v1/option/price` — `0.01`–`1.00` (default `0.05`) |
| `PRICE_IMPLIED_VOL_USD` | IV solve `/v1/option/implied-vol` — default `0.03` |
| `PRICE_VOL_SURFACE_USD` | Invert premiums `/v1/volatility/surface` — default `0.10` |
| `PRICE_OPTION_FROM_SURFACE_USD` | Price on smile `/v1/option/price-from-surface` — default `0.08` |
| `PRICE_SCENARIO_FROM_SURFACE_USD` | Surface scenario `/v1/option/scenario-from-surface` — default `0.15` |
| `PRICE_PORTFOLIO_GREEKS_USD` | Portfolio Greeks `/v1/portfolio/greeks` — default `0.15` |
| `PRICE_PORTFOLIO_SCENARIO_USD` | Scalar-σ scenarios `/v1/portfolio/scenario` — default `0.25` |
| `MAX_SURFACE_OPTIONS` | Max options per invert-surface request (default `200`) |
| `MAX_SURFACE_POINTS` | Max \((k,T,\mathrm{iv})\) points on pricing surfaces (default `200`) |
| `MAX_SURFACE_PRICE_OPTIONS` | Max options/legs on price/scenario-from-surface (default `50`) |
| `MAX_PORTFOLIO_POSITIONS` | Max legs per portfolio request (default `100`) |
| `MAX_SCENARIOS` | Max scenarios per scenario request (default `20`) |
| `FREE_DEMO_ENABLED` | Fixed free sample at `/v1/demo/option-price` (default on) |
| `FREE_DEMO_RATE_MAX` | Rate limit for free demo (default `30` / window) |
| `FREE_TIER_N` | First-N free on `POST /v1/option/price` only (`0` = off) |
| `FREE_TIER_WINDOW_MS` | Window for free tier (default 24h) |
| `MCP_ENABLED` | Streamable HTTP MCP at `MCP_PATH` (default on) |
| `MCP_PATH` | MCP path (default `/mcp`) |

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

# New endpoints (also 402 when unpaid):
# POST /v1/option/implied-vol   ($0.03)
# POST /v1/portfolio/greeks     ($0.15)
# POST /v1/portfolio/scenario   ($0.25)
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

### `GET /openapi.json` (free)

Full **OpenAPI 3.1** document (`Content-Type: application/json`). Same file as repo-root `openapi.json`. Listed in service card free endpoints and well-known `links.openapi`.

### `GET /llms.txt` (free)

Concise **Markdown** summary for AI agents ([llms.txt](https://llmstxt.org) convention): English capability summary, price list, free demo, MCP URL, dual Solana/Base settlement. `Content-Type: text/plain; charset=utf-8`.

### `GET|POST /v1/demo/option-price` (free)

**Fixed** ATM European call (`S=K=100`, `T=1`, `r=0.05`, `σ=0.2`) priced with the **live** BSM engine. Body is ignored on POST. No wallet. Rate-limited (`FREE_DEMO_RATE_MAX`). Intended for Bazaar/index seeding and smoke checks — **not** a free custom pricer.

### Free-tier seeding (optional)

| Mechanism | Default | Behavior |
|-----------|---------|----------|
| Free demo route | **On** | Fixed sample only; abuse-resistant |
| `FREE_TIER_N` | **0 (off)** | First N unpaid `POST /v1/option/price` per IP per window skip payment (`X-Free-Tier-Remaining` header). In-memory per process. |

Paid routes are **never** permanently free. Surface/portfolio always require payment when the gate is on.

### MCP server (additive façade)

Stateless **Streamable HTTP** at `POST /mcp` (path overridable via `MCP_PATH`).

| Tool | Payment | Maps to |
|------|---------|---------|
| MCP tool | Price env | HTTP twin |
|----------|-----------|-----------|
| `service_info` | free | discovery snapshot |
| `price_option` | `PRICE_USD` | `POST /v1/option/price` |
| `implied_vol` | `PRICE_IMPLIED_VOL_USD` | `POST /v1/option/implied-vol` |
| `implied_vol_surface` | `PRICE_VOL_SURFACE_USD` | `POST /v1/volatility/surface` |
| `price_from_surface` | `PRICE_OPTION_FROM_SURFACE_USD` | `POST /v1/option/price-from-surface` |
| `scenario_from_surface` | `PRICE_SCENARIO_FROM_SURFACE_USD` | `POST /v1/option/scenario-from-surface` |
| `portfolio_greeks` | `PRICE_PORTFOLIO_GREEKS_USD` | `POST /v1/portfolio/greeks` |
| `portfolio_scenario` | `PRICE_PORTFOLIO_SCENARIO_USD` | `POST /v1/portfolio/scenario` |

HTTP x402 routes remain the source of truth; MCP calls the same TypeScript services (no HTTP self-loop). Payment uses `@x402/mcp` `createPaymentWrapper` with the same Solana/Base accepts as HTTP. Bad `Accept` on `POST /mcp` → **406** JSON-RPC hint (retry with `application/json, text/event-stream`).

**Cursor / Claude-compatible remote config (example):**

```json
{
  "mcpServers": {
    "derivatives-pricer": {
      "url": "https://YOUR_APP.up.railway.app/mcp"
    }
  }
}
```

Hosts that only support stdio may need a local bridge. Agents with wallets can use `@x402/mcp` client helpers for auto-payment on tool calls.

Discovery/free operations are marked with `"security": []` in OpenAPI so x402 scanners do not expect HTTP 402 on discovery paths. Paid `/v1/*` operations declare the `x402` security scheme.

*(Optional later: favicon at `/favicon.ico` for browsers that probe it — not required for agents.)*

### `GET /.well-known/x402` and `GET /.well-known/x402.json` (free)

Machine-readable **x402 discovery manifest** (same JSON for both paths):

- `x402Version`, `protocol`, service name/description
- `resources[]` — paid HTTP endpoints with absolute `url`, method, price, tags
- `settlement` — USDC, networks (CAIP-2), facilitator, payTo
- `links` — service card, health, well-known, openapi

Use these for crawlers/agents that look for a well-known x402 file. Prefer `/.well-known/x402.json` for explicit JSON content-type consumers; both return `application/json`.
### Pricing

| Endpoint | Env | Default |
|----------|-----|---------|
| `POST /v1/option/price` | `PRICE_USD` | `$0.05` |
| `POST /v1/option/implied-vol` | `PRICE_IMPLIED_VOL_USD` | `$0.03` |
| `POST /v1/volatility/surface` | `PRICE_VOL_SURFACE_USD` | `$0.10` |
| `POST /v1/option/price-from-surface` | `PRICE_OPTION_FROM_SURFACE_USD` | `$0.08` |
| `POST /v1/option/scenario-from-surface` | `PRICE_SCENARIO_FROM_SURFACE_USD` | `$0.15` |
| `POST /v1/portfolio/greeks` | `PRICE_PORTFOLIO_GREEKS_USD` | `$0.15` |
| `POST /v1/portfolio/scenario` | `PRICE_PORTFOLIO_SCENARIO_USD` | `$0.25` |

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

### `POST /v1/option/price-from-surface` (paid · x402 exact · USDC · default `$0.08`)

Price one or more European options on a **submitted** IV surface. Does **not** change scalar `/v1/option/price`.

**Conventions (v1)**

| Field | Value | Notes |
|-------|--------|--------|
| `surfaceConvention` | `log_moneyness_forward` | only supported value |
| \(k\) | \(\ln(K/F)\) | \(F\) = that option’s `underlying` (forward or spot-as-forward) |
| `interpolation` | `total_variance_bilinear` | interpolate \(w=\sigma^2 T\) in \((k,T)\) |
| `wingRule` | `flat_vol` | clamp to edge vol; **no** wing model invented |
| Caps | `MAX_SURFACE_POINTS` (200), `MAX_SURFACE_PRICE_OPTIONS` (50) | reject oversized grids/books |

Surface points: unique `{k, timeToExpiry, iv}` **or** `{strike, underlying, timeToExpiry, iv}` (converted server-side). Duplicate \((k,T)\) → **400**. Soft warnings for calendar/butterfly issues; the grid is **not** repaired. No Dupire / SABR / local vol.

**Request (equity-like 3×3 smile)**

```json
{
  "surfaceConvention": "log_moneyness_forward",
  "interpolation": "total_variance_bilinear",
  "wingRule": "flat_vol",
  "rate": 0.05,
  "dividendYield": 0,
  "surface": [
    { "k": -0.1, "timeToExpiry": 0.25, "iv": 0.22 },
    { "k": 0, "timeToExpiry": 0.25, "iv": 0.2 },
    { "k": 0.1, "timeToExpiry": 0.25, "iv": 0.23 },
    { "k": -0.1, "timeToExpiry": 0.5, "iv": 0.21 },
    { "k": 0, "timeToExpiry": 0.5, "iv": 0.2 },
    { "k": 0.1, "timeToExpiry": 0.5, "iv": 0.22 },
    { "k": -0.1, "timeToExpiry": 1, "iv": 0.205 },
    { "k": 0, "timeToExpiry": 1, "iv": 0.2 },
    { "k": 0.1, "timeToExpiry": 1, "iv": 0.215 }
  ],
  "options": [
    { "underlying": 100, "strike": 100, "timeToExpiry": 1, "optionType": "call", "quantity": 1 }
  ]
}
```

**Response `200` (shape)** — per option: `price`, `impliedVol` (interpolated), `k`, `forward`, BS `greeks`; plus `book`, `units`, `surfaceMeta`, `warnings`, `requestId`.

ATM on a flat smile matches scalar BSM `/v1/option/price` at the same σ.

### `POST /v1/option/scenario-from-surface` (paid · x402 exact · USDC · default `$0.15`)

Book revaluation: **base vs scenario** on the same interpolator. Prefer this when you have a smile; keep `/v1/portfolio/scenario` for per-leg **scalar** σ books.

**Sticky (after \(F \to F'\))**

| `sticky` | Surface read |
|----------|----------------|
| `moneyness` (default) | \(k' = \ln(K/F')\) |
| `strike` | old \(k = \ln(K/F_{\mathrm{base}})\) |
| `fixed_vol` | σ from base \(k\) (ignore moneyness move; still apply volAbs/volRel/twist) |

**Scenario object** (all optional, default `0`)

| Field | Effect |
|-------|--------|
| `underlyingRel` XOR `underlyingAbs` | Same relative/absolute shock on every leg’s underlying (**400** if both set) |
| `rateBp` | Rate shock in basis points |
| `timeDays` | Roll each \(T\) by `timeDays/365`, then interpolate ( \(T\) floored at a small epsilon) |
| `volAbs` | Add to interpolated σ |
| `volRel` | Multiply after volAbs |
| `smileTwist` | Extra tilt vs \(k\): \(\sigma_{\mathrm{used}} += \mathrm{smileTwist} \cdot k\) (vol points per unit log-moneyness) |

**Vol transform order:** interpolate → `volAbs` → `volRel` → `smileTwist * k`.

**Response `200` (shape)** — per leg and book totals: `valueBase`, `valueScenario`, `deltaValue`, σ / \(k\) / \(F\) base vs scenario, sticky-σ Greeks (**not** full smile-recalibrated bump deltas), scenario echo, warnings (wing clamp, tenor extrapolate, T clipped, …).

### `POST /v1/option/implied-vol` (paid · x402 exact · USDC · default `$0.03`)

Solve implied volatility from a **single** market premium, then return full analytic Greeks at the solved σ. Reuses the same `fastImpliedVol` engine as the surface endpoint.

**Request**

```json
{
  "underlying": 100,
  "strike": 100,
  "timeToExpiry": 1,
  "rate": 0.05,
  "dividendYield": 0,
  "optionType": "call",
  "premium": 10.45057562
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `underlying` | yes | Underlying \(S > 0\) |
| `strike` | yes | Strike \(K > 0\) |
| `timeToExpiry` | yes | Years to expiry \(T \ge 0\) |
| `rate` | yes | Continuous risk-free rate \(r\) |
| `optionType` | yes | `"call"` or `"put"` |
| `premium` | yes | Market premium \(\ge 0\) |
| `dividendYield` | no | Continuous yield \(q\) (default `0`) |

**Response `200` (shape)** — `impliedVol`, `greeks`, `modelPrice`, `priceError`, `iterations`, `converged`, `requestId`, `computedAt`.

Non-convergent or out-of-bounds premiums return **422** `iv_solve_failed`.

### `POST /v1/portfolio/greeks` (paid · x402 exact · USDC · default `$0.15`)

Net MTM and Greeks for multi-leg European books. `quantity > 0` = long, `quantity < 0` = short.

**Request**

```json
{
  "rate": 0.05,
  "dividendYield": 0,
  "includeDollarGreeks": true,
  "positions": [
    {
      "underlying": 100,
      "strike": 100,
      "timeToExpiry": 1,
      "optionType": "call",
      "quantity": 10,
      "volatility": 0.2
    },
    {
      "underlying": 100,
      "strike": 110,
      "timeToExpiry": 1,
      "optionType": "put",
      "quantity": -5,
      "volatility": 0.22
    }
  ]
}
```

**Response `200` (shape)** — `net.mtm`, `net.greeks`, optional `net.dollarGreeks`, `legs[]`, `positionCount`, `requestId`, `computedAt`.

### `POST /v1/portfolio/scenario` (paid · x402 exact · USDC · default `$0.25`)

Base portfolio MTM + Greeks, then reprice under relative shocks:

- `spotShock` — relative; `newS = S * (1 + spotShock)`
- `volShock` — relative; `newσ = σ * (1 + volShock)`
- `timeDecayDays` — calendar days; `T` reduced by `days/365`

Works for single-option and multi-leg portfolios.

**Response `200` (shape)** — `base`, `scenarios[]` (each with `mtm`, `mtmChange`, `greeks`, `shocks`), `positionCount`, `scenarioCount`.

### Performance notes

- Single-option price/IV: sub-millisecond pure math (no I/O)
- Portfolio Greeks: O(n) BSM evaluations over positions (default max 100)
- Scenarios: O(n × m) reprice over positions × scenarios (defaults 100 × 20)
- Invert surface: O(k) IV solves over market quotes (default max 200)
- Price/scenario-from-surface: O(points + options) grid build + bilinear lookups (caps 200 / 50)

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

### Solana + Base mainnet (recommended production)

**Dual facilitators (pjm-nowcast parity):**

| Chain | Facilitator | Env |
|-------|-------------|-----|
| Solana mainnet | **PayAI** | `FACILITATOR_URL=https://facilitator.payai.network` |
| Base mainnet | **Coinbase CDP** (preferred) | `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` |
| Base (fallback) | PayAI if CDP unset | — |

```bash
NETWORKS=solana,base
PAY_TO_ADDRESS=YourSolanaBase58Address
PAY_TO_SVM_ADDRESS=YourSolanaBase58Address
PAY_TO_EVM_ADDRESS=0xYourBaseReceiveAddress
FACILITATOR_URL=https://facilitator.payai.network
CDP_API_KEY_ID=...          # Railway secret
CDP_API_KEY_SECRET=...      # Railway secret
```

Same logical prices on both networks (e.g. option `$0.01`, surface `$0.10`). Base 402 accepts use USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` with EIP-712 `extra: { name: "USD Coin", version: "2" }` (via `@x402/evm` ExactEvmScheme).

**Wallet hygiene:** receive addresses (`payTo`) appear **only** in HTTP **402** `PAYMENT-REQUIRED`. Free routes (`/health`, `/`, well-known, OpenAPI, llms.txt, demo) never echo wallets.

Single-chain mainnet still works:

```bash
NETWORKS=solana
PAY_TO_ADDRESS=YourSolanaBase58Address
# or NETWORKS=base + PAY_TO_EVM_ADDRESS=0x...
```

### CDP facilitator (second rail — not `FACILITATOR_URL`)

Base uses a **separate** CDP-authenticated client (`createCdpFacilitatorClient({ apiKeyId, apiKeySecret })`). Do **not** point `FACILITATOR_URL` at `api.cdp.coinbase.com`, and do **not** send CDP JWTs to PayAI.

```bash
NETWORKS=solana,base
FACILITATOR_URL=https://facilitator.payai.network   # PayAI / Solana
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
# CDP_WALLET_SECRET=   # optional; unused when payTo is an EOA
```

When CDP keys are set, facilitators are registered **CDP first** (scoped to `eip155:8453` via `createCdpFacilitatorClient`), then **PayAI** (Solana-only) — same order as pjm-nowcast. Base verify/settle use CDP JWT; Base never hits PayAI. CDP `getSupported` is **warn-only** (401 never drops Base).

`GET /health` reports `facilitators: { payai, cdp: { enabled, lastProbe }, base, solana }` (names only, never secrets). `cdp.enabled` stays true when keys are set even if `lastProbe` is `401`.

## Bazaar discovery checklist

Metadata lives in **`src/discovery/catalog.ts`** and is applied in `src/x402/routeConfig.ts` via `declareDiscoveryExtension`.

- [x] Paid routes: description ≤500 chars, serviceName ≤32, tags ≤5  
- [x] Bazaar input/output schemas + concrete examples (equity ATM + power-style notes)  
- [x] Agent when-to-use copy (price vs IV vs surface vs portfolio)  
- [x] `GET /` service card + `GET /llms.txt` English capability summary + price list  
- [x] Free demo `GET /v1/demo/option-price` for non-wallet 200 samples  
- [x] OpenAPI free paths with `"security": []`  
- [x] Dual Solana + Base USDC accepts on paid routes  
- [x] MCP tools discoverable via service card `mcp` field + `/llms.txt`  

| Layer | What agents get |
|-------|------------------|
| **Service** | Name, tagline, capabilities, markets, use cases (`GET /`) |
| **Route** | `serviceName`, `description` (≤500), `tags` (≤5), mimeType |
| **Bazaar extension** | Example input body, JSON Schema properties with finance-oriented descriptions, example output + schema |

### Paid tools

| Endpoint | Bazaar name | Agent value |
|----------|-------------|-------------|
| `POST /v1/option/price` | BSM Price+Greeks | Single-contract fair value + hedge ratios |
| `POST /v1/option/implied-vol` | Single IV Solver | One premium → σ̂ + Greeks |
| `POST /v1/volatility/surface` | IV Surface Desk | Book → IV grid + Greeks for MM / risk |
| `POST /v1/option/price-from-surface` | Price From Surface | Price on a submitted smile (TV bilinear) |
| `POST /v1/option/scenario-from-surface` | Surface Scenarios | Sticky smile book reval + shocks |
| `POST /v1/portfolio/greeks` | Portfolio Net Greeks | Multi-leg net MTM + Greeks |
| `POST /v1/portfolio/scenario` | Portfolio Scenarios | What-if P&L under scalar spot/vol/time |

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
  services/
    blackScholes.ts            # pure BSM pricing + Greeks
    fastImpliedVol.ts          # black-box IV solver
    impliedVol.ts              # single-premium IV endpoint
    portfolio.ts               # net Greeks + scenarios
    volatilitySurface.ts       # IV surface builder
  routes/                      # free + paid handlers
  schemas/                     # Zod + JSON Schema examples
  discovery/catalog.ts         # Bazaar + service card metadata
  x402/                        # facilitator, resource server, route config
  middleware/                  # security, errors, idempotency
clients/test-client.ts
tests/
openapi.json · PAY.md
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
| `NETWORKS` | `solana,base` | Dual USDC mainnet (or single chain) |
| `PAY_TO_ADDRESS` | Solana base58 | **Public only** — primary / SVM receiver |
| `PAY_TO_EVM_ADDRESS` | `0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f` | Base mainnet receiver |
| `PAY_TO_SVM_ADDRESS` | same as Solana | Optional explicit SVM receiver |
| `PRICE_USD` | `0.01` | Between `0.01` and `1.00` |
| `PRICE_IMPLIED_VOL_USD` | `0.03` | Optional override |
| `PRICE_PORTFOLIO_GREEKS_USD` | `0.15` | Optional override |
| `PRICE_PORTFOLIO_SCENARIO_USD` | `0.25` | Optional override |
| `FACILITATOR_URL` | `https://facilitator.payai.network` | PayAI only — never the CDP API host |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | (Railway secrets) | Enables Base via CDP; Solana stays on PayAI |
| `PUBLIC_BASE_URL` | `https://your-app.up.railway.app` | Set after first deploy / custom domain |
| `CORS_ORIGIN` | your frontend origin(s) | Avoid `*` in production |

**Do not set on Railway:** `SVM_PRIVATE_KEY`, `EVM_PRIVATE_KEY`, or any buyer/signing key.

`PORT` is injected by Railway — leave it unset.

### 3. Generate a public domain

Railway → **Settings** → **Networking** → **Generate domain** (or attach a custom domain).  
Then set `PUBLIC_BASE_URL` to that `https://…` URL and redeploy if needed.

### 4. Smoke-check production

```bash
BASE=https://YOUR_APP.up.railway.app

curl -sS $BASE/health | jq .
# Expect: networks, facilitators.{payai,cdp,base,solana} — NO payTo / receive wallets

curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/favicon.ico
# Expect: 200

curl -sS $BASE/v1/demo/option-price | jq '.price,.demo'
# Expect: 200, demo=true

curl -sS -D - -o /dev/null -X POST $BASE/v1/option/price \
  -H 'Content-Type: application/json' -d '{}'
# Expect: 402 + PAYMENT-REQUIRED
# Decode header (base64 JSON): Base accept has asset 0x8335…, extra.name/version;
# Solana accept present when NETWORKS includes solana; payTo only here.

# Optional paid: npm run client with funded EVM and/or SVM key
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
  -e NETWORKS=solana,base \
  -e PAY_TO_ADDRESS=YourSolanaBase58Address \
  -e PAY_TO_EVM_ADDRESS=0x34cfb8bdbf16e4484b7da0ed31deed5771b16c8f \
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
- [ ] Two facilitators: PayAI URL for Solana; CDP keys for Base (not one CDP URL)  
- [ ] Unpaid `POST /v1/option/price` returns **402** with accepts for every enabled network  
- [ ] `GET /health` shows `facilitators.{payai,cdp,base,solana}` — no wallets on free routes  

Node **20+** required (image uses **22**).

## License

MIT
