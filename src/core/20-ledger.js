  function reportFromRows(source, name) {
    let currentOrg=null,currentSupplier=null;
    const organizations=[],errors=[],audit={docs:0,suppliers:0,orgs:0,missingDates:0,withoutBalances:0};
    let hasOutlines=false;
    for(const line of source.rows) {
      const {row,level,cells}=line,b=String(cells.B||'').trim();
      if(level>0)hasOutlines=true;
      if(row<=11||!b)continue;
      if(level===0) {
        if(key(b)==='ИТОГ'){currentOrg=null;currentSupplier=null;continue;}
        currentOrg={name:b,row,reportedBalanceCents:cells.FCents??null,suppliers:[]};
        organizations.push(currentOrg);audit.orgs++;currentSupplier=null;
      } else if(level===1) {
        if(!currentOrg) {errors.push(`Строка ${row}: поставщик без организации`);continue;}
        currentSupplier={name:b,row,reportedBalanceCents:cells.FCents??null,documents:[]};
        currentOrg.suppliers.push(currentSupplier);audit.suppliers++;
      } else if(level===2) {
        if(!currentSupplier) {errors.push(`Строка ${row}: документ без поставщика`);continue;}
        const amount=cells.FCents??0;
        if(cells.FCents===null || cells.FCents===undefined){audit.withoutBalances++;continue;}
        const info=parseIncomingField(cells.C);
        const isReceipt=/^Поступление\s+(товаров|услуг)/i.test(b);
        if(isReceipt&&amount<0&&!info.incomingDate)audit.missingDates++;
        currentSupplier.documents.push({row,sourceDocument:b,incomingRaw:String(cells.C||''),incomingNumber:info.incomingNumber,incomingDate:info.incomingDate,amountCents:amount,kind:isReceipt?'receipt':/^Платежное поручение исходящее/i.test(b)?'payment':'other',error:isReceipt&&amount<0?info.error:null});
        audit.docs++;
      }
    }
    if(!hasOutlines)errors.push('Не найдены уровни группировки строк 1С. Импорт остановлен: структура ведомости не распознана.');
    if(!organizations.length)errors.push('Не удалось распознать организации в выгрузке.');
    if(source.badMoney) errors.push(`В ${source.badMoney} ячейках не удалось прочитать денежное значение.`);
    return {name,organizations,errors,audit};
  }
