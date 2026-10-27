---
name: parley
description: The user's decision primitive, and his way to be asked questions. Use when a design, a plan or a question has decisions that only the user can make (trade-offs, taste, priorities, how it must work for him), or when he says "parley".
---

# parley

A parley turns a question that only the user can answer into a contract that you both agree. It happens in the chat.

`{baseDir}` is the directory of this `SKILL.md`.

## How you talk

The user takes many decisions each day, on many systems. Brief him like an executive.

- BLUF, then Minto's pyramid principle.
- Each call: your plan, and what each option costs, in outcomes and numbers, not code.
- Plain language. Define each term on first use.
- At most 5 open calls at a time. The others wait their turn.
- Each turn, give the state: decided, open, next.
- Each round builds on the last one. When a view you already showed changes, show that same view again, updated, with the change marked.
- A side topic gets one line at the end.
- End with one thing to answer.

Use `show-me` for the views. Make a page only when the user asks for it: write the record, build its page, then load `artifacts` to check it and publish it.

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
3. Ask in the chat. Give the answer line that takes all your plans.
4. Apply each answer line. For `?N`, explain N first.
5. When no call is open, read back: the terms in your own words, with each answer. Ask for `aligned`.
6. On `aligned`, write the record as the contract. Goal files come after this step, and they cite the record.

## Answer line

```text
[slug rN] 1a 3:"own words" 4b:"a note" ?5 ok
[slug rN] aligned
```

- `1a` picks option a. `3:"..."` is an own answer. `4b:"..."` is a pick with a note.
- `?5` asks you to explain 5 first.
- `ok` accepts each my call that the line does not name.
- `aligned` accepts the terms of a read-back.

## Record

Write it when the user asks for a page, and at the contract. Use the format of `{baseDir}/template.md`. It goes in the vault: load `vault`. With no vault, it goes in `/tmp/pages/<slug>/record.md`.

- `type: memo` while open. At the contract: `type: canon`, `status: contract`, and plain words in place of each blank.
- Below the options of each decided card: `Answer: <letter>`, or `Answer: own · <short label>`. Under it, quote the user's exact words with the time in UTC from the session log: `> "words" (you, 10-25 13:27)`.
- Never write a summary of a settled decision: quote the user's words. Decision numbers never change.

## Page

```sh
node {baseDir}/page.mjs <record.md> [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/page.mjs --share <record.md>      # light copy, with no cards to answer
```

The page shows the terms with live blanks, the cards and the answer line. Its Copy gives the answer line, then each field that the page adds to the way back of `artifacts`.
