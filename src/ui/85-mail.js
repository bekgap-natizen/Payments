// AppBox -> localhost mail companion; no SMTP password or mail credentials in frontend.
const MAIL_LOCAL="http://127.0.0.1:8765";
const MAIL_TOKEN_KEY="volmax-mail-pair-token";
let mailBusy=false, mailToken="";
function mailGetToken(){
 if(mailToken)return mailToken;
 try{return sessionStorage.getItem(MAIL_TOKEN_KEY)||"";}catch(_){return "";}
}
function mailSetToken(token){
 mailToken=token;
 try{sessionStorage.setItem(MAIL_TOKEN_KEY,token);}catch(_){}
}
async function mailFetch(route,body,token=""){
 const url=MAIL_LOCAL+route;
 const init={method:body===undefined?"GET":"POST",mode:"cors",cache:"no-store",
   headers:{"Content-Type":"application/json",...(token?{"X-Payments-Token":token}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})};
 let response;
 try{
   // Chrome/Edge Local Network Access permission from HTTPS AppBox to localhost.
   const request=new Request(url,{...init,targetAddressSpace:"loopback"});
   response=await fetch(request);
 }catch(e){
   // Older browsers do not understand targetAddressSpace.
   if(e instanceof TypeError){
     response=await fetch(url,init);
   }else throw e;
 }
 const data=await response.json().catch(()=>({error:"Некорректный ответ локального сервера"}));
 if(!response.ok)throw Error(data.error||"Локальный сервер вернул ошибку");
 return data;
}
async function mailConnect(){
 try{
   const t=mailGetToken();
   const status=await mailFetch("/v1/status",undefined,t);
   if(status.version!==1)throw Error("Версия локального сервера несовместима с Payments");
   if(!status.ready)throw Error("Откройте окно Mail Server и сохраните почту Яндекс");
   if(status.paired)return {token:t,sender:status.sender};
   const code=prompt("Введите шестизначный код из окна VOLMAX Mail Server. Почтовый пароль сюда вводить не нужно.");
   if(code===null)return null;
   if(!/^\d{6}$/.test(code))throw Error("Код подключения должен состоять из шести цифр");
   const paired=await mailFetch("/v1/pair",{code});
   mailSetToken(paired.token);
   const verified=await mailFetch("/v1/status",undefined,paired.token);
   return {token:paired.token,sender:verified.sender};
 }catch(e){
   throw Error(e.message+"; проверьте запуск сервера, разрешение браузера на локальную сеть и настройки AppBox");
 }
}
async function blobBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());
 const step=0x6000;
 let binary="";
 for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));
 return btoa(binary);
}
function mailDraft(){
 if(!state.snapshot)throw Error("Сначала загрузите отчёт 1С");
 const m=C.analyze(state.snapshot,state.date,state.settings,state.plans);
 const selection=paymentSelection(m);
 if(!selection.cents)throw Error("Нет выбранных платежей без расхождений");
 const next={...state.plans};
 for(const r of selection.eligible){
   next[planId(r.key)]={...r.plan,status:"approved",sourceFingerprint:state.snapshot.fingerprint,
      delayDays:r.delay,changedAt:new Date().toISOString()};
 }
 const after=C.analyze(state.snapshot,state.date,state.settings,next);
 const keys=new Set(selection.eligible.map(r=>r.key));
 const active=after.active.filter(r=>keys.has(r.key));
 if(active.reduce((s,r)=>s+r.plannedCents,0)!==selection.cents)
   throw Error("Контрольная сумма реестра не совпала");
 const report={...after,active};
 const book=PaymentExport.makeXlsx(report,state.date,{filename:state.snapshot.name});
 const orgNames=[...new Set(active.map(r=>r.org))];
 const organizations=orgNames.map(name=>({
   name,suppliers:active.filter(r=>r.org===name).map(r=>({name:r.supplier,cents:r.plannedCents}))
 }));
 return {next,book,payload:{date:state.date,totalCents:selection.cents,organizations},
    supplierCount:active.length};
}
async function sendPaymentMail(){
 if(mailBusy)return;
 mailBusy=true;
 const button=$("send-payments-mail");
 if(button){button.disabled=true;button.textContent="Готовим отправку…";}
 try{
   const draft=mailDraft();
   const fmt=fmtDate(state.date);
   if(!confirm("Подтвердить и отправить реестр на "+rub(draft.payload.totalCents)+
       " за "+fmt+" по "+draft.supplierCount+" поставщикам?\nПолучатели: генеральный директор, коммерческий директор, главный бухгалтер и бухгалтер."))return;
   const connected=await mailConnect();
   if(!connected)return;
   if(!confirm("Отправитель: "+connected.sender+
     "\nДата: "+fmt+"\nВсего: "+rub(draft.payload.totalCents)+
     "\nПисьмо с таблицей поставщиков и Excel-вложением будет отправлено через Яндекс. Продолжить?"))return;
   if(button)button.textContent="Отправляем…";
   const payload={...draft.payload,xlsxBase64:await blobBase64(draft.book)};
   let result;
   try{
     result=await mailFetch("/v1/send",payload,connected.token);
   }catch(err){
     if(/уже отправлялся|отправка была начата/i.test(err.message)){
       if(!confirm("Этот реестр уже отправлялся или отправка была начата. Проверьте папку «Отправленные» Яндекса. Всё равно повторить отправку?"))return;
       result=await mailFetch("/v1/send",{...payload,force:true},connected.token);
     }else throw err;
   }
   if(result.ok&&result.status==="accepted"){
     state.plans=draft.next;saveLocal("plans",state.plans);draw();
     toast("SMTP Яндекса принял письмо от "+result.sender+". Проверьте доставку у получателей.",10000);
   }else throw Error("Нет подтверждения принятия письма сервером Яндекса");
 }catch(e){
   toast("Ошибка почтовой отправки: "+e.message,12000);
 }finally{
   mailBusy=false;
   const fresh=$("send-payments-mail");
   if(fresh){fresh.disabled=false;fresh.textContent="Подтвердить и отправить";}
 }
}
