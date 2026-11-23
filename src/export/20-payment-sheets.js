const money=c=>num(c||0);
const titleRow=(s)=>({type:'title',values:['',s]});
const row=(type,...v)=>({type,values:['',...v]});
function makeSheetData(model,date,metadata={}){
 const fmtDate=(iso)=>/^\d{4}-\d{2}-\d{2}$/.test(iso||'')?iso.split('-').reverse().join('.'):'';
 const active=[...model.active].sort((a,b)=>a.org.localeCompare(b.org,'ru')||a.supplier.localeCompare(b.supplier,'ru'));
 if(!active.length)throw new Error('Сначала добавьте действующих поставщиков');
 const approved=active.filter(r=>r.plan?.status==='approved'&&!r.planNeedsReview&&r.plannedCents>0);
 if(!approved.length)throw new Error('Согласованных документов к оплате нет');
 const demo=metadata.testMode?' · ТЕСТ — НЕ ДЛЯ ОПЛАТЫ':'';
 const summary=[titleRow('ВОЛМАКС · Задолженность'+demo),row('section','Отчёт на '+fmtDate(date),'','Источник '+(metadata.filename||'1С')),
  row('warning','Бухгалтерское сальдо 1С уже учитывает ранее проведённые оплаты — повторный вычет запрещён'),
  row('header','Организация / Поставщик','Долг 1С, ₽','Разнесено по поступлениям, ₽','По сроку, ₽','Будущие, ₽','Не разнесено, ₽','Утверждено, ₽','Примечание')];
 const dated=[titleRow('ВОЛМАКС · Платежи на '+fmtDate(date)+demo),
  row('section','Подтверждённый реестр · не банковское поручение'),
  row('warning','Нажмите «+» для раскрытия входящих документов'),
  row('header','Организация / Поставщик','К оплате, ₽','Документов','Дата платежа')];
 const docs=[titleRow('ВОЛМАКС · Расшифровка'+demo),
  row('section','Сальдо каждого поставщика распределено по поступлениям от новых к старым'),
  row('warning','Не является подтверждением фактического зачёта конкретных документов: нужна детализация 1С'),
  row('header','Организация','Поставщик','Вид операции','Входящий документ','Дата входящая','Дата по отсрочке','Сумма (расчётная), ₽','К оплате, ₽','Примечание')];
 const reconciliation=[titleRow('ВОЛМАКС · Сверка'+demo),
  row('section','Контрольные суммы на '+fmtDate(date)),
  row('warning','Расхождения не исправляются автоматически'),
  row('header','Организация','Поставщик','Итог 1С, ₽','Сумма документов, ₽','Разница, ₽','Замечание','','')];
 const orgs=[...new Set(active.map(r=>r.org))];
 for(const org of orgs){const vendors=active.filter(r=>r.org===org);
  summary.push(row('org',org));
  for(const r of vendors){
   summary.push(row('supplier',r.supplier,money(r.debtCents),money(r.allocatedCents),money(r.dueCents),money(r.futureCents),money(r.unmatchedCents),money(r.plannedCents),r.flags.join('; ')||'—'));
   for(const d of [...r.documents].reverse()){
     const kind=d.allocatedCents?d.dueDate&&d.dueDate<=date?'Срок наступил':'Будущий':'Вне расчётного остатка';
     const comment=`Строка ${d.row}; исходно ${money(d.originalCents)}; расчётно покрыто ${money(d.coveredCents)}; ${kind}`;
     docs.push(row('',r.org,r.supplier,'Поступление',d.incomingNumber||'—',fmtDate(d.incomingDate),fmtDate(d.dueDate),money(d.allocatedCents),money(r.plan?.status==='approved'&&!r.planNeedsReview?r.plan.items?.[d.id]:0),comment));
   }
   for(const d of r.paymentDocuments)docs.push(row('',r.org,r.supplier,'Платёж в 1С',d.sourceDocument||'—','','',money(d.amountCents),'','Уже включено в конечное сальдо поставщика 1С, НЕ вычитать повторно'));
   for(const d of r.otherDocuments)docs.push(row('',r.org,r.supplier,'Корректировка',d.sourceDocument||'—','','',money(d.amountCents),'','Включено в конечное сальдо 1С'));

  }
  summary.push(row('total','ИТОГО '+org,money(vendors.reduce((n,r)=>n+r.debtCents,0)),money(vendors.reduce((n,r)=>n+r.allocatedCents,0)),money(vendors.reduce((n,r)=>n+r.dueCents,0)),money(vendors.reduce((n,r)=>n+r.futureCents,0)),money(vendors.reduce((n,r)=>n+r.unmatchedCents,0)),money(vendors.reduce((n,r)=>n+r.plannedCents,0))));

 }
 // Keep organization and supplier ordering unchanged; reverse only documents inside a supplier.
 // Allocation and 1C balances are never reordered or recalculated here.
 const datedVendors=approved;
 const datedOrgs=[...new Set(datedVendors.map(r=>r.org))];
 const orgTotals=[];
 for(const org of datedOrgs){
   dated.push(row('org',org));
   const subtotalRefs=[];
   for(const r of datedVendors.filter(r=>r.org===org)){
     const items=r.plan.items||{};
     const selected=r.documents.filter(d=>(items[d.id]||0)>0).slice().reverse();
     const subtotal=selected.reduce((n,d)=>n+items[d.id],0);
     if(subtotal!==r.plannedCents)throw Error('Сумма документов не совпадает с реестром');
     const supplierRow=row('supplier',r.supplier,money(subtotal),selected.length,fmtDate(date));
     if(selected.length)supplierRow.collapsed=true;
     dated.push(supplierRow);
     subtotalRefs.push(`C${dated.length}`);
     // In-sheet outline: supplier is the summary row ABOVE its hidden child payments.
     // All selected payment documents remain available as expandable rows here.
     for(const d of selected){
       const amount=items[d.id];
       if(!Number.isSafeInteger(amount)||amount<=0)throw Error('Неверная сумма выбранного документа');
       const detail=row('detail','  № '+(d.incomingNumber||'Без номера')+' от '+fmtDate(d.incomingDate),money(amount),'',fmtDate(d.dueDate));
       detail.level=1;
       detail.hidden=true;
       dated.push(detail);
     }
   }
   const total=datedVendors.filter(r=>r.org===org).reduce((n,r)=>n+r.plannedCents,0);
   dated.push(row('total','ИТОГО '+org,{formula:`SUM(${subtotalRefs.join(',')})`,cached:money(total)},'',''));
   orgTotals.push(`C${dated.length}`);
 }
 const sumApproved=approved.reduce((n,r)=>n+r.plannedCents,0);
 dated.push(row('total','ВСЕГО К ОПЛАТЕ',{formula:`SUM(${orgTotals.join(',')})`,cached:money(sumApproved)},'',''));
 // Machine-readable check row makes a difference explicit; no green status if not equal.
 reconciliation.push(row('section','Согласовано (поставщики): '+money(sumApproved)+' ₽','','Документы: '+money(approved.reduce((n,r)=>n+Object.values(r.plan.items||{}).reduce((s,v)=>s+v,0),0))+' ₽'));
 for(const issue of model.reconciliation.issues)reconciliation.push(row('warning',issue.org,issue.supplier||'Итог организации',money(issue.reported),money(issue.details),money(issue.difference),issue.reason));
 for(const r of active.filter(r=>r.unmatchedCents>0))reconciliation.push(row('warning',r.org,r.supplier,money(r.debtCents),money(r.allocatedCents),money(r.unmatchedCents),'Долг не распределён по поступлениям'));
 if(reconciliation.length===5)reconciliation.push(row('total','Контрольные расхождения не обнаружены'));
 const day=date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(2,4);
 return [[day,dated]];
}
