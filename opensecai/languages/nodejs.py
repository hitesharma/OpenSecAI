"""Node.js / JavaScript / TypeScript toolchain for dep_scan.

Trivy scans the lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml) to
report vulnerable npm packages, so node_modules is intentionally skipped by the
scan node — the lockfile is the source of truth.

The package manager is auto-detected from the lockfile present in the repo so
the right install/upgrade verb is used (npm / yarn / pnpm). Remediation
distinguishes direct from transitive dependencies: a direct dependency is
upgraded by updating its manifest range (`<pm> add pkg@ver`), while a vulnerable
*transitive* dependency is pinned with a package-manager override
(`overrides` for npm, `pnpm.overrides` for pnpm, `resolutions` for yarn) so the
fixed version is forced deep in the tree without promoting it to a direct dep.
All fixes for a run are applied in a single install pass: every override is
written to package.json first, then one `<pm> add`/`<pm> install` reconciles
the whole tree at once. Static analysis
prefers a project-defined `build` script, then a TypeScript `tsc --noEmit`,
then a `lint` script, and finally falls back to dependency-tree integrity
checks — this is the closest analog to Go's `go vet` for catching breakage
introduced by an upgrade.
"""
from __future__ import annotations

import json
import os
import re
import subprocess

from opensecai.languages.base import LanguageToolchain, RunTracked, UpgradeResult


