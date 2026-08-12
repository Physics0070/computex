/**
 * In-process stage bus.
 *
 * The x402 middleware buffers a protected route's response body so it can settle
 * afterwards, which rules out streaming progress directly out of /api/compute.
 * Instead the handler publishes each stage here as it happens, keyed by a trace id
 * the caller supplies, and the dev payer proxy (same process, see src/payer.ts)
 * relays them to the browser live.
 *
 * This works only because the buyer proxy and the resource server share a process
 * in this prototype. A real buyer on another machine would poll GET /api/jobs/:id.
 */
import { EventEmitter } from "node:events";
import type { Stage } from "./compute.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export const TRACE_HEADER = "x-computex-trace";

export interface TraceMessage {
  jobId: string;
  stage: Stage;
}

export const publishStage = (traceId: string, message: TraceMessage) => {
  emitter.emit(traceId, message);
};

/**
 * Subscribes to stage updates for one trace id.
 *
 * @param traceId - Trace id shared between the payer proxy and the compute handler.
 * @param listener - Called for each published stage.
 * @returns Unsubscribe function.
 */
export function subscribeToTrace(traceId: string, listener: (message: TraceMessage) => void) {
  emitter.on(traceId, listener);
  return () => emitter.off(traceId, listener);
}
