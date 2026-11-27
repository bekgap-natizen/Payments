"""Optional local companion. The existing Mail Server remains bound to 127.0.0.1.
Only the separate approval listener on 127.0.0.1:8780 may be proxied over HTTPS.
Local setup and invitation creation never run on that listener.
"""
import base64
import datetime as dt
import hashlib
import io
import json
import os
import secrets
import sqlite3
import threading
from pathlib import Path
from urllib.parse import urlsplit

PORT=8780
ROLES={"accountant":"Бухгалтер","director":"Генеральный директор","commercial":"Коммерческий директор"}
host=None

class MobileHost:
    def __init__(self,home,mail_service,root=None):
        self.home=Path(home)/"Mobile"
        self.home.mkdir(parents=True,exist_ok=True)
        self.config=self.home/"mobile.json"
        self.db=self.home/"approval.sqlite3"
        self.root=Path(root or Path(__file__).resolve().parent)
        self.mail=mail_service
        self.origin=""
        self.running=False
        self.error=""
        self.lock=threading.RLock()

    def status(self):
        return {"origin":self.origin,"running":self.running,"error":self.error,"port":PORT}

    def load(self):
        if self.config.exists():
            try:self.start(json.loads(self.config.read_text(encoding="utf8"))["origin"])
            except Exception as exc:
                self.error="Мобильная часть не запущена: "+str(exc)[:200]

    def start(self,origin):
        if not isinstance(origin,str):raise ValueError("Укажите HTTPS-адрес")
        origin=origin.strip().rstrip("/")
        u=urlsplit(origin)
        if u.scheme!="https" or not u.hostname or u.username or u.password or u.path or u.query or u.fragment or any(c.isspace() for c in origin):
            raise ValueError("Нужен отдельный адрес HTTPS, без пути")
        with self.lock:
            if self.running:
                if origin!=self.origin:raise ValueError("Для смены адреса сначала остановите сервер")
                return self.status()
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives import serialization
            from waitress import create_server
            from approval_server.app import create_app
            from approval_server.push_worker import run
            keyfile=self.home/"vapid.pem"
            if keyfile.exists():
                key=serialization.load_pem_private_key(keyfile.read_bytes(),password=None)
            else:
                key=ec.generate_private_key(ec.SECP256R1())
                keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
            public=base64.urlsafe_b64encode(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)).decode().rstrip("=")
            os.environ.update(PAYMENTS_DB=str(self.db),PAYMENTS_ORIGIN=origin,PAYMENTS_VAPID_PUBLIC=public,PAYMENTS_VAPID_PRIVATE=str(keyfile),PAYMENTS_VAPID_SUBJECT=origin)
            app=create_app({"DB":str(self.db),"PUBLIC_ORIGIN":origin,"DIST":str(self.root/"dist"),"MAIL_SERVICE":self.mail})
            server=create_server(app,host="127.0.0.1",port=PORT,threads=4)
            self.config.write_text(json.dumps({"origin":origin},ensure_ascii=False),encoding="utf8")
            self.origin=origin;self.running=True;self.error=""
            def serve():
                try:server.run()
                except Exception as exc:self.error="Мобильная часть остановилась: "+str(exc)[:200]
                finally:self.running=False
            def push():
                try:run()
                except Exception as exc:self.error="Push-служба не работает: "+str(exc)[:200]
            threading.Thread(target=serve,name="mobile-http",daemon=True).start()
            threading.Thread(target=push,name="mobile-push",daemon=True).start()
            return self.status()

    def invite(self,role):
        if role not in ROLES:raise ValueError("Неизвестная роль")
        if not self.running:raise ValueError("Сначала настройте HTTPS-адрес мобильной части")
        import qrcode
        from werkzeug.security import generate_password_hash
        token=secrets.token_urlsafe(32)
        expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=15)).isoformat(timespec="seconds")
        with sqlite3.connect(self.db,timeout=15) as con:
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("INSERT OR IGNORE INTO users VALUES(?,?,?)",(role,role,generate_password_hash(secrets.token_urlsafe(32))))
            con.execute("DELETE FROM invitations WHERE user_id=? OR expires<=?",(role,dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")))
            con.execute("INSERT INTO invitations VALUES(?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),role,expires))
        link=self.origin+"/#pair="+token
        img=qrcode.make(link);buf=io.BytesIO();img.save(buf,format="PNG")
        return {"role":ROLES[role],"code":token,"link":link,"qr":"data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode("ascii")}

    def revoke(self,role):
        if role not in ROLES:raise ValueError("Неизвестная роль")
        if not self.db.exists():return {"ok":True}
        with sqlite3.connect(self.db,timeout=15) as con:
            for table in ("invitations","sessions","subscriptions"):
                con.execute("DELETE FROM "+table+" WHERE user_id=?",(role,))
        return {"ok":True}

def attach(home,service):
    global host
    host=MobileHost(home,service)
    host.load()
    return host

def panel():
    if host is None:return ""
    # This HTML is inserted only into the existing localhost setup page.
    from html import escape
    st=host.status()
    return """<hr><h2>Мобильное приложение</h2><p>ВОЛМАКС Платежи · """+("запущено" if st["running"] else "не настроено")+"""</p><small>Почтовый сервер не публикуется в интернете. Мобильный модуль слушает отдельный локальный порт 8780. Один раз подключите HTTPS-адрес через свой маршрутизатор или обратный прокси.</small><label>HTTPS-адрес мобильного приложения</label><input id="mobile-origin" placeholder="https://..." value=" """+escape(st["origin"],quote=True)+""""><button id="mobile-start">Подключить мобильный модуль</button><p>"""+escape(st["error"])+"""</p><label>Кого подключаем</label><select id="mobile-role" style="width:100%;padding:12px"><option value="director">Генеральный директор</option><option value="commercial">Коммерческий директор</option><option value="accountant">Бухгалтер</option></select><button id="mobile-invite">Подключить устройство (QR)</button><button id="mobile-revoke" style="background:#526776">Отозвать подключения выбранного сотрудника</button><div id="mobile-result" style="overflow-wrap:anywhere"></div><img id="mobile-qr" alt="QR-код подключения" hidden style="width:100%;max-width:280px"><script>
window.addEventListener('DOMContentLoaded',()=>{
 const out=document.getElementById('mobile-result'),qr=document.getElementById('mobile-qr'),role=()=>document.getElementById('mobile-role').value;
 document.getElementById('mobile-start').onclick=async()=>{try{await call('/local/mobile/start',{origin:document.getElementById('mobile-origin').value.trim()});location.reload()}catch(e){out.textContent=e.message}};
 document.getElementById('mobile-invite').onclick=async()=>{try{const data=await call('/local/mobile/invite',{role:role()});qr.src=data.qr;qr.hidden=false;out.replaceChildren();const p=document.createElement('p');p.textContent=data.role+' · QR и код действуют 15 минут, только один раз.';const a=document.createElement('a');a.href=data.link;a.textContent='Открыть ссылку подключения';const code=document.createElement('p');code.textContent='Код: '+data.code;const copy=document.createElement('button');copy.textContent='Скопировать код';copy.onclick=()=>navigator.clipboard.writeText(data.code).catch(()=>{});out.append(p,a,code,copy)}catch(e){out.textContent=e.message}};
 document.getElementById('mobile-revoke').onclick=async()=>{if(!confirm('Отозвать все подключения выбранного сотрудника?'))return;try{await call('/local/mobile/revoke',{role:role()});qr.hidden=true;out.textContent='Подключения отозваны.'}catch(e){out.textContent=e.message}};
});
</script>"""
