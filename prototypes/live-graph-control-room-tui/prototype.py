#!/usr/bin/env python3
"""PROTOTYPE -- THROWAWAY. Do not productionize, do not tidy into the repo proper.

Prototype question (GitHub issue #9):
    What is the smallest Herdr-hosted running-Campaign TUI that makes
    progress, parallelism, graph decisions, and operator-needed work
    immediately legible while keeping details behind expansion?

Usage:
    python3 prototype.py                        # interactive curses TUI
    python3 prototype.py --snapshot A --campaign active --width 120 --height 36
    python3 prototype.py --snapshot B --campaign active --expand 412
    python3 prototype.py --snapshot C --campaign shipped

Behavior:
    Renders two views of the public Calibre Stage 3 Gate B Campaign from issue
    #397. The active view is an explicitly reconstructed midpoint, not a claim
    of an exact historical runtime snapshot. The shipped view records the
    actual final topology: planning issues #398, #399, #400, #401, #402,
    #403, and #405 plus work issues #406-#417 succeeded, PRs #418-#429
    merged, and the final owner GO Decision resolved.

    Campaign-level Decisions and Work Items are compound nodes; Enter expands
    exactly one of them to reveal its Actor Graph (Wayfinder disciplines for
    Decisions and logical /go stages for Work Items). In Variant A, active,
    takeable, and pending parents splice the Actor Graph into the Campaign
    route, while done and failed parents keep the Campaign rail compact and
    show historical Actor detail below it. Plans are attached artifacts, never
    graph nodes. The real graph has seven planning Decisions, twelve serial
    Work Items, and one final owner GO Decision. Plans, Attempts, costs, logs,
    and metrics are deliberately absent. Three layout variants share the same
    data and state, each with its own layout algorithm and reading direction:

      A -- Metro/Rails:   wide left-to-right dependency railway; current
                          Actor topology splices inline, historical detail
                          unfolds below a compact rail; chains share rails,
                          fan-out/joins are vertical track buses.
      B -- Layered Field: top-to-bottom topological strata; edges are
                          vertical/diagonal links between layers.
      C -- Graph Log:     narrow top-to-bottom 'git log --graph' style with
                          dependency rails in the gutter.

    All layout is derived from nodes/edges at render time (no stored x/y).
    State is encoded glyph-first (non-color-only); color only reinforces.
    Oversized layouts use a bounded viewport that follows the selected node;
    header and footer stay fixed and edge continuation uses ASCII indicators.

    Interactive controls: 1/2/3 variant, c campaign, arrows/Tab move,
    Enter expand/collapse or focus-stub an actor, n next needs-operator node,
    ? help/legend, q quit. Snapshot mode prints the same bounded viewport
    deterministically for review.
"""
from __future__ import annotations

import argparse
import curses
import locale
import sys
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Glyphs: state is encoded by symbol first; color is only reinforcement.
# --------------------------------------------------------------------------
STATE_GLYPH = {
    "done": "✓",       # successful / resolved
    "active": "►",     # running right now
    "takeable": "»",   # frontier: Supervisor may take it
    "failed": "✗",     # adverse terminal
    "pending": "○",    # downstream, not yet takeable
}
KIND_TAG = {"decision": "D", "work": "W"}
GUTTER_GLYPH = {"decision": "◆", "work": "■", "actor": "●"}
FLAG = "⚑"             # orthogonal needs-operator condition


@dataclass
class Node:
    id: str
    label: str
    kind: str                     # decision | work | actor
    state: str                    # done | active | takeable | failed | pending
    needs_operator: bool = False
    question: str = ""            # conversational Human Gate stub (free text)
    actors: list = field(default_factory=list)   # owned Actor Graph nodes
    aedges: list = field(default_factory=list)   # owned Actor Graph edges


@dataclass
class Campaign:
    id: str
    title: str
    status: str                   # active | shipped
    nodes: list
    edges: list

    @property
    def immutable(self) -> bool:
        return self.status == "shipped"


# --------------------------------------------------------------------------
# Seed data (fixed, in-memory; no persistence).
# Public source: https://github.com/Vzlentin/calibre/issues/397
# Planning children: #398, #399, #400, #401, #402, #403, #405. Work
# children: #406-#417, merged by PRs #418-#429. The active view is a
# reconstruction; shipped is final.
# --------------------------------------------------------------------------
def _actor(id, label, state, needs_operator=False, question=""):
    return Node(id=id, label=label, kind="actor", state=state,
                needs_operator=needs_operator, question=question)


def _decision_actors(issue, discipline, state="done"):
    return ([_actor("%s-%s" % (issue, discipline), discipline, state),
             _actor("%s-resolve" % issue, "resolve", state)],
            [("%s-%s" % (issue, discipline), "%s-resolve" % issue)])


def _go_actors(prefix, state):
    stages = ("plan", "implement", "simplify", "review", "resolve", "babysit")
    actors = [_actor("%s-%s" % (prefix, stage), stage, state)
              for stage in stages]
    edges = [(actors[i].id, actors[i + 1].id)
             for i in range(len(actors) - 1)]
    return actors, edges


