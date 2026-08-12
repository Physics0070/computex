/**
 * Agent Mode — plain English in, structured requirements out.
 *
 * The parser is deterministic and runs on the server; this view exists to make the
 * translation visible: intent -> requirements -> recommendation -> payment -> result.
 */
import { useState } from "react";
import { api } from "../api";
import type { Candidate, ParsedIntent, Recommendation } from "../types";
import { Badge, Button, Card, CardHeader, Mono, inputClass } from "../ui";
import { RecommendationPanel } from "../components/Gpu";
import { RunFlow } from "../components/RunFlow";

const EXAMPLES = [
  "Generate 5 SDXL images under $0.20, prioritize balanced performance.",
  "I need to generate 10 images using SDXL under $0.20 and prioritize speed.",
  "Run llama 3 70b on 100k tokens, needs to be reliable, max $2",
  "Upscale 30 seconds of video as cheaply as possible",
];

export function AgentMode({
  onJobFinished,
  onRecommendation,
}: {
  onJobFinished: () => void;
  onRecommendation: (recommendation: Recommendation) => void;
}) {
  const [input, setInput] = useState(EXAMPLES[0]!);
  const [intent, setIntent] = useState<ParsedIntent | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    setIntent(null);
    setRecommendation(null);
    setSelected(null);
    try {
      const result = await api.parseIntent(input);
      setIntent(result.intent);
      setRecommendation(result.recommendation);
      setSelected(result.recommendation.recommended);
      onRecommendation(result.recommendation);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Agent Mode"
          subtitle="Describe what you need in plain English — deterministic parser, no LLM"
        />
        <div className="p-5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="I need to generate 10 images using SDXL under $0.20 and prioritize speed."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => void submit()} disabled={loading || !input.trim()}>
              {loading ? "Parsing…" : "Interpret & Recommend"}
            </Button>
            <span className="text-[11px] text-low">⌘/Ctrl + Enter</span>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] uppercase tracking-wider text-low">Try</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => setInput(e)}
                  className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-left text-[11px] text-mid transition hover:border-brand/40 hover:text-hi"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-bad">{error}</p>}
        </div>
      </Card>

      {intent && (
        <Card className="fade-up">
          <CardHeader title="Extracted requirements" subtitle="Every field traced back to your words" />
          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FieldChip label="Workload" value={intent.fields.workload.value} field={intent.fields.workload} />
              <FieldChip label="Model" value={intent.fields.model.value} field={intent.fields.model} />
              <FieldChip label="Quantity" value={String(intent.fields.units.value)} field={intent.fields.units} />
              <FieldChip
                label="Budget"
                value={intent.fields.maxBudget.value ? `$${intent.fields.maxBudget.value}` : "none"}
                field={intent.fields.maxBudget}
              />
              <FieldChip label="Priority" value={intent.fields.priority.value} field={intent.fields.priority} />
            </div>

            {intent.notes.length > 0 && (
              <ul className="mt-4 space-y-1">
                {intent.notes.map((note, i) => (
                  <li key={i} className="text-xs text-low">
                    · {note}
                  </li>
                ))}
              </ul>
            )}
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
  );
}

function FieldChip({
  label,
  value,
  field,
}: {
  label: string;
  value: string;
  field: { matched: string | null; source: "parsed" | "default" | "inferred" };
}) {
  const tone = field.source === "parsed" ? "ok" : field.source === "inferred" ? "warn" : "neutral";
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-low">{label}</p>
        <Badge tone={tone}>{field.source}</Badge>
      </div>
      <p className="mt-1.5 truncate text-sm font-medium text-hi">{value}</p>
      {field.matched && (
        <p className="mt-1 truncate text-[11px] text-low">
          from <Mono className="text-brand-soft">“{field.matched}”</Mono>
        </p>
      )}
    </div>
  );
}
