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

export const listProviders = (): GpuProvider[] => PROVIDERS.map((p) => ({ ...p }));

export const getProvider = (id: string): GpuProvider | undefined =>
  PROVIDERS.find((p) => p.id === id);

export const SUPPORTED_GPUS = PROVIDERS.map((p) => p.id);

/** Providers that can actually accept a job right now. */
export const isSchedulable = (provider: GpuProvider) =>
  provider.availability.status === "available" && provider.availability.idleUnits > 0;
