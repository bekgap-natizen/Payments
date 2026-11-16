function selectedItems(r){const p=r.plan||{};return p.items||{};}
function selectedSum(r){return Object.values(selectedItems(r)).reduce((n,x)=>n+Number(x||0),0);}
function paidStatus(r){return r.plan.status==='paid'&&!r.planNeedsReview;}
function docRows(r){
 const items=selectedItems(r),locked=!r.planNeedsReview&&(r.plan.status==='paid'||r.plan.status==='approved');
 const docs=r.allocatedDocuments.filter(d=>d.allocatedCents>0).slice().reverse();
 return `<div class="table-scroll"><table class="pay-doc-table"><thead><tr><th class="pick-col">✓</th><th>Входящий документ</th><th>Дата входящая</th><th>Срок оплаты</th><th class="right">Остаток расчётный</th><th class="right">Выбрано к оплате, ₽</th><th>Статус</th></tr></thead><tbody>
 ${docs.map(d=>{const checked=Object.hasOwn(items,d.id)&&Number(items[d.id])>0,remaining=d.remainingCents;
 const status=paidStatus(r)&&d.paidLocalCents>0?'Отмечено оплачено':!d.dueDate?'Нет даты':d.overdue?'Просрочено':d.dueNow?'Срок наступил':'Позднее';
 return `<tr class="${checked?'selected-pay-row':''}"><td><input class="switch" type="checkbox" data-doc-select="${esc(d.id)}" data-key="${esc(r.key)}" ${checked?'checked':''} ${locked||remaining<=0?'disabled':''} aria-label="Выбрать ${esc(d.incomingNumber||'документ')}"></td><td><div class="name">${esc(d.incomingNumber||'Без номера')}</div><div class="fine">Строка 1С ${d.row}</div></td><td>${fmtDate(d.incomingDate)}</td><td class="amount">${fmtDate(d.dueDate)}</td><td class="right amount">${rub(remaining)}</td><td class="right"><input class="control doc-money" type="text" inputmode="decimal" data-doc-amount="${esc(d.id)}" data-key="${esc(r.key)}" value="${checked?currencyInput(items[d.id]):currencyInput(remaining)}" ${locked||remaining<=0?'disabled':''} aria-label="Сумма к оплате по ${esc(d.incomingNumber||'документу')}"></td><td><span class="badge ${status==='Просрочено'?'badge-bad':status==='Срок наступил'?'badge-good':status==='Нет даты'?'badge-warn':'badge-neutral'}">${status}</span></td></tr>`;}).join('')}
 </tbody></table></div>`;
}
function vendorCard(r){const p=r.plan||{},items=selectedItems(r),chosen=selectedSum(r),approved=p.status==='approved'&&!r.planNeedsReview;
 const paid=paidStatus(r), locked=approved||paid,canApprove=!locked&&!r.planNeedsReview&&chosen>0;
 const count=Object.values(items).filter(x=>x>0).length;
 const docs=r.allocatedDocuments.filter(d=>d.allocatedCents>0);
 const dueDocs=docs.filter(d=>d.dueNow&&d.remainingCents>0);
 const allDueSelected=dueDocs.length>0&&dueDocs.every(d=>Number(items[d.id]||0)>0);
 return `<details class="detail vendor-card" data-vendor="${esc(r.key)}" ${state.openVendors.has(r.key)?'open':''}><summary><div class="vendor-summary"><input class="supplier-pick" type="checkbox" data-supplier-select="${esc(r.key)}" aria-label="Выбрать поставщика ${esc(r.supplier)} по сроку" ${allDueSelected?'checked':''} ${locked||!dueDocs.length?'disabled':''}><span class="vendor-title">${esc(r.supplier)}</span><span class="vendor-metrics"><span>Долг 1С <b>${rub(r.debtCents)}</b></span><span>По сроку <b>${rub(r.dueCents)}</b></span><span class="${chosen?'positive':''}">Выбрано <b>${rub(chosen)}</b></span></span><span class="badge ${paid?'badge-neutral':approved?'badge-good':count?'badge-blue':'badge-neutral'}">${labelOf(p.status)}</span></div></summary>
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
 const orgs=[...new Set(model.active.map(r=>r.org))].sort((a,b)=>a.localeCompare(b,'ru'));
 let rows=model.active.filter(r=>r.debtCents>0||r.plan.status);
 if(state.paymentOrg)rows=rows.filter(r=>r.org===state.paymentOrg);
 if(state.paymentSearch)rows=rows.filter(r=>C.key(r.supplier+' '+r.org).includes(C.key(state.paymentSearch)));
 if(state.onlyDue)rows=rows.filter(r=>r.dueCents>0||r.plannedCents>0);
 rows.sort((a,b)=>a.org.localeCompare(b.org,'ru')||b.dueCents-a.dueCents||a.supplier.localeCompare(b.supplier,'ru')).reverse();
 const names=[...new Set(rows.map(r=>r.org))];
 return header('Платежи на дату',`Дата отчёта ${fmtDate(state.date)} · платёжный реестр по выбранным документам`, `<button id="export-payments" class="btn btn-primary" ${approvedRows(model).length?'':'disabled'}>↓ Выгрузить Excel</button>`)+
 `<div class="kpis">${kpi('Долг 1С',rub(model.totals.debtCents),'Поступления и оплаты уже учтены','₽')}${kpi('Срок наступил',rub(model.totals.dueCents),'Расчёт по входящим датам','◷')}${kpi('Утверждено',rub(model.totals.plannedCents),'Для итогового реестра','✓')}${kpi('Проведено вручную',rub(model.totals.paidCents),'Отметки только этого снимка','●')}</div>
 <div class="alert"><span>Отображение платежей: <b>в обратном порядке</b>; входящие документы — <b>старые → новые</b>. Расчётное распределение долга по 1С по-прежнему идёт <b>новые поступления → старые</b> до суммы конечного долга поставщика. Отметьте документы и измените сумму прямо в строке. Зелёный индикатор означает, что срок наступил, <b>а не что документ подтверждён бухгалтерией как неоплаченный</b>.</span></div>
 <div class="toolbar"><div class="field"><label>Организация</label><select class="control" id="payment-org"><option value="">Все организации</option>${orgs.map(o=>`<option value="${esc(o)}" ${o===state.paymentOrg?'selected':''}>${esc(o)}</option>`).join('')}</select></div><div class="field"><label>Поиск поставщика</label><input id="payment-search" class="control search" value="${esc(state.paymentSearch)}" placeholder="Название поставщика"></div><label class="toggle-label"><input id="only-due" type="checkbox" ${state.onlyDue?'checked':''}> Только со сроком оплаты</label></div>
 ${!rows.length?`<div class="card"><div class="empty"><h2>Нет поставщиков для отображения</h2><p>Укажите действующих контрагентов в справочнике или измените фильтры.</p><button data-page="suppliers" class="btn btn-primary">Настроить поставщиков →</button></div></div>`:''}
 ${names.map(org=>`<section class="org-block"><div class="org-head"><h2>${esc(org)}</h2><span>Долг: <b>${rub(rows.filter(r=>r.org===org).reduce((n,r)=>n+r.debtCents,0))}</b></span><span>Утверждено: <b>${rub(rows.filter(r=>r.org===org).reduce((n,r)=>n+r.plannedCents,0))}</b></span></div>${rows.filter(r=>r.org===org).map(vendorCard).join('')}</section>`).join('')}
 <div class="bottom-disclaimer fine">Текущая версия — локальный прототип. Не отправляет деньги в банк. Для бухгалтерского подтверждения зачёта по конкретным счетам нужен регистр взаимозачётов из 1С.</div>`;}
