import React from "react";

type Status = "idle" | "running" | "completed" | "failed" | "soon";

interface StatusPillProps {
  status: Status;
  mini?: boolean;
}

const STATUS: Record<Status, { label: string; c: string; bg: string }> = {
  idle:      { label: "Idle",        c: "var(--idle)",    bg: "var(--idle-bg)" },
  running:   { label: "Running",     c: "var(--info)",    bg: "var(--info-bg)" },
  completed: { label: "Completed",   c: "var(--success)", bg: "var(--success-bg)" },
  failed:    { label: "Failed",      c: "var(--error)",   bg: "var(--error-bg)" },
  soon:      { label: "Coming Soon", c: "var(--text-3)",  bg: "var(--idle-bg)" },
};

export function StatusPill({ status, mini }: StatusPillProps) {
  const s = STATUS[status] ?? STATUS.idle;
  const running = status === "running";

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      padding: mini ? "3px 9px" : "5px 11px",
      borderRadius: "var(--r-pill)",
      background: s.bg,
      color: s.c,
      fontFamily: "var(--font-heading)",
      fontWeight: 600,
      fontSize: mini ? 10.5 : 11.5,
      letterSpacing: "0.04em",
      border: `1px solid ${s.c}22`,
    }}>
      <span
        className={running ? "pulse-dot" : ""}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.c,
          ["--pulse-color" as string]: "rgba(96,165,250,0.55)",
        }}
      />
      {s.label}
    </span>
  );
}
