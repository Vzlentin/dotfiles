#!/usr/bin/env bash
# campaign.sh — drain a labeled issue queue through /go, one herdr pane per
# unit, serial. Stops on the first non-shipped outcome.
#
# Usage: campaign.sh [--dry-run] <config.env>
#
# The config file is sourced bash. Required variables:
#   REPO           owner/repo of the issue queue
#   WORKREPO       path to the clone the agent runs in; run state is read from ITS .git
#   QUEUE_LABEL    label marking issues ready to run (removed at claim time)
#   CLAIM_LABEL    label added when a unit is claimed
#   NEXT_ISSUE_JQ  jq expression over the [{number,title},…] open-queue list,
#                  emitting the next issue number (or empty when drained) —
#                  title filtering and campaign ordering live here, not in code
#   CAMPAIGN_PLAN  path to the campaign plan, substituted into the prompt
#   LOG            path to the execution log, substituted into the prompt
# Optional:
#   PROMPT_TEMPLATE  prompt with {{N}} / {{CAMPAIGN_PLAN}} / {{LOG}} placeholders
#   UNIT_TIMEOUT_H   per-unit timeout in hours (default 14)
#   POLL_SEC         outcome poll interval in seconds (default 60)
#
# --dry-run resolves the config and the next queue issue, then exits without
# claiming anything or launching panes.
#
# Requires: gh (authed), jq, herdr, omp.
#
# Contract with /go (SKILL.md): Stage 0c records `issue` and Stage 6 records
# `outcome` in <git-common-dir>/go-runs/<slug>.json — this loop keys on exactly
# those two fields. A settled pane with no outcome is treated as a crash.
set -euo pipefail

DRY_RUN=0
if [ "${1:-}" = --dry-run ]; then
  DRY_RUN=1
  shift
fi
CONFIG=${1:?usage: campaign.sh [--dry-run] <config.env>}
# shellcheck source=/dev/null
source "$CONFIG"

: "${REPO:?config must set REPO (owner/repo)}"
: "${WORKREPO:?config must set WORKREPO (path to the work clone)}"
: "${QUEUE_LABEL:?config must set QUEUE_LABEL}"
: "${CLAIM_LABEL:?config must set CLAIM_LABEL}"
: "${NEXT_ISSUE_JQ:?config must set NEXT_ISSUE_JQ (jq: issue list -> next number)}"
: "${CAMPAIGN_PLAN:?config must set CAMPAIGN_PLAN}"
: "${LOG:?config must set LOG}"
UNIT_TIMEOUT_SEC=$(( ${UNIT_TIMEOUT_H:-14} * 3600 )) # healthy units run 3-12h
POLL_SEC=${POLL_SEC:-60}

DEFAULT_TEMPLATE='/skill:go #{{N}}
CAMPAIGN CONTEXT — not the unit spec: the campaign plan is {{CAMPAIGN_PLAN}}. Use this unit'\''s section as planning input only; Stage 0b still makes a unit plan.
LOG: at Stage 6, append this unit'\''s entry to {{LOG}} in the same format as previous entries, including the model-mix line.'
PROMPT_TEMPLATE=${PROMPT_TEMPLATE:-$DEFAULT_TEMPLATE}

next_issue() {
  # Title filtering/ordering is the config's NEXT_ISSUE_JQ; label-token search
  # is unreliable for structured titles (GitHub tokenizes them), so pull the
  # labeled set and filter/sort client-side.
  gh issue list --repo "$REPO" --state open --label "$QUEUE_LABEL" \
    --json number,title | jq -r "$NEXT_ISSUE_JQ"
}

build_prompt() {
  local prompt=$PROMPT_TEMPLATE
  prompt=${prompt//'{{N}}'/$1}
  prompt=${prompt//'{{CAMPAIGN_PLAN}}'/$CAMPAIGN_PLAN}
  prompt=${prompt//'{{LOG}}'/$LOG}
  printf '%s' "$prompt"
}

outcome_for_issue() {
  local target=$1 path
  for path in "$COMMON_DIR"/go-runs/*.json; do
    [ -e "$path" ] || continue
    if [ "$(jq -r '.issue // empty' "$path" 2>/dev/null)" = "$target" ]; then
      jq -r '.outcome // empty' "$path"
      return
    fi
  done
}

pane_json_field() { jq -r --arg f "$1" '.result.pane[$f] // empty'; }

pane_status() { herdr pane get "$1" | pane_json_field agent_status || echo unknown; }

if [ "$DRY_RUN" = 1 ]; then
  N=$(next_issue) || N=""
  jq -n --arg repo "$REPO" --arg workrepo "$WORKREPO" \
    --arg queue "$QUEUE_LABEL" --arg claim "$CLAIM_LABEL" \
    --arg plan "$CAMPAIGN_PLAN" --arg log "$LOG" \
    --arg next "${N:-}" --argjson timeout "$UNIT_TIMEOUT_SEC" \
    '{repo: $repo, workrepo: $workrepo, queue_label: $queue,
      claim_label: $claim, campaign_plan: $plan, log: $log,
      unit_timeout_sec: $timeout, next_issue: (if $next == "" then null else ($next|tonumber) end)}'
  exit 0
fi

COMMON_DIR=$(git -C "$WORKREPO" rev-parse --path-format=absolute --git-common-dir)

while N=$(next_issue) && [ -n "$N" ]; do
  echo "=== #$N: launching /go ($(date -Is)) ==="
  PANE=$(herdr pane split --current --direction right --cwd "$WORKREPO" | pane_json_field pane_id)
  herdr pane rename "$PANE" "go-#$N"

  # Hand off queue state first so a loop crash/restart never double-runs a unit.
  gh issue edit "$N" --repo "$REPO" --remove-label "$QUEUE_LABEL" --add-label "$CLAIM_LABEL"

  # Initial prompt as argv — no send-text race. First line is the Stage 0a work
  # item; following lines are campaign context per the skill's multi-line rule.
  PROMPT=$(build_prompt "$N")
  herdr pane run "$PANE" "omp $(printf '%q' "$PROMPT")"

  # Primary completion signal: the run state's `outcome`. Pane agent status is
  # the crash detector (settled pane, no outcome); the timeout is the backstop.
  START=$(date +%s)
  OUT=""
  WARNED=""
  while :; do
    OUT=$(outcome_for_issue "$N")
    if [ -n "$OUT" ]; then break; fi
    STATUS=$(pane_status "$PANE")
    case "$STATUS" in
      idle|done|unknown)
        sleep 30  # grace: Stage 6 may be writing the outcome right now
        OUT=$(outcome_for_issue "$N")
        if [ -n "$OUT" ]; then break; fi
        STATUS=$(pane_status "$PANE")
        case "$STATUS" in idle|done|unknown) OUT=crashed; break;; esac
        ;;
      blocked)
        if [ -z "$WARNED" ]; then
          echo "#$N: agent is BLOCKED (waiting on input) in pane go-#$N"
          WARNED=1
        fi
        ;;
    esac
    if [ $(( $(date +%s) - START )) -gt "$UNIT_TIMEOUT_SEC" ]; then OUT=timeout; break; fi
    sleep "$POLL_SEC"
  done

  if [ "$OUT" = shipped ]; then
    echo "=== #$N: shipped ($(date -Is)) ==="
    herdr pane close "$PANE"
  else
    echo "#$N ended '$OUT' — pane go-#$N preserved for debugging (issue keeps $CLAIM_LABEL). Stopping."
    exit 1
  fi
done

echo "$QUEUE_LABEL queue drained."
