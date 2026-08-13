/**
 * The paid-execution panel: Pay & Run, live x402 state machine, and the result.
 *
 * Shared by "New Compute Job" and "Agent Mode" so there is exactly one payment
 * implementation in the UI, backed by the one x402 endpoint on the server.
 *
 * The step order mirrors what the protocol actually does. The x402 `authorization`
 * flow verifies the signed payment *before* the handler runs and settles it
 * *after* the job succeeds — so settlement, and therefore the transaction id, is
 * genuinely the last thing to arrive.
 */
import { useState } from "react";
import { runPayAndCompute } from "../api";
import { runWalletPayAndCompute } from "../walletPay";
import { useWallet } from "../walletContext";
import type { Candidate, ComputeResponse, PayerEvent, RecommendRequest } from "../types";
import { Badge, Button, Card, CardHeader, Dot, Mono, shortId } from "../ui";

type StepKey =
  | "quote"
  | "signed"
  | "verified"
  | "running"
  | "completed"
  | "settled";

const STEPS: Array<{ key: StepKey; label: string; caption: string }> = [
  { key: "quote", label: "402 Payment Required", caption: "Server quoted the workload" },
  { key: "signed", label: "Payment Signed", caption: "USDC transfer group signed" },
  { key: "verified", label: "Payment Verified", caption: "Facilitator validated the payment" },
  { key: "running", label: "GPU Job Running", caption: "Simulated compute in progress" },
  { key: "completed", label: "Job Completed", caption: "Artifacts produced" },
  { key: "settled", label: "Payment Settled", caption: "Confirmed on Algorand Testnet" },
];

type StepState = "idle" | "active" | "done" | "failed";

const UNIT_FIELD: Record<string, string> = {
  "image-generation": "images",
  "text-inference": "tokens",
  "video-upscale": "seconds",
  "fine-tune": "steps",
};

