  function allocateNewestFirst(documents, debtCents, delay, reportDate){
    if(!Number.isSafeInteger(debtCents)||debtCents<0)throw new Error('Неправильный остаток долга');
    const sorted=documents.filter(d=>d.kind==='receipt'&&d.amountCents<0)
      .map(d=>({...d,id:'doc-'+d.row+'-'+String(d.incomingNumber||'').replace(/[^a-zA-Zа-яА-Я0-9-]/g,'').slice(0,45),
        originalCents:-d.amountCents,dueDate:addDays(d.incomingDate,delay)}))
      .sort((a,b)=>(b.incomingDate||'0000-00-00').localeCompare(a.incomingDate||'0000-00-00') || (b.row||0)-(a.row||0));
    let remainder=debtCents;
    const allocated=sorted.map(d=>{const amount=Math.min(d.originalCents,remainder);remainder-=amount;
      return {...d,allocatedCents:amount,coveredCents:d.originalCents-amount,
        dueNow:!!d.dueDate&&d.dueDate<=reportDate,
        overdue:!!d.dueDate&&d.dueDate<reportDate};});
    const allocatedTotal=debtCents-remainder;
    if(allocatedTotal!==allocated.reduce((n,d)=>n+d.allocatedCents,0))throw new Error('Ошибка контрольной суммы распределения');
    return {documents:allocated,allocatedCents:allocatedTotal,unmatchedCents:remainder};
  }
