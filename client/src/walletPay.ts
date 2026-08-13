/**
 * The x402 flow, run in the browser against the user's own wallet.
 *
 * This is the same protocol dance src/payer.ts performs server-side, moved to
 * where it belongs in a real product: the buyer holds the key, the server never
 * sees it, and /api/compute is called directly rather than through a proxy that
 * spends someone else's balance.
 *
 * Two details make it work:
 *
 *   1. The events emitted here deliberately match the server payer's shapes, so
 *      the payment panel renders both paths with one implementation.
 *   2. Job stages cannot ride on the /api/compute response — the x402 middleware
 *      buffers that body so it can settle afterwards. The browser therefore
 *      opens GET /api/trace/:id first and passes the same id on the POST, which
 *      is what keeps the state machine animating live.
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import type { ClientAvmSigner } from "@x402/avm";
import type { Network } from "@x402/core/types";
import { api, apiUrl } from "./api";
import type { ComputeResponse, PayerEvent } from "./types";

/** Must match TRACE_HEADER in the server's src/bus.ts. */
const TRACE_HEADER = "x-computex-trace";

const explorerAccountUrl = (address: string) =>
  `https://lora.algokit.io/testnet/account/${address}`;

/**
 * The Algod node to build payment transactions against.
 *
 * Read from /api/health rather than hardcoded so the browser always signs
 * against the same node the server settles on. Cached for the session.
 */
let algodUrlPromise: Promise<string> | null = null;

function resolveAlgodUrl(): Promise<string> {
  algodUrlPromise ??= api
    .health()
    .then((health) => health.algodUrl ?? "https://testnet-api.algonode.cloud");
  return algodUrlPromise;
}

/**
 * Relays job stages from the server bus into the event stream.
 *
 * Runs concurrently with the payment: it is started before the POST so no stage
 * can be missed, and cancelled once the job returns.
 *
 * @param traceId - Trace id shared with the compute request.
 * @param onEvent - Receives each stage as a PayerEvent.
 * @param signal - Aborts the stream when the job finishes.
 */
async function pumpStages(
  traceId: string,
  onEvent: (event: PayerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(apiUrl(`/api/trace/${traceId}`), { signal });
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as PayerEvent);
      } catch {
        // A partial or malformed line is not worth failing the run over.
      }
    }
  }
}

/**
 * Runs a paid compute job, signing with the connected wallet.
 *
 * Mirrors `runPayAndCompute` from src/api.ts so the two payment paths are
 * interchangeable at the call site.
 *
 * @param signer - Wallet-backed signer from src/wallet.ts.
 * @param body - The compute request (workload, model, units, gpu).
 * @param onEvent - Called for every payment and job event.
 * @returns The final compute response, or null if the run failed.
 */
export async function runWalletPayAndCompute(
  signer: ClientAvmSigner,
  body: Record<string, unknown>,
  onEvent: (event: PayerEvent) => void,
): Promise<ComputeResponse | null> {
  const now = () => new Date().toISOString();
  const emit = (type: PayerEvent["type"], message: string, data?: unknown) =>
    onEvent({ type, at: now(), message, data });

  const algodUrl = await resolveAlgodUrl();
  const traceId = crypto.randomUUID();
  const abort = new AbortController();

  emit("quote", `Paying from your wallet ${signer.address}`, {
    payer: signer.address,
    payerExplorerUrl: explorerAccountUrl(signer.address),
  });

  // Deliberately not awaited: stages must stream while the payment is in flight.
  const stages = pumpStages(traceId, onEvent, abort.signal).catch(() => {
    // An aborted or failed trace stream costs the animation, not the payment.
  });

  const client = new x402Client()
    // Pattern registration so either CAIP-2 spelling of Algorand resolves.
    .register("algorand:*" as Network, new ExactAvmScheme(signer, { algodUrl }))
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      emit(
        "quote",
        `402 received — ${Number(selectedRequirements.amount) / 1e6} USDC to ${selectedRequirements.payTo}`,
        {
          amountMicroUsdc: selectedRequirements.amount,
          amountUsdc: (Number(selectedRequirements.amount) / 1e6).toFixed(6),
          payTo: selectedRequirements.payTo,
          asset: selectedRequirements.asset,
          network: selectedRequirements.network,
        },
      );
    })
    .onAfterPaymentCreation(async ({ paymentPayload }) => {
      const group = (paymentPayload.payload as { paymentGroup?: string[] }).paymentGroup ?? [];
      emit(
        "payment-signed",
        `Approved in Pera and signed (${group.length}-transaction atomic group). Retrying request.`,
        { groupSize: group.length },
      );
    })
    .onPaymentCreationFailure(async ({ error }) => {
      emit("payment-failed", `Failed to sign payment: ${error.message}`);
    })
    .onPaymentResponse(async ({ settleResponse, error }) => {
      if (error) {
        emit("payment-failed", `Payment failed: ${error.message}`);
        return;
      }
      if (settleResponse?.success) {
        emit("payment-settled", `Settled on Algorand Testnet: ${settleResponse.transaction}`, settleResponse);
      } else if (settleResponse) {
        emit(
          "payment-failed",
          `Settlement failed: ${settleResponse.errorReason ?? "unknown reason"}`,
          settleResponse,
        );
      }
    });

  const paidFetch = wrapFetchWithPayment(fetch, client);

  try {
    const res = await paidFetch(apiUrl("/api/compute"), {
      method: "POST",
      headers: { "Content-Type": "application/json", [TRACE_HEADER]: traceId },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      const detail = (parsed as { error?: string; message?: string }) ?? {};
      throw new Error(detail.error ?? detail.message ?? `Request failed with status ${res.status}.`);
    }

    const result = parsed as ComputeResponse;
    emit("result", "Job complete.", result);
    return result;
  } finally {
    abort.abort();
    await stages;
  }
}
