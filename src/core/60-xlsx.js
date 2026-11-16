  function escapeHtml(s) {return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function extractZip(zipFile) {
    const bytes=new Uint8Array(await zipFile.arrayBuffer()),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}
    if(eocd<0)throw new Error('Файл не является корректным XLSX (ZIP)');
    const count=dv.getUint16(eocd+10,true),offset=dv.getUint32(eocd+16,true),entries=new Map();
    let p=offset;
    for(let j=0;j<count;j++){
      if(dv.getUint32(p,true)!==0x02014b50)throw new Error('Повреждён каталог XLSX');
      const method=dv.getUint16(p+10,true),size=dv.getUint32(p+20,true),len=dv.getUint16(p+28,true),extra=dv.getUint16(p+30,true),comment=dv.getUint16(p+32,true),start=dv.getUint32(p+42,true);
      const name=encoder.decode(bytes.subarray(p+46,p+46+len));
      entries.set(name.toLowerCase(),{method,size,start});p+=46+len+extra+comment;
    }
    async function read(name) {
      const x=entries.get(name.toLowerCase());if(!x)throw new Error('В XLSX отсутствует '+name);
      const p=x.start;if(dv.getUint32(p,true)!==0x04034b50)throw new Error('Повреждён ZIP');
      const start=p+30+dv.getUint16(p+26,true)+dv.getUint16(p+28,true);
      const data=bytes.subarray(start,start+x.size);
      if(x.method===0)return encoder.decode(data);
      if(x.method!==8)throw new Error('Неподдерживаемое ZIP-сжатие');
      if(typeof DecompressionStream==='undefined')throw new Error('Этот браузер не поддерживает распаковку Excel. Откройте файл в Chrome или Edge.');
      try {
        const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      } catch(e){throw new Error('Ошибка распаковки XLSX: '+e.message);}
    }
    return {read,entries};
  }
  async function parseXlsx(file) {
    const z=await extractZip(file);
    const wbXml=await z.read('xl/workbook.xml');
    if(!/\bname="TDSheet"/i.test(wbXml))throw new Error('Это не исходная 1С ведомость: ожидается лист TDSheet. Файл с дневными вкладками — отдельный шаблон.');
    const shared=sharedStringsFromXml(await z.read('xl/sharedStrings.xml'));
    const raw=xmlSheetRows(await z.read('xl/worksheets/sheet1.xml'),shared);
    return reportFromRows(raw,file.name);
  }
