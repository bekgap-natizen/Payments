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
 const dated=[titleRow('ВОЛМАКС · Платежи на '+fmtDate(date)+demo),
  row('section','Подтверждённый реестр · не банковское поручение'),
  row('warning','Нажмите «+» для раскрытия входящих документов'),
  row('header','Организация / Поставщик','К оплате, ₽','Документов','Дата платежа')];
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
 const day=date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(2,4);
 return [[day,dated]];
}
