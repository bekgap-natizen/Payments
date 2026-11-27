const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../dist/assets/core.js');
const date='2026-11-20';
const receipt=(row,day,amount)=>({kind:'receipt',row,incomingDate:day,incomingNumber:'D'+row,amountCents:-amount});
const sup=(name,documents)=>({name,documents,reportedBalanceCents:documents.reduce((n,d)=>n+d.amountCents,0)});
const snapshot={fingerprint:'F',organizations:[{name:'A',suppliers:[sup('Critical',[receipt(1,'2026-11-19',40000)]),sup('Old',[receipt(2,'2026-10-01',50000)]),sup('Today',[receipt(3,date,20000)]),sup('Future',[receipt(4,'2026-12-01',60000)]),sup('Blocked',[receipt(5,'2026-09-01',99000)])]},{name:'B',suppliers:[sup('Other',[receipt(6,date,10000)])]}]};
const k=(name,org='A')=>C.supplierKey(org,name);
function setup(){
 const settings=Object.fromEntries(snapshot.organizations.flatMap(o=>o.suppliers.map(s=>[k(s.name,o.name),{tracked:true,delay:0}])));
 const storage={'allocation-priorities':{[k('Critical')]:'critical',[k('Blocked')]:'blocked'}};
 const input={dataset:{budgetOrg:'A'},value:'600'};
 const ctx={C,state:{date,snapshot,settings,plans:{}},document:{addEventListener(){},querySelectorAll(){return [input]}},readLocal:(key,def)=>storage[key]??def,saveLocal:(key,v)=>{storage[key]=v},planId:key=>date+'¦'+key,appConfirm:async()=>true,currencyInput:n=>(n/100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,' ').replace('.',','),rub:String,draw(){},toast(msg){ctx.message=msg},console};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('src/ui/55-due-drafts.js','utf8'),ctx);
 const actions=fs.readFileSync('src/ui/70-actions.js','utf8');vm.runInContext(actions.slice(actions.indexOf('function checkTotal('),actions.indexOf('function updateDocument(')),ctx);
 vm.runInContext(fs.readFileSync('src/ui/30-payments.js','utf8'),ctx);
 const chosen=(name,org='A')=>Object.values(ctx.state.plans[ctx.planId(k(name,org))]?.items||{}).reduce((a,b)=>a+b,0);
 return {ctx,storage,input,chosen};
}
test('budget prioritizes critical then old invoices, allows partial, excludes future and blocked, preserves other org',async()=>{
 const {ctx,storage,chosen}=setup();
 ctx.state.plans[ctx.planId(k('Other','B'))]={items:{x:900},status:'draft'};
 await ctx.runOrgBudget('A');
 assert.equal(chosen('Critical'),40000);assert.equal(chosen('Old'),20000);assert.equal(chosen('Today'),0);assert.equal(chosen('Future'),0);assert.equal(chosen('Blocked'),0);assert.equal(chosen('Other','B'),900);
 assert.equal(storage['org-budgets'][date+'¦A'],60000);
});
test('locked plans count against budget; insufficient budget leaves plans unchanged',async()=>{
 const {ctx,input,chosen}=setup();
 const r=C.analyze(snapshot,date,ctx.state.settings,{}).active.find(x=>x.supplier==='Critical');
 ctx.state.plans[ctx.planId(r.key)]={status:'approved',items:{[r.allocatedDocuments[0].id]:40000},sourceFingerprint:'F',delayDays:0};
 await ctx.runOrgBudget('A');assert.equal(chosen('Old'),20000);
 input.value='399';await ctx.runOrgBudget('A');assert.match(ctx.message,/Предупреждение/);assert.equal(chosen('Critical'),40000);assert.equal(chosen('Old'),0);
});

