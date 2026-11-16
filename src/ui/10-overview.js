function renderOverview(model){if(!model)return header('Обзор платежей','Сводная задолженность и реестр поставщиков')+missing();
 const active=model.active,tot=model.totals;const groups=[...new Set(active.map(r=>r.org))].sort((a,b)=>a.localeCompare(b,'ru'));
 const critical=active.filter(r=>r.dueCents>0).sort((a,b)=>b.dueCents-a.dueCents).slice(0,15);
 return header('Платежи поставщикам',`Срез 1С на ${fmtDate(state.date)} · ${esc(state.snapshot.name)}`,`<button class="btn btn-primary" data-page="payments">Перейти к платежам →</button>`)+
 `<div class="kpis">
 ${kpi('Долг поставщикам по 1С',rub(tot.debtCents),'Сальдо уже учитывает платежи 1С','₽')}
 ${kpi('Наступил срок оплаты',rub(tot.dueCents),'Оценка: от новых поступлений к старым','◷')}
 ${kpi('Утверждено к оплате',rub(tot.plannedCents),'Только выбранные документы','✓')}
 ${kpi('Нераспределённый долг',rub(tot.unmatchedCents),'Требует проверки документов','!')}
 </div>
 <div class="alert amber"><span><b>Правило расчёта:</b> остаток долга из 1С распределяется по поступлениям <b>от новых к старым</b>. Срок = входящая дата + отсрочка. Это управленческая реконструкция, а не подтверждённый регистр зачётов 1С. Платежи, уже включённые в сальдо, повторно не вычитаются.</span></div>
 ${!active.length?`<div class="alert amber">Сначала включите действующих поставщиков в справочнике. Пока список пуст — никто автоматически не включается в платежи.</div>`:''}
 <div class="grid-2"><div class="card"><div class="card-head"><h2>Поставщики с наступившими сроками</h2><span class="sub">По выбранному списку</span></div>
 ${critical.length?`<div class="table-scroll"><table><thead><tr><th>Организация</th><th>Поставщик</th><th class="right">К оплате по сроку</th><th></th></tr></thead><tbody>${critical.map(r=>`<tr><td class="muted">${esc(r.org)}</td><td class="name">${esc(r.supplier)}</td><td class="right amount">${rub(r.dueCents)}</td><td><button class="btn btn-sm" data-open-vendor="${esc(r.key)}">Открыть</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty"><p>Нет действующих поставщиков с наступившим сроком.</p></div>`}</div>
 <div class="card"><div class="card-head"><h2>По организациям</h2></div>${groups.length?`<div class="table-scroll"><table><thead><tr><th>Организация</th><th class="right">Долг 1С</th><th class="right">Утверждено</th></tr></thead><tbody>${groups.map(org=>{const a=active.filter(r=>r.org===org);return `<tr><td class="name">${esc(org)}</td><td class="right amount">${rub(a.reduce((n,r)=>n+r.debtCents,0))}</td><td class="right amount">${rub(a.reduce((n,r)=>n+r.plannedCents,0))}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="empty"><p>Нет данных по выбранным организациям.</p></div>`}</div></div>`;}
