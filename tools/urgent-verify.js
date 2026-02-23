/**
 * 긴급 검증: 캐릭터 상세 -> 새로대화 클릭 -> 10초 관찰
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8c0455a6-6d56-4afb-8ca5-31a14208afed';

async function main() {
  let firstLinePresent = false;
  const introLengths = [];
  const greetingLengths = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);

    const btn = page.locator('button:has-text("새로 대화"), button:has-text("대화 시작")').first();
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);

    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(300);
      const introBoxes = page.locator('div.flex.justify-center div.rounded-md.text-center');
      const bubbles = page.locator('.cc-assistant-speech-bubble');
      let introLen = 0;
      let greetingLen = 0;
      for (let j = 0; j < await introBoxes.count(); j++) {
        introLen += ((await introBoxes.nth(j).textContent().catch(() => '') || '').trim()).length;
      }
      for (let j = 0; j < await bubbles.count(); j++) {
        greetingLen += ((await bubbles.nth(j).textContent().catch(() => '') || '').trim()).length;
      }
      introLengths.push(introLen);
      greetingLengths.push(greetingLen);
    }

    firstLinePresent = greetingLengths[greetingLengths.length - 1] > 0;
    await browser.close();
  } catch (err) {
    console.error(err);
    if (browser) await browser.close().catch(() => {});
  }

  const introStreamed = introLengths.length >= 2 && introLengths[introLengths.length - 1] > introLengths[0];
  const firstLineStreamed = greetingLengths.length >= 2 && greetingLengths[greetingLengths.length - 1] > greetingLengths[0];
  const firstLineVisible = greetingLengths[greetingLengths.length - 1] > 0;

  console.log('introTrace=' + JSON.stringify(introLengths) + ', firstLineTrace=' + JSON.stringify(greetingLengths) + ', introStreamed=' + introStreamed + ', firstLineStreamed=' + firstLineStreamed);
}

main().catch(console.error);
