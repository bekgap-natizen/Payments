"""Optional browser smoke test: requires Playwright and Chromium.
Loads built assets through the browser engine without network/file navigations.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':900})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<!doctype html><html><body><div id="root"></div></body></html>')
 for name in ['foundation.css','components.css','responsive-brand.css']:
  page.add_style_tag(content=(root/'dist/assets'/name).read_text('utf8'))
 for name in ['core.js','export.js','ui.js']:
  page.add_script_tag(content=(root/'dist/assets'/name).read_text('utf8'))
 page.wait_for_timeout(600)
 assert page.locator('h1').first.inner_text()=='Обзор платежей'
 page.locator('[data-page="import"]').first.click()
 assert 'Обновить' in page.locator('#page-import h1').first.inner_text()
 assert not errors,errors
 print('PASS embedded-browser smoke, navigation and JS startup')
 b.close()