def _midpoint_actors(shipped=False):
    """Return #412's reconstructed graph, or its all-done final form."""
    stages = [
        _actor("412-plan", "plan", "done"),
        _actor("412-implement", "implement", "done"),
        _actor("412-simplify-structure", "simplify: structure scout", "active"),
        _actor("412-simplify-performance", "simplify: performance scout", "active"),
        _actor("412-simplify-reuse", "simplify: reuse scout", "takeable"),
        _actor("412-simplify-join", "simplify: join/apply", "pending"),
        _actor("412-review-structure", "review: structure scout", "pending"),
        _actor("412-review-performance", "review: performance scout", "pending"),
        _actor("412-review-reuse", "review: reuse scout", "pending"),
        _actor("412-review-join", "review: join/post", "pending"),
        _actor("412-resolve", "resolve", "pending"),
        _actor("412-babysit", "babysit", "pending"),
    ]
    if shipped:
        for actor in stages:
            actor.state = "done"
    edges = [
        ("412-plan", "412-implement"),
        ("412-implement", "412-simplify-structure"),
        ("412-implement", "412-simplify-performance"),
        ("412-implement", "412-simplify-reuse"),
        ("412-simplify-structure", "412-simplify-join"),
        ("412-simplify-performance", "412-simplify-join"),
        ("412-simplify-reuse", "412-simplify-join"),
        ("412-simplify-join", "412-review-structure"),
        ("412-simplify-join", "412-review-performance"),
        ("412-simplify-join", "412-review-reuse"),
        ("412-review-structure", "412-review-join"),
        ("412-review-performance", "412-review-join"),
        ("412-review-reuse", "412-review-join"),
        ("412-review-join", "412-resolve"),
        ("412-resolve", "412-babysit"),
    ]
    return stages, edges


def _decision(issue, label, discipline, state="done"):
    actors, edges = _decision_actors(issue, discipline, state)
    return Node(issue, label, "decision", state, actors=actors, aedges=edges)


def _work(issue, label, state):
    if issue == "412":
        actors, edges = _midpoint_actors(shipped=state == "done")
    else:
        actor_state = "done" if state == "done" else "pending"
        actors, edges = _go_actors(issue, actor_state)
    return Node(issue, label, "work", state, actors=actors, aedges=edges)


def _campaign_nodes(work_states, go_state):
    decisions = [
        _decision("398", "#398 ownership boundary", "grilling"),
        _decision("399", "#399 reconciliation formulations", "prototype"),
        _decision("400", "#400 parity reference", "research"),
        _decision("401", "#401 event-driver contract", "grilling"),
        _decision("403", "#403 adaptive policy boundary", "grilling"),
        _decision("402", "#402 serial sublandings", "grilling"),
        _decision("405", "#405 execution plan", "task"),
    ]
    work_specs = [
        ("406", "#406 S3-U10a runtime contracts"),
        ("407", "#407 S3-U10b split-conformal"),
        ("408", "#408 S3-U11a observe-loop core"),
        ("409", "#409 S3-U11b observe-loop cutover"),
        ("410", "#410 S3-U12a reconciliation core"),
        ("411", "#411 S3-U12b projection adapters"),
        ("412", "#412 S3-U13a weighted conformal"),
        ("413", "#413 S3-U13b sequential-adaptive"),
        ("414", "#414 S3-U13c ACI parity gate"),
        ("415", "#415 S3-U14a event driver"),
        ("416", "#416 S3-U14b driver equivalence"),
        ("417", "#417 S3-U14c VN2 dry-run"),
    ]
    works = [_work(issue, label, work_states[issue])
             for issue, label in work_specs]
    go_actors, go_edges = _decision_actors("go", "owner GO", go_state)
    final_go = Node("go", "final owner GO", "decision", go_state,
                    actors=go_actors, aedges=go_edges)
    return decisions + works + [final_go]


def _campaign_edges():
    return [
        ("398", "401"),
        ("400", "403"),
        ("398", "402"), ("399", "402"), ("400", "402"),
        ("401", "402"), ("403", "402"),
        ("402", "405"), ("405", "406"),
        ("406", "407"), ("407", "408"), ("408", "409"),
        ("409", "410"), ("410", "411"), ("411", "412"),
        ("412", "413"), ("413", "414"), ("414", "415"),
        ("415", "416"), ("416", "417"), ("417", "go"),
    ]


def build_active() -> Campaign:
    work_states = {str(issue): "done" for issue in range(406, 412)}
    work_states.update({"412": "active"})
    work_states.update({str(issue): "pending" for issue in range(413, 418)})
    return Campaign(
        "active", "Stage 3 Gate B — reconstructed midpoint", "active",
        nodes=_campaign_nodes(work_states, "pending"), edges=_campaign_edges())


def build_shipped() -> Campaign:
    work_states = {str(issue): "done" for issue in range(406, 418)}
    return Campaign(
        "shipped", "Stage 3 Gate B — final shipped", "shipped",
        nodes=_campaign_nodes(work_states, "done"), edges=_campaign_edges())


CAMPAIGNS = {"active": build_active(), "shipped": build_shipped()}


# --------------------------------------------------------------------------
# Small graph helpers.
# --------------------------------------------------------------------------
def topo_order(nodes, edges):
    idx = {n.id: i for i, n in enumerate(nodes)}
    indeg = {n.id: 0 for n in nodes}
    succ = {n.id: [] for n in nodes}
    for u, v in edges:
        indeg[v] += 1
        succ[u].append(v)
    ready = sorted([n.id for n in nodes if indeg[n.id] == 0], key=lambda i: idx[i])
    out = []
    while ready:
        u = ready.pop(0)
        out.append(u)
        for v in sorted(succ[u], key=lambda i: idx[i]):
            indeg[v] -= 1
            if indeg[v] == 0:
                ready.append(v)
        ready.sort(key=lambda i: idx[i])
    return [nodes[idx[i]] for i in out]


def depths(nodes, edges):
    dep = {n.id: 0 for n in nodes}
    pred = {}
    for u, v in edges:
        pred.setdefault(v, []).append(u)
    for n in topo_order(nodes, edges):
        for p in pred.get(n.id, []):
            dep[n.id] = max(dep[n.id], dep[p] + 1)
    return dep


