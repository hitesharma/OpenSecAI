import React, { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { SeverityBadge } from "../components/ui/SeverityBadge";
import { api } from "../api/client";
import { EMPTY_RESULTS, diffToResults } from "../api/normalize";
import { AGENTS, RESULTS as MOCK_RESULTS } from "../mockData";
import type { Run, ScanResults, Vulnerability } from "../types";

const AGENT_MAP = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

/** Pretty-format an ISO-8601 timestamp; falls back to the raw string. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Detect a filesystem run_id of the form YYYYMMDD_HHMMSS. */
const RUN_ID_RE = /^\d{8}_\d{6}$/;

/* ── Vuln card ── */
function VulnCard({ v, showUpgrade = true }: { v: Vulnerability; showUpgrade?: boolean }) {
  return (
    <div style={{
      background: "var(--surface-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: "var(--r-input)",
      padding: "16px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>{v.cve}</span>
        <SeverityBadge level={v.sev} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-3)" }}>
          <Icon name="package" size={13} />{v.pkg}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
          <span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border-soft)" }}>{v.from}</span>
          {showUpgrade && (v.to ? (
            <>
              <Icon name="arrowRight" size={13} style={{ color: "var(--text-3)" }} />
              <span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--success-bg)", color: "var(--success)", border: "1px solid rgba(52,211,153,0.3)" }}>{v.to}</span>
            </>
          ) : (
            <span style={{ padding: "2px 8px", borderRadius: 6, background: "var(--error-bg)", color: "var(--error)", border: "1px solid rgba(248,113,113,0.3)", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 11, letterSpacing: "0.03em" }}>NO FIX AVAILABLE</span>
          ))}
        </div>
      </div>
      <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.55 }}>{v.desc}</p>
    </div>
  );
}

/* ── Collapsible section ── */
interface CollapseSectionProps {
  title: string;
  count: number;
  accent: string;
  items: Vulnerability[];
  defaultOpen?: boolean;
  showUpgrade?: boolean;
}

function CollapseSection({ title, count, accent, items, defaultOpen, showUpgrade = true }: CollapseSectionProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-soft)",
      borderLeft: `3px solid ${accent}`,
      borderRadius: "var(--r-card)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          all: "unset",
          cursor: "pointer",
          boxSizing: "border-box",
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
        }}
      >
        <Icon name="chevRight" size={16} style={{ color: "var(--text-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform var(--t-base)" }} />
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{title}</span>
        <span style={{
          minWidth: 24,
          height: 22,
          padding: "0 8px",
          borderRadius: "var(--r-pill)",
          background: `${accent}22`,
          color: accent,
          display: "inline-grid",
          placeItems: "center",
          fontFamily: "var(--font-heading)",
          fontWeight: 700,
          fontSize: 12,
        }}>
          {count}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {items.length === 0
            ? <p style={{ fontSize: 13, color: "var(--text-3)", fontFamily: "var(--font-body)", padding: "4px 2px" }}>None.</p>
            : items.map((v) => <VulnCard key={v.cve} v={v} showUpgrade={showUpgrade} />)
          }
        </div>
      )}
    </div>
  );
}

/* ── Result stat card ── */
interface ResultStatProps {
  count: number;
  label: string;
  color: string;
  icon: string;
}

function ResultStat({ count, label, color, icon }: ResultStatProps) {
  return (
    <div style={{
      flex: 1,
      background: "var(--surface)",
      border: "1px solid var(--border-soft)",
      borderRadius: "var(--r-card)",
      padding: "18px 22px",
      display: "flex",
      alignItems: "center",
      gap: 16,
    }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: `${color}1f`, color }}>
        <Icon name={icon} size={22} />
      </span>
      <div>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 26, color: "var(--text)", lineHeight: 1 }}>{count}</div>
        <div style={{ marginTop: 5, fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-heading)", fontWeight: 600, letterSpacing: "0.03em" }}>{label}</div>
      </div>
    </div>
  );
}

/* ── Results Page ── */
interface ResultsPageProps {
  project: string;
  rootDir: string;
  run: Run | null;
  onBack: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; results: ScanResults }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

