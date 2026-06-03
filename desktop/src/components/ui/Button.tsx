import React, { useState } from "react";
import { Icon } from "../Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  children?: React.ReactNode;
  onClick?: () => void;
  icon?: string;
  iconRight?: string;
  full?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export function Button({
  variant = "primary",
  size = "md",
  children,
  onClick,
  icon,
  iconRight,
  full,
  disabled,
  style,
}: ButtonProps) {
  const [hover, setHover] = useState(false);

  const h = size === "sm" ? 34 : size === "lg" ? 48 : 40;
  const pad = size === "lg" ? "0 24px" : size === "sm" ? "0 14px" : "0 18px";
  const fs = size === "lg" ? 15 : size === "sm" ? 13 : 14;

  const variants: Record<Variant, React.CSSProperties> = {
    primary: {
      background: disabled ? "#2A2E36" : hover ? "var(--accent-dim)" : "var(--accent)",
      color: disabled ? "var(--text-3)" : "#fff",
      border: "1px solid transparent",
      boxShadow: disabled ? "none" : "0 2px 14px rgba(99,102,241,0.32)",
    },
    secondary: {
      background: hover ? "var(--surface-3)" : "var(--surface-2)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
    },
    ghost: {
      background: hover ? "var(--surface-2)" : "transparent",
      color: "var(--text-2)",
      border: "1px solid transparent",
    },
    danger: {
      background: hover ? "#E5484D" : "transparent",
      color: hover ? "#fff" : "var(--error)",
      border: "1px solid var(--error)",
    },
  };

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={{
        ...variants[variant],
        height: h,
        padding: pad,
        width: full ? "100%" : "auto",
        borderRadius: "var(--r-input)",
        fontFamily: "var(--font-heading)",
        fontWeight: 600,
        fontSize: fs,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        transition: "all var(--t-base)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={fs + 3} />}
      {children}
      {iconRight && <Icon name={iconRight} size={fs + 2} />}
    </button>
  );
}