def adjacency(nodes, edges):
    order = [n.id for n in topo_order(nodes, edges)]
    pos = {i: k for k, i in enumerate(order)}
    succ = {n.id: sorted([v for u, v in edges if u == n.id], key=lambda v: pos[v])
            for n in nodes}
    pred = {n.id: sorted([u for u, v in edges if v == n.id], key=lambda u: pos[u])
            for n in nodes}
    return succ, pred


def descendants(edges, root):
    succ = {}
    for u, v in edges:
        succ.setdefault(u, []).append(v)
    seen, stack = set(), list(succ.get(root, []))
    while stack:
        x = stack.pop()
        if x in seen:
            continue
        seen.add(x)
        stack.extend(succ.get(x, []))
    return seen


def node_label(n: Node) -> str:
    g = STATE_GLYPH[n.state]
    if n.kind in KIND_TAG:
        return "%s %s %s" % (g, KIND_TAG[n.kind], n.label)
    return "%s %s" % (g, n.label)


# --------------------------------------------------------------------------
# Character canvas with corner-aware line merging.
# --------------------------------------------------------------------------
U, D, L, R = 1, 2, 4, 8
BOX = {
    U | D: "│", L | R: "─", R | D: "┌", L | D: "┐", R | U: "└", L | U: "┘",
    U | D | R: "├", U | D | L: "┤", L | R | D: "┬", L | R | U: "┴",
    U | D | L | R: "┼", U: "│", D: "│", L: "─", R: "─",
    U | L | R: "┴", D | L | R: "┬", U | D | R: "├", U | D | L: "┤",
}


class Canvas:
    def __init__(self):
        self.lin = {}   # (r,c) -> direction mask
        self.txt = {}   # (r,c) -> (char, style)

    def addmask(self, r, c, m):
        if m:
            self.lin[(r, c)] = self.lin.get((r, c), 0) | m

    def hline(self, r, c1, c2):
        if c1 > c2:
            c1, c2 = c2, c1
        for c in range(c1, c2 + 1):
            m = 0
            if c > c1:
                m |= L
            if c < c2:
                m |= R
            self.addmask(r, c, m)

    def vline(self, c, r1, r2):
        if r1 > r2:
            r1, r2 = r2, r1
        for r in range(r1, r2 + 1):
            m = 0
            if r > r1:
                m |= U
            if r < r2:
                m |= D
            self.addmask(r, c, m)

    def text(self, r, c, s, style):
        for k, ch in enumerate(s):
            self.txt[(r, c + k)] = (ch, style)

    def dims(self):
        cells = list(self.lin) + list(self.txt)
        if not cells:
            return 0, 0
        return max(r for r, _ in cells) + 1, max(c for _, c in cells) + 1

    def rows(self):
        h, w = self.dims()
        out = []
        for r in range(h):
            line = []
            for c in range(w):
                if (r, c) in self.txt:
                    line.append(self.txt[(r, c)])
                elif (r, c) in self.lin:
                    line.append((BOX.get(self.lin[(r, c)], "┼"), "line"))
                else:
                    line.append((" ", None))
            out.append(line)
        return out


@dataclass
class Item:
    node: Node
    scope: str        # campaign | actor
    r: int
    c: int
    length: int


def draw_node(cvx: Canvas, items, n: Node, scope: str, r: int, c: int):
    lab = node_label(n)
    cvx.text(r, c, lab, n.state)
    if n.needs_operator:
        cvx.text(r, c + len(lab) + 1, FLAG, "flag")
        lab += " " + FLAG
    items.append(Item(n, scope, r, c, len(lab)))


def expanded_node(camp: Campaign, expand_id):
    if not expand_id:
        return None
    for n in camp.nodes:
        if n.id == expand_id and n.actors:
            return n
    return None


