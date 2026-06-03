import React from "react";

interface LogoProps {
  size?: number;
  showWord?: boolean;
}

export function Logo({ size = 26, showWord = true }: LogoProps) {
  const id = `lg${size}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#818CF8" />
            <stop offset="1" stopColor="#5B53E0" />
          </linearGradient>
        </defs>
        <path d="M16 2.5l11 4.2v7.1c0 6.6-4.5 11-11 13.7C9 28.8 4.5 24.4 4.5 17.8v-7.1L16 2.5z" fill={`url(#${id})`} />
        <path d="M11.2 16.3l3.2 3.2 6.4-6.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      {showWord && (
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em", color: "var(--text)" }}>
          OpenSec<span style={{ color: "var(--accent-bright)" }}>AI</span>
        </span>
      )}
    </div>
  );
}
