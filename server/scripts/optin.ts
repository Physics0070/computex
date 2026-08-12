/**
 * Opts the payer and payee into the USDC ASA on Algorand Testnet.
 *
 * An Algorand account cannot hold or send an ASA until it opts in, so both sides
 * of the payment need this once. Each opt-in is a 0-amount self transfer costing
 * 0.001 ALGO and raising the account's minimum balance by 0.1 ALGO — so fund both
 * accounts with test ALGO first.
 *
 * Usage: npm run optin
 */
import algosdk from "algosdk";
import { env, resolvePayerSecret, USDC_TESTNET_ASA_ID, explorerAccountUrl } from "../src/env.js";

const algod = new algosdk.Algodv2(env.algodToken, env.algodUrl, "");

interface Target {
  role: string;
  addr: string;
  sk: Uint8Array;
}

const targets: Target[] = [];

const payer = resolvePayerSecret();
targets.push({
  role: "PAYER",
  addr: payer.address,
  sk: Buffer.from(payer.privateKeyBase64, "base64"),
});

const payeeMnemonic = process.env.PAYEE_MNEMONIC?.trim();
if (payeeMnemonic) {
  const payee = algosdk.mnemonicToSecretKey(payeeMnemonic);
  targets.push({ role: "PAYEE", addr: payee.addr.toString(), sk: payee.sk });
} else {
  console.log(
    "  PAYEE_MNEMONIC not set — skipping the payee opt-in.\n" +
      "  The payee must still be opted in to USDC to receive payment.\n",
  );
}

/**
 * Opts one account into the USDC ASA, skipping accounts already opted in.
 *
 * @param target - Account to opt in.
 */
async function optIn(target: Target): Promise<void> {
  const info = await algod.accountInformation(target.addr).do().catch(() => null);
  if (!info) {
    console.log(`  ${target.role}  ${target.addr}\n    NOT FUNDED — send test ALGO first.\n`);
    return;
  }
  if ((info.assets ?? []).some((a) => Number(a.assetId) === USDC_TESTNET_ASA_ID)) {
    console.log(`  ${target.role}  ${target.addr}\n    already opted in to USDC.\n`);
    return;
  }
  if (Number(info.amount) < 201_000) {
    console.log(
      `  ${target.role}  ${target.addr}\n` +
        `    only ${Number(info.amount) / 1e6} ALGO — needs ~0.2 ALGO for the opt-in and min balance.\n`,
    );
    return;
  }

  const params = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: target.addr,
    receiver: target.addr,
    amount: 0,
    assetIndex: USDC_TESTNET_ASA_ID,
    suggestedParams: params,
  });

  const signed = txn.signTxn(target.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 6);

  console.log(`  ${target.role}  ${target.addr}\n    opted in — tx ${txid}\n`);
}

console.log(`\n  Opting in to USDC ASA ${USDC_TESTNET_ASA_ID} on Algorand Testnet\n`);
for (const target of targets) {
  await optIn(target);
}
for (const target of targets) {
  console.log(`  ${target.role} explorer: ${explorerAccountUrl(target.addr)}`);
}
console.log("\n  Next: get test USDC for the payer at https://faucet.circle.com/ (Algorand Testnet)\n");