# --------------------------------------------------------------------------
# Variant A -- Metro/Rails: left-to-right railway.
# Columns = topological depth; lanes = rails; fan-out/joins are vertical
# buses in the gutters. Terminal expansion keeps the Campaign railway compact
# and unfolds historical Actor detail beneath it; nonterminal expansion splices
# the executable Actor Graph into the Campaign route.
# --------------------------------------------------------------------------
def layout_metro(camp: Campaign, expand_id):
    nodes, edges = camp.nodes, camp.edges
    by_id = {n.id: n for n in nodes}
    dep = depths(nodes, edges)
    order = [n.id for n in topo_order(nodes, edges)]
    succ, pred = adjacency(nodes, edges)
    exp = expanded_node(camp, expand_id)

    if exp and exp.state not in ("done", "failed"):
        return layout_metro_inline(camp, expand_id)

    def assign_lanes(graph_nodes, colof, predof, succof):
        """Lay one graph on independent rails without storing coordinates."""
        laneof, occupied = {}, set()
        bycol = {}
        for n in graph_nodes:
            bycol.setdefault(colof[n.id], []).append(n)

        def nearest(pref, c):
            for d in (0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6):
                if (c, pref + d) not in occupied:
                    return pref + d
            raise RuntimeError("lane space exhausted")

        for c in sorted(bycol):
            group = bycol[c]
            k = len(group)
            if k == 1:
                n = group[0]
                ps = [p for p in predof.get(n.id, []) if p in laneof]
                if len(ps) == 1 and len(succof.get(ps[0], [])) == 1:
                    pref = laneof[ps[0]]
                elif ps:
                    pref = round(sum(laneof[p] for p in ps) / len(ps))
                else:
                    pref = 0
                laneof[n.id] = nearest(pref, c)
                occupied.add((c, laneof[n.id]))
                continue

            prefs = []
            for n in group:
                ps = [p for p in predof.get(n.id, []) if p in laneof]
                prefs.append(sum(laneof[p] for p in ps) / len(ps) if ps else 0)
            base = round(sum(prefs) / len(prefs))
            for j, n in enumerate(group):
                laneof[n.id] = nearest(base + 2 * j - (k - 1), c)
                occupied.add((c, laneof[n.id]))
        return laneof

    campaign_col = {nid: dep[nid] for nid in order}
    campaign_pred, campaign_succ = pred, succ
    campaign_lane = assign_lanes(
        [by_id[nid] for nid in order], campaign_col,
        campaign_pred, campaign_succ)

    # Campaign columns and rows are calculated from Campaign nodes only. This
    # is also the collapsed layout, so expansion cannot move the railway.
    def label_length(n):
        length = len(node_label(n))
        return length + (2 if n.needs_operator else 0)

    campaign_colw = {}
    for nid in order:
        c = campaign_col[nid]
        campaign_colw[c] = max(campaign_colw.get(c, 0),
                               label_length(by_id[nid]))
    gap = 3
    campaign_x, x = {}, 0
    for c in sorted(campaign_colw):
        campaign_x[c] = x
        x += campaign_colw[c] + gap
    campaign_rows = sorted(set(campaign_lane.values()))
    campaign_row = {lane: i * 2 for i, lane in enumerate(campaign_rows)}

    cvx = Canvas()
    items = []

    def draw_positioned_edge(u, v, colof, laneof, xof, rowof, nodeof):
        uc, vc = colof[u], colof[v]
        ul, vl = laneof[u], laneof[v]
        r1, r2 = rowof[ul], rowof[vl]
        x1 = xof[uc] + label_length(nodeof[u])
        x2 = xof[vc]
        gx = max(x2 - 2, x1 + 1)
        cvx.hline(r1, x1 + 1, gx)
        cvx.vline(gx, r1, r2)
        if x2 - 1 > gx:
            cvx.hline(r2, gx, x2 - 1)

    # The Campaign graph is always complete and always drawn at its compact
    # coordinates. In particular, no Campaign edge is replaced by an Actor
    # edge when a compound node is expanded.
    for u, v in edges:
        draw_positioned_edge(u, v, campaign_col, campaign_lane,
                             campaign_x, campaign_row, by_id)
    for nid in order:
        draw_node(cvx, items, by_id[nid], "campaign",
                  campaign_row[campaign_lane[nid]], campaign_x[campaign_col[nid]])

    if not exp:
        items.sort(key=lambda it: (it.r, it.c))
        return cvx, items

    # Completed work reads as history: a narrow top-to-bottom graph log keeps
    # Actor fan-out and joins visible without extending the Campaign rail.
    actor_rows, actor_tracks = log_rows(exp.actors, exp.aedges)
    actor_base = max(campaign_row.values()) + 3
    parent = by_id[exp.id]
    parent_x = campaign_x[campaign_col[exp.id]]
    parent_row = campaign_row[campaign_lane[exp.id]]
    parent_center = parent_x + label_length(parent) // 2
    actor_x = parent_x + 2
    cvx.vline(parent_center, parent_row + 1, actor_base)
    cvx.hline(actor_base, min(parent_center, actor_x),
              max(parent_center, actor_x))
    draw_log_rows(cvx, items, actor_rows, actor_tracks, actor_base,
                  actor_x, "actor")

    items.sort(key=lambda it: (it.r, it.c))
    return cvx, items


