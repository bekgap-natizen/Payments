// All interactions are delegated; rerender never destroys the application state.
document.addEventListener('click',async e=>{
 const vendorCheck=e.target.closest('[data-supplier-select]');
 if(vendorCheck){e.preventDefault();e.stopPropagation();const k=vendorCheck.dataset.supplierSelect;const row=currentRow(k);
 if(row&&!vendorCheck.disabled)await action(k,'toggle-supplier');return;}
 const review=e.target.closest('[data-reconcile-vendor]');if(review){navigate('reconcile',review.dataset.reconcileVendor);return;}
 const nav=e.target.closest('[data-page]');if(nav){navigate(nav.dataset.page);return;}
 const open=e.target.closest('[data-open-vendor]');if(open){const k=open.dataset.openVendor;state.openVendors.add(k);navigate('payments');return;}
 const load=e.target.closest('[data-load]');if(load){state.date=load.dataset.load;saveLocal('selected-date',state.date);await refreshSnapshots();navigate('payments');return;}
 if(e.target.closest('#export-payments'))return exportXlsx();
 if(e.target.closest('#send-payments-mail'))return sendPaymentMail();
 const btn=e.target.closest('[data-act]');if(btn)return action(btn.dataset.key,btn.dataset.act);
});
document.addEventListener('change',e=>{const el=e.target;
 if(el.id==='report-date'){state.importDate=el.value;return;}
 if(el.id==='excel-file'){const file=el.files?.[0];const label=$('selected-file');if(label)label.textContent=file?.name||'Файл не выбран';if(file)void importReport(file,state.importDate);return;}
 if(el.id==='supplier-org'){state.supplierOrg=el.value;draw();return;}
 if(el.id==='payment-org'){state.paymentOrg=el.value;draw();return;}
 if(el.id==='only-due'){state.onlyDue=el.checked;draw();return;}
 if(el.dataset.tracked){const k=el.dataset.tracked;state.settings[k]={...(state.settings[k]||{delay:0}),tracked:el.checked};saveLocal('settings',state.settings);draw();return;}
 if(el.dataset.delay){const k=el.dataset.delay,num=Number(el.value);if(!Number.isInteger(num)||num<0||num>3650){toast('Отсрочка должна быть от 0 до 3650 дней');draw();return;}
 state.settings[k]={...(state.settings[k]||{tracked:false}),delay:num};saveLocal('settings',state.settings);draw();return;}
 if(el.dataset.docSelect)return updateDocument(el.dataset.key,el.dataset.docSelect,'check',el.checked);
 if(el.dataset.docAmount)return updateDocument(el.dataset.key,el.dataset.docAmount,'value',el.value);
});
document.addEventListener('input',e=>{const el=e.target;
 if(el.hasAttribute('data-doc-amount')||el.hasAttribute('data-budget-org')){formatMoneyField(el);if(el.hasAttribute('data-budget-org'))(state.budgetInput??={})[orgBudgetKey(el.dataset.budgetOrg)]=el.value;return;}
 if(el.id==='supplier-search'||el.id==='payment-search'){
 const field=el.id==='supplier-search'?'search':'paymentSearch';state[field]=el.value;
 // Debounce listing; never rebuild input on each keystroke before it loses caret.
 clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>{const focused=document.activeElement===el,pos=el.selectionStart;draw();const input=$(el.id);if(focused&&input){input.focus();try{input.setSelectionRange(pos,pos);}catch(_){}}},190);
 }});
document.addEventListener('toggle',e=>{const details=e.target;if(details.matches?.('[data-vendor]')){if(details.open)state.openVendors.add(details.dataset.vendor);else state.openVendors.delete(details.dataset.vendor);}},true);
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(pages[p]&&state.page!==p){state.reconcileVendor='';state.page=p;draw();}});
(async function start(){state.settings=readLocal('settings',{});state.plans=readLocal('plans',{});state.date=readLocal('selected-date',null);
 try{db=await openDb();await refreshSnapshots();if(!state.snapshot&&state.snapshots.length){state.date=state.snapshots[0].date;state.snapshot=state.snapshots[0];}}catch(e){db=null;toast('Не удалось открыть хранилище: '+e.message,8000);}
 state.page=pages[location.hash.slice(1)]?location.hash.slice(1):(state.snapshot?'payments':'import');draw();})();
})();
