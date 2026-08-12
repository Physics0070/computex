/**
 * Spend guard for the dev payer proxy.
 *
 * /api/pay-and-compute signs USDC with the server's own key. That is fine on
 * localhost, but the moment it is deployed to a public URL it becomes an open
 * faucet: anyone who finds it can drain the payer account one job at a time.
 *
 * Three cheap defences, all configurable:
 *   - a per-job price ceiling, so one request cannot spend the whole balance
 *   - a per-client rate limit
 *   - an optional shared token, for a demo you would rather keep private
 *
 * None of this touches the x402 path itself — a caller holding their own wallet
 * can still pay /api/compute directly without passing through here.
 */
import { env } from "./env.js";

export interface GuardVerdict {
  allowed: boolean;
  status: 402 | 429 | 401;
  reason: string;
}

const ALLOWED: GuardVerdict = { allowed: true, status: 402, reason: "" };

/** Request timestamps per client, newest last. Trimmed on every check. */
const hits = new Map<string, number[]>();

/**
 * Identifies the caller behind a proxy.
 *
 * Platforms terminate TLS upstream, so the socket address is the load balancer.
 * `x-forwarded-for` is spoofable, which is acceptable here: this limits casual
 * abuse of a testnet demo, it is not an authentication boundary.
 *
 * @param headers - Incoming request headers.
 * @returns A key to rate-limit on.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "local";
}

/**
 * Decides whether a paid run may proceed.
 *
 * @param headers - Incoming request headers.
 * @param priceUsdc - Quoted price of the job in USDC.
 * @returns Whether to run, and why not if refused.
 */
export function checkSpend(headers: Headers, priceUsdc: number): GuardVerdict {
  if (env.demoAccessToken) {
    const presented = headers.get("x-computex-token");
    if (presented !== env.demoAccessToken) {
      return {
        allowed: false,
        status: 401,
        reason: "This deployment requires an access token. Send it as the x-computex-token header.",
      };
    }
  }

  if (priceUsdc > env.maxJobPriceUsdc) {
    return {
      allowed: false,
      status: 402,
      reason:
        `This job quotes $${priceUsdc.toFixed(4)} USDC, above the $${env.maxJobPriceUsdc.toFixed(2)} ` +
        `per-job ceiling on the shared demo payer. Reduce the job size, or pay /api/compute from your own wallet.`,
    };
  }

  const key = clientKey(headers);
  const now = Date.now();
  const windowStart = now - env.rateLimitWindowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (recent.length >= env.rateLimitMaxJobs) {
    const retryInSec = Math.ceil((recent[0]! + env.rateLimitWindowMs - now) / 1000);
    return {
      allowed: false,
      status: 429,
      reason:
        `Rate limit reached (${env.rateLimitMaxJobs} paid jobs per ` +
        `${Math.round(env.rateLimitWindowMs / 60000)} minutes). Try again in ${retryInSec}s.`,
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return ALLOWED;
}
