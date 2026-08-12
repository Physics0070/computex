/**
 * Pre-flight check for the Algorand Testnet setup.
 *
 * Verifies that the payer and payee accounts exist, hold enough ALGO for their
 * minimum balance, and are opted in to the USDC ASA. An account that is not
 * opted in cannot send or receive USDC, which is the most common reason the
 * x402 flow fails on a fresh setup.
 *
 * Usage: npm run check:payer
 */
import algosdk from "algosdk";
import { env, resolvePayerSecret, USDC_TESTNET_ASA_ID, explorerAccountUrl } from "../src/env.js";

const algod = new algosdk.Algodv2(env.algodToken, env.algodUrl, "");

interface AccountStatus {
  role: string;
  address: string;
  exists: boolean;
  algo: number;
  usdc: number | null;
  optedIn: boolean;
}

/**
 * Reads on-chain balances for one account.
 *
 * @param role - Human-readable label for the report.
 * @param address - Algorand address to inspect.
 * @returns The account's ALGO balance, USDC balance and opt-in status.
 */
async function inspect(role: string, address: string): Promise<AccountStatus> {
  try {
    const info = await algod.accountInformation(address).do();
    const assets = info.assets ?? [];
    const usdcHolding = assets.find((a) => Number(a.assetId) === USDC_TESTNET_ASA_ID);
    return {
      role,
      address,
      exists: true,
      algo: Number(info.amount) / 1e6,
      usdc: usdcHolding ? Number(usdcHolding.amount) / 1e6 : null,
      optedIn: Boolean(usdcHolding),
    };
  } catch {
    return { role, address, exists: false, algo: 0, usdc: null, optedIn: false };
  }
}

const payer = resolvePayerSecret();

const results = await Promise.all([
  inspect("PAYER (buyer)", payer.address),
  inspect("PAYEE (GPU provider)", env.payeeAddress),
]);

console.log(`\n  Algod:      ${env.algodUrl}`);
console.log(`  USDC ASA:   ${USDC_TESTNET_ASA_ID} (Algorand Testnet)\n`);

let ready = true;
for (const r of results) {
  console.log(`  ${r.role}`);
  console.log(`    address:  ${r.address}`);
  if (!r.exists) {
    console.log(`    status:   NOT FOUND on Testnet — fund it to create it`);
    ready = false;
  } else {
    console.log(`    ALGO:     ${r.algo}`);
    console.log(`    USDC:     ${r.optedIn ? r.usdc : "not opted in"}`);
    if (!r.optedIn) ready = false;
    if (r.algo < 0.2) {
      console.log(`    warning:  low ALGO — opt-ins need ~0.1 ALGO of minimum balance`);
      ready = false;
    }
  }
  console.log(`    explorer: ${explorerAccountUrl(r.address)}\n`);
}

const payerStatus = results[0]!;
if (payerStatus.optedIn && (payerStatus.usdc ?? 0) <= 0) {
  console.log("  Payer is opted in but holds 0 USDC. Get test USDC: https://faucet.circle.com/\n");
  ready = false;
}

// The facilitator sponsors transaction fees, so its address only needs to exist.
try {
  const supported = await fetch(new URL("/supported", env.facilitatorUrl)).then((r) => r.json());
  const kinds = (supported as { kinds?: Array<{ network: string; scheme: string }> }).kinds ?? [];
  const algorandKinds = kinds.filter((k) => k.network.startsWith("algorand:"));
  console.log(`  Facilitator ${env.facilitatorUrl}`);
  console.log(`    algorand kinds: ${algorandKinds.map((k) => k.network).join(", ") || "none"}\n`);
  if (algorandKinds.length === 0) ready = false;
} catch (error) {
  console.log(`  Facilitator unreachable: ${(error as Error).message}\n`);
  ready = false;
}

console.log(ready ? "  READY — the x402 flow should work.\n" : "  NOT READY — fix the items above.\n");
process.exit(ready ? 0 : 1);
