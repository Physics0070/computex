/** Marketplace dashboard — fleet at a glance, plus recent activity. */
import type { Job, Provider, Recommendation, Stats } from "../types";
import { Button, Card, CardHeader, StatTile } from "../ui";
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
      <section className="hero-orbit rounded-[28px] border border-brand/25 bg-[linear-gradient(120deg,rgba(93,226,194,.2),rgba(16,34,49,.96)_48%,rgba(8,24,36,.98))] px-7 py-8 sm:px-9 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-soft">Intent-aware compute brokerage</p>
        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h2 className="max-w-2xl text-3xl font-bold tracking-[-0.055em] text-hi sm:text-4xl">Give us the workload.<br />We’ll find the compute.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-mid">Tell ComputeX what you need. It selects the best GPU, prices the job, and settles only when execution begins.</p>
          </div>
          <Button onClick={onNewJob} className="shrink-0 px-6 py-3 text-base">New compute job <span aria-hidden="true">→</span></Button>
        </div>
      </section>
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
          title="Live marketplace"
          subtitle="Available compute, refreshed from the provider abstraction"
          action={
            <button
              onClick={onNewJob}
              className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-mid transition hover:border-brand/50 hover:text-hi"
            >
              New job
            </button>
          }
        />
        <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
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
