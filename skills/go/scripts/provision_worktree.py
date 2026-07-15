"""Decide the /go execution mode and provision an isolated worktree.

``decide`` reads git state in the current checkout and prints the execution
mode: ``direct`` when the checkout is on ``main`` with a clean tree, else
``worktree``. Clean/dirty comes from ``git status --porcelain`` run through
Python's subprocess, which bypasses the MSYS wrapper that can print a literal
``ok`` on a clean tree.

``provision <type>/<slug>`` cuts ``.worktrees/<slug>`` on a fresh
``<type>/<slug>`` branch from ``origin/main``, runs the ``setup-worktree-unix``
steps read dynamically from the project's ``.cursor/worktrees.json`` when
present (substituting ``$ROOT_WORKTREE_PATH`` with the main checkout path;
absent config means a plain ``git worktree add`` with no setup), aborts on the
first failed step, then gates on the project's venv-gate command — plus a
data-presence check per ``--require-data <name>``. It never mutates the caller
checkout and refuses an existing worktree path or branch.

Project-specific gates come from ``<repo>/.agents/config.toml`` (``[go]``
table: ``venv_gate`` command string, ``[go.data]`` name-to-path map). A
missing config means no venv gate and no known data requirements.

Exit codes: 0 success, 1 failure.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

WORKTREES_DIR = ".worktrees"
SETUP_KEY = "setup-worktree-unix"
CONFIG_RELPATH = Path(".agents") / "config.toml"


def _bash_executable() -> str:
    """Resolve the bash used for setup steps, preferring Git Bash on Windows.

    A bare ``bash`` on Windows PATH commonly resolves to the System32 WSL
    launcher, which cannot run the MSYS-flavored setup steps (Windows-style
    ``$ROOT_WORKTREE_PATH`` substitutions, project tooling on the Windows
    PATH). Derive Git for Windows' own bash from the ``git`` executable's
    install root.
    """
    if sys.platform == "win32":
        git = shutil.which("git")
        if git is not None:
            candidate = Path(git).parent.parent / "bin" / "bash.exe"
            if candidate.is_file():
                return str(candidate)
    return "bash"


def _run(args: list[str], cwd: str | Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run a command, capturing text output without raising on failure."""
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=False)


def decide_mode(branch: str, porcelain: str) -> str:
    """Decide the execution mode from branch name and porcelain status.

    Args:
        branch: Output of ``git branch --show-current`` (empty on detached HEAD).
        porcelain: Output of ``git status --porcelain``.

    Returns:
        ``"direct"`` on a clean ``main`` checkout, else ``"worktree"``.
    """
    clean = porcelain.strip() == ""
    return "direct" if branch.strip() == "main" and clean else "worktree"


def load_project_config(root: Path) -> dict:
    """Load the ``[go]`` table of ``<root>/.agents/config.toml``.

    Returns:
        The ``[go]`` table as a dict; empty when the config file or table is
        absent (generic defaults: no venv gate, no data requirements).

    Raises:
        SystemExit: When the file exists but is not valid TOML — a broken
            config must fail loudly, not silently degrade to defaults.
    """
    path = root / CONFIG_RELPATH
    if not path.is_file():
        return {}
    try:
        config = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SystemExit(f"cannot read project config {path}: {exc!r}") from None
    table = config.get("go", {})
    if not isinstance(table, dict):
        raise SystemExit(f"[go] in {path} is not a table")
    return table


def read_setup_steps(config_text: str, main_path: str) -> list[str]:
    """Parse worktrees.json setup steps, substituting the main checkout path.

    Args:
        config_text: Raw JSON text of ``.cursor/worktrees.json``.
        main_path: Absolute path of the main checkout, substituted for every
            ``$ROOT_WORKTREE_PATH`` occurrence.

    Returns:
        The setup commands in declaration order.
    """
    config = json.loads(config_text)
    steps = config[SETUP_KEY]
    if not isinstance(steps, list) or not all(isinstance(s, str) for s in steps):
        raise SystemExit(f"{SETUP_KEY} in worktrees.json is not a list of strings")
    return [step.replace("$ROOT_WORKTREE_PATH", main_path) for step in steps]


def _run_step(step: str, cwd: Path) -> int:
    """Run one setup step through bash, streaming its output; return the exit code."""
    return subprocess.run([_bash_executable(), "-c", step], cwd=cwd, check=False).returncode


