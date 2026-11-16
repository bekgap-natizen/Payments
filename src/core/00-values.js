/* ВОЛМАКС — платежи поставщикам. Pure parser and arithmetic, no external dependencies. */
(function (root) {
  'use strict';
  const encoder = new TextDecoder('utf-8');
  const attr = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? m[1] : ''; };
  function xmlDecode(v) {
    return String(v || '').replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_a, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[e] || _a;
    });
  }
  function cents(input) {
    if (input === null || input === undefined || String(input).trim() === '') return null;
    let s = String(input).replace(/[\s\u00a0\u202f₽р]/g, '').replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s)) return null;
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1); }
    if (s[0] === '+') s = s.slice(1);
    const [whole, fraction=''] = s.split('.');
    const value = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    if (!Number.isSafeInteger(value)) throw new Error('Сумма слишком велика для безопасного расчёта');
    return value * sign;
  }
  const money = (n) => (n/100).toLocaleString('ru-RU', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₽';
  const key = (name) => String(name || '').replace(/[\s\u00a0]+/g,' ').trim().toLocaleUpperCase('ru-RU');
  const supplierKey = (org, supplier) => key(org) + '¦' + key(supplier);
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s||'')) return false;
    const [y,m,d] = s.split('-').map(Number);
    const v = new Date(Date.UTC(y,m-1,d));
    return v.getUTCFullYear()===y && v.getUTCMonth()===m-1 && v.getUTCDate()===d;
  }
  function isoFromParts(d,m,y) { const s = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; return validDate(s) ? s : null; }
  function addDays(iso, days) { if (!validDate(iso) || !Number.isInteger(days) || days < 0) return null; const dt=new Date(iso+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()+days);return dt.toISOString().slice(0,10); }
  function prettyDate(iso) { return validDate(iso) ? iso.split('-').reverse().join('.') : '—'; }
  function parseIncomingField(raw) {
    const v = String(raw||'').trim();
    const matches=[...v.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g)];
    if (!matches.length) return {incomingNumber: v === ',' ? '' : v, incomingDate: null, error:'Не указана дата входящего документа'};
    const m=matches[matches.length-1], date=isoFromParts(+m[1],+m[2],+m[3]);
    const before=v.slice(0,m.index).replace(/[,\s]+$/,'').trim();
    return {incomingNumber:before,incomingDate:date,error:date?null:'Некорректная дата входящего документа'};
  }
