/**
 * x402 resource-server wiring for ComputeX.
 *
 * This is the REAL payment path. Nothing here is mocked:
 *   - the 402 quote is built by @x402/core from live facilitator capabilities
 *   - the USDC transfer group is verified and settled by the GoPlausible facilitator
 *   - the transaction id in the response is the one the facilitator returns from settle
 */
import type { MiddlewareHandler } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { decodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import { ExactAvmScheme as ExactAvmServerScheme } from "@x402/avm/exact/server";
import {
  ALGORAND_TESTNET_CANONICAL_CAIP2,
  ALGORAND_TESTNET_FULL_CAIP2,
  USDC_TESTNET_ASA_ID,
  env,
} from "./env.js";
import { InvalidComputeRequest, parseComputeRequest, quote } from "./pricing.js";
import { attachPayment } from "./compute.js";

/**
 * Finds the exact CAIP-2 string the facilitator advertises for Algorand Testnet.
 *
 * @x402/core matches a route's network against facilitator kinds with `===`, and
 * the facilitator currently advertises the full-genesis-hash form rather than the
 * truncated canonical one. Discovering it removes the guesswork (and keeps working
 * if the facilitator switches forms later).
 *
 * @returns The network identifier to use in the route configuration.
 */
export async function discoverAlgorandTestnetNetwork(): Promise<Network> {
  if (env.networkOverride) return env.networkOverride as Network;

  const accepted = new Set<string>([
    ALGORAND_TESTNET_FULL_CAIP2,
    ALGORAND_TESTNET_CANONICAL_CAIP2,
  ]);

  try {
    const res = await fetch(new URL("/supported", env.facilitatorUrl), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`facilitator /supported returned ${res.status}`);
    const body = (await res.json()) as {
      kinds?: Array<{ scheme: string; network: string; x402Version: number }>;
    };
    const match = body.kinds?.find(
      (k) => k.scheme === "exact" && k.x402Version === 2 && accepted.has(k.network),
    );
    if (match) return match.network as Network;
    throw new Error("facilitator does not advertise exact/algorand-testnet for x402 v2");
  } catch (error) {
    console.warn(
      `[x402] Could not read facilitator capabilities (${(error as Error).message}). ` +
        `Falling back to ${ALGORAND_TESTNET_FULL_CAIP2}.`,
    );
    return ALGORAND_TESTNET_FULL_CAIP2 as Network;
  }
}

/**
 * Builds the Hono middleware that puts /api/compute behind x402.
 *
 * Price is dynamic: it is computed from the request body on every 402, which is
 * what makes this pay-per-compute rather than pay-per-hour.
 *
 * @param network - CAIP-2 network id from {@link discoverAlgorandTestnetNetwork}.
 * @returns Hono middleware enforcing payment on POST /api/compute.
 */
export function createPaymentMiddleware(network: Network): MiddlewareHandler {
  const facilitator = new HTTPFacilitatorClient({
    url: env.facilitatorUrl,
    timeoutMs: 60_000,
  });

  const resourceServer = new x402ResourceServer(facilitator)
    // Pattern registration so either CAIP-2 spelling of Algorand resolves.
    .register("algorand:*" as Network, new ExactAvmServerScheme());

  const routes: RoutesConfig = {
    "POST /api/compute": {
      description: "Run a GPU compute job. Priced per workload, settled in USDC on Algorand.",
      mimeType: "application/json",
      serviceName: "ComputeX",
      tags: ["gpu", "compute", "pay-per-use"],
      accepts: [
        {
          scheme: "exact",
          network,
          payTo: env.payeeAddress,
          maxTimeoutSeconds: 120,
          // Dynamic price: quote the actual workload in the body.
          price: async (context) => {
            const body = await context.adapter.getBody?.();
            const priced = quote(parseComputeRequest(body));
            return {
              asset: String(USDC_TESTNET_ASA_ID),
              amount: String(priced.priceMicroUsdc),
            };
          },
        },
      ],
      // Body of the 402 itself — makes the unpaid response self-explanatory.
      unpaidResponseBody: async (context) => {
        let detail: Record<string, unknown>;
        try {
          const priced = quote(parseComputeRequest(await context.adapter.getBody?.()));
          detail = {
            quote: {
              priceUsdc: priced.priceUsdc,
              priceMicroUsdc: priced.priceMicroUsdc,
              breakdown: priced.breakdown,
              estimatedSeconds: priced.estimatedSeconds,
            },
          };
        } catch (error) {
          detail = { quoteError: (error as Error).message };
        }
        return {
          contentType: "application/json",
          body: {
            success: false,
            error: "payment_required",
            message:
              "This endpoint is metered with x402. Sign the USDC payment in `accepts` and retry.",
            network: "Algorand Testnet",
            asset: { assetId: USDC_TESTNET_ASA_ID, symbol: "USDC", decimals: 6 },
            ...detail,
          },
        };
      },
    },
  };

  return paymentMiddleware(routes, resourceServer);
}

/**
 * Reads the settlement result the x402 middleware attached to a response.
 *
 * The `authorization` payment flow (the only one @x402/avm supports) settles
 * *after* the route handler returns, so the transaction id is not available
 * inside the handler — it arrives on the PAYMENT-RESPONSE header.
 *
 * @param headers - Response headers produced by the payment middleware.
 * @returns The decoded settlement, or null if the response carried none.
 */
export function readSettlement(headers: Headers): SettleResponse | null {
  const raw =
    headers.get("payment-response") ??
    headers.get("x-payment-response") ??
    headers.get("X-PAYMENT-RESPONSE");
  if (!raw) return null;
  try {
    return decodePaymentResponseHeader(raw);
  } catch (error) {
    console.warn("[x402] Failed to decode PAYMENT-RESPONSE header:", error);
    return null;
  }
}

/**
 * Middleware that folds the real settlement into the JSON body.
 *
 * Register this BEFORE the payment middleware so it wraps it: by the time
 * `next()` resolves, settlement has happened and the header is set. Without this
 * the transaction id would only ever appear in a header, and the documented
 * `payment.transactionId` field would be missing.
 *
 * @returns Hono middleware that rewrites the response body.
 */
export function injectSettlementIntoBody(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const res = c.res;
    if (!res || res.status !== 200) return;
    if (!res.headers.get("content-type")?.includes("application/json")) return;

    const settlement = readSettlement(res.headers);
    if (!settlement) return;

    let body: Record<string, unknown>;
    try {
      body = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      return;
    }

    const explorerUrl = settlement.transaction
      ? `https://lora.algokit.io/testnet/transaction/${settlement.transaction}`
      : undefined;

    body.payment = {
      status: settlement.success ? "settled" : "failed",
      transactionId: settlement.transaction,
      network: "Algorand Testnet",
      networkId: settlement.network,
      payer: settlement.payer,
      asset: { assetId: USDC_TESTNET_ASA_ID, symbol: "USDC", decimals: 6 },
      facilitator: env.facilitatorUrl,
      explorerUrl,
      ...(settlement.errorReason ? { errorReason: settlement.errorReason } : {}),
    };

    // Job history is the only other place that needs the transaction id, and this
    // is the first moment it exists.
    if (typeof body.jobId === "string") {
      attachPayment(body.jobId, {
        status: settlement.success ? "settled" : "failed",
        transactionId: settlement.transaction,
        network: "Algorand Testnet",
        payer: settlement.payer,
        explorerUrl,
      });
    }

    const headers = new Headers(res.headers);
    headers.delete("content-length");
    c.res = new Response(JSON.stringify(body), { status: res.status, headers });
  };
}

export { InvalidComputeRequest };
