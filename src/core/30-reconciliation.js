  function reconcileReport(report) {
    const issues=[],orgSummaries=[];
    for(const org of report.organizations) {
      let sumSup=0;
      for(const sup of org.suppliers) {
        const sumDocs=sup.documents.reduce((s,d)=>s+d.amountCents,0);
        const amount=sup.reportedBalanceCents??sumDocs;
        sumSup+=amount;
        if(sup.reportedBalanceCents!==null && amount!==sumDocs)
          issues.push({kind:'supplier',org:org.name,supplier:sup.name,reported:amount,details:sumDocs,difference:amount-sumDocs,reason:sup.documents.length?'Итог поставщика отличается от суммы документов':'Долг без расшифровки документов'});
        else if(!sup.documents.length && amount!==0)
          issues.push({kind:'supplier',org:org.name,supplier:sup.name,reported:amount,details:0,difference:amount,reason:'Нет расшифровки документов'});
      }
      if(org.reportedBalanceCents!==null && sumSup!==org.reportedBalanceCents)
        issues.push({kind:'organization',org:org.name,supplier:'',reported:org.reportedBalanceCents,details:sumSup,difference:org.reportedBalanceCents-sumSup,reason:'Итог организации отличается от суммы поставщиков'});
      orgSummaries.push({name:org.name,reportedBalanceCents:org.reportedBalanceCents,sumSuppliersCents:sumSup});
    }
    return {issues,orgSummaries};
  }
  // ВОЛМАКС: гипотетическое распределение ОСТАТКА 1С по поступлениям от НОВЫХ к СТАРЫМ.
  // Не является доказательством погашения конкретной накладной: для такого факта нужен регистр зачётов 1С.