test('after auto allocation manual edits can raise or lower selected total regardless of budget',async()=>{
 const {ctx,chosen}=setup();await ctx.runOrgBudget('A');
 const actions=fs.readFileSync('src/ui/70-actions.js','utf8');
 ctx.currentRow=k=>C.analyze(snapshot,date,ctx.state.settings,ctx.state.plans).active.find(r=>r.key===k);
 ctx.toast=msg=>{ctx.message=msg};
 ctx.state.openVendors=new Set();
 vm.runInContext(actions.slice(actions.indexOf('function getPlan('),actions.indexOf('async function action(')),ctx);
 const oldKey=k('Old'), oldDoc=ctx.currentRow(oldKey).allocatedDocuments[0];
 ctx.updateDocument(oldKey,oldDoc.id,'value','500'); // exceed 600 budget together with critical 400
 assert.equal(chosen('Old'),50000);assert.equal(chosen('Critical'),40000);
 ctx.updateDocument(oldKey,oldDoc.id,'value','100');
 assert.equal(chosen('Old'),10000);assert.equal(chosen('Critical'),40000);
 const status=ctx.state.plans[ctx.planId(oldKey)].status;
 assert.equal(status,'draft');
});

test('1 500 000 rubles distribute to eligible Yutara documents and preserve separators',async()=>{
 const {ctx,input,storage}=setup();
 const org='АквариусПРО ООО',supplier='Ютара',key=C.supplierKey(org,supplier);
 ctx.state.snapshot={fingerprint:'F',organizations:[{name:org,suppliers:[sup(supplier,[receipt(11,'2026-10-01',100000000),receipt(12,'2026-10-02',70000000)])]}]};
 ctx.state.settings={[key]:{tracked:true,delay:0}};
 input.dataset.budgetOrg=org;input.value='1500000';
 await ctx.runOrgBudget(org);
 assert.equal(input.value,'1 500 000,00');
 assert.equal(storage['org-budgets'][date+'¦'+org],150000000);
 const plan=ctx.state.plans[ctx.planId(key)];
 assert.equal(Object.values(plan.items).reduce((a,b)=>a+b,0),150000000);
 assert.equal(ctx.paymentSelection(C.analyze(ctx.state.snapshot,date,ctx.state.settings,ctx.state.plans)).cents,150000000);
});
test('cancelled confirmation keeps the formatted budget and does not change payments',async()=>{
 const {ctx,input}=setup();
 input.value='1500000';ctx.appConfirm=async()=>false;
 await ctx.runOrgBudget('A');
 assert.equal(input.value,'1 500 000,00');
 assert.equal(Object.keys(ctx.state.plans).length,0);
 assert.equal(ctx.state.budgetInput[date+'¦A'],'1 500 000,00');
});

