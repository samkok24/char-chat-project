/**
 * 패치 검증: intro 1개 + 첫대사(assistant 말풍선) 구조 확인
 * URL: http://localhost:5173/ws/chat/8c0455a6-6d56-4afb-8ca5-31a14208afed?new=1&opening=set_1&room=aa825301-8d12-4f26-8c3d-32a279d87b15
 */

const { chromium } = require('playwright');

const CHAT_URL = 'http://localhost:5173/ws/chat/8c0455a6-6d56-4afb-8ca5-31a14208afed?new=1&opening=set_1&room=aa825301-8d12-4f26-8c3d-32a279d87b15';

async function checkpoint(page, label) {
  const introBoxes = page.locator('div.flex.justify-center div.rounded-md.text-center');
  const assistantBubbles = page.locator('.cc-assistant-speech-bubble');
  const errEl = page.getByText('오류').or(page.getByText('연결에 실패')).or(page.getByText('에러')).first();
  const spinner = page.locator('.animate-spin').or(page.getByText('채팅을 준비하고 있어요')).first();

  const introCount = await introBoxes.count();
  const assistantCount = await assistantBubbles.count();
  const hasError = await errEl.count() > 0 && await errEl.isVisible().catch(() => false);
  const hasSpinner = await spinner.count() > 0 && await spinner.isVisible().catch(() => false);

  const quoteLines = [];
  if (introCount > 0) {
    for (let i = 0; i < Math.min(introCount, 3); i++) {
      const t = (await introBoxes.nth(i).textContent().catch(() => '') || '').trim();
      if (t) quoteLines.push({ type: 'intro', text: t.split('\n')[0].slice(0, 80) });
    }
  }
  if (assistantCount > 0) {
    for (let i = 0; i < Math.min(assistantCount, 3); i++) {
      const t = (await assistantBubbles.nth(i).textContent().catch(() => '') || '').trim();
      if (t) quoteLines.push({ type: 'assistant', text: t.split('\n')[0].slice(0, 80) });
    }
  }
  let errorText = '';
  if (hasError) errorText = (await errEl.textContent().catch(() => '') || '').slice(0, 80);

  return {
    label,
    introCount,
    assistantCount,
    totalMessageCount: introCount + assistantCount,
    quoteLines,
    errorShown: hasError,
    errorText,
    spinnerLingering: hasSpinner,
  };
}

async function main() {
  const consoleErrors = [];
  const networkFails = [];
  const results = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('requestfailed', (req) => {
      networkFails.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        networkFails.push({ url: res.url(), error: `HTTP ${res.status()}` });
      }
    });

    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
    results.push(await checkpoint(page, '6초'));

    await browser.close();
  } catch (err) {
    console.error(err);
    if (browser) await browser.close().catch(() => {});
  }

  const last = results[results.length - 1] || {};
  let firstLineRenderedAs = 'none';
  if (last.quoteLines) {
    const found = last.quoteLines.find((q) => q.text && q.text.includes('첫 번째 마석'));
    if (found) firstLineRenderedAs = found.type === 'intro' ? 'introBox' : 'assistantBubble';
  }
  const resolved = last.introCount === 1 && last.assistantCount >= 1 && firstLineRenderedAs === 'assistantBubble';

  console.log(last.introCount + ', ' + last.assistantCount + ', ' + firstLineRenderedAs + ', ' + (resolved ? 'resolved' : 'unresolved'));
}

main().catch(console.error);
