import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api, openJobStream, type JobEvent, type Project } from "./api/client";
import { LeftRail } from "./components/shell/LeftRail";
import { LandingPage } from "./pages/LandingPage";
import { CreateProjectPage } from "./pages/CreateProjectPage";
import { DashboardPage, AgentModal, RepoPathModal, RepoNameModal } from "./pages/DashboardPage";
import { Modal, ModalClose } from "./components/ui/Modal";
import { Button } from "./components/ui/Button";
import { Icon } from "./components/Icon";
import { RunHistoryPage } from "./pages/RunHistoryPage";
import { AgentRunHistoryPage } from "./pages/AgentRunHistoryPage";
import { LogViewerPage } from "./pages/LogViewerPage";
import { ResultsPage } from "./pages/ResultsPage";
import { NotificationProvider, useNotifications } from "./notifications/NotificationContext";
import { AGENTS, INITIAL_RUNS } from "./mockData";
import type { Agent, LogLine, RawEventLine, Run, Screen } from "./types";
import type { PauseOption } from "./notifications/types";

/** Classify a JobEvent / RawEventLine into INFO / WARN / ERROR for the viewer. */
function eventToLogLine(ev: JobEvent | RawEventLine): LogLine {
  if (ev.kind === "error") return { lvl: "ERROR", msg: ev.payload };
  if (ev.kind === "status") return { lvl: "INFO", msg: `[status] ${ev.payload}` };
  if (ev.kind === "done") return { lvl: "INFO", msg: "[done] ✅" };
  const msg = ev.payload;
  if (msg.includes("❌") || /\b(error|failed|aborting)\b/i.test(msg)) return { lvl: "ERROR", msg };
  if (msg.includes("⚠️") || /\bwarn/i.test(msg)) return { lvl: "WARN", msg };
  return { lvl: "INFO", msg };
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function AppInner() {
  const { addNotification, updateRunId, pendingCount } = useNotifications();

  const [screen, setScreen] = useState<Screen>("landing");
  const [projects, setProjects] = useState<Project[]>([]);
  const [dataRoot, setDataRoot] = useState<string | null>(null);
  const [project, setProject] = useState("api-gateway");
  const [repoPath, setRepoPath] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);

  const [agentModal, setAgentModal] = useState<Agent | null>(null);
  const [historyAgent, setHistoryAgent] = useState<string | null>(null);
  const [logsBackScreen, setLogsBackScreen] = useState<Screen>("history");
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [repoPrompt, setRepoPrompt] = useState(false);
  const [repoNamePrompt, setRepoNamePrompt] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<Agent | null>(null);
  const [sidecarError, setSidecarError] = useState<string | null>(null);

  const currentProject = projects.find((p) => p.name === project) ?? null;

  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [liveLogs, setLiveLogs] = useState<LogLine[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const runStartRef = useRef<number>(0);

  /* Load settings + projects from sidecar on mount.
     Retries briefly because the sidecar may still be booting. */
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const tick = async () => {
      try {
        const [settingsRes, list] = await Promise.all([
          api.getSettings(),
          api.listProjects(),
        ]);
        if (!cancelled) {
          setDataRoot(settingsRes.data_root);
          setProjects(list);
        }
      } catch {
        if (cancelled) return;
        attempt += 1;
        if (attempt < 20) setTimeout(tick, 500);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, []);

  /* Close any active WebSocket when the component unmounts. */
  useEffect(() => () => { wsRef.current?.close(); }, []);

  /* Intercept the title-bar × button and show a confirmation dialog. */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      setQuitConfirm(true);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  /* Intercept Cmd+Q / app-level quit (emitted by Rust ExitRequested handler). */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("quit-requested", () => setQuitConfirm(true))
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  /**
   * Terminal hand-off for a finished run.
   *
   * Called either when a `done`/`error` event arrives on the WS, or
   * when the WS closes and the HTTP reconciliation in `onclose` finds
   * the job in a terminal state. Updates the run row in state, clears
   * the live-run pointers, closes the WS, and — on success — swaps the
   * transient job_id for the on-disk run_id so the ResultsPage can
   * locate diff.json.
   */
  function finishRun(jobId: string, status: "completed" | "failed", agentId: string): void {
    const dur = `${Math.max(1, Math.round((Date.now() - runStartRef.current) / 1000))}s`;
    setRuns((rs) => rs.map((r) => r.id === jobId ? { ...r, status, duration: dur } : r));
    setCurrentRun((c) => (c && c.id === jobId) ? { ...c, status, duration: dur } : c);
    setRunningAgent(null);
    setLiveRunId(null);
    wsRef.current?.close();
    wsRef.current = null;

    // After a successful run, swap the job_id (uuid hex from JobManager) for the
    // filesystem run_id (YYYYMMDD_HHMMSS used by dep_scan's report dir). Without
    // this swap, ResultsPage can't locate diff.json and falls back to mock data.
    if (status === "completed") {
      const rootDir = currentProject?.root_dir ?? "";
      api.listAgentRuns(rootDir, project, agentId)
        .then((entries) => {
          if (entries.length === 0) return;
          const newest = entries.reduce((acc, e) => e.timestamp > acc.timestamp ? e : acc);
          setRuns((rs) => rs.map((r) => r.id === jobId ? { ...r, id: newest.run_id, started: newest.timestamp } : r));
          setCurrentRun((c) => (c && c.id === jobId) ? { ...c, id: newest.run_id, started: newest.timestamp } : c);
          // Back-fill the FS run_id on any notifications that arrived during the live run.
          updateRunId(jobId, newest.run_id);
        })
        .catch(() => { /* best-effort — ResultsPage will show its empty state */ });
    }
  }

  /* ── Flows ── */
  function openExisting() {
    setProject("api-gateway");
    setRepoPath("/Users/dev/projects/api-gateway");
    setRuns(INITIAL_RUNS.map((r) => ({ ...r })));
    setScreen("dashboard");
  }

  function createProject(name: string, rootDir: string) {
    if (!dataRoot) setDataRoot(rootDir);
    setProject(name);
    setProjects((prev) =>
      prev.some((p) => p.name === name)
        ? prev
        : [...prev, { name, root_dir: rootDir }].sort((a, b) => a.name.localeCompare(b.name))
    );
    setRepoPath(rootDir);
    setRuns([]);
    setCurrentRun(null);
    setScreen("dashboard");
  }

  const switchProject = useCallback((name: string) => {
    setProject(name);
    setRepoPath(projects.find((p) => p.name === name)?.root_dir ?? "");
    setRuns([]);
    setCurrentRun(null);
    setRunningAgent(null);
    setLiveRunId(null);
    setScreen("dashboard");
  }, [projects]);

  function exitToLanding() { setScreen("landing"); }

  /**
   * Owner of the client-side WebSocket lifecycle for a single agent run.
   *
   * Sequence:
   *   1. Health-check the sidecar; auto-restart once if unreachable.
   *   2. POST /agents/{id}/run to obtain a job_id.
   *   3. Close any prior WS on `wsRef` so its onclose handler can't fire
   *      with a stale jobId closure.
   *   4. Open the new stream and wire onmessage / onerror / onclose:
   *        - onmessage parses JobEvent frames and appends to liveLogs.
   *        - terminal kinds (done/error) call finishRun.
   *        - onclose reconciles via HTTP in case the terminal frame was
   *          lost (covers the race where the WS dies mid-flush).
   */
  async function doStart(agent: Agent) {
    // Health-check the sidecar before doing anything visible. If it's down,
    // attempt one restart. If it's still unreachable after that, show an error
    // modal and bail — don't navigate away from the current screen.
    const sidecarReady = await (async () => {
      try {
        await api.health();
        return true;
      } catch {
        // Sidecar is down — try to restart it.
        try {
          await invoke("restart_sidecar");
          // Give the new process a moment to bind the port.
          await new Promise((r) => setTimeout(r, 1500));
          await api.health();
          return true;
        } catch (restartErr) {
          setSidecarError(
            `The backend failed to start on port 8765. ` +
            `Please check that no other process is using that port and try again.\n\n` +
            `Details: ${String(restartErr)}`
          );
          return false;
        }
      }
    })();
    if (!sidecarReady) return;

    setAgentModal(null);
    setLiveLogs([{ lvl: "INFO", msg: `Triggering ${agent.id} on project=${project}…` }]);
    setScreen("logs");
    runStartRef.current = Date.now();

    let jobId: string;
    try {
      // No repo_path override — backend resolves <root_dir>/workspaces/<repo_name>.
      const res = await api.runAgent(agent.id, project);
      jobId = res.job_id;
    } catch (err) {
      const placeholderId = "err-" + Date.now();
      const failed: Run = { id: placeholderId, agent: agent.id, status: "failed", started: nowStamp(), duration: "—" };
      setRuns((rs) => [failed, ...rs]);
      setCurrentRun(failed);
      setLiveLogs((ls) => [...ls, { lvl: "ERROR", msg: `Failed to start run: ${String(err)}` }]);
      return;
    }

    const run: Run = { id: jobId, agent: agent.id, status: "running", started: nowStamp(), duration: "—" };
    setRuns((rs) => [run, ...rs]);
    setCurrentRun(run);
    setRunningAgent(agent.id);
    setLiveRunId(jobId);

    // Close any prior stream before adopting the new one so its onclose
    // handler can't fire with a stale jobId closure.
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* noop */ }
      wsRef.current = null;
    }
    const ws = openJobStream(jobId);
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const ev: JobEvent = JSON.parse(msg.data);
        if (ev.kind === "pause") {
          // Route pause events into the global notification store.
          // The payload is JSON: { prompt, options }
          try {
            const pauseData = JSON.parse(ev.payload) as { prompt: string; options: PauseOption[]; run_id?: string };
            addNotification({
              jobId,
              // run_id from Python lets us match this notification from history pages
              // (which use the FS run_id) without waiting for finishRun to back-fill it.
              runId: pauseData.run_id ?? null,
              agentId: agent.id,
              timestamp: ev.timestamp,
              payload: { type: "pause", prompt: pauseData.prompt, options: pauseData.options },
            });
          } catch {
            // malformed pause payload — surface as a log line instead
            setLiveLogs((ls) => [...ls, { lvl: "WARN", msg: `Pause event received (malformed payload): ${ev.payload}` }]);
          }
        } else {
          setLiveLogs((ls) => [...ls, eventToLogLine(ev)]);
          if (ev.kind === "done") finishRun(jobId, "completed", agent.id);
          else if (ev.kind === "error") finishRun(jobId, "failed", agent.id);
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => {
      setLiveLogs((ls) => [...ls, { lvl: "ERROR", msg: "WebSocket connection error" }]);
    };
    ws.onclose = () => {
      // If the WS closed before we got a done/error event, reconcile via HTTP.
      if (liveRunId === jobId) {
        api.getJob(jobId).then((j) => {
          if (j.status === "completed" || j.status === "failed") {
            finishRun(jobId, j.status, agent.id);
          }
        }).catch(() => {});
      }
    };
  }

  function startRun(agent: Agent) {
    if (!agent || !agent.enabled) return;
    if (!currentProject?.repo_name) {
      // Gate: every project needs a repo_name (folder under workspaces/) before
      // an agent can run. Store the pending agent and prompt the user.
      setPendingAgent(agent);
      setAgentModal(null);
      setRepoNamePrompt(true);
      return;
    }
    void doStart(agent);
  }

  async function confirmRepoName(name: string) {
    const updated = await api.updateProject(project, { repo_name: name });
    setProjects((prev) => prev.map((p) => p.name === updated.name ? updated : p));
    setRepoNamePrompt(false);
    const a = pendingAgent;
    setPendingAgent(null);
    if (a) setTimeout(() => { void doStart(a); }, 60);
  }

  function confirmRepo(path: string) {
    setRepoPath(path);
    setRepoPrompt(false);
    const a = pendingAgent;
    setPendingAgent(null);
    if (a) setTimeout(() => { void doStart(a); }, 60);
  }

  const lastRun = runs.length ? runs[0].started : "—";
  const isLive = !!currentRun && currentRun.id === liveRunId;
  const visibleLines: LogLine[] = liveLogs;

  const QuitModal = (
    <Modal open={quitConfirm} onClose={() => setQuitConfirm(false)} width={400} labelledBy="quit-confirm-title">
      <div style={{ padding: "22px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--surface-3)", color: "var(--text-2)" }}>
            <Icon name="x" size={20} />
          </span>
          <h3 id="quit-confirm-title" style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Quit OpenSecAI?</h3>
        </div>
        <ModalClose onClose={() => setQuitConfirm(false)} />
      </div>
      <div style={{ padding: "18px 24px" }}>
        <p style={{ fontSize: 14, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.65 }}>
          Any agent run currently in progress will be stopped. Are you sure you want to quit?
        </p>
      </div>
      <div style={{ padding: "4px 24px 22px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => setQuitConfirm(false)}>Cancel</Button>
        <Button variant="danger" onClick={() => { void invoke("quit_app"); }}>Quit</Button>
      </div>
    </Modal>
  );

  /* Entry screens — no rail */
  if (screen === "landing") {
    return (
      <>
        <LandingPage
          onCreate={() => setScreen("create")}
          onSwitch={switchProject}
          projects={projects}
        />
        {QuitModal}
      </>
    );
  }
  if (screen === "create") {
    return (
      <>
        <CreateProjectPage onBack={() => setScreen("landing")} onCreate={createProject} dataRoot={dataRoot} />
        {QuitModal}
      </>
    );
  }

  /* Project shell with sidebar */
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <LeftRail
        screen={screen}
        onNav={setScreen}
        project={project}
        projects={projects}
        runningAgent={runningAgent}
        onAgentClick={(a) => {
          if (!a.enabled) { setAgentModal(a); return; }
          setHistoryAgent(a.id);
          setScreen("agent_history");
        }}
        onSwitch={switchProject}
        onExit={exitToLanding}
        pendingNotifications={pendingCount}
      />
      <main style={{
        flex: 1,
        minWidth: 0,
        height: "100vh",
        overflowY: screen === "logs" ? "hidden" : "auto",
        background: "var(--bg)",
      }}>
        {screen === "dashboard" && (
          <DashboardPage
            project={project}
            rootDir={currentProject?.root_dir ?? ""}
            repoPath={repoPath}
            lastRun={lastRun}
            runs={runs}
            onAgentClick={(a) => setAgentModal(a)}
            onRunDep={() => setAgentModal(AGENTS[0])}
          />
        )}
        {screen === "history" && (
          <RunHistoryPage
            runs={runs}
            onLogs={(r) => {
              setCurrentRun(r);
              setLogsBackScreen("history");
              if (r.id !== liveRunId) setLiveLogs([{ lvl: "INFO", msg: "No live transcript available for past runs." }]);
              setScreen("logs");
            }}
            onResults={(r) => { setCurrentRun(r); setScreen("results"); }}
          />
        )}
        {screen === "logs" && (
          <LogViewerPage
            run={currentRun}
            lines={visibleLines}
            running={!!isLive}
            onBack={() => setScreen(logsBackScreen)}
            onResults={(r) => { setCurrentRun(r); setScreen("results"); }}
          />
        )}
        {screen === "results" && (
          <ResultsPage
            project={project}
            rootDir={currentProject?.root_dir ?? ""}
            run={currentRun}
            onBack={() => setScreen("agent_history")}
          />
        )}
        {screen === "agent_history" && historyAgent && (
          <AgentRunHistoryPage
            project={project}
            rootDir={currentProject?.root_dir ?? ""}
            agentId={historyAgent}
            onBack={() => setScreen("dashboard")}
            onLogs={(entry) => {
              setLogsBackScreen("agent_history");
              const rootDir = currentProject?.root_dir ?? "";

              if (entry.status === "running") {
                // Case 1: this session already owns the live stream for this agent.
                if (liveRunId && runningAgent === historyAgent) {
                  setScreen("logs");
                  return;
                }

                // Case 2: run was started outside this session — look it up via HTTP.
                const r: Run = {
                  id: entry.run_id,
                  agent: historyAgent,
                  status: "running",
                  started: entry.timestamp,
                  duration: "—",
                };
                setCurrentRun(r);
                setLiveLogs([{ lvl: "INFO", msg: "Connecting to live run…" }]);
                setScreen("logs");

                api.listJobs().then((jobs) => {
                  const job = jobs.find(
                    (j) => j.agent === historyAgent && j.project === project && j.status === "running",
                  );
                  if (!job) {
                    setLiveLogs([{ lvl: "WARN", msg: "No active job stream found. The run may have been started outside this session." }]);
                    return;
                  }
                  if (wsRef.current) {
                    try { wsRef.current.close(); } catch { /* noop */ }
                    wsRef.current = null;
                  }
                  const ws = openJobStream(job.id);
                  wsRef.current = ws;
                  setRunningAgent(historyAgent);
                  setLiveRunId(job.id);
                  setLiveLogs([]);
                  ws.onmessage = (msg) => {
                    try {
                      const ev: JobEvent = JSON.parse(msg.data);
                      setLiveLogs((ls) => [...ls, eventToLogLine(ev)]);
                      if (ev.kind === "done") finishRun(job.id, "completed", historyAgent);
                      else if (ev.kind === "error") finishRun(job.id, "failed", historyAgent);
                    } catch { /* ignore malformed frames */ }
                  };
                  ws.onerror = () => setLiveLogs((ls) => [...ls, { lvl: "ERROR", msg: "WebSocket connection error" }]);
                  ws.onclose = () => {
                    api.getJob(job.id).then((j) => {
                      if (j.status === "completed" || j.status === "failed") finishRun(job.id, j.status, historyAgent);
                    }).catch(() => {});
                  };
                }).catch(() => {
                  setLiveLogs([{ lvl: "ERROR", msg: "Failed to query active jobs." }]);
                });
                return;
              }

              // Past run — load static transcript.
              const r: Run = {
                id: entry.run_id,
                agent: historyAgent,
                status: entry.status === "completed" ? "completed" : "failed",
                started: entry.timestamp,
                duration: "—",
              };
              setCurrentRun(r);
              setLiveLogs([{ lvl: "INFO", msg: "Loading transcript…" }]);
              setScreen("logs");
              api.getRunEvents(rootDir, project, historyAgent, entry.run_id).then((evs) => {
                if (evs.length === 0) {
                  setLiveLogs([{ lvl: "INFO", msg: "No transcript was saved for this run (pre-persistence or run still in progress)." }]);
                } else {
                  setLiveLogs(evs.map(eventToLogLine));
                }
              }).catch((err: unknown) => {
                setLiveLogs([{ lvl: "ERROR", msg: `Failed to load transcript: ${String(err)}` }]);
              });
            }}
            onResults={(entry) => {
              const r: Run = {
                id: entry.run_id,
                agent: historyAgent,
                status: "completed",
                started: entry.timestamp,
                duration: "—",
              };
              setCurrentRun(r);
              setScreen("results");
            }}
          />
        )}
      </main>

      <AgentModal
        agent={agentModal}
        runningAgent={runningAgent}
        onClose={() => setAgentModal(null)}
        onRun={startRun}
      />
      <RepoPathModal
        open={repoPrompt}
        agentName={pendingAgent ? pendingAgent.name : ""}
        onClose={() => { setRepoPrompt(false); setPendingAgent(null); }}
        onConfirm={confirmRepo}
      />
      <RepoNameModal
        open={repoNamePrompt}
        project={project}
        initialValue={currentProject?.repo_name ?? ""}
        onClose={() => { setRepoNamePrompt(false); setPendingAgent(null); }}
        onConfirm={confirmRepoName}
      />

      {QuitModal}

      {/* Sidecar unavailable error */}
      <Modal open={!!sidecarError} onClose={() => setSidecarError(null)} width={460} labelledBy="sidecar-err-title">
        <div style={{ padding: "22px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: "var(--error-bg)", color: "var(--error)" }}>
              <Icon name="alertTriangle" size={20} />
            </span>
            <h3 id="sidecar-err-title" style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Backend Unavailable</h3>
          </div>
          <ModalClose onClose={() => setSidecarError(null)} />
        </div>
        <div style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 14, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {sidecarError}
          </p>
        </div>
        <div style={{ padding: "4px 24px 22px", display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={() => setSidecarError(null)}>Dismiss</Button>
        </div>
      </Modal>
    </div>
  );
}

export default function App() {
  return (
    <NotificationProvider>
      <AppInner />
    </NotificationProvider>
  );
}
