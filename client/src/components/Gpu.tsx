/** GPU presentation: marketplace cards and scored recommendation candidates. */
import type { ReactNode } from "react";
import type { Candidate, Provider, Recommendation } from "../types";
import { Badge, Card, CardHeader, Dot, Meter } from "../ui";

const STATUS_TONE = { available: "ok", busy: "warn", offline: "bad" } as const;

export function GpuCard({
  provider,
  selected = false,
  footer,
}: {
  provider: Provider;
  selected?: boolean;
  footer?: ReactNode;
}) {
  const tone = STATUS_TONE[provider.availability.status];
  const utilisation =
    ((provider.availability.totalUnits - provider.availability.idleUnits) /
      provider.availability.totalUnits) *
    100;

  return (
    <Card className={`p-5 transition ${selected ? "border-brand/60 ring-1 ring-brand/25" : "hover:border-line/80"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-hi">{provider.gpu}</h3>
          <p className="mt-0.5 truncate text-xs text-low">
            {provider.providerName} · {provider.region}
          </p>
        </div>
        <Badge tone={tone}>
          <Dot tone={tone} />
          {provider.availability.status}
        </Badge>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Spec label="VRAM" value={`${provider.vramGb} GB`} />
        <Spec label="Base price" value={`$${provider.basePriceUsd.toFixed(2)}`} />
        <Spec label="Reliability" value={`${(provider.reliability * 100).toFixed(0)}%`} />
        <Spec label="Rel. speed" value={`${provider.speedFactor.toFixed(2)}x`} />
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-low">
          <span>Fleet utilisation</span>
          <span className="tabular-nums">
            {provider.availability.idleUnits}/{provider.availability.totalUnits} idle
          </span>
        </div>
        <Meter value={utilisation} tone={utilisation > 80 ? "warn" : "brand"} />
      </div>

      {footer && <div className="mt-4 border-t border-line-soft pt-4">{footer}</div>}
    </Card>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-low">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-hi">{value}</dd>
    </div>
  );
}

export function RecommendationPanel({
  recommendation,
  selectedGpu,
  onSelect,
}: {
  recommendation: Recommendation;
  selectedGpu?: string;
  onSelect?: (candidate: Candidate) => void;
}) {
  const { recommended, reason, candidates, overBudget } = recommendation;

  return (
    <Card className="fade-up">
      <CardHeader
        title="Recommended GPU"
        subtitle={`Deterministic scoring · priority: ${recommendation.requirements.priority}`}
        action={
          recommended ? (
            <Badge tone={overBudget ? "warn" : "brand"}>
              {overBudget ? "over budget" : `match ${recommended.score}`}
            </Badge>
          ) : undefined
        }
      />

      {recommended ? (
        <div className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xl font-semibold tracking-tight text-hi">{recommended.name}</p>
              <p className="mt-0.5 text-xs text-low">
                {recommended.providerName} · {recommended.vramGb} GB VRAM ·{" "}
                {(recommended.reliability * 100).toFixed(0)}% reliability
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl font-semibold text-hi">
                ${recommended.estimatedCostUsdc}
              </p>
              <p className="text-xs text-low">~{recommended.estimatedSeconds}s estimated</p>
            </div>
          </div>

          <p className="mt-4 rounded-lg border border-brand/25 bg-brand/[0.07] p-3.5 text-sm leading-relaxed text-mid">
            {reason}
          </p>

          <div className="mt-5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-low">
              All GPUs considered
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-low">
                    <th className="pb-2 font-medium">GPU</th>
                    <th className="pb-2 font-medium">VRAM</th>
                    <th className="pb-2 text-right font-medium">Cost</th>
                    <th className="pb-2 text-right font-medium">Time</th>
                    <th className="pb-2 text-right font-medium">Score</th>
                    <th className="pb-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {candidates.map((c) => {
                    const isSelected = (selectedGpu ?? recommended.gpu) === c.gpu;
                    return (
                      <tr
                        key={c.gpu}
                        onClick={() => c.eligible && onSelect?.(c)}
                        className={`${c.eligible && onSelect ? "cursor-pointer" : ""} ${
                          isSelected ? "bg-brand/[0.06]" : c.eligible ? "hover:bg-surface-2/60" : "opacity-55"
                        }`}
                      >
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            {isSelected && <Dot tone="brand" />}
                            <span className={isSelected ? "font-medium text-hi" : "text-mid"}>
                              {c.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 font-mono text-xs text-mid">{c.vramGb} GB</td>
                        <td className="py-2.5 text-right font-mono text-xs text-mid">
                          ${c.estimatedCostUsdc}
                        </td>
                        <td className="py-2.5 text-right font-mono text-xs text-mid">
                          {c.estimatedSeconds}s
                        </td>
                        <td className="py-2.5 text-right font-mono text-xs text-mid">
                          {c.eligible ? c.score : "—"}
                        </td>
                        <td className="py-2.5 pl-3">
                          {c.eligible ? (
                            <Badge tone="ok">eligible</Badge>
                          ) : (
                            <span className="text-[11px] text-low" title={c.rejectionReason}>
                              {c.rejectionReason}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {onSelect && (
              <p className="mt-2 text-[11px] text-low">
                Click any eligible row to override the recommendation.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-5">
          <p className="text-sm text-warn">{reason}</p>
        </div>
      )}
    </Card>
  );
}
