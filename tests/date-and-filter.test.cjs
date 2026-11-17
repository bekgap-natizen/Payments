const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8');
function context(){
 const ctx={state:{onlyDue:false,paymentOrg:'',paymentSearch:'',date:'2026-11-16',openVendors:new Set()},C:{key:x=>String(x).toLowerCase()},header:()=>'',missing:()=>'',fmtDate:x=>x||'',rub:x=>String(x),esc:x=>String(x),kpi:()=>'',labelOf:x=>x||'',currencyInput:x=>String(x),paymentSelection:()=>({eligible:[],blocked:[],cents:0}),paymentBlocked:()=>false};
 vm.createContext(ctx);vm.runInContext(read('src/ui/30-payments.js'),ctx);return ctx;
}
const mkDoc=(id,date,due,amount=100)=>({id,row:1,incomingNumber:id,incomingDate:date,dueDate:date,allocatedCents:amount,remainingCents:amount,dueNow:due});
const newDoc=mkDoc('DOC-FUTURE','2026-12-01',false),oldDoc=mkDoc('DOC-DUE','2026-10-01',true);
const mk=(name,items,status='draft')=>({org:'Org',supplier:name,key:name,plan:{status,items},debtCents:200,dueCents:100,plannedCents:0,flags:[],allocatedDocuments:[newDoc,oldDoc],leftCents:200,allocatedCents:200,unmatchedCents:0});
test('filtered invoices: selected future payment remains, unselected due invoice disappears; unfilter restores both',()=>{
 const c=context(),r=mk('Supplier',{'DOC-FUTURE':40});
 c.state.onlyDue=true;const a=c.docRows(r);
 assert.match(a,/DOC-FUTURE/);assert.doesNotMatch(a,/DOC-DUE/);
 c.state.onlyDue=false;const b=c.docRows(r);
 assert.match(b,/DOC-FUTURE/);assert.match(b,/DOC-DUE/);
 assert.equal(r.plan.items['DOC-FUTURE'],40);assert.equal(r.allocatedDocuments[0].id,'DOC-FUTURE');
});
test('filtered suppliers: manual selections appear, removed and paid suppliers disappear; original order remains',()=>{
 const c=context(),active=[mk('ALPHA',{}),mk('BETA',{'DOC-FUTURE':40}),mk('GAMMA',{'DOC-DUE':100},'paid'),mk('DELTA',{'DOC-DUE':20},'approved')];
 c.vendorCard=r=>'<span data-test-supplier="'+r.supplier+'"></span>';
 const model={active,totals:{dueCents:400,paidCents:100}};
 c.state.onlyDue=true;let h=c.renderPayments(model);
 assert.match(h,/data-test-supplier="BETA"/);assert.match(h,/data-test-supplier="DELTA"/);
 assert.doesNotMatch(h,/data-test-supplier="ALPHA"|data-test-supplier="GAMMA"/);
 assert.ok(h.indexOf('data-test-supplier="BETA"')<h.indexOf('data-test-supplier="DELTA"'));
 c.state.onlyDue=false;h=c.renderPayments(model);
 for(const s of active)assert.ok(h.includes('data-test-supplier="'+s.supplier+'"'));
 assert.equal(active[1].plan.items['DOC-FUTURE'],40);
});
test('today uses local calendar date rather than UTC, and import date does not overwrite saved snapshot date',()=>{
 const fixed=new Date(2026,10,17,0,15);
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[fixed.getTime()]));}}
 const c={Date:FixedDate,PaymentCore:{escapeHtml:String,prettyDate:String,money:String},document:{},localStorage:{},console};
 vm.createContext(c);
 vm.runInContext(read('src/ui/00-context.js').replace('(function () {',''),c);
 vm.runInContext(read('src/ui/50-import.js'),c);
 assert.equal(vm.runInContext('localToday()',c),'2026-11-17');
 vm.runInContext("state.date='2026-11-16'; state.snapshots=[];",c);
 assert.match(vm.runInContext('renderImport()',c),/id="report-date"[^>]*value="2026-11-17"/);
 vm.runInContext("state.importDate='2026-11-15'",c);
 assert.match(vm.runInContext('renderImport()',c),/id="report-date"[^>]*value="2026-11-15"/);
 assert.equal(vm.runInContext('state.date',c),'2026-11-16');
 assert.equal(vm.runInContext('localToday(new Date(2027,0,2,23,59))',c),'2027-01-02');
});
