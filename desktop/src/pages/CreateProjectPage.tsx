import React, { useState } from "react";
import { api } from "../api/client";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

interface CreateProjectPageProps {
  onBack: () => void;
  onCreate: (name: string, rootDir: string) => void;
  dataRoot: string | null;
}

export function CreateProjectPage({ onBack, onCreate, dataRoot }: CreateProjectPageProps) {
  const [rootDir, setRootDir] = useState("");
  const [name, setName] = useState("");
  const [backHover, setBackHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsRootDir = dataRoot === null;
  const effectiveRoot = needsRootDir ? rootDir.trim() : dataRoot;
  const valid = name.trim().length > 0 && effectiveRoot.length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    const trimmedName = name.trim();
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(trimmedName, needsRootDir ? effectiveRoot : undefined);
      onCreate(trimmedName, project.root_dir);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      position: "relative",
    }}>
      <button
        onClick={onBack}
        onMouseEnter={() => setBackHover(true)}
        onMouseLeave={() => setBackHover(false)}
        style={{
          all: "unset",
          cursor: "pointer",
          position: "absolute",
          top: 28,
          left: 32,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: 13.5,
          color: backHover ? "var(--text)" : "var(--text-3)",
          transition: "color var(--t-fast)",
        }}
      >
        <Icon name="arrowLeft" size={16} />
        Back
      </button>

      <div style={{ width: "100%", maxWidth: 440, textAlign: "center" }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          margin: "0 auto 22px",
          background: "var(--accent-soft)",
          border: "1px solid rgba(129,140,248,0.28)",
        }}>
          <Icon name="plus" size={26} style={{ color: "var(--accent-bright)" }} />
        </div>

        <h2 style={{ fontSize: "var(--text-2xl)", fontWeight: 700 }}>Create a new project</h2>
        <p style={{ marginTop: 10, fontSize: 14.5, color: "var(--text-3)", fontFamily: "var(--font-body)" }}>
          {needsRootDir
            ? "Set a root directory and name for your project."
            : "Give your project a name to get started."}
        </p>

        <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 20, textAlign: "left" }}>
          {needsRootDir && (
            <Input
              label="Root Directory"
              value={rootDir}
              onChange={setRootDir}
              placeholder="e.g. /Users/you/projects"
              mono
              autoFocus
              hint="All OpenSecAI data (reports, workspaces) will be stored here. Set once — reused for all future projects."
            />
          )}
          <Input
            label="Project Name"
            value={name}
            onChange={setName}
            placeholder="e.g. api-gateway"
            autoFocus={!needsRootDir}
            onEnter={submit}
          />
          {!needsRootDir && (
            <p style={{ fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--font-body)", margin: 0 }}>
              Root directory: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{dataRoot}</span>
            </p>
          )}
        </div>

        {error && (
          <p style={{ marginTop: 16, fontSize: 13, color: "var(--red, #f87171)", fontFamily: "var(--font-body)" }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 24 }}>
          <Button size="lg" full disabled={!valid || busy} onClick={submit} iconRight="arrowRight">
            {busy ? "Creating…" : "Create Project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
