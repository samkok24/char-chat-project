/**
 * 오프닝 순서 검증: 지문박스 → 첫대사 순서 확인
 * URL: http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35';

async function main() {
  const report = {
    result: null,
    introFirstSeen: null,
    greetingFirstSeen: null,
    orderCorrect: null,
    orderDescr: null,
    observations: [],
    consoleErrors: [],
    networkErrors: [],
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') report.consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      report.networkErrors.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
    });

    await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const newChatBtn = page.locator('button:has-text("새로 대화"), button:has-text("선택한 오프닝으로 새로 대화"), button:has-text("대화 시작")').first();
    await newChatBtn.scrollIntoViewIfNeeded().catch(() => {});
    const hasBtn = await newChatBtn.count() > 0 && await newChatBtn.isVisible().catch(() => false);
    if (!hasBtn) {
      report.result = 'FAIL';
      report.observations.push('새로 대화 버튼 미발견');
      await browser.close();
      printReport(report);
      return;
    }

    const t0 = Date.now();
    await newChatBtn.click();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);

    if (!page.url().includes('/ws/chat/')) {
      report.result = 'FAIL';
      report.observations.push('채팅방 진입 실패');
      await browser.close();
      printReport(report);
      return;
    }

    // 지문박스: intro (message_metadata.kind=intro) - 중앙 정렬 rounded-md 박스
    // 첫대사: cc-assistant-speech-bubble (첫 assistant 메시지, intro 아님)
    const INTRO_SELECTOR = 'div.flex.justify-center div.rounded-md.text-center';
    const GREETING_SELECTOR = '.cc-assistant-speech-bubble';

    const POLL_MS = 80;
    const OBSERVE_MS = 10000;

    for (let elapsed = 0; elapsed < OBSERVE_MS; elapsed += POLL_MS) {
      await page.waitForTimeout(POLL_MS);
      const t = (Date.now() - t0) / 1000;

      const introEl = page.locator(INTRO_SELECTOR).first();
      const hasIntro = await introEl.count() > 0 && await introEl.isVisible().catch(() => false);
      if (hasIntro && report.introFirstSeen === null) report.introFirstSeen = t;

      const greetingEl = page.locator(GREETING_SELECTOR).first();
      const hasGreeting = await greetingEl.count() > 0 && await greetingEl.isVisible().catch(() => false);
      if (hasGreeting && report.greetingFirstSeen === null) report.greetingFirstSeen = t;
    }

    // 순서 검증: 지문이 먼저 스트리밍되어야 함 (지문이 없으면 첫대사만 있어도 PASS)
    if (report.introFirstSeen !== null && report.greetingFirstSeen !== null) {
      report.orderCorrect = report.introFirstSeen <= report.greetingFirstSeen;
      if (report.orderCorrect) {
        report.orderDescr = null;
      } else {
        const diff = report.greetingFirstSeen - report.introFirstSeen;
        report.orderDescr = diff < 0
          ? `첫대사가 지문보다 먼저 노출됨 (지문: ${report.introFirstSeen.toFixed(2)}초, 첫대사: ${report.greetingFirstSeen.toFixed(2)}초)`
          : `지문과 첫대사 동시 노출 (${report.introFirstSeen.toFixed(2)}초) - 지문 스트리밍 완료 후 첫대사 순서 확인 필요`;
      }
    } else if (report.introFirstSeen === null && report.greetingFirstSeen !== null) {
      report.orderCorrect = false;
      report.orderDescr = '지문박스 미노출, 첫대사만 표시됨';
    } else if (report.introFirstSeen !== null && report.greetingFirstSeen === null) {
      report.orderCorrect = false;
      report.orderDescr = '지문박스만 노출, 10초 내 첫대사 미표시';
    } else {
      report.orderCorrect = false;
      report.orderDescr = '지문·첫대사 모두 10초 내 미노출';
    }

    report.result = report.orderCorrect ? 'PASS' : 'FAIL';
    report.observations = [
      `지문박스 첫 노출: ${report.introFirstSeen != null ? report.introFirstSeen.toFixed(2) + '초' : '없음'}`,
      `첫대사 첫 노출: ${report.greetingFirstSeen != null ? report.greetingFirstSeen.toFixed(2) + '초' : '없음'}`,
      report.orderDescr || '지문 → 첫대사 순서 정상',
    ];

    await browser.close();
  } catch (err) {
    report.result = 'FAIL';
    report.observations = [err.message];
    if (browser) await browser.close().catch(() => {});
  }

  printReport(report);
}

function printReport(r) {
  console.log('\n========== 오프닝 순서 검증 ==========\n');
  console.log('결과:', r.result || 'FAIL');
  console.log('');
  console.log('관측:');
  (r.observations || []).forEach((s) => console.log('  -', s));
  console.log('');
  console.log('에러(있으면):');
  const hasConsole = (r.consoleErrors?.length ?? 0) > 0;
  const hasNetwork = (r.networkErrors?.length ?? 0) > 0;
  if (hasConsole || hasNetwork) {
    if (hasConsole) console.log('  콘솔:', (r.consoleErrors || []).slice(0, 2).join(' | '));
    if (hasNetwork) console.log('  네트워크:', (r.networkErrors || []).slice(0, 2).map((e) => e.error).join(' | '));
  } else {
    console.log('  없음');
  }
  console.log('\n======================================\n');
}

main().catch(console.error);
