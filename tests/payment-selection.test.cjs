const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../dist/assets/core.js'),E=require('../dist/assets/export.js');
const ui=fs.readFileSync('dist/assets/ui.js','utf8');
function extract(name,next){return ui.slice(ui.indexOf('function '+name+'('),ui.indexOf('\nfunction '+next+'(',ui.indexOf('function '+name+'(')));}
const ctx={C,state:{date:'2026-11-16',snapshot:{fingerprint:'F'},plans:{}},planId:k=>'2026-11-16¦'+k,saveLocal:()=>{},console};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/ui/55-due-drafts.js','utf8'),ctx);vm.runInContext(extract('checkTotal','updateDocument'),ctx);
let count=0;function test(name,fn){fn();count++;console.log('PASS',name)}
const date='2026-11-16';const mk=(name,docs,bal)=>({name,documents:docs,reportedBalanceCents:bal??docs.reduce((n,d)=>n+d.amountCents,0)});const receipt=(row,day,amt)=>({kind:'receipt',row,incomingDate:day,incomingNumber:'D'+row,amountCents:-amt});
const model={fingerprint:'F',organizations:[{name:'A',suppliers:[mk('Due',[receipt(1,'2026-09-01',100000),{kind:'payment',row:2,amountCents:40000}]),mk('Future',[receipt(3,'2026-11-15',50000)]),mk('Mismatch',[receipt(4,'2026-09-01',10000)],-20000),mk('Excluded',[receipt(5,'2026-09-01',30000)])]}]};const key=n=>C.supplierKey('A',n),settings=Object.fromEntries(['Due','Future','Mismatch','Excluded'].map(n=>[key(n),{tracked:n!=='Excluded',delay:30}]));
const calc=()=>C.analyze(model,date,settings,ctx.state.plans);let m=calc();
test('net debt already includes 1C payment',()=>assert.equal(m.active[0].debtCents,60000));
test('total debt includes untracked suppliers',()=>assert.equal(m.rows.reduce((n,r)=>n+r.debtCents,0),160000));
test('due drafts generated once',()=>assert.equal(ctx.prepareDueDrafts(m),true));m=calc();
test('only eligible due supplier selected',()=>{assert.equal(ctx.paymentSelection(m).cents,60000);assert.equal(Object.keys(ctx.state.plans).length,1)});
test('automatic selection not approval',()=>assert.equal(m.active[0].plan.status,'draft'));
test('future and mismatched supplier excluded',()=>assert.equal(ctx.paymentSelection(m).eligible.length,1));
const id=ctx.planId(key('Due')),d=Object.keys(ctx.state.plans[id].items)[0];
test('partial manual amount preserved',()=>{ctx.state.plans[id].items[d]=12345;ctx.prepareDueDrafts(calc());assert.equal(ctx.paymentSelection(calc()).cents,12345)});
test('manual removal preserved',()=>{ctx.state.plans[id].items={};ctx.prepareDueDrafts(calc());assert.equal(ctx.paymentSelection(calc()).cents,0)});
test('overpayment rejected',()=>{ctx.state.plans[id].items[d]=60001;assert.equal(ctx.paymentSelection(calc()).blocked.length,1)});
test('mismatched snapshot excluded',()=>{ctx.state.plans[id].items[d]=12345;ctx.state.plans[id].sourceFingerprint='OLD';assert.equal(ctx.paymentSelection(calc()).cents,0)});
ctx.state.plans[id].sourceFingerprint='F';ctx.state.plans[id].status='approved';
test('approved partial retained',()=>assert.equal(ctx.paymentSelection(calc()).cents,12345));
test('sheet first and one row per approved supplier',()=>{const x=E.makeSheetData(calc(),date);assert.equal(x[0][0],'16.11.26');assert.equal(x[0][1].filter(r=>r.type==='supplier').length,1);assert.equal(x[0][1].at(-1).values[2].cached,123.45);assert.equal(x[2][1].find(r=>r.values.includes('D1')).values[8],123.45)});
ctx.state.plans[id].status='paid';test('paid local excluded from proposed re-payment',()=>{const a=calc();assert.equal(ctx.paymentSelection(a).cents,0);assert.equal(a.active[0].leftCents,47655)});
