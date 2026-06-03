import React, { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { StatusPill } from "../components/ui/StatusPill";
import { Modal, ModalClose } from "../components/ui/Modal";
import { api } from "../api/client";
import { AGENTS } from "../mockData";
import type { Agent, AgentRunEntry, Run } from "../types";

/* ── Stat tile ── */
interface StatTileProps {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}

function StatTile({ icon, label, value, sub, color }: StatTileProps) {
  return (
    <div style={{
      flex: 1,
      background: "var(--surface)",
      border: "1px solid var(--border-soft)",
      borderRadius: "var(--r-card)",
      padding: "18px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--text-3)" }}>
        <Icon name={icon} size={15} style={{ color: color ?? "var(--text-3)" }} />
        <span className="section-label" style={{ fontSize: 10.5 }}>{label}</span>
      </div>
      <div style={{ marginTop: 12, fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 23, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>{sub}</div>}
    </div>
  );
}

/* ── Dashboard ── */
interface DashboardPageProps {
  project: string;
  rootDir: string;
  repoPath: string;
  lastRun: string;
  runs: Run[];
  onAgentClick: (a: Agent) => void;
  onRunDep: () => void;
}

export function DashboardPage({ project, rootDir, repoPath, lastRun, runs, onAgentClick, onRunDep }: DashboardPageProps) {
  const dep = AGENTS[0];
  const scanned = runs.some((r) => r.status === "completed");
  const [agentHover, setAgentHover] = useState(false);
  const [lastEntry, setLastEntry] = useState<AgentRunEntry | null>(null);
  const [totalRuns, setTotalRuns] = useState<number | null>(null);

  useEffect(() => {
    if (!rootDir || !project) return;
    api.listAgentRuns(rootDir, project, "dep_scan")
      .then((entries) => {
        setTotalRuns(entries.length);
        // If the newest entry is still running, use the previous completed entry for findings.
        const completed = entries.filter((e) => e.status !== "running");
        setLastEntry(completed.length > 0 ? completed[completed.length - 1] : null);
      })
      .catch(() => { setTotalRuns(null); setLastEntry(null); });
  }, [rootDir, project, runs]);

  const openFindings = lastEntry
    ? lastEntry.summary.persisted + lastEntry.summary.new
    : null;

  return (
    <div style={{ padding: "36px 44px", maxWidth: 1080, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>{project}</h1>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, color: "var(--text-3)" }}>
            <Icon name="folder" size={14} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>{repoPath || "No repository path set"}</span>
          </div>
        </div>
        <Button icon="play" onClick={onRunDep}>Run dep_scan</Button>
      </div>

      {/* Health hero
      {scanned ? (
        <div style={{
          marginTop: 28,
          display: "flex",
          alignItems: "center",
          gap: 28,
          padding: "26px 30px",
          background: "linear-gradient(135deg, rgba(251,191,36,0.07), var(--surface))",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-card)",
        }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, flexShrink: 0, display: "grid", placeItems: "center", background: "var(--warning-bg)", border: "1px solid rgba(251,191,36,0.3)" }}>
            <Icon name="alertTriangle" size={30} stroke={1.6} style={{ color: "var(--warning)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Needs Attention</h3>
              <span style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", background: "var(--warning-bg)", color: "var(--warning)", border: "1px solid rgba(251,191,36,0.3)", fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>HEALTH</span>
            </div>
            <p style={{ marginTop: 7, fontSize: 14, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.55, maxWidth: 540 }}>
              Last dep_scan found <strong style={{ color: "var(--text)" }}>1 new critical</strong> and 5 persisting vulnerabilities. Review the latest report to triage.
            </p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <span className="section-label" style={{ fontSize: 10 }}>Last Run</span>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-2)" }}>{lastRun}</div>
          </div>
        </div>
      ) : (
        <div style={{
          marginTop: 28,
          display: "flex",
          alignItems: "center",
          gap: 28,
          padding: "26px 30px",
          background: "linear-gradient(135deg, rgba(99,102,241,0.08), var(--surface))",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-card)",
        }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, flexShrink: 0, display: "grid", placeItems: "center", background: "var(--accent-soft)", border: "1px solid rgba(129,140,248,0.3)" }}>
            <Icon name="shieldCheck" size={30} stroke={1.6} style={{ color: "var(--accent-bright)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Not Scanned Yet</h3>
              <span style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", background: "var(--accent-soft)", color: "var(--accent-bright)", border: "1px solid rgba(129,140,248,0.3)", fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 11, letterSpacing: "0.04em" }}>HEALTH</span>
            </div>
            <p style={{ marginTop: 7, fontSize: 14, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.55, maxWidth: 540 }}>
              Run dep_scan to generate your first security report. You can review findings as soon as the scan completes.
            </p>
          </div>
        </div>
      )} */}

      {/* Stats */}
      <div style={{ marginTop: 16, display: "flex", gap: 16 }}>
        <StatTile
          icon="alertTriangle"
          label="Open Findings"
          value={openFindings !== null ? String(openFindings) : "—"}
          sub={openFindings !== null ? "persisted + new · dep_scan" : "no scans yet"}
          color={openFindings !== null && openFindings > 0 ? "var(--error)" : openFindings === 0 ? "var(--success)" : "var(--text-3)"}
        />
        {/* <StatTile icon="shieldCheck" label="Agents Active" value="1 / 7" sub="6 coming soon" color="var(--accent-bright)" /> */}
        <StatTile icon="history" label="Total Runs" value={totalRuns !== null ? String(totalRuns) : "—"} sub={totalRuns ? "all time · dep_scan" : "none yet"} color="var(--text-2)" />
      </div>

      {/* Featured agent */}
      <div style={{ marginTop: 28 }}>
        <div className="section-label" style={{ marginBottom: 12 }}>Available Agent</div>
        <button
          onClick={() => onAgentClick(dep)}
          onMouseEnter={() => setAgentHover(true)}
          onMouseLeave={() => setAgentHover(false)}
          style={{
            all: "unset",
            cursor: "pointer",
            boxSizing: "border-box",
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "20px 22px",
            background: "var(--surface)",
            border: `1px solid ${agentHover ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "var(--r-card)",
            transform: agentHover ? "translateY(-1px)" : "none",
            transition: "border-color var(--t-base), transform var(--t-base)",
          }}
        >
          <span style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)", border: "1px solid rgba(129,140,248,0.25)" }}>
            <Icon name={dep.icon} size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500, color: "var(--text)" }}>{dep.name}</span>
              <StatusPill status="idle" mini />
            </div>
            <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>{dep.short}</p>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--accent-bright)", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13.5 }}>
            Open <Icon name="arrowRight" size={15} />
          </span>
        </button>
        <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-body)", textAlign: "center" }}>
          {/* 6 more agents — container_scan, sast, secrets, iac, sbom, license — coming soon. */}
        </p>
      </div>
    </div>
  );
}

/* ── Agent Modal ── */
interface AgentModalProps {
  agent: Agent | null;
  runningAgent: string | null;
  onClose: () => void;
  onRun: (a: Agent) => void;
}

export function AgentModal({ agent, runningAgent, onClose, onRun }: AgentModalProps) {
  if (!agent) return null;
  const running = runningAgent === agent.id;

  return (
    <Modal open={!!agent} onClose={onClose} width={500} labelledBy="agent-modal-title">
      <div style={{ padding: "22px 24px 18px", display: "flex", alignItems: "flex-start", gap: 16, borderBottom: "1px solid var(--border-soft)" }}>
        <span style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center",
          background: agent.enabled ? "var(--accent-soft)" : "var(--surface-3)",
          color: agent.enabled ? "var(--accent-bright)" : "var(--text-3)",
          border: `1px solid ${agent.enabled ? "rgba(129,140,248,0.25)" : "var(--border-soft)"}`,
        }}>
          <Icon name={agent.icon} size={23} />
        </span>
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span id="agent-modal-title" style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 500, color: "var(--text)" }}>{agent.name}</span>
            {agent.enabled
              ? <StatusPill status={running ? "running" : "idle"} mini />
              : <span style={{ fontSize: 10.5, fontFamily: "var(--font-heading)", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--idle-bg)" }}>Coming Soon</span>
            }
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-3)", fontFamily: "var(--font-heading)", fontWeight: 600 }}>{agent.title}</div>
        </div>
        <ModalClose onClose={onClose} />
      </div>

      <div style={{ padding: "20px 24px" }}>
        <p style={{ fontSize: 14, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.65 }}>{agent.desc}</p>
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 13, padding: "13px 16px", background: "var(--surface-3)", borderRadius: "var(--r-input)", border: "1px solid var(--border-soft)" }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-2)" }}>
            <Icon name="cpu" size={17} />
          </span>
          <div style={{ flex: 1 }}>
            <span className="section-label" style={{ fontSize: 10 }}>Scanner</span>
            <div style={{ marginTop: 2, display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>{agent.scanner}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>{agent.scannerNote}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "4px 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button
          icon={running ? undefined : "play"}
          disabled={!agent.enabled || running}
          onClick={() => onRun(agent)}
        >
          {running ? (
            <>
              <span className="spin" style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block" }} />
              Running…
            </>
          ) : agent.enabled ? "Run Agent" : "Not Available"}
        </Button>
      </div>
    </Modal>
  );
}

/* ── Repo Name Modal — captures the folder under workspaces/ ── */
interface RepoNameModalProps {
  open: boolean;
  project: string;
  initialValue?: string;
  onClose: () => void;
  onConfirm: (repoName: string) => Promise<void> | void;
}

export function RepoNameModal({ open, project, initialValue, onClose, onConfirm }: RepoNameModalProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialValue ?? "");
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const valid = name.trim().length > 0 && /^[A-Za-z0-9_.\-/]+$/.test(name.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(name.trim());
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={460} labelledBy="repo-name-modal-title">
      <div style={{ padding: "22px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)" }}>
            <Icon name="folderOpen" size={20} />
          </span>
          <h3 id="repo-name-modal-title" style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Set Repository Folder</h3>
        </div>
        <ModalClose onClose={onClose} />
      </div>

      <div style={{ padding: "20px 24px" }}>
        <p style={{ fontSize: 13.5, color: "var(--text-3)", fontFamily: "var(--font-body)", lineHeight: 1.6, marginBottom: 18 }}>
          <span className="mono" style={{ color: "var(--text-2)" }}>{project}</span> needs to know which folder under{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>workspaces/</span> contains the source repo.
          This is stored once and reused for every future run.
        </p>
        <Input
          label="Repository folder name"
          value={name}
          onChange={setName}
          placeholder="e.g. orbiter-auth"
          mono
          autoFocus
          onEnter={submit}
          hint={`Resolves to <root_dir>/workspaces/${name.trim() || "<name>"}`}
        />
        {error && (
          <p style={{ marginTop: 14, fontSize: 13, color: "var(--red, #f87171)", fontFamily: "var(--font-body)" }}>
            {error}
          </p>
        )}
      </div>

      <div style={{ padding: "4px 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button icon="check" disabled={!valid || busy} onClick={submit}>
          {busy ? "Saving…" : "Save & Continue"}
        </Button>
      </div>
    </Modal>
  );
}

/* ── Repo Path Modal ── */
interface RepoPathModalProps {
  open: boolean;
  agentName: string;
  onClose: () => void;
  onConfirm: (path: string) => void;
}

export function RepoPathModal({ open, agentName, onClose, onConfirm }: RepoPathModalProps) {
  const [path, setPath] = useState("");
  const [browseHover, setBrowseHover] = useState(false);

  useEffect(() => { if (open) setPath(""); }, [open]);

  const valid = path.trim().length > 0;
  const pick = () => setPath("/Users/dev/projects/api-gateway");

  return (
    <Modal open={open} onClose={onClose} width={460} labelledBy="repo-modal-title">
      <div style={{ padding: "22px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)" }}>
            <Icon name="folderOpen" size={20} />
          </span>
          <h3 id="repo-modal-title" style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Set Repository Path</h3>
        </div>
        <ModalClose onClose={onClose} />
      </div>

      <div style={{ padding: "20px 24px" }}>
        <p style={{ fontSize: 13.5, color: "var(--text-3)", fontFamily: "var(--font-body)", lineHeight: 1.6, marginBottom: 18 }}>
          {agentName ? <><span className="mono" style={{ color: "var(--text-2)" }}>{agentName}</span> needs a local folder to scan. </> : ""}
          Point OpenSecAI at the repository on disk.
        </p>
        <Input
          label="Local folder path"
          value={path}
          onChange={setPath}
          placeholder="/path/to/repository"
          mono
          autoFocus
          onEnter={() => valid && onConfirm(path.trim())}
          rightSlot={
            <button
              onClick={pick}
              onMouseEnter={() => setBrowseHover(true)}
              onMouseLeave={() => setBrowseHover(false)}
              title="Browse folders"
              style={{
                all: "unset",
                cursor: "pointer",
                height: "100%",
                padding: "0 14px",
                display: "grid",
                placeItems: "center",
                color: browseHover ? "var(--accent-bright)" : "var(--text-2)",
                borderLeft: "1px solid var(--border)",
                background: "var(--surface-2)",
                transition: "color var(--t-fast)",
                boxSizing: "border-box",
              }}
            >
              <Icon name="folder" size={17} />
            </button>
          }
        />
      </div>

      <div style={{ padding: "4px 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon="play" disabled={!valid} onClick={() => onConfirm(path.trim())}>
          Confirm &amp; Run
        </Button>
      </div>
    </Modal>
  );
}
