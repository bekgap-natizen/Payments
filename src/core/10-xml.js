  function sharedStringsFromXml(xml) {
    const strings=[];
    const re=/<si\b[^>]*>([\s\S]*?)<\/si>/g;
    for (const m of xml.matchAll(re)) {
      const texts=[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
      strings.push(xmlDecode(texts.map(x=>x[1]).join('')));
    }
    return strings;
  }
  function xmlSheetRows(xml, strings) {
    const result=[];let badMoney=0;
    const rows=/<row\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/row>)/g;
    for (const row of xml.matchAll(rows)) {
      const number=Number(attr(row[1],'r')||0), outlineRaw=attr(row[1],'outlineLevel');
      if(number<=11)continue;
      const cells={};
      const cre=/<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/g;
      for (const c of (row[2]||'').matchAll(cre)) {
        const ref=attr(c[1],'r'), col=ref.match(/^[A-Z]+/)?.[0];
        if (!col || !['B','C','D','E','F'].includes(col)) continue;
        const content=c[2]||'', vt=content.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/), t=attr(c[1],'t');
        let value=vt?xmlDecode(vt[1]):'';
        if(t==='s')value=strings[Number(value)]||'';
        else if(t==='inlineStr')value=xmlDecode([...content.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''));
        cells[col]=typeof value==='string'?value.trim():value;
      }
      if (!cells.B && !cells.F) continue;
      for(const col of ['D','E','F']) {
        const v=cells[col];
        if(v !== undefined && v !== '') {cells[col+'Cents']=cents(v);if(cells[col+'Cents']===null)badMoney++;}
      }
      result.push({row:number,level:outlineRaw===''?0:Number(outlineRaw),cells});
    }
    return {rows:result,badMoney};
  }
