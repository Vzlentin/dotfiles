/* PROTOTYPE — THROWAWAY.
   Variant A — Graph cockpit: the graph canvas owns the screen. Compact campaign
   header/control bar on top, attention as a slim left rail, inspector right.
   The operator's eye lives on the DAG; everything else is peripheral chrome. */
'use strict';

function renderVariantA() {
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
      <div class="camp-header">
        <div class="camp-title"><b>${c.id}</b> ${esc(c.name)} ${lifecycleStrip(c)}</div>
        ${controlBar(c)}
      </div>
      ${breadcrumbs()}
      <div class="a-layout">
        <aside class="a-rail">
          <h4>Needs attention <span class="count">${openAttention().length}</span></h4>
          ${attentionList(true)}
        </aside>
        <section class="a-canvas">${graphCanvas()}</section>
        <aside class="a-insp">${inspector()}</aside>
      </div>`;
  }
  return `${globalNav()}${main}${modals()}${toasts()}${switcher()}`;
}
