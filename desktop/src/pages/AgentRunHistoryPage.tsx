import React, { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { Modal, ModalClose } from "../components/ui/Modal";
import { StatusPill } from "../components/ui/StatusPill";
import { api } from "../api/client";
import { AGENTS } from "../mockData";
import type { Agent, AgentRunEntry } from "../types";

const AGENT_MAP = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

interface AgentRunHistoryPageProps {
  project: string;
  rootDir: string;
  agentId: string;
  onBack: () => void;
  onLogs: (entry: AgentRunEntry) => void;
  onResults: (entry: AgentRunEntry) => void;
}

/** Pretty-format an ISO-8601 timestamp; falls back to the raw string on parse failure. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface CountCellProps {
  value: number;
  color: string;
}

function CountCell({ value, color }: CountCellProps) {
  const dim = value === 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 28,
        height: 22,
        padding: "0 8px",
        borderRadius: "var(--r-pill)",
        background: dim ? "var(--surface-3)" : `${color}22`,
        color: dim ? "var(--text-3)" : color,
        fontFamily: "var(--font-heading)",
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {value}
    </span>
  );
}

export function AgentRunHistoryPage({ project, rootDir, agentId, onBack, onLogs, onResults }: AgentRunHistoryPageProps) {
  const agent: Agent | undefined = AGENT_MAP[agentId];
  const [runs, setRuns] = useState<AgentRunEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backHover, setBackHover] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgentRunEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setError(null);
    api
      .listAgentRuns(rootDir, project, agentId)
      .then((data) => {
        if (cancelled) return;
        // Newest first by timestamp (fallback to run_id ordering).
        const sorted = [...data].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
        setRuns(sorted);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rootDir, project, agentId]);

  // Poll every 5 s while any run is still "running" to pick up status transitions.
  useEffect(() => {
    if (!runs || !runs.some((r) => r.status === "running")) return;
    const id = setInterval(() => {
      api
        .listAgentRuns(rootDir, project, agentId)
        .then((data) => {
          const sorted = [...data].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
          setRuns(sorted);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [runs, rootDir, project, agentId]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const runId = pendingDelete.run_id;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Cancel the running job before deleting so the agent stops at the next node boundary.
      if (pendingDelete.status === "running") {
        const jobs = await api.listJobs();
        const job = jobs.find(
          (j) => j.agent === agentId && j.project === project && j.status === "running",
        );
        if (job) await api.cancelJob(job.id);
      }
      await api.deleteAgentRun(rootDir, project, agentId, runId);
      setRuns((prev) => (prev ? prev.filter((x) => x.run_id !== runId) : prev));
      setPendingDelete(null);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  function closeDeleteModal() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  const cell: React.CSSProperties = {
    padding: "0 20px",
    fontFamily: "var(--font-body)",
    fontSize: 13.5,
    color: "var(--text-2)",
    whiteSpace: "nowrap",
  };

  const gridCols = "1.6fr 1fr 0.8fr 0.8fr 0.9fr 2.5fr";

  return (
    <div style={{ padding: "36px 44px", maxWidth: 1100, margin: "0 auto" }}>
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
        Dashboard
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)" }}>
          <Icon name={agent?.icon ?? "shield"} size={19} />
        </span>
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>
          {agent?.title ?? agentId} — Recent Runs
        </h1>
      </div>
      <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
        Every <span style={{ fontFamily: "var(--font-mono)" }}>{agentId}</span> run for{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{project}</span>, newest first.
      </p>

      <div style={{ marginTop: 26, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            height: 46,
            alignItems: "center",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {["Timestamp", "Status", "Fixed", "New", "Persisted", "Actions"].map((h) => (
            <div key={h} className="section-label" style={{ padding: "0 20px", fontSize: 10.5, textAlign: "center" }}>
              {h}
            </div>
          ))}
        </div>

        {/* Body */}
        {runs === null ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 14, fontFamily: "var(--font-body)" }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--error)", fontSize: 13.5, fontFamily: "var(--font-body)" }}>
            Failed to load runs: {error}
          </div>
        ) : runs.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 14, fontFamily: "var(--font-body)" }}>
            No runs yet. Trigger {agentId} from the dashboard to get started.
          </div>
        ) : (
          runs.map((r, idx) => (
            <div
              key={r.run_id}
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                minHeight: 60,
                alignItems: "center",
                borderBottom: idx === runs.length - 1 ? "none" : "1px solid var(--border-soft)",
              }}
            >
              <div style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-3)" }}>
                {formatTimestamp(r.timestamp)}
              </div>
              <div style={cell}>
                <StatusPill status={
                  r.status === "partial" ? "failed" :
                  r.status === "paused"  ? "paused"  :
                  r.status as "running" | "completed" | "failed"
                } />
              </div>
              <div style={cell}>
                <CountCell value={r.summary.fixed} color="var(--success)" />
              </div>
              <div style={cell}>
                <CountCell value={r.summary.new} color="var(--error)" />
              </div>
              <div style={cell}>
                <CountCell value={r.summary.persisted} color="var(--warning)" />
              </div>
              <div style={{ ...cell, display: "flex", gap: 4, justifyContent: "flex-start" }}>
                <Button variant="ghost" size="sm" icon="terminal" onClick={() => onLogs(r)}>Logs</Button>
                {(r.status === "completed" || r.status === "running") && (
                  <span style={{ opacity: r.status === "running" ? 0.4 : 1, cursor: r.status === "running" ? "not-allowed" : undefined }}>
                    <Button variant="ghost" size="sm" icon="eye" onClick={() => onResults(r)} disabled={r.status === "running"}>Result</Button>
                  </span>
                )}
                <Button variant="ghost" size="sm" icon="trash" onClick={() => { setPendingDelete(r); setDeleteError(null); }} />
              </div>
            </div>
          ))
        )}
      </div>

      <Modal open={pendingDelete !== null} onClose={closeDeleteModal} labelledBy="delete-run-title">
        <div style={{ padding: "22px 24px", display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--error-soft, rgba(229,72,77,0.13))", color: "var(--error)" }}>
            <Icon name="trash" size={19} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <h2 id="delete-run-title" style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-heading)" }}>
                Delete this run?
              </h2>
              <ModalClose onClose={closeDeleteModal} />
            </div>
            <p style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
              Run{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
                {pendingDelete?.run_id}
              </span>{" "}
              and all of its artifacts (diff, logs, scans) will be permanently removed. This cannot be undone.
            </p>
            {deleteError && (
              <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--error)", fontFamily: "var(--font-body)" }}>
                Failed to delete: {deleteError}
              </p>
            )}
            <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={closeDeleteModal} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" icon="trash" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete run"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
