/* PROTOTYPE — THROWAWAY. Fake dense domain data for the live-graph control room.
   Question: what visual hierarchy and interactions let one operator understand and
   safely control a running Campaign without an unreadable mega-graph? */

const DB = {
  campaigns: [
    {
      id: 'C-1042', name: 'Event-sourced billing ledger', status: 'active',
      state: 'running', admission: 'supervised', revision: 12, candidateRevision: 13,
      goal: 'Migrate the billing service to an event-sourced ledger with zero downtime and a rehearsed rollback.',
      inputs: ['billing/ service tree', 'ADR-014 event model', 'staging replay corpus (48h)'],
      bindings: ['repo:billing-platform', 'project:Q3-reliability'],
      issueBacking: 'required',
      lifecyclePath: ['draft', 'admitted', 'running'],
      blockedReasons: ['Human Gate "Cutover rollback window" unanswered', 'WI-4 retries exhausted'],
      journal: ['J-8812 admission review', 'J-8820 gate escalation', 'J-8824 retry exhaustion'],
    },
    {
      id: 'C-1043', name: 'Analytics pipeline v2', status: 'draft',
      goal: 'Sketch only — goal captured, no graph proposed yet.',
      inputs: ['analytics/ service tree'], bindings: ['repo:analytics'], issueBacking: 'none',
    },
    {
      id: 'C-1039', name: 'Consolidate CI runners', status: 'terminal', outcome: 'succeeded',
      goal: 'Collapse 14 self-hosted runners into 3 pools with queue metrics.',
      inputs: ['ci/ terraform', 'runner inventory'], bindings: ['repo:infra'],
      finished: '2026-07-12', revision: 8,
    },
    {
      id: 'C-1037', name: 'Deploy agent retry storm', status: 'terminal', outcome: 'cancelled',
      goal: 'Auto-tune deploy retry backoff — cancelled after gate rejection.',
      inputs: ['deploy/ service tree'], bindings: ['repo:deploy'],
      finished: '2026-06-28', revision: 3,
    },
  ],

  // Work Graph for C-1042 (left-to-right DAG, stable automatic layout)
  workItems: [
    { id: 'WI-1', name: 'Map current ledger schema', control: 'done', outcome: 'satisfied',
      condition: 'schema catalog committed to docs/', activeAttempts: 0, badges: [],
      x: 0, y: 1, issue: '#482' },
    { id: 'WI-2', name: 'Design event model', control: 'done', outcome: 'satisfied',
      condition: 'event catalog approved by review', activeAttempts: 0, badges: ['evidence'],
      x: 1, y: 1, issue: '#483' },
    { id: 'WI-3', name: 'Implement event store adapter', control: 'running', outcome: null,
      condition: 'contract tests green on postgres + memory backends', activeAttempts: 1,
      badges: ['warn', 'msg'], x: 2, y: 0, issue: '#484', attention: true },
    { id: 'WI-4', name: 'Migrate historical entries', control: 'blocked', outcome: null,
      condition: '2.1M rows replayed with zero checksum drift', activeAttempts: 0,
      badges: ['intervention'], x: 2, y: 2, issue: '#485', attention: true },
    { id: 'WI-5', name: 'Dual-write validation', control: 'queued', outcome: null,
      condition: '48h shadow writes, divergence < 0.01%', activeAttempts: 0,
      badges: [], x: 3, y: 1, issue: '#486' },
    { id: 'WI-6', name: 'Cutover & rollback plan', control: 'gated', outcome: null,
      condition: 'rollback rehearsal signed off by operator', activeAttempts: 0,
      badges: ['gate'], x: 4, y: 1, issue: '#487', attention: true },
  ],
  workEdges: [['WI-1', 'WI-2'], ['WI-2', 'WI-3'], ['WI-2', 'WI-4'], ['WI-3', 'WI-5'], ['WI-4', 'WI-5'], ['WI-5', 'WI-6']],

  // Actor Graph for WI-3 (replaces Work Graph in the same focus area when WI-3 selected)
  actors: [
    { id: 'AC-1', role: 'Planner', projected: 'adapter design note accepted',
      attempt: { n: 2, outcome: 'succeeded' }, ctx: null,
      badges: ['evidence'], x: 0, y: 1, program: 'planner.md v4 · Revision r12' },
    { id: 'AC-2', role: 'Implementer', projected: 'contract tests green on both backends',
      attempt: { n: 3, outcome: 'running' }, ctx: 68,
      badges: ['msg', 'warn', 'improvement'], x: 1, y: 1, program: 'implementer.md v7 · Revision r12', attention: true },
    { id: 'AC-3', role: 'Reviewer', projected: 'review verdict recorded on adapter PR',
      attempt: { n: 1, outcome: 'queued' }, ctx: null,
      badges: [], x: 2, y: 1, program: 'reviewer.md v5 · Revision r12' },
  ],
  actorEdges: [['AC-1', 'AC-2'], ['AC-2', 'AC-3']],

  attempts: [
    { id: 'AT-301', actor: 'AC-2', n: 1, outcome: 'failed', started: '2026-07-19 09:12', ended: '09:58',
      reason: 'capability failure — missing repo:write on billing/migrations',
      ctxUsed: 940112, ctxAvail: 1000000,
      lifecycle: ['spawned', 'scoped', 'running', 'compacted', 'failed'],
      tools: ['read_file ×34', 'edit ×12', 'bash ×9'],
      artifacts: ['event_store.py (partial draft)'], evidence: ['J-8799 capability denial'],
      warnings: ['context exhaustion (94%) halted progress'],
      retry: 'Retry with narrowed scope and repo:write grant — attempted in Attempt 2.',
      compaction: ['context compacted at 71% — summary retained 12 facts'],
      transcript: '[09:12] spawn…\n[09:31] read billing/store.py…\n[09:55] EDIT DENIED: capability repo:write missing…',
      timeline: [
        { t: '09:12', kind: 'transition', text: 'Attempt 1 spawned (Revision r12)' },
        { t: '09:31', kind: 'tool', text: 'read billing/store.py — 2,140 lines ingested' },
        { t: '09:47', kind: 'event', text: 'context compaction at 71%' },
        { t: '09:55', kind: 'warning', text: 'EDIT DENIED — capability repo:write missing' },
        { t: '09:58', kind: 'result', text: 'Result Record: failed — capability failure', link: 'J-8799' },
      ] },
    { id: 'AT-302', actor: 'AC-2', n: 2, outcome: 'failed', started: '2026-07-19 11:04', ended: '12:20',
      reason: 'Revision Proposal r12.1 rejected by supervisor — scope too broad',
      ctxUsed: 512440, ctxAvail: 1000000,
      lifecycle: ['spawned', 'scoped', 'running', 'failed'],
      tools: ['read_file ×21', 'edit ×8', 'bash ×14'],
      artifacts: ['event_store.py v2', 'contract_test.py'], evidence: ['J-8804 proposal rejection'],
      warnings: [], retry: 'Re-scope proposal; supervisor granted repo:write — see Attempt 3.',
      compaction: [],
      transcript: '[11:04] spawn…\n[12:02] proposal r12.1 submitted…\n[12:20] rejected: scope too broad…',
      timeline: [
        { t: '11:04', kind: 'transition', text: 'Attempt 2 spawned after capability grant' },
        { t: '12:02', kind: 'proposal', text: 'Revision Proposal r12.1 submitted (add Verifier actor)' },
        { t: '12:20', kind: 'result', text: 'Result Record: failed — proposal rejected', link: 'J-8804' },
      ] },
    { id: 'AT-303', actor: 'AC-2', n: 3, outcome: 'running', started: '2026-07-20 14:31', ended: null,
      reason: null,
      ctxUsed: 684320, ctxAvail: 1000000,
      lifecycle: ['spawned', 'scoped', 'running'],
      tools: ['read_file ×18', 'edit ×11', 'bash ×22'],
      artifacts: ['event_store.py v3 (9/14 contract tests green)'],
      evidence: ['contract-test.log'], warnings: ['context at 68% — compaction expected before completion'],
      retry: 'n/a — attempt healthy; queue an Operator Message instead of interrupting.',
      compaction: [],
      transcript: '[14:31] spawn…\n[15:40] 9/14 contract tests green…',
      timeline: [
        { t: '14:31', kind: 'transition', text: 'Attempt 3 spawned (Revision r12)' },
        { t: '14:58', kind: 'tool', text: 'bash: pytest contract/ — 6/14 green' },
        { t: '15:40', kind: 'tool', text: 'bash: pytest contract/ — 9/14 green' },
        { t: '16:02', kind: 'message', text: 'Operator Message delivered: "prefer memory backend first"' },
        { t: '16:20', kind: 'warning', text: 'context usage crossed 65%' },
      ] },
  ],

  // Needs attention — one canonical item each, linking to exact graph locations.
  attention: [
    { id: 'N-1', kind: 'human-gate', severity: 'high', resolved: false,
      title: 'Human Gate — cutover rollback window', where: 'C-1042 → WI-6 → Gate',
      detail: 'Cutover rehearsal needs an operator judgment before WI-6 can unblock.',
      gate: {
        state: 'awaiting-answer', // awaiting-answer → followup → judgment → resolved
        question: 'During cutover, replay lag may reach 4–6 minutes. What data-loss window is acceptable for billing entries, and what compensating control do you want in place?',
        answer: null, followupQ: 'You said 5 minutes with a hold on settlement exports. Should the hold be automatic on lag breach, or paged to an on-call human for manual release?',
        answer2: null,
        judgment: 'Proceed with a 5-minute data-loss window; settlement exports auto-hold on lag breach with pager fallback.',
      } },
    { id: 'N-2', kind: 'exhausted-retries', severity: 'high', resolved: false,
      title: 'Retries exhausted — Migrate historical entries', where: 'C-1042 → WI-4',
      detail: '3/3 retries failed on checksum drift in batch 7. Supervisor command required to re-arm.' },
    { id: 'N-3', kind: 'rejected-proposal', severity: 'medium', resolved: false,
      title: 'Revision Proposal r13 rejected once', where: 'C-1042 → Graph Revision r13',
      detail: 'Verifier-actor insertion was rejected for scope. Re-scoped candidate r13 awaits Revision review.' },
    { id: 'N-4', kind: 'capability-failure', severity: 'medium', resolved: false,
      title: 'Capability failure — repo:write on billing/migrations', where: 'C-1042 → WI-3 → AC-2 → Attempt 1',
      detail: 'Attempt 1 died on a missing capability. Grant is staged in candidate Revision r13.' },
    { id: 'N-5', kind: 'context-warning', severity: 'low', resolved: false,
      title: 'Context exhaustion threatens progress — Implementer Attempt 3', where: 'C-1042 → WI-3 → AC-2 → Attempt 3',
      detail: '684,320 / 1,000,000 tokens used (68%). Compaction projected before test 12 of 14.' },
  ],

  // Campaign-wide canonical Activity timeline (filtered inside entity inspectors).
  activity: [
    { t: '16:20', kind: 'warning', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-303'], text: 'Context usage crossed 65% on Implementer Attempt 3' },
    { t: '16:02', kind: 'message', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-303'], text: 'Operator Message delivered: "prefer memory backend first"' },
    { t: '15:40', kind: 'result', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-303'], text: 'Result Record: 9/14 contract tests green', link: 'contract-test.log' },
    { t: '15:12', kind: 'command', scope: ['C-1042'], text: 'Supervisor command: Admission Mode → supervised (confirmed)' },
    { t: '14:31', kind: 'transition', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-303'], text: 'Attempt 3 spawned on Implementer (Revision r12)' },
    { t: '14:02', kind: 'gate', scope: ['C-1042', 'WI-6'], text: 'Human Gate opened: cutover rollback window', link: 'N-1' },
    { t: '13:44', kind: 'proposal', scope: ['C-1042'], text: 'Candidate Graph Revision r13 re-scoped after rejection', link: 'Revision review' },
    { t: '12:20', kind: 'result', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-302'], text: 'Result Record: Attempt 2 failed — proposal rejected', link: 'J-8804' },
    { t: '11:04', kind: 'transition', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-302'], text: 'Attempt 2 spawned after capability grant staged' },
    { t: '09:58', kind: 'result', scope: ['C-1042', 'WI-3', 'AC-2', 'AT-301'], text: 'Result Record: Attempt 1 failed — capability failure', link: 'J-8799' },
    { t: '09:00', kind: 'transition', scope: ['C-1042'], text: 'Campaign admitted → running (Revision r12 activated)' },
  ],

  // Graph Revisions — normal view shows current; r13 is a candidate in Revision review.
  revisions: {
    current: 12,
    candidate: {
      n: 13,
      summary: 'Insert a Verifier actor between Implementer and Reviewer on WI-3; grant Implementer repo:write on billing/migrations. No Work Item topology changes. Historical attempts (AT-301/302) remain visible as historical under r12.',
      groups: [
        { label: 'Added', items: ['Actor "Verifier" on WI-3 (program verifier.md v1)', 'Edge Implementer → Verifier', 'Edge Verifier → Reviewer'] },
        { label: 'Modified', items: ['Implementer capability grant: repo:write → billing/migrations', 'Reviewer input condition: requires Verifier verdict'] },
        { label: 'Removed', items: ['— none —'] },
      ],
      overlay: 'Proposal overlay: Verifier node and its two edges shown dashed on the graph while review is open.',
      sideBySide: 'Small subgraph — side-by-side r12/r13 available for WI-3 only.',
    },
  },

  // Improvement workspace — global, Campaign-independent programs.
  programs: [
    { id: 'P-1', name: 'implementer.md', version: 7, status: 'adopted',
      note: 'Approved 2026-07-15 · adopted via Actor Graph Revision r12',
      evidence: ['C-1042 → WI-3 → AT-302', 'C-1039 → WI-2 → AT-114'] },
    { id: 'P-2', name: 'scout.md', version: 3, status: 'approved-not-adopted',
      note: 'Approved 2026-07-18 · not yet adopted — awaiting a successor Actor Graph Revision',
      evidence: ['C-1042 → WI-1 → AT-088'] },
    { id: 'P-3', name: 'worker.md', version: 2, status: 'candidate',
      note: 'Candidate under evaluation — bounded mechanical edits',
      evidence: ['C-1042 → WI-3 → AT-303', 'C-1039 → WI-4 → AT-120'] },
  ],
};
