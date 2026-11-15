#!/usr/bin/env python3
"""Print the last N user and assistant text messages of a Pi session or hc terminal."""

import json
import os
import subprocess
import sys
from pathlib import Path

SESSIONS_ROOT = Path.home() / ".pi" / "agent" / "sessions"


def slug_of_cwd(cwd: str) -> str:
    return "--" + cwd.strip("/").replace("/", "-") + "--"


def resolve_session(target: str) -> Path:
    path = Path(target).expanduser()
    if path.is_file():
        return path
    matches = sorted(SESSIONS_ROOT.glob(f"*/*{target}*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if matches:
        return matches[0]
    proc = subprocess.run(["hc", "get", target], capture_output=True, text=True, check=True)
    info = json.loads(proc.stdout)
    cwd = (info.get("foreground") or {}).get("cwd") or info.get("cwd")
    if not cwd:
        raise SystemExit(f"no cwd found for terminal {target}")
    folder = SESSIONS_ROOT / slug_of_cwd(cwd)
    current = os.environ.get("PI_SESSION_FILE", "")
    own_term = os.environ.get("HC_TERMINAL_ID", "")
    candidates = [
        p for p in folder.glob("*.jsonl")
        if target == own_term or str(p) != current
    ]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"no session file in {folder}")
    return candidates[0]


def active_branch(rows: list[dict]) -> list[dict]:
    by_id = {row["id"]: row for row in rows if "id" in row}
    if not rows or "id" not in rows[-1]:
        return rows
    chain = []
    cur = rows[-1]
    seen = set()
    while cur and cur.get("id") not in seen:
        chain.append(cur)
        seen.add(cur.get("id"))
        pid = cur.get("parentId")
        cur = by_id.get(pid) if pid else None
    chain.reverse()
    return chain


def extract_text(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if not isinstance(content, list):
        return ""
    parts = [
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text" and block.get("text", "").strip()
    ]
    return "\n".join(parts).strip()


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print("Usage: pi-turns.py <hc-terminal | session-id | path.jsonl> [count=6]", file=sys.stderr)
        return 2
    target = argv[1]
    limit = int(argv[2]) if len(argv) > 2 else 6
    session_path = resolve_session(target)
    with session_path.open(encoding="utf-8", errors="replace") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    branch = active_branch(rows)
    turns = []
    for row in branch:
        msg = row.get("message") or {}
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        text = extract_text(msg.get("content"))
        if text:
            turns.append((role, row.get("id", ""), text))
    print(f"session: {session_path}")
    for role, oid, text in turns[-limit:]:
        print(f"=== {role.upper()} ({oid}) ===")
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
