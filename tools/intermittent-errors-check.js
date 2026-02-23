/**
 * '새로대화' 간헐 오류 반복 재현 시나리오 (8회)
 * URL: http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb
 */

const { chromium } = require('playwright');

const CHAR_URL = 'http://localhost:5173/characters/8ca0eacf-e3b7-407d-86d9-24cd5f73d8bb';
const ITERATIONS = 8;
const OBSERVE_MS = 6000;

async function main() {
  const results = [];
  const allConsoleErrors = [];
  const allNetworkFails = [];
  let errorIterations = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || type === 'warning') {
        allConsoleErrors.push({ type, text, at: results.length });
      }
    });

    page.on('requestfailed', (req) => {
      const failure = req.failure();
      allNetworkFails.push({
        url: req.url(),
        error: failure?.errorText || 'unknown',
        at: results.length,
      });
    });

    page.on('response', (res) => {
      const status = res.status();
      if (status >= 400) {
        allNetworkFails.push({
          url: res.url(),
          error: `HTTP ${status}`,
          at: results.length,
        });
      }
    });

    for (let i = 0; i < ITERATIONS; i++) {
      const iter = {
        round: i + 1,
        loadingSpinnerLingering: false,
        openingOrderWrong: false,
        messageDisappeared: false,
        statusErrorShown: false,
        inputLocked: false,
        url: null,
        urlParams: null,
        symptoms: [],
      };

      try {
        // 1) 캐릭터 상세 진입
        await page.goto(CHAR_URL, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1200);

        // 2) 새로대화 클릭
        const newChatBtn = page.locator('button:has-text("새로 대화"), button:has-text("선택한 오프닝으로 새로 대화"), button:has-text("대화 시작")').first();
        await newChatBtn.scrollIntoViewIfNeeded().catch(() => {});
        const hasBtn = await newChatBtn.count() > 0 && await newChatBtn.isVisible().catch(() => false);
        if (!hasBtn) {
          iter.symptoms.push('새로대화 버튼 미발견');
          results.push(iter);
          continue;
        }

        await newChatBtn.click();
        await page.waitForURL(/\/ws\/chat\//, { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(500);

        iter.url = page.url();
        try {
          const u = new URL(page.url());
          iter.urlParams = { new: u.searchParams.get('new'), room: u.searchParams.get('room') };
        } catch (_) {}

        // 3) 6초 관찰
        let introSeen = null;
        let greetingSeen = null;
        let hadMsg = false;
        let msgGone = false;

        for (let t = 0; t < OBSERVE_MS; t += 300) {
          await page.waitForTimeout(300);

          const spinner = page.locator('.animate-spin').or(page.getByText('채팅을 준비하고 있어요')).first();
          const hasSpinner = await spinner.count() > 0 && await spinner.isVisible().catch(() => false);
          if (hasSpinner && t > 4000) iter.loadingSpinnerLingering = true;

          const introBox = page.locator('div.flex.justify-center div.rounded-md.text-center').first();
          const hasIntro = await introBox.count() > 0 && await introBox.isVisible().catch(() => false);
          if (hasIntro && introSeen === null) introSeen = t / 1000;

          const greeting = page.locator('.cc-assistant-speech-bubble').first();
          const hasGreeting = await greeting.count() > 0 && await greeting.isVisible().catch(() => false);
          if (hasGreeting && greetingSeen === null) greetingSeen = t / 1000;

          if (hasGreeting) hadMsg = true;
          else if (hadMsg) msgGone = true;

          const statusErr = page.locator('text=스탯, text=상태창 오류, text=오류가 발생').first();
          const hasStatusErr = await statusErr.count() > 0 && await statusErr.isVisible().catch(() => false);
          if (hasStatusErr) iter.statusErrorShown = true;

          const input = page.locator('textarea[placeholder], textarea').first();
          const inputDisabled = await input.getAttribute('disabled').catch(() => null);
          const inputReadOnly = await input.getAttribute('readonly').catch(() => null);
          if ((inputDisabled || inputReadOnly) && t > 5000) {
            const ariaDisabled = await input.getAttribute('aria-disabled').catch(() => null);
            if (ariaDisabled === 'true') iter.inputLocked = true;
          }
        }

        if (introSeen != null && greetingSeen != null && greetingSeen < introSeen - 0.2) {
          iter.openingOrderWrong = true;
        }
        if (msgGone) iter.messageDisappeared = true;

        if (iter.loadingSpinnerLingering) iter.symptoms.push('로딩 스피너 6초 후 잔류');
        if (iter.openingOrderWrong) iter.symptoms.push('오프닝 지문/첫대사 순서 꼬임');
        if (iter.messageDisappeared) iter.symptoms.push('메시지 보였다가 사라짐');
        if (iter.statusErrorShown) iter.symptoms.push('상태창/스탯 오류 노출');
        if (iter.inputLocked) iter.symptoms.push('입력창 잠금 잔류');
        if (iter.symptoms.length === 0) iter.symptoms.push('이상 없음');

        const hasIssue = iter.symptoms.some((s) => s !== '이상 없음');
        if (hasIssue) errorIterations.push(i + 1);

        results.push(iter);
      } catch (e) {
        iter.symptoms.push(`예외: ${e.message}`);
        errorIterations.push(i + 1);
        results.push(iter);
      }

      // 4) 뒤로가기 또는 재진입
      await page.goto(CHAR_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    await browser.close();
  } catch (err) {
    console.error('Script error:', err);
    if (browser) await browser.close().catch(() => {});
  }

  printReport(results, errorIterations, allConsoleErrors, allNetworkFails);
}

function printReport(results, errorIterations, consoleErrors, networkFails) {
  const reproRate = errorIterations.length;
  const reproduced = reproRate > 0;

  console.log('\n========== 새로대화 간헐 오류 반복 재현 결과 ==========\n');

  console.log('1) 재현 결과:', reproduced ? '재현됨' : '재현 안됨', `(재현률 ${reproRate}/${ITERATIONS})\n`);

  console.log('2) 오류가 뜬 회차와 증상:');
  if (errorIterations.length > 0) {
    errorIterations.forEach((r) => {
      const iter = results.find((x) => x.round === r);
      if (iter) {
        console.log(`   회차 ${r}:`, iter.symptoms.join(', '));
        if (iter.urlParams) console.log(`      URL params: new=${iter.urlParams.new}, room=${iter.urlParams.room}`);
      }
    });
  } else {
    console.log('   없음 (모든 회차 이상 없음)');
  }

  console.log('\n3) 콘솔/네트워크 근거:');
  const uniqueConsole = [...new Set(consoleErrors.map((e) => e.text))].slice(0, 5);
  const appRelevant = networkFails.filter((e) => {
    const u = (e.url || '').toLowerCase();
    return u.includes('localhost') || u.includes('127.0.0.1') || u.includes('/api/') || u.includes('socket') || u.includes('ws');
  });
  const uniqueNetwork = [...new Set(appRelevant.map((e) => `${e.error}: ${e.url?.slice(0, 70)}`))].slice(0, 5);
  console.log('   콘솔:', uniqueConsole.length ? uniqueConsole.join(' | ') : '없음');
  console.log('   네트워크(앱 관련):', uniqueNetwork.length ? uniqueNetwork.join(' | ') : '없음');
  if (networkFails.length > 0 && appRelevant.length === 0) {
    console.log('   (외부 리소스 실패', networkFails.length, '건, 앱과 무관 추정)');
  }

  console.log('\n4) 가장 유력한 원인 (코드 관점):');
  if (reproduced) {
    console.log('   - (아래 5) 참고)');
  } else {
    console.log('   - 8회 시도에서 미재현: 레이스 컨디션/타이밍 의존 버그 가능성');
  }

  console.log('\n5) 지금 바로 적용 가능한 수정안 (최소 변경):');
  if (reproduced) {
    console.log('   - 콘솔/네트워크 실패 패턴에 따라:');
    if (networkFails.some((f) => f.error.includes('aborted') || f.error.includes('timeout'))) {
      console.log('     · API/소켓 타임아웃·abort: 재시도 로직 또는 타임아웃 상향');
    }
    if (results.some((r) => r.loadingSpinnerLingering)) {
      console.log('     · 로딩 스피너 잔류: message_history 도착 시 강제 해제 또는 최대 노출 시간(예: 8초) 도입');
    }
    if (results.some((r) => r.messageDisappeared)) {
      console.log('     · 메시지 사라짐: setMessages 호출 시 이전 메시지 병합 보존 로직 점검');
    }
  } else {
    console.log('   - 재현률 0/8: 패턴 수집 부족. 실기기/느린 네트워크에서 동일 시나리오 재실행 권장');
  }

  console.log('\n--- 회차별 상세 ---');
  results.forEach((r) => {
    const badge = r.symptoms.some((s) => s !== '이상 없음') ? '[오류]' : '[정상]';
    console.log(`   ${r.round}회 ${badge}`, r.symptoms.join(' | '));
  });

  console.log('\n====================================================\n');
}

main().catch(console.error);
