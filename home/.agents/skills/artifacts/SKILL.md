---
name: artifacts
description: "Make HTML pages for the user and get them to him: pages that teach, pages that ask for his edits, and copies to share. Covers the approach, the terminal theme, the base shell, Alpine, the way back, and the hosts (local file, Radius, Claude Artifact)."
---

# artifacts

An artifact is a page that you make for the user, outside the terminal: to explain, to ask for his edits, or to share. He reads it on his computer most of the time, and sometimes on his phone.

`{baseDir}` is the directory of this `SKILL.md`.

## Approach

- Progressive disclosure.
- Plain language. Define each term on first use.
- Concrete before abstract.
- You design the layout of each page for its content. Desktop first: use the width with grids, columns and side-by-side parts. Text keeps a readable measure. The same page must also work on a phone.
- Creative: build the parts that the point needs, in HTML in the source. Nothing is fixed.
- The terminal theme: Pi's colors from Ghostty. Use no other colors, except in a copy to share.

## Build

```sh
node {baseDir}/render.mjs <source.md> [out.html]   # /tmp/pages/<slug>/index.html
node {baseDir}/render.mjs --share <source.md>      # light copy for other people, and for a PDF
node {baseDir}/render.mjs --theme                  # the theme as CSS variables, for a page by hand
```

- The source: frontmatter with a `page:` slug, then Markdown and HTML. `<style>` and `<script>` blocks go in as they are.
- The base shell gives the theme as CSS variables (`--accent`, `--text`, `--muted`, `--card`, `--line`, ...), the type, the spacing and the code style. The page is at most `--page` wide (1440 px), centered. Inside it, the page lays itself out. Optional parts: `.grid` (columns that wrap on a phone), `.card`, `.muted`, `.no-share`.
- Code blocks: `diff`, and each language that highlight.js knows.
- A local image goes into the page. A local SVG goes in as it is and takes the page colors. For a diagram, draw it with `show-me` (`mermaid.mjs --page`) and link the SVG: `![what it shows](diagram.svg)`.
- A PDF: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf=<file.pdf> file:///tmp/pages/<slug>/share.html`.

## Interaction and the way back

When the source has an Alpine attribute (`x-data`, `x-model`, `@click`, ...), the page gets Alpine.js with its persist plugin (`{baseDir}/vendor`). Write tabs, steps, toggles and fields as Alpine attributes in the HTML. Set `alpine: true` or `false` in the frontmatter to force it.

The way back is how the user's edits come back to you: one store, `$store.back`, kept in his browser.

```html
<textarea x-data x-init="$store.back.field('reply 1', $el.value)" x-model="$store.back.values['reply 1']">Draft</textarea>
<span x-data x-show="$store.back.changed('reply 1')">edited <a @click="$store.back.undo('reply 1')">undo</a></span>

<div class="bar" x-data><div class="line" x-text="$store.back.text"></div><button class="primary" @click="$store.back.copy()">Copy</button></div>
```

- `$store.back.text` is the block that Copy gives: the lines of each part, then each changed field as `key:` and its text. With no part, it starts with `[slug]`.
- A page that builds its own lines adds a part: `Alpine.store("back").part(() => "a line")`, in an `alpine:init` listener.
- The user pastes the block to you. Read it, then apply it.

## Check

Before you publish, look at headless Chrome screenshots at 1280 px and 390 px. A headless Chrome window is at least 500 px wide: for 390 px, take the screenshot of a page that shows the page in a 390 px `iframe`. At 1280 px, ask: does the page use the width?

## Hosts

**Radius**, the default in Pi:

- Create the artifact once: `artifacts_create` with `content`, `content_type: "text/html"`, `title`, `visibility: "private"` and a `note`.
- For each new version, use `artifacts_versions_publish` on the same slug, with a note that says what changed.
- The title cannot change after the create. Name the topic, not the state.
- A page with Alpine is larger than one tool output (50 KB). In codemode, read it as base64 in parts of 40 KB, then decode it with `decodeURIComponent(escape(atob(b64)))`.
- After each publish, read it back: `artifacts_versions_read` (`latest`), then `artifacts_files_download`, `curl` the URL and `cmp` the result with the local file.
- Never publish while an edit runs.
- Radius keeps an artifact 90 days after its last publish.
- If the Radius tools fail, or the user cannot open the link (a client VPN can block it), use the local file.

**Local file**: `open /tmp/pages/<slug>/index.html`.

**Claude Code**: publish the page as an Artifact. Load the `artifact-capabilities` skill first. If the account has them, keep the answers in the page database (`ArtifactData`) and use comment threads (`ArtifactComments`). Copy stays as the fallback. In an inline widget, the page shows Send (`sendPrompt`). This path is not tested yet: test it before you rely on it.