def _main_checkout() -> Path:
    """Resolve the main checkout root (the parent of the shared git common dir)."""
    common = _run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"])
    if common.returncode != 0:
        raise SystemExit(f"not a git repository: {common.stderr.strip()}")
    return Path(common.stdout.strip()).parent


def cmd_decide() -> int:
    """Print the execution mode and the main checkout path."""
    branch = _run(["git", "branch", "--show-current"])
    status = _run(["git", "status", "--porcelain"])
    if branch.returncode != 0 or status.returncode != 0:
        print(f"git state read failed: {(branch.stderr + status.stderr).strip()}", file=sys.stderr)
        return 1
    mode = decide_mode(branch.stdout, status.stdout)
    print(json.dumps({"mode": mode, "main": str(_main_checkout())}, indent=2))
    return 0


def cmd_provision(branch: str, require_data: list[str]) -> int:
    """Provision an isolated worktree on a fresh branch cut from origin/main."""
    if "/" not in branch:
        print(f"branch must be <type>/<slug>, got {branch!r}", file=sys.stderr)
        return 1
    slug = branch.split("/", 1)[1]
    main = _main_checkout()
    worktree = main / WORKTREES_DIR / slug

    if worktree.exists():
        print(f"refusing: worktree path already exists: {worktree}", file=sys.stderr)
        return 1
    if _run(["git", "rev-parse", "--verify", f"refs/heads/{branch}"], cwd=main).returncode == 0:
        print(f"refusing: branch already exists: {branch}", file=sys.stderr)
        return 1

    # Read every config before creating anything: a malformed config must not
    # strand a half-provisioned worktree.
    project = load_project_config(main)
    data_table = project.get("data", {})
    unknown = [name for name in require_data if name not in data_table]
    if unknown:
        print(
            f"unknown data requirement(s) {unknown}: not in [go.data] of {CONFIG_RELPATH}",
            file=sys.stderr,
        )
        return 1

    steps: list[str] = []
    worktrees_config = main / ".cursor" / "worktrees.json"
    if worktrees_config.is_file():
        try:
            steps = read_setup_steps(worktrees_config.read_text(encoding="utf-8"), main.as_posix())
        except (OSError, json.JSONDecodeError, KeyError) as exc:
            print(f"cannot read setup steps from {worktrees_config}: {exc!r}", file=sys.stderr)
            return 1

    fetch = _run(["git", "fetch", "origin", "main"], cwd=main)
    if fetch.returncode != 0:
        print(f"git fetch failed: {fetch.stderr.strip()}", file=sys.stderr)
        return 1
    add = _run(["git", "worktree", "add", str(worktree), "-b", branch, "origin/main"], cwd=main)
    if add.returncode != 0:
        print(f"git worktree add failed: {add.stderr.strip()}", file=sys.stderr)
        return 1

    def _fail(message: str) -> int:
        """Report a post-add failure with the recovery commands for the debris."""
        print(message, file=sys.stderr)
        print(
            "the worktree and branch are preserved for debugging; to retry, remove them:\n"
            f"  git worktree remove --force {WORKTREES_DIR}/{slug}\n"
            f"  git branch -D {branch}",
            file=sys.stderr,
        )
        return 1

    for step in steps:
        print(f"  -> {step}")
        if _run_step(step, cwd=worktree) != 0:
            return _fail(f"FAILED setup step: {step}")

    venv_gate = project.get("venv_gate")
    if venv_gate and _run_step(venv_gate, cwd=worktree) != 0:
        return _fail(f"venv gate failed: {venv_gate}")
    for name in require_data:
        if not (worktree / data_table[name]).is_dir():
            return _fail(f"data gate failed: no {data_table[name]} in {worktree}")

    print(json.dumps({"workdir": str(worktree), "branch": branch}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and dispatch to decide or provision."""
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("decide", help="print execution mode (direct/worktree) and main path")

    p_prov = sub.add_parser("provision", help="provision .worktrees/<slug> on <type>/<slug>")
    p_prov.add_argument("branch", help="<type>/<slug> branch name")
    p_prov.add_argument(
        "--require-data",
        action="append",
        default=[],
        metavar="NAME",
        help="also gate on a named data requirement from [go.data] (repeatable)",
    )

    args = parser.parse_args(argv)
    if args.command == "decide":
        return cmd_decide()
    return cmd_provision(args.branch, args.require_data)


if __name__ == "__main__":
    sys.exit(main())
