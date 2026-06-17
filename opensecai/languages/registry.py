"""Language toolchain registry + detection.

To add a new language:
1. Create `opensecai/languages/<lang>.py` with a class implementing
   `LanguageToolchain`.
2. Append the class to `_TOOLCHAINS` below.
"""
from __future__ import annotations

from opensecai.languages.base import LanguageToolchain
from opensecai.languages.go import GoToolchain
from opensecai.languages.nodejs import NodeToolchain

# Order matters for detect_toolchain(): first match wins.
# More specific manifests (go.mod) should come before catch-all ones (requirements.txt).
_TOOLCHAINS: tuple[type[LanguageToolchain], ...] = (
    GoToolchain,
    NodeToolchain,
)

_BY_NAME: dict[str, type[LanguageToolchain]] = {cls.name: cls for cls in _TOOLCHAINS}


def supported_languages() -> tuple[str, ...]:
    return tuple(cls.name for cls in _TOOLCHAINS)


def get_toolchain(name: str) -> LanguageToolchain:
    """Return a toolchain instance by name. Raises KeyError if unknown."""
    return _BY_NAME[name]()


def detect_toolchain(repo_path: str) -> LanguageToolchain | None:
    """Return the first toolchain that matches the repo, or None."""
    for cls in _TOOLCHAINS:
        tc = cls()
        if tc.detect(repo_path):
            return tc
    return None
