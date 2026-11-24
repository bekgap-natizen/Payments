"""VOLMAX Payments local Yandex SMTP companion. Python stdlib only, Windows credentials."""
from __future__ import annotations
import base64
import ctypes
from ctypes import wintypes
from datetime import datetime
from contextlib import contextmanager
from email.message import EmailMessage
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import socket
import sqlite3
import ssl
import sys
import subprocess
import threading
import time
import webbrowser
from urllib.parse import urlsplit
import zipfile
import io
import xml.etree.ElementTree as ET

HOST = "127.0.0.1"
PORT = int(os.environ.get("VOLMAX_MAIL_PORT", "8765"))
ALLOWED_ORIGIN = os.environ.get("VOLMAX_APPBOX_ORIGIN", "https://volmax.duckdns.org").rstrip("/")
HOME = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "VOLMAX" / "PaymentsMail"
HOME.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = HOME / "settings.json"
DB_FILE = HOME / "sent.sqlite3"
TARGET = "VOLMAX.Payments.Yandex.SMTP"
SMTP_HOST = "smtp.yandex.ru"
RECIPIENTS = (
    "alexander@volmax.ru", "grishin@volmax.ru",
    "ilina@volmax.ru", "gamova@volmax.ru",
)
MAX_BODY = 9 * 1024 * 1024
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
API_VERSION = 1
AUTOSTART_NAME = "VOLMAX Payments Mail Server"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
PROTOCOL_KEY = r"Software\Classes\volmax-payments"

class MailError(Exception):
    pass

class CredentialStore:
    """Use Windows Credential Manager (DPAPI-backed), never JSON for secrets."""
    def __init__(self):
        if os.name != "nt":
            raise MailError("Хранение пароля поддерживается только в Windows")
        self.advapi = ctypes.WinDLL("Advapi32", use_last_error=True)
        self.advapi.CredWriteW.argtypes = [ctypes.c_void_p, wintypes.DWORD]
        self.advapi.CredWriteW.restype = wintypes.BOOL
        self.advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
        self.advapi.CredReadW.restype = wintypes.BOOL
        self.advapi.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
        self.advapi.CredDeleteW.restype = wintypes.BOOL
        self.advapi.CredFree.argtypes = [ctypes.c_void_p]
        class CREDENTIAL(ctypes.Structure):
            _fields_ = [("Flags",wintypes.DWORD),("Type",wintypes.DWORD),
                ("TargetName",wintypes.LPWSTR),("Comment",wintypes.LPWSTR),
                ("LastWritten",wintypes.FILETIME),("CredentialBlobSize",wintypes.DWORD),
                ("CredentialBlob",ctypes.POINTER(ctypes.c_byte)),("Persist",wintypes.DWORD),
                ("AttributeCount",wintypes.DWORD),("Attributes",ctypes.c_void_p),
                ("TargetAlias",wintypes.LPWSTR),("UserName",wintypes.LPWSTR)]
        self.CREDENTIAL = CREDENTIAL
    def save(self, email, password):
        raw = password.encode("utf-16-le")
        if len(raw) > 2560: raise MailError("Пароль слишком длинный")
        buf = ctypes.create_string_buffer(raw)
        c = self.CREDENTIAL()
        c.Type = 1  # CRED_TYPE_GENERIC
        c.TargetName = TARGET
        c.UserName = email
        c.Persist = 2  # CRED_PERSIST_LOCAL_MACHINE, protected for current user
        c.CredentialBlobSize = len(raw)
        c.CredentialBlob = ctypes.cast(buf,ctypes.POINTER(ctypes.c_byte))
        if not self.advapi.CredWriteW(ctypes.byref(c),0): raise MailError("Не удалось сохранить пароль Windows")
    def load(self):
        ptr = ctypes.c_void_p()
        if not self.advapi.CredReadW(TARGET,1,0,ctypes.byref(ptr)): return None
        try:
            c = ctypes.cast(ptr,ctypes.POINTER(self.CREDENTIAL)).contents
            password=ctypes.string_at(c.CredentialBlob,c.CredentialBlobSize).decode("utf-16-le")
            return c.UserName,password
        finally: self.advapi.CredFree(ptr)
    def delete(self):
        self.advapi.CredDeleteW(TARGET,1,0)

