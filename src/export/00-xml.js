/* XLSX payment-run report, no external services or external libraries.
   All money is kept in integer kopecks until the final Excel numeric cell. */
(function(root){
'use strict';
const enc=new TextEncoder();
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function num(cents){return Number((cents/100).toFixed(2));}
function sheetXml(rows){
 let xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>';
 xml+='<cols><col min="1" max="1" width="4" customWidth="1"/><col min="2" max="2" width="39" customWidth="1"/><col min="3" max="3" width="19" customWidth="1"/><col min="4" max="4" width="19" customWidth="1"/><col min="5" max="5" width="29" customWidth="1"/><col min="6" max="6" width="18" customWidth="1"/><col min="7" max="7" width="22" customWidth="1"/><col min="8" max="8" width="20" customWidth="1"/><col min="9" max="9" width="44" customWidth="1"/></cols>';
 xml+='<sheetData>';
 rows.forEach((row,i)=>{
   const style={title:1,header:2,org:3,supplier:4,total:5,warning:6,section:7}[row.type]||0;
   const height=row.type==='title'?29:row.type==='org'?25:row.type==='header'?27:20;
   xml+=`<row r="${i+1}" ht="${height}" customHeight="1"${row.level ? ` outlineLevel="${row.level}"` : ''}>`;
   row.values.forEach((value,j)=>{
     if(value===null||value===undefined||value==='')return;
     const address=col(j)+(i+1);
     if(typeof value==='number'){
       const s=style===0?8:style;
       xml+=`<c r="${address}" s="${s}" t="n"><v>${value}</v></c>`;
     } else if(typeof value==='object'&&value.formula){
       xml+=`<c r="${address}" s="${style||8}"><f>${esc(value.formula)}</f><v>${value.cached??0}</v></c>`;
     } else {
       xml+=`<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
     }
   });xml+='</row>';
 });
 xml+='</sheetData><printOptions headings="0" gridLines="0"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>';
 return xml;
}
function styles(){return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);–"/></numFmts>
<fonts count="5"><font><sz val="10"/><name val="Aptos"/><color rgb="FF23334C"/></font>
<font><b/><sz val="17"/><name val="Aptos"/><color rgb="FF0C6091"/></font>
<font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font>
<font><b/><sz val="10"/><name val="Aptos"/><color rgb="FF0D5C82"/></font>
<font><b/><sz val="10"/><name val="Aptos"/><color rgb="FFB42318"/></font></fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF086FA8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE5F3FA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCEFEB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="3" fillId="4" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="3" fillId="6" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;}
// CRC-32 and uncompressed ZIP streaming, compatible with Excel/LibreOffice.
