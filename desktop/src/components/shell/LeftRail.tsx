import React, { useState, useRef, useEffect } from "react";
import { Icon } from "../Icon";
import { Logo } from "../Logo";
import { StatusPill } from "../ui/StatusPill";
import { AGENTS } from "../../mockData";
import type { Agent, Screen } from "../../types";
import type { Project } from "../../api/client";

interface RailItemProps {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}

function RailItem({ icon, label, active, onClick, trailing }: RailItemProps) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        width: "100%",
        height: 42,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px 0 16px",
        borderRadius: 10,
        borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
        marginLeft: -3,
        background: active ? "var(--accent-soft)" : h ? "var(--surface-2)" : "transparent",
        color: active ? "var(--text)" : "var(--text-2)",
        fontFamily: "var(--font-body)",
        fontWeight: active ? 700 : 500,
        fontSize: 14.5,
        transition: "background var(--t-fast), color var(--t-fast)",
      }}
    >
      <span style={{ color: active ? "var(--accent-bright)" : "var(--text-3)", display: "inline-flex" }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {trailing}
    </button>
  );
}

interface AgentRailItemProps {
  agent: Agent;
  runningAgent: string | null;
  onClick: (a: Agent) => void;
}

function AgentRailItem({ agent, runningAgent, onClick }: AgentRailItemProps) {
  const [h, setH] = useState(false);
  const isRunning = runningAgent === agent.id;
  const dim = !agent.enabled;

  return (
    <button
      onClick={() => onClick(agent)}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        width: "100%",
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "7px 12px",
        borderRadius: 10,
        background: h ? "var(--surface-2)" : "transparent",
        opacity: dim ? 0.55 : 1,
        transition: "background var(--t-fast)",
      }}
    >
      <span style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        background: agent.enabled ? "var(--accent-soft)" : "var(--surface-3)",
        color: agent.enabled ? "var(--accent-bright)" : "var(--text-3)",
        border: `1px solid ${agent.enabled ? "transparent" : "var(--border-soft)"}`,
      }}>
        <Icon name={agent.icon} size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {agent.name}
        </span>
      </span>
      {agent.enabled
        ? <StatusPill status={isRunning ? "running" : "idle"} mini />
        : <span style={{ fontSize: 10, fontFamily: "var(--font-heading)", fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Soon</span>
      }
    </button>
  );
}

interface ProjectDropItemProps {
  name: string;
  active: boolean;
  onClick: () => void;
  icon?: string;
}

function ProjectDropItem({ name, active, onClick, icon }: ProjectDropItemProps) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 12px",
        background: active ? "var(--accent-soft)" : h ? "var(--surface-2)" : "transparent",
        transition: "background var(--t-fast)",
      }}
    >
      <span style={{ display: "inline-flex", color: active ? "var(--accent-bright)" : "var(--text-3)" }}>
        <Icon name={icon ?? (active ? "check" : "folder")} size={14} />
      </span>
      <span style={{
        fontFamily: "var(--font-heading)",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        color: active ? "var(--text)" : "var(--text-2)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {name}
      </span>
    </button>
  );
}

interface LeftRailProps {
  screen: Screen;
  onNav: (s: Screen) => void;
  project: string;
  projects: Project[];
  runningAgent: string | null;
  onAgentClick: (a: Agent) => void;
  onSwitch: (name: string) => void;
  onExit: () => void;
}

export function LeftRail({ screen, onNav, project, projects, runningAgent, onAgentClick, onSwitch, onExit }: LeftRailProps) {
  const [dropOpen, setDropOpen] = useState(false);
  const [projHover, setProjHover] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropOpen]);

  return (
    <aside style={{
      width: "var(--rail-width)",
      flexShrink: 0,
      background: "var(--rail)",
      borderRight: "1px solid var(--border-soft)",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Brand + project */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border-soft)" }}>
        <Logo size={26} />

        {/* Project switcher */}
        <div ref={dropRef} style={{ position: "relative", marginTop: 16 }}>
          <button
            onClick={() => setDropOpen((o) => !o)}
            onMouseEnter={() => setProjHover(true)}
            onMouseLeave={() => setProjHover(false)}
            style={{
              all: "unset",
              cursor: "pointer",
              width: "100%",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: dropOpen || projHover ? "var(--surface-2)" : "var(--surface)",
              border: `1px solid ${dropOpen ? "var(--accent)" : "var(--border-soft)"}`,
              transition: "background var(--t-fast), border-color var(--t-fast)",
            }}
            title="Switch project"
          >
            <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: "grid", placeItems: "center", background: "var(--accent-soft)", color: "var(--accent-bright)" }}>
              <Icon name="folder" size={15} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="section-label" style={{ display: "block", fontSize: 9.5, marginBottom: 1 }}>Project</span>
              <span style={{ display: "block", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project}</span>
            </span>
            <Icon name="chevDown" size={14} style={{ color: "var(--text-3)", transform: dropOpen ? "rotate(180deg)" : "none", transition: "transform var(--t-fast)" }} />
          </button>

          {dropOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--surface)",
              border: "1px solid var(--border-soft)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}>
              {projects.length === 0 ? (
                <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
                  No projects yet
                </div>
              ) : (
                projects.map((p) => (
                  <ProjectDropItem
                    key={p.name}
                    name={p.name}
                    active={p.name === project}
                    onClick={() => { setDropOpen(false); if (p.name !== project) onSwitch(p.name); }}
                  />
                ))
              )}
              <div style={{ borderTop: "1px solid var(--border-soft)" }}>
                <ProjectDropItem name="New project…" icon="plus" active={false} onClick={() => { setDropOpen(false); onExit(); }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div style={{ padding: "14px 12px 8px" }}>
        <RailItem icon="grid" label="Dashboard" active={screen === "dashboard"} onClick={() => onNav("dashboard")} />
        {/* <RailItem icon="history" label="Run History" active={screen === "history" || screen === "logs" || screen === "results"} onClick={() => onNav("history")} /> */}
      </div>

      {/* Agents */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 12px" }}>
        <div className="section-label" style={{ padding: "8px 12px 8px" }}>Security Agents</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {AGENTS.map((a) => (
            <AgentRailItem key={a.id} agent={a} runningAgent={runningAgent} onClick={onAgentClick} />
          ))}
        </div>
      </div>

      {/* Footer status */}
      <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)" }} />
        {/* <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>1 of 7 agents active</span> */}
      </div>
    </aside>
  );
}
