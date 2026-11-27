function selectedItems(r){const p=r.plan||{};return p.items||{};}
function selectedSum(r){return Object.values(selectedItems(r)).reduce((n,x)=>n+Number(x||0),0);}
function paidStatus(r){return r.plan.status==='paid'&&!r.planNeedsReview;}
// Display-only filter: a manual future payment is included, a deselected due payment is not.
function selectedPaymentDocument(r,d){return !paidStatus(r)&&d.allocatedCents>0&&d.remainingCents>0&&Number(selectedItems(r)[d.id]||0)>0;}
function hasSelectedPayment(r){return (r.allocatedDocuments||[]).some(d=>selectedPaymentDocument(r,d));}
function docRows(r){
 const items=selectedItems(r),locked=!r.planNeedsReview&&(r.plan.status==='paid'||r.plan.status==='approved');
 const docs=r.allocatedDocuments.filter(d=>d.allocatedCents>0&&(!state.onlyDue||selectedPaymentDocument(r,d))).slice().reverse();
 return `<div class="table-scroll"><table class="pay-doc-table"><thead><tr><th class="pick-col">✓</th><th>Входящий документ</th><th>Дата входящая</th><th>Срок оплаты</th><th class="right">Остаток расчётный</th><th class="right">Выбрано к оплате, ₽</th><th>Статус</th></tr></thead><tbody>
 ${docs.map(d=>{const checked=Object.hasOwn(items,d.id)&&Number(items[d.id])>0,remaining=d.remainingCents;
 const status=paidStatus(r)&&d.paidLocalCents>0?'Отмечено оплачено':!d.dueDate?'Нет даты':d.overdue?'Просрочено':d.dueNow?'Срок наступил':'Позднее';
 return `<tr class="${checked?'selected-pay-row':''}"><td><input class="switch" type="checkbox" data-doc-select="${esc(d.id)}" data-key="${esc(r.key)}" ${checked?'checked':''} ${locked||remaining<=0?'disabled':''} aria-label="Выбрать ${esc(d.incomingNumber||'документ')}"></td><td><div class="name">${esc(d.incomingNumber||'Без номера')}</div><div class="fine">Строка 1С ${d.row}</div></td><td>${fmtDate(d.incomingDate)}</td><td class="amount">${fmtDate(d.dueDate)}</td><td class="right amount">${rub(remaining)}</td><td class="right"><input class="control doc-money" type="text" inputmode="decimal" data-doc-amount="${esc(d.id)}" data-key="${esc(r.key)}" value="${checked?currencyInput(items[d.id]):currencyInput(remaining)}" ${locked||remaining<=0?'disabled':''} aria-label="Сумма к оплате по ${esc(d.incomingNumber||'документу')}"></td><td><span class="badge ${status==='Просрочено'?'badge-bad':status==='Срок наступил'?'badge-good':status==='Нет даты'?'badge-warn':'badge-neutral'}">${status}</span></td></tr>`;}).join('')}
 </tbody></table></div>`;
}
function vendorCard(r){const p=r.plan||{},items=selectedItems(r),chosen=selectedSum(r),approved=p.status==='approved'&&!r.planNeedsReview;
 const paid=paidStatus(r), locked=approved||paid,canApprove=!locked&&!paymentBlocked(r)&&chosen>0;
 const count=Object.values(items).filter(x=>x>0).length;
 const docs=r.allocatedDocuments.filter(d=>d.allocatedCents>0);
 const pick=supplierCheckboxState(r);const blocked=paymentBlocked(r);
 return `<details class="detail vendor-card" data-vendor="${esc(r.key)}" ${state.openVendors.has(r.key)?'open':''}><summary><div class="vendor-summary"><input class="supplier-pick" type="checkbox" data-supplier-select="${esc(r.key)}" aria-label="Выбрать поставщика ${esc(r.supplier)}" title="${pick.checked?'Снять выбор поставщика':'Распределить свободный остаток плана; без плана — по сроку'}" ${pick.checked?'checked':''} ${pick.disabled?'disabled':''}><span class="vendor-title">${esc(r.supplier)}</span><span class="vendor-metrics"><span>Долг 1С <b>${rub(r.debtCents)}</b></span><span>По сроку <b>${rub(r.dueCents)}</b></span><span class="${chosen?'positive':''}">Выбрано <b>${rub(chosen)}</b></span></span><span class="badge ${blocked?'badge-bad badge-review':paid?'badge-neutral':approved?'badge-good':count?'badge-blue':'badge-neutral'}">${blocked?'Сверить':labelOf(p.status)}</span></div></summary>
 <div class="detailbody"><div class="ledger-ribbon"><div><span>Долг по 1С</span><b>${rub(r.debtCents)}</b></div><div><span>Из него распределено</span><b>${rub(r.allocatedCents)}</b></div><div><span>К оплате по сроку</span><b>${rub(r.dueCents)}</b></div><div><span>Остаток после отметки оплаты</span><b>${rub(r.leftCents)}</b></div></div>
 ${r.flags.length?`<div class="alert amber">${esc(r.flags.join(' • '))}</div>`:''}
 <div class="vendor-tools"><div><b>Отсрочка ${r.delay} дн.</b> · ${docs.length} документов с расчётным остатком · выбрано ${count}</div><div class="section-actions"><button class="btn btn-sm" data-act="select-due" data-key="${esc(r.key)}" ${locked?'disabled':''}>✓ Выбрать по сроку</button><button class="btn btn-sm" data-act="clear" data-key="${esc(r.key)}" ${locked?'disabled':''}>Снять выбор</button></div></div>
 ${docs.length?docRows(r):'<div class="empty"><p>Нет поступлений с отрицательными остатками для распределения долга. Нельзя назначать платежи вымышленным документам.</p></div>'}
 ${r.unmatchedCents>0?`<div class="alert red">Остаток ${rub(r.unmatchedCents)} не удалось распределить по поступлениям. Нужна сверка в 1С.</div>`:''}
 <div class="plan-workflow"><div class="work-selected"><span>Выбрано документов: <b>${count}</b></span><strong>${rub(chosen)}</strong><small>Суммы можно изменить в каждой строке. Галочки не утверждают платёж.</small></div><div class="section-actions">${p.status==='approved'&&!r.planNeedsReview?`<button class="btn" data-act="reopen" data-key="${esc(r.key)}">Вернуть в черновик</button><button class="btn btn-primary" data-act="paid" data-key="${esc(r.key)}">Отметить оплачено</button>`:
 paid?'<span class="badge badge-good">Оплата отмечена в этом снимке</span>':`<button class="btn btn-primary" data-act="approve" data-key="${esc(r.key)}" ${canApprove?'':'disabled'}>✓ Утвердить выбранное</button>`}</div></div>
 </div></details>`;
}
function renderPayments(model){if(!model)return header('Платежи на дату','Отбор поступлений и утверждение отдельных сумм')+missing();
 const selection=paymentSelection(model);const review=model.active.filter(r=>r.dueCents>0&&paymentBlocked(r));
 const orgs=[...new Set(model.active.map(r=>r.org))].sort((a,b)=>a.localeCompare(b,'ru'));
 let rows=model.active.filter(r=>r.debtCents>0||r.plan.status);
 if(state.paymentOrg)rows=rows.filter(r=>r.org===state.paymentOrg);
 if(state.paymentSearch)rows=rows.filter(r=>C.key(r.supplier+' '+r.org).includes(C.key(state.paymentSearch)));
 if(state.onlyDue)rows=rows.filter(hasSelectedPayment);
 rows.sort((a,b)=>a.org.localeCompare(b.org,'ru')||b.dueCents-a.dueCents||a.supplier.localeCompare(b.supplier,'ru'));
 const names=[...new Set(rows.map(r=>r.org))];
 return header('Платежи на дату',`Дата отчёта ${fmtDate(state.date)} · платёжный реестр по выбранным документам`, `<button id="export-payments" class="btn btn-export-excel">Подтвердить и выгрузить Excel</button><button id="send-payments-mail" class="btn btn-primary">Подтвердить и отправить</button>`)+
 `<div class="kpis">${kpi('Весь долг 1С',rub((model.rows||model.active).reduce((n,r)=>n+r.debtCents,0)),'Все поставщики','₽')}${kpi('Срок оплаты наступил',rub(model.totals.dueCents),'Действующие поставщики','◷')}${kpi('К оплате — выбрано',rub(selection.cents),'Итог будущего реестра','✓')}${kpi('Уже отмечено оплачено',rub(model.totals.paidCents),'В текущем срезе','●')}</div>
 <div class="alert"><span>Платежи по сроку отмечены автоматически. Измените выбор или сумму, затем подтвердите реестр. Расчёт остатков по накладным требует сверки зачётов 1С.</span></div>
 ${paymentReviewAlert([...review,...selection.blocked])}
 ${budgetPanel(model,orgs)}<div class="toolbar"><div class="field"><label>Организация</label><select class="control" id="payment-org"><option value="">Все организации</option>${orgs.map(o=>`<option value="${esc(o)}" ${o===state.paymentOrg?'selected':''}>${esc(o)}</option>`).join('')}</select></div><div class="field"><label>Поиск поставщика</label><input id="payment-search" class="control search" value="${esc(state.paymentSearch)}" placeholder="Название поставщика"></div><label class="toggle-label"><input id="only-due" type="checkbox" ${state.onlyDue?'checked':''}> Только выбранные к оплате</label></div>
 ${!rows.length?`<div class="card"><div class="empty"><h2>${state.onlyDue?'Нет выбранных платежей':'Нет поставщиков для отображения'}</h2><p>${state.onlyDue?'Снимите фильтр, чтобы снова увидеть все документы.':'Укажите действующих контрагентов в справочнике или измените фильтры.'}</p>${state.onlyDue?'':'<button data-page="suppliers" class="btn btn-primary">Настроить поставщиков →</button>'}</div></div>`:''}
 ${names.map(org=>`<section class="org-block"><div class="org-head"><h2>${esc(org)}</h2><span>Долг: <b>${rub(rows.filter(r=>r.org===org).reduce((n,r)=>n+r.debtCents,0))}</b></span><span>К оплате: <b>${rub(selection.eligible.filter(r=>r.org===org).reduce((n,r)=>n+selectedSum(r),0))}</b></span></div>${rows.filter(r=>r.org===org).map(vendorCard).join('')}</section>`).join('')}
 <div class="bottom-disclaimer fine">Текущая версия — локальный прототип. Не отправляет деньги в банк. Для бухгалтерского подтверждения зачёта по конкретным счетам нужен регистр взаимозачётов из 1С.</div>`;}

