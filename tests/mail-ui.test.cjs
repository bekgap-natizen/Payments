const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/ui/85-mail.js','utf8');
test('AppBox has a separate confirm-and-send button, no SMTP password or sender in frontend',()=>{
 const page=fs.readFileSync('src/ui/30-payments.js','utf8');
 const events=fs.readFileSync('src/ui/99-events.js','utf8');
 assert.match(page,/id="send-payments-mail"/);
 assert.match(page,/id="export-payments" class="btn btn-export-excel"/);
 assert.match(page,/id="send-payments-mail" class="btn btn-primary"/);
 const styles=fs.readFileSync('src/styles/responsive-brand.css','utf8');
 assert.match(styles,/#page-payments #export-payments\.btn-export-excel/);

 assert.match(events,/sendPaymentMail\(\)/);
 assert.doesNotMatch(source,/smtp\.yandex\.ru|app-password|mishin@volmax\.ru/);
});
test('mail draft includes each selected supplier, total, date and matching Excel',()=>{
 const first={key:'A1',org:'Org A',supplier:'Supplier 1',plan:{status:'draft',items:{a:10000}},plannedCents:10000,delay:0},
       second={key:'A2',org:'Org A',supplier:'Supplier 2',plan:{status:'draft',items:{b:20000}},plannedCents:20000,delay:0},
       third={key:'B1',org:'Org B',supplier:'Supplier 3',plan:{status:'draft',items:{c:30000}},plannedCents:30000,delay:0};
 const records=[first,second,third];
 let savedModel;
 const state={date:'2026-11-23',snapshot:{fingerprint:'F',name:'1C'},plans:{}};
 const context={state,
  C:{analyze:(snap,date,settings,plans)=>({active:records.map(r=>({...r,plannedCents:plans[date+'¦'+r.key]?Object.values(plans[date+'¦'+r.key].items).reduce((a,b)=>a+b,0):r.plannedCents,plan:plans[date+'¦'+r.key]||r.plan}))})},
  paymentSelection:()=>({eligible:records,cents:60000}),
  planId:key=>state.date+'¦'+key,
  PaymentExport:{makeXlsx:m=>{savedModel=m;return {book:true}}},
  Date,console};
 vm.createContext(context);vm.runInContext(source,context);
 const draft=context.mailDraft();
 assert.equal(draft.payload.totalCents,60000);
 assert.equal(draft.supplierCount,3);
 assert.equal(draft.payload.organizations.length,2);
 assert.deepEqual(Array.from(draft.payload.organizations[0].suppliers,s=>s.name),['Supplier 1','Supplier 2']);
 assert.equal(savedModel.active.length,3);
 assert.ok(draft.book.book);
 assert.equal(Object.values(draft.next).filter(x=>x.status==='approved').length,3);
});

test('saved browser pairing survives page reload and sessionStorage loss',()=>{
 const disk=new Map();
 const localStorage={getItem:k=>disk.get(k)||null,setItem:(k,v)=>disk.set(k,v)};
 const first={localStorage,sessionStorage:{getItem:()=>null,setItem:()=>{}}};
 vm.createContext(first);vm.runInContext(source,first);
 assert.equal(first.mailSetToken('test-token'),true);
 const restarted={localStorage,sessionStorage:{getItem:()=>null}};
 vm.createContext(restarted);vm.runInContext(source,restarted);
 assert.equal(restarted.mailGetToken(),'test-token');
});
test('blocked storage keeps temporary token without throwing',()=>{
 const storage={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};
 const ctx={localStorage:storage,sessionStorage:storage};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 assert.equal(ctx.mailSetToken('temporary'),false);
 assert.equal(ctx.mailGetToken(),'temporary');
});
test('already paired send uses exactly one confirmation, one POST, and approves only on acceptance',async()=>{
 const state={date:'2026-11-24',plans:{}}, confirmations=[],requests=[];
 const ctx={state,$:()=>null,fmtDate:String,rub:String,saveLocal:()=>{},draw:()=>{},toast:()=>{},
 appDialog:async(message,options)=>{confirmations.push({message,options});return true;}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.mailDraft=()=>({next:{approved:true},book:{},payload:{date:state.date,totalCents:150000000,organizations:[]},supplierCount:2});
 ctx.mailConnect=async()=>({sender:'employee@example.invalid',token:'test-token'});
 ctx.blobBase64=async()=>'test';
 ctx.mailFetch=async(...args)=>{requests.push(args);return {ok:true,status:'accepted',sender:'employee@example.invalid'}};
 await ctx.sendPaymentMail();
 assert.equal(confirmations.length,1);
 assert.equal(confirmations[0].options.ok,'Отправить');
 assert.match(confirmations[0].message,/employee@example.invalid/);
 assert.match(confirmations[0].message,/150000000/);
 assert.equal(requests.length,1);
 assert.equal(requests[0][0],'/v1/send');
 assert.equal(state.plans.approved,true);
 ctx.appDialog=async()=>false;
 state.plans={};await ctx.sendPaymentMail();
 assert.equal(requests.length,1);
 assert.equal(state.plans.approved,undefined);
});
test('uncertain fetch failure never retries a send POST automatically',async()=>{
 let calls=0;
 const ctx={Request:class{constructor(url,init){this.url=url;this.init=init;}},fetch:async()=>{calls++;throw new TypeError('network failure');}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 await assert.rejects(ctx.mailFetch('/v1/send',{totalCents:1},'token'),/network failure/);
 assert.equal(calls,1);
});

test('running server is reused without opening external protocol',async()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.mailProbe=async()=>({ready:true,paired:true});
 ctx.mailLaunchProtocol=()=>{throw Error('unexpected launch')};
 assert.equal((await ctx.mailEnsureServer('token')).ready,true);
});
test('offline server launches once and waits for readiness',async()=>{
 let probes=0, launches=0;
 const ctx={TypeError,setTimeout:fn=>{fn();},$:()=>null,navigator:{userActivation:{isActive:true}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.mailProbe=async()=>{if(++probes<3)throw new TypeError('offline');return {ready:true,paired:true};};
 ctx.mailLaunchProtocol=()=>{launches++;};
 assert.equal((await ctx.mailEnsureServer('token')).ready,true);
 assert.equal(launches,1);assert.equal(probes,3);
});
test('expired browser activation requests a fresh click; cancellation never launches',async()=>{
 const ctx={TypeError,navigator:{userActivation:{isActive:false}},appDialog:async()=>false};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.mailProbe=async()=>{throw new TypeError('offline');};
 ctx.mailLaunchProtocol=()=>{throw Error('unexpected launch');};
 assert.equal(await ctx.mailEnsureServer('token'),null);
});
test('startup deadline reports failure without sending payment',async()=>{
 let now=0,launches=0;
 const ctx={TypeError,Date:{now:()=>now},setTimeout:fn=>{now+=5000;fn();},$:()=>null};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.mailProbe=async()=>{throw new TypeError('offline');};ctx.mailLaunchProtocol=()=>{launches++;};
 await assert.rejects(ctx.mailEnsureServer('token'),/Mail Server не ответил/);
 assert.equal(launches,1);
});
