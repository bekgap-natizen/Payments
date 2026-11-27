"""VOLMAX mobile approval pilot. Same-origin HTTPS, server-side roles and immutable revisions."""
import base64
import contextlib
import datetime as dt
import functools
import getpass
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit

import click
from flask import Flask, abort, g, jsonify, redirect, request, send_file, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
import xlsxwriter

ROOT=Path(__file__).resolve().parent
ROLES={"accountant","commercial","director"}
STATUS={"pending","returned","approved","sending","sent","uncertain"}
MAX_CENTS=10**13
def now(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
def today(): return (dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=3)).date().isoformat()
def fail(msg,code=400): abort(code,description=msg)
def name(v,maxlen=300):
    if not isinstance(v,str) or not 0<len(v.strip())<=maxlen: fail("Некорректное наименование")
    return v.strip()
def day(v):
    try:
        if not isinstance(v,str) or dt.date.fromisoformat(v).isoformat()!=v: raise ValueError
        return v
    except (ValueError,TypeError): fail("Некорректная дата")
def cents(v):
    if type(v) is not int or not 0<v<MAX_CENTS: fail("Некорректная сумма")
    return v
def normalize(raw):
    if not isinstance(raw,dict): fail("Неверный реестр")
    date=day(raw.get("date")); rows=raw.get("rows")
    if not isinstance(rows,list) or not 0<len(rows)<=3000: fail("Нет платежей или превышен размер реестра")
    clean=[]; keys=set(); total=0; doc_count=0
    for r in rows:
        if not isinstance(r,dict): fail("Неверная строка")
        org=name(r.get("org"),200); supplier=name(r.get("supplier")); key=(org,supplier)
        if key in keys: fail("Дубли поставщиков")
        keys.add(key)
        docs=r.get("documents")
        if not isinstance(docs,list) or not 0<len(docs)<=3000: fail("Нет входящих документов")
        doc_count+=len(docs)
        if doc_count>15000:fail("Слишком много документов в реестре")
        seen=set(); detail=[]; subtotal=0
        for d in docs:
            if not isinstance(d,dict): fail("Неверный документ")
            id_=name(d.get("id"),200)
            if id_ in seen: fail("Дубли документов")
            seen.add(id_)
            amount=cents(d.get("cents")); subtotal+=amount
            detail.append({"id":id_,"number":name(d.get("number") or "Без номера"),"date":day(d["date"]) if d.get("date") else None,"due":day(d["due"]) if d.get("due") else None,"cents":amount})
        if type(r.get("cents")) is not int or subtotal!=r.get("cents"): fail("Сумма документов не совпадает")
        clean.append({"org":org,"supplier":supplier,"cents":subtotal,"documents":detail})
        total+=subtotal
    if type(raw.get("totalCents")) is not int or total!=raw.get("totalCents") or total>=MAX_CENTS: fail("Итог реестра не совпадает")
    overview=raw.get("overview")
    if overview is not None:
        if not isinstance(overview,list) or len(overview)>15000:fail("Некорректный обзор")
        seen=set(); snapshot=[]; debt=0; due=0
        for row in overview:
            if not isinstance(row,dict):fail("Некорректная строка обзора")
            org=name(row.get("org"),200); supplier=name(row.get("supplier")); key=(org,supplier)
            d=row.get("debtCents"); u=row.get("dueCents")
            if key in seen or type(d) is not int or type(u) is not int or not 0<=u<=d<MAX_CENTS:fail("Некорректный долг обзора")
            seen.add(key); debt+=d; due+=u
            snapshot.append({"org":org,"supplier":supplier,"debtCents":d,"dueCents":u})
        lookup={(r["org"],r["supplier"]):r["debtCents"] for r in snapshot}
        if debt>=MAX_CENTS or due>=MAX_CENTS or any(r["cents"]>lookup.get((r["org"],r["supplier"]),-1) for r in clean):fail("Обзор не соответствует реестру")
        overview=snapshot
    return {"date":date,"rows":clean,"totalCents":total,"overview":overview}