def settings():
    try: return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError,ValueError): return {}

def token_digest(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()

def save_settings(data):
    tmp=SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    os.replace(tmp,SETTINGS_FILE)

def protocol_command():
    # Fixed executable, fixed script, fixed action. Never interpolate the URL (%1).
    executable=Path(sys.executable)
    gui=executable.with_name("pythonw.exe")
    if gui.is_file(): executable=gui
    return subprocess.list2cmdline([str(executable),str(Path(__file__).resolve()),"--background"])

def protocol_enabled():
    if os.name!="nt": return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,PROTOCOL_KEY+r"\shell\open\command") as key:
            command,_=winreg.QueryValueEx(key,"")
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,PROTOCOL_KEY) as key:
            winreg.QueryValueEx(key,"URL Protocol")
        return command==protocol_command()
    except OSError: return False

def register_protocol():
    if os.name!="nt": raise MailError("Запуск по кнопке доступен только в Windows")
    import winreg
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,PROTOCOL_KEY,0,winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key,"",0,winreg.REG_SZ,"URL:VOLMAX Payments Mail Server")
            winreg.SetValueEx(key,"URL Protocol",0,winreg.REG_SZ,"")
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,PROTOCOL_KEY+r"\shell\open\command",0,winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key,"",0,winreg.REG_SZ,protocol_command())
    except OSError as exc: raise MailError("Не удалось зарегистрировать запуск по кнопке Windows") from exc

def unregister_protocol():
    if os.name!="nt": raise MailError("Запуск по кнопке доступен только в Windows")
    import winreg
    try:
        for suffix in (r"\shell\open\command",r"\shell\open",r"\shell",""):
            try: winreg.DeleteKey(winreg.HKEY_CURRENT_USER,PROTOCOL_KEY+suffix)
            except FileNotFoundError: pass
    except OSError as exc: raise MailError("Не удалось удалить регистрацию запуска по кнопке") from exc

def autostart_command():
    return subprocess.list2cmdline([sys.executable,str(Path(__file__).resolve()),"--background"])

def autostart_enabled():
    if os.name!="nt": return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,RUN_KEY) as key:
            value,_=winreg.QueryValueEx(key,AUTOSTART_NAME)
        return value==autostart_command()
    except OSError: return False

def set_autostart(enabled):
    if os.name!="nt": raise MailError("Автозапуск доступен только в Windows")
    import winreg
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,RUN_KEY,0,winreg.KEY_SET_VALUE) as key:
            if enabled:
                command=autostart_command()
                if len(command)>260: raise MailError("Слишком длинный путь. Распакуйте сервер в более короткую папку.")
                winreg.SetValueEx(key,AUTOSTART_NAME,0,winreg.REG_SZ,command)
            else:
                try: winreg.DeleteValue(key,AUTOSTART_NAME)
                except FileNotFoundError: pass
    except OSError as exc: raise MailError("Не удалось изменить автозапуск Windows") from exc

@contextmanager
def db():
    con=sqlite3.connect(DB_FILE,timeout=12)
    con.execute("""CREATE TABLE IF NOT EXISTS sent(
     id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, sender TEXT NOT NULL,
     payment_date TEXT NOT NULL, total_cents INTEGER NOT NULL, state TEXT NOT NULL,
     error TEXT NOT NULL DEFAULT '')""")
    con.commit()
    try:
        yield con
        con.commit()
    finally:
        con.close()

