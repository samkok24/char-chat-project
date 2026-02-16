/**
 * 지문박스(intro) 스트리밍 집중 검증
 * URL: http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35';
const DEBUG = process.env.DEBUG === '1';

async function main() {
  const report = {
    stepBlocked: null,
    introStreaming: false,
    greetingStreaming: false,
    messageFlashed: false,
    observeSec: 0,
    symptoms: [],
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

    const newChatBtn = page.locator('button:has-text("새로 대화"), button:has-text("선택한 오프닝으로 새로 대화"), button:has-text("대화 시작"), button:has-text("등장인물과 원작챗 시작")').first();
    await newChatBtn.scrollIntoViewIfNeeded().catch(() => {});
    const hasBtn = await newChatBtn.count() > 0 && await newChatBtn.isVisible().catch(() => false);
    if (!hasBtn) {
      report.stepBlocked = '2) 새로대화 버튼 미발견';
      await browser.close();
      printReport(report);
      return;
    }

    const t0 = Date.now();
    await newChatBtn.click();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);

    if (!page.url().includes('/ws/chat/')) {
      report.stepBlocked = '3) 채팅방 진입 실패';
      await browser.close();
      printReport(report);
      return;
    }

    // 지문박스: 채팅 스크롤 영역 내 가운데 정렬 박스 (intro)
    const scrollArea = page.locator('div.overflow-y-auto');
    const introBox = scrollArea.locator('div.text-center.rounded-md').first();
    const greetingBubble = page.locator('.cc-assistant-speech-bubble').first();

    const POLL_MS = 150;
    const OBSERVE_MS = 6000;
    const introLengths = [];
    const greetingLengths = [];
    let hadIntro = false;
    let hadGreeting = false;
    let introGoneAfter = false;
    let greetingGoneAfter = false;

    for (let elapsed = 0; elapsed < OBSERVE_MS; elapsed += POLL_MS) {
      await page.waitForTimeout(POLL_MS);
      const t = (Date.now() - t0) / 1000;

      // 지문박스 텍스트 길이 샘플 (가운데 정렬 박스)
      const introVisible = await introBox.count() > 0 && await introBox.isVisible().catch(() => false);
      let introLen = 0;
      if (introVisible) {
        hadIntro = true;
        try {
          const text = await introBox.textContent();
          introLen = (text || '').trim().length;
        } catch (_) {}
      } else if (hadIntro) {
        introGoneAfter = true;
      }
      introLengths.push({ t, len: introLen });

      // 첫대사 말풍선 텍스트 길이 샘플
      const greetingVisible = await greetingBubble.count() > 0 && await greetingBubble.isVisible().catch(() => false);
      let greetLen = 0;
      if (greetingVisible) {
        hadGreeting = true;
        try {
          const text = await greetingBubble.textContent();
          greetLen = (text || '').trim().length;
        } catch (_) {}
      } else if (hadGreeting) {
        greetingGoneAfter = true;
      }
      greetingLengths.push({ t, len: greetLen });
    }

    report.observeSec = (Date.now() - t0) / 1000;

    // 지문박스 스트리밍: 텍스트 길이가 증가하는 구간이 있으면 점진 출력
    let introGrowing = false;
    for (let i = 1; i < introLengths.length; i++) {
      if (introLengths[i].len > introLengths[i - 1].len) {
        introGrowing = true;
        break;
      }
    }
    report.introStreaming = introGrowing;

    // 첫대사 스트리밍: 텍스트 길이가 증가하는 구간이 있으면 점진 출력
    let greetingGrowing = false;
    for (let i = 1; i < greetingLengths.length; i++) {
      if (greetingLengths[i].len > greetingLengths[i - 1].len) {
        greetingGrowing = true;
        break;
      }
    }
    report.greetingStreaming = greetingGrowing;

    report.messageFlashed = introGoneAfter || greetingGoneAfter;

    if (DEBUG) {
      console.log('[DEBUG] intro lengths sample:', introLengths.slice(0, 15).map((x) => x.len));
      console.log('[DEBUG] greeting lengths sample:', greetingLengths.slice(0, 15).map((x) => x.len));
    }

    report.symptoms = [
      `지문박스 스트리밍: ${report.introStreaming ? '있음(점진출력)' : '없음'}`,
      `첫대사 스트리밍: ${report.greetingStreaming ? '있음' : '없음'}`,
      `깜빡임(보였다 사라짐): ${report.messageFlashed ? '있음' : '없음'}`,
      `관측 시간: 약 ${report.observeSec.toFixed(1)}초`,
    ];

    await browser.close();
  } catch (err) {
    report.stepBlocked = report.stepBlocked || '실행 중 예외';
    report.symptoms = [err.message];
    if (browser) await browser.close().catch(() => {});
  }

  printReport(report);
}

function printReport(r) {
  const pass = !r.stepBlocked &&
    r.introStreaming &&
    r.greetingStreaming &&
    !r.messageFlashed &&
    (r.consoleErrors?.length ?? 0) === 0 &&
    (r.networkErrors?.length ?? 0) === 0;

  console.log('\n========== 지문박스(intro) 스트리밍 검증 ==========\n');
  console.log('결과:', pass ? 'PASS' : 'FAIL');
  console.log('');
  console.log('핵심 측정:');
  console.log('  - 지문박스 스트리밍:', r.introStreaming ? '있음 (글자 단위/점진 출력)' : '없음');
  console.log('  - 첫대사 스트리밍:', r.greetingStreaming ? '있음' : '없음');
  console.log('  - 깜빡임(보였다 사라짐):', r.messageFlashed ? '있음' : '없음');
  console.log('  - 관측 시간: 약', (r.observeSec || 0).toFixed(1), '초');
  console.log('');
  console.log('관측 증상:');
  (r.symptoms || []).forEach((s) => console.log('  ', s));
  console.log('');
  console.log('콘솔 에러:', (r.consoleErrors?.length ?? 0) > 0 ? '있음' : '없음');
  console.log('네트워크 에러:', (r.networkErrors?.length ?? 0) > 0 ? '있음' : '없음');
  if (r.stepBlocked) console.log('\n막힌 단계:', r.stepBlocked);
  console.log('\n==================================================\n');
}

main().catch(console.error);
