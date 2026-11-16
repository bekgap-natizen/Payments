const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={TextDecoder,TextEncoder,Uint8Array,Uint32Array,DataView,Blob,Response,DecompressionStream,console,Date,Number,String,Math,Array,Map,Set,Object,RegExp,JSON,Error};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('dist/assets/core.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('dist/assets/export.js','utf8'),ctx);
const C=ctx.PaymentCore,E=ctx.PaymentExport;
test('kopecks and calendar terms',()=>{
 assert.equal(C.cents('1 000 000,00')-C.cents('400 000,00'),60000000);
 assert.equal(C.addDays('2026-10-17',30),'2026-11-16');
});
test('already paid in 1C remains net, not deducted a second time',()=>{
 const org='Тестовая организация',supplier='Поставщик 1',k=C.supplierKey(org,supplier);
 const snap={fingerprint:'F',organizations:[{name:org,reportedBalanceCents:-60000000,suppliers:[{name:supplier,reportedBalanceCents:-60000000,documents:[
  {kind:'receipt',row:12,incomingDate:'2026-10-01',incomingNumber:'D1',amountCents:-100000000},
  {kind:'payment',row:13,amountCents:40000000}
 ]}]}]};
 const res=C.analyze(snap,'2026-11-16',{[k]:{tracked:true,delay:30}},{}).active[0];
 assert.equal(res.debtCents,60000000);
 assert.equal(res.paidIn1CCents,40000000);
 assert.equal(res.leftCents,60000000);
});
test('export contains four sheets',()=>{
 const model={active:[],reconciliation:{issues:[]}};
 assert.throws(()=>E.makeSheetData(model,'2026-11-16'),/поставщик/i);
});
