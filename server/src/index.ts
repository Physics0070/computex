/**
 * ComputeX server.
 *
 * Hosts two roles that would be separate services in production:
 *
 *   1. RESOURCE SERVER  — sells simulated GPU compute behind x402.
 *                         POST /api/compute            (402 until paid)
 *
 *   2. DEV PAYER PROXY  — signs USDC on behalf of the browser so no secret key
 *                         ever reaches the frontend.
 *                         POST /api/pay-and-compute    (NDJSON progress stream)
 *
 * GPU execution is simulated. Payment is not: it settles on Algorand Testnet.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Network } from "@x402/core/types";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";

import { env, explorerAccountUrl, explorerTxUrl, USDC_TESTNET_ASA_ID } from "./env.js";
import {
  InvalidComputeRequest,
  MODEL_VRAM_GB,
  parseComputeRequest,
  quote,
  SUPPORTED_GPUS,
  SUPPORTED_WORKLOADS,
  WORKLOADS,
} from "./pricing.js";
import { getJob, listJobs, runSimulatedJob } from "./compute.js";
import { listProviders } from "./providers.js";
import { parseRecommendRequest, PRIORITIES, recommend } from "./recommend.js";
import { parseIntent } from "./agent.js";
import { checkSpend } from "./guard.js";
import {
  createPaymentMiddleware,
  discoverAlgorandTestnetNetwork,
  injectSettlementIntoBody,
} from "./x402-server.js";
import { createPayer, type PayerEvent } from "./payer.js";
import { publishStage, subscribeToTrace, TRACE_HEADER } from "./bus.js";

const network: Network = await discoverAlgorandTestnetNetwork();
console.log(`[x402] Algorand network: ${network}`);
console.log(`[x402] Facilitator:      ${env.facilitatorUrl}`);
console.log(`[x402] Paying to:        ${env.payeeAddress}`);

const app = new Hono();

app.use("*", cors({ origin: env.corsOrigins, allowHeaders: ["Content-Type"] }));

/* ------------------------------------------------------------------ *
 * Public, unpaid endpoints
 * ------------------------------------------------------------------ */

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "computex",
    network: "Algorand Testnet",
    networkId: network,
    facilitator: env.facilitatorUrl,
    payTo: env.payeeAddress,
    asset: { assetId: USDC_TESTNET_ASA_ID, symbol: "USDC", decimals: 6 },
    computeMode: "simulated",
    paymentMode: "real",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/catalog", (c) =>
  c.json({
    workloads: SUPPORTED_WORKLOADS.map((kind) => WORKLOADS[kind]),
    gpus: SUPPORTED_GPUS,
    priorities: PRIORITIES,
    models: Object.entries(MODEL_VRAM_GB).map(([id, vramGb]) => ({ id, vramGb })),
  }),
);

/* --- marketplace --------------------------------------------------- */

app.get("/api/providers", (c) => {
  const jobs = listJobs();
  const providers = listProviders().map((provider) => {
    // Real jobs run in this session are added to the mock baseline so the
    // provider page reacts to the demo instead of showing static numbers.
    const own = jobs.filter((j) => j.gpu === provider.id);
    const settled = own.filter((j) => j.payment?.status === "settled");
    const sessionRevenue = settled.reduce((sum, j) => sum + Number(j.costUsdc), 0);
    return {
      ...provider,
      jobsCompleted: provider.baselineJobsCompleted + own.length,
      sessionJobs: own.length,
      revenueUsd: Number((provider.baselineRevenueUsd + sessionRevenue).toFixed(4)),
      sessionRevenueUsd: Number(sessionRevenue.toFixed(6)),
    };
  });
  return c.json({ success: true, providers });
});

app.get("/api/jobs", (c) => c.json({ success: true, jobs: listJobs() }));

app.get("/api/stats", (c) => {
  const jobs = listJobs();
  const completed = jobs.filter((j) => j.status === "completed");
  const settled = jobs.filter((j) => j.payment?.status === "settled");
  const spend = settled.reduce((sum, j) => sum + Number(j.costUsdc), 0);
  const providers = listProviders();
  return c.json({
    success: true,
    stats: {
      availableGpus: providers.filter((p) => p.availability.status === "available").length,
      totalGpus: providers.length,
      idleUnits: providers.reduce((n, p) => n + p.availability.idleUnits, 0),
      activeJobs: jobs.filter((j) => j.status === "running").length,
      completedJobs: completed.length,
      averageCostUsdc: settled.length ? Number((spend / settled.length).toFixed(4)) : 0,
      totalSpendUsdc: Number(spend.toFixed(6)),
      settledPayments: settled.length,
    },
  });
});

