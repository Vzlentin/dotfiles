/* PROTOTYPE — THROWAWAY.
   Variant C — Activity command center: the canonical chronological Activity
   feed and the selected path own the page. The graph survives only as a text
   outline/minimap on the left for orientation; inspector right. Reading the
   campaign like a log, not like a map. */
'use strict';

function pathStrip() {
  const parts = [`<b>${state.campaign.id}</b> running · r${DB.revisions.current}`];
  if (state.focusLevel === 'actor') {
    parts.push(`${state.focusWI} ${esc(wi(state.focusWI).name)}`);
    if (state.selActor) parts.push(`${state.selActor} ${actor(state.selActor).role}`);
    if (state.selAttempt) parts.push(`Attempt ${attempt(state.selAttempt).n} — ${attempt(state.selAttempt).outcome}`);
  } else {
    parts.push(`${state.selWI} ${esc(wi(state.selWI).name)}`);
  }
  return `<div class="c-path">${parts.map((p, i) =>
    `<span class="c-step ${i === parts.length - 1 ? 'cur' : ''}">${p}</span>`).join('<span class="crumb-sep">›</span>')}</div>`;
}

function graphOutline() {
  return `<div class="c-outline">
    <h4>Work Graph outline <span class="muted">r${DB.revisions.current}</span></h4>
    ${DB.workItems.map(w => `<div class="c-node ${state.selWI === w.id && state.focusLevel === 'work' ? 'sel' : ''} ${w.attention ? 'attn' : ''}"
        data-action="sel-wi" data-id="${w.id}">
      <span class="mm-dot inline ${w.attention ? 'attn' : ''}"></span> ${w.id} ${esc(w.name)}
      <span class="chip ${w.outcome === 'satisfied' ? 'ok' : w.control}">${w.outcome || w.control}</span></div>`).join('')}
    ${state.focusLevel === 'actor' ? `<h4>Actor Graph — ${state.focusWI}</h4>
    ${DB.actors.map(a => `<div class="c-node ${state.selActor === a.id ? 'sel' : ''}" data-action="sel-actor" data-id="${a.id}">
      ${a.id} ${a.role} <span class="chip ${a.attempt.outcome}">A${a.attempt.n} ${a.attempt.outcome}</span>
      ${a.ctx != null ? `<span class="chip ctx">${a.ctx}%</span>` : ''}</div>`).join('')}` : ''}
    <button class="mini" data-action="focus-mode" data-mode="attention">Focus: attention</button>
  </div>`;
}

function renderVariantC() {
  const page = workspacePage();
  let main;
  if (page) {
    main = page;
  } else if (state.workspace === 'attention') {
    main = `<div class="page two-col">
      <div><h2>Needs attention</h2>${attentionList(false)}</div>
      <div>${attentionDetail()}</div></div>`;
  } else {
    const c = state.campaign;
    main = `
      <div class="camp-header slim">
        <div class="camp-title"><b>${c.id}</b> ${esc(c.name)} ${lifecycleStrip(c)} ${controlBar(c)}</div>
      </div>
      ${breadcrumbs()}
      ${pathStrip()}
      <div class="c-layout">
        <aside class="c-left">${graphOutline()}</aside>
        <section class="c-feed">
          <h3>Activity <span class="muted">— canonical Campaign timeline (commands, transitions, messages, gates, proposals, Result Records)</span></h3>
          ${activityFeed(() => true, 50)}
        </section>
        <aside class="c-insp">${inspector()}</aside>
      </div>`;
  }
  return `${globalNav()}${main}${modals()}${toasts()}${switcher()}`;
}