def excel(p):
    out=io.BytesIO(); book=xlsxwriter.Workbook(out,{"in_memory":True,"strings_to_formulas":False,"strings_to_urls":False})
    sh=book.add_worksheet(p["date"][8:10]+"."+p["date"][5:7]+"."+p["date"][2:4])
    sh.outline_settings(True,False,True,False); sh.set_column("A:A",3);sh.set_column("B:B",62);sh.set_column("C:C",20);sh.set_column("D:E",17)
    title=book.add_format({"bold":True,"font_color":"#173d5a","font_size":15}); header=book.add_format({"bold":True,"bg_color":"#eaf3fb"}); money=book.add_format({"num_format":"#,##0.00"}); totalfmt=book.add_format({"bold":True,"num_format":"#,##0.00","bg_color":"#e3f8f2"})
    sh.write_string(0,1,"ВОЛМАКС · Платежи на "+p["date"],title);sh.write_string(1,1,"Подтверждённый реестр · не банковское поручение");sh.write_string(2,1,"Нажмите «+» для раскрытия входящих документов")
    sh.write_row(3,1,["Организация / Поставщик","К оплате, ₽","Документов","Дата платежа"],header)
    i=4
    for org in sorted(set(r["org"] for r in p["rows"])):
        sh.write_string(i,1,org,header);i+=1; subtotal=0
        for r in sorted((r for r in p["rows"] if r["org"]==org),key=lambda r:r["supplier"]):
            sh.set_row(i,None,None,{"collapsed":True});sh.write_string(i,1,r["supplier"]);sh.write_number(i,2,r["cents"]/100,money);sh.write_number(i,3,len(r["documents"]));sh.write_string(i,4,p["date"]);i+=1;subtotal+=r["cents"]
            for d in sorted(r["documents"],key=lambda d:(d["date"] or "",d["id"])):
                sh.set_row(i,None,None,{"level":1,"hidden":True});sh.write_string(i,1,"  № "+d["number"]+" от "+(d["date"] or ""));sh.write_number(i,2,d["cents"]/100,money);sh.write_string(i,4,d["due"] or "");i+=1
        sh.write_string(i,1,"ИТОГО "+org,header);sh.write_number(i,2,subtotal/100,totalfmt);i+=1
    sh.write_string(i,1,"ВСЕГО К ОПЛАТЕ",header);sh.write_number(i,2,p["totalCents"]/100,totalfmt)
    book.close()
    # Existing Mail Server expects inline text in the grand-total label. Convert shared strings
    # to inline strings without changing workbook data; also removes formula injection risk.
    import zipfile, xml.etree.ElementTree as ET
    ns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    ET.register_namespace("",ns)
    out.seek(0); dst=io.BytesIO()
    with zipfile.ZipFile(out) as src,zipfile.ZipFile(dst,"w",zipfile.ZIP_DEFLATED) as target:
        ss=ET.fromstring(src.read("xl/sharedStrings.xml")); strings=ss.findall("{"+ns+"}si")
        for item in src.infolist():
            data=src.read(item.filename)
            if item.filename=="xl/worksheets/sheet1.xml":
                root=ET.fromstring(data)
                for cell in root.iter("{"+ns+"}c"):
                    if cell.get("t")=="s":
                        v=cell.find("{"+ns+"}v");idx=int(v.text);cell.remove(v);cell.set("t","inlineStr")
                        inline=ET.SubElement(cell,"{"+ns+"}is")
                        for child in strings[idx]:inline.append(child)
                data=ET.tostring(root,encoding="utf-8",xml_declaration=True)
            target.writestr(item,data)
    return dst.getvalue()

