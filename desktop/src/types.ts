export interface Agent {
  id: string;
  name: string;
  title: string;
  icon: string;
  enabled: boolean;
  short: string;
  desc: string;
  scanner: string;
  scannerNote: string;
}

export interface Run {
  id: string;
  agent: string;
  status: "running" | "completed" | "failed";
  started: string;
  duration: string;
}

export interface Vulnerability {
  cve: string;
  pkg: string;
  sev: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  desc: string;
  from: string;
  to: string | null;
}

export interface ScanResults {
  fixed: Vulnerability[];
  added: Vulnerability[];
  persisted: Vulnerability[];
}

export interface LogLine {
  lvl: "INFO" | "WARN" | "ERROR";
  msg: string;
}

export type Screen = "landing" | "create" | "dashboard" | "history" | "logs" | "results" | "agent_history";

export interface AgentRunSummary {
  fixed: number;
  persisted: number;
  new: number;
}

/**
 * Raw Trivy-style vulnerability entry as written to `diff.json`.
 * Only the fields the UI uses are typed; the rest are tolerated.
 */
export interface RawVuln {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  Title?: string;
  Description?: string;
  Status?: string;
  PrimaryURL?: string;
}

export interface RawScanDiff {
  fixed: RawVuln[];
  new: RawVuln[];
  persisted: RawVuln[];
}

/** One line from `events.jsonl` written by the agent runner. */
export interface RawEventLine {
  kind: "log" | "status" | "error" | "done" | "pause";
  payload: string;
  timestamp: string;
}

/** Also add "paused" as a valid run status for the index.json entry. */
export interface AgentRunEntry {
  run_id: string;
  timestamp: string;
  status: "running" | "completed" | "failed" | "partial" | "paused";
  summary: AgentRunSummary;
}
