/* PROTOTYPE — THROWAWAY. Shared state, interactions, and partial renderers.
   All mutations are in-memory stubs; every mutation surfaces visibly (state chips,
   timeline entries, toasts). No persistence, no backend, no tests. */

'use strict';

/* ---------------- state ---------------- */

const state = {
  workspace: 'campaign',          // campaign | attention | improvement | catalog | create | terminal
  focusLevel: 'work',             // work | actor  (Work Graph vs selected Work Item's Actor Graph)
  focusWI: 'WI-3',                // which work item's Actor Graph is in focus
  selActor: 'AC-2',               // selected actor node (opens Attempts in inspector)
  selAttempt: 'AT-303',           // selected attempt
  selWI: 'WI-3',                  // selected work item (work-level inspector)
  inspectorTab: 'attempt',
  diagnosticOpen: false,
  revisionReviewOpen: false,
  commandSheet: null,             // {kind:'retry'|'cancel'|'admission', ...}
  graph: { search: '', filter: 'all', collapseSatisfied: false, focusMode: 'none' }, // focusMode: none|active|attention
  selAttention: 'N-1',
  terminalId: 'C-1039',
  successorPrefill: null,
  toasts: [],
  campaign: DB.campaigns[0],      // sole active campaign — opened directly
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  state.toasts.push({ msg, id: Date.now() + Math.random() });
  render();
  setTimeout(() => { state.toasts.shift(); render(); }, 3800);
}
function logActivity(kind, text, scope) {
  DB.activity.unshift({ t: 'now', kind, scope: scope || ['C-1042'], text });
}
function wi(id) { return DB.workItems.find(w => w.id === id); }
function actor(id) { return DB.actors.find(a => a.id === id); }
function attempt(id) { return DB.attempts.find(a => a.id === id); }
function attn(id) { return DB.attention.find(a => a.id === id); }
function openAttention() { return DB.attention.filter(a => !a.resolved); }

const BADGES = {
  gate: ['⛔', 'Human Gate'], warn: ['⚠', 'warning'], msg: ['✉', 'operator messages'],
  intervention: ['✋', 'intervention needed'], evidence: ['📎', 'evidence'],
  improvement: ['⬆', 'Improvement candidate'],
};
function badgeHtml(b) {
  const [glyph, label] = BADGES[b] || ['•', b];
  return `<span class="badge" title="${label}">${glyph}</span>`;
}

/* ---------------- shared partials ---------------- */

function globalNav() {
  const n = openAttention().length;
  const item = (key, label, extra='') =>
    `<button class="nav-button ${state.workspace === key ? 'active' : ''}" data-action="workspace" data-ws="${key}">${label}${extra}</button>`;
  return `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">◆</span> Wayfinder <span class="proto-chip">PROTOTYPE</span></div>
    <nav class="global-nav">
      ${item('campaign', 'Campaigns')}
      ${item('attention', 'Needs attention', `<span class="count">${n}</span>`)}
      ${item('improvement', 'Improvement')}
    </nav>
    <div class="top-spacer"></div>
    <span class="daemon">● campaign daemon: ok</span>
  </header>`;
}

function lifecycleStrip(c) {
  const states = ['draft', 'admitted', 'running', 'completed'];
  const cur = c.state;
  return `<div class="lifecycle" title="Campaign lifecycle">
    ${states.map(s => `<span class="lc-step ${s === cur ? 'cur' : ''} ${c.lifecyclePath && c.lifecyclePath.includes(s) && s !== cur ? 'done' : ''}">${s}</span>`).join('<span class="lc-arrow">→</span>')}
    <button class="mini" data-action="diagnostic" title="Open lifecycle diagnostic view">diagnostic</button>
  </div>`;
}

function controlBar(c) {
  return `<div class="control-bar">
    <span class="ctl-label">Admission Mode</span>
    <button class="mini ${c.admission === 'auto' ? 'on' : ''}" data-action="admission" data-mode="auto">auto</button>
    <button class="mini ${c.admission === 'supervised' ? 'on' : ''}" data-action="admission" data-mode="supervised">supervised</button>
    <span class="ctl-sep"></span>
    <button class="mini warn" data-action="command" data-cmd="retry">↻ Re-arm WI-4 retries</button>
    <button class="mini danger" data-action="command" data-cmd="cancel">✕ Cancel Campaign</button>
    <span class="ctl-sep"></span>
    <span class="pulse" title="activity">▮▮▮▯▯ live</span>
    <span class="ctl-sep"></span>
    <button class="mini" data-action="revision-review">Revision review <b>r${DB.revisions.candidate.n}</b> (candidate)</button>
  </div>`;
}

function breadcrumbs() {
  const c = state.campaign;
  const parts = [
    `<button class="crumb" data-action="crumb" data-level="campaign">${c.id} ${esc(c.name)}</button>`,
  ];
  if (state.focusLevel === 'actor') {
    parts.push(`<button class="crumb" data-action="crumb" data-level="wi">${state.focusWI} ${esc(wi(state.focusWI).name)}</button>`);
    if (state.selActor) parts.push(`<button class="crumb" data-action="crumb" data-level="actor">${state.selActor} ${actor(state.selActor).role}</button>`);
    if (state.selAttempt) parts.push(`<span class="crumb cur">Attempt ${attempt(state.selAttempt).n}</span>`);
  }
  return `<div class="breadcrumbs">${parts.join('<span class="crumb-sep">›</span>')}</div>`;
}

