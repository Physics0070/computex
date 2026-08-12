/**
 * Generates a throwaway Algorand Testnet account for the dev payer or payee.
 *
 * Usage: npm run keygen
 *
 * Prints a mnemonic and the base64 secret key. Testnet only — do not reuse a
 * mainnet account here.
 */
import algosdk from "algosdk";

const account = algosdk.generateAccount();
const address = account.addr.toString();

console.log("\n  New Algorand Testnet account");
console.log("  ----------------------------");
console.log(`  Address:            ${address}`);
console.log(`  Mnemonic:           ${algosdk.secretKeyToMnemonic(account.sk)}`);
console.log(`  PAYER_PRIVATE_KEY:  ${Buffer.from(account.sk).toString("base64")}`);
console.log("\n  Next steps");
console.log("  1. Fund with test ALGO:  https://bank.testnet.algorand.network/");
console.log("  2. Opt in + get test USDC: https://faucet.circle.com/  (select Algorand Testnet)");
console.log(`  3. Check status:          npm run check:payer`);
console.log(`  4. Explorer:              https://lora.algokit.io/testnet/account/${address}\n`);
