// In-app dialogs work in sandboxed AppBox frames without allow-modals.
let activeDialog=null;
function appDialog(message, options={}){
 if(activeDialog)return Promise.resolve(options.input?null:false);
 return new Promise(resolve=>{
  const overlay=document.createElement('div');
  overlay.className='app-dialog-overlay';
  overlay.innerHTML='<div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title"><h2 id="app-dialog-title"></h2><p class="app-dialog-message"></p><div class="app-dialog-field"></div><div class="app-dialog-actions"><button type="button" class="btn" data-dialog-cancel>Отмена</button><button type="button" class="btn btn-primary" data-dialog-ok>Подтвердить</button></div></div>';
  const title=overlay.querySelector('h2'), msg=overlay.querySelector('p'), ok=overlay.querySelector('[data-dialog-ok]'), cancel=overlay.querySelector('[data-dialog-cancel]');
  title.textContent=options.title||'Подтверждение';msg.textContent=String(message);ok.textContent=options.ok||'Подтвердить';
  const previous=document.activeElement;
  let field=null;
  if(options.input){field=document.createElement('input');field.className='control';field.type='text';field.inputMode='numeric';field.autocomplete='off';field.maxLength=6;field.placeholder='000000';field.setAttribute('aria-label','Код подключения');overlay.querySelector('.app-dialog-field').appendChild(field);}
  const finish=value=>{if(activeDialog!==overlay)return;activeDialog=null;overlay.remove();if(previous?.isConnected)previous.focus();resolve(value);};
  const approve=()=>finish(field?field.value.trim():true);
  ok.addEventListener('click',approve);cancel.addEventListener('click',()=>finish(field?null:false));
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(field?null:false);}else if(e.key==='Enter'&&(e.target===field)){e.preventDefault();approve();}else if(e.key==='Tab'){const list=[field,cancel,ok].filter(Boolean);const i=list.indexOf(document.activeElement);if((e.shiftKey&&i===0)||(!e.shiftKey&&i===list.length-1)){e.preventDefault();list[e.shiftKey?list.length-1:0].focus();}}});
  activeDialog=overlay;document.body.appendChild(overlay);(field||ok).focus();
 });
}
function appConfirm(message,title='Подтверждение'){return appDialog(message,{title});}
function appPrompt(message){return appDialog(message,{title:'Подключение почтового сервера',input:true,ok:'Подключить'});}
