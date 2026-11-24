"""Unit tests: no real email or external network traffic."""
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import server

def fake_excel(cents=30000):
    xml=f'''<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="B1" t="inlineStr"><is><t>ВОЛМАКС</t></is></c></row>
<row r="9"><c r="B9" t="inlineStr"><is><t>ВСЕГО К ОПЛАТЕ</t></is></c>
<c r="C9"><f>SUM(C6)</f><v>{cents/100:.2f}</v></c></row>
</sheetData></worksheet>'''.encode()
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w") as z:
        z.writestr("xl/workbook.xml","<workbook/>")
        z.writestr("xl/worksheets/sheet1.xml",xml)
    return out.getvalue()

class FakeStore:
    def __init__(self): self.value=None
    def load(self): return self.value
    def save(self,email,password):self.value=email,password
    def delete(self):self.value=None

class FakeSMTP:
    messages=[]
    logins=[]
    fail=False
    def __init__(self,*args,**kwargs):pass
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def login(self,email,password):
        self.logins.append(email)
        if self.fail:raise Exception("SMTP login failed")
    def send_message(self,msg):
        self.messages.append(msg)
        return {}

def payload(total=30000):
    import base64
    return {"date":"2026-11-23","totalCents":total,
       "organizations":[{"name":"АквариусПРО ООО","suppliers":[
          {"name":"ООО «Ютара»","cents":10000},
          {"name":"ООО «Тест»","cents":20000}]}],
       "xlsxBase64":base64.b64encode(fake_excel(total)).decode()}