export function RunFlow({
  requirements,
  candidate,
  onFinished,
}: {
  requirements: RecommendRequest;
  candidate: Candidate;
  onFinished: () => void;
}) {
  const { session } = useWallet();
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<StepKey, StepState>>(initialStates());
  const [log, setLog] = useState<PayerEvent[]>([]);
  const [result, setResult] = useState<ComputeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function initialStates(): Record<StepKey, StepState> {
    return { quote: "idle", signed: "idle", verified: "idle", running: "idle", completed: "idle", settled: "idle" };
  }

  const mark = (key: StepKey, state: StepState) =>
    setStates((prev) => ({ ...prev, [key]: state }));

  async function run() {
    setRunning(true);
    setStates({ ...initialStates(), quote: "active" });
    setLog([]);
    setResult(null);
    setError(null);

    const body: Record<string, unknown> = {
      workload: requirements.workload,
      model: requirements.model,
      gpu: candidate.gpu,
      units: requirements.units,
      [UNIT_FIELD[requirements.workload] ?? "units"]: requirements.units,
    };

    const onEvent = (event: PayerEvent) => {
      setLog((prev) => [...prev, event]);
      applyEvent(event);
    };

    try {
      // A connected wallet pays for its own job; otherwise the server's shared
      // demo payer covers it. Both emit the same events, so everything below
      // this line is identical for the two paths.
      const final = session
        ? await runWalletPayAndCompute(session.signer, body, onEvent)
        : await runPayAndCompute(body, onEvent);
      if (final) {
        setResult(final);
        mark("settled", final.payment?.status === "settled" ? "done" : "failed");
      }
      onFinished();
    } catch (err) {
      setError((err as Error).message);
      setStates((prev) => {
        const next = { ...prev };
        for (const step of STEPS) if (next[step.key] === "active") next[step.key] = "failed";
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  function applyEvent(event: PayerEvent) {
    const data = event.data as { amountMicroUsdc?: string; stage?: string } | undefined;
    switch (event.type) {
      case "quote":
        if (data?.amountMicroUsdc) {
          mark("quote", "done");
          mark("signed", "active");
        }
        break;
      case "payment-signed":
        mark("quote", "done");
        mark("signed", "done");
        mark("verified", "active");
        break;
      case "stage": {
        const stage = (event.data as { stage?: string } | undefined)?.stage;
        if (stage === "payment-verified") {
          mark("verified", "done");
          mark("running", "active");
        } else if (stage === "gpu-allocated" || stage === "job-running") {
          mark("verified", "done");
          mark("running", "active");
        } else if (stage === "job-completed") {
          mark("running", "done");
          mark("completed", "done");
          mark("settled", "active");
        }
        break;
      }
      case "payment-settled":
        mark("completed", "done");
        mark("settled", "done");
        break;
      case "payment-failed":
        mark("settled", "failed");
        break;
      default:
        break;
    }
  }

  const settled = result?.payment?.status === "settled";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Execute"
          subtitle={`${candidate.name} · ${requirements.units} ${requirements.workload === "image-generation" ? "images" : "units"} · ${requirements.model}`}
          action={
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-low">Total</p>
              <p className="font-mono text-lg font-semibold text-hi">
                ${candidate.estimatedCostUsdc}
              </p>
            </div>
          }
        />
        <div className="p-5">
          <Button onClick={run} disabled={running} className="w-full sm:w-auto">
            {running ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Running…
              </>
            ) : (
              <>Pay &amp; Run</>
            )}
          </Button>
          <p className="mt-3 text-xs text-low">
            Pays {candidate.estimatedCostUsdc} USDC on Algorand Testnet via x402, then runs the
            simulated job. GPU execution is simulated; the payment is real.
          </p>
          {/* Which account is charged is the whole point of connecting a wallet,
              so say it plainly next to the button rather than leaving it implied. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {session ? (
              <>
                <Dot tone="ok" />
                <span className="text-mid">Charged to your Pera wallet</span>
                <Mono className="text-low">{shortId(session.address, 6, 4)}</Mono>
                <span className="text-low">— you approve it in the app.</span>
              </>
            ) : (
              <>
                <Dot tone="warn" />
                <span className="text-mid">Charged to the shared demo payer.</span>
                <span className="text-low">Connect Pera to pay from your own wallet.</span>
              </>
            )}
          </p>
        </div>
      </Card>

      {(running || result || error) && (
        <Card className="fade-up">
          <CardHeader title="Payment &amp; execution" subtitle="x402 · Algorand Testnet" />
          <ol className="divide-y divide-line-soft">
            {STEPS.map((step, i) => {
              const state = states[step.key];
              return (
                <li key={step.key} className="flex items-center gap-3 px-5 py-3">
                  <StepIcon state={state} index={i + 1} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium ${
                        state === "idle" ? "text-low" : state === "failed" ? "text-bad" : "text-hi"
                      }`}
                    >
                      {step.label}
                    </p>
                    <p className="text-xs text-low">{step.caption}</p>
                  </div>
                  {state === "active" && <Badge tone="brand">in progress</Badge>}
                  {state === "done" && <Badge tone="ok">done</Badge>}
                  {state === "failed" && <Badge tone="bad">failed</Badge>}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {error && (
        <Card className="border-bad/40 fade-up">
          <div className="p-5">
            <p className="text-sm font-medium text-bad">Run failed</p>
            <p className="mt-1 text-sm text-mid">{error}</p>
            <p className="mt-3 text-xs text-low">
              Common causes: the payer account holds no Testnet USDC, is not opted in to ASA
              10458941, or the facilitator is unreachable. Run <Mono>npm run check:payer</Mono> in
              the server directory.
            </p>
          </div>
        </Card>
      )}

      {result && (
        <Card className={`fade-up ${settled ? "border-ok/40" : "border-warn/40"}`}>
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full ${
                  settled ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"
                }`}
              >
                {settled ? <CheckIcon /> : <AlertIcon />}
              </span>
              <div>
                <p className={`text-base font-semibold ${settled ? "text-ok" : "text-warn"}`}>
                  {settled ? "Payment Settled" : `Payment ${result.payment?.status ?? "unknown"}`}
                </p>
                <p className="text-xs text-low">
                  Job {result.jobId} · {result.result?.simulated ? "simulated compute" : "compute"}{" "}
                  complete
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-low">Cost</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-hi">
                  ${Number(result.quote.priceUsdc).toFixed(4)} USDC
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-low">Network</dt>
                <dd className="mt-1 text-sm text-hi">{result.payment?.network ?? "Algorand Testnet"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-low">GPU</dt>
                <dd className="mt-1 text-sm text-hi">{candidate.name}</dd>
              </div>
            </dl>

            <div className="mt-5 rounded-lg border border-line bg-surface-2 p-4">
              <p className="text-[11px] uppercase tracking-wider text-low">Transaction ID</p>
              <p className="mt-1 break-all font-mono text-sm text-brand-soft">
                {result.payment?.transactionId ?? "—"}
              </p>
              {result.payment?.payer && (
                <p className="mt-2 text-xs text-low">
                  Paid by <Mono>{shortId(result.payment.payer, 10, 8)}</Mono>
                </p>
              )}
            </div>

            {result.payment?.explorerUrl && (
              <a
                href={result.payment.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand/20 transition hover:bg-brand/85"
              >
                View Transaction
                <ExternalIcon />
              </a>
            )}

            {result.result && (
              <div className="mt-6 border-t border-line-soft pt-5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-hi">Result</p>
                  <Badge tone="warn">simulated</Badge>
                </div>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
                  <Metric label="Artifacts" value={String(result.result.artifacts.length)} />
                  <Metric label="GPU seconds" value={String(result.result.metrics.gpuSecondsUsed)} />
                  <Metric label="Peak VRAM" value={`${result.result.metrics.vramPeakMb} MB`} />
                  <Metric label="Throughput" value={result.result.metrics.throughput} />
                </dl>
                <ul className="mt-4 space-y-1.5">
                  {result.result.artifacts.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-soft bg-surface-2/60 px-3 py-2"
                    >
                      <Mono className="text-mid">{a.uri}</Mono>
                      <span className="text-[11px] text-low">
                        {a.kind} · {(a.bytes / 1024).toFixed(0)} KB
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {log.length > 0 && (
        <Card>
          <CardHeader title="Protocol log" subtitle="Live events from the x402 client" />
          <ul className="max-h-64 space-y-1 overflow-y-auto p-4">
            {log.map((event, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <Mono className="shrink-0 text-low">
                  {new Date(event.at).toLocaleTimeString([], { hour12: false })}
                </Mono>
                <span className="shrink-0 text-low">[{event.type}]</span>
                <span className="text-mid">{event.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line-soft bg-surface-2/60 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-low">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-hi">{value}</dd>
    </div>
  );
}

function StepIcon({ state, index }: { state: StepState; index: number }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
        <CheckIcon small />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bad/15 text-bad">
        <AlertIcon small />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15">
        <Dot tone="brand" pulse />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-medium text-low">
      {index}
    </span>
  );
}

function CheckIcon({ small = false }: { small?: boolean }) {
  const s = small ? 12 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon({ small = false }: { small?: boolean }) {
  const s = small ? 12 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 8v5M12 16.5v.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
