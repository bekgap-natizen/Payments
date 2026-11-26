"""Run as a single worker. Financial notification summary requires per-device opt-in."""
import datetime as dt
import json
import os
import sqlite3
import time
from pathlib import Path
from urllib.parse import urlsplit
import requests
from pywebpush import webpush, WebPushException

def valid_endpoint(endpoint):
    u=urlsplit(endpoint);h=u.hostname or ""
    return u.scheme=="https" and not u.username and not u.password and u.port in (None,443) and (h in ("fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com") or h.endswith(".push.apple.com"))

class NoRedirect(requests.Session):
    def request(self,*args,**kwargs):
        kwargs["allow_redirects"]=False
        kwargs["timeout"]=20
        return super().request(*args,**kwargs)

def run():
    path=os.environ.get("PAYMENTS_DB",str(Path(__file__).resolve().parent/"data"/"approval.sqlite3"))
    key=os.environ["PAYMENTS_VAPID_PRIVATE"]
    subject=os.environ["PAYMENTS_VAPID_SUBJECT"]
    if not subject.startswith(("mailto:","https://")):raise RuntimeError("Invalid VAPID subject")
    session=NoRedirect()
    while True:
        with sqlite3.connect(path,timeout=15) as con:
            con.row_factory=sqlite3.Row
            row=con.execute("""SELECT o.id,o.attempts,o.subscription,s.data,e.event,e.register_id,r.payload
                FROM outbox o JOIN subscriptions s ON s.endpoint=o.subscription AND s.user_id=o.user_id
                JOIN events e ON e.id=o.event_id JOIN registers r ON r.id=e.register_id WHERE o.state='pending' AND o.attempts<5 ORDER BY o.id LIMIT 1""").fetchone()
            if row:con.execute("UPDATE outbox SET attempts=attempts+1 WHERE id=?",(row["id"],))
        if not row:time.sleep(3);continue
        state="failed";gone=False
        try:
            sub=json.loads(row["data"])
            if not valid_endpoint(sub["endpoint"]):raise ValueError("Bad push endpoint")
            titles={"submitted":"Новый реестр на согласование","approved":"Платежи утверждены","returned":"Реестр возвращён на доработку","sent":"Реестр отправлен по почте"}
            body="Откройте приложение для просмотра реестра."
            if sub.pop("showSummary",False):
                p=json.loads(row["payload"]);group={}
                for r in p["rows"]:group.setdefault(r["org"],[]).append(r)
                money=lambda c:f"{c/100:,.2f}".replace(","," ").replace(".",",")+" ₽"
                lines=["Всего "+money(p["totalCents"])]
                for org,rows in group.items():
                    lines.append(org+": "+money(sum(r["cents"] for r in rows)))
                    lines.extend("  "+r["supplier"]+": "+money(r["cents"]) for r in rows)
                body="\n".join(lines)
                if len(body)>300:body=body[:270]+"… Подробнее в приложении."
            data=json.dumps({"id":row["register_id"],"title":"ВОЛМАКС · "+titles.get(row["event"],"Платежи"),"body":body},ensure_ascii=False)
            result=webpush(subscription_info=sub,data=data,vapid_private_key=key,vapid_claims={"sub":subject},ttl=3600,requests_session=session,timeout=20)
            if not 200<=result.status_code<300:raise RuntimeError("Push rejected")
            state="sent"
        except WebPushException as exc:
            code=exc.response.status_code if exc.response is not None else None
            gone=code in (404,410)
            if not gone and (code is None or code==429 or code>=500):state="pending" if row["attempts"]<4 else "failed"
        except (requests.RequestException,TimeoutError):
            state="pending" if row["attempts"]<4 else "failed"
        except Exception:
            state="failed"
        with sqlite3.connect(path,timeout=15) as con:
            con.execute("UPDATE outbox SET state=? WHERE id=?",(state,row["id"]))
            if gone:con.execute("DELETE FROM subscriptions WHERE endpoint=?",(row["subscription"],))
        if state=="pending":time.sleep(15)

if __name__=="__main__":run()