export function ResultsPage({ project, rootDir, run, onBack }: ResultsPageProps) {
  const [backHover, setBackHover] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // run.id is a filesystem run_id (YYYYMMDD_HHMMSS) when navigated here from
  // AgentRunHistoryPage. Live-run job IDs use a different format and don't
  // have on-disk artifacts yet, so we fall back to the mock dataset in that
  // case so the screen remains useful during development.
  const agentId = run?.agent ?? "dep_scan";
  const runId = run?.id ?? null;
  const isFsRunId = !!runId && RUN_ID_RE.test(runId);
  const agent = AGENT_MAP[agentId];

  useEffect(() => {
    let cancelled = false;

    if (!run) {
      setState({ kind: "empty", reason: "No run selected." });
      return () => { cancelled = true; };
    }

    if (!isFsRunId) {
      // Live-run job id — no diff.json on disk. Show mock data so the page
      // still renders meaningfully during development.
      setState({ kind: "ready", results: MOCK_RESULTS });
      return () => { cancelled = true; };
    }

    setState({ kind: "loading" });
    api
      .getRunDiff(rootDir, project, agentId, runId!)
      .then((diff) => {
        if (cancelled) return;
        if (!diff) {
          setState({ kind: "empty", reason: "No diff.json found for this run." });
          return;
        }
        setState({ kind: "ready", results: diffToResults(diff) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });

    return () => { cancelled = true; };
  }, [rootDir, project, agentId, runId, isFsRunId, run]);

  const R: ScanResults = state.kind === "ready" ? state.results : EMPTY_RESULTS;
  const headerTimestamp = run ? formatTimestamp(run.started) : "—";
  const title = `${agent?.title ?? agentId} Results`;

  return (
    <div style={{ padding: "28px 44px 48px", maxWidth: 1000, margin: "0 auto" }}>
      <button
        onClick={onBack}
        onMouseEnter={() => setBackHover(true)}
        onMouseLeave={() => setBackHover(false)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: 13,
          color: backHover ? "var(--text)" : "var(--text-3)",
          marginBottom: 18,
          transition: "color var(--t-fast)",
        }}
      >
        <Icon name="arrowLeft" size={15} />
        Back
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)" }}>
              <Icon name={agent?.icon ?? "package"} size={19} />
            </span>
            <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>{title}</h1>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 16, color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name="folder" size={13} />{project}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name="clock" size={13} />{headerTimestamp}
            </span>
          </div>
        </div>
        {/* <Button variant="secondary" icon="fileText">Export Report</Button> */}
      </div>

      {state.kind === "loading" && (
        <div style={{ marginTop: 36, padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 14, fontFamily: "var(--font-body)" }}>
          Loading diff…
        </div>
      )}
      {state.kind === "error" && (
        <div style={{ marginTop: 36, padding: "32px 24px", textAlign: "center", color: "var(--error)", fontSize: 13.5, fontFamily: "var(--font-body)" }}>
          Failed to load results: {state.message}
        </div>
      )}
      {state.kind === "empty" && (
        <div style={{ marginTop: 36, padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 14, fontFamily: "var(--font-body)" }}>
          {state.reason}
        </div>
      )}

      {state.kind === "ready" && (
        <>
          {/* Stat cards */}
          <div style={{ marginTop: 26, display: "flex", gap: 16 }}>
            <ResultStat count={R.fixed.length} label="Fixed" color="var(--success)" icon="checkCircle" />
            <ResultStat count={R.added.length} label="New" color="var(--error)" icon="alertTriangle" />
            <ResultStat count={R.persisted.length} label="Persisted" color="var(--warning)" icon="clock" />
          </div>

          {/* CVE sections */}
          <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 16 }}>
            <CollapseSection title="New Vulnerabilities" count={R.added.length} accent="var(--error)" items={R.added} defaultOpen />
            <CollapseSection title="Persisted Vulnerabilities" count={R.persisted.length} accent="var(--warning)" items={R.persisted} defaultOpen showUpgrade={false} />
            <CollapseSection title="Fixed Vulnerabilities" count={R.fixed.length} accent="var(--success)" items={R.fixed} />
          </div>
        </>
      )}
    </div>
  );
}
