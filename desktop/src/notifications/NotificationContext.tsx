import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import { api } from "../api/client";
import type { AppNotification, NotificationPayload } from "./types";

// ── State & reducer ──────────────────────────────────────────────────────────

interface State {
  notifications: AppNotification[];
}

type Action =
  | { type: "ADD"; notification: AppNotification }
  | { type: "RESOLVE"; id: string }
  | { type: "DISMISS"; id: string }
  | { type: "UPDATE_RUN_ID"; jobId: string; runId: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD":
      return { notifications: [action.notification, ...state.notifications] };

    case "RESOLVE":
      return {
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, status: "resolved" } : n
        ),
      };

    case "DISMISS":
      return {
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, status: "dismissed" } : n
        ),
      };

    case "UPDATE_RUN_ID":
      return {
        notifications: state.notifications.map((n) =>
          n.jobId === action.jobId && n.runId === null
            ? { ...n, runId: action.runId }
            : n
        ),
      };

    default:
      return state;
  }
}

// ── Context value ────────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: AppNotification[];
  /** Number of "pending" notifications — use for badge counts. */
  pendingCount: number;

  /**
   * Add a notification that arrived from a WebSocket event.
   * `id` is generated automatically.
   */
  addNotification(opts: {
    jobId: string;
    runId: string | null;
    agentId: string;
    timestamp: string;
    payload: NotificationPayload;
  }): void;

  /**
   * Resolve a pending notification.
   * For "pause" type, also POSTs the decision to the sidecar.
   */
  resolveNotification(id: string, decision?: string): Promise<void>;

  /** Dismiss without acting — marks as dismissed. */
  dismissNotification(id: string): void;

  /**
   * Once finishRun swaps job_id → FS run_id, call this to back-fill
   * any notifications that arrived during the live run.
   */
  updateRunId(jobId: string, runId: string): void;

  /** Convenience: all pending notifications for a specific job. */
  getPendingForJob(jobId: string): AppNotification[];
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { notifications: [] });

  const pendingCount = useMemo(
    () => state.notifications.filter((n) => n.status === "pending").length,
    [state.notifications]
  );

  const addNotification = useCallback(
    (opts: {
      jobId: string;
      runId: string | null;
      agentId: string;
      timestamp: string;
      payload: NotificationPayload;
    }) => {
      const notification: AppNotification = {
        id: crypto.randomUUID(),
        status: "pending",
        ...opts,
      };
      dispatch({ type: "ADD", notification });
    },
    []
  );

  const resolveNotification = useCallback(
    async (id: string, decision?: string) => {
      const n = state.notifications.find((x) => x.id === id);
      if (!n || n.status !== "pending") return;

      if (n.payload.type === "pause" && decision) {
        await api.resolveJobDecision(n.jobId, decision);
      }

      dispatch({ type: "RESOLVE", id });
    },
    [state.notifications]
  );

  const dismissNotification = useCallback((id: string) => {
    dispatch({ type: "DISMISS", id });
  }, []);

  const updateRunId = useCallback((jobId: string, runId: string) => {
    dispatch({ type: "UPDATE_RUN_ID", jobId, runId });
  }, []);

  const getPendingForJob = useCallback(
    (jobId: string) =>
      state.notifications.filter(
        (n) => n.jobId === jobId && n.status === "pending"
      ),
    [state.notifications]
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications: state.notifications,
      pendingCount,
      addNotification,
      resolveNotification,
      dismissNotification,
      updateRunId,
      getPendingForJob,
    }),
    [
      state.notifications,
      pendingCount,
      addNotification,
      resolveNotification,
      dismissNotification,
      updateRunId,
      getPendingForJob,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}
