import React, { useEffect, useRef } from "react";
import { Logo } from "../components/Logo";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { AGENTS } from "../mockData";
import type { Project } from "../api/client";

interface LandingPageProps {
  onCreate: () => void;
  onSwitch: (name: string) => void;
  projects: Project[];
}

export function LandingPage({ onCreate, onSwitch, projects }: LandingPageProps) {
  const [dropOpen, setDropOpen] = React.useState(false);
  const [openHover, setOpenHover] = React.useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [dropOpen]);

  const hasProjects = projects.length > 0;

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ambient glow */}
      <div style={{
        position: "absolute",
        top: "-20%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 720,
        height: 720,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.13), transparent 62%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "absolute", top: 28, left: 32 }}>
        <Logo size={26} />
      </div>

      <div style={{
        position: "relative",
        maxWidth: 620,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        {/* Shield icon */}
        <div style={{
          width: 76,
          height: 76,
          borderRadius: 20,
          display: "grid",
          placeItems: "center",
          marginBottom: 28,
          background: "linear-gradient(150deg, rgba(129,140,248,0.18), rgba(99,102,241,0.06))",
          border: "1px solid rgba(129,140,248,0.28)",
          boxShadow: "0 12px 40px rgba(99,102,241,0.18)",
        }}>
          <Icon name="shieldCheck" size={36} stroke={1.6} style={{ color: "var(--accent-bright)" }} />
        </div>

        <h1 style={{ fontSize: "var(--text-3xl)", fontWeight: 700, lineHeight: 1.1 }}>
          OpenSec<span style={{ color: "var(--accent-bright)" }}>AI</span>
        </h1>
        <p style={{ marginTop: 14, fontSize: 18, color: "var(--text-2)", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
          AI-powered security scanning for your codebase
        </p>

        {/* Agent chips */}
        <div style={{ marginTop: 30, display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center", maxWidth: 540 }}>
          {AGENTS.map((a) => (
            <span key={a.id} style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 13px",
              borderRadius: "var(--r-pill)",
              background: a.enabled ? "var(--accent-soft)" : "var(--surface)",
              border: `1px solid ${a.enabled ? "rgba(129,140,248,0.3)" : "var(--border-soft)"}`,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 500,
              color: a.enabled ? "var(--accent-bright)" : "var(--text-3)",
            }}>
              <Icon name={a.icon} size={13} />
              {a.name}
            </span>
          ))}
        </div>

        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 280 }}>
          <Button size="lg" icon="plus" onClick={onCreate} style={{ minWidth: 240, height: 52, fontSize: 15.5 }}>
            Create New Project
          </Button>

          {/* Open existing — shows dropdown if projects exist */}
          <div ref={dropRef} style={{ position: "relative", width: "100%" }}>
            <button
              onClick={() => hasProjects ? setDropOpen((o) => !o) : undefined}
              onMouseEnter={() => setOpenHover(true)}
              onMouseLeave={() => setOpenHover(false)}
              disabled={!hasProjects}
              style={{
                all: "unset",
                cursor: hasProjects ? "pointer" : "default",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 14,
                color: !hasProjects
                  ? "var(--text-3)"
                  : openHover || dropOpen
                    ? "var(--accent-bright)"
                    : "var(--text-2)",
                padding: "4px 8px",
                borderRadius: 8,
                transition: "color var(--t-fast)",
              }}
            >
              <Icon name="folderOpen" size={16} />
              Open Existing Project
              {hasProjects && (
                <Icon
                  name="chevDown"
                  size={14}
                  style={{
                    marginLeft: 2,
                    transform: dropOpen ? "rotate(180deg)" : "none",
                    transition: "transform var(--t-fast)",
                  }}
                />
              )}
            </button>

            {dropOpen && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                width: 260,
                zIndex: 100,
                background: "var(--surface)",
                border: "1px solid var(--border-soft)",
                borderRadius: 12,
                boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
                overflow: "hidden",
                marginBottom: 24,
              }}>
                <div style={{
                  padding: "8px 12px 6px",
                  fontSize: 10.5,
                  fontFamily: "var(--font-heading)",
                  fontWeight: 700,
                  color: "var(--text-3)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  borderBottom: "1px solid var(--border-soft)",
                }}>
                  Projects
                </div>
                <div style={{ maxHeight: 144, overflowY: "auto", paddingBottom: 6 }}>
                  {projects.map((p) => (
                    <ProjectItem
                      key={p.name}
                      project={p}
                      onClick={() => { setDropOpen(false); onSwitch(p.name); }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {!hasProjects && (
            <p style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-body)", margin: 0 }}>
              No projects yet — create one to get started.
            </p>
          )}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 24, fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
        v1.0.0 · FOSS · local-first
      </div>
    </div>
  );
}

interface ProjectItemProps {
  project: Project;
  onClick: () => void;
}

function ProjectItem({ project, onClick }: ProjectItemProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: hover ? "var(--surface-2)" : "transparent",
        transition: "background var(--t-fast)",
      }}
    >
      <span style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        background: "var(--accent-soft)",
        color: "var(--accent-bright)",
      }}>
        <Icon name="folder" size={14} />
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{
          display: "block",
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: 13.5,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {project.name}
        </span>
        <span style={{
          display: "block",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginTop: 1,
        }}>
          {project.root_dir}
        </span>
      </span>
      <Icon name="arrowRight" size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
    </button>
  );
}