/** Deterministic GPU selection. No LLM, same input -> same output. */
app.post("/api/recommend", async (c) => {
  try {
    const request = parseRecommendRequest(await c.req.json());
    return c.json({ success: true, ...recommend(request) });
  } catch (error) {
    if (error instanceof InvalidComputeRequest) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }
});

/** Agent Mode: natural language -> requirements -> the same recommendation engine. */
app.post("/api/agent/parse", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { input?: unknown } | null;
  const input = typeof body?.input === "string" ? body.input : "";
  if (!input.trim()) {
    return c.json({ success: false, error: "`input` must be a non-empty string." }, 400);
  }

  const intent = parseIntent(input);
  try {
    const recommendation = recommend(intent.requirements);
    return c.json({ success: true, intent, recommendation });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message, intent }, 400);
  }
});

/** Price preview — same maths the 402 uses, but free to call. */
app.post("/api/quote", async (c) => {
  try {
    const priced = quote(parseComputeRequest(await c.req.json()));
    return c.json({ success: true, quote: priced });
  } catch (error) {
    if (error instanceof InvalidComputeRequest) {
      return c.json({ success: false, error: error.message }, 400);
    }
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }
});

app.get("/api/jobs/:jobId", (c) => {
  const job = getJob(c.req.param("jobId"));
  if (!job) return c.json({ success: false, error: "Job not found." }, 404);
  return c.json({ success: true, job });
});

/* ------------------------------------------------------------------ *
 * Role 1 — the x402-protected resource
 *
 * Middleware order matters. `injectSettlementIntoBody` is registered first so it
 * wraps the payment middleware: settlement happens after the handler returns, and
 * this outer layer folds the resulting transaction id into the JSON body.
 * ------------------------------------------------------------------ */

app.use("/api/compute", injectSettlementIntoBody());
app.use("/api/compute", createPaymentMiddleware(network));

app.post("/api/compute", async (c) => {
  // Reaching this handler means the facilitator already verified the payment.
  let priced;
  try {
    priced = quote(parseComputeRequest(await c.req.json()));
  } catch (error) {
    const message = error instanceof InvalidComputeRequest ? error.message : "Invalid JSON body.";
    // A 4xx here cancels the verified payment instead of settling it.
    return c.json({ success: false, error: message }, 400);
  }

  const traceId = c.req.header(TRACE_HEADER);
  const job = await runSimulatedJob(priced, (stage, jobId) => {
    if (traceId) publishStage(traceId, { jobId, stage });
  });

  return c.json({
    success: true,
    jobId: job.jobId,
    status: job.status,
    quote: {
      priceUsdc: priced.priceUsdc,
      priceMicroUsdc: priced.priceMicroUsdc,
      breakdown: priced.breakdown,
    },
    stages: job.stages,
    result: job.result,
    // Overwritten by injectSettlementIntoBody with the real settlement.
    payment: { status: "awaiting-settlement", network: "Algorand Testnet" },
  });
});

/* ------------------------------------------------------------------ *
 * Role 2 — dev payer proxy (holds the key; the browser never does)
 * ------------------------------------------------------------------ */

