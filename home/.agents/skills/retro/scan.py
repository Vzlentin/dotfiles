#!/usr/bin/env python3
"""Count known failures over recent Pi sessions.

Prints one row per failure pattern (sessions hit, failed calls, last day seen), then the sessions with the most
failures. Use it to find the session to review, and to measure how often a failure comes back.
"""

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

SESSIONS = Path.home() / ".pi" / "agent" / "sessions"

PATTERNS = {
    "memo note too long": r"Too long: \d+ bytes, limit \d+",
    "edit text not found": r"Could not find (edits\[\d+\]|the exact text)",
    "read path not found": r"ENOENT: no such file or directory",
    "not a git repository": r"not a git repository",
    "command not found": r"command not found",
    "command aborted": r"Command aborted",
    "command timed out": r"Command timed out after",
    "tool arguments rejected": r"Validation failed for tool",
    "codemode global missing": r"ReferenceError: \w+ is not defined",
    "harness protocol mismatch": r"harness protocol \d+ and the host",
    "unknown CLI option": r"Unknown (option|flag)",
    "model rate limit": r"rate_limit_error|429 Too Many Requests",
}


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=float, default=14, help="sessions written in the last N days (default 14)")
    parser.add_argument("--min-kb", type=float, default=150, help="skip smaller session files (default 150)")
    parser.add_argument("--pattern", action="append", default=[], metavar="NAME=REGEX",
                        help="count one more failure; repeat it for more")
    parser.add_argument("--only", metavar="NAME", help="list each hit of this pattern, with its tool call")
    parser.add_argument("--top", type=int, default=10, help="sessions to list (default 10)")
    parser.add_argument("--json", action="store_true", help="print the counts as JSON")
    return parser.parse_args(argv)


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(part.get("text", "") for part in content or [] if isinstance(part, dict))


def session_files(days, min_kb):
    """The recent sessions, without the current one: a retro session quotes the failures of the others."""
    since = time.time() - days * 86400
    current = os.environ.get("PI_SESSION_FILE", "")
    for path in sorted(SESSIONS.glob("*/*.jsonl")):
        stat = path.stat()
        if str(path) != current and stat.st_mtime >= since and stat.st_size >= min_kb * 1024:
            yield path


def tool_results(path):
    """Yield (tool call arguments, result text) for each tool result of one session."""
    calls = {}
    with path.open(encoding="utf-8", errors="replace") as lines:
        for line in lines:
            if '"toolCall"' not in line and '"toolResult"' not in line:
                continue
            try:
                message = json.loads(line).get("message") or {}
            except json.JSONDecodeError:
                continue
            if message.get("role") == "assistant":
                for part in message.get("content") or []:
                    if isinstance(part, dict) and part.get("type") == "toolCall":
                        calls[part.get("id")] = json.dumps(part.get("arguments"), ensure_ascii=False)
            elif message.get("role") == "toolResult":
                yield calls.get(message.get("toolCallId"), ""), text_of(message.get("content"))


def scan(paths, patterns, only):
    hits = Counter()
    sessions = Counter()
    last = {}
    per_session = Counter()
    examples = []
    for path in paths:
        day = path.name[:10]
        seen = set()
        for call, text in tool_results(path):
            for name, regex in patterns.items():
                match = regex.search(text)
                if not match:
                    continue
                hits[name] += 1
                per_session[path] += 1
                seen.add(name)
                if name == only:
                    examples.append((day, path.name[:19], call[:160], text[match.start():match.start() + 160]))
        for name in seen:
            sessions[name] += 1
            last[name] = max(last.get(name, ""), day)
    return hits, sessions, last, per_session, examples


def main(argv):
    args = parse_args(argv)
    patterns = dict(PATTERNS)
    for item in args.pattern:
        name, _, regex = item.partition("=")
        if not regex:
            sys.exit(f"--pattern needs NAME=REGEX, got {item!r}")
        patterns[name] = regex
    if args.only and args.only not in patterns:
        sys.exit(f"--only: no pattern named {args.only!r}")
    compiled = {name: re.compile(regex) for name, regex in patterns.items()}
    paths = list(session_files(args.days, args.min_kb))
    hits, sessions, last, per_session, examples = scan(paths, compiled, args.only)

    if args.json:
        rows = [{"pattern": n, "sessions": sessions[n], "hits": hits[n], "last": last.get(n)} for n in patterns]
        top = [{"session": str(p), "hits": h} for p, h in per_session.most_common(args.top)]
        print(json.dumps({"scanned": len(paths), "patterns": rows, "sessions": top}, indent=1))
        return

    print(f"{len(paths)} sessions from the last {args.days:g} days, at least {args.min_kb:g} KB\n")
    print(f"{'pattern':28} {'sessions':>8} {'hits':>6}  last")
    for name in sorted(patterns, key=lambda n: -hits[n]):
        print(f"{name:28} {sessions[name]:>8} {hits[name]:>6}  {last.get(name, '-')}")
    if args.top:
        print("\nSessions with the most hits:")
        for path, count in per_session.most_common(args.top):
            print(f"{count:>4}  {path}")
    for day, session, call, text in examples:
        print(f"\n{day} {session}\n  call:   {call}\n  result: {' '.join(text.split())}")


if __name__ == "__main__":
    main(sys.argv[1:])
