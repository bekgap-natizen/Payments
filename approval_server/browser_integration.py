"""Run explicitly with Playwright, never with real financial records."""
import tempfile, sqlite3, threading, socket
from pathlib import Path
from werkzeug.serving import make_server
from werkzeug.security import generate_password_hash
from playwright.sync_api import sync_playwright, expect
from approval_server.app import create_app

def run():
    with tempfile.TemporaryDirectory() as tmp:
        db=str(Path(tmp)/"approval.sqlite3")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0));port=sock.getsockname()[1]
        origin=f"http://127.0.0.1:{port}"
        app=create_app({"TESTING":True,"DB":db,"PUBLIC_ORIGIN":origin,"COOKIE_SECURE":False})
        with sqlite3.connect(db) as con:
            for role in ("accountant","director","commercial"):
                con.execute("INSERT INTO users VALUES(?,?,?)",(role,role,generate_password_hash("example-test-password")))
        server=make_server("127.0.0.1",port,app,threaded=True)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
                def login(role,mobile=False):
                    page=browser.new_page(viewport={"width":390 if mobile else 1280,"height":844})
                    page.goto(origin)
                    page.locator("#login-name").fill(role);page.locator("#login-password").fill("example-test-password")
                    page.locator("#login button").click()
                    expect(page.get_by_role("heading",name="Обзор платежей")).to_be_visible()
                    return page
                pc=login("accountant")
                pc.get_by_role("link",name="Рабочее место бухгалтера").click()
                expect(pc.locator("#page-import")).to_be_visible()
                pc.evaluate("""async () => {
                  const store='volmax-payments-prototype-v1',date='2026-01-20';
                  const receipt=(row,amount)=>({kind:'receipt',row,incomingNumber:'TEST-'+row,incomingDate:'2025-12-01',amountCents:-amount});
                  const sup=(name,amount,row)=>({name,documents:[receipt(row,amount)],reportedBalanceCents:-amount});
                  const orgs=[{name:'Example Org',suppliers:[sup('Example Vendor',250000000,1),sup('Second Vendor',100000000,2)]}];
                  const settings=Object.fromEntries(orgs.flatMap(o=>o.suppliers.map(s=>[PaymentCore.supplierKey(o.name,s.name),{tracked:true,delay:s.name==='Second Vendor'?365:0}])));
                  localStorage.setItem(store+'-settings',JSON.stringify(settings));localStorage.setItem(store+'-selected-date',JSON.stringify(date));
                  await new Promise((resolve,reject)=>{const req=indexedDB.open(store,1);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({date,name:'Synthetic test',fingerprint:'fixture',organizations:orgs,errors:[],audit:{orgs:1,suppliers:2,docs:2,missingDates:0}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);};});
                }""")
                pc.goto(origin+"/desktop/#payments");pc.reload()
                expect(pc.locator("#submit-approval")).to_be_visible()
                pc.locator("#submit-approval").click();pc.locator("[data-dialog-ok]").click()
                expect(pc.get_by_role("heading",name="Платежи на дату")).to_be_visible()
                commercial=login("commercial",True);director=login("director",True)
                expect(commercial.locator(".kpis .value").nth(0)).to_contain_text("3")
                expect(commercial.locator(".kpis .badge")).to_have_text("На согласовании")
                commercial.locator(".org-name").click()
                expect(commercial.locator(".supplier-lines")).to_contain_text("Second Vendor")
                commercial.get_by_role("button",name="Согласование").click()
                expect(commercial.locator(".total-head .badge")).to_have_count(2)
                expect(commercial.locator(".total-head .badge").first).to_have_text("На согласовании")
                commercial.get_by_role("button",name="Утвердить реестр").click()
                expect(commercial.locator(".total-head .badge").last).to_have_text("Утверждено")
                commercial.get_by_role("button",name="Обзор").click()
                expect(commercial.locator(".kpis .badge")).to_have_text("Утверждено")
                director.get_by_role("button",name="Согласование").click()
                expect(director.get_by_role("button",name="Утвердить реестр")).to_have_count(0)
                expect(director.locator(".total-head .badge").first).to_have_text("Утверждено")
                director.get_by_role("button",name="История").click()
                expect(director.locator(".record")).to_have_count(1)
                browser.close()
        finally:server.shutdown();server.server_close()
    print("PASS mobile browser: desktop 0.6.13 submission, overview, both directors, approval badges, history")
if __name__=="__main__":run()
