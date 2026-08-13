/**
 * GPU marketplace catalog.
 *
 * Mock supply for the prototype, kept behind a narrow interface so a real
 * provider network can be dropped in later: replace `listProviders()` with a
 * call to a provider registry and nothing downstream changes.
 *
 * Every consumer (pricing, recommendation, provider dashboard) reads from here,
 * so there is exactly one definition of what a GPU costs and how fast it is.
 */

export type GpuId = "rtx-4090" | "a100-40gb" | "l40s-48gb";
export type AvailabilityStatus = "available" | "busy" | "offline";

export interface GpuProvider {
  id: GpuId;
  /** Display name of the accelerator. */
  gpu: string;
  /** Operator offering the capacity. */
  providerName: string;
  region: string;
  vramGb: number;
  /** Base price in USDC that the per-workload pricing model scales. */
  basePriceUsd: number;
  /** Throughput relative to an RTX 4090 (1.0). Higher is faster. */
  speedFactor: number;
  /** Historical success rate, 0-1. */
  reliability: number;
  availability: {
    status: AvailabilityStatus;
    /** Idle units right now / units in the fleet. */
    idleUnits: number;
    totalUnits: number;
  };
  /** Lifetime jobs before this demo started — makes the provider page look lived-in. */
  baselineJobsCompleted: number;
  /** Lifetime revenue before this demo started, in USDC. */
  baselineRevenueUsd: number;
}

const PROVIDERS: GpuProvider[] = [
  {
    id: "rtx-4090",
    gpu: "RTX 4090",
    providerName: "Northwind Compute",
    region: "eu-central",
    vramGb: 24,
    basePriceUsd: 0.08,
    speedFactor: 1.0,
    reliability: 0.98,
    availability: { status: "available", idleUnits: 6, totalUnits: 8 },
    baselineJobsCompleted: 1284,
    baselineRevenueUsd: 142.37,
  },
  {
    id: "a100-40gb",
    gpu: "A100 40GB",
    providerName: "Helios Cloud",
    region: "us-east",
    vramGb: 40,
    basePriceUsd: 0.14,
    speedFactor: 1.35,
    reliability: 0.99,
    availability: { status: "available", idleUnits: 2, totalUnits: 6 },
    baselineJobsCompleted: 913,
    baselineRevenueUsd: 268.9,
  },
  {
    id: "l40s-48gb",
    gpu: "L40S 48GB",
    providerName: "Nimbus Labs",
    region: "ap-south",
    vramGb: 48,
    basePriceUsd: 0.11,
    speedFactor: 1.25,
    reliability: 0.97,
    availability: { status: "available", idleUnits: 3, totalUnits: 4 },
    baselineJobsCompleted: 547,
    baselineRevenueUsd: 96.14,
  },
];

/**
 * Units currently held by running jobs, per provider.
 *
 * The entries above describe the fleet at rest — `idleUnits` there is the
 * baseline, i.e. what is free when ComputeX itself is running nothing. This map
 * is the live delta on top of it, so availability reflects actual in-process
 * work instead of sitting frozen at its seed value.
 *
 * In-memory like the job store, and reset by a restart for the same reason.
 */
const inUse = new Map<GpuId, number>();

/** Baseline availability minus whatever this process is currently running. */
function liveAvailability(provider: GpuProvider): GpuProvider["availability"] {
  const held = inUse.get(provider.id) ?? 0;
  const idleUnits = Math.max(provider.availability.idleUnits - held, 0);
  return {
    // An operator-level "offline"/"busy" is not something a finished job undoes,
    // so only an otherwise-available fleet is allowed to flip on occupancy.
    status:
      provider.availability.status === "available" && idleUnits === 0
        ? "busy"
        : provider.availability.status,
    idleUnits,
    totalUnits: provider.availability.totalUnits,
  };
}

const withLiveAvailability = (provider: GpuProvider): GpuProvider => ({
  ...provider,
  availability: liveAvailability(provider),
});

export const listProviders = (): GpuProvider[] => PROVIDERS.map(withLiveAvailability);

export const getProvider = (id: string): GpuProvider | undefined => {
  const provider = PROVIDERS.find((p) => p.id === id);
  return provider ? withLiveAvailability(provider) : undefined;
};

export const SUPPORTED_GPUS = PROVIDERS.map((p) => p.id);

/** Providers that can actually accept a job right now. */
export const isSchedulable = (provider: GpuProvider) =>
  provider.availability.status === "available" && provider.availability.idleUnits > 0;

/**
 * Marks one unit of a provider as busy for the duration of a job.
 *
 * Deliberately not a gate: a caller that reached this point has already paid,
 * and refusing the work because a *simulated* fleet is full would cancel a
 * verified payment over fictional capacity. Occupancy beyond the baseline is
 * therefore allowed, and `liveAvailability` clamps the display at zero idle.
 *
 * @param id - Provider whose capacity is being taken.
 * @returns A function that releases the unit. Call it in a `finally`.
 */
export function reserveUnit(id: GpuId): () => void {
  inUse.set(id, (inUse.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inUse.set(id, Math.max((inUse.get(id) ?? 1) - 1, 0));
  };
}
