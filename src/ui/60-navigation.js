function draw(){let model=state.snapshot?C.analyze(state.snapshot,state.date,state.settings,state.plans):null;
 if(state.page==='payments'&&model&&prepareDueDrafts(model)){
  model=C.analyze(state.snapshot,state.date,state.settings,state.plans);
 }
 for(const p of Object.keys(pages)){$('page-'+p).classList.toggle('active',state.page===p);document.querySelectorAll(`[data-page="${p}"]`).forEach(b=>{b.classList.toggle('active',state.page===p);if(state.page===p)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
 $('breadcrumb-active').textContent=pages[state.page];$('snapshot-indicator').textContent=state.snapshot?'Срез: '+fmtDate(state.date):'Отчёт не загружен';
 const fn={overview:renderOverview,payments:renderPayments,suppliers:renderSuppliers,reconcile:renderReconcile,import:renderImport};
 $('page-'+state.page).innerHTML=fn[state.page](model);
 if(state.page==='payments')document.querySelectorAll('[data-supplier-select][data-partial]').forEach(el=>{el.indeterminate=true;});
}
