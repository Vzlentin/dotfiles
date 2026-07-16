"""Exercise the /go skill scripts in .agents/skills/go/scripts.

Fixture-driven — no test here touches the network. Verdict/decision logic is
exercised as pure functions over canned payloads; the subprocess-facing
commands are exercised with a recording fake runner. One scratch-repo test
covers the git-facing pieces of run-state path resolution and provisioning
collision refusal.
"""

import json
import subprocess
from pathlib import Path

import pytest
from infra import load_script_module

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / ".agents" / "skills" / "go" / "scripts"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "go"

run_state = load_script_module(SCRIPTS_DIR / "run_state.py")
ci_verdict = load_script_module(SCRIPTS_DIR / "ci_verdict.py")
provision_worktree = load_script_module(SCRIPTS_DIR / "provision_worktree.py")
merge_cleanup = load_script_module(SCRIPTS_DIR / "merge_cleanup.py")


def _fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def _git(args: list[str], cwd: Path) -> str:
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
    return proc.stdout.strip()


def test_go_harness_specifics_are_isolated_in_the_pi_recipe() -> None:
    """SKILL.md states the subagent contract abstractly and delegates the
    concrete launch to references/harness/pi.md; only the recipe file may
    carry harness-specific invocations. Swapping harnesses must mean adding a
    recipe file, never editing SKILL.md."""
    go_dir = REPO_ROOT / ".agents" / "skills" / "go"
    skill = (go_dir / "SKILL.md").read_text(encoding="utf-8")
    recipe = (go_dir / "references" / "harness" / "pi.md").read_text(encoding="utf-8")

    assert "references/harness/pi.md" in skill
    for host_specific in ("herdr", "omp ", "PI_SUBAGENT", "subagent("):
        assert host_specific not in skill, f"harness detail {host_specific!r} leaked into SKILL.md"

    assert 'agent: "implementer"' in recipe
    assert 'agent: "analyst"' in recipe
    assert "PI_SUBAGENT_MUX" in recipe
    assert "async: false" in recipe

    brief_path = go_dir / "references" / "ce-work-brief.md"
    assert not brief_path.exists(), "the ce-work brief is superseded by the implement skill"


@pytest.fixture
def scratch_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-b", "main"], cwd=repo)
    _git(["config", "user.email", "test@example.com"], cwd=repo)
    _git(["config", "user.name", "test"], cwd=repo)
    (repo / "README.md").write_text("scratch\n", encoding="utf-8")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-m", "init"], cwd=repo)
    return repo


class FakeRunner:
    """Record commands and answer them from a scripted (prefix -> result) table."""

    def __init__(self, script: list[tuple[list[str], int, str]]):
        self.script = script
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], cwd: object = None) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(args))
        for prefix, returncode, stdout in self.script:
            if args[: len(prefix)] == prefix:
                return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")


# --- run_state ---------------------------------------------------------------