def layout_metro_inline(camp: Campaign, expand_id):
    """Restore the executable inline splice for a nonterminal parent."""
    nodes, edges = camp.nodes, camp.edges
    by_id = {n.id: n for n in nodes}
    dep = depths(nodes, edges)
    order = [n.id for n in topo_order(nodes, edges)]
    succ, pred = adjacency(nodes, edges)
    exp = expanded_node(camp, expand_id)

    adep, shift, desc = {}, 0, set()
    if exp:
        adep = depths(exp.actors, exp.aedges)
        shift = max(adep.values()) + 1
        desc = descendants(edges, exp.id)

    col, lane = {}, {}
    for nid in order:
        col[nid] = dep[nid] + (shift if nid in desc else 0)
    acol, alane = {}, {}
    if exp:
        for a in exp.actors:
            acol[a.id] = dep[exp.id] + 1 + adep[a.id]

    occ = set()

    def nearest(pref, c):
        for d in (0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6):
            if (c, pref + d) not in occ:
                return pref + d
        raise RuntimeError("lane space exhausted")

    def assign_group(group, colof, laneof, base_pref):
        k = len(group)
        if k == 1:
            n = group[0]
            ps = [p for p in pred.get(n.id, []) if p in laneof]
            if len(ps) == 1 and len(succ.get(ps[0], [])) == 1:
                pref = laneof[ps[0]]
            elif ps:
                pref = round(sum(laneof[p] for p in ps) / len(ps))
            else:
                pref = base_pref
            laneof[n.id] = nearest(pref, colof[n.id])
            occ.add((colof[n.id], laneof[n.id]))
        else:
            prefs = []
            for n in group:
                ps = [p for p in pred.get(n.id, []) if p in laneof]
                prefs.append(sum(laneof[p] for p in ps) / len(ps)
                             if ps else base_pref)
            base = round(sum(prefs) / len(prefs))
            for j, n in enumerate(group):
                laneof[n.id] = nearest(base + 2 * j - (k - 1), colof[n.id])
                occ.add((colof[n.id], laneof[n.id]))

    bycol = {}
    for nid in order:
        bycol.setdefault(col[nid], []).append(by_id[nid])
    for c in sorted(bycol):
        assign_group(bycol[c], col, lane, 0)
    if exp:
        apred = {}
        for u, v in exp.aedges:
            apred.setdefault(v, []).append(u)
        abycol = {}
        for a in exp.actors:
            abycol.setdefault(acol[a.id], []).append(a)
        for c in sorted(abycol):
            k = len(abycol[c])
            if k == 1:
                a = abycol[c][0]
                ps = apred.get(a.id, [])
                if ps and len(ps) == 1:
                    pref = alane.get(ps[0], lane[exp.id])
                elif ps:
                    pref = round(sum(alane[p] for p in ps) / len(ps))
                else:
                    pref = lane[exp.id]
                alane[a.id] = nearest(pref, c)
                occ.add((c, alane[a.id]))
            else:
                base = lane[exp.id]
                ps0 = apred.get(abycol[c][0].id, [])
                if ps0:
                    base = round(sum(alane.get(p, lane[exp.id])
                                     for p in ps0) / len(ps0))
                for j, a in enumerate(abycol[c]):
                    alane[a.id] = nearest(base + 2 * j - (k - 1), c)
                    occ.add((c, alane[a.id]))

    # Column x positions from label widths.
    def lab_len(nid):
        n = by_id.get(nid)
        if n is None and exp:
            n = next((a for a in exp.actors if a.id == nid), None)
        ln = len(node_label(n))
        if n.needs_operator:
            ln += 2
        return ln

    colw = {}
    for nid, c in list(col.items()) + list(acol.items()):
        colw[c] = max(colw.get(c, 0), lab_len(nid))
    gap = 3
    xs, x = {}, 0
    for c in sorted(colw):
        xs[c] = x
        x += colw[c] + gap
    lanes_sorted = sorted(set(lane.values()) | set(alane.values()))
    rowof = {ln: i * 2 for i, ln in enumerate(lanes_sorted)}

    cvx = Canvas()
    items = []

    def draw_edge(u, v):
        uc, vc = col.get(u, acol.get(u)), col.get(v, acol.get(v))
        ul, vl = lane.get(u, alane.get(u)), lane.get(v, alane.get(v))
        r1, r2 = rowof[ul], rowof[vl]
        x1 = xs[uc] + lab_len(u)
        x2 = xs[vc]
        gx = max(x2 - 2, x1 + 1)
        cvx.hline(r1, x1 + 1, gx)
        cvx.vline(gx, r1, r2)
        if x2 - 1 > gx:
            cvx.hline(r2, gx, x2 - 1)

    for u, v in edges:
        if exp and u == exp.id:
            continue                      # replaced by actor-graph route
        draw_edge(u, v)
    if exp:
        asucc = {}
        for u, v in exp.aedges:
            asucc.setdefault(u, []).append(v)
        for a in exp.actors:
            if adep[a.id] == 0:
                draw_edge(exp.id, a.id)
            if a.id not in asucc:
                for s in succ[exp.id]:
                    draw_edge(a.id, s)
        for u, v in exp.aedges:
            draw_edge(u, v)

    for nid in order:
        draw_node(cvx, items, by_id[nid], "campaign", rowof[lane[nid]],
                  xs[col[nid]])
    if exp:
        for a in exp.actors:
            draw_node(cvx, items, a, "actor", rowof[alane[a.id]],
                      xs[acol[a.id]])
    items.sort(key=lambda it: (it.r, it.c))
    return cvx, items


# --------------------------------------------------------------------------
# Variant B -- Layered Field: top-to-bottom topological strata.
# Layers are horizontal bands; edges drop vertically (with one connector
# row) between bands. Expansion inserts the Actor Graph as extra sub-layers
# centered under the expanded node; descendants shift down.
# --------------------------------------------------------------------------
def layout_field(camp: Campaign, expand_id):
    nodes, edges = camp.nodes, camp.edges
    by_id = {n.id: n for n in nodes}
    dep = depths(nodes, edges)
    order = [n.id for n in topo_order(nodes, edges)]
    succ, pred = adjacency(nodes, edges)
    exp = expanded_node(camp, expand_id)

    adep, shift, desc = {}, 0, set()
    if exp:
        adep = depths(exp.actors, exp.aedges)
        shift = max(adep.values()) + 1
        desc = descendants(edges, exp.id)

    layer = {}
    for nid in order:
        layer[nid] = dep[nid] + (shift if nid in desc else 0)
    alayer = {}
    if exp:
        for a in exp.actors:
            alayer[a.id] = dep[exp.id] + 1 + adep[a.id]

    all_labels = [node_label(n) for n in nodes]
    if exp:
        all_labels += [node_label(a) for a in exp.actors]
    S = max(len(s) for s in all_labels) + 6

    byl = {}
    for nid in order:
        byl.setdefault(layer[nid], []).append(nid)
    maxw = max(len(v) for v in byl.values()) * S

    xs = {}
    for l, ids in byl.items():
        off = (maxw - len(ids) * S) // 2
        for j, nid in enumerate(ids):
            n = by_id[nid]
            xs[nid] = off + j * S + (S - len(node_label(n))) // 2
    if exp:
        axs = {}
        abyl = {}
        for a in exp.actors:
            abyl.setdefault(alayer[a.id], []).append(a.id)
        cxe = xs[exp.id] + len(node_label(by_id[exp.id])) // 2
        for l, ids in abyl.items():
            start = cxe - (len(ids) * S) // 2
            for j, aid in enumerate(ids):
                a = next(x for x in exp.actors if x.id == aid)
                axs[aid] = start + j * S + (S - len(node_label(a))) // 2
    else:
        axs = {}

    shiftx = -min(list(xs.values()) + list(axs.values()) + [0])
    if shiftx > 0:
        xs = {k: v + shiftx for k, v in xs.items()}
        axs = {k: v + shiftx for k, v in axs.items()}

    def xof(nid):
        return xs.get(nid, axs.get(nid))

    def cxof(nid):
        n = by_id.get(nid)
        if n is None and exp:
            n = next((a for a in exp.actors if a.id == nid), None)
        return xof(nid) + len(node_label(n)) // 2

    def layof(nid):
        return layer.get(nid, alayer.get(nid))

    nrow = lambda l: l * 2
    cvx = Canvas()
    items = []

    def draw_edge(u, v):
        r1, r2 = nrow(layof(u)), nrow(layof(v))
        cu, cv = cxof(u), cxof(v)
        if layof(v) - layof(u) == 1:
            cr = r1 + 1
            cvx.hline(cr, min(cu, cv), max(cu, cv))
            cvx.addmask(cr, cu, U)
            cvx.addmask(cr, cv, D)
        else:
            cr = r2 - 1
            cvx.vline(cu, r1 + 1, cr)
            cvx.hline(cr, min(cu, cv), max(cu, cv))
            cvx.addmask(cr, cu, U)
            cvx.addmask(cr, cv, D)

    for u, v in edges:
        if exp and u == exp.id:
            continue
        draw_edge(u, v)
    if exp:
        asucc = set(u for u, _ in exp.aedges)
        for a in exp.actors:
            if adep[a.id] == 0:
                draw_edge(exp.id, a.id)
            if a.id not in asucc:
                for s in succ[exp.id]:
                    draw_edge(a.id, s)
        for u, v in exp.aedges:
            draw_edge(u, v)

    for nid in order:
        draw_node(cvx, items, by_id[nid], "campaign", nrow(layer[nid]), xs[nid])
    if exp:
        for a in exp.actors:
            draw_node(cvx, items, a, "actor", nrow(alayer[a.id]), axs[a.id])
    items.sort(key=lambda it: (it.r, it.c))
    return cvx, items


