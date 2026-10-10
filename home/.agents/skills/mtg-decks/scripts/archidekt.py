#!/usr/bin/env python3
"""Print a public Archidekt deck as a decklist that `mtg deck` reads."""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://archidekt.com/api/decks/{}/"
ID_PATTERN = re.compile(r"archidekt\.com/(?:api/)?decks/(\d+)")
SECTIONS = ("Commander", "Companion", "Deck", "Sideboard", "Maybeboard")
SECTION_CATEGORIES = {"Commander", "Maybeboard", "Sideboard"}


def deck_id(value):
    match = ID_PATTERN.search(value)
    if match:
        return match.group(1)
    if value.strip().isdigit():
        return value.strip()
    sys.exit(f"not an Archidekt deck link: {value}")


def fetch(public_id):
    request = urllib.request.Request(
        API.format(public_id), headers={"User-Agent": "mtg-decks-skill/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(
            f"Archidekt answered {error.code} for deck {public_id}. Private decks can't be read."
        )


def section_of(entry, premier, outside):
    categories = set(entry.get("categories") or [])
    if entry.get("companion"):
        return "Companion"
    if categories & premier or "Commander" in categories:
        return "Commander"
    if categories & outside or "Maybeboard" in categories:
        return "Maybeboard"
    if "Sideboard" in categories:
        return "Sideboard"
    return "Deck"


def card_sections(deck):
    categories = deck.get("categories") or []
    premier = {item["name"] for item in categories if item.get("isPremier")}
    outside = {
        item["name"] for item in categories if not item.get("includedInDeck", True)
    }
    sections = {title: [] for title in SECTIONS}
    tags = {}
    for entry in deck.get("cards") or []:
        name = ((entry.get("card") or {}).get("oracleCard") or {}).get("name")
        if not name:
            continue
        section = section_of(entry, premier, outside)
        sections[section].append((name, entry.get("quantity") or 1))
        card_tags = [
            tag
            for tag in entry.get("categories") or []
            if tag not in SECTION_CATEGORIES
        ]
        if card_tags:
            tags[name] = card_tags
    return sections, tags


def decklist(sections):
    lines = []
    for title in SECTIONS:
        if sections[title]:
            lines.append(title)
            lines.extend(
                f"{quantity} {name}" for name, quantity in sorted(sections[title])
            )
            lines.append("")
    return "\n".join(lines)


def metadata(deck, sections, tags, url):
    return {
        "name": deck.get("name"),
        "url": url,
        "archidekt_format": deck.get("deckFormat"),
        # Archidekt formats are numbers. Only a commander is a safe hint.
        "mtg_format": "commander" if sections["Commander"] else None,
        "bracket": deck.get("edhBracket"),
        "created": deck.get("createdAt"),
        "last_updated": deck.get("updatedAt"),
        "description": deck.get("description"),
        "deck_tags": deck.get("deckTags") or [],
        "counts": {
            title: sum(quantity for _, quantity in cards)
            for title, cards in sections.items()
            if cards
        },
        "maybeboard": sorted(name for name, _ in sections["Maybeboard"]),
        "author_tags": tags,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", help="Archidekt deck link or id")
    parser.add_argument(
        "--meta",
        type=Path,
        help="also write name, dates, bracket, categories and Maybe board as JSON",
    )
    args = parser.parse_args()
    public_id = deck_id(args.deck)
    deck = fetch(public_id)
    sections, tags = card_sections(deck)
    print(decklist(sections), end="")
    if args.meta:
        url = f"https://archidekt.com/decks/{public_id}"
        meta = json.dumps(
            metadata(deck, sections, tags, url), indent=2, ensure_ascii=False
        )
        args.meta.write_text(meta + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
