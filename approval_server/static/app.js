'use strict';
const $=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0,minimumFractionDigits:0}).format(n/100);
const fmt=d=>d?d.slice(0,10).split('-').reverse().join('.'):'—';
const labels={pending:'На согласовании',returned:'На доработке',approved:'Утверждено',sending:'Отправляется',sent:'Письмо отправлено',uncertain:'Проверить отправку',submitted:'На согласовании'};
const roles={accountant:'Бухгалтер',commercial:'Коммерческий директор',director:'Генеральный директор'};
let me=null,mode='overview',current=null,busy=false,timer,query={from:'',to:'',org:'',supplier:''};
const invite=new URLSearchParams(location.hash.slice(1)).get('pair')||'';if(invite)history.replaceState(null,'',location.pathname+location.search);
const notice=message=>{ $('notice').textContent=message;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',7000); };
async function api(path,body){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||''},body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({error:'Ошибка сервера'}));if(!res.ok){if(res.status===401&&me){me=null;loginView()}throw Error(data.error||'Ошибка запроса');}return data;
}
function badge(s){return '<span class="badge '+e(s)+'">'+e(labels[s]||s)+'</span>';}
function loginView(){
 $('logout').hidden=true;$('main').innerHTML='<h1>Согласование платежей</h1><div class="card"><h2>Войти</h2><form id="login"><label for="login-name">Логин</label><input id="login-name" autocomplete="username" required><label for="login-password">Пароль</label><input id="login-password" type="password" autocomplete="current-password" required><p><button class="primary" type="submit">Войти</button></p></form></div><div class="card"><h2>Подключить устройство</h2><form id="pair"><label for="pair-code">Одноразовый код из VOLMAX Server</label><input id="pair-code" value="'+e(invite)+'" autocomplete="off" required><p><button class="primary" type="submit">Подключить</button></p></form><small>На iPhone сначала добавьте приложение на экран «Домой». Если установленное приложение не сохранило вход, создайте новый код подключения.</small></div><p class="muted">Доступ только сотрудникам. Реестры не сохраняются в кэше телефона.</p>';
}
async function init(){
 try{me=await api('/api/me');$('logout').hidden=false;const id=Number(new URLSearchParams(location.search).get('register'));if(Number.isSafeInteger(id)&&id>0){mode='today';await show(id);}else await list();}
 catch(err){if(!me)loginView();else notice(err.message);}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
function renderTop(){
 return '<nav class="tabs" aria-label="Разделы">'+[['overview','▦ Обзор'],['today','▤ Согласование'],['history','◷ История']].map(([id,label])=>'<button data-mode="'+id+'" class="'+(mode===id?'active':'')+'">'+label+'</button>').join('')+'</nav><div class="utilities"><small>'+e(roles[me.role])+'</small><button data-action="refresh">Обновить</button><button data-action="push">Уведомления</button>'+(me.role==='accountant'?'<a class="btn" href="/desktop/">Рабочее место бухгалтера</a>':'')+'</div>';
}
const groupsOf=rows=>{const groups=new Map();for(const row of rows){if(!groups.has(row.org))groups.set(row.org,[]);groups.get(row.org).push(row);}return groups};
const sum=(rows,k)=>rows.reduce((n,r)=>n+r[k],0);
const approvedStatuses=['approved','sending','sent','uncertain'];
function overview(r){
 const rows=r?.payload?.overview;const pending=r?.status==='pending';const approved=approvedStatuses.includes(r?.status);
 const kpi=(label,value,sub,status)=>'<div class="card kpi"><div class="label">'+label+'</div><div class="value">'+(value===null?'—':rub(value))+'</div><small>'+sub+'</small>'+(status?badge(status):'')+'</div>';
 let h='<h1>Обзор платежей</h1><small>Срез 1С '+(r?fmt(r.date):'ещё не передан')+'</small><div class="kpis">'+kpi('Долг поставщикам по 1С',rows?sum(rows,'debtCents'):null,'Действующие поставщики')+kpi('Наступил срок оплаты',rows?sum(rows,'dueCents'):null,'По действующим поставщикам')+kpi('Предложено к оплате',pending?r.payload.totalCents:0,'Текущий реестр',pending?'pending':null)+kpi('Утверждено к оплате',approved?r.payload.totalCents:0,'Утверждённый реестр',approved?'approved':null)+'</div>';
 const figures=(debt,due)=>'<div class="figures"><b>'+rub(debt)+'</b><small>'+rub(due)+'</small></div>';
 h+='<h2>По организациям</h2><div class="card compact"><div class="line headings"><span>ОРГАНИЗАЦИЯ</span><span>ДОЛГ / ПО СРОКУ</span></div>';
 if(rows?.length){for(const [org,rr] of groupsOf(rows)){h+='<details><summary class="line org-name"><span>'+e(org)+'</span>'+figures(sum(rr,'debtCents'),sum(rr,'dueCents'))+'</summary><div class="supplier-lines">'+rr.map(x=>'<div class="line"><span>'+e(x.supplier)+'</span>'+figures(x.debtCents,x.dueCents)+'</div>').join('')+'</div></details>';}}else h+='<p class="muted">Нет переданных данных обзора.</p>';
 h+='</div><h2>Поставщики с наступившими сроками</h2><div class="card compact">';
 const due=rows?.filter(x=>x.dueCents>0).sort((a,b)=>b.dueCents-a.dueCents)||[];
 h+=due.length?due.map(x=>'<div class="line"><div><b>'+e(x.supplier)+'</b><small>'+e(x.org)+'</small></div><b>'+rub(x.dueCents)+'</b></div>').join(''):'<p class="muted">Нет данных о сроках.</p>';
 return h+'</div><button class="primary wide" data-mode="today">Перейти к согласованию →</button>';
}
async function list(){
 if(!me)return;current=null;
 const params=new URLSearchParams(mode==='history'?Object.fromEntries(Object.entries(query).filter(([,v])=>v)):{});
 const result=await api('/api/registers?'+params);const rows=result.registers;
 if(mode==='overview'){$('main').innerHTML=renderTop()+overview(rows[0]);return;}
 if(mode==='today'&&rows.length){await show(rows.find(r=>r.status==='pending')?.id||rows[0].id);return;}
 let content=renderTop();
 if(mode==='today')content+='<h1>Платежи на дату</h1>';
 else content+='<h1>История платежей</h1><form id="filters" class="card"><div class="grid"><div><label>С даты</label><input name="from" type="date" value="'+e(query.from)+'"></div><div><label>По дату</label><input name="to" type="date" value="'+e(query.to)+'"></div><div><label>Организация</label><input name="org" value="'+e(query.org)+'" placeholder="Все организации"></div><div><label>Поставщик</label><input name="supplier" value="'+e(query.supplier)+'" placeholder="Все поставщики"></div></div><p><button class="primary wide" type="submit">Найти</button></p></form><div class="card kpi"><div class="label">Утверждено за период</div><div class="value">'+rub(result.matchingCents)+'</div></div>';
 if(!rows.length)content+='<div class="card"><p>Нет реестров за выбранный период.</p></div>';
 else for(const r of rows)content+='<button class="record" data-register="'+r.id+'"><div class="line"><span>'+fmt(r.date)+' · версия '+r.revision+'</span>'+badge(r.status)+'</div><div class="total">'+rub(r.matchingCents)+'</div><small>'+r.payload.rows.length+' поставщиков</small></button>';
 $('main').innerHTML=content;
}
async function show(id){
 const r=await api('/api/registers/'+id);current=r;
 const status=approvedStatuses.includes(r.status)?'approved':r.status;
 const total=label=>'<div class="card kpi"><div class="line total-head"><span class="label">'+label+'</span>'+badge(status)+'</div><div class="total">'+rub(r.payload.totalCents)+'</div></div>';
 let html=renderTop()+'<h1>Платежи на дату</h1><small>'+fmt(r.date)+' · Версия '+r.revision+' · '+e(roles[me.role])+'</small>'+total('Всего к оплате');
 for(const [org,rows] of groupsOf(r.payload.rows)){
   html+='<h2>'+e(org)+'</h2>';
   for(const row of rows)html+='<div class="supplier-row"><span>'+e(row.supplier)+'</span><b>'+rub(row.cents)+'</b></div>';
   html+='<div class="line orgtotal"><span>ИТОГО</span><b>'+rub(sum(rows,'cents'))+'</b></div>';
 }
 html+=total('ВСЕГО К ОПЛАТЕ');
 if(['director','commercial'].includes(me.role)&&r.status==='pending')html+='<div id="decision-actions" class="decision-actions"><button class="approve wide" data-action="approve">✓ Утвердить реестр</button><button class="wide" data-action="return-form">На доработку</button></div><div id="return-form" class="card" hidden><label for="decision-note">Причина возврата</label><textarea id="decision-note" maxlength="2000" rows="3" placeholder="Комментарий бухгалтеру"></textarea><div class="actions"><button data-action="cancel-return">Отмена</button><button class="warn" data-action="return">Вернуть бухгалтеру</button></div></div>';
 if(me.role==='accountant'&&approvedStatuses.includes(r.status)){
  html+='<div class="card actions"><a class="btn" href="/api/registers/'+r.id+'/excel">Скачать Excel</a>';
  if(r.status==='approved')html+='<button class="primary" data-action="send">Отправить по почте</button>';
  if(['sending','uncertain'].includes(r.status))html+='<p>Проверьте папку «Отправленные» Яндекса. Не повторяйте отправку вслепую.</p><button data-action="resolve_sent">Письмо найдено</button><button class="warn" data-action="resolve_retry">Разрешить повтор после проверки</button>';
  html+='</div>';
 }
 html+='<div class="card"><h2>История действий</h2>'+r.events.map(x=>'<div class="line"><span>'+e(labels[x.event]||x.event)+'<small>'+e(x.actor)+' · '+e(new Date(x.created).toLocaleString('ru-RU'))+'</small>'+(x.note?'<p>'+e(x.note)+'</p>':'')+'</span></div>').join('')+'</div>';
 $('main').innerHTML=html;
}
async function decide(action){
 const r=current;if(!r)return;const note=$('decision-note')?.value.trim()||'';
 if(action==='return'&&!note){notice('Укажите причину возврата.');return;}
 try{await api('/api/registers/'+r.id+'/decision',{action,version:r.version,note});}catch(err){await show(r.id);throw err;}
 await show(r.id);notice(action==='approve'?'Реестр утверждён':'Возвращён на доработку');
}
async function pushSetup(){
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){notice('Уведомления недоступны в этом браузере. На iPhone/iPad добавьте приложение на главный экран и откройте его оттуда.');return;}
 if(!me.vapidPublicKey){notice('Push-сервер ещё не настроен администратором.');return;}
 const permission=await Notification.requestPermission();if(permission!=='granted'){notice('Разрешите уведомления в настройках устройства.');return;}
 const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
 if(!sub){const s=me.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/');const key=Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
 const showSummary=window.confirm('Показывать организации, поставщиков и суммы в push на экране блокировки? Нажмите «Отмена» для уведомлений без финансовых данных.');
 await api('/api/subscriptions',{...sub.toJSON(),showSummary});notice('Уведомления подключены на этом устройстве.');
}
const MAIL='http://127.0.0.1:8765';
async function localMail(path,body,token=''){
 const r=await fetch(MAIL+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',mode:'cors',headers:{'Content-Type':'application/json',...(token?{'X-Payments-Token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const j=await r.json();if(!r.ok)throw Error(j.error||'Mail Server не ответил');return j;
}
async function mailConnect(){
 let token=localStorage.getItem('approval-mail-token')||'',status;
 try{status=await localMail('/v1/status',undefined,token)}catch(_){throw Error('Запустите локальный Mail Server на компьютере бухгалтера и проверьте разрешённый HTTPS-источник.');}
 if(!status.ready)throw Error('Настройте почту в локальном Mail Server.');
 if(!status.paired){
  const code=window.prompt('Введите код подключения из Mail Server');if(code===null)return null;
  if(!/^\d{6}$/.test(code))throw Error('Нужны шесть цифр.');
  token=(await localMail('/v1/pair',{code})).token;localStorage.setItem('approval-mail-token',token);status=await localMail('/v1/status',undefined,token);
 }
 if(!status.paired||!status.sender)throw Error('Нет привязки Mail Server.');return {token,sender:status.sender};
}
async function sendMail(){
 if(me.unifiedMail){
  const r=current;if(!r||r.status!=='approved')return;
  if(!window.confirm('Отправить утверждённый реестр на '+rub(r.payload.totalCents)+' по почте?'))return;
  const result=await api('/api/registers/'+r.id+'/send-mail',{version:r.version});
  await show(r.id);notice(result.ok?'SMTP принял письмо.':'Проверьте отправку в Яндексе.');return;
 }
 const r=current;if(!r||r.status!=='approved')return;
 const connected=await mailConnect();if(!connected)return;
 if(!window.confirm('Отправить утверждённый реестр '+rub(r.payload.totalCents)+' через '+connected.sender+' четырём получателям?'))return;
 const file=await fetch('/api/registers/'+r.id+'/excel',{credentials:'same-origin',cache:'no-store'});if(!file.ok)throw Error('Не удалось получить утверждённый Excel.');
 const bytes=new Uint8Array(await file.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=0x6000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x6000));
 const orgs=new Map();for(const row of r.payload.rows){if(!orgs.has(row.org))orgs.set(row.org,[]);orgs.get(row.org).push({name:row.supplier,cents:row.cents});}
 const payload={date:r.date,totalCents:r.payload.totalCents,organizations:[...orgs].map(([name,suppliers])=>({name,suppliers})),xlsxBase64:btoa(bin)};
 const lock=await api('/api/registers/'+r.id+'/send',{action:'begin',version:r.version});
 let result;
 try{result=await localMail('/v1/send',payload,connected.token);}
 catch(err){try{await api('/api/registers/'+r.id+'/send',{action:'uncertain',version:lock.version})}catch(_){};await show(r.id);throw Error('Отправка не подтверждена. Проверьте Яндекс перед повтором. '+err.message);}
 if(!result.ok||result.status!=='accepted'){await api('/api/registers/'+r.id+'/send',{action:'uncertain',version:lock.version});await show(r.id);throw Error('SMTP не подтвердил приём.');}
 await api('/api/registers/'+r.id+'/send',{action:'accepted',version:lock.version});await show(r.id);notice('SMTP принял письмо. Доставка адресатам не гарантирована.');
}
document.addEventListener('submit',async ev=>{
 ev.preventDefault();if(busy)return;busy=true;
 try{if(ev.target.id==='login'){me=await api('/api/login',{login:$('login-name').value,password:$('login-password').value});await init();}
 else if(ev.target.id==='pair'){me=await api('/api/pair',{code:$('pair-code').value.trim()});await init();}
 else if(ev.target.id==='filters'){query=Object.fromEntries(new FormData(ev.target));await list();}}
 catch(err){notice(err.message)}finally{busy=false}
});
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('button');if(!b||busy)return;const action=b.dataset.action;
 if(!action&&!b.dataset.register&&!b.dataset.mode&&b.id!=='logout')return;
 ev.preventDefault();busy=true;b.disabled=true;
 try{
 if(b.id==='logout'){
  try{const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub){await api('/api/unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}}catch(_){}
  await api('/api/logout',{});me=null;loginView();return;
 }
 if(b.dataset.mode){mode=b.dataset.mode;await list();window.scrollTo(0,0);}
 else if(b.dataset.register){await show(Number(b.dataset.register));window.scrollTo(0,0);}
 else if(action==='back'||action==='refresh')await list();
 else if(action==='reload')await show(current.id);
 else if(action==='push')await pushSetup();
 else if(action==='return-form'){$('decision-actions').hidden=true;$('return-form').hidden=false;$('decision-note').focus();}
 else if(action==='cancel-return'){$('decision-actions').hidden=false;$('return-form').hidden=true;}
 else if(action==='approve'||action==='return')await decide(action);
 else if(action==='send')await sendMail();
 else if(action==='resolve_sent'||action==='resolve_retry'){if(window.confirm('Вы проверили папку «Отправленные» и подтверждаете действие?')){await api('/api/registers/'+current.id+'/send',{action,version:current.version});await show(current.id);}}
 }catch(err){notice(err.message)}finally{busy=false;b.disabled=false}
});
init();
