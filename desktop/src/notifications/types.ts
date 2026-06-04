/**
 * Generic notification system.
 *
 * Every notification has a discriminated `payload.type` field.  Adding a new
 * notification kind means adding a new member to `NotificationPayload` — no
 * other infrastructure changes are required.
 *
 * Current types:
 *   "pause"  — agent workflow is paused and needs a user decision to continue.
 *   "alert"  — informational / warning message (rendering TBD).
 */

// ── Payloads (one per type) ──────────────────────────────────────────────────

/** One selectable option inside a pause dialog, mirroring PauseOption in notification_contracts.py. */
export interface PauseOption {
  /** Machine-readable token returned to the agent. */
  value: string;
  /** Short button label. */
  label: string;
  /** Longer description shown beneath the label. */
  desc: string;
  /** Visual variant: "primary" (accent) or "ghost" (neutral). */
  variant?: "primary" | "ghost";
}

export interface PausePayload {
  type: "pause";
  prompt: string;
  /** Full option objects from the contract — render directly, no local lookup needed. */
  options: PauseOption[];
}

export interface AlertPayload {
  type: "alert";
  message: string;
  severity?: "info" | "warning" | "error";
}

/** Discriminated union — extend here when new notification kinds are needed. */
export type NotificationPayload = PausePayload | AlertPayload;

// ── Notification record ──────────────────────────────────────────────────────

export type NotificationStatus = "pending" | "resolved" | "dismissed";

export interface AppNotification {
  /** Locally generated UUID — stable key for React lists and store lookups. */
  id: string;
  /** The sidecar job_id (UUID hex) this notification belongs to. */
  jobId: string;
  /**
   * Filesystem run_id (YYYYMMDD_HHMMSS) — null while the job is still live
   * (swapped in by App.tsx once finishRun resolves it).
   */
  runId: string | null;
  /** Agent identifier, e.g. "dep_scan". */
  agentId: string;
  timestamp: string;
  status: NotificationStatus;
  payload: NotificationPayload;
}
