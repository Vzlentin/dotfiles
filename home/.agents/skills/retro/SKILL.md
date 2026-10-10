---
name: retro
description: Conduct a retrospective on a coding session and suggest changes to the agent's environment.
argument-hint: "[session file | session ID | ship run ID | topic]"
disable-model-invocation: true
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/engineering/retro
---
Run a retrospective on a coding session. Find changes to the coding agent's **environment** that improve future runs: checks, steering files, docs, skills and tools. The result is a list of candidates, and the user chooses which ones to apply.

## Steps

1. Read the `agents-md` skill. Its placement rules decide where each candidate lives: a check, a doc behind a pointer, a skill, or a line in an `AGENTS.md`.

2. Read the primary sources of the session that the arguments name:
   - **No argument**: the current session, `$PI_SESSION_FILE`.
   - **A session file or ID**: Pi keeps sessions in `~/.pi/agent/sessions/`, one folder per working directory, as `<timestamp>_<session-id>.jsonl`.
   - **A ship run ID**: the run directory `${XDG_STATE_HOME:-$HOME/.local/state}/workflows/runs/<run-id>/`. `round-<n>.patch` and `round-<n>-fix.patch` are the patches each review got. The sessions are in `durable.sqlite`: each row of `entries` holds one Pi message in `record.model`, and `conversation_id` groups the rows by session. Open it read-only.
   - **A topic**: find the session with `session_search`. Ask the user when more than one session matches.

   Parse the sources in the `ipython` tool. Most evidence is in the tool calls and their results (errors, large outputs, repeated reads), the `usage` of each assistant message, and the user's corrections. `session_query` leaves out tool results, so read the sources directly. This step is done when you can state the session's goal, its outcome, and each point where it lost time, tokens or correctness.

3. Look for candidates in these categories:
   - **Navigation**: how easily did the agent find the right files? Are there hidden dependencies between files? Would a **navigation pointer** take the agent there directly? _Use when_ the session took a long time to find a piece of information.
   - **Automated checks**: could a lint rule, type check, test or file check catch an error the agent made? Read the repository's own check command first (its `package.json` or build tool scripts, CI workflow and pre-commit configuration). When a check exists but is not wired in or is silently broken, wiring it in or fixing it is the finding. A repository with no **guardrail** (no pre-commit hook and no CI job that runs its lint, type check and tests) is a finding in itself. Ship's implement and judge sessions run the checks that the repository's `AGENTS.md` lists, so a check counts in ship only when that list includes it. _Use when_ the agent made a mistake that a check could catch, or the repository has no guardrail.
   - **Coding standards**: classify the violation first. A **mechanical** one (a fixed syntax pattern, a banned API, an import shape, a file location rule) gets a deterministic check: a custom rule in the repository's linter, a pre-commit hook or a CI job, whichever the existing guardrail makes cheapest. Prefer building the check to writing a rule. Keep written rules for **judgement calls** (consistency across files, matching the surrounding style), and put them where the reviewer reads them, as described under Implementation and review. _Use when_ the review, or the agent's own check of its diff, missed a mistake.
   - **AGENTS.md**: which lines in `~/AGENTS.md` or the repository's `AGENTS.md` should a check, a doc behind a pointer, or a skill carry instead? _Use when_ an `AGENTS.md` is larger than the `agents-md` skill's size targets.
   - **Tool economy**: which expensive tool calls could be cheaper? Is a custom tool (CLI, MCP server, Pi extension) token-inefficient? _Use when_ the agent made an expensive tool call.
   - **No-ops**: find instructions in steering files and skill descriptions that do not change what the agent does by default. _Use when_ the steering files are large.
   - **Information access**: look for ways to give the agent more information, such as dev server logs teed to a file or read-only access to a third-party service. _Use when_ the agent lacked a crucial piece of information.

4. Present the candidates, most severe first. Severity is what the problem cost in this session and how often it will come back. For each candidate, give its evidence in the session, the change, and the file or command that the change touches.

## Reference

### Implementation and review

The implementing agent has the most **context pressure**: it explores, writes code and debugs failures. A reviewer gets a diff and needs little exploration, so coding standards belong in review.

- `workflows ship` (the `ship` skill) runs plan, implement, review and judge sessions. Each session loads the `AGENTS.md` files and the skill list of its directory. The review session adds the fixed standards in `~/Dev/perso/workflows/prompts/review.md`. The judge reads the rule files that `~/Dev/perso/workflows/prompts/judge.md` names.
- A direct Pi session has no review stage. The same agent implements and checks its own diff.
- No file is read only at review time. A judgement-call rule therefore goes into the repository's `AGENTS.md`, where every session pays for it. When a repository collects several such rules, propose a review-only rules file that the review and judge prompts read. That is a change to the workflows repository.

### Files

- `AGENTS.md`: `~/AGENTS.md` and the repository's files load into every session. Keep them for navigation pointers, constraints that no check can enforce, and the check command.
- Docs: reference files that a pointer leads to. Look for an existing doc before you propose a new one.
- Skills: `~/.agents/skills/` and the repository's `.agents/skills/`. A skill's description is in every session's context unless the skill sets `disable-model-invocation: true`. The body loads only when the skill runs.
- `~/AGENTS.md` and most files in `~/.agents/skills/` are links into `~/Dev/perso/dotfiles/home/`. When a file is a link, propose the change in its target.
