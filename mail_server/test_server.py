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
        server.DB_FILE=Path(self.dir.name)/"test.sqlite3"
        self.store=FakeStore()
        FakeSMTP.messages=[];FakeSMTP.logins=[];FakeSMTP.fail=False
        self.service=server.Service(self.store,FakeSMTP)
    def tearDown(self):
        server.DB_FILE=self.previous
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
        self.assertIn(token,self.service.session_tokens)
        with self.assertRaises(server.MailError):self.service.pair("000000")
    def test_html_is_escaped(self):
        plain,html=server.render_mail("23.11.2026",[("Org",[("<script>alert(1)</script>",500)],500)],500)
        self.assertNotIn("<script>",html)
        self.assertIn("&lt;script&gt;",html)

if __name__=="__main__":unittest.main()
