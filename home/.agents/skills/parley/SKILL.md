---
name: parley
description: The user's design and decision primitive, and his way to be asked questions. Use when a design, a plan or a question has decisions that only the user can make (trade-offs, taste, priorities, how it must work for him), when he says "parley", or when he asks for a decision doc or a Radius doc.
---

# parley

A parley turns a question that only the user can answer into a contract that you both agree. Its source is one Markdown record. A page shows the record. The page is never the source.

`{baseDir}` is the directory of this `SKILL.md`.

## Rules

Apply these rules to your plan and to each option that you recommend:

- Do not overengineer.
- Take the lazy answer first. Look for the answer that removes a decision.
- No vestigial code: no migration or compatibility code that will not make sense later.
- One copy of each thing.
- It must work for the user first: his machine, with Pi, Herdr and Ghostty.
- Do not make the user repeat himself. Read the earlier records, the memory and the vault first.
- Get the facts yourself. Ask the user only what only he can answer.

## Flow

1. Get the facts. Search the vault for earlier records on the topic. A settled decision stays settled until the user opens it again.
2. Sort the calls:
   - A **your call** is taste, priority, or how it must work for the user. It starts empty.
   - A **my call** is a choice that evidence can settle. It starts set to your plan, with one line of evidence.
3. Up to 3 your calls and no diagram: ask in chat, with the same cards and the same answer line. Else, write a record and a page.
4. Write the record. Use the format of `{baseDir}/template.md`. The terms come first: the design as it stands, with a `{?N}` blank for each open point.
5. Render, publish and read back (see "Hosts"). Give the link and the default line.
6. Apply each answer line to the record:
   - Write `Answer: <letter>`, or `Answer: own`, below the options.
   - Under it, quote the user's exact words with the time in UTC: `> "words" (you, 10-25 13:27)`.
   - For `?N`, explain N in chat first. Use the show-me forms. Then update the card.
7. When no call is open, do the read-back. Write the terms again in your own words, with each answer. Set `status: readback`, publish, and ask for `aligned`.
8. On `aligned`, set `type: canon` and `status: contract`. Replace each blank with plain words, and publish. Goal files come after this step, and they cite the record and its version.

Never write a summary of a settled decision. Quote the user's words. Decision numbers never change.

## Answer line

```text
[slug rN] 1a 3:"own words" 4b:"a note" ?5 ok
[slug rN] aligned
```

- `1a` picks option a. `3:"..."` is an own answer. `4b:"..."` is a pick with a note.
- `?5` asks you to explain 5 in chat first.
- `ok` accepts each my call that the line does not name.
- `aligned` accepts the terms of a read-back.

## Record

- The home is the vault folder of the topic, for example `Val/Harness/<slug>.md`. Add a line to the `_index.md` of that folder. Follow the vault `AGENTS.md`. Do not commit the vault without the user's OK.
- With no vault, the home is `/tmp/parley/<slug>/record.md`.
- `type: memo` while open, `type: canon` as a contract. The `parley:` slug names the page, its storage key and its Radius artifact.
- Show-me blocks go in as they are: `text`, `diff`, `tsx` and `mermaid` (statecharts, sequences, parts diagrams).

## Render

```sh
node {baseDir}/render.mjs <record.md>
```

- This writes `/tmp/parley/<slug>/index.html`, with the record inside the page.
- Colors: Pi's system colors from Ghostty. Without Pi, the terminal theme. Without both, `saved-colors.json`.
- Markdown, code colors and diagrams come from the Pi install. Without Pi, they come from the global npm prefix (`marked`, `highlight.js`, `pele`). A missing package stops the render and names the package.
- Before you publish a new layout, look at headless Chrome screenshots at 390 px and 1280 px.

## Hosts

**Radius**, when the `mcp__radius` tools are there:

- Create the artifact once: `artifacts_create` with `content`, `content_type: "text/html"`, `title`, `visibility: "private"` and a `note`.
- For each new version, use `artifacts_versions_publish` on the same slug, with a note that says what changed.
- The title cannot change after the create. Name the topic, not the state.
- After each publish, read it back: `artifacts_versions_read` (`latest`), then `artifacts_files_download`, `curl` the URL and `cmp` the result with the local file.
- Never publish while an edit runs.
- Radius keeps an artifact 90 days after its last publish.

**Claude Code**: publish the page as an Artifact. Load the `artifact-capabilities` skill first. If the account has them, keep the answers in the page database (`ArtifactData`) and use comment threads (`ArtifactComments`). Copy stays as the fallback. In an inline widget, the page shows Send (`sendPrompt`). This path is not tested yet: test it before you rely on it.

**Else**: open `/tmp/parley/<slug>/index.html` in the browser.
