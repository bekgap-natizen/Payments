import tempfile
import unittest
from pathlib import Path
import sqlite3
import sys
import zipfile
import io
from werkzeug.security import generate_password_hash
sys.path.insert(0,str(Path(__file__).resolve().parent))
from app import create_app
ORIGIN="https://approval.example.invalid"
class ApprovalTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=str(Path(self.tmp.name)/"test.sqlite3")
        self.app=create_app({"TESTING":True,"DB":self.path,"PUBLIC_ORIGIN":ORIGIN,"COOKIE_SECURE":False})
        with sqlite3.connect(self.path) as con:
            for user,role in (("bookkeeper","accountant"),("observer","commercial"),("director","director")):
                con.execute("INSERT INTO users VALUES(?,?,?)",(user,role,generate_password_hash("fictional-test-password")))
        self.clients={}
        for user in ("bookkeeper","observer","director"):
            client=self.app.test_client()
            r=client.post("/api/login",json={"login":user,"password":"fictional-test-password"},headers={"Origin":ORIGIN})
            self.assertEqual(r.status_code,200)
            self.clients[user]=(client,r.json["csrf"])
    def tearDown(self):self.tmp.cleanup()
    def post(self,user,path,data,origin=ORIGIN,csrf=True):
        c,t=self.clients[user]
        return c.post(path,json=data,headers={"Origin":origin,"X-CSRF-Token":t if csrf else ""})
    def get(self,user,path):return self.clients[user][0].get(path)
    def payload(self,total=150000):
        return {"date":"2026-01-15","totalCents":total,"rows":[{"org":"Example A","supplier":"Example Vendor","cents":total,"documents":[{"id":"d1","number":"FAKE-1","date":"2025-12-01","due":"2026-02-01","cents":total}]}]}
    def submit(self,total=150000):
        r=self.post("bookkeeper","/api/registers",self.payload(total));self.assertEqual(r.status_code,201,r.json);return r.json["id"]
    def test_auth_and_roles(self):
        self.assertEqual(self.app.test_client().get("/api/registers").status_code,401)
        self.assertEqual(self.post("observer","/api/registers",self.payload()).status_code,403)
        self.assertEqual(self.post("bookkeeper","/api/registers",self.payload(),csrf=False).status_code,403)
        self.assertEqual(self.post("bookkeeper","/api/registers",self.payload(),origin="https://wrong.invalid").status_code,403)
        id_=self.submit()
        self.assertEqual(self.post("observer",f"/api/registers/{id_}/decision",{"action":"approve","version":1}).status_code,200)
        self.assertEqual(self.post("director",f"/api/registers/{id_}/decision",{"action":"approve","version":1}).status_code,409)
        self.assertEqual(self.post("bookkeeper",f"/api/registers/{id_}/decision",{"action":"approve","version":1}).status_code,403)
        self.assertEqual(self.get("bookkeeper",f"/api/registers/{id_}/excel").status_code,200)
    def test_return_revision_and_history(self):
        id_=self.submit()
        self.assertEqual(self.post("bookkeeper","/api/registers",self.payload()).status_code,409)
        self.assertEqual(self.post("director",f"/api/registers/{id_}/decision",{"action":"return","version":1,"note":"Reduce payment"}).status_code,200)
        new=self.submit(100000)
        self.assertNotEqual(id_,new)
        self.assertEqual(self.post("director",f"/api/registers/{id_}/decision",{"action":"approve","version":1}).status_code,409)
        self.assertEqual(self.post("director",f"/api/registers/{new}/decision",{"action":"approve","version":1}).status_code,200)
        history=self.get("observer","/api/registers?supplier=Vendor").json
        self.assertEqual(history["matchingCents"],100000)
        self.assertEqual(len(history["registers"]),2)
        old=self.get("director",f"/api/registers/{id_}").json
        self.assertEqual(old["payload"]["totalCents"],150000)
        self.assertEqual(old["events"][-1]["note"],"Reduce payment")
        self.assertEqual(self.get("director",f"/api/registers/{new}/excel").status_code,403)
        x=self.get("bookkeeper",f"/api/registers/{new}/excel")
        self.assertEqual(x.status_code,200)
        # Verify with the existing production mail companion's workbook validator.
        sys.path.insert(0,str(Path(__file__).resolve().parent.parent/"mail_server"))
        import server
        server.check_xlsx(x.data,100000)
    def test_send_lock(self):
        id_=self.submit()
        path=f"/api/registers/{id_}/send"
        self.assertEqual(self.post("bookkeeper",path,{"action":"begin","version":1}).status_code,409)
        self.post("director",f"/api/registers/{id_}/decision",{"action":"approve","version":1})
        self.assertEqual(self.post("bookkeeper",path,{"action":"begin","version":2}).status_code,200)
        self.assertEqual(self.post("bookkeeper",path,{"action":"begin","version":2}).status_code,409)
        self.assertEqual(self.post("bookkeeper",path,{"action":"uncertain","version":3}).status_code,200)
        self.assertEqual(self.post("bookkeeper",path,{"action":"resolve_sent","version":4}).status_code,200)
        self.assertEqual(self.get("observer",f"/api/registers/{id_}").json["status"],"sent")
    def test_push_queue_roles_and_bad_endpoint(self):
        for user in ("bookkeeper","observer","director"):
            self.assertEqual(self.post(user,"/api/subscriptions",{"endpoint":"https://fcm.googleapis.com/fcm/send/"+user,"keys":{"p256dh":"a"*87,"auth":"b"*22}}).status_code,200)
        self.assertEqual(self.post("observer","/api/subscriptions",{"endpoint":"https://localhost/private","keys":{"p256dh":"a"*87,"auth":"b"*22}}).status_code,400)
        id_=self.submit()
        with sqlite3.connect(self.path) as con:
            self.assertEqual(set(x[0] for x in con.execute("SELECT user_id FROM outbox")),{"observer","director"})
        self.post("director",f"/api/registers/{id_}/decision",{"action":"approve","version":1})
        with sqlite3.connect(self.path) as con:
            self.assertEqual(set(x[0] for x in con.execute("SELECT o.user_id FROM outbox o JOIN events e ON o.event_id=e.id WHERE e.event='approved'")),{"bookkeeper","observer"})
    def test_commercial_notification_and_overview(self):
        for user in ("bookkeeper","observer","director"):
            self.post(user,"/api/subscriptions",{"endpoint":"https://fcm.googleapis.com/fcm/send/"+user,"keys":{"p256dh":"a"*87,"auth":"b"*22}})
        p=self.payload()
        p["overview"]=[{"org":"Example A","supplier":"Example Vendor","debtCents":300000,"dueCents":200000}]
        r=self.post("bookkeeper","/api/registers",p)
        self.assertEqual(r.status_code,201,r.json)
        id_=r.json["id"]
        self.assertEqual(self.post("observer",f"/api/registers/{id_}/decision",{"action":"approve","version":1}).status_code,200)
        with sqlite3.connect(self.path) as con:
            self.assertEqual(set(x[0] for x in con.execute("SELECT o.user_id FROM outbox o JOIN events e ON o.event_id=e.id WHERE e.event='approved'")),{"bookkeeper","director"})
        detail=self.get("director",f"/api/registers/{id_}").json
        self.assertEqual(detail["payload"]["overview"],p["overview"])
        self.assertEqual(detail["events"][-1]["actor"],"observer")
        p["date"]="2026-01-16";p["overview"][0]["dueCents"]=400000
        self.assertEqual(self.post("bookkeeper","/api/registers",p).status_code,400)
    def test_single_use_pair(self):
        import secrets, hashlib
        code=secrets.token_urlsafe(32)
        with sqlite3.connect(self.path) as con:
            con.execute("INSERT INTO invitations VALUES(?,?,?)",(hashlib.sha256(code.encode()).hexdigest(),"observer","2099-01-01T00:00:00+00:00"))
        client=self.app.test_client()
        self.assertEqual(client.post("/api/pair",json={"code":code},headers={"Origin":ORIGIN}).status_code,200)
        self.assertEqual(client.get("/api/me").json["role"],"commercial")
        self.assertEqual(self.app.test_client().post("/api/pair",json={"code":code},headers={"Origin":ORIGIN}).status_code,401)
    def test_wrong_total_duplicate(self):
        p=self.payload();p["totalCents"]+=1
        self.assertEqual(self.post("bookkeeper","/api/registers",p).status_code,400)
        p=self.payload();p["rows"]*=2;p["totalCents"]*=2
        self.assertEqual(self.post("bookkeeper","/api/registers",p).status_code,400)
if __name__=="__main__":unittest.main()
