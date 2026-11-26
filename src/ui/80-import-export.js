async function fingerprint(file){const bytes=new Uint8Array(await file.arrayBuffer());if(crypto?.subtle){const dig=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(dig),x=>x.toString(16).padStart(2,'0')).join('');}
 let x=2166136261;for(const b of bytes)x=Math.imul(x^b,16777619);return 'fnv-'+(x>>>0).toString(16)+'-'+file.size;}
let importBusy=false;
async function importReport(file,day){
 if(importBusy){toast('Ошибка: загрузка другого файла уже выполняется');return;}
 if(!file)return toast('Выберите Excel-файл 1С');
 if(!C.validDate(day))return toast('Укажите дату среза 1С');
 importBusy=true;
 const input=$('excel-file'),progress=$('import-progress');
 if(input)input.disabled=true;
 if(progress)progress.textContent='Обрабатываем '+file.name+'…';
 try{
 const fp=await fingerprint(file),old=state.snapshots.find(x=>x.date===day);
 if(old&&old.fingerprint===fp){state.date=day;saveLocal('selected-date',day);await refreshSnapshots();toast('Этот срез уже сохранён. Повторная загрузка не удваивает суммы.');navigate('payments');return;}
 if(old&&!await appConfirm('За '+fmtDate(day)+' уже загружен другой файл. Заменить? Утверждённые суммы пометятся для повторной проверки.'))return;
 if(progress)progress.textContent='Чтение и проверка ведомости…';
 const data=await C.parseXlsx(file);
 if(!data.organizations.length||data.errors.some(e=>/структура ведомости|уровни группировки/.test(e)))throw Error(data.errors.join('; '));
 const record={date:day,fingerprint:fp,importedAt:new Date().toISOString(),...data};
 await dbPut(record);
 state.date=day;saveLocal('selected-date',day);await refreshSnapshots();
 toast(`Срез обработан: ${data.audit.orgs} организаций, ${data.audit.suppliers} поставщиков, ${data.audit.docs} документов`,7000);
 navigate('payments');
 }catch(e){toast('Ошибка: '+e.message,10000);}
 finally{importBusy=false;if(input){input.disabled=false;input.value='';}if(progress)progress.textContent='';}
}
async function exportXlsx(){if((typeof approvalHosted==='function'&&approvalHosted()))return toast('Скачайте утверждённый реестр в разделе согласования');if(!state.snapshot)return;
 try{const model=C.analyze(state.snapshot,state.date,state.settings,state.plans);
 const selection=paymentSelection(model);
 if(!selection.cents)throw Error('Нет выбранных платежей без расхождений');
 if(!await appConfirm('Подтвердить реестр на '+rub(selection.cents)+' по '+selection.eligible.length+' поставщикам? Все организации, независимо от фильтра. Спорные суммы исключены. Деньги не переводятся.'))return;
 const next={...state.plans};for(const r of selection.eligible){next[planId(r.key)]={...r.plan,status:'approved',sourceFingerprint:state.snapshot.fingerprint,delayDays:r.delay,changedAt:new Date().toISOString()};}
 const finalModel=C.analyze(state.snapshot,state.date,state.settings,next);
 const approved=finalModel.active.filter(r=>selection.eligible.some(x=>x.key===r.key));
 const exportModel={...finalModel,active:finalModel.active.map(r=>approved.includes(r)?r:{...r,plan:{...r.plan,status:'excluded'},plannedCents:0})};
 if(approved.reduce((n,r)=>n+r.plannedCents,0)!==selection.cents)throw Error('Итог реестра не совпал с выбранной суммой');
 const blob=PaymentExport.makeXlsx(exportModel,state.date,{filename:state.snapshot.name,fingerprint:state.snapshot.fingerprint});
 state.plans=next;saveLocal('plans',state.plans);draw();
 const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download='ВОЛМАКС_Платежи_'+state.date+'.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);
 toast('Excel сформирован: один лист с платежами и раскрываемыми документами');
 }catch(e){toast('Ошибка экспорта: '+e.message,7500);}}
