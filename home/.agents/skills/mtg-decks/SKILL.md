---
name: mtg-decks
description: "Build, review or upgrade Magic: The Gathering decks in any format from exact card data. Use when the user shares a Moxfield or Archidekt link or a decklist, asks for exact card text, asks what to add or cut, asks what is new since a date, or asks about legality, bans, Commander brackets, Game Changers or combos."
compatibility: "Requires the `mtg` command (https://github.com/Vzlentin/mtg). Moxfield links need the web-search skill and its browser."
---

# MTG decks

Work from card data, never from memory. `mtg` keeps every Scryfall card offline with its Oracle text, legality in every format, printings, prices and Tagger roles. Run `mtg <command> --help` for the options. The scripts below are in this skill's `scripts/` folder.

## 1. Card data

- If `command -v mtg` fails, ask the user, then install it: `curl -fsSL https://raw.githubusercontent.com/Vzlentin/mtg/main/install.sh | sh`.
- Run `mtg update`. When it reports new cards or newer data, run `mtg upgrade` (about 90 MB, a few seconds). `mtg changes` then lists the new cards, Oracle text changes and bans.

## 2. Get the deck

- Moxfield: `python3 scripts/moxfield.py <url> --meta meta.json > deck.txt`. Moxfield blocks plain HTTP clients, so the script loads the API through the web-search browser. `meta.json` has the name, format (`mtg_format`), bracket, last edit date, the author tags of each card, and the Maybe board.
- Archidekt: `python3 scripts/archidekt.py <url> --meta meta.json > deck.txt`. Archidekt has no format names, so `mtg_format` is set only for decks with a commander. Its card categories (for example "Ramp" or "Removal") are in `author_tags`. For a quick check without a file, `mtg deck <url>` reads a public Archidekt deck directly.
- Other sites: ask for an export, or read the page with the web-search skill.
- A pasted list: save it to a file. `mtg deck` reads Moxfield, Archidekt, MTGA, MTGO and plain text lists.

Run `mtg deck deck.txt --format <format>` and keep its report: counts, curve and problems. `mtg deck deck.txt --format <format> --md > cards.md` writes the exact text of every card. Read it.

## 3. Read the deck before you search

Write a short reading and show it to the user:

- Plan: what the commander or the key cards do, and how the deck wins.
- Roles: count lands, ramp, card draw, removal, protection, threats and engines.
- Patterns: rules the list follows, for example "every pump spell also draws a card" or "instant-speed spells only".
- Intentional omissions: cards in the Maybe board, and well-known staples that the deck does not run, were most likely rejected. Do not propose them again without a new reason.
- Limits: format, bracket and Game Changers for Commander, and the budget that the prices suggest.

## 4. Find candidates

- New cards: take the last edit date from `meta.json`, or ask. `mtg sets --since <date>` lists the sets since then. `mtg search --since <date> --legal <format>` finds their cards. Narrow with `--ci` (Commander) or `--colors`, `--type`, `--mv`, `--text`, `--regex` and `--tag` (Tagger roles such as `removal`, `ramp`, `draw` or `protection`).
- Missed cards in Commander: `python3 scripts/edhrec.py "<commander>" --have deck.txt` lists the cards most played with that commander that the deck does not run, best first, and marks the Maybe board. `--page upgraded` (or `exhibition`, `core`, `optimized`, `cedh`) narrows to one bracket. A theme works too, for example `--page spellslinger`.
- Missed cards in 60-card formats: EDHREC does not cover them. Use `mtg search` by role, and the web-search skill for recent tournament lists.
- Read each candidate with `mtg card "<name>" --rulings` before you propose it.
- Never cut a `mtg search` list with `head`. The list is sorted by name, so a cut hides cards at random. Run `--count` first, then narrow the filters, or use `--limit` with `--sort edhrec`.

## Keep the data in Python

When you combine several lists (deck, Maybe board, EDHREC, searches) or read more than about 50 candidates, use a persistent Python tool if your harness has one, such as the `ipython` tool. Load the data once, join it there, and print only short summaries: counts, names, and the text of the cards you keep. Keep the variables for the rest of the task.

The `ipython` tool starts each cell in the session folder, so `os.chdir` does not last. Use absolute paths, and pass `cwd` to `subprocess`.

```python
import json
import subprocess
from pathlib import Path

work = Path("/tmp/<deck>")  # the folder with deck.txt and meta.json
scripts = Path("<this skill's folder>/scripts")

def run_json(*command):
    result = subprocess.run(command, capture_output=True, text=True, cwd=work)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return json.loads(result.stdout)

meta = json.loads((work / "meta.json").read_text())
since = meta["last_updated"][:10]
new_cards = run_json("mtg", "search", "--since", since, "--legal", "commander", "--limit", "0", "--json")
popular = run_json("python3", str(scripts / "edhrec.py"), "<commander>", "--have", "deck.txt", "--json")
```

Without such a tool, use `--json` with a small script, or `mtg sql`.

## 5. Propose swaps

- Swap like for like: same role, the same land and ramp counts, a similar curve.
- Respect the intentional omissions and the patterns of the deck.
- Mark the cards that add a lot of power. Stay in the format and bracket the user asked for.
- Check the rules interactions with the engine of the deck (commander, copy effects, replacement effects) in the rulings.
- For each swap give: the card out, the card in, new or missed (`mtg card` shows the first printing), the reason, and the price.

## 6. Check and deliver

- Write the new list and run `mtg deck new.txt --format <format>`. Fix every problem it reports. For Commander, add `--combos` and compare the Game Changers, tutors and combos with the bracket.
- Give the user the swap table, the card text (`mtg deck new.txt --format <format> --md`) and the new list, ready to import.
- Never edit the online deck and never post anything. The user imports the list.

## Commander brackets

The Wizards of the Coast rules change. Check the current ones when it matters. In 2026:

- 1 Exhibition and 2 Core: no Game Changers, no mass land denial, no chains of extra turns, no two-card combos, few tutors.
- 3 Upgraded: up to 3 Game Changers, no mass land denial, no chains of extra turns, no two-card combos early in the game.
- 4 Optimized and 5 cEDH: only the ban list.

`mtg deck --format commander` counts the Game Changers and lists tutors, extra turns and mass land denial. The Game Changer list changes too. Trust the `mtg` data, not memory.

## Gotchas

- EDHREC names double-faced and adventure cards by their front face. `edhrec.py` compares names on the front face.
- Cards that are not released yet are already in the data. `mtg card` and `mtg deck` show "not released yet".
- `mtg search` hides digital-only cards, unless `--legal` names an Arena format or you add `--digital`.
- The tutor count comes from community Tagger tags. Check doubtful cards yourself.
- Moxfield format names can differ from Scryfall ones. Use `mtg_format` from `meta.json`, and if `mtg` rejects it, `mtg` lists the valid names.
