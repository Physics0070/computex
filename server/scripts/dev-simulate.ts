/**
 * Exercises the compute simulation and job store without spending USDC.
 *
 * Useful while the payer is still being funded: it verifies everything
 * downstream of payment (stages, timing, artifacts, job history) in isolation.
 *
 * Usage: npm run simulate
 */
import { attachPayment, listJobs, runSimulatedJob } from "../src/compute.js";
import { parseComputeRequest, quote } from "../src/pricing.js";

const q = quote(
  parseComputeRequest({ workload: "image-generation", model: "sdxl", images: 5, gpu: "rtx-4090" }),
);
console.log(`\n  quote: ${q.priceUsdc} USDC — ${q.breakdown}\n`);

const started = Date.now();
const job = await runSimulatedJob(q, (stage) =>
  console.log(
    `  +${((Date.now() - started) / 1000).toFixed(1)}s  ${stage.stage.padEnd(16)} ${stage.detail}`,
  ),
);

console.log(`\n  job ${job.jobId} — ${job.status} on ${job.gpuName} for $${job.costUsdc}`);
console.log(`  artifacts: ${job.result?.artifacts.length}`);
console.log(`  metrics:   ${JSON.stringify(job.result?.metrics)}`);

// The real value comes from the x402 middleware; this only checks the plumbing.
attachPayment(job.jobId, { status: "settled", transactionId: "PLUMBING-CHECK-ONLY" });
console.log(`  history:   ${listJobs().length} row(s), payment=${listJobs()[0]?.payment?.status}\n`);