/* --- graph (HTML nodes over SVG edges, stable left-to-right DAG) --- */

function graphToolbar() {
  const g = state.graph;
  return `<form class="graph-toolbar" data-form="graph-search">
    <input name="q" placeholder="Search nodes…" value="${esc(g.search)}">
    <select name="filter">
      ${['all', 'intervention', 'condition-unmet', 'project:Q3-reliability', 'revision-r13'].map(f =>
        `<option ${g.filter === f ? 'selected' : ''}>${f}</option>`).join('')}
    </select>
    <button class="mini" type="submit">apply</button>
    <label class="mini-toggle"><input type="checkbox" data-action-change="collapse" ${g.collapseSatisfied ? 'checked' : ''}> collapse satisfied branches</label>
    <button type="button" class="mini ${g.focusMode === 'active' ? 'on' : ''}" data-action="focus-mode" data-mode="active">Focus: active path</button>
    <button type="button" class="mini ${g.focusMode === 'attention' ? 'on' : ''}" data-action="focus-mode" data-mode="attention">Focus: attention</button>
  </form>`;
}

function nodeVisible(n) {
  const g = state.graph;
  if (g.collapseSatisfied && n.outcome === 'satisfied') return false;
  if (g.search && !(n.id + ' ' + (n.name || n.role)).toLowerCase().includes(g.search.toLowerCase())) return false;
  if (g.filter === 'intervention' && !n.attention && !(n.badges || []).length) return false;
  return true;
}
function nodeClass(n) {
  const g = state.graph;
  const cls = ['gnode'];
  if (g.focusMode === 'active') {
    const activePath = ['WI-3', 'WI-5', 'WI-6', 'AC-1', 'AC-2', 'AC-3'];
    if (!activePath.includes(n.id)) cls.push('dim');
  }
  if (g.focusMode === 'attention') cls.push(n.attention ? 'ring' : 'dim');
  if (n.attention) cls.push('attn');
  return cls.join(' ');
}

function graphCanvas() {
  const isWork = state.focusLevel === 'work';
  const nodes = isWork ? DB.workItems : DB.actors;
  const edges = isWork ? DB.workEdges : DB.actorEdges;
  const vis = nodes.filter(nodeVisible);
  const hidden = nodes.filter(n => !nodeVisible(n));
  const W = 240, H = 150, NW = 210;
  const pos = id => { const n = nodes.find(x => x.id === id); return n ? { x: n.x * W + 20, y: n.y * H + 24 } : null; };
  const edgeSvg = edges.map(([a, b]) => {
    if (!vis.find(n => n.id === a) || !vis.find(n => n.id === b)) return '';
    const pa = pos(a), pb = pos(b);
    const x1 = pa.x + NW, y1 = pa.y + 46, x2 = pb.x, y2 = pb.y + 46;
    const sel = (state.selWI === a || state.selWI === b) && isWork;
    return `<path d="M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}" class="edge ${sel ? 'sel' : ''}"/>
      <circle cx="${x2 - 4}" cy="${y2}" r="3" class="edge-dot"/>`;
  }).join('');
  const nodeHtml = vis.map(n => {
    const p = pos(n.id);
    const selected = isWork ? state.selWI === n.id : state.selActor === n.id;
    let body;
    if (isWork) {
      const hiddenPreds = state.graph.collapseSatisfied
        ? DB.workEdges.filter(([a, b]) => b === n.id && !vis.find(v => v.id === a)).length : 0;
      body = `
        <div class="gn-title">${n.id} · ${esc(n.name)}</div>
        <div class="gn-row"><span class="chip ${n.outcome === 'satisfied' ? 'ok' : n.control}">${n.outcome || n.control}</span>
          ${n.activeAttempts ? `<span class="chip run">${n.activeAttempts} active attempt</span>` : ''}</div>
        <div class="gn-cond" title="Readiness / Progress Condition">${esc(n.condition)}</div>
        <div class="gn-badges">${(n.badges || []).map(badgeHtml).join('')}
          ${hiddenPreds ? `<span class="badge" title="hidden satisfied predecessors">+${hiddenPreds} pred</span>` : ''}
          ${n.issue ? `<span class="badge issue" title="Issue Backing Mode: required">${n.issue}</span>` : ''}</div>`;
    } else {
      body = `
        <div class="gn-title">${n.id} · ${esc(n.role)}</div>
        <div class="gn-cond" title="projected condition">${esc(n.projected)}</div>
        <div class="gn-row"><span class="chip ${n.attempt.outcome}">Attempt ${n.attempt.n} · ${n.attempt.outcome}</span>
          ${n.ctx != null ? `<span class="chip ctx" title="live context usage">${n.ctx}% ctx</span>` : ''}</div>
        <div class="gn-badges">${(n.badges || []).map(badgeHtml).join('')}</div>`;
    }
    return `<div class="${nodeClass(n)} ${selected ? 'selected' : ''}" style="left:${p.x}px;top:${p.y}px;width:${NW}px"
      data-action="${isWork ? 'sel-wi' : 'sel-actor'}" data-id="${n.id}" title="click to ${isWork ? 'select / double-click opens its Actor Graph' : 'open Attempts in inspector'}">${body}</div>`;
  }).join('');
  const hiddenNote = hidden.length
    ? `<div class="hidden-note">${hidden.length} node(s) hidden by filter/collapse — predecessor/successor counts preserved on visible nodes</div>` : '';
  return `
    ${graphToolbar()}
    <div class="graph-wrap">
      <svg class="edges">${edgeSvg}</svg>
      ${nodeHtml}
      <div class="minimap" title="minimap (static in prototype)">
        ${nodes.map(n => `<span class="mm-dot ${n.attention ? 'attn' : ''} ${nodeVisible(n) ? '' : 'off'}" style="left:${n.x * 18 + 4}px;top:${n.y * 12 + 4}px"></span>`).join('')}
      </div>
      ${hiddenNote}
    </div>
    <div class="graph-hint">${isWork
      ? 'Work Graph — Revision r' + DB.revisions.current + ' (current). Double-click a Work Item to replace this canvas with its Actor Graph — no nested mega-graph.'
      : 'Actor Graph of ' + state.focusWI + ' — Revision r' + DB.revisions.current + '. Click an Actor Node to open its Attempts in the inspector.'}</div>`;
}

