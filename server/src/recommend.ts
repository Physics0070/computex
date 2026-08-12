/**
 * Deterministic GPU recommendation.
 *
 * No LLM, no randomness: the same request always produces the same pick, and the
 * explanation is generated from the numbers that actually decided it.
 *
 * Pipeline:  compatibility filter -> budget filter -> weighted score -> explain
 */
import { getProvider, isSchedulable, listProviders, type GpuId } from "./providers.js";
import {
  InvalidComputeRequest,
  quote,
  requiredVramGb,
  SUPPORTED_WORKLOADS,
  WORKLOADS,
  type Quote,
  type WorkloadKind,
} from "./pricing.js";

export type Priority = "balanced" | "speed" | "cost" | "reliability";

export const PRIORITIES: Priority[] = ["balanced", "speed", "cost", "reliability"];

/** How much each factor matters, per priority. Rows sum to 1. */
const WEIGHTS: Record<Priority, { cost: number; time: number; reliability: number; availability: number }> = {
  balanced: { cost: 0.35, time: 0.3, reliability: 0.2, availability: 0.15 },
  speed: { cost: 0.15, time: 0.55, reliability: 0.2, availability: 0.1 },
  cost: { cost: 0.6, time: 0.15, reliability: 0.15, availability: 0.1 },
  reliability: { cost: 0.15, time: 0.15, reliability: 0.6, availability: 0.1 },
};

export interface RecommendRequest {
  workload: WorkloadKind;
  model: string;
  units: number;
  maxBudget?: number;
  priority: Priority;
}

export interface Candidate {
  gpu: GpuId;
  name: string;
  providerName: string;
  region: string;
  vramGb: number;
  reliability: number;
  availability: { status: string; idleUnits: number; totalUnits: number };
  estimatedCostUsdc: string;
  estimatedCostMicroUsdc: number;
  estimatedSeconds: number;
  /** 0-100, higher is a better match for the stated priority. */
  score: number;
  scoreBreakdown: { cost: number; time: number; reliability: number; availability: number };
  eligible: boolean;
  /** Why this candidate was excluded, if it was. */
  rejectionReason?: string;
}

export interface Recommendation {
  requirements: RecommendRequest & { requiredVramGb: number; unit: string };
  recommended: Candidate | null;
  reason: string;
  /** Every GPU in the marketplace, scored, best first — eligible ones lead. */
  candidates: Candidate[];
  /** True when the budget could not be met and the cheapest option is shown instead. */
  overBudget: boolean;
}

/**
 * Validates a /api/recommend body.
 *
 * @param body - Raw JSON body.
 * @returns A normalised recommendation request.
 */
export function parseRecommendRequest(body: unknown): RecommendRequest {
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

  const model = String(raw.model ?? "").trim();
  if (!model) throw new InvalidComputeRequest("`model` is required.");

  const unitCandidate = raw.units ?? raw.images ?? raw.tokens ?? raw.seconds ?? raw.steps ?? 1;
  const units = Number(unitCandidate);
  if (!Number.isFinite(units) || units <= 0 || units > 1000) {
    throw new InvalidComputeRequest("Unit count must be a number between 1 and 1000.");
  }

  const priority = String(raw.priority ?? "balanced") as Priority;
  if (!PRIORITIES.includes(priority)) {
    throw new InvalidComputeRequest(
      `Unknown priority "${raw.priority}". Supported: ${PRIORITIES.join(", ")}.`,
    );
  }

  const budgetRaw = raw.maxBudget ?? raw.budget;
  let maxBudget: number | undefined;
  if (budgetRaw !== undefined && budgetRaw !== null && budgetRaw !== "") {
    maxBudget = Number(budgetRaw);
    if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
      throw new InvalidComputeRequest("`maxBudget` must be a positive number of USDC.");
    }
  }

  return { workload, model, units: Math.ceil(units), priority, maxBudget };
}

/** Min-max normalisation. When every candidate ties, everyone scores 1. */
function normalize(values: number[], higherIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
}

/**
 * Ranks every GPU in the marketplace for a request.
 *
 * @param request - Normalised recommendation request.
 * @returns The winner, the reasoning, and the full scored field.
 */