def test_run_state_init_set_get_roundtrip(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert run_state.main(["init", "my-slug"]) == 0
    assert run_state.main(["set", "my-slug", "pr", "42"]) == 0
    assert run_state.main(["set", "my-slug", "stage", "5"]) == 0
    capsys.readouterr()

    assert run_state.main(["get", "my-slug", "pr"]) == 0
    assert capsys.readouterr().out.strip() == "42"

    assert run_state.main(["get", "my-slug"]) == 0
    state = json.loads(capsys.readouterr().out)
    assert state == {"slug": "my-slug", "pr": "42", "stage": "5"}

    assert run_state.main(["list"]) == 0
    assert capsys.readouterr().out.split() == ["my-slug"]


def test_run_state_list_json_prints_full_states(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert run_state.main(["init", "u9a-first"]) == 0
    assert run_state.main(["set", "u9a-first", "issue", "12"]) == 0
    assert run_state.main(["set", "u9a-first", "outcome", "shipped"]) == 0
    assert run_state.main(["init", "u9b-second"]) == 0
    capsys.readouterr()

    assert run_state.main(["list", "--json"]) == 0
    states = json.loads(capsys.readouterr().out)
    assert states == [
        {"slug": "u9a-first", "issue": "12", "outcome": "shipped"},
        {"slug": "u9b-second"},
    ]


def test_run_state_list_json_skips_corrupt_state_files(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert run_state.main(["init", "good"]) == 0
    runs_dir = run_state.state_dir()
    (runs_dir / "corrupt.json").write_text("not json", encoding="utf-8")
    capsys.readouterr()

    assert run_state.main(["list", "--json"]) == 0
    states = json.loads(capsys.readouterr().out)
    assert states == [{"slug": "good"}]


def test_run_state_list_json_empty_when_no_runs(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert run_state.main(["list", "--json"]) == 0
    assert json.loads(capsys.readouterr().out) == []


def test_run_state_init_refuses_collision_without_force(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert run_state.main(["init", "dup"]) == 0
    assert run_state.main(["set", "dup", "pr", "7"]) == 0
    assert run_state.main(["init", "dup"]) == 1

    capsys.readouterr()
    assert run_state.main(["get", "dup", "pr"]) == 0
    assert capsys.readouterr().out.strip() == "7", "failed init must not clobber state"

    assert run_state.main(["init", "dup", "--force"]) == 0
    capsys.readouterr()
    assert run_state.main(["get", "dup"]) == 0
    assert json.loads(capsys.readouterr().out) == {"slug": "dup"}


def test_run_state_resolves_same_path_from_main_and_worktree(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worktree = scratch_repo.parent / "wt"
    _git(["worktree", "add", str(worktree), "-b", "feat/wt"], cwd=scratch_repo)

    monkeypatch.chdir(scratch_repo)
    from_main = run_state.state_path("shared-slug")
    monkeypatch.chdir(worktree)
    from_worktree = run_state.state_path("shared-slug")

    assert from_main == from_worktree


def test_run_state_rejects_path_traversal_slug(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(scratch_repo)
    with pytest.raises(SystemExit):
        run_state.state_path("../escape")


# --- ci_verdict --------------------------------------------------------------


def test_verdict_green() -> None:
    code, report = ci_verdict.evaluate(_fixture("check_runs_green.json"))
    assert code == ci_verdict.EXIT_GREEN
    assert report["verdict"] == "green"


def test_verdict_green_with_skipped_and_neutral_conditional_jobs() -> None:
    payload = json.dumps(
        {
            "check_runs": [
                {"name": "tests", "status": "completed", "conclusion": "success"},
                {"name": "acceptance", "status": "completed", "conclusion": "skipped"},
                {"name": "oracle", "status": "completed", "conclusion": "neutral"},
            ]
        }
    )
    code, report = ci_verdict.evaluate(payload)
    assert code == ci_verdict.EXIT_GREEN
    assert report["verdict"] == "green"


def test_verdict_pending_when_any_run_incomplete() -> None:
    code, report = ci_verdict.evaluate(_fixture("check_runs_pending.json"))
    assert code == ci_verdict.EXIT_PENDING
    assert report["verdict"] == "pending"


def test_verdict_failure_collects_failed_runs_and_ids() -> None:
    code, report = ci_verdict.evaluate(_fixture("check_runs_failure.json"))
    assert code == ci_verdict.EXIT_FAILURE
    assert report["verdict"] == "failure"
    failed = {entry["name"]: entry for entry in report["failed"]}
    assert set(failed) == {"tests", "typecheck"}
    assert failed["tests"]["conclusion"] == "failure"
    assert failed["tests"]["run_id"] == "311"
    assert failed["typecheck"]["conclusion"] == "cancelled"
    assert report["signature"]


@pytest.mark.parametrize(
    "conclusion", ["failure", "cancelled", "timed_out", "action_required", "totally_new_state"]
)
def test_verdict_every_non_success_conclusion_is_failure(conclusion: str) -> None:
    payload = json.dumps(
        {
            "check_runs": [
                {
                    "name": "tests",
                    "status": "completed",
                    "conclusion": conclusion,
                    "details_url": "https://github.com/x/y/actions/runs/9/job/1",
                    "output": {"title": "boom", "summary": ""},
                }
            ]
        }
    )
    code, report = ci_verdict.evaluate(payload)
    assert code == ci_verdict.EXIT_FAILURE
    assert report["verdict"] == "failure"


def test_verdict_empty_check_set_is_non_verdict_never_green() -> None:
    code, report = ci_verdict.evaluate(_fixture("check_runs_empty.json"))
    assert code == ci_verdict.EXIT_NON_VERDICT
    assert report["verdict"] == "non-verdict"


@pytest.mark.parametrize(
    "payload",
    ["not json at all", "{}", '{"check_runs": 3}', '{"check_runs": ["not-a-dict"]}'],
)
def test_verdict_malformed_payload_is_non_verdict(payload: str) -> None:
    code, report = ci_verdict.evaluate(payload)
    assert code == ci_verdict.EXIT_NON_VERDICT
    assert report["verdict"] == "non-verdict"


def test_verdict_truncated_payload_is_non_verdict_never_green() -> None:
    payload = json.dumps(
        {
            "total_count": 31,
            "check_runs": [{"name": "tests", "status": "completed", "conclusion": "success"}],
        }
    )
    code, report = ci_verdict.evaluate(payload)
    assert code == ci_verdict.EXIT_NON_VERDICT
    assert "truncated" in report["reason"]


def test_cmd_verdict_wires_gh_output_into_evaluate(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = FakeRunner(
        [
            (["gh", "repo", "view"], 0, "owner/repo\n"),
            (["gh", "api"], 0, _fixture("check_runs_green.json")),
        ]
    )
    monkeypatch.setattr(ci_verdict, "_run", fake)
    assert ci_verdict.cmd_verdict("abc123") == ci_verdict.EXIT_GREEN
    assert json.loads(capsys.readouterr().out)["verdict"] == "green"
    api_call = next(c for c in fake.calls if c[:2] == ["gh", "api"])
    assert "repos/owner/repo/commits/abc123" in api_call[-1]
    assert "per_page=100" in api_call[-1]


def test_cmd_verdict_unresolvable_repo_slug_is_non_verdict(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = FakeRunner([(["gh", "repo", "view"], 1, "")])
    monkeypatch.setattr(ci_verdict, "_run", fake)
    assert ci_verdict.cmd_verdict("abc123") == ci_verdict.EXIT_NON_VERDICT
    report = json.loads(capsys.readouterr().out)
    assert report["verdict"] == "non-verdict"
    assert "repo slug" in report["reason"]
    assert not any(c[:2] == ["gh", "api"] for c in fake.calls)


def test_cmd_verdict_gh_failure_is_non_verdict(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = FakeRunner(
        [
            (["gh", "repo", "view"], 0, "owner/repo\n"),
            (["gh", "api"], 1, ""),
        ]
    )
    monkeypatch.setattr(ci_verdict, "_run", fake)
    assert ci_verdict.cmd_verdict("abc123") == ci_verdict.EXIT_NON_VERDICT
    assert json.loads(capsys.readouterr().out)["verdict"] == "non-verdict"


def test_main_crash_exits_non_verdict_not_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(sha: str) -> int:
        raise FileNotFoundError("gh not on PATH")

    monkeypatch.setattr(ci_verdict, "cmd_verdict", boom)
    assert ci_verdict.main(["verdict", "abc123"]) == ci_verdict.EXIT_NON_VERDICT


def test_failure_signature_stable_across_identical_failures() -> None:
    text = _fixture("check_runs_failure.json")
    _, first = ci_verdict.evaluate(text)
    _, second = ci_verdict.evaluate(text)
    assert first["signature"] == second["signature"]

    changed = text.replace("Process completed with exit code 1.", "Different first error line")
    _, third = ci_verdict.evaluate(changed)
    assert third["signature"] != first["signature"]


def test_parse_run_id() -> None:
    url = "https://github.com/owner/repo/actions/runs/16543/job/98"
    assert ci_verdict.parse_run_id(url) == "16543"
    assert ci_verdict.parse_run_id("https://example.com/no-run-here") is None


# --- provision_worktree ------------------------------------------------------


@pytest.mark.parametrize(
    ("branch", "porcelain", "expected"),
    [
        ("main", "", "direct"),
        ("main", " M src/module.py", "worktree"),
        ("feat/other", "", "worktree"),
        ("", "", "worktree"),  # detached HEAD
    ],
)
def test_decide_mode_matrix(branch: str, porcelain: str, expected: str) -> None:
    assert provision_worktree.decide_mode(branch, porcelain) == expected


def test_read_setup_steps_substitutes_root_path() -> None:
    config = json.dumps(
        {
            "setup-worktree-unix": [
                'cp "$ROOT_WORKTREE_PATH/.env" .env',
                "uv sync --frozen",
            ]
        }
    )
    steps = provision_worktree.read_setup_steps(config, "/c/main")
    assert steps == ['cp "/c/main/.env" .env', "uv sync --frozen"]


def test_read_setup_steps_rejects_non_list() -> None:
    with pytest.raises(SystemExit):
        provision_worktree.read_setup_steps('{"setup-worktree-unix": "oops"}', "/m")


def test_provision_refuses_existing_worktree_path(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    (scratch_repo / ".worktrees" / "taken").mkdir(parents=True)
    monkeypatch.chdir(scratch_repo)
    assert provision_worktree.cmd_provision("feat/taken") == 1
    assert "already exists" in capsys.readouterr().err


def test_provision_refuses_existing_branch(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _git(["branch", "feat/exists"], cwd=scratch_repo)
    monkeypatch.chdir(scratch_repo)
    assert provision_worktree.cmd_provision("feat/exists") == 1
    assert not (scratch_repo / ".worktrees" / "exists").exists()


def test_provision_rejects_branch_without_type_prefix(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert provision_worktree.cmd_provision("noslash") == 1
    assert "<type>/<slug>" in capsys.readouterr().err


def test_cmd_decide_prints_mode_and_main_path(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir(scratch_repo)
    assert provision_worktree.cmd_decide() == 0
    decision = json.loads(capsys.readouterr().out)
    assert decision["mode"] == "direct"
    assert Path(decision["main"]) == scratch_repo

    (scratch_repo / "dirty.txt").write_text("x\n", encoding="utf-8")
    _git(["add", "dirty.txt"], cwd=scratch_repo)
    assert provision_worktree.cmd_decide() == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "worktree"


def test_cmd_decide_fails_when_git_state_unreadable(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = FakeRunner([(["git"], 1, "")])
    monkeypatch.setattr(provision_worktree, "_run", fake)
    assert provision_worktree.cmd_decide() == 1
    assert capsys.readouterr().out == "", "no decision JSON may be printed on failure"


def test_provision_aborts_on_first_failed_setup_step(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cursor_dir = scratch_repo / ".cursor"
    cursor_dir.mkdir()
    (cursor_dir / "worktrees.json").write_text(
        json.dumps({"setup-worktree-unix": ["step-one", "step-two"]}), encoding="utf-8"
    )
    monkeypatch.chdir(scratch_repo)

    fake = FakeRunner(
        [
            (
                ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                0,
                f"{(scratch_repo / '.git').as_posix()}\n",
            ),
            (["git", "rev-parse", "--verify"], 1, ""),
            (["git", "fetch", "origin"], 0, ""),
            (["git", "worktree", "add"], 0, ""),
        ]
    )
    monkeypatch.setattr(provision_worktree, "_run", fake)

    executed: list[str] = []

    def fake_run_step(step: str, cwd: Path) -> int:
        executed.append(step)
        return 1 if step == "step-one" else 0

    monkeypatch.setattr(provision_worktree, "_run_step", fake_run_step)

    assert provision_worktree.cmd_provision("feat/fresh") == 1
    assert executed == ["step-one"], "a failed step must abort before later steps run"


def _provision_fakes(
    scratch_repo: Path,
    monkeypatch: pytest.MonkeyPatch,
    failing_step: str | None = None,
) -> tuple[FakeRunner, list[str]]:
    """Fake out git and setup steps so cmd_provision reaches its gates.

    The fake ``git worktree add`` creates the worktree directory like the real
    command would. Returns the fake runner and the list of steps executed
    through ``_run_step``.
    """
    cursor_dir = scratch_repo / ".cursor"
    cursor_dir.mkdir(exist_ok=True)
    (cursor_dir / "worktrees.json").write_text(
        json.dumps({"setup-worktree-unix": ["step-ok"]}), encoding="utf-8"
    )
    fake = FakeRunner(
        [
            (
                ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                0,
                f"{(scratch_repo / '.git').as_posix()}\n",
            ),
            (["git", "rev-parse", "--verify"], 1, ""),
            (["git", "fetch", "origin"], 0, ""),
        ]
    )
    original_call = fake.__call__

    def call(args: list[str], cwd: object = None) -> subprocess.CompletedProcess[str]:
        if args[:3] == ["git", "worktree", "add"]:
            fake.calls.append(list(args))
            Path(args[3]).mkdir(parents=True, exist_ok=True)
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        return original_call(args, cwd)

    executed: list[str] = []

    def fake_run_step(step: str, cwd: Path) -> int:
        executed.append(step)
        return 1 if step == failing_step else 0

    monkeypatch.setattr(provision_worktree, "_run", call)
    monkeypatch.setattr(provision_worktree, "_run_step", fake_run_step)
    monkeypatch.chdir(scratch_repo)
    return fake, executed


def test_provision_runs_configured_setup_steps(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, executed = _provision_fakes(scratch_repo, monkeypatch)
    assert provision_worktree.cmd_provision("feat/fresh") == 0
    assert executed == ["step-ok"]


def test_provision_without_worktrees_json_runs_no_setup_steps(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, executed = _provision_fakes(scratch_repo, monkeypatch)
    (scratch_repo / ".cursor" / "worktrees.json").unlink()
    assert provision_worktree.cmd_provision("feat/fresh") == 0
    assert executed == []


def test_provision_success_prints_workdir_json(
    scratch_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _provision_fakes(scratch_repo, monkeypatch)
    assert provision_worktree.cmd_provision("feat/fresh") == 0
    out = capsys.readouterr().out
    payload = json.loads(out[out.index("{") :])
    assert payload == {
        "workdir": str(scratch_repo / ".worktrees" / "fresh"),
        "branch": "feat/fresh",
    }


# --- merge_cleanup -----------------------------------------------------------


HEAD_SHA = "a" * 40


def _pr_view(body: str, state: str = "OPEN") -> str:
    return json.dumps({"state": state, "body": body})


def _merge_script(
    body: str,
    merge_rc: int = 0,
    current_branch: str = "feat/x",
    extra: list[tuple[list[str], int, str]] | None = None,
) -> FakeRunner:
    return FakeRunner(
        [
            *(extra or []),
            (["gh", "pr", "view"], 0, _pr_view(body)),
            (["gh", "pr", "merge"], merge_rc, ""),
            (["git", "branch", "--show-current"], 0, current_branch + "\n"),
        ]
    )


def _merge(fake: FakeRunner, monkeypatch: pytest.MonkeyPatch, **kwargs: object) -> int:
    monkeypatch.setattr(merge_cleanup, "_run", fake)
    args = {
        "pr": "12",
        "mode": "worktree",
        "branch": "feat/x",
        "head_sha": HEAD_SHA,
        "no_merge": False,
    }
    args.update(kwargs)
    return merge_cleanup.cmd_merge(**args)  # type: ignore[arg-type]


def test_merge_refuses_without_closes_handle(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _merge_script("A PR body that mentions #12 but carries no close handle.")
    assert _merge(fake, monkeypatch, mode="direct") == merge_cleanup.EXIT_NOT_MERGED
    assert not any(c[:3] == ["gh", "pr", "merge"] for c in fake.calls)


def test_merge_refuses_close_handle_for_wrong_issue(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _merge_script("Template junk.\n\ncloses #12")
    assert _merge(fake, monkeypatch, issue=34) == merge_cleanup.EXIT_NOT_MERGED
    assert not any(c[:3] == ["gh", "pr", "merge"] for c in fake.calls)


def test_merge_is_pinned_to_the_verified_head_sha(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _merge_script("closes #12")
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_MERGED
    assert [
        "gh",
        "pr",
        "merge",
        "12",
        "--squash",
        "--match-head-commit",
        HEAD_SHA,
    ] in fake.calls
    assert not any("--delete-branch" in c for c in fake.calls), (
        "gh's own local delete fights the script's cleanup (fails on worktree checkouts)"
    )


def test_cleanup_skipped_when_merge_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _merge_script("Body.\n\ncloses #12", merge_rc=1)
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_NOT_MERGED
    git_calls = [c for c in fake.calls if c[0] == "git"]
    assert git_calls == [], "no cleanup command may run after a failed merge"


def test_merge_failure_rechecks_state_and_cleans_up_when_actually_merged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    views = iter([_pr_view("closes #12", "OPEN"), _pr_view("closes #12", "MERGED")])
    fake = FakeRunner(
        [
            (["gh", "pr", "merge"], 1, ""),
            (["git", "branch", "--show-current"], 0, "docs/other\n"),
        ]
    )
    original_call = fake.__call__

    def call(args: list[str], cwd: object = None) -> subprocess.CompletedProcess[str]:
        if args[:3] == ["gh", "pr", "view"]:
            fake.calls.append(list(args))
            return subprocess.CompletedProcess(args, 0, stdout=next(views), stderr="")
        return original_call(args, cwd)

    monkeypatch.setattr(merge_cleanup, "_run", call)
    result = merge_cleanup.cmd_merge("12", "worktree", "feat/x", HEAD_SHA, no_merge=False)
    assert result == merge_cleanup.EXIT_MERGED, (
        "gh pr merge can exit non-zero after the API merge succeeded; trust the PR state"
    )


def test_already_merged_pr_retry_runs_cleanup_only(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRunner(
        [
            (["gh", "pr", "view"], 0, _pr_view("closes #12", "MERGED")),
            (["git", "branch", "--show-current"], 0, "docs/other\n"),
        ]
    )
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_MERGED
    assert not any(c[:3] == ["gh", "pr", "merge"] for c in fake.calls), (
        "retry on a merged PR must be idempotent — cleanup only, no second merge"
    )
    assert ["git", "worktree", "remove", ".worktrees/x"] in fake.calls


def test_cleanup_step_failure_reports_merged_but_incomplete(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = _merge_script(
        "closes #12",
        current_branch="docs/other",
        extra=[(["git", "worktree", "remove"], 1, "")],
    )
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_CLEANUP_INCOMPLETE
    assert ["git", "branch", "-D", "feat/x"] not in fake.calls, (
        "a failed cleanup step must abort before later steps run"
    )
    assert "do not treat the PR as unmerged" in capsys.readouterr().err


def test_dirty_worktree_refuses_removal_without_force(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands = merge_cleanup.cleanup_commands("worktree", "feat/x", main_on_main=False)
    assert ["git", "worktree", "remove", ".worktrees/x"] in commands
    assert not any("--force" in c for c in commands if c[:3] == ["git", "worktree", "remove"]), (
        "removal must not force-destroy uncommitted work in the worktree"
    )


def test_no_merge_preserves_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _merge_script("closes #12")
    assert _merge(fake, monkeypatch, no_merge=True) == merge_cleanup.EXIT_MERGED
    assert fake.calls == [["gh", "pr", "view", "12", "--json", "state,body"]], (
        "--no-merge must stop after the close-handle check"
    )


def test_worktree_cleanup_never_touches_main_checkout_tree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _merge_script("closes #12", current_branch="docs/dirty-branch")
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_MERGED

    git_calls = [c for c in fake.calls if c[0] == "git" and c[1] != "branch"]
    commands = {tuple(c[:2]) for c in git_calls}
    assert ("git", "checkout") not in commands
    assert ("git", "pull") not in commands
    assert ["git", "worktree", "remove", ".worktrees/x"] in fake.calls
    assert ["git", "branch", "-D", "feat/x"] in fake.calls, "squash merge requires -D"
    assert ["git", "fetch", "origin", "main:main"] in fake.calls
    assert ["git", "push", "origin", "--delete", "feat/x"] in fake.calls


def test_worktree_cleanup_skips_main_ref_update_when_user_on_main(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _merge_script("closes #12", current_branch="main")
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_MERGED
    assert ["git", "fetch", "origin", "main:main"] not in fake.calls


def test_direct_cleanup_returns_to_main_and_force_deletes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _merge_script("Closes #34")
    result = _merge(fake, monkeypatch, pr="34", mode="direct", branch="feat/y")
    assert result == merge_cleanup.EXIT_MERGED
    git_calls = [
        c
        for c in fake.calls
        if c[0] == "git"
        and c[:3] != ["git", "branch", "--show-current"]
        and c[:2] != ["git", "push"]
    ]
    assert git_calls == [
        ["git", "checkout", "main"],
        ["git", "pull", "--ff-only"],
        ["git", "branch", "-D", "feat/y"],
    ]


def test_remote_branch_delete_failure_only_warns(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = _merge_script(
        "closes #12",
        current_branch="docs/other",
        extra=[(["git", "push", "origin", "--delete"], 1, "")],
    )
    assert _merge(fake, monkeypatch) == merge_cleanup.EXIT_MERGED, (
        "a leftover remote ref is litter, not a cleanup failure"
    )
    assert "warning" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("closes #12", True),
        ("Closes #12", True),
        ("close #7", True),
        ("closed #7", True),
        ("fixes #12", False),
        ("closes 12", False),
        ("disclose #12", False),
    ],
)
def test_has_close_handle(body: str, expected: bool) -> None:
    assert merge_cleanup.has_close_handle(body) is expected


@pytest.mark.parametrize(
    ("body", "issue", "expected"),
    [
        ("closes #12", 12, True),
        ("closes #12", 34, False),
        ("closes #123", 12, False),
        ("Closed #7 and closes #12", 7, True),
    ],
)
def test_has_close_handle_pinned_to_issue(body: str, issue: int, expected: bool) -> None:
    assert merge_cleanup.has_close_handle(body, issue) is expected
