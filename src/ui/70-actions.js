function navigate(page){if(!pages[page])page='overview';state.page=page;location.hash=page;draw();window.scrollTo({top:0,behavior:'instant'});}
function currentRow(k){if(!state.snapshot)return null;return C.analyze(state.snapshot,state.date,state.settings,state.plans).active.find(r=>r.key===k)||null;}
function getPlan(r){const prev=state.plans[planId(r.key)]||{};
 if(prev.status==='paid'&&!r.planNeedsReview)throw Error('Оплата уже отмечена в этом срезе; повторное редактирование запрещено');
 if(prev.status==='approved'&&!r.planNeedsReview)throw Error('Сначала верните утверждённый план в черновик');
 if(r.planNeedsReview)return {items:{},status:'draft'};
 return {items:{...(prev.items||{})},status:'draft'};
}
function savePlan(r,plan){plan.sourceFingerprint=state.snapshot.fingerprint;plan.delayDays=r.delay;plan.changedAt=new Date().toISOString();state.plans[planId(r.key)]=plan;saveLocal('plans',state.plans);draw();}
function checkTotal(r,items){const docs=new Map(r.allocatedDocuments.map(d=>[d.id,d]));let sum=0;
 for(const [id,value] of Object.entries(items)){const d=docs.get(id);if(!d)throw Error('Документ больше не найден — обновите выбор');if(!Number.isSafeInteger(value)||value<=0||value>d.remainingCents)throw Error('Сумма по документу должна быть больше нуля и не превышать его остаток');sum+=value;}
 if(sum>r.leftCents)throw Error('Выбрано больше конечной задолженности поставщика по 1С');return sum;}
function updateDocument(k,id,mode,value){const r=currentRow(k);if(!r)return toast('Нет поставщика в текущем срезе');
 try{const p=getPlan(r),d=r.allocatedDocuments.find(d=>d.id===id);
 if(!d||d.allocatedCents<=0)throw Error('Нельзя выбрать документ без долга');
 if(mode==='check'){if(value){const val=C.cents([...document.querySelectorAll('[data-doc-amount]')].find(x=>x.dataset.docAmount===id)?.value);
 if(val===null||val<=0||val>d.remainingCents)throw Error('Укажите сумму от 0,01 до остатка документа');p.items[id]=val;}else delete p.items[id];}
 else {const val=C.cents(value);if(val===null||val<0||val>d.remainingCents)throw Error('Неверная сумма: допустимо от нуля до '+rub(d.remainingCents));if(val===0)delete p.items[id];else p.items[id]=val;}
 checkTotal(r,p.items);state.openVendors.add(k);savePlan(r,p);
 }catch(e){toast('Ошибка: '+e.message,6500);draw();}}
function action(k,act){const r=currentRow(k);if(!r)return toast('Нет поставщика');
 const prev=state.plans[planId(k)]||{},current=r.plan||{};
 try{
 if(act==='select-due'||act==='clear'){
 const p=getPlan(r);if(act==='clear')p.items={};else for(const d of r.allocatedDocuments){if(d.allocatedCents>0&&d.dueNow&&d.remainingCents>0)p.items[d.id]=d.remainingCents;}
 checkTotal(r,p.items);state.openVendors.add(k);savePlan(r,p);return;
 }
 if(act==='reopen'){
 if(prev.status!=='approved'||r.planNeedsReview)throw Error('Нельзя изменить этот план, сначала перепроверьте срез');
 if(!confirm('Вернуть утверждённые суммы в черновик для редактирования?'))return;
 state.plans[planId(k)]={...prev,status:'draft',changedAt:new Date().toISOString()};saveLocal('plans',state.plans);draw();return;
 }
 if(act==='approve'){
 if(r.planNeedsReview)throw Error('Изменился отчёт или отсрочка: пересоздайте выбор по документам');
 const sum=checkTotal(r,prev.items||{});if(!sum)throw Error('Сначала выберите документы галочками');
 if(r.unmatchedCents>0||r.unallocatedCents!==0)throw Error('Долг по поставщику не сошёлся с документами 1С. Сначала нужна сверка');
 if(!confirm('Утвердить '+rub(sum)+' по '+r.supplier+'? Это локальное согласование, без перевода денег. Распределение «новые → старые» расчётное, не подтверждённое зачётами 1С.'))return;
 state.plans[planId(k)]={...prev,status:'approved',changedAt:new Date().toISOString(),sourceFingerprint:state.snapshot.fingerprint,delayDays:r.delay};saveLocal('plans',state.plans);toast('Документы утверждены для реестра');draw();return;
 }
 if(act==='paid'){
 if(prev.status!=='approved'||r.planNeedsReview)throw Error('Отметить оплаченным можно только утверждённый текущий платёж');
 const sum=checkTotal(r,prev.items||{});if(!sum)throw Error('Сумма не найдена');
 if(!confirm('Подтвердить, что '+rub(sum)+' фактически переведено ВНЕ приложения? Действие сохраняется как локальная отметка на этом срезе.'))return;
 state.plans[planId(k)]={...prev,status:'paid',paidAt:new Date().toISOString()};saveLocal('plans',state.plans);toast('Оплата отмечена; новый отчёт 1С не вычитает её повторно');draw();return;
 }
 }catch(e){toast('Ошибка: '+e.message,7000);}}
