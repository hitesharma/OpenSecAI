"""Centralised contract registry for agent → frontend notifications.

Any agent that needs to pause for user input defines a PauseContract here and
registers it.  The registry is the single source of truth for:

  - The prompt shown to the user
  - The option values sent back to the agent (``value``)
  - The labels and descriptions rendered by the UI (``label``, ``desc``)
  - The visual variant of each button (``variant``)

Usage (agent side):
    from opensecai.runtime.notification_contracts import register, PauseContract, PauseOption

    register(PauseContract(
        name="my_agent.some_decision",
        prompt="How should the agent proceed?",
        options=(
            PauseOption(value="go", label="Continue", desc="...", variant="primary"),
            PauseOption(value="stop", label="Abort",   desc="...", variant="ghost"),
        ),
    ))

Usage (agent_registry):
    from opensecai.runtime.notification_contracts import get as get_contract
    contract = get_contract("my_agent.some_decision")
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PauseOption:
    """One selectable choice in a pause dialog."""

    value: str
    """The machine-readable token returned to the agent when the user picks this option."""

    label: str
    """Short human-readable button label rendered in the UI."""

    desc: str
    """Longer description shown beneath the label to help the user decide."""

    variant: str = "ghost"
    """Visual variant: ``"primary"`` (accent colour) or ``"ghost"`` (neutral)."""

    def to_dict(self) -> dict:
        return {"value": self.value, "label": self.label, "desc": self.desc, "variant": self.variant}


@dataclass(frozen=True)
class PauseContract:
    """Named contract for a pause notification emitted by an agent."""

    name: str
    """Unique dotted identifier, e.g. ``"dep_scan.test_failed"``."""

    prompt: str
    """Question shown to the user in the pause dialog."""

    options: tuple[PauseOption, ...]
    """Ordered options; the first is conventionally the primary/recommended action."""

    def option_values(self) -> list[str]:
        """Return just the value strings (used by PauseManager for internal bookkeeping)."""
        return [o.value for o in self.options]

    def to_ws_payload(self) -> dict:
        """Serialise to the shape emitted over the WebSocket ``pause`` event."""
        return {
            "prompt": self.prompt,
            "options": [o.to_dict() for o in self.options],
        }


# ── Registry ─────────────────────────────────────────────────────────────────

_registry: dict[str, PauseContract] = {}


def register(*contracts: PauseContract) -> None:
    """Register one or more contracts.  Safe to call multiple times (last write wins)."""
    for c in contracts:
        _registry[c.name] = c


def get(name: str) -> PauseContract:
    """Look up a contract by name.  Raises ``KeyError`` if not registered."""
    if name not in _registry:
        raise KeyError(
            f"No pause contract registered for '{name}'. "
            "Ensure the agent's contracts module is imported before the run starts."
        )
    return _registry[name]


def all_contracts() -> dict[str, PauseContract]:
    """Return a snapshot of the full registry (useful for debugging)."""
    return dict(_registry)