SCHEMA="""
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, role TEXT NOT NULL, password TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_director ON users(role) WHERE role='director';
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registers(id INTEGER PRIMARY KEY, date TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, creator TEXT NOT NULL, created TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE(date,revision));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, register_id INTEGER NOT NULL REFERENCES registers(id), actor TEXT NOT NULL, event TEXT NOT NULL, created TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id), subscription TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(event_id,subscription));
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(user_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until TEXT NOT NULL);
"""
def create_app(config=None):
    app=Flask(__name__,static_folder=None)
    app.config.update(DB=os.getenv("PAYMENTS_DB",str(ROOT/"data"/"approval.sqlite3")),PUBLIC_ORIGIN=os.getenv("PAYMENTS_ORIGIN",""),COOKIE_SECURE=True,MAX_CONTENT_LENGTH=8*1024*1024,DIST=str(ROOT.parent/"dist"))
    if config:app.config.update(config)
    origin=app.config["PUBLIC_ORIGIN"].rstrip("/")
    if not app.testing and (not origin.startswith("https://") or urlsplit(origin).path or not urlsplit(origin).hostname): raise RuntimeError("Set PAYMENTS_ORIGIN to the dedicated HTTPS origin")
    path=Path(app.config["DB"]);path.parent.mkdir(parents=True,exist_ok=True)
    def connection():
        con=sqlite3.connect(path,timeout=15,isolation_level=None);con.row_factory=sqlite3.Row;con.execute("PRAGMA foreign_keys=ON");return con
    with contextlib.closing(connection()) as con:con.executescript(SCHEMA);con.execute("PRAGMA journal_mode=WAL")
    def db():
        if "db" not in g:g.db=connection()
        return g.db
    @app.teardown_appcontext
    def close(_): 
        con=g.pop("db",None)
        if con:con.close()
    @contextlib.contextmanager
    def tx():
        con=db();con.execute("BEGIN IMMEDIATE")
        try:yield con;con.execute("COMMIT")
        except BaseException:con.execute("ROLLBACK");raise
    def digest(v):return hashlib.sha256(v.encode()).hexdigest()
    @app.before_request
    def auth():
        g.user=None
        token=request.cookies.get("volmax_approval","")
        if token:
            g.user=db().execute("SELECT u.id,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",(digest(token),now())).fetchone()
        if request.method not in ("GET","HEAD","OPTIONS"):
            if request.headers.get("Origin")!=origin:fail("Недоверенный источник запроса",403)
            if request.path not in ("/api/login","/api/pair"):
                if not g.user:fail("Войдите в приложение",401)
                if not hmac.compare_digest(request.headers.get("X-CSRF-Token",""),g.user["csrf"]):fail("Неверный токен запроса",403)
    @app.after_request
    def security(r):
        r.headers["Cache-Control"]="no-store";r.headers["X-Content-Type-Options"]="nosniff";r.headers["Referrer-Policy"]="no-referrer";r.headers["X-Frame-Options"]="DENY"
        r.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:8765; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
        if app.config["COOKIE_SECURE"]:r.headers["Strict-Transport-Security"]="max-age=31536000"
        return r
    @app.errorhandler(400)
    @app.errorhandler(401)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(409)
    @app.errorhandler(413)
    @app.errorhandler(429)
    def error(e):return jsonify(error=e.description),e.code
    def role(*roles):
        def wrap(fn):
            @functools.wraps(fn)
            def check(*a,**kw):
                if not g.user:fail("Войдите в приложение",401)
                if roles and g.user["role"] not in roles:fail("Нет права на это действие",403)
                return fn(*a,**kw)
            return check
        return wrap
    def body():
        v=request.get_json(silent=True)
        if not isinstance(v,dict):fail("Ожидается объект JSON")
        return v
    def get(con,id_):
        r=con.execute("SELECT * FROM registers WHERE id=?",(id_,)).fetchone()
        if not r:fail("Реестр не найден",404)
        return r
    def event(con,id_,kind,note="",details=None,notify=()):
        eid=con.execute("INSERT INTO events(register_id,actor,event,created,note,details) VALUES(?,?,?,?,?,?)",(id_,g.user["id"],kind,now(),note,json.dumps(details or {},ensure_ascii=False))).lastrowid
        if notify:
            slots=",".join("?" for _ in notify)
            for sub in con.execute("SELECT s.endpoint,s.user_id FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.role IN ("+slots+") AND u.id<>?",(*notify,g.user["id"])):
                con.execute("INSERT OR IGNORE INTO outbox(event_id,user_id,subscription) VALUES(?,?,?)",(eid,sub["user_id"],sub["endpoint"]))
    def view(r,history=False):
        x=dict(r);x["payload"]=json.loads(x["payload"])
        if history:x["events"]=[{**dict(e),"details":json.loads(e["details"])} for e in db().execute("SELECT * FROM events WHERE register_id=? ORDER BY id",(r["id"],))]
        return x
    @app.cli.command("user")
    @click.argument("user_id")
    @click.argument("user_role",type=click.Choice(sorted(ROLES)))
    def create_user(user_id,user_role):
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,60}",user_id):raise click.ClickException("Invalid login")
        password=getpass.getpass("Password (at least 12 characters): ")
        if len(password)<12:raise click.ClickException("Too short")
        with tx() as con:
            con.execute("INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,password=excluded.password",(user_id,user_role,generate_password_hash(password)))
            con.execute("DELETE FROM sessions WHERE user_id=?",(user_id,))
            con.execute("DELETE FROM subscriptions WHERE user_id=?",(user_id,))
        click.echo("Account saved. Sessions and subscriptions revoked.")
    # Local admin creates random single-use invitations. No public invitation-creation endpoint.
    @app.post("/api/pair")
    def pair():
        token=body().get("code")
        if not isinstance(token,str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}",token):fail("Неверный код подключения",401)
        with tx() as con:
            invite=con.execute("SELECT i.user_id,u.role FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.token=? AND i.expires>?",(digest(token),now())).fetchone()
            if not invite:fail("Код истёк или уже использован",401)
            con.execute("DELETE FROM invitations WHERE token=?",(digest(token),))
            session=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32)
            expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=180)).isoformat(timespec="seconds")
            con.execute("INSERT INTO sessions VALUES(?,?,?,?)",(digest(session),invite["user_id"],csrf,expires))
        result=jsonify(id=invite["user_id"],role=invite["role"],csrf=csrf)
        result.set_cookie("volmax_approval",session,max_age=15552000,httponly=True,secure=app.config["COOKIE_SECURE"],samesite="Strict",path="/")
        return result
    @app.post("/api/login")
    def login():
        raw=body();user=raw.get("login");pw=raw.get("password")
        if not isinstance(user,str) or not isinstance(pw,str) or len(user)>60 or len(pw)>500:fail("Неверные данные",401)
        key=digest(user.casefold()+"|"+str(request.remote_addr)); valid=False; token=None; csrf=None
        with tx() as con:
            limit=con.execute("SELECT * FROM login_limits WHERE user_key=?",(key,)).fetchone()
            if limit and limit["until"]>now() and limit["attempts"]>=8:fail("Слишком много попыток. Повторите через 15 минут",429)
            u=con.execute("SELECT * FROM users WHERE id=?",(user,)).fetchone()
            valid=bool(u and check_password_hash(u["password"],pw))
            if valid:
                con.execute("DELETE FROM login_limits WHERE user_key=?",(key,));con.execute("DELETE FROM sessions WHERE expires<=?",(now(),))
                token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32);expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=7)).isoformat(timespec="seconds")
                con.execute("INSERT INTO sessions VALUES(?,?,?,?)",(digest(token),user,csrf,expires))
            else:
                attempts=limit["attempts"]+1 if limit and limit["until"]>now() else 1
                until=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=15)).isoformat(timespec="seconds")
                con.execute("INSERT OR REPLACE INTO login_limits VALUES(?,?,?)",(key,attempts,until))
        if not valid:fail("Неверный логин или пароль",401)
        r=jsonify(id=user,role=u["role"],csrf=csrf)
        r.set_cookie("volmax_approval",token,max_age=604800,httponly=True,secure=app.config["COOKIE_SECURE"],samesite="Strict",path="/")
        return r
    @app.post("/api/logout")
    @role()
    def logout():
        with tx() as con:con.execute("DELETE FROM sessions WHERE token=?",(digest(request.cookies["volmax_approval"]),))
        r=jsonify(ok=True);r.delete_cookie("volmax_approval",path="/",secure=app.config["COOKIE_SECURE"],samesite="Strict");return r
    @app.get("/api/me")
    @role()
    def me():return jsonify(**dict(g.user),today=today(),vapidPublicKey=os.getenv("PAYMENTS_VAPID_PUBLIC",""))
    @app.get("/api/registers")
    @role()
    def listing():
        start=request.args.get("from");end=request.args.get("to");org=request.args.get("org","").casefold();supplier=request.args.get("supplier","").casefold()
        q="SELECT * FROM registers WHERE 1=1";args=[]
        if start:q+=" AND date>=?";args.append(day(start))
        if end:q+=" AND date<=?";args.append(day(end))
        results=[]; filtered_total=0
        for r in db().execute(q+" ORDER BY date DESC,revision DESC LIMIT 1000",args):
            x=view(r)
            matched=[a for a in x["payload"]["rows"] if org in a["org"].casefold() and supplier in a["supplier"].casefold()]
            if not matched:continue
            x["matchingCents"]=sum(a["cents"] for a in matched)
            # Only final approved/sent revisions contribute to history totals; never sum rejected revisions.
            if x["status"] in ("approved","sending","sent","uncertain"):filtered_total+=x["matchingCents"]
            results.append(x)
        return jsonify(registers=results,matchingCents=filtered_total)
    @app.get("/api/registers/<int:id_>")
    @role()
    def detail(id_):return jsonify(view(get(db(),id_),True))
    @app.post("/api/registers")
    @role("accountant")
    def submit():
        p=normalize(body())
        with tx() as con:
            last=con.execute("SELECT * FROM registers WHERE date=? ORDER BY revision DESC LIMIT 1",(p["date"],)).fetchone()
            if last and last["status"]!="returned":fail("За эту дату уже есть действующий реестр. Для новой версии необходим возврат на доработку.",409)
            rev=last["revision"]+1 if last else 1
            id_=con.execute("INSERT INTO registers(date,revision,status,payload,creator,created) VALUES(?,?,?,?,?,?)",(p["date"],rev,"pending",json.dumps(p,ensure_ascii=False),g.user["id"],now())).lastrowid
            event(con,id_,"submitted",notify=("director","commercial"))
        return jsonify(id=id_,revision=rev),201
    @app.post("/api/registers/<int:id_>/decision")
    @role("director","commercial")
    def decision(id_):
        raw=body();action=raw.get("action")
        if action not in ("approve","return"):fail("Недопустимое решение")
        note=raw.get("note","")
        if not isinstance(note,str) or len(note)>2000 or (action=="return" and not note.strip()):fail("Укажите причину возврата")
        with tx() as con:
            r=get(con,id_)
            if r["status"]!="pending" or raw.get("version")!=r["version"]:fail("Реестр уже изменился. Обновите страницу.",409)
            status="approved" if action=="approve" else "returned"
            con.execute("UPDATE registers SET status=?,version=version+1 WHERE id=?",(status,id_))
            event(con,id_,status,note,notify=("accountant","commercial","director"))
        return jsonify(ok=True)
    @app.get("/api/registers/<int:id_>/excel")
    @role("accountant")
    def download(id_):
        r=get(db(),id_)
        if r["status"] not in ("approved","sending","sent","uncertain"):fail("Реестр не утверждён",409)
        return send_file(io.BytesIO(excel(json.loads(r["payload"]))),mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",as_attachment=True,download_name="Payments-"+r["date"]+".xlsx")
    @app.post("/api/registers/<int:id_>/send")
    @role("accountant")
    def send_state(id_):
        raw=body();action=raw.get("action")
        with tx() as con:
            r=get(con,id_)
            if raw.get("version")!=r["version"]:fail("Реестр изменился. Обновите страницу.",409)
            if action=="begin" and r["status"]=="approved":status="sending"
            elif action=="accepted" and r["status"]=="sending":status="sent"
            elif action=="uncertain" and r["status"]=="sending":status="uncertain"
            elif action=="resolve_sent" and r["status"] in ("sending","uncertain"):status="sent"
            elif action=="resolve_retry" and r["status"] in ("sending","uncertain"):status="approved"
            else:fail("Недопустимое изменение статуса",409)
            con.execute("UPDATE registers SET status=?,version=version+1 WHERE id=?",(status,id_))
            event(con,id_,status, "Отметка бухгалтера; фактический перевод средств не подтверждается" if action.startswith("resolve") else "Результат локального SMTP, сообщённый приложением" if action=="accepted" else "",notify=("director","commercial") if status=="sent" else ())
        return jsonify(ok=True,version=r["version"]+1,status=status)
    @app.post("/api/subscriptions")
    @role()
    def subscription():
        raw=body();endpoint=raw.get("endpoint");keys=raw.get("keys")
        if not isinstance(endpoint,str) or len(endpoint)>2000 or not isinstance(keys,dict):fail("Неверная подписка")
        try:u=urlsplit(endpoint);host=u.hostname or "";port=u.port
        except ValueError:fail("Неверный адрес подписки")
        if u.scheme!="https" or u.username or u.password or port not in (None,443) or not (host in ("fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com") or host.endswith(".push.apple.com")):fail("Неизвестный сервис push")
        for k in ("p256dh","auth"):
            if not isinstance(keys.get(k),str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,200}",keys[k]):fail("Неверный ключ подписки")
        with tx() as con:con.execute("INSERT INTO subscriptions VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,data=excluded.data",(endpoint,g.user["id"],json.dumps({"endpoint":endpoint,"keys":keys,"showSummary":raw.get("showSummary") is True})))
        return jsonify(ok=True)
    @app.post("/api/unsubscribe")
    @role()
    def unsubscribe():
        endpoint=body().get("endpoint")
        if not isinstance(endpoint,str):fail("Неверная подписка")
        with tx() as con:con.execute("DELETE FROM subscriptions WHERE endpoint=? AND user_id=?",(endpoint,g.user["id"]))
        return jsonify(ok=True)
    @app.get("/")
    def index():return send_from_directory(ROOT/"static","index.html")
    @app.get("/<file>")
    def static_file(file):
        if file=="volmax-mark.png":return send_from_directory(ROOT.parent/"assets",file)
        if file not in {"app.js","app.css","manifest.webmanifest","sw.js","icon.svg","icon-192.png","icon-512.png","apple-touch-icon.png"}:fail("Не найдено",404)
        return send_from_directory(ROOT/"static",file)
    @app.get("/desktop/")
    def desktop():
        if not g.user or g.user["role"]!="accountant":return redirect("/")
        return send_from_directory(app.config["DIST"],"index.html")
    @app.get("/desktop/assets/<path:file>")
    @role("accountant")
    def desktop_assets(file):return send_from_directory(Path(app.config["DIST"])/"assets",file)
    return app
