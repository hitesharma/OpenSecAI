"""Go (Golang) toolchain for dep_scan."""
from __future__ import annotations

import os
import re
import subprocess

from opensecai.languages.base import LanguageToolchain, RunTracked, UpgradeResult


class GoToolchain(LanguageToolchain):
    name = "go"
    manifest_files = ("go.mod",)
    code_fence = "go"
    expert_role = (
        "You are an expert Go developer specialized in migrating breaking API updates, "
        "handling package deprecations, or matching changed initialization signatures."
    )

    _FILE_RE = re.compile(r"(([a-zA-Z0-9_\-]+/\#)?([a-zA-Z0-9_\-\.\/]+)\.go):(\d+):")

    def detect(self, repo_path: str) -> bool:
        return os.path.exists(os.path.join(repo_path, "go.mod"))

    def file_error_regex(self) -> re.Pattern[str]:
        return self._FILE_RE

    def tidy(self, cwd: str) -> None:
        subprocess.run(["go", "mod", "tidy"], capture_output=True, cwd=cwd)

    def upgrade_package(self, cwd: str, package: str, version: str) -> UpgradeResult:
        go_version = version if version.startswith("v") else f"v{version}"
        target = f"{package}@{go_version}"
        res = subprocess.run(["go", "get", target], capture_output=True, text=True, cwd=cwd)
        return UpgradeResult(
            package=package,
            version=go_version,
            ok=res.returncode == 0,
            stderr=res.stderr.strip(),
        )

    def upgrade_packages(self, cwd: str, packages: dict[str, str]) -> list[UpgradeResult]:
        # `go get` resolves each module independently; loop to keep per-package
        # success/failure attribution accurate.
        return [self.upgrade_package(cwd, pkg, version) for pkg, version in packages.items()]

    def static_analysis(
        self, run_tracked: RunTracked, state: dict, cwd: str
    ) -> subprocess.CompletedProcess:
        # Tidy first to keep go.sum aligned with module graph after upgrades.
        subprocess.run(["go", "mod", "tidy"], capture_output=True, cwd=cwd)
        return run_tracked(
            state, ["go", "vet", "./..."], capture_output=True, text=True, cwd=cwd
        )

    def build_error_prompt(self, logs: str) -> str:
        return f"fix the go vet err:\n{logs}\n"
