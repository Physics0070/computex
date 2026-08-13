/**
 * SIMULATED GPU execution.
 *
 * Nothing in this file touches a real GPU — it sleeps, then fabricates plausible
 * artifact metadata. Every field it produces is tagged `simulated: true`.
 *
 * The payment path (src/x402-server.ts) is NOT simulated: that settles real USDC
 * on Algorand Testnet.
 */
import { randomUUID } from "node:crypto";
import type { Quote } from "./pricing.js";
import { reserveUnit } from "./providers.js";

export type StageName =
  | "payment-verified"
  | "gpu-allocated"
  | "job-running"
  | "job-completed";

export interface Stage {
  stage: StageName;
  label: string;
  at: string;
  detail: string;
}

export interface JobResult {
  simulated: true;
  artifacts: Array<{ id: string; kind: string; uri: string; bytes: number }>;
  metrics: {
    gpuSecondsUsed: number;
    device: string;
    vramPeakMb: number;
    throughput: string;
  };
}

/** Settlement facts copied onto the job once the facilitator confirms payment. */
export interface JobPayment {
  status: string;
  transactionId?: string;
  network?: string;
  payer?: string;
  explorerUrl?: string;
}

export interface JobRecord {
  jobId: string;
  status: "running" | "completed";
  quote: Quote;
  stages: Stage[];
  result?: JobResult;
  createdAt: string;
  /** Denormalised for the jobs table so the UI does not dig through `quote`. */
  workload: string;
  model: string;
  gpu: string;
  gpuName: string;
  costUsdc: string;
  payment?: JobPayment;
}

/**
 * In-memory job store. A prototype detail — swap for a DB when this grows up.
 * Insertion order is preserved, so `listJobs` can return newest-first cheaply.
 */
const jobs = new Map<string, JobRecord>();

export const getJob = (jobId: string) => jobs.get(jobId);

/** Newest job first. */
export const listJobs = (): JobRecord[] => [...jobs.values()].reverse();

/**
 * Attaches the real settlement result to a job.
 *
 * Called from the x402 response middleware, which is the only place the
 * transaction id exists — settlement happens after the handler has returned.
 *
 * @param jobId - Job to update.
 * @param payment - Settlement facts decoded from the PAYMENT-RESPONSE header.
 */
export function attachPayment(jobId: string, payment: JobPayment): void {
  const job = jobs.get(jobId);
  if (job) job.payment = payment;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEVICE_LABELS: Record<string, string> = {
  "rtx-4090": "NVIDIA GeForce RTX 4090 (24 GB)",
  "a100-40gb": "NVIDIA A100 SXM4 (40 GB)",
  "l40s-48gb": "NVIDIA L40S (48 GB)",
};

const ARTIFACT_KIND: Record<string, string> = {
  "image-generation": "image/png",
  "text-inference": "application/json",
  "video-upscale": "video/mp4",
  "fine-tune": "application/octet-stream",
};

/**
 * Runs the simulated job, reporting each stage as it happens.
 *
 * Total wall time is clamped to a few seconds so the demo stays watchable
 * regardless of the quoted GPU time.
 *
 * @param quote - The priced request being executed.
 * @param onStage - Called as each stage begins; used to stream progress to the UI.
 */
export async function runSimulatedJob(
  quote: Quote,
  onStage?: (stage: Stage, jobId: string) => void,
): Promise<JobRecord> {
  const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const record: JobRecord = {
    jobId,
    status: "running",
    quote,
    stages: [],
    createdAt: new Date().toISOString(),
    workload: quote.request.workload,
    model: quote.request.model,
    gpu: quote.request.gpu,
    gpuName: quote.provider.gpu,
    costUsdc: Number(quote.priceUsdc).toFixed(4),
  };
  jobs.set(jobId, record);

  const emit = (stage: StageName, label: string, detail: string) => {
    const entry: Stage = { stage, label, at: new Date().toISOString(), detail };
    record.stages.push(entry);
    onStage?.(entry, jobId);
  };

  const { request } = quote;

  emit(
    "payment-verified",
    "Payment verified",
    `x402 payment of ${quote.priceUsdc} USDC verified by the facilitator.`,
  );
  await sleep(400);

  // Held for as long as the job runs, so the marketplace shows this GPU as one
  // unit busier while it works. Released in `finally` — a throw between here and
  // the end would otherwise leak capacity until the next restart.
  const release = reserveUnit(request.gpu);

  try {
    emit(
      "gpu-allocated",
      "GPU allocated",
      `Allocated 1x ${DEVICE_LABELS[request.gpu] ?? request.gpu} (simulated).`,
    );
    await sleep(600);

    emit(
      "job-running",
      "Job running",
      `Running ${request.workload} on ${request.model} for ${request.units} ${quote.unit}.`,
    );

    // Roughly track the quote, but keep the demo between 1.5s and 5s.
    const runMs = Math.min(Math.max(quote.estimatedSeconds * 200, 1500), 5000);
    await sleep(runMs);

    const artifacts = Array.from({ length: Math.min(request.units, 8) }, (_, i) => ({
      id: `${jobId}_${i}`,
      kind: ARTIFACT_KIND[request.workload] ?? "application/octet-stream",
      uri: `simulated://computex/${jobId}/${i}`,
      bytes: 180_000 + Math.floor(Math.random() * 900_000),
    }));

    record.result = {
      simulated: true,
      artifacts,
      metrics: {
        gpuSecondsUsed: Math.round((runMs / 1000 + quote.estimatedSeconds) * 10) / 10,
        device: DEVICE_LABELS[request.gpu] ?? request.gpu,
        vramPeakMb: 4_200 + Math.floor(Math.random() * 8_000),
        throughput: `${(request.units / Math.max(quote.estimatedSeconds, 0.1)).toFixed(2)} ${quote.unit}/s`,
      },
    };
    record.status = "completed";

    emit(
      "job-completed",
      "Job completed",
      `Produced ${artifacts.length} simulated artifact(s) in ${(runMs / 1000).toFixed(1)}s.`,
    );

    return record;
  } finally {
    release();
  }
}
