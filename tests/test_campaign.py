"""Exercise the pure config/jq parts of campaign/campaign.sh via --dry-run.

The dry run resolves the config and the next queue issue with a stubbed ``gh``
on PATH — no network, no herdr panes. Requires bash and jq; skipped where
either is unavailable.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from infra import load_script_module

REPO_ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN_SH = REPO_ROOT / "campaign" / "campaign.sh"

provision_worktree = load_script_module(
    REPO_ROOT / "skills" / "go" / "scripts" / "provision_worktree.py"
)

# On Windows a bare `bash` can resolve to the WSL launcher; reuse the skill's
# Git Bash resolution so the script runs in the same environment everywhere.
BASH = provision_worktree._bash_executable()

ISSUES_PAYLOAD = [
    {"number": 11, "title": "U10: later unit"},
    {"number": 7, "title": "U2b: second sub-unit"},
    {"number": 5, "title": "U2a: first sub-unit"},
    {"number": 9, "title": "unrelated title, must be filtered out"},
]

NEXT_ISSUE_JQ = (
    'map(select(.title | test("^U[0-9]")))'
    ' | sort_by(.title | capture("U(?<n>[0-9]+)(?<s>[a-z]?)") | [(.n|tonumber), .s])'
    " | .[0].number // empty"
)


def _bash_available() -> bool:
    return shutil.which(BASH) is not None or Path(BASH).is_file()


requires_shell = pytest.mark.skipif(
    not _bash_available() or shutil.which("jq") is None,
    reason="bash and jq are required to exercise campaign.sh",
)


def _write_config(path: Path, **overrides: str) -> Path:
    values = {
        "REPO": "example/repo",
        "WORKREPO": "/tmp/workrepo",
        "QUEUE_LABEL": "ready-for-agent",
        "CLAIM_LABEL": "in-progress",
        "CAMPAIGN_PLAN": "/plans/campaign.md",
        "LOG": "/plans/log.md",
        "UNIT_TIMEOUT_H": "2",
    }
    values.update(overrides)
    lines = [f"{key}={value}" for key, value in values.items() if value != ""]
    lines.append(f"NEXT_ISSUE_JQ='{NEXT_ISSUE_JQ}'")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _stub_gh(bin_dir: Path, payload: object) -> None:
    """Drop a `gh` stub on PATH that prints the canned issue-list payload."""
    fixture = bin_dir / "issues.json"
    fixture.write_text(json.dumps(payload), encoding="utf-8")
    stub = bin_dir / "gh"
    stub.write_text(f'#!/bin/sh\ncat "{fixture.as_posix()}"\n', encoding="utf-8")
    stub.chmod(0o755)


def _dry_run(config: Path, bin_dir: Path) -> subprocess.CompletedProcess[str]:
    # Prepend natively; Git Bash converts a Windows-style PATH on startup.
    env = dict(os.environ)
    env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
    return subprocess.run(
        [BASH, CAMPAIGN_SH.as_posix(), "--dry-run", config.as_posix()],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


@requires_shell
def test_dry_run_resolves_config_and_next_issue(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_gh(bin_dir, ISSUES_PAYLOAD)
    config = _write_config(tmp_path / "campaign.env")

    proc = _dry_run(config, bin_dir)
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert report["repo"] == "example/repo"
    assert report["queue_label"] == "ready-for-agent"
    assert report["claim_label"] == "in-progress"
    assert report["unit_timeout_sec"] == 2 * 3600
    assert report["next_issue"] == 5, "U2a sorts before U2b and U10; unrelated titles filtered"


@requires_shell
def test_dry_run_reports_drained_queue_as_null(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_gh(bin_dir, [{"number": 9, "title": "unrelated title"}])
    config = _write_config(tmp_path / "campaign.env")

    proc = _dry_run(config, bin_dir)
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["next_issue"] is None


@requires_shell
@pytest.mark.parametrize("missing", ["REPO", "WORKREPO", "QUEUE_LABEL", "CAMPAIGN_PLAN"])
def test_dry_run_fails_on_missing_required_config(tmp_path: Path, missing: str) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _stub_gh(bin_dir, ISSUES_PAYLOAD)
    config = _write_config(tmp_path / "campaign.env", **{missing: ""})

    proc = _dry_run(config, bin_dir)
    assert proc.returncode != 0
    assert missing in proc.stderr