function orgBudgetKey(org){return state.date+'¦'+org;}
function budgetStore(){return typeof readLocal==='function'?readLocal('org-budgets',{}):{};}
function priorityStore(){return typeof readLocal==='function'?readLocal('allocation-priorities',{}):{};}
function budgetLocked(r){return !r.planNeedsReview&&['approved','paid'].includes(r.plan.status);}
// One source of truth for the displayed budget and supplier checkbox allocation.
function budgetSelected(rr){return rr.reduce((n,r)=>n+(budgetLocked(r)||!paymentBlocked(r)?selectedSum(r):0),0);}
function supplierCheckboxState(r){
 const chosen=selectedSum(r),paid=paidStatus(r),blocked=paymentBlocked(r),locked=budgetLocked(r);
 const docs=r.allocatedDocuments.filter(d=>d.allocatedCents>0&&d.remainingCents>0);
 const budget=budgetStore()[orgBudgetKey(r.org)];
 return {checked:chosen>0&&!paid,disabled:locked||(!chosen&&(blocked||!docs.some(d=>Number.isSafeInteger(budget)||d.dueNow)))};
}
function budgetPanel(model,orgs){
 const budgets=budgetStore(), priorities=priorityStore();
 return '<div class="card" style="padding:16px;margin-bottom:16px"><h2>Автораспределение по организациям — рекомендательный план</h2><p>Автораспределение предлагает суммы по сроку. Галочка поставщика распределяет свободный остаток его организации, даже если срок оплаты ещё не наступил. Ручные изменения сохраняются при повторном автораспределении; отдельные суммы можно менять и сверх плана. Утверждённые и оплаченные платежи не перезаписываются. Спорные документы требуют сверки 1С.</p>'+
 orgs.map(org=>{
 const rr=model.active.filter(r=>r.org===org), b=budgets[orgBudgetKey(org)], selected=budgetSelected(rr), excess=b===undefined?0:Math.max(0,selected-b);
 const excluded=(model.rows||model.active).filter(r=>r.org===org&&r.debtCents>0).map(r=>({name:r.supplier,reason:!r.tracked&&r.tracked!==undefined?'Не включён в действующих поставщиков':budgetLocked(r)?'Уже утверждён или оплачен':priorities[r.key]==='blocked'?'Исключён из авторасчёта':paymentBlocked(r)?'Требуется сверка: '+(r.flags||[]).join('; '):r.dueCents===0?'Срок оплаты не наступил':''})).filter(x=>x.reason);
 const explain=excluded.length?'<details><summary>Почему отдельные поставщики не распределяются ('+excluded.length+')</summary>'+excluded.map(x=>'<p class="fine">'+esc(x.name)+' — '+esc(x.reason)+'</p>').join('')+'</details>':'';
 return '<div style="border-top:1px solid #ccc;padding:12px 0"><b>'+esc(org)+'</b><div class="toolbar"><div class="field"><label>Выделено, ₽</label><input class="control" inputmode="decimal" data-budget-org="'+esc(org)+'" value="'+esc(state.budgetInput?.[orgBudgetKey(org)]??(b===undefined?'':currencyInput(b)))+'"></div><button class="btn btn-primary" data-auto-org="'+esc(org)+'">Распределить</button><span>Выбрано: <b>'+rub(selected)+'</b> · Остаток: <b>'+(b===undefined?'—':rub(b-selected))+'</b>'+(excess?'<span class="badge badge-warn">Сверх плана: '+rub(excess)+' — ручная оплата разрешена</span>':'')+'</span></div><details><summary>Приоритеты поставщиков</summary>'+rr.map(r=>'<div class="toolbar"><span>'+esc(r.supplier)+'</span><select class="control" data-budget-priority="'+esc(r.key)+'">'+[['critical','Критический'],['normal','По сроку'],['blocked','Исключить']].map(([v,l])=>'<option value="'+v+'" '+((priorities[r.key]||'normal')===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>').join('')+'</details>'+explain+'</div>';
 }).join('')+'</div>';
}
async function runOrgBudget(org){
 try{
 const input=[...document.querySelectorAll('[data-budget-org]')].find(x=>x.dataset.budgetOrg===org);
 const b=C.cents(input?.value);if(!input?.value.trim()||!Number.isSafeInteger(b)||b<0)throw Error('Укажите неотрицательный лимит организации');
 input.value=currencyInput(b);(state.budgetInput??={})[orgBudgetKey(org)]=input.value;
 const snapshot=state.snapshot,date=state.date,priorPlans=JSON.stringify(state.plans),priorSettings=JSON.stringify(state.settings);
 const model=C.analyze(snapshot,date,state.settings,state.plans), rr=model.active.filter(r=>r.org===org), priorities=priorityStore();
 if(rr.some(r=>r.planNeedsReview&&['approved','paid'].includes(r.plan.status)))throw Error('Сначала сверить ранее утверждённые или оплаченные планы');
 const preserve=r=>budgetLocked(r)||r.plan.manual===true||r.planNeedsReview;
 const locked=budgetSelected(rr.filter(preserve));
 const committedExcess=Math.max(0,locked-b);
 const candidates=rr.filter(r=>!preserve(r)&&!paymentBlocked(r)&&priorities[r.key]!=='blocked').flatMap(r=>r.allocatedDocuments.filter(d=>d.dueNow&&d.remainingCents>0).map(d=>({r,d,rank:priorities[r.key]==='critical'?0:d.overdue?1:2})));
 candidates.sort((a,b)=>a.rank-b.rank||a.d.dueDate.localeCompare(b.d.dueDate)||a.r.supplier.localeCompare(b.r.supplier,'ru')||a.d.id.localeCompare(b.d.id));
 if(!await appConfirm('Сформировать предложенный план по '+org+' на '+rub(b)+'? Автоматические черновики будут пересчитаны. Ручные изменения, утверждённые и оплаченные суммы сохранятся.'))return;
 if(state.snapshot!==snapshot||state.date!==date||JSON.stringify(state.plans)!==priorPlans||JSON.stringify(state.settings)!==priorSettings||JSON.stringify(priorityStore())!==JSON.stringify(priorities))throw Error('Данные изменились во время подтверждения. Повторите распределение');
 let left=Math.max(0,b-locked);const next={...state.plans}, plans=new Map();
 for(const r of rr.filter(r=>!preserve(r)))plans.set(r.key,{items:{},status:'draft',sourceFingerprint:state.snapshot.fingerprint,delayDays:r.delay,changedAt:new Date().toISOString()});
 for(const {r,d} of candidates){const n=Math.min(left,d.remainingCents);if(n>0){plans.get(r.key).items[d.id]=n;left-=n;}if(left===0)break;}
 for(const r of rr.filter(r=>plans.has(r.key))){const p=plans.get(r.key);checkTotal(r,p.items);next[planId(r.key)]=p;}
 const budgets=budgetStore();budgets[orgBudgetKey(org)]=b;if(state.budgetInput)delete state.budgetInput[orgBudgetKey(org)];
 state.plans=next;saveLocal('plans',next);saveLocal('org-budgets',budgets);draw();toast(committedExcess?'Предупреждение: сохранённые суммы сверх плана на '+rub(committedExcess)+'. Новых сумм автоматически не добавлено; ручные платежи доступны.':'Распределено: '+rub(b-left)+' из '+rub(b)+'. Свободно: '+rub(left)+(left>0?' — не хватает доступных платежей по сроку. Проверьте причины исключения поставщиков.':' — можно корректировать вручную.'));
 }catch(e){toast('Ошибка: '+e.message,7500);}
}
if(typeof document!=='undefined')document.addEventListener('change',e=>{const k=e.target.dataset.budgetPriority;if(k){const p=priorityStore();p[k]=e.target.value;saveLocal('allocation-priorities',p);}});
if(typeof document!=='undefined')document.addEventListener('click',e=>{
 const btn=e.target.closest('[data-auto-org]');
 if(btn){e.preventDefault();void runOrgBudget(btn.dataset.autoOrg);}
});
