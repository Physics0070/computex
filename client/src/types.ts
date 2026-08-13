/** Shapes returned by the ComputeX API. Kept in one place so views stay honest. */

export type WorkloadKind = "image-generation" | "text-inference" | "video-upscale" | "fine-tune";
export type Priority = "balanced" | "speed" | "cost" | "reliability";

export interface WorkloadSpec {
  kind: WorkloadKind;
  label: string;
  unit: string;
  priceFactor: number;
  secondsPerUnit: number;
  minVramGb: number;
  unitField: string;
}

export interface Catalog {
  workloads: WorkloadSpec[];
  gpus: string[];
  priorities: Priority[];
  models: Array<{ id: string; vramGb: number }>;
}

export interface Availability {
  status: "available" | "busy" | "offline";
  idleUnits: number;
  totalUnits: number;
}

export interface Provider {
  id: string;
  gpu: string;
  providerName: string;
  region: string;
  vramGb: number;
  basePriceUsd: number;
  speedFactor: number;
  reliability: number;
  availability: Availability;
  jobsCompleted: number;
  sessionJobs: number;
  revenueUsd: number;
  sessionRevenueUsd: number;
}

export interface Candidate {
  gpu: string;
  name: string;
  providerName: string;
  region: string;
  vramGb: number;
  reliability: number;
  availability: Availability;
  estimatedCostUsdc: string;
  estimatedCostMicroUsdc: number;
  estimatedSeconds: number;
  score: number;
  scoreBreakdown: { cost: number; time: number; reliability: number; availability: number };
  eligible: boolean;
  rejectionReason?: string;
}

export interface RecommendRequest {
  workload: WorkloadKind;
  model: string;
  units: number;
  maxBudget?: number;
  priority: Priority;
}

export interface Recommendation {
  requirements: RecommendRequest & { requiredVramGb: number; unit: string };
  recommended: Candidate | null;
  reason: string;
  candidates: Candidate[];
  overBudget: boolean;
}

export interface ParsedField<T> {
  value: T;
  matched: string | null;
  source: "parsed" | "default" | "inferred";
}

export interface ParsedIntent {
  input: string;
  requirements: RecommendRequest;
  fields: {
    workload: ParsedField<WorkloadKind>;
    model: ParsedField<string>;
    units: ParsedField<number>;
    maxBudget: ParsedField<number | undefined>;
    priority: ParsedField<Priority>;
  };
  notes: string[];
}

export interface JobPayment {
  status: string;
  transactionId?: string;
  network?: string;
  payer?: string;
  explorerUrl?: string;
}

export interface Stage {
  stage: "payment-verified" | "gpu-allocated" | "job-running" | "job-completed";
  label: string;
  at: string;
  detail: string;
}

export interface JobResult {
  simulated: true;
  artifacts: Array<{ id: string; kind: string; uri: string; bytes: number }>;
  metrics: { gpuSecondsUsed: number; device: string; vramPeakMb: number; throughput: string };
}

export interface Job {
  jobId: string;
  status: "running" | "completed";
  createdAt: string;
  workload: string;
  model: string;
  gpu: string;
  gpuName: string;
  costUsdc: string;
  stages: Stage[];
  result?: JobResult;
  payment?: JobPayment;
}

export interface Stats {
  availableGpus: number;
  totalGpus: number;
  idleUnits: number;
  activeJobs: number;
  completedJobs: number;
  averageCostUsdc: number;
  totalSpendUsdc: number;
  settledPayments: number;
}

export interface Health {
  status: string;
  network: string;
  networkId: string;
  facilitator: string;
  payTo: string;
  computeMode: string;
  paymentMode: string;
  /** Algod node the browser signs against when paying from its own wallet. */
  algodUrl?: string;
}

/** One line of the NDJSON stream from POST /api/pay-and-compute. */
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

export interface ComputeResponse {
  success: boolean;
  jobId: string;
  status: string;
  quote: { priceUsdc: string; priceMicroUsdc: number; breakdown: string };
  stages: Stage[];
  result?: JobResult;
  payment?: {
    status: string;
    transactionId?: string;
    network?: string;
    networkId?: string;
    payer?: string;
    explorerUrl?: string;
    errorReason?: string;
    asset?: { assetId: number; symbol: string; decimals: number };
  };
  explorerUrl?: string;
}
