const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dist=path.resolve(__dirname,'../dist');
test('compiled shell opens import on first run without errors',async()=>{
 const elements=new Map();const rootNode={_html:'',get innerHTML(){return this._html},set innerHTML(v){this._html=String(v);for(const [,id] of this._html.matchAll(/\bid="([^"]+)"/g))elements.set(id,{classList:{toggle(){},add(){},remove(){}},textContent:'',innerHTML:''});}};
 elements.set('root',rootNode);const document={getElementById:id=>elements.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};const store=new Map();
 vm.runInNewContext(fs.readFileSync(path.join(dist,'assets/ui.js'),'utf8'),{PaymentCore:require(path.join(dist,'assets/core.js')),document,window:{addEventListener(){},scrollTo(){}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{hash:''},setTimeout,clearTimeout,console,alert(){throw Error('Unexpected alert')}});
 await new Promise(r=>setTimeout(r,25));assert.ok(rootNode.innerHTML.includes('page-overview'));assert.ok(rootNode.innerHTML.includes('data-page="import"'));assert.match(elements.get('page-import').innerHTML,/Ведомость из 1С/);
});
test('offline asset references and layout safety CSS packaged',()=>{const source=fs.readFileSync(path.join(dist,'assets/ui.js'),'utf8');const refs=[...new Set([...source.matchAll(/(?:src|href)=\\?"(\.\/assets\/[\w.-]+)\\?"/g)].map(m=>m[1]))];assert.ok(refs.length>0);for(const r of refs)assert.ok(fs.existsSync(path.join(dist,r)));assert.ok(fs.existsSync(path.join(dist,'assets/layout-safety.css')));assert.match(fs.readFileSync(path.join(dist,'index.html'),'utf8'),/assets\/layout-safety\.css/);});