function enableActions(ctx){
 ctx.state.openVendors=new Set();
 const source=fs.readFileSync('src/ui/70-actions.js','utf8');
 vm.runInContext(source,ctx);
}
test('manual supplier checkbox allocates one million to not-yet-due invoices, without touching other organizations',async()=>{
 const {ctx,input,chosen}=setup();
 const org='Org A',supplier='Supplier A',key=k(supplier,org);
 ctx.state.snapshot={fingerprint:'F',organizations:[
 {name:org,suppliers:[sup(supplier,[receipt(11,'2026-11-01',70000000),receipt(12,'2026-11-02',60000000)])]},
 {name:'B',suppliers:[sup('Other',[receipt(13,'2026-11-01',10000)])]}]};
 ctx.state.settings={[key]:{tracked:true,delay:60},[k('Other','B')]:{tracked:true,delay:0}};
 const other=ctx.planId(k('Other','B'));ctx.state.plans[other]={items:{x:900},status:'draft'};
 input.dataset.budgetOrg=org;input.value='1000000';
 await ctx.runOrgBudget(org);
 assert.equal(chosen(supplier,org),0);
 enableActions(ctx);
 const r=ctx.currentRow(key);
 assert.equal(r.dueCents,0);assert.equal(ctx.supplierCheckboxState(r).disabled,false);
 await ctx.action(key,'toggle-supplier');
 assert.equal(chosen(supplier,org),100000000);
 const p=ctx.state.plans[ctx.planId(key)];
 assert.equal(p.items[r.allocatedDocuments[1].id],70000000);
 assert.equal(p.items[r.allocatedDocuments[0].id],30000000);
 assert.equal(p.manual,true);
 assert.equal(chosen('Other','B'),900);
 assert.equal(ctx.supplierCheckboxState(ctx.currentRow(key)).checked,true);
 assert.equal(ctx.supplierCheckboxState(ctx.currentRow(key)).partial,undefined);
 assert.equal(ctx.paymentSelection(C.analyze(ctx.state.snapshot,date,ctx.state.settings,ctx.state.plans)).eligible.find(x=>x.key===key).supplier,supplier);
});
test('supplier checkbox only uses leftover budget; manual edits and cancellation survive redistribution',async()=>{
 const {ctx,input,chosen}=setup();
 // Future due date must be derived from an existing receipt, not a future-dated receipt.
 const org='A',future=k('Future');
 const suppliers=ctx.state.snapshot.organizations[0].suppliers.map(s=>s.name==='Future'?sup('Future',[receipt(4,'2026-11-19',60000)]):s);
 ctx.state.snapshot={...ctx.state.snapshot,organizations:[{name:org,suppliers},ctx.state.snapshot.organizations[1]]};
 ctx.state.settings[future].delay=60;
 input.value='1500';await ctx.runOrgBudget(org);
 assert.equal(chosen('Critical'),40000);assert.equal(chosen('Old'),50000);assert.equal(chosen('Today'),20000);
 enableActions(ctx);
 await ctx.action(future,'toggle-supplier');
 assert.equal(chosen('Future'),40000);assert.equal(chosen('Critical'),40000);assert.equal(chosen('Old'),50000);
 const d=ctx.currentRow(future).allocatedDocuments[0];
 ctx.updateDocument(future,d.id,'value','250');assert.equal(chosen('Future'),25000);
 await ctx.runOrgBudget(org);assert.equal(chosen('Future'),25000);assert.equal(chosen('Old'),50000);
 ctx.appConfirm=async()=>false;await ctx.action(future,'toggle-supplier');assert.equal(chosen('Future'),25000);
 ctx.appConfirm=async()=>true;await ctx.action(future,'toggle-supplier');assert.equal(chosen('Future'),0);
 await ctx.runOrgBudget(org);assert.equal(chosen('Future'),0);
 assert.equal(chosen('Critical'),40000);
});
test('checkbox does not exceed supplier debt or budget and keeps manual amount override available',async()=>{
 const {ctx,input,chosen}=setup();
 const key=k('Critical');input.value='0';await ctx.runOrgBudget('A');
 enableActions(ctx);
 await ctx.action(key,'toggle-supplier');assert.equal(chosen('Critical'),0);
 const d=ctx.currentRow(key).allocatedDocuments[0];
 ctx.updateDocument(key,d.id,'value','200');assert.equal(chosen('Critical'),20000);
 input.value='5000';await ctx.runOrgBudget('A');assert.equal(chosen('Critical'),20000);
});

test('stale draft remains available for reconciliation instead of being silently erased',async()=>{
 const {ctx,input}=setup();await ctx.runOrgBudget('A');enableActions(ctx);
 const key=k('Old'),d=ctx.currentRow(key).allocatedDocuments[0];
 ctx.updateDocument(key,d.id,'value','100');
 const id=ctx.planId(key),before=JSON.stringify(ctx.state.plans[id]);
 ctx.state.snapshot={...ctx.state.snapshot,fingerprint:'NEW'};
 input.value='1500';await ctx.runOrgBudget('A');
 assert.equal(JSON.stringify(ctx.state.plans[id]),before);
 assert.equal(ctx.currentRow(key).planNeedsReview,true);
 assert.equal(ctx.paymentSelection(C.analyze(ctx.state.snapshot,date,ctx.state.settings,ctx.state.plans)).eligible.some(r=>r.key===key),false);
});
test('reopened approved manual choice is preserved on repeated automatic distribution',async()=>{
 const {ctx,input,chosen}=setup();await ctx.runOrgBudget('A');enableActions(ctx);
 const key=k('Old'),id=ctx.planId(key);
 ctx.state.plans[id]={...ctx.state.plans[id],status:'approved'};
 await ctx.action(key,'reopen');
 assert.equal(ctx.state.plans[id].manual,true);
 input.value='5000';await ctx.runOrgBudget('A');assert.equal(chosen('Old'),20000);
});
test('clear confirmation cannot overwrite a concurrently changed plan',async()=>{
 const {ctx,chosen}=setup();await ctx.runOrgBudget('A');enableActions(ctx);
 const key=k('Old'),id=ctx.planId(key),d=ctx.currentRow(key).allocatedDocuments[0];
 ctx.appConfirm=async()=>{ctx.state.plans[id]={...ctx.state.plans[id],items:{[d.id]:12345}};return true;};
 await ctx.action(key,'clear');
 assert.equal(chosen('Old'),12345);
 assert.match(ctx.message,/Данные изменились/);
});