# --------------------------------------------------------------------------
# Variant C -- Graph Log: narrow top-to-bottom 'git log --graph'.
# Every node is one row; dependency rails live in a gutter so branches and
# joins stay real graph structure. Expansion renders the Actor Graph as a
# nested graph log indented under the node, main rails kept intact.
# --------------------------------------------------------------------------
@dataclass
class LogRow:
    node: Node
    track: int
    merges: list
    branches: list
    before: set
    after: set


def log_rows(nodes, edges):
    order = topo_order(nodes, edges)
    pos = {n.id: i for i, n in enumerate(order)}
    succ = {n.id: sorted([v for u, v in edges if u == n.id], key=lambda v: pos[v])
            for n in order}
    pred = {n.id: sorted([u for u, v in edges if v == n.id], key=lambda u: pos[u])
            for n in order}
    active = {}
    child_tr = {}
    rows = []
    maxtr = 1
    for n in order:
        before = set(active)
        pts = [child_tr[(p, n.id)] for p in pred[n.id]]
        if pts:
            t = min(pts)
        else:
            t = 0
            while t in active:
                t += 1
        merges = sorted(x for x in pts if x != t)
        for mt in merges:
            active.pop(mt, None)
        active.pop(t, None)
        branches = []
        ss = succ[n.id]
        if ss:
            active[t] = n.id
            child_tr[(n.id, ss[0])] = t
            for s in ss[1:]:
                nt = 0
                while nt in active:
                    nt += 1
                active[nt] = n.id
                child_tr[(n.id, s)] = nt
                branches.append(nt)
        after = set(active)
        maxtr = max(maxtr, t + 1, (max(after) + 1) if after else 1)
        rows.append(LogRow(n, t, merges, branches, before, after))
    return rows, maxtr


def draw_log_rows(cvx, items, rows, maxtr, r0, c0, scope):
    """Render graph-log rows at offset (r0, c0). Returns next free row."""
    r = r0
    for row in rows:
        through = row.after & row.before
        for t in through:
            cvx.addmask(r, c0 + t * 2, U | D)
        for mt in row.merges:
            cvx.hline(r, c0 + row.track * 2, c0 + mt * 2)
            cvx.addmask(r, c0 + mt * 2, U)
        for nt in row.branches:
            cvx.hline(r, c0 + row.track * 2, c0 + nt * 2)
            cvx.addmask(r, c0 + nt * 2, D)
        cvx.text(r, c0 + row.track * 2, GUTTER_GLYPH[row.node.kind], row.node.state)
        lab = node_label(row.node)
        lc = c0 + maxtr * 2 + 1
        cvx.text(r, lc, lab, row.node.state)
        if row.node.needs_operator:
            cvx.text(r, lc + len(lab) + 1, FLAG, "flag")
            lab += " " + FLAG
        items.append(Item(row.node, scope, r, c0 + row.track * 2,
                          (lc - (c0 + row.track * 2)) + len(lab)))
        r += 1
    return r


def layout_log(camp: Campaign, expand_id):
    rows, maxtr = log_rows(camp.nodes, camp.edges)
    exp = expanded_node(camp, expand_id)
    cvx = Canvas()
    items = []
    gutter = maxtr * 2
    r = 0
    for row in rows:
        r = draw_log_rows(cvx, items, [row], maxtr, r, 0, "campaign")
        if exp and row.node.id == exp.id:
            sub_rows, sub_maxtr = log_rows(exp.actors, exp.aedges)
            base = r
            n_sub = len(sub_rows)
            for t in row.after:
                for k in range(n_sub):
                    cvx.addmask(base + k, t * 2, U | D)
            for k in range(n_sub):
                cvx.text(base + k, gutter + 1, "↳", "line")
            r = draw_log_rows(cvx, items, sub_rows, sub_maxtr, base,
                              gutter + 3, "actor")
    items.sort(key=lambda it: (it.r, it.c))
    return cvx, items


LAYOUTS = {"A": layout_metro, "B": layout_field, "C": layout_log}
VARIANT_NAMES = {"A": "Metro/Rails", "B": "Layered Field", "C": "Graph Log"}

FOOTER = ("1·2·3 variant  c campaign  ←→↑↓/Tab move  "
          "Enter expand·focus  n next ⚑  ? help  q quit")

