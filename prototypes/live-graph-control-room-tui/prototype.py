#!/usr/bin/env python3
"""PROTOTYPE -- THROWAWAY. Do not productionize, do not tidy into the repo proper.

Prototype question (GitHub issue #9):
    What is the smallest Herdr-hosted running-Campaign TUI that makes
    progress, parallelism, graph decisions, and operator-needed work
    immediately legible while keeping details behind expansion?

Usage:
    python3 prototype.py                        # interactive curses TUI
    python3 prototype.py --snapshot A --campaign active --width 120 --height 36
    python3 prototype.py --snapshot B --campaign active --expand w1
    python3 prototype.py --snapshot C --campaign shipped

Behavior:
    Renders two seed Campaigns (one active, one shipped/immutable) as a single
    hierarchical Work Graph. Campaign-level Decisions and Work Items are
    compound nodes; Enter expands exactly one of them inline to reveal the
    Actor Graph it owns (logical /go stages for Work Items, a Wayfinder
    discipline for Decisions). Plans, Attempts, costs, logs, and metrics are
    deliberately absent. Three layout variants share the same data and state,
    each with its own layout algorithm and reading direction:

      A -- Metro/Rails:   wide left-to-right dependency railway; chains share
                          rails, fan-out/joins are vertical track buses.
      B -- Layered Field: top-to-bottom topological strata; edges are
                          vertical/diagonal links between layers.
      C -- Graph Log:     narrow top-to-bottom 'git log --graph' style with
                          dependency rails in the gutter.

    All layout is derived from nodes/edges at render time (no stored x/y).
    State is encoded glyph-first (non-color-only); color only reinforces.

    Interactive controls: 1/2/3 variant, c campaign, arrows/Tab move,
    Enter expand/collapse or focus-stub an actor, n next needs-operator node,
    ? help/legend, q quit. Snapshot mode prints the same layout deterministically
    for review.
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
# --------------------------------------------------------------------------
def _actor(id, label, state, needs_operator=False, question=""):
    return Node(id=id, label=label, kind="actor", state=state,
                needs_operator=needs_operator, question=question)


def build_active() -> Campaign:
    d1 = Node("d1", "pick layout", "decision", "done",
              actors=[_actor("d1a1", "research", "done"),
                      _actor("d1a2", "prototype", "done"),
                      _actor("d1a3", "decide", "done")],
              aedges=[("d1a1", "d1a2"), ("d1a2", "d1a3")])
    w1 = Node("w1", "tui variants", "work", "active",
              actors=[_actor("w1a0", "scout", "done"),
                      _actor("w1a1", "scout:ui", "done"),
                      _actor("w1a2", "scout:grid", "done"),
                      _actor("w1a3", "plan", "done"),
                      _actor("w1a4", "implement", "active")],
              aedges=[("w1a0", "w1a1"), ("w1a0", "w1a2"),
                      ("w1a1", "w1a3"), ("w1a2", "w1a3"),
                      ("w1a3", "w1a4")])
    w2 = Node("w2", "snapshot harness", "work", "active",
              actors=[_actor("w2a1", "plan", "done"),
                      _actor("w2a2", "implement", "active")],
              aedges=[("w2a1", "w2a2")])
    d2 = Node("d2", "expansion model", "decision", "active",
              needs_operator=True,
              question="Should expansion nest inside the parent rail, or replace it?",
              actors=[_actor("d2a1", "grill:1", "failed"),
                      _actor("d2a2", "grill:2", "active", needs_operator=True,
                             question="One more grilling round on nest-vs-replace, or decide now?"),
                      _actor("d2a3", "decide", "pending")],
              aedges=[("d2a1", "d2a2"), ("d2a2", "d2a3")])
    w3 = Node("w3", "keyboard polish", "work", "takeable",
              actors=[_actor("w3a1", "plan", "pending"),
                      _actor("w3a2", "implement", "pending")],
              aedges=[("w3a1", "w3a2")])
    w4 = Node("w4", "publish", "work", "pending",
              actors=[_actor("w4a1", "implement", "pending"),
                      _actor("w4a2", "review", "pending")],
              aedges=[("w4a1", "w4a2")])
    return Campaign("active", "live graph control room", "active",
                    nodes=[d1, w1, w2, d2, w3, w4],
                    edges=[("d1", "w1"), ("d1", "w2"), ("d1", "d2"),
                           ("w1", "w3"), ("w2", "w3"),
                           ("w3", "w4"), ("d2", "w4")])


def build_shipped() -> Campaign:
    d1 = Node("d1", "queue order", "decision", "done",
              actors=[_actor("d1a1", "research", "done"),
                      _actor("d1a2", "decide", "done")],
              aedges=[("d1a1", "d1a2")])
    w1 = Node("w1", "drain loop", "work", "done",
              actors=[_actor("w1a1", "plan", "done"),
                      _actor("w1a2", "implement", "done"),
                      _actor("w1a3", "review", "done")],
              aedges=[("w1a1", "w1a2"), ("w1a2", "w1a3")])
    w2 = Node("w2", "sub-issues", "work", "done",
              actors=[_actor("w2a1", "plan", "done"),
                      _actor("w2a2", "implement", "done")],
              aedges=[("w2a1", "w2a2")])
    w3 = Node("w3", "docs link", "work", "done",
              actors=[_actor("w3a1", "implement", "done"),
                      _actor("w3a2", "review", "done")],
              aedges=[("w3a1", "w3a2")])
    return Campaign("shipped", "campaign queue drain", "shipped",
                    nodes=[d1, w1, w2, w3],
                    edges=[("d1", "w1"), ("d1", "w2"),
                           ("w1", "w3"), ("w2", "w3")])


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
# buses in the gutters. Expansion stretches the node into its Actor Graph
# in place: descendants shift right, actor layers take the freed columns.
# --------------------------------------------------------------------------
def layout_metro(camp: Campaign, expand_id):
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
                prefs.append(sum(laneof[p] for p in ps) / len(ps) if ps else base_pref)
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
                    base = round(sum(alane.get(p, lane[exp.id]) for p in ps0) / len(ps0))
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
    GAP = 3
    xs, x = {}, 0
    for c in sorted(colw):
        xs[c] = x
        x += colw[c] + GAP
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
        draw_node(cvx, items, by_id[nid], "campaign", rowof[lane[nid]], xs[col[nid]])
    if exp:
        for a in exp.actors:
            draw_node(cvx, items, a, "actor", rowof[alane[a.id]], xs[acol[a.id]])
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
    "Shipped Campaigns are immutable: focus/launch are disabled.",
]


def title_line(camp: Campaign, variant: str) -> str:
    tag = "immutable — read-only" if camp.immutable else "supervisor draining frontier"
    return "Campaign: %s  [%s · %s]   variant %s %s" % (
        camp.title, camp.status, tag, variant, VARIANT_NAMES[variant])


# --------------------------------------------------------------------------
# Snapshot mode: deterministic plain-text render of the same layout.
# --------------------------------------------------------------------------
def snapshot(variant, camp_id, expand=None, select=None, width=0, height=0):
    camp = CAMPAIGNS[camp_id]
    cvx, items = LAYOUTS[variant](camp, expand)
    if select:
        for it in items:
            if it.node.id == select:
                cvx.text(it.r, it.c + it.length + 1, "◀", "flag")
    h, w = cvx.dims()
    if (width and w > width) or (height and h + 2 > height):
        sys.stderr.write("warning: layout %dx%d exceeds %dx%d; printing full\n"
                         % (w, h + 2, width, height))
    print(title_line(camp, variant))
    for row in cvx.rows():
        print("".join(ch for ch, _ in row).rstrip())
    print(FOOTER)


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
    expanded, selected_id, message, help_on = None, None, None, False
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
        gh, gw = cvx.dims()
        need_h, need_w = gh + 2, gw
        if maxy < need_h or maxx < need_w:
            note = "too small: need %dx%d, have %dx%d — resize or q" % (
                need_w, need_h, maxx, maxy)
            try:
                stdscr.addnstr(maxy // 2, max(0, (maxx - len(note)) // 2),
                               note, maxx - 1, styles["msg"])
            except curses.error:
                pass
            stdscr.refresh()
            ch = stdscr.getch()
            if ch in (ord("q"), 27):
                return
            if ch == curses.KEY_RESIZE:
                continue
            continue

        stdscr.addnstr(0, 0, title_line(camp, variant), maxx - 1, styles["title"])
        sel_item = items[sel]
        for r, row in enumerate(cvx.rows()):
            c = 0
            while c < len(row):
                ch, style = row[c]
                attr = styles.get(style or "", 0)
                if (sel_item.r == r + 1 and sel_item.c <= c
                        and c < sel_item.c + sel_item.length and style != "line"):
                    attr |= curses.A_REVERSE
                try:
                    stdscr.addstr(r + 1, c, ch, attr)
                except curses.error:
                    pass
                c += 1
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
    p = argparse.ArgumentParser(description="throwaway prototype: live graph "
                                    "control room TUI (issue #9)")
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
