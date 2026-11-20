/* ВОЛМАКС — платёжный реестр. Приложение не совершает денежных переводов. */
(function () {
'use strict';
const C=globalThis.PaymentCore;
const $=(id)=>document.getElementById(id);
const esc=C.escapeHtml, rub=(n)=>C.money(n||0), fmtDate=C.prettyDate;
const pages={overview:'Обзор',payments:'Платежи на дату',suppliers:'Поставщики',reconcile:'Контроль и сверка',import:'Обновить данные 1С'};
const STORE='volmax-payments-prototype-v1';
// The import form defaults to the local calendar day, independently of saved 1C snapshots.
function localToday(now=new Date()){const pad=n=>String(n).padStart(2,'0');return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;}
const state={page:'overview',date:null,importDate:localToday(),snapshots:[],snapshot:null,settings:{},plans:{},search:'',paymentSearch:'',supplierOrg:'',paymentOrg:'',openVendors:new Set(),onlyDue:false};
let db=null;const memSnapshots=new Map();
const planId=(k)=>state.date+'¦'+k;
function groupMoneyInput(value){
 const raw=String(value).replace(/[\s\u00a0\u202f]/g,'');
 if(!/^[+-]?\d*(?:[,.]\d*)?$/.test(raw))return String(value);
 const parts=raw.split(/[,.]/);
 return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(parts.length===2?','+parts[1]:'');
}
const currencyInput=n=>groupMoneyInput((n/100).toFixed(2));
function formatMoneyField(el){
 const before=el.value, pos=el.selectionStart??before.length;
 const count=before.slice(0,pos).replace(/\s/g,'').length;
 const after=groupMoneyInput(before);if(after===before)return;
 el.value=after;let i=0,seen=0;while(i<after.length&&seen<count){if(!/\s/.test(after[i]))seen++;i++;}
 try{el.setSelectionRange(i,i);}catch(_){}
}
function readLocal(k,def){try{return JSON.parse(localStorage.getItem(STORE+'-'+k))??def;}catch(_){return def;}}
function saveLocal(k,v){try{localStorage.setItem(STORE+'-'+k,JSON.stringify(v));}catch(_){toast('В этом браузере запрещено локальное сохранение. Не закрывайте вкладку до экспорта.');}}
function toast(msg,ms=4400){const el=$('toast');if(!el){alert(msg);return;}el.textContent=msg;el.classList.toggle('is-error',/^(Ошибка|Не удалось|Укажите|Выберите|Нельзя|Нет|Превыш)/.test(msg));el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),ms);}
function openDb(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window))return resolve(null);const req=indexedDB.open(STORE,1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('snapshots'))d.createObjectStore('snapshots',{keyPath:'date'});};req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);});}
function dbAll(){if(!db)return Promise.resolve([...memSnapshots.values()]);return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});}
function dbPut(v){if(!db){memSnapshots.set(v.date,v);toast('Временное хранилище — данные исчезнут после закрытия вкладки',7000);return Promise.resolve();}return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.objectStore('snapshots').put(v);});}
async function refreshSnapshots(){state.snapshots=await dbAll();state.snapshots.sort((a,b)=>b.date.localeCompare(a.date));state.snapshot=state.snapshots.find(s=>s.date===state.date)||null;}
function header(title,subtitle,actions=''){return `<div class="section-head"><div><h1>${esc(title)}</h1><p>${subtitle}</p></div><div class="section-actions">${actions}</div></div>`;}
function kpi(label,value,caption,icon='●'){return `<div class="kpi"><span class="icon">${icon}</span><div class="label">${esc(label)}</div><div class="value amount">${value}</div><div class="caption">${esc(caption)}</div></div>`;}
function missing(){return `<div class="card"><div class="empty"><span class="empty-icon">▤</span><h2>Нет ведомости на выбранную дату</h2><p>Загрузите исходный Excel из 1С и укажите дату отчёта. Расчёты не выполняются на основании старого файла без выбора даты.</p><button class="btn btn-primary" data-page="import">Обновить данные 1С →</button></div></div>`;}
function labelOf(status){return ({draft:'Выбрано (черновик)',approved:'Утверждено локально',paid:'Отмечено оплаченным'})[status]||'Не выбрано';}
function approvedRows(model){return model.active.filter(r=>r.plan.status==='approved'&&!r.planNeedsReview&&r.plannedCents>0);}