def canonical_date(raw):
    if not isinstance(raw,str) or not DATE_RE.fullmatch(raw): raise MailError("Неверная дата платежа")
    try: return datetime.strptime(raw,"%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError: raise MailError("Неверная дата платежа")

def money(cents):
    return f"{cents / 100:,.2f}".replace(",", " ").replace(".", ",")

def validate_payload(raw):
    """Never accept HTML supplied by AppBox; derive mail body on localhost."""
    if not isinstance(raw,dict): raise MailError("Некорректный запрос")
    date=canonical_date(raw.get("date"))
    orgs=raw.get("organizations")
    if not isinstance(orgs,list) or not 0<len(orgs)<=20: raise MailError("Нет организаций")
    clean=[]; grand=0
    for org in orgs:
        if not isinstance(org,dict): raise MailError("Неверная организация")
        name=org.get("name")
        suppliers=org.get("suppliers")
        if not isinstance(name,str) or not 0<len(name)<=200 or not isinstance(suppliers,list) or not suppliers or len(suppliers)>1500:
            raise MailError("Некорректная структура организаций")
        summary=[]; subtotal=0
        for supplier in suppliers:
            if not isinstance(supplier,dict): raise MailError("Неверный поставщик")
            title=supplier.get("name"); amount=supplier.get("cents")
            if not isinstance(title,str) or not 0<len(title)<=300 or type(amount) is not int or not 0<amount<10**13:
                raise MailError("Некорректная сумма или название поставщика")
            summary.append((title,amount));subtotal+=amount
        clean.append((name,summary,subtotal));grand+=subtotal
    if type(raw.get("totalCents")) is not int or grand!=raw["totalCents"]:
        raise MailError("Итог письма не совпадает с реестром")
    encoded=raw.get("xlsxBase64")
    if not isinstance(encoded,str) or len(encoded)>MAX_BODY: raise MailError("Excel не приложен либо слишком велик")
    try: xlsx=base64.b64decode(encoded,validate=True)
    except Exception: raise MailError("Ошибка кодирования Excel")
    check_xlsx(xlsx,grand)
    return date,clean,grand,xlsx

def check_xlsx(contents,total_cents):
    """Reject ZIP bombs and validate cached grand total on the sole worksheet."""
    if len(contents)>6_000_000 or not zipfile.is_zipfile(io.BytesIO(contents)): raise MailError("Неверный файл Excel")
    ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        with zipfile.ZipFile(io.BytesIO(contents)) as z:
            paths=set(z.namelist())
            if not {"xl/workbook.xml","xl/worksheets/sheet1.xml"}.issubset(paths):
                raise MailError("Отсутствует лист платежей")
            if any(p.startswith("xl/worksheets/sheet") and p!="xl/worksheets/sheet1.xml" for p in paths):
                raise MailError("Ожидался Excel с одним листом")
            if sum(i.file_size for i in z.infolist())>24_000_000: raise MailError("Слишком большой файл Excel")
            root=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        rows=root.findall(".//m:sheetData/m:row",ns)
        matched=False
        for row in rows:
            b=row.find("./m:c[@r='B"+str(row.attrib["r"])+"']/m:is/m:t",ns)
            if b is None or b.text!="ВСЕГО К ОПЛАТЕ": continue
            value=row.find("./m:c[@r='C"+str(row.attrib["r"])+"']/m:v",ns)
            if value is None or round(float(value.text)*100)!=total_cents:
                raise MailError("Итог Excel отличается от суммы письма")
            matched=True;break
        if not matched: raise MailError("Не найден итоговый платёж в Excel")
    except (zipfile.BadZipFile,ET.ParseError,ValueError,KeyError) as e:
        raise MailError("Excel повреждён или имеет неверный формат") from e

def render_mail(payment_date,orgs,grand):
    styles="border-collapse:collapse;width:100%;font:14px Arial,sans-serif"
    cell="border:1px solid #dce5ed;padding:8px 10px"
    segments=["<p>Добрый день!</p><p>Направляю реестр платежей на "+escape(payment_date)+".</p>"]
    plain=["Добрый день!","Платежи на "+payment_date]
    for name,suppliers,subtotal in orgs:
        segments.append("<h3>"+escape(name)+"</h3><table style='"+styles+"'><tr><th style='"+cell+";text-align:left'>Поставщик</th><th style='"+cell+";text-align:right'>К оплате, ₽</th></tr>")
        plain.append("\n"+name)
        for supplier,amount in suppliers:
            segments.append("<tr><td style='"+cell+"'>"+escape(supplier)+"</td><td style='"+cell+";text-align:right'>"+money(amount)+"</td></tr>")
            plain.append(supplier+" — "+money(amount)+" ₽")
        segments.append("<tr><td style='"+cell+"'><b>ИТОГО "+escape(name)+"</b></td><td style='"+cell+";text-align:right'><b>"+money(subtotal)+"</b></td></tr></table>")
        plain.append("ИТОГО "+name+": "+money(subtotal)+" ₽")
    segments.append("<p><b>ВСЕГО К ОПЛАТЕ: "+money(grand)+" ₽</b></p><p>Вложение: Excel с детализацией входящих документов.</p>")
    plain.append("ВСЕГО К ОПЛАТЕ: "+money(grand)+" ₽")
    return "\n".join(plain),"".join(segments)

def compose(sender,date,orgs,total,xlsx):
    msg=EmailMessage()
    msg["From"]=sender
    msg["To"]=", ".join(RECIPIENTS)
    msg["Subject"]="Платежи на "+date
    msg["X-VOLMAX-Application"]="Payments"
    plain,html=render_mail(date,orgs,total)
    msg.set_content(plain)
    msg.add_alternative(html,subtype="html")
    msg.add_attachment(xlsx,maintype="application",subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       filename="ВОЛМАКС_Платежи_"+date.replace(".","-")+".xlsx")
    return msg

class Service:
    def __init__(self,store=None,smtp_factory=None):
        self.store=store if store is not None else CredentialStore()
        self.smtp_factory=smtp_factory or smtplib.SMTP_SSL
        cfg=settings()
        self.allow_opaque=cfg.get("allow_opaque") is True
        saved=cfg.get("paired_tokens",{})
        self.session_tokens={k:v for k,v in saved.items() if re.fullmatch(r"[a-f0-9]{64}",k) and v in (ALLOWED_ORIGIN,"null")} if isinstance(saved,dict) else {}
        if not self.allow_opaque:
            self.session_tokens={k:v for k,v in self.session_tokens.items() if v!="null"}
        self.pair_code=""
        self.pair_until=0
        self.pair_tries=0
        self.lock=threading.RLock()
        if not self.session_tokens:self.new_pair_code()
        with db() as con: pass
    def credentials(self): return self.store.load()
    def configured_email(self):
        cred=self.credentials()
        return cred[0] if cred else None
    def set_account(self,email,password):
        if not isinstance(email,str) or not EMAIL_RE.fullmatch(email) or len(email)>254:
            raise MailError("Неверный адрес электронной почты")
        if not isinstance(password,str) or not 0<len(password)<=1024:
            raise MailError("Укажите пароль приложения Яндекса")
        try:
            with self.smtp_factory(SMTP_HOST,465,context=ssl.create_default_context(),timeout=15) as smtp:
                smtp.login(email,password)
        except smtplib.SMTPAuthenticationError as exc:
            # Never expose the supplied password or raw SMTP text in the interface.
            raise MailError(
                "Яндекс отклонил вход (SMTP " + str(exc.smtp_code) +
                "). Создайте отдельный пароль приложения типа «Почта» для этого аккаунта "
                "и проверьте разрешение почтовых клиентов в настройках Яндекса."
            ) from exc
        except smtplib.SMTPResponseException as exc:
            raise MailError("Яндекс вернул ошибку SMTP " + str(exc.smtp_code) +
                            ". Проверьте настройки почты и повторите попытку.") from exc
        except ssl.SSLError as exc:
            raise MailError("Ошибка защищённого соединения с Яндексом (SSL/TLS). "
                            "Проверьте системную дату, сертификаты и антивирус.") from exc
        except (socket.timeout, TimeoutError) as exc:
            raise MailError("Истекло время ожидания Яндекс SMTP. "
                            "Проверьте интернет, брандмауэр и доступ к smtp.yandex.ru:465.") from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError("Не удалось подключиться к SMTP Яндекса (" +
                            type(exc).__name__ +
                            "). Проверьте интернет, порт 465 и почтовые настройки.") from exc
        with self.lock:
            self.store.save(email,password)
            self.revoke_pairings()
            self.new_pair_code()
    def persist_pairings(self):
        # Only SHA-256 digests are written; the actual bearer token is held by Payments.
        cfg=settings()
        cfg.update({"allow_opaque":self.allow_opaque,"paired_tokens":self.session_tokens})
        save_settings(cfg)
    def new_pair_code(self):
        with self.lock:
            self.pair_code=f"{secrets.randbelow(10**6):06d}"
            self.pair_until=time.monotonic()+900
            self.pair_tries=0
    def revoke_pairings(self):
        with self.lock:
            self.session_tokens.clear()
            self.pair_code=""
            self.pair_until=0
            self.persist_pairings()
    def enable_opaque(self,enabled):
        # Persist explicit local approval; opaque clients still need a valid paired token.
        with self.lock:
            self.allow_opaque=enabled is True
            if not self.allow_opaque:
                self.session_tokens={k:v for k,v in self.session_tokens.items() if v!="null"}
            self.persist_pairings()
            self.new_pair_code()
    def pair(self,code,origin=ALLOWED_ORIGIN):
        with self.lock:
            if origin != ALLOWED_ORIGIN and not (origin == "null" and self.allow_opaque):
                raise MailError("Подключение с этого источника запрещено")
            if self.pair_tries>=8: raise MailError("Слишком много попыток. Обновите код в локальном окне сервера.")
            self.pair_tries+=1
            if not self.pair_code or time.monotonic()>self.pair_until or not isinstance(code,str) or not re.fullmatch(r"\d{6}",code) or not secrets.compare_digest(code,self.pair_code):
                raise MailError("Неверный или устаревший код. Нажмите «Получить код подключения» в окне сервера.")
            token=secrets.token_urlsafe(32)
            self.session_tokens[token_digest(token)]=origin
            self.persist_pairings()
            self.pair_code=""
            self.pair_until=0
            self.pair_tries=0
            return token
    def authorized(self,token,origin):
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}",token or ""):return False
        if origin!=ALLOWED_ORIGIN and not (origin=="null" and self.allow_opaque):return False
        digest=token_digest(token)
        with self.lock:
            return self.session_tokens.get(digest)==origin
    def send(self,raw,force=False):
        credentials=self.credentials()
        if credentials is None: raise MailError("Сначала настройте почту в локальном сервере")
        sender,password=credentials
        date,orgs,total,xlsx=validate_payload(raw)
        # Digest includes exact XLSX content, sender, and date. Retry is explicit.
        fingerprint=hashlib.sha256(json.dumps({"sender":sender,"date":date,"organizations":orgs,"total":total},ensure_ascii=False,sort_keys=True).encode("utf-8")).hexdigest()
        with self.lock:
            with db() as con:
                found=con.execute("SELECT state FROM sent WHERE id=?",(fingerprint,)).fetchone()
                if found and not force: raise MailError("Этот реестр уже отправлялся или отправка была начата. Повтор требует отдельного подтверждения")
                con.execute("INSERT OR REPLACE INTO sent(id,timestamp,sender,payment_date,total_cents,state,error) VALUES(?,?,?,?,?,?,?)",
                    (fingerprint,datetime.now().isoformat(timespec="seconds"),sender,date,total,"attempted",""))
                con.commit()
            try:
                msg=compose(sender,date,orgs,total,xlsx)
                with self.smtp_factory(SMTP_HOST,465,context=ssl.create_default_context(),timeout=30) as smtp:
                    smtp.login(sender,password)
                    refused=smtp.send_message(msg)
                    if refused: raise MailError("SMTP отказал одному или нескольким адресатам")
            except Exception:
                with db() as con: con.execute("UPDATE sent SET state='unknown',error='SMTP failed or delivery uncertain' WHERE id=?",(fingerprint,))
                raise MailError("Отправка не подтверждена. Проверьте папку «Отправленные» Яндекса перед повтором")
            with db() as con:
                con.execute("UPDATE sent SET state='accepted' WHERE id=?",(fingerprint,))
            return {"ok":True,"status":"accepted","sender":sender,"recipients":list(RECIPIENTS),"totalCents":total,
                    "note":"SMTP принял письмо; это не гарантия доставки в ящики"}

