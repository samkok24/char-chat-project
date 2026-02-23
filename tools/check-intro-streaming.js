/**
 * intro 스트리밍 측정: non-reload + reload 시나리오
 */

const { chromium } = require('playwright');

const HOME_URL = 'http://localhost:5173/';
const CHAT_URL = 'http://localhost:5173/ws/chat/8c0455a6-6d56-4afb-8ca5-31a14208afed?new=1&opening=set_1&room=aa825301-8d12-4f26-8c3d-32a279d87b15';

async function measureIntroTrace(page, count, intervalMs) {
  const trace = [];
  for (let i = 0; i < count; i++) {
    await page.waitForTimeout(intervalMs);
    const introBoxes = page.locator('div.flex.justify-center div.rounded-md.text-center');
    const n = await introBoxes.count();
    let total = 0;
    for (let j = 0; j < n; j++) {
      const t = (await introBoxes.nth(j).textContent().catch(() => '') || '').trim();
      total += t.length;
    }
    trace.push(total);
  }
  return trace;
}

function isStreamed(trace) {
  return trace.length >= 2 && trace[trace.length - 1] > trace[0];
}

async function main() {
  let introLengthTrace = [];
  let reloadIntroLengthTrace = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(HOME_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(500);
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    introLengthTrace = await measureIntroTrace(page, 10, 300);

    await page.reload({ waitUntil: 'networkidle' });
    reloadIntroLengthTrace = await measureIntroTrace(page, 10, 300);

    await browser.close();
  } catch (err) {
    console.error(err);
    if (browser) await browser.close().catch(() => {});
  }

  console.log('introLengthTrace=' + JSON.stringify(introLengthTrace) + ', streamed=' + isStreamed(introLengthTrace));
  console.log('reloadIntroLengthTrace=' + JSON.stringify(reloadIntroLengthTrace) + ', reloadStreamed=' + isStreamed(reloadIntroLengthTrace));
}

main().catch(console.error);
