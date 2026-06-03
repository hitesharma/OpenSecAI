import React, { useEffect, useState } from "react";
import { Icon } from "../Icon";

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  width?: number;
  labelledBy?: string;
}

export function Modal({ open, onClose, children, width = 460, labelledBy }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,9,12,0.66)",
        backdropFilter: "blur(3px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-card)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalCloseProps {
  onClose: () => void;
}

export function ModalClose({ onClose }: ModalCloseProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: "unset" as const,
        cursor: "pointer",
        width: 32,
        height: 32,
        borderRadius: 8,
        display: "grid",
        placeItems: "center",
        color: hover ? "var(--text)" : "var(--text-3)",
        background: hover ? "var(--surface-2)" : "transparent",
        transition: "all var(--t-fast)",
        boxSizing: "border-box",
      }}
    >
      <Icon name="x" size={18} />
    </button>
  );
}