def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        server_version="VOLMAX-Mail/1.0"
        def log_message(self,format,*args):
            # Never log POST bodies, credentials or auth headers.
            origin=self.headers.get("Origin","")
            label=origin if origin in (ALLOWED_ORIGIN,"null",f"http://127.0.0.1:{PORT}","") else "untrusted"
            status=args[1] if len(args)>1 and str(args[1]).isdigit() else "-"
            print(f"[HTTP] {self.command} {urlsplit(self.path).path} -> {status}; Origin={label or '-'}",flush=True)
        def _host_ok(self):
            return self.headers.get("Host","") in {f"127.0.0.1:{PORT}",f"localhost:{PORT}"}
        def _app_origin(self):
            origin=self.headers.get("Origin","")
            return origin==ALLOWED_ORIGIN or (origin=="null" and service.allow_opaque)
        def _admin_origin(self): return self.headers.get("Origin","")==f"http://127.0.0.1:{PORT}"
        def _json(self,status,data,external=False):
            body=json.dumps(data,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Content-Length",str(len(body)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            if external and self._app_origin():
                self.send_header("Access-Control-Allow-Origin",self.headers["Origin"])
                self.send_header("Vary","Origin")
                self.send_header("Access-Control-Allow-Private-Network","true")
            self.end_headers();self.wfile.write(body)
        def _read(self):
            if self.headers.get("Content-Type","").split(";")[0]!="application/json":
                raise MailError("Ожидается JSON")
            try: size=int(self.headers.get("Content-Length","0"))
            except ValueError: raise MailError("Неверная длина запроса")
            if size<=0 or size>MAX_BODY: raise MailError("Неверный размер запроса")
            return json.loads(self.rfile.read(size))
        def _auth(self):
            supplied=self.headers.get("X-Payments-Token","")
            origin=self.headers.get("Origin","")
            return service.authorized(supplied,origin)
        def do_OPTIONS(self):
            if not self._host_ok(): return self._json(403,{"error":"Host denied"})
            if not self._app_origin() or self.path not in ("/v1/status","/v1/pair","/v1/send"):
                return self._json(403,{"error":"Origin denied"})
            self.send_response(204);self.send_header("Access-Control-Allow-Origin",self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers","Content-Type, X-Payments-Token")
            self.send_header("Access-Control-Allow-Private-Network","true")
            self.send_header("Access-Control-Max-Age","300");self.send_header("Vary","Origin")
            self.end_headers()
        def do_GET(self):
            if not self._host_ok(): return self._json(403,{"error":"Host denied"})
            if self.path=="/v1/status":
                if not self._app_origin():return self._json(403,{"error":"Origin denied"})
                authorized=self._auth()
                return self._json(200,{"version":API_VERSION,"ready":bool(service.credentials()),
                    "paired":authorized,"sender":service.configured_email() if authorized else None},True)
            if urlsplit(self.path).path not in ("/","/local"): return self._json(404,{"error":"Not found"})
            page=admin_html(service)
            data=page.encode()
            self.send_response(200);self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Content-Length",str(len(data)))
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Security-Policy","default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'")
            self.send_header("X-Frame-Options","DENY")
            self.send_header("X-Content-Type-Options","nosniff")
            self.end_headers();self.wfile.write(data)
        def do_POST(self):
            if not self._host_ok(): return self._json(403,{"error":"Host denied"})
            external=self.path.startswith("/v1/")
            if external and not self._app_origin():return self._json(403,{"error":"Origin denied"})
            if not external and not self._admin_origin():return self._json(403,{"error":"Origin denied"})
            try:
                data=self._read()
                if self.path=="/v1/pair":
                    if not service.credentials(): raise MailError("Сначала настройте почту в окне локального сервера")
                    return self._json(200,{"token":service.pair(data.get("code"),self.headers["Origin"]),"apiVersion":API_VERSION},True)
                if self.path=="/v1/send":
                    if not self._auth():return self._json(401,{"error":"Подключите локальный сервер заново"},True)
                    return self._json(200,service.send(data,force=data.get("force") is True),True)
                if self.path=="/local/configure":
                    if not secrets.compare_digest(self.headers.get("X-Setup-Token",""),SETUP_TOKEN):
                        raise MailError("Недействительный запрос настройки")
                    service.set_account(data.get("email"),data.get("password"))
                    return self._json(200,{"ok":True,"sender":service.configured_email()})
                if self.path=="/local/compatibility":
                    if not secrets.compare_digest(self.headers.get("X-Setup-Token",""),SETUP_TOKEN): raise MailError("Недействительный запрос")
                    service.enable_opaque(data.get("enabled") is True)
                    return self._json(200,{"ok":True,"enabled":service.allow_opaque})
                if self.path in ("/local/code","/local/revoke","/local/autostart","/local/protocol"):
                    if not secrets.compare_digest(self.headers.get("X-Setup-Token",""),SETUP_TOKEN): raise MailError("Недействительный запрос")
                    if self.path=="/local/code": service.new_pair_code()
                    elif self.path=="/local/revoke": service.revoke_pairings()
                    elif self.path=="/local/autostart": set_autostart(data.get("enabled") is True)
                    elif data.get("enabled") is True: register_protocol()
                    else: unregister_protocol()
                    return self._json(200,{"ok":True})
                if self.path=="/local/delete":
                    if not secrets.compare_digest(self.headers.get("X-Setup-Token",""),SETUP_TOKEN): raise MailError("Недействительный запрос")
                    service.store.delete();service.revoke_pairings()
                    return self._json(200,{"ok":True})
                return self._json(404,{"error":"Not found"},external)
            except MailError as e: return self._json(400,{"error":str(e)},external)
            except (ValueError,TypeError,json.JSONDecodeError):return self._json(400,{"error":"Некорректный запрос"},external)
            except Exception:
                return self._json(500,{"error":"Серверная ошибка. Проверьте журнал консоли"},external)
    return Handler

SETUP_TOKEN=secrets.token_urlsafe(32)
def admin_html(service):
    sender=service.configured_email() or "не настроен"
    code=service.pair_code if time.monotonic()<service.pair_until else ""
    startup=autostart_enabled()
    protocol=protocol_enabled()
    return """<!doctype html><html lang="ru"><meta charset="utf-8"><title>VOLMAX Mail Server</title>
<style>body{font:15px Arial;background:#eef3f7;margin:0;padding:24px;color:#1e3449}main{max-width:480px;margin:auto;background:white;border-radius:16px;padding:28px;box-shadow:0 4px 22px #aaa5}label{display:block;margin:16px 0 6px}input,button{box-sizing:border-box;width:100%;padding:12px;font-size:15px;border:1px solid #ccd6e1;border-radius:8px}button{margin-top:15px;background:#066fa9;color:white;cursor:pointer}small{color:#597084}#msg{margin-top:15px;white-space:pre-line}</style>
<main><h2>VOLMAX Mail Server</h2><p>Почта: <b>"""+escape(sender)+"""</b></p>
<p>Постоянных привязок Payments: <b>"""+str(len(service.session_tokens))+"""</b></p>
<p>Код подключения для AppBox: <strong>"""+(code or "не требуется")+"""</strong></p>
<small>Код нужен один раз для каждого браузера. Действует 15 минут. После перезапуска сохранённая привязка работает автоматически, если браузер разрешает хранение.</small>
<button id="refresh-code" style="background:#526776">Получить код подключения</button>
<button id="revoke" style="background:#526776">Сбросить все привязки Payments</button>
<p>Запуск по кнопке Payments: <b>"""+("включён" if protocol else "выключен")+"""</b></p>
<button id="protocol">"""+("Отключить запуск по кнопке" if protocol else "Включить запуск по кнопке Payments")+"""</button>
<small>Однократная регистрация в Windows. При первом запуске браузер может запросить разрешение открыть приложение.</small>
<p>Автозапуск Windows: <b>"""+("включён" if startup else "выключен")+"""</b></p>
<button id="autostart">"""+("Выключить автозапуск" if startup else "Включить автозапуск Windows")+"""</button>
<small>Храните папку сервера в постоянном месте. При переносе включите автозапуск заново.</small>
<p>Совместимость с AppBox / локальным HTML: <b>"""+("разрешена" if service.allow_opaque else "выключена")+"""</b></p>
<button id="compat" style="background:#526776">"""+("Отключить режим совместимости" if service.allow_opaque else "Разрешить AppBox / локальный HTML")+"""</button>
<p><small>Включайте только для доверенного Payments. Встроенные страницы и локальные файлы могут иметь Origin: null. Код подключения обязателен, пароль почты недоступен приложению. Разрешение сохраняется на этом компьютере до отключения.</small></p>
<p><small>Для входа через SMTP нужен отдельный <a href="https://id.yandex.ru/profile/apppasswords-list" target="_blank" rel="noopener noreferrer">пароль приложения Яндекса → Почта</a>, а не пароль от Яндекс ID. В Яндекс Почте также должен быть разрешён доступ почтовым клиентам.</small></p>
<label>Корпоративная почта Яндекс</label><input id="email" type="email" autocomplete="username" placeholder="user@volmax.ru">
<label>Пароль приложения Яндекс (не пароль от аккаунта)</label><input id="password" type="password" autocomplete="new-password">
<button id="save">Проверить Яндекс и сохранить</button><button id="delete" style="background:#526776">Удалить сохранённый аккаунт</button>
<div id="msg" role="status"></div><p><small>Пароль хранится в Диспетчере учётных данных Windows и не отправляется в AppBox. SMTP: smtp.yandex.ru:465.</small></p></main>
<script>const token="""+json.dumps(SETUP_TOKEN)+""";async function call(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error);return j}
document.getElementById('save').onclick=async()=>{const out=document.getElementById('msg');out.textContent='Проверяем...';try{await call('/local/configure',{email:document.getElementById('email').value,password:document.getElementById('password').value});out.textContent='Подключение проверено. Данные сохранены. Обновите страницу.';document.getElementById('password').value=''}catch(e){out.textContent=e.message}};
const compatible="""+json.dumps(service.allow_opaque)+""";
document.getElementById('compat').onclick=async()=>{try{if(!compatible&&!confirm('Разрешить подключение доверенного Payments из AppBox или локального HTML на этом компьютере до отключения?'))return;await call('/local/compatibility',{enabled:!compatible});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};
document.getElementById('refresh-code').onclick=async()=>{try{await call('/local/code',{});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};
document.getElementById('revoke').onclick=async()=>{if(!confirm('Сбросить все привязки? Потребуется повторное подключение Payments.'))return;try{await call('/local/revoke',{});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};
const protocol="""+json.dumps(protocol)+""";
document.getElementById('protocol').onclick=async()=>{try{await call('/local/protocol',{enabled:!protocol});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};
const startup="""+json.dumps(startup)+""";
document.getElementById('autostart').onclick=async()=>{try{await call('/local/autostart',{enabled:!startup});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};
document.getElementById('delete').onclick=async()=>{if(!confirm('Удалить почтовые настройки?'))return;try{await call('/local/delete',{});location.reload()}catch(e){document.getElementById('msg').textContent=e.message}};</script></html>"""

def main():
    service=Service()
    try: httpd=ThreadingHTTPServer((HOST,PORT),make_handler(service))
    except OSError as exc:
        if exc.errno in (98,48,10048) or getattr(exc,"winerror",None)==10048:
            # Repeated protocol activation must not launch a second listener.
            if "--background" not in sys.argv: webbrowser.open(f"http://{HOST}:{PORT}/")
            return
        raise
    print(f"VOLMAX Mail Server: http://{HOST}:{PORT}/",flush=True)
    if "--background" not in sys.argv: webbrowser.open(f"http://{HOST}:{PORT}/")
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally: httpd.server_close()

if __name__=="__main__": main()
