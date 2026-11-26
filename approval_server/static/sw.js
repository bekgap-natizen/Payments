// Never cache private financial data or API responses.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{let p={};try{p=e.data.json()}catch(_){};const id=Number(p.id);e.waitUntil(self.registration.showNotification(p.title||'ВОЛМАКС · Платежи',{body:p.body||'Откройте приложение для просмотра.',tag:'register-'+id,icon:'/icon.svg',data:{id:Number.isSafeInteger(id)&&id>0?id:0}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const path=e.notification.data?.id?'/?register='+e.notification.data.id:'/';e.waitUntil(self.clients.openWindow(path));});