class MailServerTests(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory()
        self.previous=server.DB_FILE
        self.previous_settings=server.SETTINGS_FILE
        server.SETTINGS_FILE=Path(self.dir.name)/"settings.json"
        server.DB_FILE=Path(self.dir.name)/"test.sqlite3"
        self.store=FakeStore()
        FakeSMTP.messages=[];FakeSMTP.logins=[];FakeSMTP.fail=False
        self.service=server.Service(self.store,FakeSMTP)
    def tearDown(self):
        server.DB_FILE=self.previous
        server.SETTINGS_FILE=self.previous_settings
        self.dir.cleanup()
    def test_yandex_rejected_password_shows_specific_error(self):
        class RejectedSMTP(FakeSMTP):
            def login(self, email, password):
                import smtplib
                raise smtplib.SMTPAuthenticationError(535, b"Invalid user or password")
        self.service.smtp_factory=RejectedSMTP
        with self.assertRaisesRegex(server.MailError, "SMTP 535") as result:
            self.service.set_account("grishin@volmax.ru", "not-the-account-password")
        self.assertIn("пароль приложения", str(result.exception))
        self.assertNotIn("not-the-account-password",str(result.exception))
        self.assertIsNone(self.store.load())
    def test_yandex_network_issue_shows_specific_error(self):
        class DisconnectedSMTP(FakeSMTP):
            def __init__(self,*args,**kwargs):
                raise ConnectionError("test failure")
        self.service.smtp_factory=DisconnectedSMTP
        with self.assertRaisesRegex(server.MailError, "подключиться к SMTP Яндекса"):
            self.service.set_account("grishin@volmax.ru", "not-a-real-password")
        self.assertIsNone(self.store.load())
    def test_account_and_persistence(self):
        self.service.set_account("employee@volmax.ru","app-password")
        self.assertEqual(self.service.configured_email(),"employee@volmax.ru")
        self.assertEqual(self.store.load(),("employee@volmax.ru","app-password"))
    def test_send_body_attachment_recipients(self):
        self.service.set_account("employee@volmax.ru","secret")
        result=self.service.send(payload())
        self.assertEqual(result["status"],"accepted")
        msg=FakeSMTP.messages[-1]
        self.assertEqual(msg["From"],"employee@volmax.ru")
        self.assertEqual(msg["Subject"],"Платежи на 23.11.2026")
        self.assertEqual(len(msg["To"].split(", ")),4)
        self.assertIn("Ютара",msg.get_body(preferencelist=("html",)).get_content())
        self.assertIn("Тест",msg.get_body(preferencelist=("html",)).get_content())
        self.assertEqual(len(list(msg.iter_attachments())),1)
    def test_duplicate_requires_explicit_force(self):
        self.service.set_account("x@volmax.ru","secret")
        self.service.send(payload())
        with self.assertRaisesRegex(server.MailError,"Повтор"):self.service.send(payload())
        self.service.send(payload(),force=True)
        self.assertEqual(len(FakeSMTP.messages),2)
    def test_total_mismatch_rejected(self):
        broken=payload();broken["totalCents"]=30001
        with self.assertRaisesRegex(server.MailError,"Итог"):server.validate_payload(broken)
    def test_file_total_mismatch_rejected(self):
        broken=payload()
        import base64
        broken["xlsxBase64"]=base64.b64encode(fake_excel(25000)).decode()
        with self.assertRaisesRegex(server.MailError,"Excel"):server.validate_payload(broken)
    def test_pairing_code_and_token(self):
        self.service.set_account("x@volmax.ru","secret")
        token=self.service.pair(self.service.pair_code)
        self.assertTrue(self.service.authorized(token,server.ALLOWED_ORIGIN))
        with self.assertRaises(server.MailError):self.service.pair("000000")
    def test_saved_pairing_survives_restart_and_can_be_revoked(self):
        self.service.set_account("employee@example.invalid","test-password")
        self.service.enable_opaque(True)
        code=self.service.pair_code
        token=self.service.pair(code,"null")
        self.assertFalse(self.service.pair_code)
        self.assertNotIn(token,server.SETTINGS_FILE.read_text(encoding="utf-8"))
        restarted=server.Service(self.store,FakeSMTP)
        self.assertTrue(restarted.allow_opaque)
        self.assertTrue(restarted.authorized(token,"null"))
        self.assertFalse(restarted.authorized(token,server.ALLOWED_ORIGIN))
        self.assertFalse(restarted.authorized(token,"https://untrusted.invalid"))
        self.assertFalse(restarted.pair_code)
        restarted.new_pair_code()
        self.assertTrue(restarted.authorized(token,"null"))
        restarted.revoke_pairings()
        self.assertFalse(server.Service(self.store,FakeSMTP).authorized(token,"null"))
    def test_disabling_compatibility_revokes_opaque_pairing(self):
        self.service.set_account("employee@example.invalid","test-password")
        self.service.enable_opaque(True)
        token=self.service.pair(self.service.pair_code,"null")
        self.service.enable_opaque(False)
        restarted=server.Service(self.store,FakeSMTP)
        self.assertFalse(restarted.allow_opaque)
        self.assertFalse(restarted.authorized(token,"null"))
    def test_account_change_revokes_old_pairing(self):
        self.service.set_account("employee@example.invalid","test-password")
        token=self.service.pair(self.service.pair_code)
        self.service.set_account("second@example.invalid","new-password")
        self.assertFalse(server.Service(self.store,FakeSMTP).authorized(token,server.ALLOWED_ORIGIN))
    def test_autostart_command_uses_current_executable_and_script(self):
        command=server.autostart_command()
        self.assertIn("--background",command)
        self.assertIn("server.py",command)
    def test_http_cors_for_local_html_and_sandboxed_appbox(self):
        import http.client
        import json
        import threading
        from http.server import ThreadingHTTPServer
        self.service.set_account("test@volmax.invalid","test-only")
        httpd=ThreadingHTTPServer(("127.0.0.1",0),server.make_handler(self.service))
        old_port=server.PORT
        server.PORT=httpd.server_port
        thread=threading.Thread(target=httpd.serve_forever,daemon=True)
        thread.start()
        def request(method,path,origin=None,data=None,token=None,setup=None):
            headers={}
            if origin is not None:headers["Origin"]=origin
            if data is not None:headers["Content-Type"]="application/json"
            if token:headers["X-Payments-Token"]=token
            if setup:headers["X-Setup-Token"]=setup
            if method=="OPTIONS":
                headers["Access-Control-Request-Method"]="POST"
                headers["Access-Control-Request-Headers"]="content-type,x-payments-token"
            conn=http.client.HTTPConnection("127.0.0.1",server.PORT,timeout=5)
            try:
                conn.request(method,path,body=json.dumps(data) if data is not None else None,headers=headers)
                response=conn.getresponse()
                return response.status,dict(response.getheaders()),response.read()
            finally:conn.close()
        try:
            self.assertEqual(request("GET","/?utm_source=chatgpt.com")[0],200)
            self.assertEqual(request("OPTIONS","/v1/status","null")[0],403)
            self.assertEqual(request("OPTIONS","/v1/status",server.ALLOWED_ORIGIN)[0],204)
            self.assertEqual(request("POST","/local/compatibility","null",{"enabled":True},setup=server.SETUP_TOKEN)[0],403)
            local=f"http://127.0.0.1:{server.PORT}"
            self.assertEqual(request("POST","/local/compatibility",local,{"enabled":True})[0],400)
            self.assertEqual(request("POST","/local/compatibility",local,{"enabled":True},setup=server.SETUP_TOKEN)[0],200)
            status,headers,_=request("OPTIONS","/v1/status","null")
            self.assertEqual(status,204)
            self.assertEqual(headers["Access-Control-Allow-Origin"],"null")
            self.assertEqual(headers["Access-Control-Allow-Private-Network"],"true")
            self.assertEqual(request("OPTIONS","/v1/status","https://untrusted.invalid")[0],403)
            status,headers,body=request("GET","/v1/status","null")
            self.assertEqual(status,200)
            self.assertEqual(headers["Access-Control-Allow-Origin"],"null")
            self.assertIsNone(json.loads(body)["sender"])
            self.assertEqual(request("POST","/v1/send","null",payload())[0],401)
            status,headers,body=request("POST","/v1/pair","null",{"code":self.service.pair_code})
            self.assertEqual(status,200)
            token=json.loads(body)["token"]
            self.assertTrue(json.loads(request("GET","/v1/status","null",token=token)[2])["paired"])
            self.assertFalse(json.loads(request("GET","/v1/status",server.ALLOWED_ORIGIN,token=token)[2])["paired"])
            self.assertEqual(request("POST","/v1/send","https://untrusted.invalid",payload(),token=token)[0],403)
            self.assertEqual(request("POST","/v1/send","null",payload(),token=token)[0],200)
            self.assertEqual(len(FakeSMTP.messages),1)
            self.assertEqual(request("POST","/local/compatibility",local,{"enabled":False},setup=server.SETUP_TOKEN)[0],200)
            self.assertEqual(request("OPTIONS","/v1/status","null")[0],403)
        finally:
            httpd.shutdown();httpd.server_close();thread.join(timeout=5)
            server.PORT=old_port
    def test_html_is_escaped(self):
        plain,html=server.render_mail("23.11.2026",[("Org",[("<script>alert(1)</script>",500)],500)],500)
        self.assertNotIn("<script>",html)
        self.assertIn("&lt;script&gt;",html)

if __name__=="__main__":unittest.main()
