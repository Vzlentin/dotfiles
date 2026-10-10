#!/usr/bin/env python3
"""Print a Moxfield deck as a decklist that `mtg deck` reads.

The Moxfield API blocks plain HTTP clients, so a URL is loaded through the
web-search skill's browser. A saved API response works too.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

WEB_SEARCH = Path.home() / ".agents" / "skills" / "web-search" / "web-search.js"
API = "https://api2.moxfield.com/v3/decks/all/{}"
SECTIONS = (
    ("Commander", ("commanders", "signatureSpells")),
    ("Companion", ("companions",)),
    ("Deck", ("mainboard",)),
    ("Sideboard", ("sideboard",)),
    ("Maybeboard", ("maybeboard",)),
)
# Moxfield format names that differ from the Scryfall ones `mtg` uses.
FORMATS = {
    "duelCommander": "duel",
    "historicBrawl": "brawl",
    "pauperEdh": "paupercommander",
    "standardBrawl": "standardbrawl",
}
ID_PATTERN = re.compile(r"moxfield\.com/decks/([A-Za-z0-9_-]+)")


def deck_id(value):
    match = ID_PATTERN.search(value)
    return match.group(1) if match else value.strip()


def fetch(public_id, web_search):
    result = subprocess.run(
        [str(web_search), "--url", API.format(public_id), "--full"],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"web-search failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def parse(text):
    # web-search wraps the response in a Markdown code block.
    start = text.find("{")
    end = text.rfind("}")
    try:
        deck = json.loads(text[start : end + 1]) if 0 <= start < end else None
    except ValueError:
        deck = None
    if not isinstance(deck, dict) or "boards" not in deck:
        sys.exit(
            "no Moxfield deck in the response. The deck may be private, or Moxfield blocked the browser."
        )
    return deck


def board_cards(deck, keys):
    cards = []
    for key in keys:
        for entry in deck["boards"].get(key, {}).get("cards", {}).values():
            cards.append((entry["card"]["name"], entry["quantity"]))
    return sorted(cards)


def decklist(deck):
    lines = []
    for title, keys in SECTIONS:
        cards = board_cards(deck, keys)
        if cards:
            lines.append(title)
            lines.extend(f"{quantity} {name}" for name, quantity in cards)
            lines.append("")
    return "\n".join(lines)


def metadata(deck, url):
    moxfield_format = deck.get("format") or ""
    counts = {}
    for key, board in deck["boards"].items():
        if board.get("count"):
            counts[key] = board["count"]
    return {
        "name": deck.get("name"),
        "url": url or deck.get("publicUrl"),
        "moxfield_format": moxfield_format,
        "mtg_format": FORMATS.get(moxfield_format, moxfield_format.lower()),
        "bracket": deck.get("bracket"),
        "auto_bracket": deck.get("autoBracket"),
        "created": deck.get("createdAtUtc"),
        "last_updated": deck.get("lastUpdatedAtUtc"),
        "description": deck.get("description"),
        "counts": counts,
        "maybeboard": [name for name, _ in board_cards(deck, ("maybeboard",))],
        "author_tags": deck.get("authorTags") or {},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "deck", help="Moxfield URL or deck id, or a file with a saved API response"
    )
    parser.add_argument(
        "--meta",
        type=Path,
        help="also write name, format, bracket, dates, tags and Maybe board as JSON",
    )
    parser.add_argument(
        "--web-search",
        type=Path,
        default=WEB_SEARCH,
        help=f"web-search CLI (default {WEB_SEARCH})",
    )
    args = parser.parse_args()
    saved = Path(args.deck).expanduser()
    if saved.is_file():
        deck = parse(saved.read_text(encoding="utf-8"))
        url = None
    else:
        public_id = deck_id(args.deck)
        deck = parse(fetch(public_id, args.web_search))
        url = f"https://moxfield.com/decks/{public_id}"
    print(decklist(deck), end="")
    if args.meta:
        meta = json.dumps(metadata(deck, url), indent=2, ensure_ascii=False)
        args.meta.write_text(meta + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
