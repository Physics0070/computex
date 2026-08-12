/**
 * DEV PAYER — the buyer side of the x402 flow.
 *
 * The browser must never hold an Algorand secret key, so the signing payer lives
 * here, server-side, configured from environment variables. The frontend posts a
 * workload to /api/pay-and-compute and this module performs the real client flow:
 *
 *   POST /api/compute -> 402 -> build + sign USDC group -> retry with payment
 *   -> facilitator verifies & settles -> real transaction id
 *
 * In production this role belongs in the user's own wallet (browser extension or
 * agent), not in the server. Swap `toClientAvmSigner` for a wallet-backed
 * `ClientAvmSigner` and the rest of this file is unchanged.
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Network } from "@x402/core/types";
import { ExactAvmScheme as ExactAvmClientScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import { env, resolvePayerSecret } from "./env.js";

export interface PayerEvent {
  type:
    | "quote"
    | "payment-signed"
    | "payment-settled"
    | "payment-failed"
    | "stage"
    | "result"
    | "error";
  at: string;
  message: string;
  data?: unknown;
}

export interface PayerHandle {
  address: string;
  /** fetch() that transparently handles 402 by signing and retrying. */
  fetchWithPayment: (...args: Parameters<typeof globalThis.fetch>) => Promise<Response>;
}

/**
 * Builds a payment-capable fetch for the configured dev payer.
 *
 * @param network - CAIP-2 network to register the AVM scheme under.
 * @param onEvent - Optional observer for payment lifecycle events.
 * @returns The payer address and a wrapped fetch.
 */
export function createPayer(network: Network, onEvent?: (event: PayerEvent) => void): PayerHandle {
  const { address, privateKeyBase64 } = resolvePayerSecret();
  const signer = toClientAvmSigner(privateKeyBase64);

  const emit = (event: Omit<PayerEvent, "at">) =>
    onEvent?.({ ...event, at: new Date().toISOString() });

  const client = new x402Client()
    // Pattern registration so the client matches whichever CAIP-2 spelling the
    // server quotes in its 402.
    .register("algorand:*" as Network, new ExactAvmClientScheme(signer, {
      algodUrl: env.algodUrl,
      algodToken: env.algodToken,
    }))
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      emit({
        type: "quote",
        message: `402 received — ${Number(selectedRequirements.amount) / 1e6} USDC to ${selectedRequirements.payTo}`,
        data: {
          amountMicroUsdc: selectedRequirements.amount,
          amountUsdc: (Number(selectedRequirements.amount) / 1e6).toFixed(6),
          payTo: selectedRequirements.payTo,
          asset: selectedRequirements.asset,
          network: selectedRequirements.network,
          feePayer: (selectedRequirements.extra as Record<string, unknown> | undefined)?.feePayer,
        },
      });
    })
    .onAfterPaymentCreation(async ({ paymentPayload }) => {
      const group = (paymentPayload.payload as { paymentGroup?: string[] }).paymentGroup ?? [];
      emit({
        type: "payment-signed",
        message: `USDC payment signed (${group.length}-transaction atomic group). Retrying request.`,
        data: { groupSize: group.length },
      });
    })
    .onPaymentCreationFailure(async ({ error }) => {
      emit({ type: "payment-failed", message: `Failed to sign payment: ${error.message}` });
    })
    .onPaymentResponse(async ({ settleResponse, error }) => {
      if (error) {
        emit({ type: "payment-failed", message: `Payment failed: ${error.message}` });
        return;
      }
      if (settleResponse?.success) {
        emit({
          type: "payment-settled",
          message: `Settled on Algorand Testnet: ${settleResponse.transaction}`,
          data: settleResponse,
        });
      } else if (settleResponse) {
        emit({
          type: "payment-failed",
          message: `Settlement failed: ${settleResponse.errorReason ?? "unknown reason"}`,
          data: settleResponse,
        });
      }
    });

  return {
    address,
    fetchWithPayment: wrapFetchWithPayment(fetch, client),
  };
}
