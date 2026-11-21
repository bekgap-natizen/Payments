import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(), src=path.join(root,'dist'), out=path.join(root,'release'), stage=path.join(out,'appbox');
if(!fs.existsSync(path.join(src,'index.html')))throw Error('Run npm run build before AppBox packaging');
fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
fs.cpSync(path.join(src,'assets'),path.join(stage,'assets'),{recursive:true});
fs.copyFileSync(path.join(src,'index.html'),path.join(stage,'index.html'));
const metadata={formatVersion:1,slug:'volmax-payments',name:'ВОЛМАКС — Платежи поставщикам',description:'Реестр платежей ВОЛМАКС: импорт 1С, бюджеты организаций, распределение по приоритетам, согласование и Excel.',version:JSON.parse(fs.readFileSync('package.json','utf8')).version,entry:'index.html',mode:'stateless'};
fs.writeFileSync(path.join(stage,'appbox.json'),JSON.stringify(metadata,null,2)+'\n','utf8');
const files=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name),rel=path.relative(stage,full).replaceAll(path.sep,'/');if(item.isDirectory())walk(full);else if(item.isFile())files.push(rel);else throw Error('Unsupported special file: '+rel);}}
walk(stage);
if(files.length>500)throw Error('Too many files');
const allowed=/^(appbox\.json|index\.html|assets\/[a-zA-Z0-9._/-]+\.(?:js|mjs|css|json|txt|csv|pdf|png|jpg|jpeg|webp|gif|avif|ico|woff|woff2|ttf|otf))$/i;
for(const file of files){if(!allowed.test(file)||file.split('/').some(s=>s.startsWith('.')||s==='..'))throw Error('Disallowed AppBox resource: '+file);
 const st=fs.statSync(path.join(stage,file));if(st.size>25*1024*1024)throw Error('Oversized file: '+file);}
const html=fs.readFileSync(path.join(stage,'index.html'),'utf8');
if(!html.toLowerCase().includes('<!doctype html>'))throw Error('Missing HTML entry');
const references=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x=>x[1]);
for(const ref of references){if(ref.startsWith('/')||ref.includes('://')||ref.startsWith('..')||!fs.existsSync(path.join(stage,ref)))throw Error('Invalid or missing resource: '+ref);}
for(const file of files.filter(f=>f.endsWith('.js')||f.endsWith('.css'))){const content=fs.readFileSync(path.join(stage,file),'utf8');if(/\b(?:eval|new\s+Function)\s*\(/.test(content))throw Error('Prohibited dynamic execution: '+file);if(file.endsWith('.css')&&/@import\b/i.test(content))throw Error('CSS @import: '+file);}
const zip=path.join(out,'VOLMAX-Payments-AppBox.appbox.zip');
fs.rmSync(zip,{force:true});execFileSync('zip',['-q','-r','-X',zip,'appbox.json','index.html','assets'],{cwd:stage});
const size=fs.statSync(zip).size;if(size>25*1024*1024)throw Error('AppBox ZIP over limit');
execFileSync('unzip',['-tqq',zip]);
const standardZip=path.join(out,'VOLMAX-Payments-AppBox-Standard.zip');
fs.rmSync(standardZip,{force:true});
execFileSync('zip',['-q','-r','-X',standardZip,'index.html','assets'],{cwd:stage});
execFileSync('unzip',['-tqq',standardZip]);
if(fs.statSync(standardZip).size>25*1024*1024)throw Error('Standard ZIP over limit');
console.log(JSON.stringify({output:zip,standardZip,files:files.length,zipBytes:size,mode:metadata.mode,version:metadata.version},null,2));