export function recommend(request: RecommendRequest): Recommendation {
  const spec = WORKLOADS[request.workload];
  const vramNeeded = requiredVramGb(request.workload, request.model);

  // Quote every provider up front — the same pricing the 402 will use.
  const priced = listProviders().map((provider) => {
    const q: Quote = quote({
      workload: request.workload,
      model: request.model,
      units: request.units,
      gpu: provider.id,
    });
    return { provider, q };
  });

  const withEligibility = priced.map(({ provider, q }) => {
    let rejectionReason: string | undefined;
    if (provider.vramGb < vramNeeded) {
      rejectionReason = `Needs ${vramNeeded} GB VRAM for ${request.model}, has ${provider.vramGb} GB.`;
    } else if (!isSchedulable(provider)) {
      rejectionReason = `No idle capacity (${provider.availability.status}).`;
    } else if (request.maxBudget !== undefined && Number(q.priceUsdc) > request.maxBudget) {
      rejectionReason = `$${Number(q.priceUsdc).toFixed(4)} exceeds the $${request.maxBudget.toFixed(2)} budget.`;
    }
    return { provider, q, rejectionReason };
  });

  let pool = withEligibility.filter((c) => !c.rejectionReason);
  let overBudget = false;

  // Nothing fits the budget: fall back to the cheapest compatible GPU and say so,
  // rather than leaving the user with no path forward.
  if (pool.length === 0) {
    const compatible = withEligibility.filter(
      (c) => c.provider.vramGb >= vramNeeded && isSchedulable(c.provider),
    );
    if (compatible.length > 0) {
      overBudget = true;
      pool = [compatible.reduce((a, b) => (a.q.priceMicroUsdc <= b.q.priceMicroUsdc ? a : b))];
    }
  }

  const weights = WEIGHTS[request.priority];
  const scoredPool = pool.length > 0 ? pool : [];

  const costScores = normalize(scoredPool.map((c) => c.q.priceMicroUsdc), false);
  const timeScores = normalize(scoredPool.map((c) => c.q.estimatedSeconds), false);
  const relScores = normalize(scoredPool.map((c) => c.provider.reliability), true);
  const availScores = normalize(
    scoredPool.map((c) => c.provider.availability.idleUnits / c.provider.availability.totalUnits),
    true,
  );

  const toCandidate = (
    entry: (typeof withEligibility)[number],
    scores: { cost: number; time: number; reliability: number; availability: number } | null,
  ): Candidate => ({
    gpu: entry.provider.id,
    name: entry.provider.gpu,
    providerName: entry.provider.providerName,
    region: entry.provider.region,
    vramGb: entry.provider.vramGb,
    reliability: entry.provider.reliability,
    availability: entry.provider.availability,
    estimatedCostUsdc: Number(entry.q.priceUsdc).toFixed(4),
    estimatedCostMicroUsdc: entry.q.priceMicroUsdc,
    estimatedSeconds: entry.q.estimatedSeconds,
    score: scores
      ? Math.round(
          (scores.cost * weights.cost +
            scores.time * weights.time +
            scores.reliability * weights.reliability +
            scores.availability * weights.availability) *
            1000,
        ) / 10
      : 0,
    scoreBreakdown: scores ?? { cost: 0, time: 0, reliability: 0, availability: 0 },
    eligible: !entry.rejectionReason,
    ...(entry.rejectionReason ? { rejectionReason: entry.rejectionReason } : {}),
  });

  const scoredCandidates = scoredPool.map((entry, i) =>
    toCandidate(entry, {
      cost: costScores[i] ?? 0,
      time: timeScores[i] ?? 0,
      reliability: relScores[i] ?? 0,
      availability: availScores[i] ?? 0,
    }),
  );

  const excluded = withEligibility
    .filter((entry) => !scoredPool.includes(entry))
    .map((entry) => toCandidate(entry, null));

  scoredCandidates.sort((a, b) => b.score - a.score);
  const winner = scoredCandidates[0] ?? null;

  return {
    requirements: { ...request, requiredVramGb: vramNeeded, unit: spec.unit },
    recommended: winner,
    reason: winner ? explain(winner, scoredCandidates, request, vramNeeded, overBudget) : noFitReason(vramNeeded, request),
    candidates: [...scoredCandidates, ...excluded],
    overBudget,
  };
}

/** Builds the human-readable justification from the dimensions that actually won. */
function explain(
  winner: Candidate,
  field: Candidate[],
  request: RecommendRequest,
  vramNeeded: number,
  overBudget: boolean,
): string {
  if (overBudget) {
    return (
      `${winner.name} selected as the cheapest compatible GPU at $${winner.estimatedCostUsdc} USDC, ` +
      `but no GPU meets the $${request.maxBudget?.toFixed(2)} budget for ${request.units} ${request.model} ` +
      `units. Reduce the job size or raise the budget.`
    );
  }

  const cheapest = field.every((c) => Number(winner.estimatedCostUsdc) <= Number(c.estimatedCostUsdc));
  const fastest = field.every((c) => winner.estimatedSeconds <= c.estimatedSeconds);
  const mostReliable = field.every((c) => winner.reliability >= c.reliability);

  const strengths: string[] = [];
  if (cheapest) strengths.push("the lowest cost");
  if (fastest) strengths.push("the fastest estimated execution time");
  if (mostReliable) strengths.push(`the highest reliability (${(winner.reliability * 100).toFixed(0)}%)`);

  const vramClause = `it satisfies the ${vramNeeded} GB VRAM requirement for ${request.model}`;
  const budgetClause =
    request.maxBudget !== undefined
      ? ` within the $${request.maxBudget.toFixed(2)} budget`
      : "";

  if (strengths.length === 0) {
    return (
      `${winner.name} selected because ${vramClause}${budgetClause} while providing the best balance of ` +
      `estimated cost ($${winner.estimatedCostUsdc} USDC) and execution time (~${winner.estimatedSeconds}s).`
    );
  }

  const priorityClause =
    request.priority === "balanced"
      ? "the best balance of estimated cost and execution time"
      : `${strengths.join(" and ")} for your "${request.priority}" priority`;

  return (
    `${winner.name} selected because ${vramClause}${budgetClause} while providing ${priorityClause} ` +
    `— $${winner.estimatedCostUsdc} USDC, ~${winner.estimatedSeconds}s, ${(winner.reliability * 100).toFixed(0)}% reliability.`
  );
}

function noFitReason(vramNeeded: number, request: RecommendRequest): string {
  return (
    `No GPU in the marketplace can run ${request.model} for ${request.workload}: ` +
    `it needs ${vramNeeded} GB VRAM and no provider with that much memory has idle capacity.`
  );
}

export { getProvider };
