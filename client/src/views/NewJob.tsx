/** New Compute Job — describe the workload, get a GPU, pay, run. */
import { useState } from "react";
import { api } from "../api";
import type { Candidate, Catalog, Priority, RecommendRequest, Recommendation, WorkloadKind } from "../types";
import { Button, Card, CardHeader, Field, inputClass } from "../ui";
import { RecommendationPanel } from "../components/Gpu";
import { RunFlow } from "../components/RunFlow";

const PRIORITY_LABEL: Record<Priority, string> = {
  balanced: "Balanced",
  speed: "Fastest",
  cost: "Cheapest",
  reliability: "Most reliable",
};

export function NewJob({
  catalog,
  onJobFinished,
  onRecommendation,
}: {
  catalog: Catalog | null;
  onJobFinished: () => void;
  onRecommendation: (recommendation: Recommendation) => void;
}) {
  const [workload, setWorkload] = useState<WorkloadKind>("image-generation");
  const [model, setModel] = useState("sdxl");
  const [units, setUnits] = useState(5);
  const [maxBudget, setMaxBudget] = useState("0.20");
  const [priority, setPriority] = useState<Priority>("balanced");

  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = catalog?.workloads.find((w) => w.kind === workload);

  async function findGpu() {
    setLoading(true);
    setError(null);
    setRecommendation(null);
    setSelected(null);
    try {
      const request: RecommendRequest = {
        workload,
        model: model.trim(),
        units,
        priority,
        ...(maxBudget.trim() ? { maxBudget: Number(maxBudget) } : {}),
      };
      const result = await api.recommend(request);
      setRecommendation(result);
      setSelected(result.recommended);
      onRecommendation(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-soft">New workload</p>
        <h2 className="mt-2 text-3xl font-bold tracking-[-0.055em] text-hi">Describe the output.<br />We’ll price the execution.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mid">Choose your requirements, then compare every eligible GPU before committing to a payment.</p>
      </div>
    <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden">
        <CardHeader title="Workload" subtitle="Describe the job — ComputeX picks the GPU" />
        <form
          className="space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void findGpu();
          }}
        >
          <Field label="Workload type">
            <select
              value={workload}
              onChange={(e) => setWorkload(e.target.value as WorkloadKind)}
              className={inputClass}
            >
              {(catalog?.workloads ?? []).map((w) => (
                <option key={w.kind} value={w.kind}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Model" hint={catalog ? `Known: ${catalog.models.slice(0, 5).map((m) => m.id).join(", ")}…` : undefined}>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputClass}
              placeholder="sdxl"
              list="model-list"
            />
            <datalist id="model-list">
              {(catalog?.models ?? []).map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </Field>

          <Field label={`Quantity${spec ? ` (${spec.unit})` : ""}`}>
            <input
              type="number"
              min={1}
              max={1000}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))}
              className={inputClass}
            />
          </Field>

          <Field label="Max budget (USDC)" hint="Leave blank for no limit">
            <input
              value={maxBudget}
              onChange={(e) => setMaxBudget(e.target.value)}
              className={inputClass}
              placeholder="0.20"
              inputMode="decimal"
            />
          </Field>

          <Field label="Priority">
            <div className="grid grid-cols-2 gap-2.5">
              {(catalog?.priorities ?? (["balanced", "speed", "cost", "reliability"] as Priority[])).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                    priority === p
                      ? "border-brand/60 bg-brand/12 text-brand-soft"
                      : "border-line bg-surface-2 text-mid hover:border-line/80 hover:text-hi"
                  }`}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </Field>

          <Button type="submit" disabled={loading || !model.trim()} className="w-full">
            {loading ? "Scoring GPUs…" : "Find Best GPU"}
          </Button>

          {error && <p className="text-xs text-bad">{error}</p>}
        </form>
      </Card>

      <div className="space-y-5">
        {!recommendation && (
          <Card>
            <div className="px-7 py-20 text-center">
              <p className="text-lg font-semibold text-hi">Ready when you are</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-low">
                Describe the workload and ComputeX will score every GPU in the marketplace on
                compatibility, price, speed, reliability and availability.
              </p>
            </div>
          </Card>
        )}

        {recommendation && (
          <RecommendationPanel
            recommendation={recommendation}
            selectedGpu={selected?.gpu}
            onSelect={setSelected}
          />
        )}

        {recommendation && selected && (
          <RunFlow
            requirements={recommendation.requirements}
            candidate={selected}
            onFinished={onJobFinished}
          />
        )}
      </div>
    </div>
    </div>
  );
}
