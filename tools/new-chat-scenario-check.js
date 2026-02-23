/**
 * 채팅 UX 패치 재검증: '새로 대화' → 오프닝 표시까지
 * URL: http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/a6182254-a7be-432c-b714-6f24dd891b35';

async function main() {
  const report = {
    stepBlocked: null,
    errorAtStep: null,
    clickToOpeningSec: null,
    loadingOverlayVisible: false,
    loadingOverlaySeconds: null,
    messageAppearedThenDisappeared: false,
    streamingSmoothFor10s: false,
    reStreamAfterRefresh: false,
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
      report.stepBlocked = '2) 새로대화/대화시작 버튼 미발견';
      await browser.close();
      printReport(report);
      return;
    }

    const t0 = Date.now();
    await newChatBtn.click();

    await page.waitForURL(/\/ws\/chat\//, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);

    if (!page.url().includes('/ws/chat/')) {
      report.stepBlocked = '3) 채팅방 진입 실패';
      await browser.close();
      printReport(report);
      return;
    }

    // 500ms 간격으로 10초 관찰 (클릭 → 오프닝 표시, 로딩 오버레이, 깜빡임, 스트리밍 연속성)
    let loadingFirstSeen = null;
    let loadingLastSeen = null;
    let openingFirstSeen = null;
    let hadMsgThenGone = false;
    let msgCountHistory = [];
    const POLL_MS = 500;
    const OBSERVE_SEC = 10;

    for (let elapsed = 0; elapsed < OBSERVE_SEC * 1000; elapsed += POLL_MS) {
      await page.waitForTimeout(POLL_MS);
      const t = (Date.now() - t0) / 1000;

      const overlay = page.locator('text=채팅을 준비하고 있어요').first();
      const hasOverlay = await overlay.count() > 0 && await overlay.isVisible().catch(() => false);
      if (hasOverlay) {
        report.loadingOverlayVisible = true;
        if (loadingFirstSeen === null) loadingFirstSeen = t;
        loadingLastSeen = t;
      }

      const msgBubbles = page.locator('.cc-assistant-speech-bubble');
      const count = await msgBubbles.count();
      const hasVisible = count > 0 && await msgBubbles.first().isVisible().catch(() => false);
      if (hasVisible && openingFirstSeen === null) openingFirstSeen = t;
      msgCountHistory.push({ t, count, hasVisible });
      if (msgCountHistory.length >= 4) {
        const prev = msgCountHistory.slice(-4);
        const had = prev.some((p) => p.hasVisible);
        const now = prev[prev.length - 1].hasVisible;
        if (had && !now) hadMsgThenGone = true;
      }
    }

    report.clickToOpeningSec = openingFirstSeen != null ? openingFirstSeen.toFixed(2) : null;
    if (loadingFirstSeen != null) {
      report.loadingOverlaySeconds = loadingLastSeen != null ? (loadingLastSeen - loadingFirstSeen).toFixed(2) : (OBSERVE_SEC - loadingFirstSeen).toFixed(2) + '+';
    }
    report.messageAppearedThenDisappeared = hadMsgThenGone;
    const finalMsgCount = msgCountHistory.length > 0 ? msgCountHistory[msgCountHistory.length - 1].count : 0;
    report.streamingSmoothFor10s = openingFirstSeen != null && finalMsgCount >= 1 && !hadMsgThenGone;

    // 새로고침 후 오프닝 재스트리밍·깜빡임 관찰
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    let hadMsgAfter = false;
    let goneAfter = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const msgBubble = page.locator('.cc-assistant-speech-bubble').first();
      const hasMsg = await msgBubble.count() > 0 && await msgBubble.isVisible().catch(() => false);
      if (hasMsg) {
        hadMsgAfter = true;
        report.reStreamAfterRefresh = true;
      } else if (hadMsgAfter) goneAfter = true;
    }
    if (goneAfter) report.messageAppearedThenDisappeared = true;

    report.symptoms = buildSymptoms(report);

    await browser.close();
  } catch (err) {
    report.stepBlocked = report.stepBlocked || '실행 중 예외';
    report.errorAtStep = err.message;
    report.symptoms = [err.message];
    if (browser) await browser.close().catch(() => {});
  }

  printReport(report);
}

function buildSymptoms(r) {
  const s = [];
  if (r.clickToOpeningSec != null) s.push(`[1] 클릭→오프닝: ${r.clickToOpeningSec}초`);
  if (r.loadingOverlayVisible) s.push(`[2] 로딩 오버레이: ${r.loadingOverlaySeconds ?? '?'}초`);
  else s.push(`[2] 로딩 오버레이: 미노출`);
  s.push(`[3] 보였다가 사라짐: ${r.messageAppearedThenDisappeared ? '있음' : '없음'}`);
  s.push(`[4] 10초 스트리밍 연속성: ${r.streamingSmoothFor10s ? '양호' : '이상'}`);
  s.push(`[5] 새로고침 후 재스트리밍: ${r.reStreamAfterRefresh ? '정상' : '미확인'}`);
  return s;
}

function printReport(r) {
  const pass = !r.stepBlocked &&
    r.clickToOpeningSec != null &&
    !r.messageAppearedThenDisappeared &&
    r.streamingSmoothFor10s &&
    (r.consoleErrors?.length ?? 0) === 0 &&
    (r.networkErrors?.length ?? 0) === 0;

  console.log('\n========== 채팅 UX 패치 재검증 ==========\n');
  console.log('결과:', pass ? 'PASS' : 'FAIL');
  console.log('');
  console.log('측정값(초):');
  console.log('  - 클릭→오프닝 표시:', r.clickToOpeningSec ?? '-');
  console.log('  - 로딩 오버레이 노출:', r.loadingOverlayVisible ? '있음' : '없음');
  console.log('  - 로딩 오버레이 지속:', r.loadingOverlaySeconds ?? '-');
  console.log('');
  console.log('관측 증상:');
  (r.symptoms || []).forEach((s) => console.log('  ', s));
  console.log('');
  console.log('콘솔 에러:', (r.consoleErrors?.length ?? 0) > 0 ? '있음' : '없음');
  console.log('네트워크 에러:', (r.networkErrors?.length ?? 0) > 0 ? '있음' : '없음');
  if (r.stepBlocked) console.log('\n막힌 단계:', r.stepBlocked, r.errorAtStep || '');
  console.log('\n==========================================\n');
}

main().catch(console.error);
