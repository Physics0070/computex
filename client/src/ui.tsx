/** Shared presentational primitives for the ComputeX console. */
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={`rounded-xl border border-line bg-surface-1/80 backdrop-blur-sm ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-hi">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-low">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-low">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${
          accent ? "text-brand-soft" : "text-hi"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-low">{hint}</p>}
    </Card>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "brand";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-surface-2 text-mid",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  bad: "border-bad/30 bg-bad/10 text-bad",
  brand: "border-brand/40 bg-brand/10 text-brand-soft",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const color =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : tone === "brand" ? "bg-brand" : "bg-low";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color} ${pulse ? "pulse-ring" : ""}`} />;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  type?: "button" | "submit";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45";
  const styles = {
    primary: "bg-brand text-white hover:bg-brand/85 shadow-lg shadow-brand/20",
    outline: "border border-line bg-surface-2 text-hi hover:border-brand/50 hover:bg-surface-3",
    ghost: "text-mid hover:bg-surface-2 hover:text-hi",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-mid">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-low">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-hi outline-none transition placeholder:text-low focus:border-brand/60 focus:ring-2 focus:ring-brand/20";

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12px] ${className}`}>{children}</span>;
}

/** Truncates a long id in the middle so both ends stay readable. */
export function shortId(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-sm text-low">{children}</div>
  );
}

export function Meter({ value, tone = "brand" }: { value: number; tone?: Tone }) {
  const color = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-brand";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-500`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
