/**
 * Tests the wallet payment path's plumbing without a browser.
 *
 * A browser paying from Pera does two things at once: it opens
 * GET /api/trace/:id, then POSTs /api/compute carrying that same id. This script
 * performs exactly that sequence with the server-side payer standing in for the
 * wallet, which exercises everything except the Pera signature itself.
 *
 * What it proves: stages reach the trace stream live rather than arriving in a
 * lump after settlement, and the stream closes on its own when the job is done.
 *
 * Usage: npm run test:trace          (server must already be running)
 */
import { randomUUID } from "node:crypto";
import { env } from "../src/env.js";
import { createPayer } from "../src/payer.js";
import { discoverAlgorandTestnetNetwork } from "../src/x402-server.js";

const BASE = env.resourceBaseUrl;
const TRACE_HEADER = "x-computex-trace";
const WORKLOAD = { workload: "image-generation", model: "sdxl", images: 5, gpu: "rtx-4090" };

const traceId = randomUUID();
const started = Date.now();
const since = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;

let failures = 0;
const pass = (label: string, detail = "") =>
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label: string, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`\n  Trace-stream test (the browser wallet path)`);
console.log(`  target: ${BASE}`);
console.log(`  trace:  ${traceId}\n`);

/* 1 — open the stream first, exactly as the browser does ------------- */
const stageTimes: Array<{ stage: string; at: number }> = [];

const traceResponse = await fetch(new URL(`/api/trace/${traceId}`, BASE));
if (!traceResponse.ok || !traceResponse.body) {
  fail("GET /api/trace/:id", `status ${traceResponse.status}`);
  process.exit(1);
}
pass("GET /api/trace/:id opened", traceResponse.headers.get("content-type") ?? "");

const consume = (async () => {
  const reader = traceResponse.body!.getReader();
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
      const event = JSON.parse(line) as { data?: { stage?: string; label?: string } };
      const stage = event.data?.stage ?? "?";
      stageTimes.push({ stage, at: Date.now() });
      console.log(`        ${since().padStart(7)} [stage] ${event.data?.label ?? stage}`);
    }
  }
})();

/* 2 — pay, carrying the same trace id -------------------------------- */
const network = await discoverAlgorandTestnetNetwork();
const payer = createPayer(network);

const paid = await payer.fetchWithPayment(new URL("/api/compute", BASE), {
  method: "POST",
  headers: { "Content-Type": "application/json", [TRACE_HEADER]: traceId },
  body: JSON.stringify(WORKLOAD),
});
const body = (await paid.json()) as {
  success?: boolean;
  jobId?: string;
  payment?: { status?: string; transactionId?: string };
};

if (paid.ok && body.success) pass("paid /api/compute with a trace id", `job ${body.jobId}`);
else fail("paid /api/compute with a trace id", `status ${paid.status}`);

if (body.payment?.status === "settled" && body.payment.transactionId) {
  pass("payment settled", body.payment.transactionId);
} else {
  fail("payment settled", JSON.stringify(body.payment));
}

/* 3 — the stream must have closed itself on job-completed ------------ */
const closed = await Promise.race([
  consume.then(() => true),
  new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
]);
if (closed) pass("trace stream closed itself after job-completed");
else fail("trace stream closed itself", "still open 5s after the job returned");

/* 4 — stages must be live, not a post-settlement dump ---------------- */
const expected = ["payment-verified", "gpu-allocated", "job-running", "job-completed"];
const seen = stageTimes.map((s) => s.stage);
if (expected.every((stage) => seen.includes(stage))) {
  pass("all four stages received", seen.join(" -> "));
} else {
  fail("all four stages received", `got ${seen.join(", ") || "none"}`);
}

const first = stageTimes[0];
const last = stageTimes[stageTimes.length - 1];
if (first && last) {
  const spreadMs = last.at - first.at;
  // A buffered response would deliver every stage in the same instant. Real
  // streaming spreads them across the job's runtime, which is seconds.
  if (spreadMs > 1000) {
    pass("stages arrived live, not buffered", `${(spreadMs / 1000).toFixed(1)}s between first and last`);
  } else {
    fail("stages arrived live, not buffered", `all within ${spreadMs}ms — looks buffered`);
  }
}

console.log(`\n  ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
