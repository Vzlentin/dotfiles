# PROTOTYPE — live-graph control room (THROWAWAY)

**Question:** What visual hierarchy and interactions let one operator understand and safely control a running Campaign without an unreadable mega-graph?

Three structurally different desktop-first variants on one route, selected by `?variant=A|B|C`:

- **A — Graph cockpit:** the Work/Actor graph canvas owns the screen; compact campaign header + control bar, slim attention rail left, contextual inspector right.
- **B — Intervention desk:** the Needs-attention queue and its conversational Human Gate dominate the left half; Work Item progress table right; graph demoted to a small secondary focus surface; inspector is a slide-over drawer.
- **C — Activity command center:** the canonical chronological Activity feed and a selected-path strip dominate; the graph survives as a text outline on the left; inspector right.

## Run

```bash
cd prototypes/live-graph-control-room && python3 -m http.server 8765
```

- http://localhost:8765/?variant=A
- http://localhost:8765/?variant=B
- http://localhost:8765/?variant=C

The bottom-center pill (prototype-only) cycles variants with ◀ ▶ buttons, left/right arrow keys (ignored while typing), and updates the URL.

Everything is fake dense data + in-memory stubs: gate conversations, queued Operator Messages (flip to delivered after ~5 s), Revision activation, retry re-arm, admission-mode flips, draft/successor creation all mutate visibly and log into the canonical Activity timeline. No persistence; reload to reset.