HELP = [
    "keys",
    "  1/2/3   variant A metro · B field · C log",
    "  c       switch active / shipped Campaign",
    "  arrows  move selection (Tab = next node)",
    "  Enter   expand/collapse Decision or Work Item;",
    "          on an Actor Node: stub 'would focus Herdr pane'",
    "  n       jump to next ⚑ needs-operator node",
    "  ?       this help    q quit",
    "",
    "glyphs (state is glyph-first; color only reinforces)",
    "  ✓ done/resolved   ► active   » takeable",
    "  ✗ adverse terminal   ○ pending   ⚑ needs operator",
    "  ◆ Decision   ■ Work Item   ● Actor (log gutter)",
    "",
    "Only one compound node is expanded at a time.",
    "Oversized graphs scroll with the selected node; < > ^ v mark overflow.",
    "Shipped Campaigns are immutable: focus/launch are disabled.",
]


def title_line(camp: Campaign, variant: str) -> str:
    if camp.immutable:
        tag = "actual final topology · immutable/read-only"
    else:
        tag = "reconstructed midpoint · supervisor draining frontier"
    return "Campaign: %s  [%s · %s]   variant %s %s" % (
        camp.title, camp.status, tag, variant, VARIANT_NAMES[variant])


def default_focus(camp: Campaign) -> str:
    """Choose the node that best answers where the Campaign needs attention."""
    for condition in (
        lambda node: node.needs_operator,
        lambda node: node.state == "active",
        lambda node: node.state == "takeable",
    ):
        match = next((node for node in camp.nodes if condition(node)), None)
        if match:
            return match.id
    return camp.nodes[-1].id


# --------------------------------------------------------------------------
# Bounded viewport shared by snapshot and interactive rendering.
# --------------------------------------------------------------------------
def _clamp(value, low, high):
    return max(low, min(value, high))


def _focus_item(items, focus_id):
    if focus_id:
        for item in items:
            if item.node.id == focus_id:
                return item
    return items[0] if items else None


