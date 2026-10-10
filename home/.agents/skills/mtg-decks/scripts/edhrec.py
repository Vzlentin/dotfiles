#!/usr/bin/env python3
"""List the cards EDHREC decks play with a commander, best first, and mark the ones a decklist already has."""

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

URL = "https://json.edhrec.com/pages/commanders/{}.json"
LINE_PATTERN = re.compile(
    r"^(\d+)\s*[xX]?\s+(.+?)(?:\s+\([A-Za-z0-9]{2,8}\)(?:\s+\S+)?)?\s*$"
)
MAYBE_HEADERS = {"maybeboard", "maybe", "considering"}
OTHER_HEADERS = {
    "commander",
    "commanders",
    "companion",
    "deck",
    "main",
    "mainboard",
    "sideboard",
}


def slug(name):
    folded = unicodedata.normalize("NFKD", name.split(" // ")[0])
    folded = "".join(char for char in folded if not unicodedata.combining(char)).lower()
    folded = re.sub(r"[^a-z0-9\s-]", "", folded)
    return re.sub(r"[\s-]+", "-", folded).strip("-")


def page_slug(commander):
    # EDHREC joins partner commanders in alphabetical order.
    names = sorted(slug(name) for name in commander.split("+"))
    return "-".join(names)


def front(name):
    # EDHREC names double-faced and adventure cards by their front face.
    return name.split(" // ")[0].strip().lower()


def read_list(path):
    have = {}
    section = "deck"
    for raw in Path(path).expanduser().read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        header = line.rstrip(":").lower()
        if header in MAYBE_HEADERS or header in OTHER_HEADERS:
            section = "maybe" if header in MAYBE_HEADERS else "deck"
            continue
        match = LINE_PATTERN.match(line)
        if match:
            have.setdefault(front(match.group(2)), section)
    return have


def fetch(page):
    request = urllib.request.Request(
        URL.format(page), headers={"User-Agent": "mtg-decks-skill/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(
            f"EDHREC has no page {page!r} (HTTP {error.code}). Check the name or use --slug."
        )


def card_rows(data):
    rows = {}
    for cardlist in data.get("container", {}).get("json_dict", {}).get("cardlists", []):
        for view in cardlist.get("cardviews", []):
            potential = view.get("potential_decks") or 0
            row = {
                "name": view["name"],
                "list": cardlist.get("header"),
                "inclusion": round(100 * (view.get("num_decks") or 0) / potential)
                if potential
                else 0,
                "synergy": round(100 * (view.get("synergy") or 0)),
                "decks": view.get("num_decks") or 0,
                "potential": potential,
            }
            key = front(row["name"])
            if key not in rows or row["inclusion"] > rows[key]["inclusion"]:
                rows[key] = row
    return rows


def sort_key(row):
    return (-row["inclusion"], -row["synergy"], row["name"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commander", help='commander name, "A + B" for partners')
    parser.add_argument(
        "--page", help="bracket or theme page, such as upgraded, core or spellslinger"
    )
    parser.add_argument(
        "--slug", help="EDHREC page name, when the commander name does not map to it"
    )
    parser.add_argument(
        "--have", help="decklist; its cards are hidden and its Maybe board is marked"
    )
    parser.add_argument(
        "--all", action="store_true", help="also list the cards the decklist runs"
    )
    parser.add_argument(
        "--min", type=int, default=5, help="minimum inclusion in percent (default 5)"
    )
    parser.add_argument("--json", action="store_true", help="print JSON")
    args = parser.parse_args()

    page = args.slug or page_slug(args.commander)
    if args.page:
        page += "/" + args.page.strip("/")
    have = read_list(args.have) if args.have else {}
    rows = card_rows(fetch(page))
    shown = []
    for key, row in rows.items():
        row["status"] = have.get(key, "")
        if row["inclusion"] >= args.min and (args.all or row["status"] != "deck"):
            shown.append(row)
    shown.sort(key=sort_key)

    if args.json:
        print(json.dumps(shown, indent=2, ensure_ascii=False))
        return
    decks = max((row["potential"] for row in rows.values()), default=0)
    print(f"EDHREC {page}: about {decks} decks. Inclusion, synergy, card, EDHREC list.")
    for row in shown:
        flag = f" [{row['status']}]" if row["status"] else ""
        print(
            f"{row['inclusion']:>3}%  {row['synergy']:+4d}  {row['name']}{flag}  ({row['list']})"
        )


if __name__ == "__main__":
    main()
