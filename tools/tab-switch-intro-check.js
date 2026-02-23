/**
 * 탭 전환 후 intro 재타이핑 여부 확인
 * 1) 오프닝 완료 후 사용자 메시지 1회 전송
 * 2) 다른 탭으로 이동 후 원래 탭 복귀
 * 3) 복귀 직후 intro 박스가 다시 타이핑되는지 확인
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8c0455a6-6d56-4afb-8ca5-31a14208afed';
const INTRO_SELECTOR = 'div.flex.justify-center div.rounded-md.text-center';

async function getIntroLength(page) {
  const boxes = page.locator(INTRO_SELECTOR);
  let len = 0;
  for (let j = 0; j < await boxes.count(); j++) {
    len += ((await boxes.nth(j).textContent().catch(() => '') || '').trim()).length;
  }
  return len;
}

async function main() {
  let result = 'no';
  let evidence = '';

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(8000); // 오프닝 완료 대기

    const textarea = page.locator('form#chat-send-form textarea, #chat-send-form textarea, textarea[data-autogrow]').first();
    await textarea.fill('안녕').catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('form#chat-send-form').evaluate((f) => f.requestSubmit()).catch(() => {});
    await page.waitForTimeout(6000); // AI 응답 대기

    const chatPage = page;
    const newTab = await context.newPage();
    await newTab.goto('about:blank', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await chatPage.bringToFront();
    await page.waitForTimeout(500);

    const lengths = [];
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(300);
      lengths.push(await getIntroLength(chatPage));
    }

    const reTyping = lengths.length >= 2 && lengths[lengths.length - 1] > lengths[0];
    result = reTyping ? 'yes' : 'no';
    evidence = reTyping
      ? `intro length increased from ${lengths[0]} to ${lengths[lengths.length - 1]} after tab return`
      : `intro length stable at ${lengths.join(',')} after tab return`;

    await browser.close();
  } catch (err) {
    evidence = `error: ${err.message}`;
    if (browser) await browser.close().catch(() => {});
  }

  console.log(`${result}, ${evidence}`);
}

main().catch(console.error);
