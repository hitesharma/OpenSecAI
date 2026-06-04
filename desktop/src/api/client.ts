/**
 * Typed HTTP client for the OpenSecAI FastAPI sidecar.
 *
 * Base URL comes from VITE_OPENSECAI_API (e.g. http://127.0.0.1:8765)
 * and falls back to the sidecar's default port.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AgentRunEntry, RawEventLine, RawScanDiff } from "../types";

const BASE_URL =
  (import.meta.env.VITE_OPENSECAI_API as string | undefined) ?? "http://127.0.0.1:8765";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ── Types (mirror opensecai/schemas + route response models) ── */

export interface Project {
  name: string;
  root_dir: string;
  repo_name?: string | null;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  agent: string;
  project: string;
  status: JobStatus;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface JobEvent {
  job_id: string;
  kind: "log" | "status" | "error" | "done" | "pause";
  payload: string;
  timestamp: string;
}

/* ── Endpoints ── */

export const api = {
  health(): Promise<{ status: string; data_root: string }> {
    return request("/health");
  },

  getSettings(): Promise<{ data_root: string | null }> {
    return request("/settings");
  },

  setDataRoot(dataRoot: string): Promise<{ data_root: string | null }> {
    return request("/settings", {
      method: "PATCH",
      body: JSON.stringify({ data_root: dataRoot }),
    });
  },

  listProjects(): Promise<Project[]> {
    return request<{ projects: Project[] }>("/projects").then((r) => r.projects);
  },

  createProject(name: string, rootDir?: string): Promise<Project> {
    return request("/projects", {
      method: "POST",
      body: JSON.stringify({ name, ...(rootDir ? { root_dir: rootDir } : {}) }),
    });
  },

  updateProject(name: string, patch: { repo_name?: string }): Promise<Project> {
    return request(`/projects/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  listAgents(): Promise<string[]> {
    return request<{ agents: string[] }>("/agents").then((r) => r.agents);
  },

  runAgent(agent: string, project: string, repoPath?: string): Promise<{ job_id: string }> {
    return request(`/agents/${encodeURIComponent(agent)}/run`, {
      method: "POST",
      body: JSON.stringify({ project, repo_path: repoPath }),
    });
  },

  listJobs(): Promise<Job[]> {
    return request<{ jobs: Job[] }>("/jobs").then((r) => r.jobs);
  },

  getJob(id: string): Promise<Job> {
    return request(`/jobs/${id}`);
  },

  cancelJob(id: string): Promise<{ cancelled: boolean }> {
    return request(`/jobs/${id}/cancel`, { method: "POST" });
  },

  /**
   * Send a user decision to a paused job, unblocking its worker thread.
   * Maps to POST /jobs/{jobId}/decision on the sidecar.
   */
  resolveJobDecision(jobId: string, decision: string): Promise<{ resumed: boolean; decision: string }> {
    return request(`/jobs/${encodeURIComponent(jobId)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  },

  /**
   * Read `<rootDir>/reports/<project>/<agent>/index.json` via the Tauri backend.
   * Returns an empty array if the index does not exist yet.
   * Pass rootDir="" to fall back to the global data dir (legacy/dev).
   */
  listAgentRuns(rootDir: string, project: string, agent: string): Promise<AgentRunEntry[]> {
    return invoke<AgentRunEntry[]>("read_agent_index", { rootDir, project, agent });
  },

  /**
   * Read `<rootDir>/reports/<project>/<agent>/<runId>/diff.json` via the Tauri backend.
   * Resolves to `null` if the file does not exist (run hasn't completed yet,
   * or it predates the diff format).
   */
  getRunDiff(rootDir: string, project: string, agent: string, runId: string): Promise<RawScanDiff | null> {
    return invoke<RawScanDiff | null>("read_run_diff", { rootDir, project, agent, runId });
  },

  /**
   * Read `<rootDir>/reports/<project>/<agent>/<runId>/events.jsonl` via the Tauri backend.
   * Returns an empty array if no transcript was saved (pre-persistence runs).
   */
  getRunEvents(rootDir: string, project: string, agent: string, runId: string): Promise<RawEventLine[]> {
    return invoke<RawEventLine[]>("read_run_events", { rootDir, project, agent, runId });
  },

  /**
   * Delete a single run: removes `<rootDir>/reports/<project>/<agent>/<runId>/`
   * and drops its entry from index.json. Idempotent.
   */
  deleteAgentRun(rootDir: string, project: string, agent: string, runId: string): Promise<void> {
    return invoke<void>("delete_agent_run", { rootDir, project, agent, runId });
  },
};

/**
 * Open a WebSocket to stream job events. Caller owns lifecycle.
 */
export function openJobStream(jobId: string): WebSocket {
  const wsBase = BASE_URL.replace(/^http/, "ws");
  return new WebSocket(`${wsBase}/ws/jobs/${encodeURIComponent(jobId)}/stream`);
}
