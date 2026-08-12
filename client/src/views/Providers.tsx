/** Provider view — supply side of the marketplace. Mock fleet, real revenue. */
import type { Provider } from "../types";
import { Badge, Card, CardHeader, Dot, Meter, Mono } from "../ui";

const STATUS_TONE = { available: "ok", busy: "warn", offline: "bad" } as const;

export function Providers({ providers }: { providers: Provider[] }) {
  const totalRevenue = providers.reduce((n, p) => n + p.revenueUsd, 0);
  const sessionRevenue = providers.reduce((n, p) => n + p.sessionRevenueUsd, 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Providers"
          subtitle="GPU supply connected to ComputeX"
          action={
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-low">Lifetime revenue</p>
              <p className="font-mono text-sm font-semibold text-hi">
                ${totalRevenue.toFixed(2)}
              </p>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wider text-low">
                <th className="px-5 py-3 font-medium">GPU</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Jobs completed</th>
                <th className="px-3 py-3 text-right font-medium">Reliability</th>
                <th className="px-3 py-3 text-right font-medium">Revenue</th>
                <th className="px-5 py-3 font-medium">Capacity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {providers.map((p) => {
                const tone = STATUS_TONE[p.availability.status];
                const utilisation =
                  ((p.availability.totalUnits - p.availability.idleUnits) / p.availability.totalUnits) * 100;
                return (
                  <tr key={p.id} className="transition hover:bg-surface-2/50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-hi">{p.gpu}</p>
                      <p className="mt-0.5 text-[11px] text-low">
                        {p.providerName} · {p.region} · {p.vramGb} GB
                      </p>
                    </td>
                    <td className="px-3 py-3.5">
                      <Badge tone={tone}>
                        <Dot tone={tone} />
                        {p.availability.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <span className="font-mono text-mid">{p.jobsCompleted.toLocaleString()}</span>
                      {p.sessionJobs > 0 && (
                        <span className="ml-1.5 text-[11px] text-ok">+{p.sessionJobs}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-right font-mono text-mid">
                      {(p.reliability * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <span className="font-mono text-mid">${p.revenueUsd.toFixed(2)}</span>
                      {p.sessionRevenueUsd > 0 && (
                        <span className="ml-1.5 text-[11px] text-ok">
                          +${p.sessionRevenueUsd.toFixed(4)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Meter value={utilisation} tone={utilisation > 80 ? "warn" : "brand"} />
                        <Mono className="shrink-0 text-low">
                          {p.availability.idleUnits}/{p.availability.totalUnits}
                        </Mono>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="px-1 text-xs text-low">
        Fleet data is mock supply for the prototype. Revenue includes{" "}
        <span className="text-ok">${sessionRevenue.toFixed(4)}</span> actually settled in USDC on
        Algorand Testnet during this session.
      </p>
    </div>
  );
}
