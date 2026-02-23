const { chromium } = require('playwright');
const CHAR_URL = 'http://localhost:5173/characters/8c0455a6-6d56-4afb-8ca5-31a14208afed';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);
  const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click();
  await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const url = page.url();
  await browser.close();
  console.log(url);
  try {
    const u = new URL(url);
    console.log('new=1 포함:', u.searchParams.get('new') === '1');
  } catch (_) {}
})();
