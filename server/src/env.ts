/**
 * Environment configuration for the ComputeX server.
 *
 * Two roles live in this process (see src/index.ts):
 *   - the RESOURCE SERVER  (sells GPU compute, protected by x402)
 *   - the DEV PAYER PROXY  (buys GPU compute on behalf of the browser)
 *
 * The payer secret is only ever read here, server-side. It is never sent to the
 * frontend and never included in any API response.
 */
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import algosdk from "algosdk";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root .env (computex/.env) is the canonical location; server/.env also works.
loadDotenv({ path: path.resolve(here, "../../.env"), quiet: true });
loadDotenv({ path: path.resolve(here, "../.env"), quiet: true });

/** Algorand Testnet CAIP-2 id, full-genesis-hash form (what the facilitator advertises). */
export const ALGORAND_TESTNET_FULL_CAIP2 =
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
/** Algorand Testnet CAIP-2 id, canonical truncated form used inside @x402/avm. */
export const ALGORAND_TESTNET_CANONICAL_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe";
/** USDC ASA id on Algorand Testnet. */
export const USDC_TESTNET_ASA_ID = 10458941;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/**
 * Resolves the payer's base64 secret key.
 *
 * `@x402/avm`'s `toClientAvmSigner` wants a base64-encoded 64-byte Algorand secret
 * key. A 25-word mnemonic is friendlier to paste around during a hackathon, so we
 * accept either and normalise to the base64 form.
 */
export function resolvePayerSecret(): { address: string; privateKeyBase64: string } {
  const rawKey = process.env.PAYER_PRIVATE_KEY?.trim();
  const mnemonic = process.env.PAYER_MNEMONIC?.trim();

  if (!rawKey && !mnemonic) {
    throw new Error(
      "No payer credentials found. Set PAYER_PRIVATE_KEY (base64 64-byte key) or PAYER_MNEMONIC (25 words) in .env.",
    );
  }

  if (mnemonic) {
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    return {
      address: account.addr.toString(),
      privateKeyBase64: Buffer.from(account.sk).toString("base64"),
    };
  }

  const sk = Buffer.from(rawKey!, "base64");
  if (sk.length !== 64) {
    throw new Error(
      `PAYER_PRIVATE_KEY must decode to 64 bytes, got ${sk.length}. Use \`npm run keygen\` or set PAYER_MNEMONIC instead.`,
    );
  }
  const address = algosdk.encodeAddress(sk.subarray(32));
  return { address, privateKeyBase64: sk.toString("base64") };
}

export const env = {
  port: Number(optional("PORT", "4021")),

  /** x402 facilitator that verifies + settles on Algorand. */
  facilitatorUrl: optional("X402_FACILITATOR_URL", "https://facilitator.goplausible.xyz"),

  /**
   * CAIP-2 network for the protected route. Left blank by default so the server
   * discovers the exact string the facilitator advertises at startup — the
   * facilitator currently uses the full-genesis-hash form and the lookup in
   * @x402/core is an exact string match.
   */
  networkOverride: process.env.ALGORAND_NETWORK?.trim() || undefined,

  /** Algod node used by the client-side signer to build the payment group. */
  algodUrl: optional("ALGOD_URL", "https://testnet-api.algonode.cloud"),
  algodToken: optional("ALGOD_TOKEN", ""),
  indexerUrl: optional("INDEXER_URL", "https://testnet-idx.algonode.cloud"),

  /** The GPU provider's Algorand address — USDC lands here. */
  payeeAddress: required("PAYEE_ADDRESS"),

  /** Where the dev payer proxy sends its paid requests. */
  resourceBaseUrl: optional("RESOURCE_BASE_URL", `http://127.0.0.1:${optional("PORT", "4021")}`),

  /** Comma-separated origins allowed to call the payer proxy. */
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  /**
   * Built frontend to serve. When present the server is a single origin and the
   * browser calls /api directly — no CORS, no dev proxy. Set CLIENT_DIST to
   * override the default (client/dist next to the server package).
   */
  clientDist: process.env.CLIENT_DIST?.trim() || path.resolve(here, "../../client/dist"),

  /* -- shared-payer protection (see src/guard.ts) -------------------- */

  /** Largest single job the shared demo payer will fund, in USDC. */
  maxJobPriceUsdc: Number(optional("MAX_JOB_PRICE_USDC", "0.50")),
  /** Paid jobs allowed per client per window. */
  rateLimitMaxJobs: Number(optional("RATE_LIMIT_MAX_JOBS", "10")),
  rateLimitWindowMs: Number(optional("RATE_LIMIT_WINDOW_MS", String(15 * 60_000))),
  /** When set, /api/pay-and-compute requires this value in x-computex-token. */
  demoAccessToken: process.env.DEMO_ACCESS_TOKEN?.trim() || "",
};

export const explorerTxUrl = (txId: string) => `https://lora.algokit.io/testnet/transaction/${txId}`;
export const explorerAccountUrl = (address: string) =>
  `https://lora.algokit.io/testnet/account/${address}`;
