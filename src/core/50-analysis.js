  function analyze(report, date, settings, plans={}) {
    if (!validDate(date)) throw new Error('Не указана корректная дата среза');
    const reconciliation=reconcileReport(report),rows=[];
    for(const org of report.organizations) for(const sup of org.suppliers){
      const k=supplierKey(org.name,sup.name),setting=settings[k]||{},tracked=!!setting.tracked;
      const delay=Math.max(0,Math.floor(Number(setting.delay)||0));
      const docTotal=sup.documents.reduce((s,d)=>s+d.amountCents,0);
      const balance=sup.reportedBalanceCents??docTotal, debt=Math.max(0,-balance);
      // Незадействованные поставщики не требуют тяжёлой сортировки тысяч накладных.
      if(!tracked){rows.push({org:org.name,supplier:sup.name,key:k,tracked:false,delay,
        balanceCents:balance,debtCents:debt,leftCents:debt,dueCents:0,plannedCents:0,
        documents:[],allocatedDocuments:[],flags:balance!==docTotal?['Сальдо не совпадает с документами']:[]});continue;}
      const prior=plans[date+'¦'+k]||{};
      const hasPrior=!!(prior.amountCents||Object.keys(prior.items||{}).length);
      const planNeedsReview=hasPrior && (!prior.items || (!!report.fingerprint && prior.sourceFingerprint!==report.fingerprint) || (prior.delayDays!==undefined && prior.delayDays!==delay));
      const plan=prior||{};
      const rawAllocation=allocateNewestFirst(sup.documents,debt,delay,date);
      // ВАЖНО: локальное подтверждение влияет только на текущий снимок и текущую дату;
      // новая выгрузка 1С уже содержит новые операции, повторного списания быть не должно.
      const credited=plan.status==='paid'&&!planNeedsReview?plan.items||{}:{};
      const allocations=rawAllocation.documents.map(d=>{
        const used=Number(credited[d.id]||0);
        const localUsed=Number.isSafeInteger(used)&&used>0?Math.min(used,d.allocatedCents):0;
        return {...d,paidLocalCents:localUsed,remainingCents:d.allocatedCents-localUsed};
      });
      const localPaid=allocations.reduce((s,d)=>s+d.paidLocalCents,0);
      const left=debt-localPaid;
      const due=allocations.filter(d=>d.dueNow).reduce((s,d)=>s+d.remainingCents,0);
      const overdue=allocations.filter(d=>d.overdue).reduce((s,d)=>s+d.remainingCents,0);
      const future=allocations.filter(d=>d.dueDate&&d.dueDate>date).reduce((s,d)=>s+d.remainingCents,0);
      const unknown=allocations.filter(d=>!d.dueDate).reduce((s,d)=>s+d.remainingCents,0);
      const undatedCount=allocations.filter(d=>!d.dueDate).length;
      const futureDatedReceipts=allocations.filter(d=>d.incomingDate&&d.incomingDate>date).length;
      const docsDifference=balance-docTotal;
      const paidIn1C=sup.documents.filter(d=>d.kind==='payment').reduce((s,d)=>s+d.amountCents,0);
      const plusItems=sup.documents.filter(d=>d.amountCents>0).reduce((s,d)=>s+d.amountCents,0);
      const activePlan=plan.status==='approved'&&!planNeedsReview ? plan.items||{}:{};
      const planned=Object.values(activePlan).reduce((s,c)=>s+Number(c||0),0);
      const legacy=!!prior.amountCents&&!prior.items;
      const hasResidual=rawAllocation.unmatchedCents>0;
      const flags=[];
      if(docsDifference!==0)flags.push('Не совпадает сальдо 1С и документов');
      if(hasResidual)flags.push('Часть долга не распределена по поступлениям');
      if(undatedCount>0)flags.push('Поступления без входящей даты — порядок может быть неточным');
      if(futureDatedReceipts>0)flags.push('Поступления датированы позже даты среза — проверить отчёт');
      if(planNeedsReview)flags.push(legacy?'Старый план по поставщику — создать выбор по документам':'План из другого среза — согласовать заново');
      if(debt>0&&!allocations.length)flags.push('Нет поступлений для распределения');
      const requiresAllocation=docsDifference!==0||hasResidual||undatedCount>0||futureDatedReceipts>0;
      rows.push({org:org.name,supplier:sup.name,key:k,tracked,delay,balanceCents:balance,debtCents:debt,leftCents:left,
        allocatedCents:rawAllocation.allocatedCents,unmatchedCents:rawAllocation.unmatchedCents,
        dueCents:due,dueLowerCents:due,dueGrossCents:due,overdueCents:overdue,futureCents:future,
        paidIn1CCents:paidIn1C,creditsCents:plusItems,localPaidCents:localPaid,
        unknownDateCents:unknown,missingDateCount:undatedCount,futureDatedCount:futureDatedReceipts,unallocatedCents:docsDifference,
        documents:allocations,allocatedDocuments:allocations,
        paymentDocuments:sup.documents.filter(d=>d.kind==='payment'),otherDocuments:sup.documents.filter(d=>d.kind==='other'),
        requiresAllocation,planNeedsReview,plan,plannedCents:planned,flags});
    }
    const active=rows.filter(r=>r.tracked),totals={debtCents:0,leftCents:0,dueCents:0,futureCents:0,
      plannedCents:0,paidCents:0,paidIn1CCents:0,overdueCents:0,unmatchedCents:0,activeSuppliers:active.length};
    for(const r of active){totals.debtCents+=r.debtCents;totals.leftCents+=r.leftCents;
      totals.dueCents+=r.dueCents;totals.futureCents+=r.futureCents;
      totals.plannedCents+=r.plannedCents;totals.paidCents+=r.localPaidCents;
      totals.paidIn1CCents+=r.paidIn1CCents;totals.overdueCents+=r.overdueCents;
      totals.unmatchedCents+=r.unmatchedCents;}
    return {rows,active,totals,reconciliation};
  }