/* --- inspector --- */

function inspector() {
  if (state.focusLevel === 'actor' && state.selAttempt) return attemptInspector(attempt(state.selAttempt));
  if (state.focusLevel === 'actor' && state.selActor) return actorInspector(actor(state.selActor));
  return wiInspector(wi(state.selWI));
}

function wiInspector(w) {
  return `<div class="insp">
    <h3>${w.id} · ${esc(w.name)}</h3>
    <div class="kv"><span>Control State</span><b class="chip ${w.control}">${w.control}</b></div>
    ${w.outcome ? `<div class="kv"><span>Outcome</span><b class="chip ok">${w.outcome}</b></div>` : ''}
    <div class="kv"><span>Progress Condition</span>${esc(w.condition)}</div>
    <div class="kv"><span>Issue link</span>${w.issue} <span class="muted">(Issue Backing Mode: required — link provisioned before r12 activation)</span></div>
    <div class="kv"><span>Active Attempts</span>${w.activeAttempts}</div>
    <h4>Activity (filtered to ${w.id})</h4>
    ${activityFeed(a => a.scope.includes(w.id), 5)}
    <button class="mini primary" data-action="drill-wi" data-id="${w.id}">Open Actor Graph →</button>
    <button class="mini" data-action="command" data-cmd="retry-wi" data-id="${w.id}">Typed command: Retry ${w.id}…</button>
  </div>`;
}

function actorInspector(a) {
  const atts = DB.attempts.filter(t => t.actor === a.id);
  return `<div class="insp">
    <h3>${a.id} · ${esc(a.role)}</h3>
    <div class="kv"><span>Program</span>${a.program}</div>
    <div class="kv"><span>Projected condition</span>${esc(a.projected)}</div>
    <h4>Attempts</h4>
    ${atts.map(t => `<button class="att-row ${state.selAttempt === t.id ? 'sel' : ''}" data-action="sel-attempt" data-id="${t.id}">
      <b>Attempt ${t.n}</b> <span class="chip ${t.outcome}">${t.outcome}</span>
      <span class="muted">${t.started.slice(11)}${t.ended ? '–' + t.ended : '–'}</span></button>`).join('')}
  </div>`;
}

function attemptInspector(t) {
  const pct = Math.round(t.ctxUsed / t.ctxAvail * 100);
  return `<div class="insp">
    <h3>Attempt ${t.n} <span class="chip ${t.outcome}">${t.outcome}</span></h3>
    <div class="muted">${t.actor} · started ${t.started}${t.ended ? ' · ended ' + t.ended : ' · running'}</div>
    ${t.reason ? `<div class="warnline">${esc(t.reason)}</div>` : ''}

    <h4>Activity timeline</h4>
    <div class="tl">${t.timeline.map(e => `<div class="tl-row ${e.kind}"><span class="tl-t">${e.t}</span><span class="tl-k">${e.kind}</span> ${esc(e.text)}${e.link ? ` <span class="badge">📎 ${e.link}</span>` : ''}</div>`).join('')}</div>

    <h4>Context</h4>
    <div class="ctxbar"><div class="ctxfill" style="width:${pct}%"></div><span>${t.ctxUsed.toLocaleString()} / ${t.ctxAvail.toLocaleString()} tokens (${pct}%)</span></div>
    ${t.compaction.map(c => `<div class="muted">⟳ ${c}</div>`).join('') || '<div class="muted">no compaction/reset events yet</div>'}

    <h4>Lifecycle</h4><div class="muted">${t.lifecycle.join(' → ')}</div>
    <h4>Tool summaries</h4><div class="muted">${t.tools.join(' · ')}</div>
    <h4>Artifacts</h4><div class="muted">${t.artifacts.map(a => '📄 ' + a).join('<br>')}</div>
    <h4>Evidence</h4><div class="muted">${t.evidence.map(a => '📎 ' + a).join('<br>') || '—'}</div>
    ${t.warnings.length ? `<h4>Warnings</h4>${t.warnings.map(w => `<div class="warnline">⚠ ${esc(w)}</div>`).join('')}` : ''}
    <h4>Retry recommendation</h4><div class="muted">${esc(t.retry)}</div>
    <details class="raw"><summary>Raw transcript / logs (on demand)</summary><pre>${esc(t.transcript)}</pre></details>

    <h4>Operator Message <span class="muted">(queued — never interrupt-now)</span></h4>
    <form data-form="operator-msg"><textarea name="msg" rows="2" placeholder="Guidance delivered at the next safe checkpoint…"></textarea>
    <button class="mini primary" type="submit">Queue message</button></form>
    <div id="msg-list">${queuedMsgs(t.id)}</div>
  </div>`;
}

