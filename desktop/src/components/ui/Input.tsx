import React, { useState } from "react";

interface InputProps {
  label?: string;
  value: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  mono?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  rightSlot?: React.ReactNode;
  hint?: string;
  style?: React.CSSProperties;
}

export function Input({ label, value, onChange, placeholder, mono, autoFocus, onEnter, rightSlot, hint, style }: InputProps) {
  const [focus, setFocus] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {label && (
        <label style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13, color: "var(--text-2)" }}>
          {label}
        </label>
      )}
      <div style={{
        display: "flex",
        alignItems: "center",
        height: 48,
        background: "var(--surface-3)",
        border: `1px solid ${focus ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--r-input)",
        boxShadow: focus ? "0 0 0 3px var(--accent-ring)" : "none",
        transition: "all var(--t-base)",
        overflow: "hidden",
        ...style,
      }}>
        <input
          value={value}
          onChange={(e) => onChange && onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
          style={{
            flex: 1,
            height: "100%",
            padding: "0 16px",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text)",
            fontSize: mono ? 13 : 15,
            fontFamily: mono ? "var(--font-mono)" : "var(--font-body)",
            fontWeight: 500,
          }}
        />
        {rightSlot}
      </div>
      {hint && <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>{hint}</span>}
    </div>
  );
}
