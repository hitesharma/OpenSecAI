import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { StatusPill } from "../components/ui/StatusPill";
import { useNotifications } from "../notifications/NotificationContext";
import type { Run, LogLine } from "../types";


const LVL_COLOR: Record<string, string> = {
  INFO: "var(--info)",
  WARN: "var(--warning)",
  ERROR: "var(--error)",
};

function startTime(run: Run | null): string {
  return run ? run.started.split(" ")[1] : "00:00:00";
}

function logTimestamp(run: Run | null, i: number): string {
  const raw = run?.started ?? "";
  // `started` may be "YYYY-MM-DD HH:MM:SS" (from nowStamp) or ISO
  // "YYYY-MM-DDTHH:MM:SSZ" (from listAgentRuns). Parse defensively.
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  const seed = isNaN(parsed.getTime()) ? new Date(2026, 0, 1, 9, 42, 18) : parsed;
  const t = new Date(seed.getTime() + Math.floor(i * 900));
  return t.toTimeString().slice(0, 8);
}

interface LogViewerPageProps {
  run: Run | null;
  lines: LogLine[];
  running: boolean;
  onBack: () => void;
  onResults: (r: Run) => void;
}

export function LogViewerPage({ run, lines, running, onBack, onResults }: LogViewerPageProps) {
  const { notifications, resolveNotification } = useNotifications();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  // Find the first pending pause notification for the current run.
  // During a live run, run.id === jobId. After finishRun swaps, no pause
  // will remain pending (the agent unblocks only after a decision is sent).
  const pauseNotification = notifications.find(
    (n) =>
      n.status === "pending" &&
      n.payload.type === "pause" &&
      (n.jobId === run?.id || n.runId === run?.id)
  ) ?? null;

  // Reset local close state whenever a new/different notification appears.
  const pauseNotifId = pauseNotification?.id ?? null;
  React.useEffect(() => { setOverlayDismissed(false); }, [pauseNotifId]);

  const handleDecision = async (notifId: string, decision: string) => {
    setResolvingId(decision);
    try {
      await resolveNotification(notifId, decision);
    } finally {
      setResolvingId(null);
    }
  };

  const [autoScroll, setAutoScroll] = useState(true);
  const [backHover, setBackHover] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const status = running ? "running" : (run ? run.status : "completed");

  return (
    <>
    <div style={{
      padding: "28px 44px 36px",
      maxWidth: 1100,
      margin: "0 auto",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
    }}>
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
          marginBottom: 16,
          transition: "color var(--t-fast)",
        }}
      >
        <Icon name="arrowLeft" size={15} />
        Run History
      </button>

      {/* Terminal card */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--terminal)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-card)",
        overflow: "hidden",
        boxShadow: "var(--shadow-md)",
      }}>
        {/* Terminal header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-soft)",
          background: "rgba(255,255,255,0.015)",
        }}>
          <div style={{ display: "flex", gap: 7 }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FB5F57" }} />
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#FEBC2E" }} />
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28C840" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 4 }}>
            <Icon name="terminal" size={15} style={{ color: "var(--text-3)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13.5, color: "var(--text)", fontWeight: 500 }}>
              {run ? run.agent : "dep_scan"}
            </span>
            <StatusPill status={status as "running" | "completed" | "failed" | "idle"} mini />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>
            started {startTime(run)}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setAutoScroll((v) => !v)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: "var(--r-pill)",
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 12,
              color: autoScroll ? "var(--accent-bright)" : "var(--text-3)",
              background: autoScroll ? "var(--accent-soft)" : "var(--surface-3)",
              border: `1px solid ${autoScroll ? "rgba(129,140,248,0.3)" : "var(--border-soft)"}`,
              transition: "all var(--t-fast)",
              boxSizing: "border-box",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: autoScroll ? "var(--accent-bright)" : "var(--text-3)" }} />
            Auto-scroll {autoScroll ? "On" : "Off"}
          </button>
        </div>

        {/* Log body */}
        <div
          ref={bodyRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "14px 0",
            fontFamily: "var(--font-mono)",
            fontSize: 12.8,
            lineHeight: 1.9,
          }}
        >
          {lines.map((ln, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "0 20px", alignItems: "baseline" }}>
              <span style={{ color: "var(--text-3)", flexShrink: 0, fontSize: 12 }}>{logTimestamp(run, i)}</span>
              <span style={{ color: LVL_COLOR[ln.lvl] ?? "var(--text-2)", flexShrink: 0, fontWeight: 500, width: 44 }}>{ln.lvl}</span>
              <span style={{ color: ln.lvl === "ERROR" ? "#FCA5A5" : "var(--text)", flex: 1 }}>{ln.msg}</span>
            </div>
          ))}
          {running && (
            <div style={{ display: "flex", gap: 14, padding: "2px 20px", alignItems: "center" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--accent-bright)" }} />
            </div>
          )}
        </div>
      </div>

      {/* Footer action */}
      {!running && run && run.status === "completed" && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <Button icon="eye" onClick={() => onResults(run)}>View Results</Button>
        </div>
      )}
    </div>

    {/* ── Pause / user-decision overlay ─────────────────────────────── */}
    {pauseNotification && pauseNotification.payload.type === "pause" && !overlayDismissed && (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(2px)",
      }}>
        <div style={{
          width: 480,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-card)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "20px 22px 18px",
            borderBottom: "1px solid var(--border-soft)",
          }}>
            <span style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--warning-soft, rgba(234,179,8,0.12))",
              color: "var(--warning, #ca8a04)",
            }}>
              <Icon name="alertTriangle" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 15 }}>
                Agent Waiting for Input
              </div>
              <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
                {run?.agent ?? "Agent"} · {pauseNotification.timestamp}
              </div>
            </div>
            <button
              onClick={() => setOverlayDismissed(true)}
              disabled={resolvingId !== null}
              style={{
                all: "unset",
                cursor: resolvingId !== null ? "not-allowed" : "pointer",
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                color: "var(--text-3)",
                flexShrink: 0,
                transition: "background var(--t-fast), color var(--t-fast)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-3)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ""; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-3)"; }}
              title="Dismiss"
            >
              <Icon name="x" size={15} />
            </button>
          </div>

          {/* Prompt */}
          <div style={{ padding: "18px 22px 12px" }}>
            <p style={{
              fontSize: 13.5,
              color: "var(--text-2)",
              fontFamily: "var(--font-body)",
              lineHeight: 1.65,
              background: "var(--surface-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--r-input)",
              padding: "12px 14px",
            }}>
              {pauseNotification.payload.prompt}
            </p>
          </div>

          {/* Options — rendered directly from the contract payload; no local lookup. */}
          <div style={{ padding: "6px 22px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
            {pauseNotification.payload.options.map((opt) => {
              const isPrimary = opt.variant === "primary";
              const isResolving = resolvingId === opt.value;
              return (
                <button
                  key={opt.value}
                  disabled={resolvingId !== null}
                  onClick={() => handleDecision(pauseNotification.id, opt.value)}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    cursor: resolvingId !== null ? "not-allowed" : "pointer",
                    opacity: resolvingId !== null && !isResolving ? 0.45 : 1,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "13px 16px",
                    borderRadius: "var(--r-input)",
                    border: `1.5px solid ${isPrimary ? "var(--accent)" : "var(--border)"}`,
                    background: isPrimary ? "var(--accent-soft)" : "var(--surface-2)",
                    transition: "border-color var(--t-fast), background var(--t-fast)",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: "var(--font-heading)",
                      fontWeight: 700,
                      fontSize: 14,
                      color: isPrimary ? "var(--accent-bright)" : "var(--text)",
                    }}>
                      {isResolving ? "Sending…" : opt.label}
                    </div>
                    {opt.desc && (
                      <div style={{ marginTop: 3, fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
                        {opt.desc}
                      </div>
                    )}
                  </div>
                  <Icon
                    name="arrowRight"
                    size={16}
                    style={{ color: isPrimary ? "var(--accent-bright)" : "var(--text-3)", flexShrink: 0 }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