function queuedMsgs(attemptId) {
  return (state.campaign.queuedMsgs || []).filter(m => m.attempt === attemptId).map(m =>
    `<div class="qmsg">✉ ${esc(m.text)} <span class="chip ${m.delivered ? 'ok' : 'queued'}">${m.delivered ? 'delivered' : 'queued'}</span></div>`).join('');
}

function activityFeed(filter, limit) {
  const rows = DB.activity.filter(filter).slice(0, limit || 50);
  if (!rows.length) return '<div class="muted">no activity</div>';
  return `<div class="tl">${rows.map(e =>
    `<div class="tl-row ${e.kind}"><span class="tl-t">${e.t}</span><span class="tl-k">${e.kind}</span> ${esc(e.text)}
     ${e.link ? `<span class="badge">📎 ${e.link}</span>` : ''}
     <span class="muted scope">${e.scope.join(' › ')}</span></div>`).join('')}</div>`;
}

/* --- needs attention + conversational gate --- */

function attentionList(compact) {
  return openAttention().map(a => `
    <div class="attn-item ${state.selAttention === a.id ? 'sel' : ''} sev-${a.severity}" data-action="sel-attention" data-id="${a.id}">
      <div class="attn-kind">${a.kind.replace(/-/g, ' ')} · ${a.severity}</div>
      <div class="attn-title">${esc(a.title)}</div>
      ${compact ? '' : `<div class="muted">${esc(a.detail)}</div>`}
      <div class="attn-where" title="canonical link to exact graph location">⌖ ${a.where}</div>
    </div>`).join('') || '<div class="ok-panel">✓ Queue empty — nothing needs you.</div>';
}

function gatePanel(a) {
  const g = a.gate;
  let body = '';
  if (g.state === 'awaiting-answer') {
    body = `<div class="gate-q">${esc(g.question)}</div>
      <form data-form="gate-answer" data-id="${a.id}">
        <textarea name="answer" rows="3" placeholder="Free-text answer — evidence and reasoning welcome…"></textarea>
        <button class="mini primary" type="submit">Send answer</button></form>`;
  } else if (g.state === 'followup') {
    body = `<div class="gate-you">You: ${esc(g.answer)}</div>
      <div class="gate-q">Follow-up: ${esc(g.followupQ)}</div>
      <form data-form="gate-answer2" data-id="${a.id}">
        <textarea name="answer" rows="2" placeholder="Answer the follow-up…"></textarea>
        <button class="mini primary" type="submit">Send</button></form>`;
  } else if (g.state === 'judgment') {
    body = `<div class="gate-you">You: ${esc(g.answer)}</div><div class="gate-you">You: ${esc(g.answer2)}</div>
      <div class="gate-judgment"><b>Proposed judgment</b><br>${esc(g.judgment)}</div>
      <button class="mini primary" data-action="gate-confirm" data-id="${a.id}">Confirm judgment</button>
      <button class="mini" data-action="gate-revise" data-id="${a.id}">Revise</button>`;
  } else {
    body = `<div class="ok-panel">✓ Judgment confirmed: ${esc(g.judgment)}</div>`;
  }
  return `<div class="gate-panel">
    <h4>🚪 Human Gate — conversational <span class="muted">(one question at a time, no approve/reject buttons)</span></h4>
    ${body}</div>`;
}

function attentionDetail() {
  const a = attn(state.selAttention);
  if (!a) return '<div class="muted">select an item</div>';
  let extra = '';
  if (a.kind === 'human-gate') extra = gatePanel(a);
  else if (a.kind === 'exhausted-retries') extra = `<p>${esc(a.detail)}</p><button class="mini warn" data-action="command" data-cmd="retry">Typed Supervisor command: Re-arm retries…</button>`;
  else if (a.kind === 'rejected-proposal') extra = `<p>${esc(a.detail)}</p><button class="mini" data-action="revision-review">Open Revision review…</button>`;
  else if (a.kind === 'capability-failure') extra = `<p>${esc(a.detail)}</p><p class="muted">Free text cannot grant capabilities — the grant rides candidate Revision r13.</p><button class="mini" data-action="revision-review">Review r13 grant…</button>`;
  else extra = `<p>${esc(a.detail)}</p><button class="mini" data-action="goto-attempt">Open Attempt inspector →</button>`;
  return `<div class="attn-detail"><h3>${esc(a.title)}</h3><div class="attn-where">⌖ ${a.where}</div>${extra}</div>`;
}

