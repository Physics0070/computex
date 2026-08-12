/** Job history — every compute job run in this session, with payment proof. */
import type { Job } from "../types";
import { Badge, Card, CardHeader, Dot, Empty, Mono, shortId } from "../ui";

export function JobsTable({
  jobs,
  limit,
  title = "Jobs",
  subtitle,
}: {
  jobs: Job[];
  limit?: number;
  title?: string;
  subtitle?: string;
}) {
  const rows = limit ? jobs.slice(0, limit) : jobs;

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle ?? `${jobs.length} job${jobs.length === 1 ? "" : "s"} this session`}
      />
      {rows.length === 0 ? (
        <Empty>
          No jobs yet. Run one from <span className="text-mid">New Compute Job</span> or{" "}
          <span className="text-mid">Agent Mode</span>.
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wider text-low">
                <th className="px-5 py-3 font-medium">Job ID</th>
                <th className="px-3 py-3 font-medium">Workload</th>
                <th className="px-3 py-3 font-medium">GPU</th>
                <th className="px-3 py-3 text-right font-medium">Cost</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((job) => (
                <tr key={job.jobId} className="transition hover:bg-surface-2/50">
                  <td className="px-5 py-3">
                    <Mono className="text-mid">{shortId(job.jobId, 10, 4)}</Mono>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-hi">{job.model}</span>
                    <span className="ml-2 text-xs text-low">{job.workload}</span>
                  </td>
                  <td className="px-3 py-3 text-mid">{job.gpuName}</td>
                  <td className="px-3 py-3 text-right font-mono text-mid">${job.costUsdc}</td>
                  <td className="px-3 py-3">
                    {job.status === "completed" ? (
                      <Badge tone="ok">
                        <Dot tone="ok" />
                        Completed
                      </Badge>
                    ) : (
                      <Badge tone="brand">
                        <Dot tone="brand" pulse />
                        Running
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {job.payment?.explorerUrl ? (
                      <a
                        href={job.payment.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-brand-soft transition hover:text-brand"
                        title={job.payment.transactionId}
                      >
                        View TX
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-xs text-low">
                        {job.payment?.status ?? "pending"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function PaymentsTable({ jobs, limit = 5 }: { jobs: Job[]; limit?: number }) {
  const paid = jobs.filter((j) => j.payment?.transactionId).slice(0, limit);

  return (
    <Card>
      <CardHeader title="Recent Payments" subtitle="Settled on Algorand Testnet" />
      {paid.length === 0 ? (
        <Empty>No settled payments yet.</Empty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {paid.map((job) => (
            <li key={job.jobId} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-brand-soft">
                  {shortId(job.payment!.transactionId!, 12, 8)}
                </p>
                <p className="mt-0.5 text-[11px] text-low">
                  {job.gpuName} · {new Date(job.createdAt).toLocaleTimeString([], { hour12: false })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-sm text-hi">${job.costUsdc}</span>
                <a
                  href={job.payment!.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-soft transition hover:text-brand"
                >
                  View
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
