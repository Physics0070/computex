/**
 * Pay-per-compute pricing.
 *
 * The whole point of ComputeX: the price comes from the *workload*, not from an
 * hourly GPU rental. The x402 route uses this as a dynamic price, so every 402
 * quote is derived from the request body.
 *
 *   cost = provider.basePriceUsd x workload.priceFactor x units
 *   time = workload.secondsPerUnit x units / provider.speedFactor
 *
 * Both formulas read GPU characteristics from src/providers.ts, so the
 * marketplace, the recommendation engine and the on-chain price always agree.
 */
import { getProvider, SUPPORTED_GPUS, type GpuId, type GpuProvider } from "./providers.js";

export type WorkloadKind = "image-generation" | "text-inference" | "video-upscale" | "fine-tune";

export interface WorkloadSpec {
  kind: WorkloadKind;
  label: string;
  /** What one unit of this workload is. */
  unit: string;
  /** Multiplier applied to the GPU base price, per unit. */
  priceFactor: number;
  /** Seconds per unit on a reference GPU (speedFactor 1.0). */
  secondsPerUnit: number;
  /** Floor on VRAM regardless of model. */
  minVramGb: number;
  /** Which request field naturally carries the unit count. */
  unitField: string;
}

export const WORKLOADS: Record<WorkloadKind, WorkloadSpec> = {
  "image-generation": {
    kind: "image-generation",
    label: "Image generation",
    unit: "image",
    priceFactor: 0.15,
    secondsPerUnit: 6,
    minVramGb: 8,
    unitField: "images",
  },
  "text-inference": {
    kind: "text-inference",
    label: "Text inference",
    unit: "1k tokens",
    priceFactor: 0.004,
    secondsPerUnit: 0.4,
    minVramGb: 16,
    unitField: "tokens",
  },
  "video-upscale": {
    kind: "video-upscale",
    label: "Video upscale",
    unit: "second of video",
    priceFactor: 0.35,
    secondsPerUnit: 2.5,
    minVramGb: 24,
    unitField: "seconds",
  },
  "fine-tune": {
    kind: "fine-tune",
    label: "Fine-tune",
    unit: "100 training steps",
    priceFactor: 1.2,
    secondsPerUnit: 12,
    minVramGb: 40,
    unitField: "steps",
  },
};

/**
 * VRAM each known model needs. Unknown models fall back to the workload floor,
 * so a user can type any model name without hitting a dead end.
 */
export const MODEL_VRAM_GB: Record<string, number> = {
  sdxl: 12,
  "sdxl-turbo": 10,
  "sd-1.5": 6,
  "flux-dev": 24,
  "flux-schnell": 20,
  "llama-3-8b": 18,
  "llama-3-70b": 40,
  "mistral-7b": 16,
  "whisper-large": 10,
  "real-esrgan": 8,
  "video-crafter": 24,
};

export const SUPPORTED_WORKLOADS = Object.keys(WORKLOADS) as WorkloadKind[];
export { SUPPORTED_GPUS };

export interface ComputeRequest {
  workload: WorkloadKind;
  model: string;
  /** Units of work — images, 1k-token blocks, video seconds, 100-step blocks. */
  units: number;
  gpu: GpuId;
}

export interface Quote {
  request: ComputeRequest;
  provider: GpuProvider;
  /** Decimal USDC, 6dp, e.g. "0.060000". */
  priceUsdc: string;
  /** Atomic USDC (6 decimals) — the amount that actually moves on-chain. */
  priceMicroUsdc: number;
  unit: string;
  estimatedSeconds: number;
  requiredVramGb: number;
  breakdown: string;
}

/** Smallest amount worth settling on-chain; also guards against zero-value transfers. */
const MIN_PRICE_USDC = 0.001;

export class InvalidComputeRequest extends Error {}

/** VRAM needed for a model + workload combination. */
export function requiredVramGb(workload: WorkloadKind, model: string): number {
  const spec = WORKLOADS[workload];
  const modelNeed = MODEL_VRAM_GB[model.toLowerCase().trim()];
  return Math.max(spec.minVramGb, modelNeed ?? 0);
}

/**
 * Validates and normalises an incoming compute request body.
 *
 * Accepts `units`, `images`, `tokens`, `seconds` or `steps` for the unit count so
 * the natural payload for each workload type works untranslated.
 *
 * @param body - Raw JSON body.
 * @returns A normalised compute request.
 */
export function parseComputeRequest(body: unknown): ComputeRequest {
  if (typeof body !== "object" || body === null) {
    throw new InvalidComputeRequest("Request body must be a JSON object.");
  }
  const raw = body as Record<string, unknown>;

  const workload = String(raw.workload ?? "") as WorkloadKind;
  if (!SUPPORTED_WORKLOADS.includes(workload)) {
    throw new InvalidComputeRequest(
      `Unsupported workload "${raw.workload}". Supported: ${SUPPORTED_WORKLOADS.join(", ")}.`,
    );
  }

  const gpu = String(raw.gpu ?? "rtx-4090") as GpuId;
  if (!getProvider(gpu)) {
    throw new InvalidComputeRequest(
      `Unknown gpu "${raw.gpu}". Available: ${SUPPORTED_GPUS.join(", ")}.`,
    );
  }

  const model = String(raw.model ?? "").trim();
  if (!model) throw new InvalidComputeRequest("`model` is required.");

  const unitCandidate = raw.units ?? raw.images ?? raw.tokens ?? raw.seconds ?? raw.steps ?? 1;
  const units = Number(unitCandidate);
  if (!Number.isFinite(units) || units <= 0 || units > 1000) {
    throw new InvalidComputeRequest("Unit count must be a number between 1 and 1000.");
  }

  return { workload, model, gpu, units: Math.ceil(units) };
}

/**
 * Prices a request against one GPU. Pure function — no network, no side effects.
 *
 * @param request - A normalised compute request.
 * @returns The quote used for both the 402 and the recommendation ranking.
 */
export function quote(request: ComputeRequest): Quote {
  const provider = getProvider(request.gpu);
  if (!provider) throw new InvalidComputeRequest(`Unknown gpu "${request.gpu}".`);

  const spec = WORKLOADS[request.workload];
  const rawPrice = provider.basePriceUsd * spec.priceFactor * request.units;
  const priceMicroUsdc = Math.max(
    Math.round(rawPrice * 1_000_000),
    Math.round(MIN_PRICE_USDC * 1_000_000),
  );

  const estimatedSeconds =
    Math.round((spec.secondsPerUnit * request.units) / provider.speedFactor * 10) / 10;

  return {
    request,
    provider,
    priceUsdc: (priceMicroUsdc / 1_000_000).toFixed(6),
    priceMicroUsdc,
    unit: spec.unit,
    estimatedSeconds,
    requiredVramGb: requiredVramGb(request.workload, request.model),
    breakdown:
      `${request.units} x ${spec.unit} x $${provider.basePriceUsd.toFixed(2)} base ` +
      `x ${spec.priceFactor} (${spec.label}) = $${(priceMicroUsdc / 1_000_000).toFixed(4)} USDC`,
  };
}
