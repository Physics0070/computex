# ComputeX

**Pay-Per-Compute GPU Marketplace** — submit a workload, get the right GPU picked for you, and pay only for that job with USDC on Algorand Testnet via [x402](https://x402.org).

> GPU execution is **simulated**. Payment is **real**: every completed job produces a genuine, verifiable Algorand Testnet transaction.

---

## What it does

1. You describe a workload — in a form or in plain English.
2. ComputeX scores every GPU in the marketplace on VRAM compatibility, price, execution time, reliability and availability, and recommends one.
3. You click **Pay & Run**.
4. The server replies **402 Payment Required** with a price derived from your workload.
5. The x402 client signs a USDC transfer, retries, the facilitator verifies and settles on Algorand Testnet.
6. The job runs (simulated) and you get the result plus the **real transaction ID**.

---

## Setup

**Prerequisites:** Node 20 or newer (verified on Node 25.9 / npm 11.12) and a terminal. No database, no Docker, no GPU required.

### 1. Install

From the repository root — this installs both packages:

```bash
npm run setup
```

Equivalent to installing each package by hand:

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Create Testnet accounts

```bash
cd computex/server
npm run keygen     # run twice: once for the payer (buyer), once for the payee (provider)
```

### 3. Configure

```bash
cd computex
cp .env.example .env
```

Fill in:

| Variable | Purpose |
| --- | --- |
| `PAYEE_ADDRESS` | GPU provider address — receives USDC |
| `PAYER_MNEMONIC` | Buyer's 25-word mnemonic (**server-side only**) |
| `PAYER_PRIVATE_KEY` | Alternative to the mnemonic: base64 64-byte secret key |
| `PAYEE_MNEMONIC` | Optional, only used by `npm run optin` |
| `X402_FACILITATOR_URL` | Defaults to `https://facilitator.goplausible.xyz` |
| `ALGORAND_NETWORK` | Leave blank — discovered from the facilitator at startup |
| `ALGOD_URL` / `INDEXER_URL` | Default to AlgoNode Testnet |
| `PORT`, `RESOURCE_BASE_URL`, `CORS_ORIGINS` | Local wiring |

`.env` is gitignored. The payer key never leaves the server.

### 4. Fund the Testnet accounts

Both the payer **and** the payee must be opted in to USDC (ASA `10458941`) — an Algorand account cannot send or receive an ASA before opting in.

This applies to the payee as much as the payer: the provider account cannot **receive** USDC until it has opted in, so skipping it fails at settlement, after the payment has already been signed.

Do these in order — an opt-in is itself a transaction, so an account with 0 ALGO cannot opt in.

1. **Test ALGO** for **both** addresses — <https://bank.testnet.algorand.network/> (~0.5 ALGO each covers fees and minimum balance).
2. **Opt both into USDC**:
   ```bash
   cd server && npm run optin
   ```
3. **Test USDC** for the payer — <https://faucet.circle.com/> (select *Algorand Testnet*).
4. **Verify** — this is the gate; do not move on until it passes:
   ```bash
   npm run check:payer     # exits 0 when the flow is ready to run
   ```

`check:payer` prints both balances and ends in one of two states:

```
READY — the x402 flow should work.          # good, continue
NOT READY — fix the items above.            # read the per-account lines
```

`ALGO: 0` means that account was never funded; `USDC: not opted in` means step 2 has not
taken effect for it. Both must be clear on **both** accounts.

Transaction fees are sponsored by the facilitator's fee payer, so the payer only needs enough ALGO for its minimum balance.

---

## Run

Two terminals, both from the repository root:

```bash
# terminal 1 — API
npm run dev:server     # http://localhost:4021

# terminal 2 — UI
npm run dev:client     # http://localhost:5173
```

Then open **<http://localhost:5173>**. The Vite dev server proxies `/api` to the backend, so the browser stays same-origin.

The server prints its resolved configuration on boot — the network line confirms it discovered
Algorand Testnet from the facilitator:

```
[x402] Algorand network: algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=
[x402] Facilitator:      https://facilitator.goplausible.xyz
[x402] Paying to:        <your PAYEE_ADDRESS>

  ComputeX server listening on http://localhost:4021
```

### Verify it is actually working

Two checks that need no funded account — they confirm the server and the payment gate are live:

```bash
curl http://localhost:4021/api/health

curl -i -X POST http://localhost:4021/api/compute \
  -H 'content-type: application/json' \
  -d '{"workload":"image-generation","model":"sdxl","images":5,"gpu":"rtx-4090"}'
```

Health returns `"paymentMode": "real"`. The second **must return `402 Payment Required`** with a
`PAYMENT-REQUIRED` header — that is the x402 gate refusing unpaid work, and it is the correct
result, not an error.

> On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest` and will not accept these
> flags. Use `curl.exe` explicitly, or run the commands from Git Bash / WSL.

Then run the full paid path end to end, which requires `check:payer` to have passed:

```bash
npm run test:flow      # 402 -> sign -> verify -> settle -> confirm tx via the indexer
```

---

## Demo path

1. Open <http://localhost:5173> → **Agent Mode**.
2. Type: `Generate 5 SDXL images under $0.20, prioritize balanced performance.`
3. **Interpret & Recommend** → shows the extracted requirements, each traced back to your words.
4. **RTX 4090** is recommended, with the full scored field beneath it.
5. **Pay & Run** → watch the x402 state machine:
   `402 Payment Required → Payment Signed → Payment Verified → GPU Job Running → Job Completed → Payment Settled`
6. The result panel shows **✓ Payment Settled**, the cost, the network, and the real transaction ID.
7. **View Transaction** opens the transaction on the Testnet explorer.
8. **Jobs** shows the run in history with a **View TX** link; **Providers** shows the revenue it earned.

---

## Deploy

The whole app ships as **one service**: the server serves the built frontend, so the browser calls `/api` on its own origin — no CORS, no proxy, one URL.

```bash
npm run build     # installs both packages and builds the client
npm start         # serves API + UI on $PORT (default 4021)
```

It must run as a **long-lived server**, not serverless: the job store, the stage event bus and the NDJSON progress stream are all in-process and do not survive per-request invocation.

### 1. Push to GitHub

```bash
cd computex
gh repo create computex --private --source=. --push
# or: git remote add origin git@github.com:<you>/computex.git && git push -u origin main
```

### 2. Pick a host

**Render** — `render.yaml` is a ready blueprint. *New → Blueprint*, point it at the repo, and it prompts for the secrets marked `sync: false`.

**Railway** — `railway.json` builds from the `Dockerfile`.
```bash
railway init && railway up
railway variables --set PAYEE_ADDRESS=... --set PAYER_MNEMONIC="..."
```

**Fly.io** — `fly.toml` is configured; keep `min_machines_running = 1`.
```bash
fly launch --no-deploy
fly secrets set PAYEE_ADDRESS=... PAYER_MNEMONIC="..."
fly deploy
```

**Any Docker host** —
```bash
docker build -t computex .
docker run -p 8080:8080 --env-file .env computex
```

### 3. Set environment variables on the host

Set `PAYEE_ADDRESS` and `PAYER_MNEMONIC` **as host secrets**, never in the repo. `PORT` is injected by the platform. Everything else has a working default.

### Protecting the shared payer

`/api/pay-and-compute` signs USDC with the server's own key, so on a public URL it is an open faucet on your testnet balance. Three guards apply, all tunable:

| Variable | Default | Effect |
| --- | --- | --- |
| `MAX_JOB_PRICE_USDC` | `0.50` | Refuses any single job quoting more |
| `RATE_LIMIT_MAX_JOBS` | `10` | Paid jobs per client per window |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Window length (15 min) |
| `DEMO_ACCESS_TOKEN` | unset | When set, requires it in the `x-computex-token` header |

Fund the deployed payer with only what the demo needs — a few USDC is plenty at these prices. These guards limit casual abuse; they are not an authentication boundary. `POST /api/compute` itself stays open by design: that is the x402 endpoint, and anyone paying it uses **their own** wallet.

---

## Testing

```bash
cd computex/server

npm run check:payer   # on-chain readiness: balances, USDC opt-in, facilitator support
npm run test:flow     # full golden path, ending with an indexer lookup of the tx id
npm run scenarios     # recommendation + Agent Mode parsing, no network
npm run simulate      # compute simulation and job store, no payment
```

`test:flow` asserts the whole chain: health → 402 → sign → retry → settle → transaction id → **confirmed on Algorand Testnet via the indexer**. It never trusts the server's word for the transaction id.

---

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Service + network status |
| `GET` | `/api/catalog` | Workloads, GPUs, priorities, known models |
| `GET` | `/api/providers` | Marketplace supply with live revenue |
| `GET` | `/api/stats` | Dashboard counters |
| `GET` | `/api/jobs` · `/api/jobs/:id` | Job history |
| `POST` | `/api/quote` | Free price preview |
| `POST` | `/api/recommend` | Deterministic GPU selection |
| `POST` | `/api/agent/parse` | Natural language → requirements → recommendation |
| `POST` | **`/api/compute`** | **x402-protected.** 402 until paid |
| `POST` | `/api/pay-and-compute` | Dev payer proxy; NDJSON progress stream |

### `POST /api/compute`

```jsonc
// request
{ "workload": "image-generation", "model": "sdxl", "images": 5, "gpu": "rtx-4090" }

// unpaid -> 402, with payment requirements in the PAYMENT-REQUIRED header
// paid   -> 200
{
  "success": true,
  "jobId": "job_...",
  "result": { "simulated": true, "artifacts": [...], "metrics": {...} },
  "payment": {
    "status": "settled",
    "transactionId": "<real Algorand Testnet tx id>",
    "network": "Algorand Testnet",
    "explorerUrl": "https://lora.algokit.io/testnet/transaction/..."
  }
}
```

---

## How the payment works

- **Scheme**: `exact` on `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` (Testnet), USDC ASA `10458941`.
- **Payload**: a 2-transaction atomic group — a sponsored fee-payer transaction from the facilitator, plus the client's signed ASA transfer.
- **Flow**: `authorization` — the facilitator verifies *before* the handler runs and settles *after* it succeeds. If the job fails, the verified payment is cancelled rather than settled.
- **Transaction id**: only exists after settlement, so it arrives on the `PAYMENT-RESPONSE` header. `injectSettlementIntoBody` folds it into the JSON body and the job record. It is never generated locally.

### Layout

```
computex/
├─ .env.example
├─ server/
│  ├─ src/
│  │  ├─ index.ts          Hono app, routes, dev payer proxy
│  │  ├─ x402-server.ts     x402 wiring, dynamic pricing, settlement capture
│  │  ├─ payer.ts           x402 client (holds the key, server-side only)
│  │  ├─ providers.ts       GPU marketplace catalog
│  │  ├─ pricing.ts         Pay-per-compute pricing model
│  │  ├─ recommend.ts       Deterministic GPU scoring
│  │  ├─ agent.ts           Natural-language intent parser
│  │  ├─ compute.ts         Simulated GPU execution + job store
│  │  ├─ bus.ts             In-process stage streaming
│  │  └─ env.ts             Configuration
│  └─ scripts/              keygen, optin, check-payer, test-flow, dev helpers
└─ client/
   └─ src/
      ├─ App.tsx            Console shell + navigation
      ├─ api.ts             API client + NDJSON stream reader
      ├─ components/        RunFlow (payment state machine), GPU cards
      └─ views/             Marketplace, NewJob, Jobs, Providers, AgentMode
```

---

## Prototype boundaries

- GPU execution, provider fleets, availability and historical revenue are **mock**. Everything produced by a job is tagged `simulated: true`.
- The payer runs server-side so the browser never holds a key. In production this belongs in the user's wallet — swap `toClientAvmSigner` for a wallet-backed `ClientAvmSigner` and `payer.ts` is otherwise unchanged.
- Jobs live in memory and reset when the server restarts.
- **Payments, settlement and transaction IDs are real** and verifiable on Algorand Testnet.
