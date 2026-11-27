// Display the same reasons that block the existing payment selection; never add or change accounting rules.
function paymentReviewReasons(r){
 const reasons=[];
 if(r.unallocatedCents)reasons.push({text:'Сальдо 1С не совпадает с суммой документов',amount:Math.abs(r.unallocatedCents),label:'Разница'});
 if(r.unmatchedCents>0)reasons.push({text:'Часть долга не распределена по поступлениям',amount:r.unmatchedCents,label:'Нераспределённый долг'});
 if(r.futureDatedCount>0){
  const docs=r.allocatedDocuments.filter(d=>d.incomingDate&&d.incomingDate>state.date);
  reasons.push({text:'Поступления датированы позже даты среза ('+r.futureDatedCount+')',amount:docs.reduce((n,d)=>n+d.allocatedCents,0),label:'Расчётный остаток по этим поступлениям'});
 }
 if(r.planNeedsReview){
  const value=selectedSum(r)||r.plan.amountCents||0;
  reasons.push({text:r.plan.items?'План из другого среза или изменилась отсрочка — согласовать заново':'Старый план без выбора по документам — создать выбор заново',amount:value,label:'Сумма прежнего плана'});
 }
 if(!reasons.length){
  let reason='Выбранные документы требуют проверки';
  try{checkTotal(r,selectedItems(r));}catch(e){reason=e.message;}
  reasons.push({text:reason,amount:selectedSum(r),label:'Сумма выбранных документов'});
 }
 return reasons;
}
function reviewReasonHtml(r){
 return paymentReviewReasons(r).map(reason=>'<div>'+esc(reason.text)+' · '+esc(reason.label)+': <b>'+rub(reason.amount)+'</b></div>').join('');
}
function paymentReviewAlert(rows){
 const unique=[...new Map(rows.map(r=>[r.key,r])).values()];
 if(!unique.length)return '';
 return '<div class="alert amber" id="payment-review-alert"><div><b>Требуют проверки: '+unique.length+'</b> · Спорные платежи исключены из реестра.</div>'+unique.map(r=>'<div class="payment-review-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:9px;padding-top:9px;border-top:1px solid rgba(165,108,34,.18)"><div style="flex:1 1 250px;min-width:0;overflow-wrap:anywhere"><b>'+esc(r.org)+' — '+esc(r.supplier)+'</b><div>'+reviewReasonHtml(r)+'</div></div><button type="button" class="btn btn-sm" data-reconcile-vendor="'+esc(r.key)+'">Сверка</button></div>').join('')+'</div>';
}
function renderFocusedReconciliation(model,r){
 const issues=model.reconciliation.issues.filter(i=>i.kind==='supplier'&&i.org===r.org&&i.supplier===r.supplier);
 const selected=selectedSum(r)||r.plan.amountCents||0;
 const actual=r.balanceCents;
 return header('Контроль и сверка','Проверка конкретного поставщика · '+fmtDate(state.date),'<button class="btn" data-page="reconcile">Все расхождения</button><button class="btn" data-page="payments">Вернуться к платежам</button>')+
 '<div class="card"><div class="card-head"><h2>'+esc(r.supplier)+'</h2><span class="sub">'+esc(r.org)+'</span></div><div class="card-body"><div class="ledger-ribbon"><div><span>Долг по 1С</span><b>'+rub(r.debtCents)+'</b></div><div><span>По сроку</span><b>'+rub(r.dueCents)+'</b></div><div><span>Выбрано к оплате (исключено)</span><b>'+rub(selected)+'</b></div></div><div class="alert amber">'+reviewReasonHtml(r)+'</div>'+
 (issues.length?'<div class="table-scroll"><table><thead><tr><th>Сальдо 1С</th><th>Сумма документов</th><th>Разница (1С − документы)</th></tr></thead><tbody>'+issues.map(i=>'<tr><td>'+rub(i.reported)+'</td><td>'+rub(i.details)+'</td><td>'+rub(i.difference)+'</td></tr>').join('')+'</tbody></table></div>':'')+
 (r.futureDatedCount>0?'<div class="table-scroll"><table><thead><tr><th>Входящий документ</th><th>Дата</th><th>Расчётный остаток</th></tr></thead><tbody>'+r.allocatedDocuments.filter(d=>d.incomingDate&&d.incomingDate>state.date).map(d=>'<tr><td>'+esc(d.incomingNumber||'Без номера')+'</td><td>'+fmtDate(d.incomingDate)+'</td><td>'+rub(d.allocatedCents)+'</td></tr>').join('')+'</tbody></table></div>':'')+
 '<p class="fine">Сверка не изменяет данные 1С и не отправляет платежи. '+(r.unallocatedCents||r.unmatchedCents||r.futureDatedCount?'Проверьте ведомость и при необходимости загрузите исправленный отчёт 1С. ':'')+(r.planNeedsReview?'После проверки среза заново согласуйте выбор документов. ':'')+(!paymentBlocked(r)?'Проверьте выбранные документы и их суммы.':'')+'</p></div></div>';
}
function renderReconcile(model){if(!model)return header('Контроль и сверка','Сальдо организации, поставщиков и документов')+missing();
 const focused=state.reconcileVendor&&model.active.find(r=>r.key===state.reconcileVendor);
 if(focused&&(paymentBlocked(focused)||paymentSelection(model).blocked.some(r=>r.key===focused.key)))return renderFocusedReconciliation(model,focused);
 const issues=model.reconciliation.issues;
 return header('Контроль и сверка',`Срез ${fmtDate(state.date)} · ${state.snapshot.audit.docs.toLocaleString('ru-RU')} строк документов · ${issues.length} расхождений`)+
 `<div class="kpis">${kpi('Организации',String(state.snapshot.audit.orgs),'Считаны из 1С','▣')}${kpi('Поставщики',String(state.snapshot.audit.suppliers),'Из исходной ведомости','▤')}${kpi('Поступлений без даты',String(state.snapshot.audit.missingDates),'Могут менять срок оплаты','!')}${kpi('Нераспределённый долг',rub(model.totals.unmatchedCents),'Только выбранные контрагенты','₽')}</div>
 <div class="card"><div class="card-head"><h2>Сверка итогов организаций</h2></div><div class="table-scroll"><table><thead><tr><th>Организация</th><th class="right">Сальдо 1С (F)</th><th class="right">Сумма поставщиков</th><th class="right">Разница</th><th>Контроль</th></tr></thead><tbody>${model.reconciliation.orgSummaries.map(o=>{const diff=o.reportedBalanceCents===null?null:o.reportedBalanceCents-o.sumSuppliersCents;return `<tr><td class="name">${esc(o.name)}</td><td class="right amount">${o.reportedBalanceCents===null?'—':rub(o.reportedBalanceCents)}</td><td class="right amount">${rub(o.sumSuppliersCents)}</td><td class="right amount ${diff?'negative':''}">${diff===null?'Нет итога':rub(diff)}</td><td><span class="badge ${diff===0?'badge-good':'badge-warn'}">${diff===0?'Совпало':'Сверить'}</span></td></tr>`;}).join('')}</tbody></table></div></div>
 <div class="card"><div class="card-head"><h2>Расхождения по документам</h2><span class="sub">Не исправляются автоматически</span></div>${issues.length?`<div class="table-scroll"><table><thead><tr><th>Организация</th><th>Поставщик</th><th>Причина</th><th class="right">Разница</th></tr></thead><tbody>${issues.map(i=>`<tr><td class="muted">${esc(i.org)}</td><td class="name">${esc(i.supplier||'Итог организации')}</td><td>${esc(i.reason)}</td><td class="right amount negative">${rub(i.difference)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><p>Итоговые суммы совпадают.</p></div>`}</div>
 <div class="alert amber">Отсутствие связей зачёта между платежами и входящими документами в этой ведомости означает, что выбранная модель «от новых к старым» — управленческая гипотеза. Сумма конечного долга 1С остаётся источником истины.</div>`;}
