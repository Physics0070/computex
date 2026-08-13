/**
 * Wallet session shared across the app.
 *
 * A context rather than props because only two places care — the header button
 * and the payment panel — and threading a signer through the view components
 * that sit between them would couple them to something they never use.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectWallet,
  disconnectWallet,
  onWalletDisconnect,
  restoreWallet,
  type WalletSession,
} from "./wallet";

interface WalletContextValue {
  session: WalletSession | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore a previous session on load so a page refresh mid-demo does not
  // silently drop the wallet and fall back to the server payer.
  useEffect(() => {
    void restoreWallet().then((restored) => {
      if (restored) setSession(restored);
    });
    onWalletDisconnect(() => setSession(null));
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setSession(await connectWallet());
    } catch (cause) {
      const message = (cause as Error)?.message ?? "";
      // Closing the modal is a choice, not a failure — do not show it as one.
      if (!/close|cancel|reject/i.test(message)) {
        setError(message || "Could not connect to Pera.");
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await disconnectWallet();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, connecting, error, connect, disconnect }),
    [session, connecting, error, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Reads the wallet session. Throws if used outside the provider. */
export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside <WalletProvider>.");
  return value;
}
