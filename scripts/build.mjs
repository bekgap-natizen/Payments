import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const output=path.join(root,'dist');
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(path.join(output,'assets'),{recursive:true});
const specs=[['core','src/core'],['export','src/export'],['ui','src/ui']];
for(const [dest,subdir] of specs){
 const dir=path.join(root,subdir);
 const modules=fs.readdirSync(dir).filter(x=>/^\d{2}-.*\.js$/.test(x)).sort();
 if(modules.length<3) throw Error('Incomplete module group: '+subdir);
 const paths = dest === 'ui' ? ['src/shell/template.js', ...modules.map(f=>path.join(subdir,f))] : modules.map(f=>path.join(subdir,f));
 const source=paths.map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n\n');
 fs.writeFileSync(path.join(output,'assets',dest+'.js'),source,'utf8');
}
for(const file of ['foundation.css','components.css','responsive-brand.css','layout-safety.css']){
 fs.copyFileSync(path.join(root,'src/styles',file),path.join(output,'assets',file));
}
fs.copyFileSync(path.join(root,'assets/volmax-mark.png'),path.join(output,'assets/volmax-mark.png'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
 .replaceAll('src/styles/','assets/')
 .replace(/<script defer src="src\/core\/finance\.js"><\/script>[\s\S]*?<script defer src="src\/ui\/controller\.js"><\/script>/,
  '<script defer src="assets/core.js"></script>\n<script defer src="assets/export.js"></script>\n<script defer src="assets/ui.js"></script>');
fs.writeFileSync(path.join(output,'index.html'),html,'utf8');
console.log('Built',modulesCount(), 'output files into dist/');
function modulesCount(){return specs.reduce((n,[_,d])=>n+fs.readdirSync(path.join(root,d)).filter(x=>/^\d{2}-.*\.js$/.test(x)).length,0)}
