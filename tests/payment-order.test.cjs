const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function ui(){const ctx={state:{paymentOrg:'',paymentSearch:'',onlyDue:false,date:'2026-11-16',openVendors:new Set()},C:{key:x=>String(x).toLowerCase()},header:()=>'',missing:()=>'',fmtDate:x=>x||'',rub:x=>String(x),esc:x=>String(x),kpi:()=>'',labelOf:x=>x||'',currencyInput:x=>String(x)};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/ui/55-due-drafts.js','utf8'),ctx);vm.runInContext(fs.readFileSync('src/ui/30-payments.js','utf8'),ctx);vm.runInContext(fs.readFileSync('src/ui/40-reconciliation.js','utf8'),ctx);ctx.vendorCard=r=>'<span data-pay-vendor="'+r.supplier+'"></span>';return ctx;}
const supplier=(org,supplier,dueCents)=>({org,supplier,key:org+supplier,debtCents:1000,dueCents,plannedCents:0,plan:{status:'draft'},flags:[],unallocatedCents:0});
test('original organization and supplier sorting preserved',()=>{const ctx=ui();const model={active:[supplier('ООО А','Альфа',100),supplier('ООО А','Бета',300),supplier('ООО Б','Гамма',200)],totals:{debtCents:3000,dueCents:600,plannedCents:0,paidCents:0}};const html=ctx.renderPayments(model);const pos=['Бета','Альфа','Гамма'].map(x=>html.indexOf('data-pay-vendor="'+x+'"'));assert.ok(pos.every(x=>x>=0));assert.ok(pos[0]<pos[1]&&pos[1]<pos[2]);assert.equal(model.active[0].supplier,'Альфа');});
test('documents displayed oldest first; no arithmetic mutation',()=>{const ctx=ui();const docs=[{id:'new',row:2,incomingNumber:'DOC-NEW',incomingDate:'2026-11-02',dueDate:'2026-12-02',allocatedCents:200,remainingCents:200},{id:'old',row:1,incomingNumber:'DOC-OLD',incomingDate:'2026-10-01',dueDate:'2026-10-31',allocatedCents:100,remainingCents:100}];const html=ctx.docRows({key:'k',plan:{status:'draft',items:{}},planNeedsReview:false,allocatedDocuments:docs});assert.ok(html.indexOf('DOC-OLD')<html.indexOf('DOC-NEW'));assert.equal(docs[0].id,'new');assert.equal(docs.reduce((n,d)=>n+d.remainingCents,0),300);});
test('first Excel sheet compact, original supplier order; documents retain oldest-first order',()=>{const E=require('../dist/assets/export.js');const ds=[{id:'new',incomingDate:'2026-11-02',incomingNumber:'DOC-NEW',dueDate:'2026-12-02',allocatedCents:100},{id:'old',incomingDate:'2026-10-01',incomingNumber:'DOC-OLD',dueDate:'2026-10-31',allocatedCents:100}];const mk=(org,supplier,docs)=>({org,supplier,debtCents:1000,allocatedCents:docs.length*100,dueCents:docs.length*100,futureCents:0,unmatchedCents:0,plannedCents:docs.length*100,flags:[],documents:docs,paymentDocuments:[],otherDocuments:[],plan:{status:'approved',items:Object.fromEntries(docs.map(d=>[d.id,100]))}});const model={active:[mk('ООО А','Янтарь',[ds[0]]),mk('ООО А','Альфа',ds),mk('ООО Б','Бета',[ds[0]])],reconciliation:{issues:[]}};const sheets=E.makeSheetData(model,'2026-11-16'),dated=sheets[0][1];assert.equal(sheets[0][0],'16.11.26');assert.deepEqual(dated.filter(x=>x.type==='supplier').map(x=>x.values[1]),['Альфа','Янтарь','Бета']);assert.equal(dated.at(-1).values[2].cached,4);const details=dated.filter(x=>x.type==='detail');assert.deepEqual(details.slice(0,2).map(x=>x.values[1]),['  № DOC-OLD от 01.10.2026','  № DOC-NEW от 02.11.2026']);assert.equal(sheets.length,1);});


test('supplier rows in exported Excel expand with plus into selected incoming documents',async()=>{
 const E=require('../dist/assets/export.js');
 const ds=[
  {id:'new',incomingDate:'2026-11-02',incomingNumber:'DOC-NEW',dueDate:'2026-11-11',allocatedCents:25000},
  {id:'old',incomingDate:'2026-10-01',incomingNumber:'DOC-OLD',dueDate:'2026-10-10',allocatedCents:15000}
 ];
 const r={org:'ООО А',supplier:'Поставщик',debtCents:40000,allocatedCents:40000,dueCents:40000,futureCents:0,unmatchedCents:0,plannedCents:30000,flags:[],documents:ds,paymentDocuments:[],otherDocuments:[],plan:{status:'approved',items:{new:20000,old:10000}}};
 const model={active:[r],reconciliation:{issues:[]}},rows=E.makeSheetData(model,'2026-11-16')[0][1];
 const parent=rows.findIndex(x=>x.type==='supplier');
 assert.equal(rows[parent].collapsed,true);
 assert.equal(rows[parent].values[2],300);
 assert.deepEqual(rows.slice(parent+1,parent+3).map(x=>x.type),['detail','detail']);
 assert.deepEqual(rows.slice(parent+1,parent+3).map(x=>x.values[2]),[100,200]);
 assert.ok(rows.slice(parent+1,parent+3).every(x=>x.hidden&&x.level===1));
 assert.equal(rows.at(-1).values[2].cached,300);
 const bytes=Buffer.from(await E.makeXlsx(model,'2026-11-16').arrayBuffer());
 const xml=bytes.toString('utf8');
 assert.match(xml,/summaryBelow="0"/);
 assert.match(xml,/outlineLevel="1" hidden="1"/);
 assert.match(xml,/collapsed="1"/);
 assert.match(xml,/DOC-OLD/);
 assert.match(xml,/DOC-NEW/);
});

test('payment sheet removes debt and due columns without changing payment totals or outline',()=>{
 const E=require('../dist/assets/export.js');
 const d={id:'invoice',incomingDate:'2026-11-01',incomingNumber:'INV-1',dueDate:'2026-11-10',allocatedCents:25000};
 const r={org:'ООО А',supplier:'Поставщик',debtCents:50000,allocatedCents:25000,dueCents:25000,futureCents:0,unmatchedCents:0,plannedCents:12500,flags:[],documents:[d],paymentDocuments:[],otherDocuments:[],plan:{status:'approved',items:{invoice:12500}}};
 const sheets=E.makeSheetData({active:[r],reconciliation:{issues:[]}},'2026-11-16');
 const dated=sheets[0][1],header=dated.find(x=>x.type==='header'),supplier=dated.find(x=>x.type==='supplier'),detail=dated.find(x=>x.type==='detail');
 assert.deepEqual(header.values,['','Организация / Поставщик','К оплате, ₽','Документов','Дата платежа']);
 assert.deepEqual(supplier.values,['','Поставщик',125,1,'16.11.2026']);
 assert.deepEqual(detail.values,['','  № INV-1 от 01.11.2026',125,'','10.11.2026']);
 assert.equal(supplier.collapsed,true);assert.equal(detail.hidden,true);assert.equal(detail.level,1);
 assert.equal(dated.at(-1).values[2].cached,125);
 assert.equal(sheets.length,1);assert.equal(dated[2].values[1],'Нажмите «+» для раскрытия входящих документов');
});
