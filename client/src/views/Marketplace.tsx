/** Marketplace dashboard — fleet at a glance, plus recent activity. */
import type { Job, Provider, Recommendation, Stats } from "../types";
import { Card, CardHeader, StatTile } from "../ui";
import { GpuCard, RecommendationPanel } from "../components/Gpu";
import { JobsTable, PaymentsTable } from "./Jobs";

export function Marketplace({
  stats,
  providers,
  jobs,
  lastRecommendation,
  onNewJob,
}: {
  stats: Stats | null;
  providers: Provider[];
  jobs: Job[];
  lastRecommendation: Recommendation | null;
  onNewJob: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Available GPUs"
          value={stats ? `${stats.availableGpus}/${stats.totalGpus}` : "—"}
          hint={stats ? `${stats.idleUnits} units idle` : undefined}
        />
        <StatTile
          label="Active Jobs"
          value={stats?.activeJobs ?? "—"}
          hint="Running right now"
        />
        <StatTile
          label="Avg Compute Cost"
          value={stats ? `$${stats.averageCostUsdc.toFixed(4)}` : "—"}
          hint={stats ? `${stats.settledPayments} settled payment${stats.settledPayments === 1 ? "" : "s"}` : undefined}
          accent
        />
        <StatTile
          label="Completed Jobs"
          value={stats?.completedJobs ?? "—"}
          hint={stats ? `$${stats.totalSpendUsdc.toFixed(4)} USDC spent` : undefined}
        />
      </div>

      {lastRecommendation?.recommended && (
        <RecommendationPanel recommendation={lastRecommendation} />
      )}

      <Card>
        <CardHeader
          title="Available GPUs"
          subtitle="Live marketplace supply"
          action={
            <button
              onClick={onNewJob}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-mid transition hover:border-brand/50 hover:text-hi"
            >
              New job
            </button>
          }
        />
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => (
            <GpuCard key={p.id} provider={p} />
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <JobsTable jobs={jobs} limit={5} title="Recent Jobs" subtitle="Newest first" />
        <PaymentsTable jobs={jobs} />
      </div>
    </div>
  );
}