app.post("/api/pay-and-compute", async (c) => {
  const body = await c.req.json().catch(() => null);

  // This endpoint spends the server's own USDC, so it is gated before anything
  // else happens. Quoting locally first keeps a refusal free of side effects.
  if (body !== null) {
    let priceUsdc = 0;
    try {
      priceUsdc = Number(quote(parseComputeRequest(body)).priceUsdc);
    } catch (error) {
      const message =
        error instanceof InvalidComputeRequest ? error.message : "Invalid compute request.";
      return c.json({ success: false, error: message }, 400);
    }
    const verdict = checkSpend(c.req.raw.headers, priceUsdc);
    if (!verdict.allowed) {
      return c.json({ success: false, error: verdict.reason }, verdict.status);
    }
  }

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-store");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (s) => {
    const write = (event: PayerEvent) => s.write(`${JSON.stringify(event)}\n`);
    const now = () => new Date().toISOString();

    if (body === null) {
      await write({ type: "error", at: now(), message: "Invalid JSON body." });
      return;
    }

    const traceId = randomUUID();
    const unsubscribe = subscribeToTrace(traceId, ({ stage }) => {
      void write({ type: "stage", at: stage.at, message: stage.label, data: stage });
    });

    try {
      const payer = createPayer(network, (event) => void write(event));

      await write({
        type: "quote",
        at: now(),
        message: `Requesting quote as ${payer.address}`,
        data: { payer: payer.address, payerExplorerUrl: explorerAccountUrl(payer.address) },
      });

      const response = await payer.fetchWithPayment(
        new URL("/api/compute", env.resourceBaseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", [TRACE_HEADER]: traceId },
          body: JSON.stringify(body),
        },
      );

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }

      if (!response.ok) {
        // A 402 on the *retry* means the facilitator refused the signed payment.
        // Its reason rides on the PAYMENT-REQUIRED header, not in the body, so
        // decode it rather than reporting a bare status code.
        await write({
          type: "error",
          at: now(),
          message: `${response.status} — ${describeFailure(response)}`,
          data: parsed,
        });
        return;
      }

      const result = parsed as { payment?: { transactionId?: string } };
      await write({
        type: "result",
        at: now(),
        message: "Job complete.",
        data: {
          ...(result as object),
          explorerUrl: result.payment?.transactionId
            ? explorerTxUrl(result.payment.transactionId)
            : undefined,
        },
      });
    } catch (error) {
      await write({
        type: "error",
        at: now(),
        message: (error as Error).message ?? "Unknown payer error.",
      });
    } finally {
      unsubscribe();
    }
  });
});

/**
 * Extracts why a paid request was refused.
 *
 * On a rejected retry the resource server replies 402 with a fresh
 * PAYMENT-REQUIRED header whose `error` field carries the facilitator's reason
 * (insufficient balance, missing ASA opt-in, expired authorisation, ...).
 *
 * @param response - The failed response from the resource server.
 * @returns A human-readable reason.
 */
function describeFailure(response: Response): string {
  const header =
    response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
  if (header) {
    try {
      const settle = decodePaymentResponseHeader(header);
      return settle.errorMessage ?? settle.errorReason ?? "settlement failed";
    } catch {
      /* fall through to the payment-required header */
    }
  }

  const required =
    response.headers.get("payment-required") ?? response.headers.get("x-payment-required");
  if (required) {
    try {
      const decoded = decodePaymentRequiredHeader(required);
      if (decoded.error && decoded.error !== "Payment required") return decoded.error;
    } catch {
      /* fall through */
    }
  }
  return "payment was not accepted";
}

/* ------------------------------------------------------------------ *
 * Static frontend (production single-origin deployment)
 *
 * When a built client is present the same process serves it, so the browser
 * calls /api on its own origin — no CORS, no dev proxy, one deployable unit.
 * In local development Vite serves the frontend instead and this is skipped.
 * ------------------------------------------------------------------ */

const hasClientBuild = existsSync(path.join(env.clientDist, "index.html"));

if (hasClientBuild) {
  // serveStatic resolves `root` against the working directory, which differs
  // between hosts, so express it relative to cwd with forward slashes.
  const root = path.relative(process.cwd(), env.clientDist).split(path.sep).join("/") || ".";

  app.use("/*", serveStatic({ root }));
  // SPA fallback: any non-API route that matched no file gets index.html.
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return serveStatic({ path: `${root}/index.html` })(c, next);
  });
  console.log(`[web] Serving frontend from ${env.clientDist}`);
} else {
  console.log(`[web] No client build at ${env.clientDist} — API only (run the Vite dev server).`);
}

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`\n  ComputeX server listening on http://localhost:${info.port}`);
  console.log(`  Health:  GET  http://localhost:${info.port}/api/health`);
  console.log(`  Compute: POST http://localhost:${info.port}/api/compute        (x402 protected)`);
  console.log(`  Buy:     POST http://localhost:${info.port}/api/pay-and-compute (dev payer)`);
  if (hasClientBuild) console.log(`  UI:      GET  http://localhost:${info.port}/`);
  console.log();
});
