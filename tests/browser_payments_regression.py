"""Browser regression using only synthetic ledger data and a local HTTP server."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(("127.0.0.1",0),partial(Quiet,directory=str(ROOT/"dist")))
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
url=f"http://127.0.0.1:{server.server_port}/"
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--no-sandbox"])
        page=browser.new_page(viewport={"width":1280,"height":850},accept_downloads=True)
        errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(url);expect(page.locator("#page-import")).to_be_visible()
        page.evaluate("""async () => {
          const store='volmax-payments-prototype-v1',date='2026-01-20';
          const receipt=(row,day,amount)=>({kind:'receipt',row,incomingNumber:'TEST-'+row,incomingDate:day,amountCents:-amount});
          const sup=(name,documents)=>({name,documents,reportedBalanceCents:documents.reduce((n,d)=>n+d.amountCents,0)});
          const orgs=[{name:'Example Org',suppliers:[sup('Due Vendor',[receipt(1,'2025-12-01',60000000)]),sup('Future Vendor',[receipt(2,'2026-01-10',70000000)]),{...sup('Review Vendor',[receipt(4,'2025-12-01',50000)]),reportedBalanceCents:-60000}]},
                      {name:'Other Org',suppliers:[sup('Other Vendor',[receipt(3,'2025-12-01',100000)]),{...sup('Review Vendor',[receipt(5,'2025-12-01',40000)]),reportedBalanceCents:-45000}]}];
          const settings=Object.fromEntries(orgs.flatMap(o=>o.suppliers.map(s=>[PaymentCore.supplierKey(o.name,s.name),{tracked:true,delay:s.name==='Future Vendor'?60:0}])));
          localStorage.setItem(store+'-settings',JSON.stringify(settings));localStorage.setItem(store+'-selected-date',JSON.stringify(date));
          await new Promise((resolve,reject)=>{const req=indexedDB.open(store,1);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({date,name:'Synthetic test',fingerprint:'fixture',organizations:orgs,errors:[],audit:{orgs:2,suppliers:5,docs:5,missingDates:0}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error);};});
        }""")
        page.goto(url+"#payments");page.reload()
        expect(page.locator("#page-payments")).to_be_visible()
        warnings=page.locator("#payment-review-alert .payment-review-row")
        expect(warnings).to_have_count(2)
        expect(warnings.filter(has_text="Example Org — Review Vendor")).to_contain_text("Разница")
        warnings.filter(has_text="Example Org — Review Vendor").get_by_role("button",name="Сверка").click()
        expect(page.locator("#page-reconcile")).to_be_visible()
        expect(page.locator("#page-reconcile")).to_contain_text("Example Org")
        expect(page.locator("#page-reconcile")).not_to_contain_text("Other Org")
        expect(page.locator("#page-reconcile")).to_contain_text("Сальдо 1С не совпадает")
        page.locator("#page-reconcile").get_by_role("button",name="Все расхождения").click()
        expect(page.locator("#page-reconcile")).to_contain_text("Other Org")
        page.locator('[data-page="payments"]').first.click()
        expect(page.locator("#payment-review-alert")).to_be_visible()
        vendor=page.locator(".vendor-card").filter(has=page.get_by_text("Future Vendor",exact=True))
        due=page.locator(".vendor-card").filter(has=page.get_by_text("Due Vendor",exact=True))
        # Scope text to vendor cards to avoid the same supplier name in priorities.
        future_check=vendor.locator("[data-supplier-select]")
        due_check=due.locator("[data-supplier-select]")
        budget=page.locator('[data-budget-org="Example Org"]')
        budget.fill("1000000")
        page.locator('[data-auto-org="Example Org"]').click()
        page.locator("[data-dialog-ok]").click()
        expect(due_check).to_be_checked()
        expect(future_check).not_to_be_checked()
        expect(future_check).to_be_enabled()
        future_check.click()
        expect(future_check).to_be_checked()
        assert future_check.evaluate("(el)=>el.indeterminate") is False
        assert future_check.get_attribute("aria-checked") is None
        vendor.locator("summary").click()
        amount=vendor.locator("[data-doc-amount]")
        expect(amount).to_have_value("400 000,00")
        amount.fill("250000");amount.press("Tab")
        expect(future_check).to_be_checked()
        assert future_check.evaluate("(el)=>el.indeterminate") is False
        expect(amount).to_have_value("250 000,00")
        page.locator('[data-auto-org="Example Org"]').click()
        page.locator("[data-dialog-ok]").click()
        expect(amount).to_have_value("250 000,00")
        future_check.click()
        page.locator("[data-dialog-cancel]").click()
        expect(future_check).to_be_checked()
        expect(amount).to_have_value("250 000,00")
        future_check.click()
        page.locator("[data-dialog-ok]").click()
        expect(future_check).not_to_be_checked()
        page.locator("#only-due").check()
        expect(vendor).to_have_count(0)
        page.locator("#only-due").uncheck()
        future_check.click()
        expect(future_check).to_be_checked()
        expect(amount).to_have_value("400 000,00")
        # The selected-only filter and organization filter cannot change the exported full registry.
        page.locator("#payment-org").select_option("Example Org")
        page.locator("#export-payments").click()
        with page.expect_download() as result:
            page.locator("[data-dialog-ok]").click()
        with ZipFile(result.value.path()) as book:
            root=ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
            ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            totals=[]
            for row in root.findall(".//m:sheetData/m:row",ns):
                label=row.find("./m:c[@r='B"+row.attrib["r"]+"']/m:is/m:t",ns)
                if label is not None and label.text=="ВСЕГО К ОПЛАТЕ":
                    totals.append(float(row.find("./m:c[@r='C"+row.attrib["r"]+"']/m:v",ns).text))
            assert totals==[1001000],totals
        expect(future_check).to_be_disabled()
        assert not errors,errors
        browser.close()
    print("PASS browser: actual checkmarks, manual selection, budget, cancellation, filter and Excel total")
finally:
    server.shutdown();server.server_close()
