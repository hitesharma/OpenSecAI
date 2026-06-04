"""Pause contracts for the dep_scan agent.

Importing this module (done automatically by runner.py) registers all dep_scan
pause contracts with the global registry so agent_registry.py can look them up
by name when building the pause_fn closure.
"""
from opensecai.runtime.notification_contracts import PauseContract, PauseOption, register

register(
    PauseContract(
        name="dep_scan.test_failed",
        prompt="go vet reported errors. How should the agent proceed?",
        options=(
            PauseOption(
                value="proceed_claude_code",
                label="Proceed with AI Fix",
                desc="Let Claude Code attempt to resolve the build errors automatically.",
                variant="primary",
            ),
            PauseOption(
                value="skip_to_final_scan",
                label="Skip to Final Scan",
                desc="Accept the current state and run the final Trivy scan to generate a diff report.",
                variant="ghost",
            ),
        ),
    ),
)
