/**
 * Pera Wallet connect control.
 *
 * Doubles as the indicator for *which account is paying*: connected means the
 * next job is charged to the user's own wallet, disconnected means it falls back
 * to the shared demo payer on the server.
 */
import { useWallet } from "../walletContext";
import { Button, Dot, Mono, shortId } from "../ui";

export function WalletButton() {
  const { session, connecting, error, connect, disconnect } = useWallet();

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="hidden items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-2 text-xs font-semibold text-ok sm:inline-flex"
          title={session.address}
        >
          <Dot tone="ok" />
          <Mono>{shortId(session.address, 6, 4)}</Mono>
        </span>
        <Button variant="ghost" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="hidden max-w-[240px] truncate text-xs text-bad sm:block">{error}</span>}
      <Button variant="outline" onClick={() => void connect()} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect Pera"}
      </Button>
    </div>
  );
}
