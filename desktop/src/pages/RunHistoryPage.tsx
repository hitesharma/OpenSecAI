import React from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { StatusPill } from "../components/ui/StatusPill";
import { AGENTS } from "../mockData";
import type { Run } from "../types";

const AGENT_MAP = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

interface RunHistoryPageProps {
  runs: Run[];
  onLogs: (r: Run) => void;
  onResults: (r: Run) => void;
}

export function RunHistoryPage({ runs, onLogs, onResults }: RunHistoryPageProps) {
  const cell: React.CSSProperties = {
    padding: "0 20px",
    fontFamily: "var(--font-body)",
    fontSize: 13.5,
    color: "var(--text-2)",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ padding: "36px 44px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>Run History</h1>
      <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
        Every agent execution, newest first.
      </p>

      <div style={{ marginTop: 26, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1.4fr 0.8fr 1.3fr",
          height: 46,
          alignItems: "center",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border)",
        }}>
          {["Agent", "Status", "Started At", "Duration", "Actions"].map((h) => (
            <div key={h} className="section-label" style={{ padding: "0 20px", fontSize: 10.5, textAlign: "left" }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {runs.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 14, fontFamily: "var(--font-body)" }}>
            No runs yet. Trigger an agent from the dashboard to get started.
          </div>
        ) : runs.map((r, idx) => {
          const a = AGENT_MAP[r.agent];
          return (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 1fr 1.4fr 0.8fr 1.3fr",
                minHeight: 60,
                alignItems: "center",
                borderBottom: idx === runs.length - 1 ? "none" : "1px solid var(--border-soft)",
                background: r.status === "running" ? "rgba(96,165,250,0.05)" : "transparent",
              }}
            >
              <div style={{ ...cell, display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)", flexShrink: 0 }}>
                  <Icon name={a?.icon ?? "shield"} size={15} />
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>{r.agent}</span>
              </div>
              <div style={cell}><StatusPill status={r.status} /></div>
              <div style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-3)" }}>{r.started}</div>
              <div style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 13 }}>{r.status === "running" ? "—" : r.duration}</div>
              <div style={{ ...cell, display: "flex", gap: 4, justifyContent: "flex-start" }}>
                <Button variant="ghost" size="sm" icon="terminal" onClick={() => onLogs(r)}>Logs</Button>
                {r.status === "completed" && (
                  <Button variant="ghost" size="sm" icon="eye" onClick={() => onResults(r)}>Results</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
