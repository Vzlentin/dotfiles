/* PROTOTYPE — THROWAWAY.
   Variant B — Intervention desk: "where does it need me?" dominates. The Needs
   attention queue and its conversational gate take the left half; a Work Item
   progress overview takes the right; the graph is demoted to a small secondary
   focus surface at the bottom. Inspector is a slide-over drawer. */
'use strict';

function renderVariantB() {
  const page = workspacePage();
  let main;
  if (page) {
    main = page;
  } else if (state.workspace === 'attention') {
    state.workspace = 'campaign'; // the desk IS the attention view — fall through
  }
  if (!page) {
    const c = state.campaign;
    main = `
      <div class="camp-header slim">
        <div class="camp-title"><b>${c.id}</b> ${esc(c.name)} ${lifecycleStrip(c)}</div>
        ${controlBar(c)}
      </div>
      ${breadcrumbs()}
      <div class="b-layout">
        <section class="b-desk">
          <h3>Needs attention <span class="count">${openAttention().length}</span> <span class="muted">— the desk: work the queue, the graph follows you</span></h3>
          <div class="b-queue">${attentionList(false)}</div>
          ${attentionDetail()}
        </section>
        <section class="b-progress">
          <h3>Progress overview</h3>
          <table class="wi-table">
            <tr><th>Work Item</th><th>State</th><th>Condition</th><th>Attempts</th><th></th></tr>
            ${DB.workItems.map(w => `<tr class="${state.selWI === w.id ? 'sel' : ''}" data-action="sel-wi" data-id="${w.id}">
              <td>${w.id} ${esc(w.name)}</td>
              <td><span class="chip ${w.outcome === 'satisfied' ? 'ok' : w.control}">${w.outcome || w.control}</span></td>
              <td class="muted">${esc(w.condition)}</td>
              <td>${w.activeAttempts || '—'}</td>
              <td>${(w.badges || []).map(badgeHtml).join('')}</td></tr>`).join('')}
          </table>
          <h3>Graph <span class="muted">— secondary focus surface</span></h3>
          <div class="b-graph">${graphCanvas()}</div>
        </section>
      </div>
      <aside class="b-drawer">${inspector()}</aside>`;
  }
  return `${globalNav()}${main}${modals()}${toasts()}${switcher()}`;
}
