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

### 1. Install

```bash
cd computex/server && npm install
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

1. **Test ALGO** for both addresses — <https://bank.testnet.algorand.network/> (~0.5 ALGO each covers fees and minimum balance).
2. **Opt both into USDC**:
   ```bash
   cd computex/server && npm run optin
   ```
3. **Test USDC** for the payer — <https://faucet.circle.com/> (select *Algorand Testnet*).
4. **Verify**:
   ```bash
   npm run check:payer     # exits 0 when the flow is ready to run
   ```

Transaction fees are sponsored by the facilitator's fee payer, so the payer only needs enough ALGO for its minimum balance.

---

## Run

```bash
# terminal 1
cd computex/server && npm run dev      # http://localhost:4021

# terminal 2
cd computex/client && npm run dev      # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so the browser stays same-origin.

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
