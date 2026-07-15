"""Exercise the pure config/selection parts of campaign/campaign.py directly.

No subprocess, no stubbed ``gh``: the config loading, next-issue selection,
prompt building, remote parsing, and tool preflight are plain functions.
"""

from pathlib import Path

import pytest
from infra import load_script_module

REPO_ROOT = Path(__file__).resolve().parents[1]

campaign = load_script_module(REPO_ROOT / "campaign" / "campaign.py")

ISSUES_PAYLOAD = [
    {"number": 11, "title": "U10: later unit"},
    {"number": 7, "title": "U2b: second sub-unit"},
    {"number": 5, "title": "U2a: first sub-unit"},
    {"number": 9, "title": "unrelated title, must be filtered out"},
]


def _write_config(workrepo: Path, body: str) -> None:
    config = workrepo / ".agents" / "config.toml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(body, encoding="utf-8")


# --- config loading and resolution ---


def test_config_defaults_when_table_empty(tmp_path: Path) -> None:
    config = campaign.resolve_config({}, tmp_path, {})
    assert config.queue_label == "queue"
    assert config.claim_label == "claimed"
    assert config.title_filter is None
    assert config.plan == ""
    assert config.log == ""
    assert config.unit_timeout_sec == 14 * 3600
    assert config.poll_sec == 60
    assert config.prompt_template == campaign.DEFAULT_TEMPLATE


def test_config_overrides(tmp_path: Path) -> None:
    table = {
        "queue_label": "ready-for-agent",
        "claim_label": "in-progress",
        "title_filter": r"^U\d",
        "plan": "plans/campaign.md",
        "log": "plans/log.md",
        "unit_timeout_h": 2,
        "poll_sec": 5,
        "prompt_template": "run {{N}}",
    }
    config = campaign.resolve_config(table, tmp_path, {})
    assert config.queue_label == "ready-for-agent"
    assert config.claim_label == "in-progress"
    assert config.title_filter == r"^U\d"
    assert config.plan == str(tmp_path / "plans/campaign.md"), "plan resolves against workrepo"
    assert config.log == str(tmp_path / "plans/log.md")
    assert config.unit_timeout_sec == 2 * 3600
    assert config.poll_sec == 5
    assert config.prompt_template == "run {{N}}"


def test_env_vars_override_plan_and_log_verbatim(tmp_path: Path) -> None:
    table = {"plan": "plans/campaign.md", "log": "plans/log.md"}
    env = {"CAMPAIGN_PLAN": "/vault/campaign.md", "CAMPAIGN_LOG": "/vault/log.md"}
    config = campaign.resolve_config(table, tmp_path, env)
    assert config.plan == "/vault/campaign.md"
    assert config.log == "/vault/log.md"


def test_missing_config_file_means_empty_table(tmp_path: Path) -> None:
    assert campaign.load_campaign_config(tmp_path) == {}


def test_missing_campaign_table_means_empty_table(tmp_path: Path) -> None:
    _write_config(tmp_path, '[go]\nsetup_check = "true"\n')
    assert campaign.load_campaign_config(tmp_path) == {}


def test_invalid_toml_fails_loudly(tmp_path: Path) -> None:
    _write_config(tmp_path, "[campaign\nnot toml")
    with pytest.raises(SystemExit, match="cannot read project config"):
        campaign.load_campaign_config(tmp_path)


def test_non_table_campaign_key_fails_loudly(tmp_path: Path) -> None:
    _write_config(tmp_path, 'campaign = "not a table"\n')
    with pytest.raises(SystemExit, match=r"\[campaign\].*not a table"):
        campaign.load_campaign_config(tmp_path)


def test_campaign_table_is_read(tmp_path: Path) -> None:
    _write_config(tmp_path, '[campaign]\nqueue_label = "ready"\n')
    assert campaign.load_campaign_config(tmp_path) == {"queue_label": "ready"}


# --- next-issue selection ---


def test_next_issue_natural_sort_and_title_filter() -> None:
    picked = campaign.next_issue(ISSUES_PAYLOAD, r"^U\d")
    assert picked == 5, "U2a sorts before U2b and U10; unrelated titles filtered"


def test_next_issue_sub_unit_ordering() -> None:
    issues = [
        {"number": 1, "title": "U10: later"},
        {"number": 2, "title": "U2b: second"},
    ]
    assert campaign.next_issue(issues, None) == 2, "U2b sorts before U10"


def test_next_issue_without_filter_falls_back_to_issue_number() -> None:
    issues = [
        {"number": 9, "title": "unrelated later"},
        {"number": 3, "title": "unrelated earlier"},
    ]
    assert campaign.next_issue(issues, None) == 3


def test_next_issue_tokened_titles_sort_before_untokened() -> None:
    issues = [
        {"number": 1, "title": "no token here"},
        {"number": 50, "title": "U3: tokened"},
    ]
    assert campaign.next_issue(issues, None) == 50


def test_next_issue_empty_queue_is_none() -> None:
    assert campaign.next_issue([], r"^U\d") is None


def test_next_issue_no_matching_titles_is_none() -> None:
    issues = [{"number": 9, "title": "unrelated title"}]
    assert campaign.next_issue(issues, r"^U\d") is None


# --- prompt building ---


def test_build_prompt_substitutes_all_placeholders() -> None:
    template = "go #{{N}} plan={{CAMPAIGN_PLAN}} log={{LOG}}"
    prompt = campaign.build_prompt(template, 42, "/p/plan.md", "/p/log.md")
    assert prompt == "go #42 plan=/p/plan.md log=/p/log.md"


def test_default_template_substitutes_cleanly() -> None:
    prompt = campaign.build_prompt(campaign.DEFAULT_TEMPLATE, 7, "/p/plan.md", "/p/log.md")
    assert prompt.startswith("/skill:go #7\n")
    assert "/p/plan.md" in prompt
    assert "/p/log.md" in prompt
    assert "{{" not in prompt


# --- owner/repo derivation ---


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/example/repo.git",
        "https://github.com/example/repo",
        "git@github.com:example/repo.git",
        "ssh://git@github.com/example/repo.git",
    ],
)
def test_parse_owner_repo(url: str) -> None:
    assert campaign.parse_owner_repo(url + "\n") == "example/repo"


def test_parse_owner_repo_rejects_unparseable_url() -> None:
    with pytest.raises(SystemExit, match="cannot derive owner/repo"):
        campaign.parse_owner_repo("not-a-remote-url")


# --- preflight ---


def test_missing_tools_reports_all_missing() -> None:
    assert campaign.missing_tools(which=lambda tool: None) == ["gh", "herdr", "omp"]


def test_missing_tools_reports_only_missing() -> None:
    def which(tool: str) -> str | None:
        return "/usr/bin/gh" if tool == "gh" else None

    assert campaign.missing_tools(which=which) == ["herdr", "omp"]


def test_missing_tools_empty_when_all_present() -> None:
    assert campaign.missing_tools(which=lambda tool: f"/usr/bin/{tool}") == []
