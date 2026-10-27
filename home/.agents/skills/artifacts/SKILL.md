---
name: artifacts
description: Make HTML pages for the user and get them to him: pages that teach, decision pages, and copies to share. Covers the approach, the terminal theme, the renderer, and the hosts (local file, Radius, Claude Artifact).
---

# artifacts

An artifact is a page that you make for the user, outside the terminal: to explain, to decide, or to share. He reads it on his computer and on his phone.

`{baseDir}` is the directory of this `SKILL.md`.

## Approach

- Progressive disclosure.
- Plain language. Define each term on first use.
- Concrete before abstract.
- Creative: build the parts that the point needs, in HTML in the source. Nothing is fixed.
- Responsive design: the same page works on his computer and on his phone.
- The terminal theme: Pi's colors from Ghostty. Use no other colors, except in a copy to share.

## Build

```sh
node {baseDir}/render.mjs <source.md>           # /tmp/pages/<slug>/index.html
node {baseDir}/render.mjs --share <source.md>   # light copy for other people, and for a PDF
node {baseDir}/render.mjs --theme               # the theme as CSS variables, for a page by hand
```

- The source: frontmatter with a `page:` slug, a `# Title`, then `## ` sections. HTML and `<style>` blocks go in as they are.
- Code blocks: `mermaid` (drawn with the Pele script of `show-me`), `diff`, and each language that highlight.js knows.
- A `## Decisions` section becomes answer cards with an answer line, in the format of the parley template.
- Colors: Pi's system colors from Ghostty. Without Pi, the terminal colors. Without both, `saved-colors.json`.
- A PDF: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf=<file.pdf> file:///tmp/pages/<slug>/share.html`.

Before you publish, look at headless Chrome screenshots at 1280 px and 390 px. A headless Chrome window is at least 500 px wide: for 390 px, take the screenshot of a page that shows the page in a 390 px `iframe`.

## Hosts

**Radius**, the default in Pi:

- Create the artifact once: `artifacts_create` with `content`, `content_type: "text/html"`, `title`, `visibility: "private"` and a `note`.
- For each new version, use `artifacts_versions_publish` on the same slug, with a note that says what changed.
- The title cannot change after the create. Name the topic, not the state.
- After each publish, read it back: `artifacts_versions_read` (`latest`), then `artifacts_files_download`, `curl` the URL and `cmp` the result with the local file.
- Never publish while an edit runs.
- Radius keeps an artifact 90 days after its last publish.
- If the Radius tools fail, or the user cannot open the link (a client VPN can block it), use the local file.

**Local file**: `open /tmp/pages/<slug>/index.html`.

**Claude Code**: publish the page as an Artifact. Load the `artifact-capabilities` skill first. If the account has them, keep the answers in the page database (`ArtifactData`) and use comment threads (`ArtifactComments`). Copy stays as the fallback. In an inline widget, the page shows Send (`sendPrompt`). This path is not tested yet: test it before you rely on it.
