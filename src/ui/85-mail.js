// AppBox -> localhost mail companion; no SMTP password or mail credentials in frontend.
const MAIL_LOCAL="http://127.0.0.1:8765";
const MAIL_TOKEN_KEY="volmax-mail-pair-token";
const MAIL_START_URL="volmax-payments://start";
let mailBusy=false, mailToken="";
function mailGetToken(){
 if(mailToken)return mailToken;
 try{const saved=localStorage.getItem(MAIL_TOKEN_KEY);if(saved)return saved;}catch(_){}
 try{return sessionStorage.getItem(MAIL_TOKEN_KEY)||"";}catch(_){return "";}
}
function mailSetToken(token){
 mailToken=token;
 let persistent=false;
 try{localStorage.setItem(MAIL_TOKEN_KEY,token);persistent=localStorage.getItem(MAIL_TOKEN_KEY)===token;}catch(_){}
 try{sessionStorage.setItem(MAIL_TOKEN_KEY,token);}catch(_){}
 return persistent;
}
async function mailFetch(route,body,token="",signal){
 const url=MAIL_LOCAL+route;
 const init={method:body===undefined?"GET":"POST",mode:"cors",cache:"no-store",
   headers:{"Content-Type":"application/json",...(token?{"X-Payments-Token":token}:{})},
   ...(signal?{signal}:{}),...(body===undefined?{}:{body:JSON.stringify(body)})};
 // Retry construction only, never retry a POST automatically after an uncertain network result.
 let request;
 try{request=new Request(url,{...init,credentials:"omit",targetAddressSpace:"loopback"});}
 catch(e){if(!(e instanceof TypeError))throw e;request=new Request(url,{...init,credentials:"omit"});}
 const response=await fetch(request);
 const data=await response.json().catch(()=>({error:"Некорректный ответ локального сервера"}));
 if(!response.ok)throw Error(data.error||"Локальный сервер вернул ошибку");
 return data;
}
// A failed status GET is safe to retry; sending a POST is never retried automatically.
async function mailProbe(token){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),1200);
 try{return await mailFetch("/v1/status",undefined,token,controller.signal);}
 finally{clearTimeout(timeout);}
}
function mailLaunchProtocol(){
 // No financial data or authentication material in the protocol URL.
 // A temporary link avoids navigating the AppBox document itself.
 const link=document.createElement("a");
 link.href=MAIL_START_URL;link.style.display="none";
 document.body.appendChild(link);try{link.click();}finally{link.remove();}
}
function mailProgress(label){
 const button=$("send-payments-mail");if(button)button.textContent=label;
}
async function mailEnsureServer(token){
 try{return await mailProbe(token);}
 catch(error){
   if(!(error instanceof TypeError)&&error.name!=="AbortError")throw error;
 }
 // If the initial network probe exhausted transient user activation, request a
 // fresh click in our own dialog before invoking an external Windows protocol.
 if(typeof navigator!=="undefined"&&navigator.userActivation&&!navigator.userActivation.isActive){
   if(!await appDialog("Mail Server пока не отвечает. Запустить локальный модуль Windows? Если браузер спросит разрешение, выберите «Открыть».",{title:"Запуск Mail Server",ok:"Запустить"}))return null;
 }
 mailProgress("Запускаем Mail Server…");
 mailLaunchProtocol();
 const deadline=Date.now()+18000;
 while(Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,500));
   try{return await mailProbe(token);}
   catch(error){if(!(error instanceof TypeError)&&error.name!=="AbortError")throw error;}
 }
 throw Error("Mail Server не ответил. Проверьте, включён ли запуск по кнопке Payments в локальном окне сервера. Если AppBox блокирует внешний протокол или локальную сеть, используйте BAT или автозапуск Windows");
}
async function mailConnect(){
 try{
   const t=mailGetToken();
   const status=await mailEnsureServer(t);
   if(!status)return null;
   if(status.version!==1)throw Error("Версия локального сервера несовместима с Payments");
   if(!status.ready)throw Error("Откройте http://127.0.0.1:8765/ и сохраните почту Яндекс");
   if(status.paired)return {token:t,sender:status.sender};
   const code=await appPrompt("Первое подключение или привязка сброшена. Откройте http://127.0.0.1:8765/, при необходимости нажмите «Получить код подключения» и введите шесть цифр. Пароль почты сюда не вводится.");
   if(code===null)return null;
   if(!/^\d{6}$/.test(code))throw Error("Код подключения должен состоять из шести цифр");
   const paired=await mailFetch("/v1/pair",{code});
   const remembered=mailSetToken(paired.token);
   if(!remembered)toast("Браузер не разрешает постоянное сохранение привязки. Код может понадобиться после закрытия приложения.",10000);
   const verified=await mailProbe(paired.token);
   if(!verified.paired||!verified.sender)throw Error("Не удалось подтвердить привязку Mail Server");
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
function mailStateStamp(){return JSON.stringify([state.date,state.snapshot?.fingerprint,state.settings,state.plans]);}
async function sendPaymentMail(){
 if(mailBusy)return;
 mailBusy=true;
 const button=$("send-payments-mail");
 if(button){button.disabled=true;button.textContent="Готовим отправку…";}
 try{
   const stamp=mailStateStamp();
   const draft=mailDraft();
   const fmt=fmtDate(state.date);
   const connected=await mailConnect();
   if(!connected)return;
   if(!await appDialog("Отправитель: "+connected.sender+
     "\nДата платежей: "+fmt+"\nПоставщиков: "+draft.supplierCount+"\nВсего: "+rub(draft.payload.totalCents)+
     "\nПолучатели: генеральный директор, коммерческий директор, главный бухгалтер и бухгалтер (4)."+
     "\nВ письме — таблица поставщиков; во вложении — Excel с документами.",{title:"Подтверждение отправки",ok:"Отправить"}))return;
   if(button)button.textContent="Отправляем…";
   const payload={...draft.payload,xlsxBase64:await blobBase64(draft.book)};
   if(mailStateStamp()!==stamp)throw Error('Реестр изменился до отправки. Подтвердите актуальные суммы заново');
   let result;
   try{
     result=await mailFetch("/v1/send",payload,connected.token);
   }catch(err){
     if(/уже отправлялся|отправка была начата/i.test(err.message)){
       if(!await appConfirm("Этот реестр уже отправлялся или отправка была начата. Проверьте папку «Отправленные» Яндекса. Всё равно повторить отправку?"))return;
       if(mailStateStamp()!==stamp)throw Error('Реестр изменился до повторной отправки');
       result=await mailFetch("/v1/send",{...payload,force:true},connected.token);
     }else throw err;
   }
   if(result.ok&&result.status==="accepted"){
     if(mailStateStamp()!==stamp){toast('SMTP принял письмо с подтверждённым реестром, но локальные данные изменились. Новые суммы не перезаписаны. Проверьте отправленное письмо перед дальнейшими действиями.',15000);return;}
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
