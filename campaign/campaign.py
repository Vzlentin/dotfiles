"""Drain a labeled issue queue through /go, one herdr pane per unit, serial.

Stops on the first non-shipped outcome.

Usage: ``python campaign/campaign.py <workrepo>``

``<workrepo>`` is the clone the agent runs in: run state is read from ITS git
common dir, and the ``owner/repo`` of the issue queue is derived from its
``origin`` remote.

Config comes from ``<workrepo>/.agents/config.toml``, ``[campaign]`` table.
All keys are optional; a missing file or table means all defaults:

  queue_label      label marking issues ready to run (default ``queue``;
                   removed at claim time)
  claim_label      label added when a unit is claimed (default ``claimed``)
  title_filter     regex; only issues whose title matches are eligible.
                   Ordering is a fixed natural sort on the first
                   ``U<number><letter?>`` title token (U2a < U2b < U10),
                   falling back to the issue number.
  plan             campaign plan path, relative to the workrepo, substituted
                   into the prompt; the ``CAMPAIGN_PLAN`` env var overrides
                   it verbatim (for plans living outside the repo)
  log              execution log path, same resolution; the ``CAMPAIGN_LOG``
                   env var overrides it verbatim
  unit_timeout_h   per-unit timeout in hours (default 14)
  poll_sec         outcome poll interval in seconds (default 60)
  prompt_template  prompt with ``{{N}}`` / ``{{CAMPAIGN_PLAN}}`` / ``{{LOG}}``
                   placeholders

Requires on PATH: gh (authed), herdr, omp.

Contract with /go (SKILL.md): Stage 0c records ``issue`` and Stage 6 records
``outcome`` in ``<git-common-dir>/go-runs/<slug>.json`` — this loop keys on
exactly those two fields. The pane's herdr ``agent_status`` is the crash
detector: a settled pane (idle/done/unknown) with still no outcome after a
30s grace re-check is treated as a crash. The per-unit timeout is the
backstop.

Exit codes: 0 when the queue drains, 1 on the first non-shipped outcome or
any setup failure.
"""

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping

CONFIG_RELPATH = Path(".agents") / "config.toml"
REQUIRED_TOOLS = ("gh", "herdr", "omp")
SETTLED_STATUSES = frozenset({"idle", "done", "unknown"})
GRACE_SEC = 30

DEFAULT_TEMPLATE = """/skill:go #{{N}}
CAMPAIGN CONTEXT — not the unit spec: the campaign plan is {{CAMPAIGN_PLAN}}. Use this unit's section as planning input only; Stage 0b still makes a unit plan.
LOG: at Stage 6, append this unit's entry to {{LOG}} in the same format as previous entries, including the model-mix line."""

# Matches jq's old `capture("U(?<n>[0-9]+)(?<s>[a-z]?)")` ordering token.
_UNIT_TOKEN = re.compile(r"U(\d+)([a-z]?)")


@dataclass(frozen=True)
class Config:
    """Resolved [campaign] settings; paths already absolute, timeout in seconds."""

    queue_label: str
    claim_label: str
    title_filter: str | None
    plan: str
    log: str
    unit_timeout_sec: int
    poll_sec: int
    prompt_template: str


