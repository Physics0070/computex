/**
 * End-to-end test of the x402 golden path.
 *
 *   1. GET  /api/health                          -> 200
 *   2. POST /api/compute with no payment         -> 402 + payment requirements
 *   3. x402 client signs USDC and retries        -> 200
 *   4. Response carries a transaction id
 *   5. That transaction id is confirmed on Algorand Testnet via the indexer
 *
 * Step 5 is the one that matters: it proves the id is a real settled transaction
 * and not something the server invented.
 *
 * Usage: npm run test:flow            (server must already be running)
 */
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { env, explorerTxUrl } from "../src/env.js";
import { createPayer } from "../src/payer.js";
import { discoverAlgorandTestnetNetwork } from "../src/x402-server.js";

const BASE = env.resourceBaseUrl;
const WORKLOAD = {
  workload: "image-generation",
  model: "sdxl",
  images: 5,
  gpu: "rtx-4090",
};

let failures = 0;
const pass = (label: string, detail = "") =>
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label: string, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`\n  ComputeX x402 golden-path test`);
console.log(`  target: ${BASE}\n`);

/* 1 — health ------------------------------------------------------- */
try {
  const res = await fetch(new URL("/api/health", BASE));
  const body = (await res.json()) as Record<string, unknown>;
  if (res.ok && body.status === "ok") {
    pass("GET /api/health", `network ${body.networkId}`);
  } else {
    fail("GET /api/health", `status ${res.status}`);
  }
} catch (error) {
  fail("GET /api/health", (error as Error).message);
  console.log("\n  Is the server running? `npm run dev` in computex/server\n");
  process.exit(1);
}

/* 2 — unpaid request must be rejected with 402 ---------------------- */
let quotedAmount = "";
try {
  const res = await fetch(new URL("/api/compute", BASE), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(WORKLOAD),
  });
  // In x402 v2 the payment requirements travel in the PAYMENT-REQUIRED header;
  // the body is whatever the route's `unpaidResponseBody` produced.
  const header = res.headers.get("payment-required") ?? res.headers.get("x-payment-required");
  const required = header ? decodePaymentRequiredHeader(header) : undefined;
  const accept = required?.accepts?.[0];
  if (res.status === 402 && accept) {
    quotedAmount = accept.amount;
    pass(
      "POST /api/compute (unpaid) -> 402",
      `${Number(accept.amount) / 1e6} USDC, asset ${accept.asset}`,
    );
  } else {
    fail("POST /api/compute (unpaid) -> 402", `got ${res.status}`);
  }
} catch (error) {
  fail("POST /api/compute (unpaid) -> 402", (error as Error).message);
}

/* 3 & 4 — pay, retry, real transaction id --------------------------- */
const network = await discoverAlgorandTestnetNetwork();
const payer = createPayer(network, (event) => {
  console.log(`        [${event.type}] ${event.message}`);
});
console.log(`  payer:  ${payer.address}\n`);

let transactionId = "";
try {
  const res = await payer.fetchWithPayment(new URL("/api/compute", BASE), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(WORKLOAD),
  });
  const body = (await res.json()) as {
    success?: boolean;
    jobId?: string;
    result?: unknown;
    payment?: { status?: string; transactionId?: string; network?: string };
  };

  if (res.ok && body.success) {
    pass("x402 payment + retry -> 200", `job ${body.jobId}`);
  } else {
    fail("x402 payment + retry -> 200", `status ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }

  if (body.result) pass("response contains compute result");
  else fail("response contains compute result");

  transactionId = body.payment?.transactionId ?? "";
  if (body.payment?.status === "settled" && transactionId) {
    pass("payment settled", transactionId);
  } else {
    fail("payment settled", JSON.stringify(body.payment));
  }
} catch (error) {
  fail("x402 payment + retry", (error as Error).message);
}

/* 5 — the transaction id exists on chain ---------------------------- */
if (transactionId) {
  let confirmed = false;
  for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(new URL(`/v2/transactions/${transactionId}`, env.indexerUrl));
      if (!res.ok) continue;
      const body = (await res.json()) as {
        transaction?: {
          "confirmed-round"?: number;
          "asset-transfer-transaction"?: { amount: number; "asset-id": number; receiver: string };
        };
      };
      const txn = body.transaction;
      if (txn?.["confirmed-round"]) {
        confirmed = true;
        const transfer = txn["asset-transfer-transaction"];
        pass(
          "transaction confirmed on Algorand Testnet",
          `round ${txn["confirmed-round"]}` +
            (transfer
              ? `, ${transfer.amount / 1e6} USDC (ASA ${transfer["asset-id"]}) -> ${transfer.receiver}`
              : ""),
        );
        if (transfer && quotedAmount && String(transfer.amount) !== quotedAmount) {
          fail("settled amount matches quote", `quoted ${quotedAmount}, settled ${transfer.amount}`);
        } else if (transfer) {
          pass("settled amount matches quote", `${Number(quotedAmount) / 1e6} USDC`);
        }
      }
    } catch {
      // Indexer lags behind the node by a round or two; keep polling.
    }
  }
  if (!confirmed) {
    fail(
      "transaction confirmed on Algorand Testnet",
      "indexer did not return it within 20s (it may still be propagating)",
    );
  }
  console.log(`\n  explorer: ${explorerTxUrl(transactionId)}`);
}

console.log(`\n  ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
