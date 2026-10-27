---
name: show-me
description: Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused pages. Also renders Mermaid to SVG with Pele, for diagrams in files such as PR bodies and pages.
---

`{baseDir}` is the directory of this `SKILL.md`.

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief. Pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```tsx
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with Mermaid:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For a component change:

```diff
 <SessionPage>
   useSessionEvents()
   <SessionToolbar>
+    <RunSkillButton />
   <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
 src/
 ├── commands/
+│   └── show-me.ts       # expands the slash command
 ├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1)
  return `use the ${skillName} skill`
}
```

- For a visual UI, layout, state comparison, or concept too dense for Mermaid, make one focused page: a diagram, an infographic, or a short slide deck, whichever fits the point. Use real labels and data. Load the `artifacts` skill to build it, color it and open it.

- Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question.

## Diagrams in files

In the chat, Pi draws a ` ```mermaid ` block itself. A diagram for a file (a PR body, a page, an image) needs an SVG:

```sh
{baseDir}/mermaid.mjs /tmp/<name>.mmd /tmp/<name>.svg
```

- Pele is in the global npm prefix. If it is missing, ask the user, and suggest `npm install -g pele`. Do not install it in a project or with `npx`.
- A parse error means the source is wrong. For example, `call`, `end`, `class`, `style`, `click` and `graph` cannot be node IDs.
- Look at the SVG before you use it: `qlmanage -t -s 1600 -o /tmp /tmp/<name>.svg` makes a PNG that you can read.
- Scripts import `renderMermaid(source)` from `{baseDir}/mermaid.mjs`.

You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the user.