def _run(args: list[str], cwd: str | Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run a command, capturing text output without raising on failure."""
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False)


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def missing_tools(which=shutil.which) -> list[str]:
    """Return the required external tools not found on PATH."""
    return [tool for tool in REQUIRED_TOOLS if which(tool) is None]


def load_campaign_config(workrepo: Path) -> dict:
    """Load the ``[campaign]`` table of ``<workrepo>/.agents/config.toml``.

    Returns:
        The ``[campaign]`` table as a dict; empty when the config file or
        table is absent (all defaults apply).

    Raises:
        SystemExit: When the file exists but is not valid TOML, or when
            ``campaign`` is present but not a table — a broken config must
            fail loudly, not silently degrade to defaults.
    """
    path = workrepo / CONFIG_RELPATH
    if not path.is_file():
        return {}
    try:
        config = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SystemExit(f"cannot read project config {path}: {exc!r}") from None
    table = config.get("campaign", {})
    if not isinstance(table, dict):
        raise SystemExit(f"[campaign] in {path} is not a table")
    return table


def resolve_config(table: dict, workrepo: Path, env: Mapping[str, str]) -> Config:
    """Apply defaults, path resolution, and env overrides to a raw [campaign] table.

    ``plan``/``log`` are repo-relative and resolve against the workrepo (so
    nothing private needs committing); the ``CAMPAIGN_PLAN``/``CAMPAIGN_LOG``
    env vars override them verbatim. Absent values substitute as "".
    """

    def path_value(key: str, env_key: str) -> str:
        override = env.get(env_key)
        if override:
            return override
        value = table.get(key)
        return str(workrepo / value) if value else ""

    return Config(
        queue_label=table.get("queue_label", "queue"),
        claim_label=table.get("claim_label", "claimed"),
        title_filter=table.get("title_filter"),
        plan=path_value("plan", "CAMPAIGN_PLAN"),
        log=path_value("log", "CAMPAIGN_LOG"),
        unit_timeout_sec=int(float(table.get("unit_timeout_h", 14)) * 3600),
        poll_sec=int(table.get("poll_sec", 60)),
        prompt_template=table.get("prompt_template", DEFAULT_TEMPLATE),
    )


def parse_owner_repo(url: str) -> str:
    """Derive ``owner/repo`` from an https or ssh git remote URL."""
    trimmed = url.strip().removesuffix("/").removesuffix(".git")
    if "://" in trimmed:  # https://github.com/owner/repo, ssh://git@host/owner/repo
        _, _, rest = trimmed.partition("://")
        path = rest.partition("/")[2]
    elif ":" in trimmed:  # git@github.com:owner/repo
        path = trimmed.partition(":")[2]
    else:
        raise SystemExit(f"cannot derive owner/repo from remote URL {url.strip()!r}")
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2:
        raise SystemExit(f"cannot derive owner/repo from remote URL {url.strip()!r}")
    return "/".join(parts[-2:])


def unit_sort_key(issue: dict) -> tuple[int, int, str, int]:
    """Order issues by the first ``U<number><letter?>`` title token, then number.

    Titles without a token sort after all tokened ones, by issue number.
    """
    match = _UNIT_TOKEN.search(issue["title"])
    if match:
        return (0, int(match.group(1)), match.group(2), issue["number"])
    return (1, issue["number"], "", 0)


def next_issue(issues: list[dict], title_filter: str | None) -> int | None:
    """Pick the next issue number from a ``[{number, title}, …]`` queue list.

    Returns:
        The lowest-ordered eligible issue number, or None when the queue is
        drained (no issues, or none matching ``title_filter``).
    """
    if title_filter:
        pattern = re.compile(title_filter)
        issues = [issue for issue in issues if pattern.search(issue["title"])]
    if not issues:
        return None
    return min(issues, key=unit_sort_key)["number"]


def build_prompt(template: str, number: int, plan: str, log: str) -> str:
    """Substitute the ``{{N}}``/``{{CAMPAIGN_PLAN}}``/``{{LOG}}`` placeholders."""
    return (
        template.replace("{{N}}", str(number))
        .replace("{{CAMPAIGN_PLAN}}", plan)
        .replace("{{LOG}}", log)
    )


def list_queue_issues(repo: str, queue_label: str) -> list[dict]:
    """Fetch the open labeled issues as ``[{number, title}, …]``.

    Label-token search is unreliable for structured titles (GitHub tokenizes
    them), so pull the whole labeled set and filter/sort client-side.
    """
    proc = _run(
        [
            "gh", "issue", "list", "--repo", repo, "--state", "open",
            "--label", queue_label, "--json", "number,title",
        ]
    )
    if proc.returncode != 0:
        raise SystemExit(f"gh issue list failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def outcome_for_issue(common_dir: Path, number: int) -> str:
    """Return the recorded /go outcome for an issue, or "" when none exists yet."""
    for path in sorted((common_dir / "go-runs").glob("*.json")):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(state.get("issue", "")) == str(number):
            return str(state.get("outcome") or "")
    return ""


def _pane_field(stdout: str, field: str) -> str:
    """Extract ``.result.pane.<field>`` from herdr JSON output, "" on any miss."""
    try:
        value = json.loads(stdout)["result"]["pane"].get(field)
    except (json.JSONDecodeError, KeyError, TypeError):
        return ""
    return value if isinstance(value, str) else ""


def pane_status(pane: str) -> str:
    """Read a pane's agent status via herdr.

    Empty output (herdr gone, malformed JSON) must read as ``unknown``, not
    as a still-running pane — unknown is what trips the crash detector.
    """
    proc = _run(["herdr", "pane", "get", pane])
    status = _pane_field(proc.stdout, "agent_status") if proc.returncode == 0 else ""
    return status or "unknown"


def wait_for_outcome(
    common_dir: Path, number: int, pane: str, timeout_sec: int, poll_sec: int
) -> str:
    """Poll until the unit's outcome is known.

    Primary completion signal: the run state's ``outcome``. Pane agent status
    is the crash detector (settled pane, no outcome); the timeout is the
    backstop.
    """
    start = time.monotonic()
    warned = False
    while True:
        outcome = outcome_for_issue(common_dir, number)
        if outcome:
            return outcome
        status = pane_status(pane)
        if status in SETTLED_STATUSES:
            time.sleep(GRACE_SEC)  # grace: Stage 6 may be writing the outcome right now
            outcome = outcome_for_issue(common_dir, number)
            if outcome:
                return outcome
            if pane_status(pane) in SETTLED_STATUSES:
                return "crashed"
        elif status == "blocked" and not warned:
            print(f"#{number}: agent is BLOCKED (waiting on input) in pane go-#{number}")
            warned = True
        if time.monotonic() - start > timeout_sec:
            return "timeout"
        time.sleep(poll_sec)


def drain_queue(config: Config, repo: str, workrepo: Path, common_dir: Path) -> int:
    """Run queue units through /go serially until drained or a unit fails."""
    while True:
        number = next_issue(list_queue_issues(repo, config.queue_label), config.title_filter)
        if number is None:
            print(f"{config.queue_label} queue drained.")
            return 0

        print(f"=== #{number}: launching /go ({_now()}) ===")
        split = _run(
            ["herdr", "pane", "split", "--current", "--direction", "right",
             "--cwd", str(workrepo)]
        )
        pane = _pane_field(split.stdout, "pane_id")
        if split.returncode != 0 or not pane:
            raise SystemExit(f"herdr pane split failed: {split.stderr.strip()}")
        _run(["herdr", "pane", "rename", pane, f"go-#{number}"])

        # Hand off queue state first so a loop crash/restart never double-runs a unit.
        claim = _run(
            ["gh", "issue", "edit", str(number), "--repo", repo,
             "--remove-label", config.queue_label, "--add-label", config.claim_label]
        )
        if claim.returncode != 0:
            raise SystemExit(f"gh issue edit failed for #{number}: {claim.stderr.strip()}")

        # Initial prompt as argv — no send-text race. First line is the Stage 0a
        # work item; following lines are campaign context per the skill's
        # multi-line rule.
        prompt = build_prompt(config.prompt_template, number, config.plan, config.log)
        _run(["herdr", "pane", "run", pane, f"omp {shlex.quote(prompt)}"])

        outcome = wait_for_outcome(
            common_dir, number, pane, config.unit_timeout_sec, config.poll_sec
        )
        if outcome == "shipped":
            print(f"=== #{number}: shipped ({_now()}) ===")
            _run(["herdr", "pane", "close", pane])
        else:
            print(
                f"#{number} ended {outcome!r} — pane go-#{number} preserved for debugging "
                f"(issue keeps {config.claim_label}). Stopping."
            )
            return 1


def main(argv: list[str] | None = None) -> int:
    """Parse arguments, preflight the environment, and drain the queue."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("workrepo", help="path to the work clone the agent runs in")
    args = parser.parse_args(argv)

    missing = missing_tools()
    if missing:
        print(f"missing required tool(s) on PATH: {', '.join(missing)}", file=sys.stderr)
        return 1

    workrepo = Path(args.workrepo).resolve()
    if not workrepo.is_dir():
        print(f"workrepo is not a directory: {workrepo}", file=sys.stderr)
        return 1

    remote = _run(["git", "-C", str(workrepo), "remote", "get-url", "origin"])
    if remote.returncode != 0:
        print(f"cannot read origin remote of {workrepo}: {remote.stderr.strip()}", file=sys.stderr)
        return 1
    repo = parse_owner_repo(remote.stdout)

    common = _run(["git", "-C", str(workrepo), "rev-parse", "--path-format=absolute",
                   "--git-common-dir"])
    if common.returncode != 0:
        print(f"cannot resolve git common dir of {workrepo}: {common.stderr.strip()}",
              file=sys.stderr)
        return 1
    common_dir = Path(common.stdout.strip())

    config = resolve_config(load_campaign_config(workrepo), workrepo, os.environ)
    return drain_queue(config, repo, workrepo, common_dir)


if __name__ == "__main__":
    sys.exit(main())