/* --- revision review (semantic, not a diff) --- */

function revisionReviewModal() {
  const c = DB.revisions.candidate;
  if (!c) return '';
  return `<div class="modal-back" data-action="close-modal">
  <div class="modal" onclick="event.stopPropagation()">
    <h3>Revision review — r${DB.revisions.current} → r${c.n} <span class="proto-chip">semantic effect, not a diff</span></h3>
    <p>${esc(c.summary)}</p>
    <p class="muted">${esc(c.overlay)}</p>
    ${c.groups.map(g => `<h4>${g.label}</h4><ul>${g.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    <p class="muted">${esc(c.sideBySide)}</p>
    <button class="mini primary" data-action="activate-revision">Activate Revision r${c.n}</button>
    <button class="mini" data-action="close-modal">Keep as candidate</button>
  </div></div>`;
}

/* --- lifecycle diagnostic (separate from graph canvas) --- */

function diagnosticModal() {
  const c = state.campaign;
  return `<div class="modal-back" data-action="close-modal">
  <div class="modal" onclick="event.stopPropagation()">
    <h3>Lifecycle diagnostic — ${c.id}</h3>
    <div class="kv"><span>Current state</span><b class="chip running">${c.state}</b></div>
    <div class="kv"><span>Recent path</span>${c.lifecyclePath.join(' → ')}</div>
    <div class="kv"><span>Available commands</span>
      <button class="mini" data-action="command" data-cmd="admission">Set Admission Mode…</button>
      <button class="mini warn" data-action="command" data-cmd="retry">Re-arm retries…</button>
      <button class="mini danger" data-action="command" data-cmd="cancel">Cancel Campaign…</button></div>
    <div class="kv"><span>Blocked reasons</span><ul>${c.blockedReasons.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>
    <div class="kv"><span>Journal evidence</span>${c.journal.map(j => `<span class="badge">📎 ${j}</span>`).join(' ')}</div>
    <button class="mini" data-action="close-modal">Close</button>
  </div></div>`;
}

/* --- typed supervisor command review sheet --- */

const COMMANDS = {
  retry: { title: 'Re-arm retries on WI-4', target: 'C-1042 → WI-4 Migrate historical entries',
    effect: 'Retry budget 0/3 → 0/2; Attempt 4 spawns under current Revision r12 with narrowed batch scope.',
    revision: 'No Graph Revision change', capability: 'grants none new', reversible: 'Reversible until Attempt 4 starts', impact: 'medium' },
  'retry-wi': { title: 'Retry Work Item', target: '', effect: 'Spawns a fresh Attempt under current Revision.',
    revision: 'No Graph Revision change', capability: 'grants none new', reversible: 'Reversible until attempt starts', impact: 'medium' },
  cancel: { title: 'Cancel Campaign C-1042', target: 'C-1042 Event-sourced billing ledger',
    effect: 'Running attempts finish current tool call, then halt. Campaign becomes terminal (immutable). WI-3–WI-6 freeze.',
    revision: 'Freezes at r12', capability: 'revokes all attempt capabilities', reversible: 'NOT reversible', impact: 'high' },
  admission: { title: 'Set Admission Mode', target: 'C-1042', effect: 'Changes how new Work Items admit attempts.',
    revision: 'No Graph Revision change', capability: 'none', reversible: 'Reversible at any time', impact: 'low' },
};

function commandSheetModal() {
  const cmd = COMMANDS[state.commandSheet];
  if (!cmd) return '';
  const high = cmd.impact === 'high';
  return `<div class="modal-back" data-action="close-modal">
  <div class="modal" onclick="event.stopPropagation()">
    <h3>Supervisor command — review sheet</h3>
    <div class="kv"><span>Command</span><b>${cmd.title}</b></div>
    <div class="kv"><span>Target</span>${cmd.target || state.selWI}</div>
    <div class="kv"><span>Effect</span>${cmd.effect}</div>
    <div class="kv"><span>Graph Revision</span>${cmd.revision}</div>
    <div class="kv"><span>Capability</span>${cmd.capability}</div>
    <div class="kv"><span>Reversibility</span>${cmd.reversible}</div>
    ${high ? `<div class="warnline">High-impact — type <b>cancel C-1042</b> to confirm.
      <form data-form="confirm-high"><input name="phrase" placeholder="cancel C-1042"><button class="mini danger" type="submit">Confirm cancel</button></form></div>`
      : `<button class="mini primary" data-action="run-command">Confirm command</button>`}
    <button class="mini" data-action="close-modal">Abort</button>
  </div></div>`;
}

/* --- workspaces: catalog / create / terminal / improvement --- */

function catalogView() {
  const cs = DB.campaigns;
  const sec = (title, list, fn) => list.length ? `<h3>${title}</h3>${list.map(fn).join('')}` : '';
  const row = c => `<div class="cat-row" data-action="open-campaign" data-id="${c.id}">
    <b>${c.id}</b> ${esc(c.name)}
    <span class="chip ${c.status}">${c.status}${c.outcome ? ' · ' + c.outcome : ''}</span>
    ${c.status === 'active' && openAttention().length ? `<span class="badge">✋ ${openAttention().length}</span>` : ''}
    <span class="muted">${esc(c.goal).slice(0, 90)}…</span></div>`;
  return `<div class="page">
    <h2>Campaigns <button class="mini primary" data-action="new-campaign">+ New Campaign</button></h2>
    <p class="muted">Sole active Campaign opens directly; catalog ranks intervention-needed → active → draft → recent terminal.</p>
    ${sec('Needs intervention', cs.filter(c => c.status === 'active'), row)}
    ${sec('Draft', cs.filter(c => c.status === 'draft'), row)}
    ${sec('Recent terminal', cs.filter(c => c.status === 'terminal'), row)}
  </div>`;
}

function createView() {
  const p = state.successorPrefill || {};
  return `<div class="page narrow">
    <h2>${p.from ? `Start successor Campaign (of ${p.from})` : 'New Campaign draft'}</h2>
    ${p.from ? `<p class="muted">Prefilled goal, inputs, Project Bindings and selected artifacts from ${p.from}. The old Campaign stays terminal — never reopened.</p>` : ''}
    <form data-form="create-campaign" class="create-form">
      <label>Goal (deep interface)<textarea name="goal" rows="3">${esc(p.goal || '')}</textarea></label>
      <label>Inputs<textarea name="inputs" rows="2" placeholder="one per line">${esc((p.inputs || []).join('\n'))}</textarea></label>
      <label>Optional richer inputs <span class="muted">— a resolved Wayfinder map and existing implementation tickets inform planning but are NOT mechanically Work Items</span>
        <input name="map" placeholder="wayfinder map ref (optional)"></label>
      <label>Issue Backing Mode
        <select name="backing"><option>required</option><option>none</option></select>
        <span class="muted">required → all Work Item issue links reused/provisioned before Graph Revision activation; failed provisioning leaves the proposal as candidate. /to-issues is invoked when needed.</span></label>
      <button class="mini primary" type="submit">Create draft</button>
      <button class="mini" type="button" data-action="workspace" data-ws="catalog">Back</button>
    </form></div>`;
}

function terminalView() {
  const c = DB.campaigns.find(x => x.id === state.terminalId);
  return `<div class="page">
    <div class="immutable">TERMINAL — immutable record (${c.outcome}, finished ${c.finished}, Revision r${c.revision}). Inspected in the same workspace; never reopened.</div>
    <h2>${c.id} · ${esc(c.name)}</h2>
    <p>${esc(c.goal)}</p>
    <div class="kv"><span>Inputs</span>${c.inputs.join(' · ')}</div>
    <div class="kv"><span>Project Bindings</span>${c.bindings.join(' · ')}</div>
    <h3>Activity (terminal record)</h3>
    <div class="tl"><div class="tl-row transition"><span class="tl-t">${c.finished}</span><span class="tl-k">transition</span> Campaign ${c.outcome} at Revision r${c.revision}</div></div>
    <button class="mini primary" data-action="successor" data-id="${c.id}">Start successor Campaign →</button>
  </div>`;
}

function improvementView() {
  return `<div class="page">
    <h2>Improvement <span class="muted">— global: Actor Programs are Campaign-independent</span></h2>
    <p class="muted">Global Program approval is distinct from adoption through a successor Actor Graph Revision. Source Campaigns/Attempts/evidence stay linked.</p>
    ${DB.programs.map(p => `<div class="prog-row">
      <b>${p.name} v${p.version}</b>
      <span class="chip ${p.status === 'adopted' ? 'ok' : p.status === 'approved-not-adopted' ? 'warnchip' : ''}">${p.status === 'approved-not-adopted' ? 'approved — NOT adopted' : p.status}</span>
      <div class="muted">${esc(p.note)}</div>
      <div class="muted">evidence: ${p.evidence.map(e => `<span class="badge">📎 ${e}</span>`).join(' ')}</div>
      ${p.status === 'approved-not-adopted' ? '<button class="mini" data-action="adopt-program">Adopt via successor Actor Graph Revision…</button>' : ''}
    </div>`).join('')}
  </div>`;
}

/* --- prototype switcher (bottom-center) --- */

const VARIANTS_META = [
  ['A', 'Graph cockpit'],
  ['B', 'Intervention desk'],
  ['C', 'Activity command center'],
];
function currentVariant() {
  const v = new URLSearchParams(location.search).get('variant');
  return ['A', 'B', 'C'].includes(v) ? v : 'A';
}
function setVariant(v) {
  const url = new URL(location.href);
  url.searchParams.set('variant', v);
  history.replaceState(null, '', url);
  render();
}
function switcher() {
  const cur = currentVariant();
  const idx = VARIANTS_META.findIndex(([k]) => k === cur);
  const name = VARIANTS_META[idx][1];
  return `<div class="switcher" title="Prototype-only variant switcher">
    <span class="sw-proto">prototype only</span>
    <button data-action="variant-prev" aria-label="previous variant">◀</button>
    <span class="sw-label">${cur} — ${name}</span>
    <button data-action="variant-next" aria-label="next variant">▶</button>
  </div>`;
}

function toasts() {
  return `<div class="toasts">${state.toasts.map(t => `<div class="toast">${esc(t.msg)}</div>`).join('')}</div>`;
}

/* ---------------- dispatch ---------------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action, d = el.dataset;

  if (a === 'variant-prev' || a === 'variant-next') {
    const i = VARIANTS_META.findIndex(([k]) => k === currentVariant());
    const n = a === 'variant-next' ? (i + 1) % 3 : (i + 2) % 3;
    return setVariant(VARIANTS_META[n][0]);
  }
  if (a === 'workspace') { state.workspace = d.ws; return render(); }
  if (a === 'open-campaign') {
    const c = DB.campaigns.find(x => x.id === d.id);
    if (c.status === 'terminal') { state.terminalId = c.id; state.workspace = 'terminal'; }
    else if (c.status === 'active') state.workspace = 'campaign';
    else { state.successorPrefill = null; state.workspace = 'create'; }
    return render();
  }
  if (a === 'new-campaign') { state.successorPrefill = null; state.workspace = 'create'; return render(); }
  if (a === 'successor') {
    const c = DB.campaigns.find(x => x.id === d.id);
    state.successorPrefill = { from: c.id, goal: c.goal, inputs: c.inputs };
    state.workspace = 'create'; return render();
  }
  if (a === 'crumb') {
    if (d.level === 'campaign') { state.focusLevel = 'work'; state.selActor = null; state.selAttempt = null; }
    if (d.level === 'wi') { state.selActor = null; state.selAttempt = null; }
    if (d.level === 'actor') { state.selAttempt = null; }
    return render();
  }
  if (a === 'sel-wi') {
    if (state.focusLevel === 'work' && state.selWI === d.id) {
      state.focusLevel = 'actor'; state.focusWI = d.id; state.selActor = null; state.selAttempt = null; // drill-in replaces canvas
    } else { state.selWI = d.id; }
    return render();
  }
  if (a === 'drill-wi') { state.focusLevel = 'actor'; state.focusWI = d.id; state.selActor = null; state.selAttempt = null; return render(); }
  if (a === 'sel-actor') { state.selActor = d.id; state.selAttempt = null; return render(); }
  if (a === 'sel-attempt') { state.selAttempt = d.id; return render(); }
  if (a === 'sel-attention') {
    state.selAttention = d.id;
    if (state.workspace !== 'attention') state.workspace = 'attention';
    return render();
  }
  if (a === 'focus-mode') { state.graph.focusMode = state.graph.focusMode === d.mode ? 'none' : d.mode; return render(); }
  if (a === 'diagnostic') { state.diagnosticOpen = true; return render(); }
  if (a === 'revision-review') { state.revisionReviewOpen = true; return render(); }
  if (a === 'activate-revision') {
    DB.revisions.current = DB.revisions.candidate.n; DB.revisions.candidate = null;
    state.revisionReviewOpen = false;
    const n3 = attn('N-3'); if (n3) n3.resolved = true;
    const n4 = attn('N-4'); if (n4) n4.resolved = true;
    logActivity('proposal', `Graph Revision r${DB.revisions.current} activated from Revision review (Verifier actor inserted; repo:write granted)`);
    toast(`Revision r${DB.revisions.current} activated — capability grant live; N-3 and N-4 resolved`);
    return render();
  }
  if (a === 'command') { state.commandSheet = d.cmd; return render(); }
  if (a === 'run-command') {
    const cmd = COMMANDS[state.commandSheet];
    if (state.commandSheet === 'retry') {
      const n2 = attn('N-2'); if (n2) n2.resolved = true;
      logActivity('command', 'Supervisor command confirmed: WI-4 retries re-armed (0/2), Attempt 4 spawning under r' + DB.revisions.current, ['C-1042', 'WI-4']);
      const w4 = wi('WI-4'); w4.control = 'running'; w4.activeAttempts = 1;
      toast('WI-4 retries re-armed — N-2 resolved; watch the graph node flip to running');
    } else if (state.commandSheet === 'admission') {
      state.campaign.admission = state.campaign.admission === 'auto' ? 'supervised' : 'auto';
      logActivity('command', 'Supervisor command confirmed: Admission Mode → ' + state.campaign.admission);
      toast('Admission Mode → ' + state.campaign.admission);
    } else {
      logActivity('command', 'Supervisor command confirmed: ' + cmd.title);
      toast('Command confirmed: ' + cmd.title);
    }
    state.commandSheet = null; return render();
  }
  if (a === 'admission') { state.commandSheet = 'admission'; return render(); }
  if (a === 'gate-confirm') {
    const g = attn(d.id).gate; g.state = 'resolved'; attn(d.id).resolved = true;
    wi('WI-6').control = 'queued'; wi('WI-6').badges = wi('WI-6').badges.filter(b => b !== 'gate');
    wi('WI-6').attention = false;
    logActivity('gate', 'Human Gate judgment confirmed: ' + g.judgment, ['C-1042', 'WI-6']);
    toast('Gate judgment confirmed — WI-6 unblocked; N-1 resolved');
    return render();
  }
  if (a === 'gate-revise') { attn(d.id).gate.state = 'awaiting-answer'; return render(); }
  if (a === 'goto-attempt') {
    state.workspace = 'campaign'; state.focusLevel = 'actor'; state.focusWI = 'WI-3';
    state.selActor = 'AC-2'; state.selAttempt = 'AT-303'; return render();
  }
  if (a === 'adopt-program') {
    logActivity('proposal', 'Adoption proposed: scout.md v3 via successor Actor Graph Revision r' + (DB.revisions.current + 1));
    toast('Adoption proposed as successor Actor Graph Revision — review in Revision review');
    return render();
  }
  if (a === 'close-modal') {
    state.diagnosticOpen = false; state.revisionReviewOpen = false; state.commandSheet = null;
    return render();
  }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action-change]');
  if (!el) return;
  if (el.dataset.actionChange === 'collapse') { state.graph.collapseSatisfied = el.checked; render(); }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f), name = f.dataset.form;

  if (name === 'graph-search') {
    state.graph.search = fd.get('q') || ''; state.graph.filter = fd.get('filter') || 'all';
    return render();
  }
  if (name === 'gate-answer') {
    const g = attn(f.dataset.id).gate; g.answer = fd.get('answer') || '(no answer)'; g.state = 'followup';
    return render();
  }
  if (name === 'gate-answer2') {
    const g = attn(f.dataset.id).gate; g.answer2 = fd.get('answer') || '(no answer)'; g.state = 'judgment';
    return render();
  }
  if (name === 'operator-msg') {
    const text = fd.get('msg');
    if (!text) return;
    state.campaign.queuedMsgs = state.campaign.queuedMsgs || [];
    const m = { attempt: state.selAttempt, text, delivered: false };
    state.campaign.queuedMsgs.push(m);
    logActivity('message', `Operator Message queued for ${state.selAttempt}: "${text}"`, ['C-1042', 'WI-3', 'AC-2', state.selAttempt]);
    toast('Message queued — delivery at next safe checkpoint (no interrupt-now)');
    render();
    setTimeout(() => {
      m.delivered = true;
      logActivity('message', `Operator Message delivered to ${state.selAttempt}: "${text}"`, ['C-1042', 'WI-3', 'AC-2', state.selAttempt]);
      render();
    }, 5000);
    return;
  }
  if (name === 'confirm-high') {
    if ((fd.get('phrase') || '').trim().toLowerCase() === 'cancel c-1042') {
      state.campaign.state = 'cancelling';
      logActivity('command', 'HIGH-IMPACT command confirmed by typed phrase: Cancel Campaign — attempts halting at safe points');
      toast('Cancellation confirmed — Campaign → terminal (immutable). Successor can be started from the terminal view.');
      state.commandSheet = null;
    } else toast('Typed phrase did not match — command NOT executed');
    return render();
  }
  if (name === 'create-campaign') {
    const goal = fd.get('goal') || 'untitled goal';
    DB.campaigns.splice(1, 0, {
      id: 'C-1044', name: goal.slice(0, 40), status: 'draft', goal,
      inputs: (fd.get('inputs') || '').split('\n').filter(Boolean),
      bindings: state.successorPrefill ? ['repo:billing-platform'] : [],
      issueBacking: fd.get('backing'),
    });
    toast(`Draft C-1044 created (Issue Backing Mode: ${fd.get('backing')}) — graph proposal pending; /to-issues will run before activation if required`);
    state.workspace = 'catalog'; state.successorPrefill = null;
    return render();
  }
});

/* Arrow keys cycle variants; never while typing in an input/textarea/contenteditable. */
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const t = document.activeElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const i = VARIANTS_META.findIndex(([k]) => k === currentVariant());
  const n = e.key === 'ArrowRight' ? (i + 1) % 3 : (i + 2) % 3;
  setVariant(VARIANTS_META[n][0]);
});

/* ---------------- render ---------------- */

function modals() {
  let m = '';
  if (state.diagnosticOpen) m += diagnosticModal();
  if (state.revisionReviewOpen) m += revisionReviewModal();
  if (state.commandSheet) m += commandSheetModal();
  return m;
}

function workspacePage() {
  if (state.workspace === 'catalog') return catalogView();
  if (state.workspace === 'create') return createView();
  if (state.workspace === 'terminal') return terminalView();
  if (state.workspace === 'improvement') return improvementView();
  if (state.workspace === 'attention') return null; // variant-specific
  return null; // campaign — variant-specific
}

function render() {
  const v = currentVariant();
  const fn = { A: renderVariantA, B: renderVariantB, C: renderVariantC }[v];
  document.getElementById('root').innerHTML = fn();
}
