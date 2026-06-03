import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { StatusPill } from "../components/ui/StatusPill";
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
  );
}
