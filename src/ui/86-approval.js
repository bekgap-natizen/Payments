// Hosted approval workspace; the standalone AppBox 0.6.11 remains independent.
function approvalHosted(){return typeof location!=='undefined'&&location.pathname==='/desktop/'&&/^https?:$/.test(location.protocol);}
let approvalBusy=false;
async function submitApproval(){
 if(approvalBusy)return;
 approvalBusy=true;const btn=$('submit-approval');if(btn)btn.disabled=true;
 try{
  if(!state.snapshot)throw Error('Сначала загрузите ведомость 1С');
  const model=C.analyze(state.snapshot,state.date,state.settings,state.plans),selection=paymentSelection(model);
  if(!selection.cents)throw Error('Нет выбранных платежей без расхождений');
  const rows=selection.eligible.map(r=>({org:r.org,supplier:r.supplier,cents:selectedSum(r),documents:r.allocatedDocuments.filter(d=>Number(r.plan.items[d.id])>0).map(d=>({id:d.id,number:d.incomingNumber||'Без номера',date:d.incomingDate||null,due:d.dueDate||null,cents:r.plan.items[d.id]}))}));
  if(rows.reduce((n,r)=>n+r.cents,0)!==selection.cents||rows.some(r=>r.documents.reduce((n,d)=>n+d.cents,0)!==r.cents))throw Error('Контрольная сумма реестра не совпала');
  const payload={date:state.date,totalCents:selection.cents,rows};
  if(!await appDialog('Отправить на согласование генеральному директору реестр на '+rub(payload.totalCents)+' за '+fmtDate(payload.date)+'?\\nПосле отправки версия фиксируется. Для изменения потребуется возврат на доработку.',{title:'На согласование',ok:'Отправить'}))return;
  const profile=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
  if(!profile.ok)throw Error('Войдите в приложение заново');
  const me=await profile.json();
  if(me.role!=='accountant')throw Error('Только бухгалтер может отправить реестр');
  const response=await fetch('/api/registers',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Реестр не принят сервером');
  location.assign('/?register='+encodeURIComponent(result.id));
 }catch(err){toast('Ошибка: '+err.message,8000);}
 finally{approvalBusy=false;if(btn)btn.disabled=false;}
}
if(typeof document!=='undefined')document.addEventListener('click',e=>{
 if(e.target.closest('#submit-approval')){e.preventDefault();void submitApproval();}
 if(e.target.closest('#approval-home')){e.preventDefault();location.assign('/');}
});