class NodeToolchain(LanguageToolchain):
    name = "nodejs"
    manifest_files = ("package.json",)
    code_fence = "javascript"
    expert_role = (
        "You are an expert Node.js / TypeScript developer specialized in migrating "
        "breaking npm package updates, handling deprecated or renamed APIs, and "
        "matching changed function/constructor signatures across CommonJS and ESM."
    )

    # Capture a repo-relative JS/TS source path + line from a build/tsc log line,
    # e.g. `src/server.ts:42:10` or `lib/util.js:12`.
    _FILE_RE = re.compile(r"([a-zA-Z0-9_\-\.\/]+\.(?:tsx?|jsx?|mjs|cjs)):(\d+)")

    # ── Detection ────────────────────────────────────────────────────────────
    def detect(self, repo_path: str) -> bool:
        return os.path.exists(os.path.join(repo_path, "package.json"))

    def file_error_regex(self) -> re.Pattern[str]:
        return self._FILE_RE

    # ── Package-manager resolution ───────────────────────────────────────────
    def _package_manager(self, cwd: str) -> str:
        """Pick the package manager from the lockfile present in the repo.

        Falls back to npm when no recognized lockfile exists.
        """
        if os.path.exists(os.path.join(cwd, "pnpm-lock.yaml")):
            return "pnpm"
        if os.path.exists(os.path.join(cwd, "yarn.lock")):
            return "yarn"
        return "npm"

    def _install_cmd(self, pm: str) -> list[str]:
        # `npm install` with no args reconciles node_modules + lockfile with
        # package.json; yarn/pnpm `install` do the equivalent.
        return [pm, "install"]

    def _add_cmd(self, pm: str, *targets: str) -> list[str]:
        if pm == "npm":
            return ["npm", "install", *targets]
        # yarn add / pnpm add pin the dependencies and update the lockfile.
        return [pm, "add", *targets]

    def _read_package_json(self, cwd: str) -> dict:
        """Return the parsed package.json (empty dict on any error)."""
        try:
            with open(os.path.join(cwd, "package.json")) as f:
                return json.load(f) or {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _scripts(self, cwd: str) -> dict:
        """Return the `scripts` table from package.json (empty on any error)."""
        return self._read_package_json(cwd).get("scripts", {}) or {}

    def _direct_dependencies(self, cwd: str) -> set[str]:
        """Names declared directly in any dependency section of package.json."""
        pkg = self._read_package_json(cwd)
        names: set[str] = set()
        for section in (
            "dependencies",
            "devDependencies",
            "optionalDependencies",
            "peerDependencies",
        ):
            names.update((pkg.get(section) or {}).keys())
        return names

    # ── Tidy / upgrade ───────────────────────────────────────────────────────
    def tidy(self, cwd: str) -> None:
        pm = self._package_manager(cwd)
        subprocess.run(self._install_cmd(pm), capture_output=True, cwd=cwd)

    def upgrade_package(self, cwd: str, package: str, version: str) -> UpgradeResult:
        return self.upgrade_packages(cwd, {package: version})[0]

    def upgrade_packages(self, cwd: str, packages: dict[str, str]) -> list[UpgradeResult]:
        """Apply every fix in a single install pass.

        All transitive overrides are written to package.json *before* the install
        runs, so one command (`<pm> add` for direct upgrades, else `<pm> install`)
        both bumps the direct ranges and forces the transitive pins — instead of
        one install per package.
        """
        if not packages:
            return []

        pm = self._package_manager(cwd)
        # Trivy reports npm versions without a leading `v` (e.g. 4.17.21).
        versions = {pkg: ver.lstrip("v") for pkg, ver in packages.items()}

        direct_names = self._direct_dependencies(cwd)
        direct = {p: v for p, v in versions.items() if p in direct_names}
        transitive = {p: v for p, v in versions.items() if p not in direct_names}

        # Stage all transitive overrides up front; the install below applies them.
        override_err = ""
        if transitive:
            try:
                self._write_overrides(cwd, pm, transitive)
            except OSError as e:
                override_err = f"failed to write overrides to package.json: {e}"

        if direct:
            targets = [f"{p}@{v}" for p, v in direct.items()]
            cmd = self._add_cmd(pm, *targets)
        else:
            cmd = self._install_cmd(pm)
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)

        ok = res.returncode == 0 and not override_err
        stderr = override_err or res.stderr.strip()
        return [
            UpgradeResult(package=p, version=v, ok=ok, stderr=stderr)
            for p, v in versions.items()
        ]

    def _write_overrides(self, cwd: str, pm: str, overrides: dict[str, str]) -> None:
        """Pin each package via the package manager's override field.

        Builds new dicts rather than mutating the parsed manifest in place, then
        rewrites package.json once with a 2-space indent (the npm convention).
        """
        path = os.path.join(cwd, "package.json")
        with open(path) as f:
            pkg = json.load(f)

        updated = dict(pkg)
        if pm == "pnpm":
            pnpm = dict(updated.get("pnpm") or {})
            merged = {**(pnpm.get("overrides") or {}), **overrides}
            pnpm["overrides"] = merged
            updated["pnpm"] = pnpm
        elif pm == "yarn":
            updated["resolutions"] = {**(updated.get("resolutions") or {}), **overrides}
        else:  # npm
            updated["overrides"] = {**(updated.get("overrides") or {}), **overrides}

        with open(path, "w") as f:
            json.dump(updated, f, indent=2)
            f.write("\n")

    # ── Static analysis ──────────────────────────────────────────────────────
    def static_analysis(
        self, run_tracked: RunTracked, state: dict, cwd: str
    ) -> subprocess.CompletedProcess:
        # Reinstall first so node_modules matches the upgraded lockfile, mirroring
        # the `go mod tidy` step Go runs before `go vet`.
        pm = self._package_manager(cwd)
        subprocess.run(self._install_cmd(pm), capture_output=True, cwd=cwd)

        scripts = self._scripts(cwd)
        cmd = self._verify_cmd(pm, scripts, cwd)
        return run_tracked(state, cmd, capture_output=True, text=True, cwd=cwd)

    def _verify_cmd(self, pm: str, scripts: dict, cwd: str) -> list[str]:
        """Choose the most meaningful breakage check available for this repo."""
        # npm / yarn / pnpm all invoke package scripts via `<pm> run <name>`.
        if "build" in scripts:
            return [pm, "run", "build"]
        if os.path.exists(os.path.join(cwd, "tsconfig.json")):
            return ["npx", "--no-install", "tsc", "--noEmit"]
        if "lint" in scripts:
            return [pm, "run", "lint"]
        # No build/typecheck/lint available — verify the dependency tree resolves.
        return [pm, "ls", "--all"] if pm != "yarn" else ["yarn", "list"]

    def build_error_prompt(self, logs: str) -> str:
        return f"fix the Node.js/TypeScript build error:\n{logs}\n"
