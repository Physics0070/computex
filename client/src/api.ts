/**
 * ComputeX API client.
 *
 * The browser never holds an Algorand key. `runPayAndCompute` streams progress
 * from the server-side payer, which performs the real x402 flow.
 */
import type {
  Catalog,
  ComputeResponse,
  Health,
  Job,
  ParsedIntent,
  PayerEvent,
  Provider,
  RecommendRequest,
  Recommendation,
  Stats,
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { success?: boolean; error?: string };
  if (!res.ok || json.success === false) {
    throw new Error(json.error ?? `${path} responded ${res.status}`);
  }
  return json;
}

export const api = {
  health: () => getJson<Health>("/api/health"),
  catalog: () => getJson<Catalog>("/api/catalog"),
  providers: () => getJson<{ providers: Provider[] }>("/api/providers").then((r) => r.providers),
  jobs: () => getJson<{ jobs: Job[] }>("/api/jobs").then((r) => r.jobs),
  stats: () => getJson<{ stats: Stats }>("/api/stats").then((r) => r.stats),

  recommend: (request: RecommendRequest) =>
    postJson<Recommendation & { success: boolean }>("/api/recommend", request),

  parseIntent: (input: string) =>
    postJson<{ success: boolean; intent: ParsedIntent; recommendation: Recommendation }>(
      "/api/agent/parse",
      { input },
    ),
};

/**
 * Runs the paid compute job, surfacing each x402 step as it happens.
 *
 * The response is an NDJSON stream: one JSON object per line, in real time.
 *
 * @param body - The compute request (workload, model, units, gpu).
 * @param onEvent - Called for every event on the stream.
 * @returns The final compute response, or null if the run failed.
 */
export async function runPayAndCompute(
  body: Record<string, unknown>,
  onEvent: (event: PayerEvent) => void,
): Promise<ComputeResponse | null> {
  const res = await fetch("/api/pay-and-compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Refusals (spend guard, bad request) come back as a single JSON object, not
  // as a stream. Reading those with the NDJSON reader would parse them as an
  // unrecognised event and fail silently, so handle them before streaming.
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(detail ?? `Request failed with status ${res.status}.`);
  }

  if (!res.body) throw new Error("Streaming is not supported by this browser.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: ComputeResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: PayerEvent;
      try {
        event = JSON.parse(line) as PayerEvent;
      } catch {
        continue;
      }
      onEvent(event);
      if (event.type === "result") final = event.data as ComputeResponse;
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }

  return final;
}
