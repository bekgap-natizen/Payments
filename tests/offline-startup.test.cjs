const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function makeDom(){
  const elements = new Map();
  const rootNode = { _html:'', get innerHTML(){return this._html;}, set innerHTML(v){
    this._html=String(v);
    for(const [,id] of this._html.matchAll(/\bid="([^"]+)"/g)) {
      elements.set(id, { classList:{toggle(){},add(){},remove(){}}, textContent:'', innerHTML:'' });
    }
  }};
  elements.set('root', rootNode);
  return {
    document: {
      getElementById(id){return elements.get(id)||null;},
      querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){}
    }, rootNode, elements
  };
}

test('compiled release initializes its shell and renders first page', async()=>{
  const {document,rootNode,elements}=makeDom();
  const store=new Map();
  const sandbox={
    PaymentCore: require(path.join(dist,'assets/core.js')),
    document,
    window:{ addEventListener(){},scrollTo(){} },
    localStorage:{getItem(k){return store.get(k)||null;},setItem(k,v){store.set(k,v);}},
    location:{hash:''},
    setTimeout,clearTimeout,console,
    alert(){throw Error('Unexpected alert')}
  };
  vm.runInNewContext(fs.readFileSync(path.join(dist,'assets/ui.js'),'utf8'),sandbox,{filename:'assets/ui.js'});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(rootNode.innerHTML.includes('page-overview'), 'shell must create #page-overview');
  assert.ok(rootNode.innerHTML.includes('data-page="import"'), 'navigation must include import');
  assert.match(elements.get('page-overview').innerHTML,/Обзор платежей|Платежи поставщикам/);
});

test('all shell asset references are included in release build', ()=>{
  const source=fs.readFileSync(path.join(dist,'assets/ui.js'),'utf8');
  const references=[...new Set([...source.matchAll(/(?:src|href)=\\?"(\.\/assets\/[\w.-]+)\\?"/g)].map(m=>m[1]))];
  assert.ok(references.length>0,'shell images must be included');
  for(const ref of references){
    const file=path.join(dist,ref.replace(/^\.\//,''));
    assert.ok(fs.existsSync(file),'Missing released asset: '+ref);
  }
});
