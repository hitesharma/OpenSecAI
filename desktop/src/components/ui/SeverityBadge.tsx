import React from "react";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface SeverityBadgeProps {
  level: Severity;
}

const MAP: Record<Severity, { c: string; bg: string }> = {
  CRITICAL: { c: "var(--sev-critical)", bg: "var(--sev-critical-bg)" },
  HIGH:     { c: "var(--sev-high)",     bg: "var(--sev-high-bg)" },
  MEDIUM:   { c: "var(--sev-medium)",   bg: "var(--sev-medium-bg)" },
  LOW:      { c: "var(--sev-low)",      bg: "var(--sev-low-bg)" },
};

export function SeverityBadge({ level }: SeverityBadgeProps) {
  const m = MAP[level] ?? { c: "var(--text-3)", bg: "var(--surface-2)" };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 9px",
      borderRadius: "var(--r-badge)",
      background: m.bg,
      color: m.c,
      border: `1px solid ${m.c}33`,
      fontFamily: "var(--font-heading)",
      fontWeight: 700,
      fontSize: 10.5,
      letterSpacing: "0.06em",
    }}>
      {level}
    </span>
  );
}
