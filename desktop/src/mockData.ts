import type { Agent, Run, ScanResults, LogLine } from "./types";

export const AGENTS: Agent[] = [
  {
    id: "dep_scan", name: "dep_scan", title: "Dependency Scan", icon: "package", enabled: true,
    short: "CVE scanning across your dependency tree",
    desc: "Resolves your full dependency graph and cross-references every package against known CVE databases, surfacing fixed, new, and persisting vulnerabilities between runs.",
    scanner: "Trivy", scannerNote: "Vulnerability & dependency scanner",
  },
  // {
  //   id: "container_scan", name: "container_scan", title: "Container Scan", icon: "box", enabled: false,
  //   short: "OS & image-layer vulnerability scanning",
  //   desc: "Inspects container images layer by layer for OS package vulnerabilities, exposed misconfigurations, and outdated base images.",
  //   scanner: "Trivy", scannerNote: "Container image scanner",
  // },
  // {
  //   id: "sast", name: "sast", title: "Static Analysis", icon: "code", enabled: false,
  //   short: "Source-level security pattern detection",
  //   desc: "Performs static application security testing across your source tree, flagging injection risks, unsafe APIs, and insecure code patterns.",
  //   scanner: "Semgrep", scannerNote: "Static analysis engine",
  // },
  // {
  //   id: "secrets", name: "secrets", title: "Secret Detection", icon: "key", enabled: false,
  //   short: "Hardcoded credentials & token discovery",
  //   desc: "Scans the working tree and git history for leaked API keys, tokens, private keys, and other hardcoded secrets.",
  //   scanner: "Gitleaks", scannerNote: "Secret scanner",
  // },
  // {
  //   id: "iac", name: "iac", title: "IaC Misconfig", icon: "layers", enabled: false,
  //   short: "Infrastructure-as-code misconfiguration checks",
  //   desc: "Audits Terraform, Kubernetes, and Dockerfiles for insecure defaults and policy violations before they ship.",
  //   scanner: "Checkov", scannerNote: "IaC policy scanner",
  // },
  // {
  //   id: "sbom", name: "sbom", title: "SBOM Generation", icon: "fileList", enabled: false,
  //   short: "Software bill-of-materials export",
  //   desc: "Builds a complete, signable software bill of materials cataloguing every component and its provenance.",
  //   scanner: "Syft", scannerNote: "SBOM generator",
  // },
  // {
  //   id: "license", name: "license", title: "License Compliance", icon: "scale", enabled: false,
  //   short: "Dependency license policy enforcement",
  //   desc: "Detects the license of every dependency and flags copyleft or policy-violating licenses against your allowlist.",
  //   scanner: "ScanCode", scannerNote: "License detector",
  // },
];

export const INITIAL_RUNS: Run[] = [
  // { id: "r1", agent: "dep_scan", status: "completed", started: "2026-05-31 09:42:18", duration: "14s" },
  // { id: "r2", agent: "dep_scan", status: "failed",    started: "2026-05-30 17:08:55", duration: "3s" },
  // { id: "r3", agent: "dep_scan", status: "completed", started: "2026-05-29 11:21:40", duration: "12s" },
];

export const RESULTS: ScanResults = {
  fixed: [
    // { cve: "CVE-2025-31021", pkg: "lodash",       sev: "HIGH",   desc: "Prototype pollution via merge functions allowing property injection.",        from: "4.17.20", to: "4.17.21" },
    // { cve: "CVE-2025-29041", pkg: "axios",        sev: "MEDIUM", desc: "SSRF through improper URL parsing on redirect following.",                    from: "1.6.2",   to: "1.7.4" },
    // { cve: "CVE-2024-48910", pkg: "tar",          sev: "LOW",    desc: "Path traversal when extracting symlinked archive entries.",                   from: "6.1.11",  to: "6.2.1" },
  ],
  added: [
    // { cve: "CVE-2026-10847", pkg: "serialize-js", sev: "CRITICAL", desc: "Remote code execution via unsafe deserialization of attacker-controlled payloads.", from: "2.3.0", to: null },
  ],
  persisted: [
    // { cve: "CVE-2025-21692", pkg: "minimatch", sev: "HIGH",   desc: "Regular expression denial of service on crafted glob patterns.",            from: "3.0.4", to: "3.1.2" },
    // { cve: "CVE-2025-18033", pkg: "semver",    sev: "MEDIUM", desc: "ReDoS in version range parsing for untrusted input.",                       from: "7.3.5", to: "7.5.2" },
    // { cve: "CVE-2025-14422", pkg: "ws",        sev: "MEDIUM", desc: "Denial of service via excessive memory use on many headers.",               from: "7.4.6", to: "8.17.1" },
    // { cve: "CVE-2024-52891", pkg: "json5",     sev: "LOW",    desc: "Prototype pollution when parsing crafted JSON5 documents.",                  from: "2.2.0", to: "2.2.3" },
    // { cve: "CVE-2024-49100", pkg: "postcss",   sev: "LOW",    desc: "Parsing inefficiency leading to potential ReDoS on malformed CSS.",         from: "8.4.14", to: "8.4.31" },
  ],
};

export const LOG_SCRIPT: LogLine[] = [
  // { lvl: "INFO",  msg: "Initializing dep_scan agent (scanner: Trivy v0.52.0)" },
  // { lvl: "INFO",  msg: "Resolving repository at /Users/dev/projects/api-gateway" },
  // { lvl: "INFO",  msg: "Detected package manager: npm (package-lock.json)" },
  // { lvl: "INFO",  msg: "Building dependency graph — 1,284 packages resolved" },
  // { lvl: "INFO",  msg: "Downloading vulnerability database (trivy-db) ..." },
  // { lvl: "INFO",  msg: "Vulnerability database up to date (2026-05-31)" },
  // { lvl: "WARN",  msg: "3 packages could not resolve a registry source — using cached metadata" },
  // { lvl: "INFO",  msg: "Scanning direct dependencies (142)" },
  // { lvl: "INFO",  msg: "Scanning transitive dependencies (1,142)" },
  // { lvl: "WARN",  msg: "minimatch@3.0.4 still vulnerable — CVE-2025-21692 (HIGH) persists" },
  // { lvl: "ERROR", msg: "serialize-js@2.3.0 — CVE-2026-10847 (CRITICAL) no patched version on registry" },
  // { lvl: "INFO",  msg: "Comparing against previous run baseline (run #r1)" },
  // { lvl: "INFO",  msg: "3 fixed · 1 new · 5 persisted" },
  // { lvl: "INFO",  msg: "Writing report to .opensecai/reports/dep_scan-latest.json" },
  // { lvl: "INFO",  msg: "Scan complete in 14.2s" },
];
