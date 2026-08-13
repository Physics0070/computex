/**
 * Generates TRANSACTIONS.md — the on-chain payment history for this project.
 *
 * Reads every USDC transaction touching the payer and payee accounts straight
 * from the Algorand Testnet indexer and writes them out as a table. Nothing here
 * is hand-entered or derived from the server's own records: the job store is
 * in-memory and does not survive a restart, so the chain is the only complete
 * and durable ledger this project has.
 *
 * That also makes the output independently checkable — every row links to the
 * public explorer, so a reader can confirm any line without trusting this repo.
 *
 * Usage: npm run tx:log
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  env,
  explorerAccountUrl,
  explorerTxUrl,
  resolvePayerSecret,
  USDC_TESTNET_ASA_ID,
} from "../src/env.js";

/** Shape of the indexer's transaction records (v2 JSON, kebab-case). */
interface IndexerTransaction {
  id: string;
  "confirmed-round"?: number;
  "round-time"?: number;
  sender: string;
  "tx-type": string;
  "asset-transfer-transaction"?: {
    amount: number;
    "asset-id": number;
    receiver: string;
  };
}

type TxKind = "Job payment" | "USDC opt-in" | "Funding" | "Transfer";

interface Row {
  id: string;
  round: number;
  time: number;
  kind: TxKind;
  amountUsdc: number;
  from: string;
  to: string;
}

const payer = resolvePayerSecret();
const PAYER = payer.address;
const PAYEE = env.payeeAddress;

/**
 * Fetches every USDC transaction for one account, following pagination.
 *
 * @param address - Account to read.
 * @returns All matching transactions the indexer holds.
 */
async function fetchAssetTransactions(address: string): Promise<IndexerTransaction[]> {
  const collected: IndexerTransaction[] = [];
  let nextToken: string | undefined;

  do {
    const url = new URL(`/v2/accounts/${address}/transactions`, env.indexerUrl);
    url.searchParams.set("asset-id", String(USDC_TESTNET_ASA_ID));
    url.searchParams.set("limit", "1000");
    if (nextToken) url.searchParams.set("next", nextToken);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Indexer returned ${res.status} for ${address}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      transactions?: IndexerTransaction[];
      "next-token"?: string;
    };
    collected.push(...(body.transactions ?? []));
    nextToken = body["next-token"];
  } while (nextToken);

  return collected;
}

/**
 * Labels a transfer by what it meant to this project.
 *
 * A zero-amount transfer to yourself is the ASA opt-in every account needs
 * before it can hold USDC; payer -> payee is a settled job; anything else
 * arriving at the payer is the faucet topping it up.
 */
function classify(from: string, to: string, amountUsdc: number): TxKind {
  if (amountUsdc === 0 && from === to) return "USDC opt-in";
  if (from === PAYER && to === PAYEE) return "Job payment";
  if (to === PAYER) return "Funding";
  return "Transfer";
}

/** Shortens an address or tx id for a table cell, keeping both ends recognisable. */
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const label = (address: string) =>
  address === PAYER ? "payer" : address === PAYEE ? "payee" : short(address);

console.log(`\n  Reading USDC history from ${env.indexerUrl}`);
console.log(`  payer ${PAYER}`);
console.log(`  payee ${PAYEE}\n`);

const raw = [...(await fetchAssetTransactions(PAYER)), ...(await fetchAssetTransactions(PAYEE))];

// Both accounts report the same payer->payee transfer, so dedupe on tx id.
const byId = new Map<string, Row>();
for (const tx of raw) {
  const transfer = tx["asset-transfer-transaction"];
  const round = tx["confirmed-round"];
  if (!transfer || transfer["asset-id"] !== USDC_TESTNET_ASA_ID || !round) continue;

  const amountUsdc = transfer.amount / 1e6;
  byId.set(tx.id, {
    id: tx.id,
    round,
    time: tx["round-time"] ?? 0,
    kind: classify(tx.sender, transfer.receiver, amountUsdc),
    amountUsdc,
    from: tx.sender,
    to: transfer.receiver,
  });
}

const rows = [...byId.values()].sort((a, b) => a.round - b.round);
const jobPayments = rows.filter((r) => r.kind === "Job payment");
const settledTotal = jobPayments.reduce((sum, r) => sum + r.amountUsdc, 0);

const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19);

const lines: string[] = [
  "# Transaction history",
  "",
  "Every USDC payment ComputeX has settled on **Algorand Testnet**, read directly from",
  "the chain. GPU execution in this project is simulated; these payments are not.",
  "",
  "This file is generated, never hand-edited — regenerate it with:",
  "",
  "```bash",
  "cd server && npm run tx:log",
  "```",
  "",
  `Generated ${generatedAt} UTC from \`${env.indexerUrl}\`.`,
  "",
  "## Accounts",
  "",
  `| Role | Address |`,
  `| --- | --- |`,
  `| Payer (buyer) | [\`${PAYER}\`](${explorerAccountUrl(PAYER)}) |`,
  `| Payee (GPU provider) | [\`${PAYEE}\`](${explorerAccountUrl(PAYEE)}) |`,
  "",
  `Asset: USDC, ASA \`${USDC_TESTNET_ASA_ID}\` (6 decimals).`,
  "",
  "## Summary",
  "",
  `| | |`,
  `| --- | --- |`,
  `| Job payments settled | **${jobPayments.length}** |`,
  `| Total settled to the provider | **${settledTotal.toFixed(6)} USDC** |`,
  `| USDC transactions on record | ${rows.length} |`,
  "",
  "## Transactions",
  "",
  "Oldest first. Every transaction id links to the public explorer, so any row here",
  "can be verified without trusting this file.",
  "",
  "| # | Time (UTC) | Round | Type | Amount (USDC) | From | To | Transaction |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
];

rows.forEach((row, index) => {
  const when = row.time
    ? new Date(row.time * 1000).toISOString().replace("T", " ").slice(0, 19)
    : "—";
  lines.push(
    `| ${index + 1} | ${when} | ${row.round} | ${row.kind} | ${row.amountUsdc.toFixed(6)} | ` +
      `${label(row.from)} | ${label(row.to)} | [\`${short(row.id)}\`](${explorerTxUrl(row.id)}) |`,
  );
});

if (rows.length === 0) {
  lines.push("| — | — | — | — | — | — | — | _no USDC transactions found yet_ |");
}

lines.push(
  "",
  "## Full transaction ids",
  "",
  "```",
  ...rows.map((row) => `${row.round}  ${row.kind.padEnd(12)}  ${row.amountUsdc.toFixed(6)} USDC  ${row.id}`),
  "```",
  "",
);

const outputPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../TRANSACTIONS.md",
);
await writeFile(outputPath, lines.join("\n"), "utf8");

console.log(`  ${rows.length} USDC transaction(s), ${jobPayments.length} of them job payments`);
console.log(`  ${settledTotal.toFixed(6)} USDC settled to the provider`);
console.log(`\n  wrote ${outputPath}\n`);
