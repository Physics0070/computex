/**
 * Pera Wallet integration.
 *
 * This is the difference between "the server paid for itself" and "I paid for
 * my own job". When a wallet is connected the browser performs the x402 flow
 * directly against /api/compute: it receives the 402, builds the USDC transfer,
 * asks Pera to sign it, and retries. No key is involved on the server at all.
 *
 * The bridge is `ClientAvmSigner`, the two-member interface @x402/avm expects.
 * Pera speaks in decoded `Transaction` objects and returns only the blobs it
 * signed; x402 speaks in raw bytes with nulls for anything left unsigned. The
 * adapter below is that translation and nothing more.
 */
import { PeraWalletConnect } from "@perawallet/connect";
import type { ClientAvmSigner } from "@x402/avm";
import algosdk from "algosdk";

/** Pera identifies networks by numeric chain id, not CAIP-2. 416002 is Testnet. */
const ALGORAND_TESTNET_CHAIN_ID = 416002;

const pera = new PeraWalletConnect({ chainId: ALGORAND_TESTNET_CHAIN_ID });

export interface WalletSession {
  address: string;
  signer: ClientAvmSigner;
}

/**
 * Wraps a connected Pera account in the signer interface x402 expects.
 *
 * @param address - The connected Algorand address.
 * @returns A signer that routes signing requests to the Pera app.
 */
function toPeraSigner(address: string): ClientAvmSigner {
  return {
    address,

    async signTransactions(txns, indexesToSign) {
      const targets = indexesToSign ?? txns.map((_, index) => index);

      const group = txns.map((raw, index) => {
        const txn = algosdk.decodeUnsignedTransaction(raw);
        // `signers: []` tells Pera this entry belongs to someone else — here the
        // facilitator's sponsored fee-payer transaction, which it signs later.
        // Without it Pera would refuse the whole group as unsignable.
        return targets.includes(index) ? { txn } : { txn, signers: [] };
      });

      const signed = await pera.signTransaction([group]);

      // Pera returns one blob per transaction it signed, in order, with the
      // skipped ones absent. x402 wants a full-length array positioned by
      // original index, so put each blob back where it came from.
      const result: (Uint8Array | null)[] = txns.map(() => null);
      targets.forEach((target, position) => {
        const blob = signed[position];
        if (blob) result[target] = blob;
      });
      return result;
    },
  };
}

/**
 * Opens the Pera connect modal and returns the chosen account.
 *
 * @returns The connected session.
 * @throws If the user closes the modal or grants no account.
 */
export async function connectWallet(): Promise<WalletSession> {
  const accounts = await pera.connect();
  const address = accounts[0];
  if (!address) throw new Error("Pera returned no account.");
  return { address, signer: toPeraSigner(address) };
}

/**
 * Restores a previous session without prompting.
 *
 * Called on page load so a refresh mid-demo does not drop the wallet.
 *
 * @returns The restored session, or null if there was nothing to restore.
 */
export async function restoreWallet(): Promise<WalletSession | null> {
  try {
    const accounts = await pera.reconnectSession();
    const address = accounts[0];
    return address ? { address, signer: toPeraSigner(address) } : null;
  } catch {
    // No stored session, or it expired. Not an error worth surfacing.
    return null;
  }
}

/** Ends the session. Safe to call when nothing is connected. */
export async function disconnectWallet(): Promise<void> {
  try {
    await pera.disconnect();
  } catch {
    // Pera throws when there is no active session; the caller only cares that
    // we end up disconnected, which we do.
  }
}

/**
 * Registers a callback for a disconnect initiated from inside the Pera app.
 *
 * @param listener - Called when the wallet drops the session.
 */
export function onWalletDisconnect(listener: () => void): void {
  pera.connector?.on("disconnect", listener);
}
