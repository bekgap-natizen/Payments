'use strict';
const $=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
const fmt=d=>d?d.slice(0,10).split('-').reverse().join('.'):'—';
const labels={pending:'На согласовании',returned:'На доработке',approved:'Утверждено',sending:'Отправляется',sent:'Письмо отправлено',uncertain:'Проверить отправку',submitted:'На согласовании'};
const roles={accountant:'Бухгалтер',commercial:'Коммерческий директор',director:'Генеральный директор'};
let me=null,mode='today',current=null,busy=false,timer,query={from:'',to:'',org:'',supplier:''};
const notice=message=>{ $('notice').textContent=message;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',7000); };
async function api(path,body){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me?.csrf||''},body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({error:'Ошибка сервера'}));if(!res.ok){if(res.status===401&&me){me=null;loginView()}throw Error(data.error||'Ошибка запроса');}return data;
}
function badge(s){return '<span class="badge '+e(s)+'">'+e(labels[s]||s)+'</span>';}
function loginView(){
 $('logout').hidden=true;$('main').innerHTML='<h1>Согласование платежей</h1><div class="card"><h2>Войти</h2><form id="login"><label for="login-name">Логин</label><input id="login-name" autocomplete="username" required><label for="login-password">Пароль</label><input id="login-password" type="password" autocomplete="current-password" required><p><button class="primary" type="submit">Войти</button></p></form></div><p class="muted">Доступ только сотрудникам. Реестры не сохраняются в кэше телефона.</p>';
}
async function init(){
 try{me=await api('/api/me');$('logout').hidden=false;const id=Number(new URLSearchParams(location.search).get('register'));if(Number.isSafeInteger(id)&&id>0)await show(id);else await list();}
 catch(err){if(!me)loginView();else notice(err.message);}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
function top(){
 return '<h1>Платежи</h1><p class="muted">'+e(roles[me.role])+' · '+e(me.id)+'</p><div class="tabs"><button data-mode="today" class="'+(mode==='today'?'primary':'')+'">На согласовании</button><button data-mode="history" class="'+(mode==='history'?'primary':'')+'">История</button><button data-action="refresh">Обновить</button><button data-action="push">Уведомления</button>'+(me.role==='accountant'?'<a class="btn" href="/desktop/">Рабочее место бухгалтера</a>':'')+'</div>';
}
async function list(){
 if(!me)return;current=null;
 const params=new URLSearchParams(mode==='today'?{from:me.today,to:me.today}:Object.fromEntries(Object.entries(query).filter(([,v])=>v)));
 const result=await api('/api/registers?'+params);let rows=result.registers;
 let content=top();
 if(mode==='today')content+='<h2 style="margin-top:20px">Сегодня · '+fmt(me.today)+'</h2>';
 else content+='<form id="filters" class="card"><h2>Поиск в истории</h2><div class="grid"><div><label>С даты</label><input name="from" type="date" value="'+e(query.from)+'"></div><div><label>По дату</label><input name="to" type="date" value="'+e(query.to)+'"></div><div><label>Организация</label><input name="org" value="'+e(query.org)+'"></div><div><label>Поставщик</label><input name="supplier" value="'+e(query.supplier)+'"></div></div><p><button class="primary" type="submit">Найти</button></p><p>Утверждено по фильтру: <b>'+rub(result.matchingCents)+'</b></p><small>Возвращённые версии не суммируются. Это не подтверждение банковского перевода.</small></form>';
 if(!rows.length)content+='<div class="card"><p>Нет реестров за выбранный период.</p></div>';
 else for(const r of rows)content+='<button class="record" data-register="'+r.id+'"><div class="line"><span>'+fmt(r.date)+' · версия '+r.revision+'</span>'+badge(r.status)+'</div><div class="total">'+rub(mode==='history'?r.matchingCents:r.payload.totalCents)+'</div><small>'+r.payload.rows.length+' поставщиков</small></button>';
 $('main').innerHTML=content;
}
async function show(id){
 const r=await api('/api/registers/'+id);current=r;
 let html='<div class="actions"><button data-action="back">← Реестры</button><button data-action="reload">Обновить</button></div><div class="card"><div class="line"><h2>Платежи на '+fmt(r.date)+'</h2>'+badge(r.status)+'</div><small>Версия '+r.revision+' · подготовил '+e(r.creator)+'</small><p class="total">'+rub(r.payload.totalCents)+'</p><small>Всего к оплате</small></div>';
 const groups=new Map();for(const row of r.payload.rows){if(!groups.has(row.org))groups.set(row.org,[]);groups.get(row.org).push(row);}
 for(const [org,rows] of groups){
   html+='<section class="card"><h2>'+e(org)+'</h2>';
   for(const row of rows){html+='<details><summary class="line"><span>'+e(row.supplier)+'</span><b>'+rub(row.cents)+'</b></summary><div class="docs">';
    for(const d of row.documents)html+='<div class="line"><span>№ '+e(d.number)+' от '+fmt(d.date)+'</span><b>'+rub(d.cents)+'</b></div>';
    html+='</div></details>';}
   html+='<div class="line orgtotal"><span>Итого</span><b>'+rub(rows.reduce((n,row)=>n+row.cents,0))+'</b></div></section>';
 }
 if(me.role==='director'&&r.status==='pending')html+='<div class="card"><label for="decision-note">Комментарий / причина возврата</label><textarea id="decision-note" maxlength="2000" rows="3" placeholder="При необходимости укажите, кому изменить сумму"></textarea><small>Изменения в распределение вносит бухгалтер. После возврата он направляет новую версию на согласование.</small><div class="actions sticky"><button class="primary" data-action="approve">Утвердить</button><button class="warn" data-action="return">На доработку</button></div></div>';
 if(me.role==='accountant'&&['approved','sending','sent','uncertain'].includes(r.status)){
  html+='<div class="card actions"><a class="btn" href="/api/registers/'+r.id+'/excel">Скачать Excel</a>';
  if(r.status==='approved')html+='<button class="primary" data-action="send">Отправить по почте</button>';
  if(['sending','uncertain'].includes(r.status))html+='<p>Отправка требует проверки папки «Отправленные» Яндекса. Не повторяйте её вслепую.</p><button data-action="resolve_sent">Письмо найдено</button><button class="warn" data-action="resolve_retry">Разрешить повтор после проверки</button>';
  html+='</div>';
 }
 html+='<div class="card"><h2>История действий</h2>'+r.events.map(x=>'<div class="line"><span>'+e(labels[x.event]||x.event)+'<small>'+e(x.actor)+' · '+e(new Date(x.created).toLocaleString('ru-RU'))+'</small>'+(x.note?'<p>'+e(x.note)+'</p>':'')+'</span></div>').join('')+'</div>';
 $('main').innerHTML=html;
}
async function decide(action){
 const r=current;if(!r)return;const note=$('decision-note')?.value.trim()||'';
 if(action==='return'&&!note){notice('Укажите причину возврата.');return;}
 if(!window.confirm(action==='approve'?'Утвердить реестр на '+rub(r.payload.totalCents)+'?':'Вернуть реестр бухгалтеру?'))return;
 await api('/api/registers/'+r.id+'/decision',{action,version:r.version,note});await show(r.id);notice(action==='approve'?'Реестр утверждён':'Возвращён на доработку');
}
async function pushSetup(){
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){notice('Уведомления недоступны в этом браузере. На iPhone/iPad добавьте приложение на главный экран и откройте его оттуда.');return;}
 if(!me.vapidPublicKey){notice('Push-сервер ещё не настроен администратором.');return;}
 const permission=await Notification.requestPermission();if(permission!=='granted'){notice('Разрешите уведомления в настройках устройства.');return;}
 const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
 if(!sub){const s=me.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/');const key=Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
 await api('/api/subscriptions',sub.toJSON());notice('Уведомления подключены на этом устройстве.');
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
 if(b.dataset.mode){mode=b.dataset.mode;await list();}
 else if(b.dataset.register)await show(Number(b.dataset.register));
 else if(action==='back'||action==='refresh')await list();
 else if(action==='reload')await show(current.id);
 else if(action==='push')await pushSetup();
 else if(action==='approve'||action==='return')await decide(action);
 else if(action==='send')await sendMail();
 else if(action==='resolve_sent'||action==='resolve_retry'){if(window.confirm('Вы проверили папку «Отправленные» и подтверждаете действие?')){await api('/api/registers/'+current.id+'/send',{action,version:current.version});await show(current.id);}}
 }catch(err){notice(err.message)}finally{busy=false;b.disabled=false}
});
init();
