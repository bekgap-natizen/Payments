const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
test('manual Excel export has no budget intercept and budget panel warns about overrun',()=>{
 const source=read('src/ui/30-payments.js');
 assert.doesNotMatch(source,/stopImmediatePropagation|превышен лимит|не задан лимит|примените введённые лимиты/);
 const context={
  state:{date:'2026-11-23',plans:{}},
  readLocal:(key,def)=>key==='org-budgets'?{'2026-11-23¦ИП Лазуткин А. Д.':10000}:def,
  esc:String, rub:n=>(n/100).toFixed(2),currencyInput:n=>(n/100).toFixed(2),
  paymentBlocked:()=>false
 };
 vm.createContext(context);vm.runInContext(source,context);
 const org='ИП Лазуткин А. Д.';
 const model={active:[{org,key:'1',supplier:'Контрагент',plan:{status:'draft',items:{doc:15000}},planNeedsReview:false}]};
 const html=context.budgetPanel(model,[org]);
 assert.match(html,/Сверх плана/);assert.match(html,/ручная оплата разрешена/);
 assert.match(html,/50\.00/);
});
test('manual supplier approval remains permitted with plan lower than manually selected payment',()=>{
 const source=read('src/ui/70-actions.js');
 assert.doesNotMatch(source,/if\s*\(committed\+sum>limit\)/);
 const slice=source.slice(source.indexOf('function action('));
 const row={key:'R',org:'Org',supplier:'Vendor',plan:{status:'draft',items:{doc:15000}},planNeedsReview:false,unmatchedCents:0,unallocatedCents:0};
 const state={date:'2026-11-23',snapshot:{fingerprint:'fp'},plans:{'2026-11-23¦R':{status:'draft',items:{doc:15000}}}};
 let approved=false;
 const context={state,planId:k=>'2026-11-23¦'+k,currentRow:()=>row,checkTotal:()=>15000,paymentBlocked:()=>false,
  confirm:()=>true,saveLocal:()=>{},draw:()=>{},toast:()=>{},rub:String,Date,console};
 vm.createContext(context);vm.runInContext(slice,context);context.action('R','approve');
 assert.equal(state.plans['2026-11-23¦R'].status,'approved');
});
