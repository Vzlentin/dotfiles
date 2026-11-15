---
name: herdr
description: "Control Herdr (hc and herdr), a terminal multiplexer for coding agents. Use only when the user explicitly mentions Herdr or hc, or asks to inspect or control panes, terminals, tabs, workspaces, commands, or another agent. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work."
---

# Herdr (`hc`)

`{baseDir}` is the directory of this `SKILL.md`.

Herdr runs as `hc` (`herdr-core`, when `HC_TERMINAL_ID` is set in the environment) or legacy `herdr` (when only `HERDR_ENV=1` is set). Always check `HC_TERMINAL_ID` first: an old `HERDR_ENV=1` variable can remain in the environment inside `hc` and point to stale panes.

```bash
printf 'HC=%s HERDR=%s\n' "${HC_TERMINAL_ID:-}" "${HERDR_ENV:-}"
```

If neither is set, say that you are not running inside Herdr and stop.

## Using `hc` (default when `HC_TERMINAL_ID` is set)

Discover live terminals and your own address:

```bash
hc ls                 # live terminals across local and connected machines (--all includes finished)
hc get <t>            # JSON details for terminal <t> (cwd, foreground process, status, turn, where)
hc read <t>           # rendered screen of terminal <t> (--lines N adds scrollback above the screen)
```

- Each terminal has an address such as `t2t`, `t46`, or `404records/t7`.
- `where` in `hc ls` (for example `"perso / 1"`) shows which workspace and tab share a screen with `$HC_TERMINAL_ID`.
- For an interactive TUI such as Pi that runs on the alternate screen (`"screen": "exact"` in `hc get <t>`), `hc read <t>` shows only the current viewport and `--lines` has no scrollback. To read the recent user and assistant messages of a Pi session in `<t>` (following its active `/tree` branch), run:

```bash
python3 {baseDir}/pi-turns.py <t> 6
```

Do not write ad-hoc `python3 -c` one-liners in bash to parse `~/.pi/agent/sessions/*.jsonl`.

### Talk to another terminal or agent in `hc`

```bash
hc send <t> <text>    # paste text into <t> and press enter
hc keys <t> <keys...> # press keys: enter, esc, up, ctrl+c
hc interrupt <t>      # send the stop key and report what happened
hc wait <t>           # wait until <t> stops working (--output X waits for substring X)
hc run <cmd> [task]   # start a new terminal and wait (--bg returns at once; --keep respawns a shell)
hc kill <t>           # stop the program in <t>
```

- When you send work to another agent with `hc send <t> ...`, confirm that it started (`hc get <t>`), wait for it (`hc wait <t>`) unless the user asked for a fire-and-forget handoff, and read its reply (`hc read <t>` or `python3 {baseDir}/pi-turns.py <t> 2`).
- Never kill or close terminals you did not create unless the user explicitly asked.

---

## Fallback: legacy `herdr` CLI (only when `HC_TERMINAL_ID` is unset and `HERDR_ENV=1`)

For legacy `herdr` walkthroughs, read [references/cli.md](references/cli.md).

```bash
herdr workspace list
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

- Use `--current`, an explicit pane ID (`w1:p1`), or a unique agent name.
- Use `herdr agent prompt <target> <text> --wait` to submit work and wait for `idle`, `done`, or `blocked`.
- Do not close workspaces, tabs, panes, or sessions you did not create unless the user explicitly asked.
