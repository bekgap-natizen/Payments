const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);table[n]=c>>>0;}
function crc32(buf){let c=0xffffffff;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function u16(v){return Uint8Array.of(v&255,(v>>>8)&255);}
function u32(v){return Uint8Array.of(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);}
function concat(chunks){const len=chunks.reduce((n,b)=>n+b.length,0),out=new Uint8Array(len);let off=0;for(const part of chunks){out.set(part,off);off+=part.length;}return out;}
function zip(files){let offsets=0;const locals=[],centers=[];for(const [name,content] of files){const fileName=enc.encode(name),body=enc.encode(content),crc=crc32(body),len=body.length;
 const local=concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(len),u32(len),u16(fileName.length),u16(0),fileName,body]);locals.push(local);
 const central=concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(len),u32(len),u16(fileName.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offsets),fileName]);centers.push(central);offsets+=local.length;}
 const directory=concat(centers),eocd=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(offsets),u16(0)]);
 return concat([...locals,directory,eocd]);}
