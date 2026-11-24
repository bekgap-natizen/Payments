const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const C=require('../dist/assets/core.js');
const date='2026-11-24';
const org='ИП Лазуткин А. Д.';
const name='ИП Баранов Роман Борисович';
const receipt=(row,amount)=>({kind:'receipt',row,incomingNumber:'D'+row,incomingDate:'2026-10-01',amountCents:-amount});
const report={fingerprint:'F',organizations:[{name:org,reportedBalanceCents:-30837415,suppliers:[
{name,reportedBalanceCents:-24837415,documents:[receipt(1,24437415)]},
{name:'Поставщик без ошибок',reportedBalanceCents:-5000000,documents:[receipt(2,5000000)]},
{name:'Неактивный с расхождением',reportedBalanceCents:-1000000,documents:[receipt(3,900000)]}
]}]};
const key=n=>C.supplierKey(org,n);
const state={date,snapshot:{name:'Тест'},settings:{[key(name)]:{tracked:true,delay:0},[key('Поставщик без ошибок')]:{tracked:true,delay:0}},plans:{},onlyDue:true,openVendors:new Set()};
const ctx={C,state,rub:C.money,esc:C.escapeHtml,fmtDate:C.prettyDate,header:()=>'',kpi:()=>'',currencyInput:String,readLocal:(_,v)=>v,planId:k=>date+'¦'+k};
vm.createContext(ctx);
for(const file of ['src/ui/10-overview.js','src/ui/30-payments.js','src/ui/55-due-drafts.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
const actions=fs.readFileSync('src/ui/70-actions.js','utf8');vm.runInContext(actions.slice(actions.indexOf('function checkTotal('),actions.indexOf('function updateDocument(')),ctx);
test('overview and payment page show Baranov and reason even without selected payment',()=>{
 const model=C.analyze(report,date,state.settings,state.plans);
 const warnings=ctx.counterpartyWarnings(model,ctx.paymentSelection(model));
 assert.equal(warnings.length,2);
 const row=warnings.find(w=>w.row.supplier===name);
 assert.ok(row.blocked);assert.equal(row.row.debtCents,24837415);assert.equal(row.row.unmatchedCents,400000);assert.equal(row.difference,-400000);
 for(const html of [ctx.renderOverview(model),ctx.renderPayments(model)]){
 assert.match(html,/Контрагенты — требуют проверки \(2\)/);
 assert.match(html,/Баранов Роман Борисович/);
 assert.match(html,/Итог поставщика отличается от суммы документов/);
 assert.match(html,/Не включено в реестр/);
 assert.match(html,/Неактивный с расхождением/);
 assert.match(html,/Не участвует в платежах/);
 }
});
test('clean supplier stays eligible and not listed among warnings',()=>{
 const model=C.analyze(report,date,state.settings,state.plans);
 const clean=model.active.find(r=>r.supplier==='Поставщик без ошибок');
 const plans={[date+'¦'+clean.key]:{status:'draft',items:{[clean.allocatedDocuments[0].id]:5000000},sourceFingerprint:'F',delayDays:0}};
 const next=C.analyze(report,date,state.settings,plans);
 assert.equal(ctx.paymentSelection(next).cents,5000000);
 assert.doesNotMatch(ctx.renderCounterpartyWarnings(next,ctx.paymentSelection(next)),/Поставщик без ошибок/);
});