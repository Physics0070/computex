/**
 * ComputeX console.
 *
 * Five views over one backend. Payment always flows through the single x402
 * endpoint on the server — there is no second payment path in this app.
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api } from "./api";
import type { Catalog, Health, Job, Provider, Recommendation, Stats } from "./types";
import { Badge, Dot } from "./ui";
import { Marketplace } from "./views/Marketplace";
import { NewJob } from "./views/NewJob";
import { JobsTable } from "./views/Jobs";
import { Providers } from "./views/Providers";
import { AgentMode } from "./views/AgentMode";

type ViewKey = "marketplace" | "new-job" | "jobs" | "providers" | "agent";

const NAV: Array<{ key: ViewKey; label: string; icon: ReactElement }> = [
  { key: "marketplace", label: "Marketplace", icon: <GridIcon /> },
  { key: "new-job", label: "New Compute Job", icon: <PlusIcon /> },
  { key: "jobs", label: "Jobs", icon: <ListIcon /> },
  { key: "providers", label: "Providers", icon: <ServerIcon /> },
  { key: "agent", label: "Agent Mode", icon: <SparkIcon /> },
];

export default function App() {
  const [view, setView] = useState<ViewKey>("marketplace");
  const [navOpen, setNavOpen] = useState(false);

  const [health, setHealth] = useState<Health | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [lastRecommendation, setLastRecommendation] = useState<Recommendation | null>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [p, j, s] = await Promise.all([api.providers(), api.jobs(), api.stats()]);
      setProviders(p);
      setJobs(j);
      setStats(s);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [h, c] = await Promise.all([api.health(), api.catalog()]);
        setHealth(h);
        setCatalog(c);
      } catch {
        setOffline(true);
      }
      await refresh();
    })();
  }, [refresh]);

  const go = (key: ViewKey) => {
    setView(key);
    setNavOpen(false);
  };

  return (
    <div className="relative z-10 min-h-screen">
      {/* Navigation drawer */}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-40 w-[292px] border-r border-line backdrop-blur-xl transition-transform duration-300 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-line px-5">
          <LogoMark />
          <div>
            <p className="text-base font-bold tracking-[-0.04em] text-hi">ComputeX</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-low">Compute marketplace</p>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pt-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-low">Workspace</p>
          <button onClick={() => setNavOpen(false)} className="rounded-lg p-1 text-low hover:bg-surface-2 hover:text-hi" aria-label="Close menu">×</button>
        </div>
        <nav className="mt-2 space-y-1 px-3">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => go(item.key)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                view === item.key
                  ? "bg-brand text-surface-0 shadow-lg shadow-brand/10"
                  : "text-mid hover:bg-surface-2/85 hover:text-hi"
              }`}
            >
              <span className={view === item.key ? "text-surface-0" : "text-low"}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-line p-4">
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <Dot tone={offline ? "bad" : "ok"} pulse={!offline} />
              <p className="text-xs font-medium text-hi">
                {offline ? "Backend offline" : health?.network ?? "Connecting…"}
              </p>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-low">
              Payments settle in USDC on Algorand Testnet. GPU execution is simulated.
            </p>
          </div>
        </div>
      </aside>

      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-surface-0/75 backdrop-blur-sm"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-col">
        <header className="app-topbar sticky top-0 z-20 flex h-20 items-center gap-3 border-b border-line bg-surface-0/75 px-5 backdrop-blur-xl sm:px-8">
          <button
            onClick={() => setNavOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-2 text-xs font-semibold text-mid transition hover:border-brand/50 hover:text-hi"
            aria-label="Open menu"
          >
            <MenuIcon />
            <span>Menu</span>
          </button>

          <div className="min-w-0 flex-1">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.17em] text-low sm:block">ComputeX</p>
            <h1 className="truncate text-lg font-bold tracking-[-0.04em] text-hi">
              {NAV.find((n) => n.key === view)?.label}
            </h1>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <Badge tone="warn">compute simulated</Badge>
            <Badge tone="ok">
              <Dot tone="ok" />
              payments real
            </Badge>
          </div>
        </header>

        <main className="mx-auto min-w-0 max-w-[1480px] p-5 sm:p-8">
          {offline && (
            <div className="mb-5 rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm text-bad">
              Cannot reach the ComputeX backend. Start it with{" "}
              <span className="font-mono">npm run dev</span> in <span className="font-mono">computex/server</span>.
            </div>
          )}

          {view === "marketplace" && (
            <Marketplace
              stats={stats}
              providers={providers}
              jobs={jobs}
              lastRecommendation={lastRecommendation}
              onNewJob={() => go("new-job")}
            />
          )}

          {view === "new-job" && (
            <NewJob
              catalog={catalog}
              onJobFinished={refresh}
              onRecommendation={setLastRecommendation}
            />
          )}

          {view === "jobs" && <JobsTable jobs={jobs} />}

          {view === "providers" && <Providers providers={providers} />}

          {view === "agent" && (
            <AgentMode onJobFinished={refresh} onRecommendation={setLastRecommendation} />
          )}
        </main>
      </div>
    </div>
  );
}

/* --- icons -------------------------------------------------------- */

function LogoMark() {
  return (
    <span className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-surface-0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
      </svg>
    </span>
  );
}

const iconProps = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function GridIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <path d="M6 7h.01M6 17h.01" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
