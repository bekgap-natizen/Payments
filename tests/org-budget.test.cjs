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
 const ctx={C,state:{date,snapshot,settings,plans:{}},document:{addEventListener(){},querySelectorAll(){return [input]}},readLocal:(key,def)=>storage[key]??def,saveLocal:(key,v)=>{storage[key]=v},planId:key=>date+'¦'+key,confirm:()=>true,rub:String,draw(){},toast(msg){ctx.message=msg},console};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('src/ui/55-due-drafts.js','utf8'),ctx);
 const actions=fs.readFileSync('src/ui/70-actions.js','utf8');vm.runInContext(actions.slice(actions.indexOf('function checkTotal('),actions.indexOf('function updateDocument(')),ctx);
 vm.runInContext(fs.readFileSync('src/ui/30-payments.js','utf8'),ctx);
 const chosen=(name,org='A')=>Object.values(ctx.state.plans[ctx.planId(k(name,org))]?.items||{}).reduce((a,b)=>a+b,0);
 return {ctx,storage,input,chosen};
}
test('budget prioritizes critical then old invoices, allows partial, excludes future and blocked, preserves other org',()=>{
 const {ctx,storage,chosen}=setup();
 ctx.state.plans[ctx.planId(k('Other','B'))]={items:{x:900},status:'draft'};
 ctx.runOrgBudget('A');
 assert.equal(chosen('Critical'),40000);assert.equal(chosen('Old'),20000);assert.equal(chosen('Today'),0);assert.equal(chosen('Future'),0);assert.equal(chosen('Blocked'),0);assert.equal(chosen('Other','B'),900);
 assert.equal(storage['org-budgets'][date+'¦A'],60000);
});
test('locked plans count against budget; insufficient budget leaves plans unchanged',()=>{
 const {ctx,input,chosen}=setup();
 const r=C.analyze(snapshot,date,ctx.state.settings,{}).active.find(x=>x.supplier==='Critical');
 ctx.state.plans[ctx.planId(r.key)]={status:'approved',items:{[r.allocatedDocuments[0].id]:40000},sourceFingerprint:'F',delayDays:0};
 ctx.runOrgBudget('A');assert.equal(chosen('Old'),20000);
 const prev=JSON.stringify(ctx.state.plans);input.value='399';ctx.runOrgBudget('A');assert.match(ctx.message,/Ошибка/);assert.equal(JSON.stringify(ctx.state.plans),prev);
});
