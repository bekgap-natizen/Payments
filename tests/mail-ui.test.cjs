const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/ui/85-mail.js','utf8');
test('AppBox has a separate confirm-and-send button, no SMTP password or sender in frontend',()=>{
 const page=fs.readFileSync('src/ui/30-payments.js','utf8');
 const events=fs.readFileSync('src/ui/99-events.js','utf8');
 assert.match(page,/id="send-payments-mail"/);
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
