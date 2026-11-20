const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const C=require('../dist/assets/core.js');
const source=fs.readFileSync('src/ui/00-context.js','utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function groupMoneyInput'),source.indexOf('function readLocal')),ctx);
test('money groups digits and preserves decimal precision',()=>{
 for(const [a,b] of [['1500000','1 500 000'],['1234567.89','1 234 567,89'],['1 234,','1 234,'],['0,05','0,05'],['',''],['abc','abc']])assert.equal(ctx.groupMoneyInput(a),b);
 assert.equal(C.cents(ctx.groupMoneyInput('1500000.05')),150000005);
 assert.equal(vm.runInContext('currencyInput(150000005)',ctx),'1 500 000,05');
});
test('typing retains caret relative to digits',()=>{const el={value:'1234',selectionStart:4,setSelectionRange(a,b){this.pos=a;}};ctx.formatMoneyField(el);assert.equal(el.value,'1 234');assert.equal(el.pos,5);});
