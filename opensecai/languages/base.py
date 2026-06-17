"""LanguageToolchain Protocol — per-language shims for dep_scan.

Each language plugin owns:
- Manifest detection (e.g. `go.mod`, `pyproject.toml`).
- Pre-upgrade tidy + per-package upgrade commands.
- Static analysis command used to verify the build after upgrades.
- Regex to pull a file path out of build logs for LLM patching.
- Prompt fragments (expert role, code-fence language tag, claude-code prompt).

Adding a new language = new file under `opensecai/languages/` + one line in
`opensecai/languages/registry.py`.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from typing import Callable, Protocol, runtime_checkable


@dataclass(frozen=True)
class UpgradeResult:
    package: str
    version: str
    ok: bool
    stderr: str = ""


# Signature of runner._run_tracked — passed in so toolchains never reach into runner internals.
RunTracked = Callable[..., subprocess.CompletedProcess]


@runtime_checkable
class LanguageToolchain(Protocol):
    """A pluggable per-language adapter consumed by dep_scan nodes."""

    name: str
    manifest_files: tuple[str, ...]
    code_fence: str
    expert_role: str

    def detect(self, repo_path: str) -> bool:
        """True iff this toolchain should handle the given repo path."""
        ...

    def file_error_regex(self) -> re.Pattern[str]:
        """Regex whose first group captures a repo-relative source file path
        from a build-log line (e.g. `pkg/foo.go:42:`)."""
        ...

    def tidy(self, cwd: str) -> None:
        """Best-effort dependency tidy/normalize (idempotent, non-fatal)."""
        ...

    def upgrade_package(self, cwd: str, package: str, version: str) -> UpgradeResult:
        """Upgrade a single `package` to `version` in `cwd`."""
        ...

    def upgrade_packages(self, cwd: str, packages: dict[str, str]) -> list[UpgradeResult]:
        """Upgrade many packages in one shot, returning one result per package.

        Toolchains that can batch (e.g. a single npm install applying all
        overrides) should do so here; others may simply loop over
        upgrade_package. `packages` maps package name → target version.
        """
        ...

    def static_analysis(self, run_tracked: RunTracked, state: dict, cwd: str) -> subprocess.CompletedProcess:
        """Run the language's static analyzer (must use run_tracked for pid tracking)."""
        ...

    def build_error_prompt(self, logs: str) -> str:
        """Prompt fragment passed to Claude Code when static analysis fails."""
        ...
