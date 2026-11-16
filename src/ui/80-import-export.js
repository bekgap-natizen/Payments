async function fingerprint(file){const bytes=new Uint8Array(await file.arrayBuffer());if(crypto?.subtle){const dig=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(dig),x=>x.toString(16).padStart(2,'0')).join('');}
 let x=2166136261;for(const b of bytes)x=Math.imul(x^b,16777619);return 'fnv-'+(x>>>0).toString(16)+'-'+file.size;}
async function importReport(){const file=$('excel-file')?.files?.[0],day=$('report-date')?.value;if(!file)return toast('Выберите Excel-файл 1С');if(!C.validDate(day))return toast('Укажите дату среза 1С');const btn=$('import-button'),progress=$('import-progress');
 btn.disabled=true;btn.textContent='Обрабатываем файл…';progress.textContent='Чтение ведомости';
 try{const fp=await fingerprint(file),old=state.snapshots.find(x=>x.date===day);
 if(old&&old.fingerprint===fp){state.date=day;saveLocal('selected-date',day);await refreshSnapshots();toast('Этот срез уже сохранён. Повторная загрузка не удваивает суммы.');navigate('overview');return;}
 if(old&&!confirm('За '+fmtDate(day)+' уже загружен другой файл. Заменить? Утверждённые суммы пометятся для повторной проверки.'))return;
 const data=await C.parseXlsx(file);
 if(!data.organizations.length||data.errors.some(e=>/структура ведомости|уровни группировки/.test(e)))throw Error(data.errors.join('; '));
 const record={date:day,fingerprint:fp,importedAt:new Date().toISOString(),...data};await dbPut(record);state.date=day;saveLocal('selected-date',day);await refreshSnapshots();
 toast(`Срез обработан: ${data.audit.orgs} организаций, ${data.audit.suppliers} поставщиков, ${data.audit.docs} документов`,7000);navigate('overview');
 }catch(e){toast('Ошибка: '+e.message,10000);}finally{btn.disabled=false;btn.textContent='Обработать и сохранить';progress.textContent='';}}
async function exportXlsx(){if(!state.snapshot)return;
 try{const model=C.analyze(state.snapshot,state.date,state.settings,state.plans);
 if(!approvedRows(model).length)throw Error('Нет утверждённых к оплате документов: отметьте позиции и нажмите «Утвердить выбранное»');
 const blob=PaymentExport.makeXlsx(model,state.date,{filename:state.snapshot.name,fingerprint:state.snapshot.fingerprint});
 const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='ВОЛМАКС_Платежи_'+state.date+'.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);
 toast('Excel сформирован: общий долг, платёжный лист, документы и сверка');
 }catch(e){toast('Ошибка экспорта: '+e.message,7500);}}