def bounded_view(cvx, items, focus_id, view_w, view_h):
    """Return visible rows and offsets, keeping the focused item in view."""
    rows = cvx.rows()
    graph_h, graph_w = cvx.dims()
    if not rows:
        return [], 0, 0
    view_w = max(1, min(view_w, graph_w))
    view_h = max(1, min(view_h, graph_h))
    focus = _focus_item(items, focus_id)
    if focus is None:
        target_c, target_r = graph_w // 2, graph_h // 2
    else:
        target_c = focus.c + max(0, focus.length - 1) // 2
        target_r = focus.r
    x0 = _clamp(target_c - view_w // 2, 0, graph_w - view_w)
    y0 = _clamp(target_r - view_h // 2, 0, graph_h - view_h)

    visible = []
    for row in rows[y0:y0 + view_h]:
        cells = row[x0:x0 + view_w]
        if x0 > 0:
            cells[0] = ("<", "overflow")
        if x0 + view_w < graph_w:
            cells[-1] = (">", "overflow")
        visible.append(cells)
    if y0 > 0 and visible:
        marker_col = 1 if view_w > 2 else 0
        visible[0][marker_col] = ("^", "overflow")
    if y0 + view_h < graph_h and visible:
        marker_col = 1 if view_w > 2 else 0
        visible[-1][marker_col] = ("v", "overflow")
    return visible, x0, y0


def _fit(text, width):
    return text if not width else text[:max(0, width)]


def _mark_selection(cvx, items, select):
    for item in items:
        if item.node.id == select:
            cvx.text(item.r, item.c + item.length + 1, "◀", "flag")
            return


# --------------------------------------------------------------------------
# Snapshot mode: deterministic plain-text render of the same layout.
# --------------------------------------------------------------------------
def snapshot(variant, camp_id, expand=None, select=None, width=0, height=0):
    camp = CAMPAIGNS[camp_id]
    cvx, items = LAYOUTS[variant](camp, expand)
    _mark_selection(cvx, items, select)
    _, graph_w = cvx.dims()
    graph_h, _ = cvx.dims()
    focus_id = (select if any(it.node.id == select for it in items)
                else default_focus(camp))
    view_w = width or graph_w
    view_h = max(1, height - 2) if height else graph_h
    rows, _, _ = bounded_view(cvx, items, focus_id, view_w, view_h)
    print(_fit(title_line(camp, variant), width))
    for row in rows:
        print("".join(ch for ch, _ in row).rstrip())
    print(_fit(FOOTER, width))


# --------------------------------------------------------------------------
# Interactive curses TUI.
# --------------------------------------------------------------------------
def make_styles():
    styles = {"line": 0, "title": curses.A_BOLD, "footer": curses.A_DIM,
              "msg": curses.A_BOLD, "flag": curses.A_BOLD}
    if curses.has_colors():
        curses.start_color()
        try:
            curses.use_default_colors()
            bg = -1
        except curses.error:
            bg = curses.COLOR_BLACK
        pairs = {"done": curses.COLOR_GREEN, "active": curses.COLOR_CYAN,
                 "takeable": curses.COLOR_YELLOW, "failed": curses.COLOR_RED,
                 "pending": curses.COLOR_WHITE, "flag": curses.COLOR_MAGENTA,
                 "line": curses.COLOR_BLUE, "msg": curses.COLOR_YELLOW}
        for i, (name, fg) in enumerate(pairs.items(), start=1):
            curses.init_pair(i, fg, bg)
            styles[name] = curses.color_pair(i) | styles.get(name, 0)
    return styles


def tui(stdscr):
    locale.setlocale(locale.LC_ALL, "")
    curses.curs_set(0)
    stdscr.keypad(True)
    styles = make_styles()

    variant, camp_id = "A", "active"
    expanded = None
    selected_id = default_focus(CAMPAIGNS[camp_id])
    message, help_on = None, False
    sel = 0

    while True:
        camp = CAMPAIGNS[camp_id]
        cvx, items = LAYOUTS[variant](camp, expanded)
        ids = [it.node.id for it in items]
        if selected_id in ids:
            sel = ids.index(selected_id)
        else:
            sel = min(sel, len(items) - 1)
            selected_id = items[sel].node.id

        stdscr.erase()
        maxy, maxx = stdscr.getmaxyx()
        if maxy < 3 or maxx < 1:
            stdscr.refresh()
            ch = stdscr.getch()
            if ch in (ord("q"), 27):
                return
            continue

        sel_item = items[sel]
        rows, x0, y0 = bounded_view(cvx, items, sel_item.node.id,
                                    maxx, maxy - 2)
        stdscr.addnstr(0, 0, title_line(camp, variant), maxx - 1,
                       styles["title"])
        for r, row in enumerate(rows):
            for c, (ch, style) in enumerate(row):
                attr = styles.get(style or "", 0)
                global_r, global_c = y0 + r, x0 + c
                if (sel_item.r == global_r and sel_item.c <= global_c
                        and global_c < sel_item.c + sel_item.length
                        and style not in ("line", "overflow")):
                    attr |= curses.A_REVERSE
                try:
                    stdscr.addstr(r + 1, c, ch, attr)
                except curses.error:
                    pass
        foot = message if message else FOOTER
        stdscr.addnstr(maxy - 1, 0, foot, maxx - 1,
                       styles["msg"] if message else styles["footer"])
        if help_on:
            hh = len(HELP) + 2
            hw = max(len(s) for s in HELP) + 4
            y0, x0 = max(0, (maxy - hh) // 2), max(0, (maxx - hw) // 2)
            for y in range(y0, min(y0 + hh, maxy - 1)):
                try:
                    stdscr.addstr(y, x0, " " * min(hw, maxx - x0 - 1),
                                  curses.A_REVERSE)
                except curses.error:
                    pass
            for k, s in enumerate(HELP):
                if y0 + 1 + k < maxy - 1:
                    stdscr.addnstr(y0 + 1 + k, x0 + 2, s, hw - 4,
                                   curses.A_REVERSE)
        stdscr.refresh()
        message = None

        ch = stdscr.getch()
        if help_on:
            help_on = False
            continue
        if ch in (ord("q"), 27):
            return
        elif ch == ord("?"):
            help_on = True
        elif ch in (ord("1"), ord("2"), ord("3")):
            variant = "ABC"[ch - ord("1")]
        elif ch == ord("c"):
            camp_id = "shipped" if camp_id == "active" else "active"
            expanded = None
            selected_id = default_focus(CAMPAIGNS[camp_id])
            sel = 0
        elif ch == curses.KEY_UP:
            sel = move_sel(items, sel, -1, 0)
        elif ch == curses.KEY_DOWN:
            sel = move_sel(items, sel, 1, 0)
        elif ch == curses.KEY_LEFT:
            sel = move_sel(items, sel, 0, -1)
        elif ch == curses.KEY_RIGHT:
            sel = move_sel(items, sel, 0, 1)
        elif ch == ord("\t"):
            sel = (sel + 1) % len(items)
        elif ch == ord("n"):
            flagged = [i for i, it in enumerate(items) if it.node.needs_operator]
            if flagged:
                nxt = next((i for i in flagged if i > sel), flagged[0])
                sel = nxt
                it = items[sel]
                if it.node.question:
                    message = "⚑ %s: “%s”" % (it.node.label, it.node.question)
            else:
                message = "no node needs the operator"
        elif ch in (curses.KEY_ENTER, 10, 13):
            it = items[sel]
            n = it.node
            if it.scope == "campaign" and n.actors:
                expanded = None if expanded == n.id else n.id
            elif it.scope == "actor":
                if camp.immutable:
                    message = "read-only: shipped Campaign is immutable — focus disabled"
                elif n.needs_operator and n.question:
                    message = ("⚑ %s: “%s” — would focus Herdr pane (stub)"
                               % (n.label, n.question))
                else:
                    message = "would focus Herdr pane: %s (stub)" % n.label
            else:
                message = "nothing to expand here"
        selected_id = items[sel].node.id if items else selected_id


def move_sel(items, cur, dr, dc):
    it = items[cur]
    best, best_key = cur, None
    for j, o in enumerate(items):
        if j == cur:
            continue
        drr, dcc = o.r - it.r, o.c - it.c
        if dr < 0 and drr >= 0:
            continue
        if dr > 0 and drr <= 0:
            continue
        if dc < 0 and dcc >= 0:
            continue
        if dc > 0 and dcc <= 0:
            continue
        key = (abs(drr) + abs(dcc), abs(dcc) if dr else abs(drr))
        if best_key is None or key < best_key:
            best, best_key = j, key
    return best


# --------------------------------------------------------------------------
def main(argv=None):
    p = argparse.ArgumentParser(description="throwaway prototype: Campaign "
                                    "graph control-room TUI (issue #9)")
    p.add_argument("--snapshot", choices=["A", "B", "C"],
                   help="print a deterministic text snapshot and exit")
    p.add_argument("--campaign", choices=["active", "shipped"], default="active")
    p.add_argument("--expand", help="node id to render expanded")
    p.add_argument("--select", help="node id to mark as selected")
    p.add_argument("--width", type=int, default=0)
    p.add_argument("--height", type=int, default=0)
    args = p.parse_args(argv)
    if args.snapshot:
        snapshot(args.snapshot, args.campaign, expand=args.expand,
                 select=args.select, width=args.width, height=args.height)
        return 0
    curses.wrapper(tui)
    return 0


if __name__ == "__main__":
    sys.exit(main())
